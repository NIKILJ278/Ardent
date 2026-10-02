"""TikTok Shop: orders and marketplace fees, via the Partner API.

Every request is signed: query params (minus `sign` and `access_token`) are
sorted, concatenated with the request path, wrapped in the app secret, and
HMAC-SHA256'd with the app secret as the key. Getting this wrong fails
silently as an auth error, so it lives in one place (`_sign`) rather than
being reimplemented per call.

Connecting needs one authorisation per shop: run TikTok's OAuth consent once
(from the Partner Center or your app's own install link) to get a long-lived
refresh token and the shop's cipher, then paste the app key, app secret,
refresh token and shop cipher in here. TikTok reports success or failure in
the response body's `code` field, never in the HTTP status — a 200 with
`code: 105002` is an expired or wrong access token.
"""
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order

AUTH_HOST = "https://auth.tiktok-shops.com"
API_HOST = "https://open-api.tiktokglobalshop.com"
PAGE = 100
CHUNK = timedelta(days=30)
# TikTok Shop reports an expired/invalid access token as one of these codes
# inside a 200 response, not as an HTTP 401.
AUTH_ERROR_CODES = {105002, 105003, 105004, 36004101}


def _sign(path, params, app_secret, body=None):
    """HMAC-SHA256 over sorted params (excluding sign/access_token), the path,
    and the raw body — wrapped in the app secret on both sides, per TikTok's
    documented recipe."""
    items = sorted((k, v) for k, v in params.items() if k not in ("sign", "access_token"))
    joined = "".join(f"{k}{v}" for k, v in items if not isinstance(v, (list, dict)))
    base = path + joined
    if body:
        base += body
    wrapped = f"{app_secret}{base}{app_secret}"
    return hmac.new(app_secret.encode(), wrapped.encode(), hashlib.sha256).hexdigest()


def _num(value):
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _time(seconds):
    if not seconds:
        return None
    return datetime.fromtimestamp(int(seconds), tz=timezone.utc)


class TikTokShopConnector(BaseConnector):
    platform_name = "tiktok_shop"

    # Auth ---------------------------------------------------------------------

    def _access_token(self):
        c = self.credentials
        expires = c.get("_access_expires")
        if c.get("_access_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_access_token"]
        missing = [k for k in ("app_key", "app_secret", "refresh_token") if not c.get(k)]
        if missing:
            raise http.ConnectorAuthError(f"Enter the TikTok Shop {', '.join(missing).replace('_', ' ')}")
        resp = http.request(
            "GET", f"{AUTH_HOST}/api/v2/token/refresh", platform="TikTok Shop",
            params={"app_key": c["app_key"], "app_secret": c["app_secret"],
                    "refresh_token": c["refresh_token"], "grant_type": "refresh_token"},
        )
        body = http.json_of(resp, "TikTok Shop")
        if body.get("code"):
            raise http.ConnectorAuthError(
                f"TikTok Shop refused the refresh token: {body.get('message', body.get('code'))}"
            )
        data = body.get("data") or {}
        token = data.get("access_token")
        if not token:
            raise http.ConnectorAuthError("TikTok Shop did not return an access token")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(data.get("access_token_expire_in", 7200)) - 60)
        # The refresh token TikTok issues alongside it replaces the old one —
        # unlike Amazon or eBay, the one just used is not guaranteed to still
        # work on the next call, so it must be saved every time, not only the
        # access token.
        self.remember(_access_token=token, _access_expires=expires_at.isoformat(),
                      refresh_token=data.get("refresh_token", c["refresh_token"]))
        return token

    def _call(self, method, path, query=None, body=None):
        c = self.credentials
        if not c.get("app_key") or not c.get("shop_cipher"):
            raise http.ConnectorAuthError("Enter the TikTok Shop app key and shop cipher")
        params = {
            "app_key": c["app_key"], "timestamp": str(int(time.time())),
            "shop_cipher": c["shop_cipher"], **(query or {}),
        }
        params["access_token"] = self._access_token()
        # Signed over the exact bytes that go on the wire — serialized once,
        # here, and sent as that same string via `data=`, never re-serialized
        # by requests through `json=`, which could reorder keys or change
        # spacing and invalidate the signature TikTok recomputes on its side.
        body_str = json.dumps(body) if body is not None else None
        params["sign"] = _sign(path, params, c["app_secret"], body=body_str)

        resp = http.request(method, f"{API_HOST}{path}", platform="TikTok Shop", params=params,
                            data=body_str,
                            headers={"Content-Type": "application/json"} if body_str is not None else None)
        result = http.json_of(resp, "TikTok Shop")
        code = result.get("code")
        if code:
            if code in AUTH_ERROR_CODES:
                raise http.ConnectorAuthError(f"TikTok Shop rejected the access token: {result.get('message')}")
            raise http.ConnectorError(f"TikTok Shop returned an error: {result.get('message', code)}")
        return result.get("data") or {}

    def test_connection(self):
        data = self._call("GET", "/authorization/202309/shops")
        shops = data.get("shops") or []
        mine = next((s for s in shops if s.get("cipher") == self.credentials.get("shop_cipher")), None)
        name = (mine or {}).get("name") or self.credentials["shop_cipher"]
        return {"account_id": self.credentials["app_key"], "display_name": f"TikTok Shop · {name}"}

    # Sync -------------------------------------------------------------------

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id
        orders = 0

        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            page_token = None
            while True:
                body = {
                    "update_time_ge": int(cursor.timestamp()), "update_time_lt": int(chunk_end.timestamp()),
                    "page_size": PAGE, "sort_field": "update_time", "sort_order": "ASC",
                }
                if page_token:
                    body["page_token"] = page_token
                data = self._call("POST", "/order/202309/orders/search", body=body)
                for node in data.get("orders") or []:
                    self._upsert_order(node)
                    orders += 1
                db.session.commit()
                page_token = data.get("next_page_token")
                if not page_token:
                    break
            cursor = chunk_end

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": orders, "records_synced": orders,
                "incremental": since is not None}

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        status = (node.get("status") or "").upper()
        currency = ((node.get("payment") or {}).get("currency")) or "USD"

        lines = []
        for item in node.get("line_items") or []:
            price = _num((item.get("sale_price")))
            sku = item.get("seller_sku") or item.get("sku_id")
            known = catalogue_for(brand_id, sku)
            is_cancelled_line = (item.get("display_status") or "").upper() == "CANCELLED"
            lines.append({
                "external_line_id": item.get("id"),
                "sku": sku,
                "product_name": known.get("product_name") or item.get("product_name") or sku,
                "product_external_id": known.get("product_external_id") or f"tiktok:{item.get('product_id')}",
                "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                "variant_title": known.get("variant_title") or item.get("sku_name"),
                "category": known.get("category"),
                "subcategory": known.get("subcategory"),
                "quantity": 1,  # TikTok Shop lists one line item per unit
                "unit_price": price,
                "unit_cost": known.get("unit_cost"),
                "_cancelled": is_cancelled_line,
            })

        whole_order_cancelled = bool(lines) and all(li["_cancelled"] for li in lines)
        live_lines = [{k: v for k, v in li.items() if k != "_cancelled"}
                     for li in lines if not li["_cancelled"]]
        all_lines = [{k: v for k, v in li.items() if k != "_cancelled"} for li in lines]

        payment = node.get("payment") or {}
        upsert_order(
            brand_id, "tiktok_shop", node["id"],
            order_name=node.get("id"),
            order_date=_time(node.get("create_time")) or datetime.now(timezone.utc),
            lines=all_lines if whole_order_cancelled else live_lines,
            currency=currency,
            status="delivered" if status == "COMPLETED" else
                  "shipped" if status in ("AWAITING_COLLECTION", "IN_TRANSIT", "DELIVERED") else "placed",
            is_cancelled=whole_order_cancelled,
            shipping=_num(payment.get("shipping_fee")),
            tax=_num(payment.get("tax")),
            # TikTok Shop's marketplace commission is a settlement-statement
            # figure, not on the order itself.
            marketplace_fee=None,
        )
