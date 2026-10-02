"""eBay: orders and marketplace fees, via the Sell Fulfillment API.

Selling on eBay needs a User access token, which client credentials alone
cannot mint — eBay only issues those for public catalogue data, not a seller's
own orders. So this connects the same way Google Ads and GA4 do here: you
authorise once through eBay's own consent screen (My eBay → run eBay's OAuth
flow, or the "Get a User Token" tool in the developer portal) to get a refresh
token, then paste the app's client ID and secret alongside it. The refresh
token is long-lived; the access token it mints is swapped in automatically and
cached for its two-hour life.

eBay's own filter only returns orders from the last three months regardless of
what is asked for, so a first sync cannot backfill further than that — there is
no way to read older orders through this API.
"""
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order

TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token"
API = "https://api.ebay.com/sell/fulfillment/v1"
SCOPE = "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly"
PAGE = 200
# eBay states its own filter only ever returns the trailing three months, so
# reaching further back is not a smaller page size away — it simply is not
# there to read.
MAX_LOOKBACK = timedelta(days=88)


def _amount(block):
    try:
        return float((block or {}).get("value"))
    except (TypeError, ValueError):
        return None


def _time(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _iso(dt):
    # eBay's filter needs milliseconds and a literal Z, and the brackets and
    # braces in the filter syntax must be percent-encoded or eBay 400s.
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class EbayConnector(BaseConnector):
    platform_name = "ebay"
    BACKFILL_DAYS = 88

    def window_start(self, since):
        start = super().window_start(since)
        floor = datetime.now(timezone.utc) - MAX_LOOKBACK
        return max(start, floor)

    # Auth ---------------------------------------------------------------------

    def _access_token(self):
        c = self.credentials
        expires = c.get("_access_expires")
        if c.get("_access_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_access_token"]
        missing = [k for k in ("client_id", "client_secret", "refresh_token") if not c.get(k)]
        if missing:
            raise http.ConnectorAuthError(f"Enter the eBay {', '.join(missing).replace('_', ' ')}")
        resp = http.request(
            "POST", TOKEN_URL, platform="eBay", auth_statuses=(400, 401, 403),
            auth=(c["client_id"], c["client_secret"]),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "refresh_token", "refresh_token": c["refresh_token"], "scope": SCOPE},
        )
        body = http.json_of(resp, "eBay")
        token = body.get("access_token")
        if not token:
            raise http.ConnectorAuthError("eBay did not issue an access token for this refresh token")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 7200)) - 60)
        self.remember(_access_token=token, _access_expires=expires_at.isoformat())
        return token

    def _get(self, path, params):
        resp = http.request("GET", f"{API}{path}", platform="eBay", params=params,
                            headers={"Authorization": f"Bearer {self._access_token()}",
                                    "Accept": "application/json"})
        return http.json_of(resp, "eBay")

    def test_connection(self):
        body = self._get("/order", {"limit": 1})
        return {"account_id": self.credentials["client_id"], "display_name": "eBay",
                "orders_visible": body.get("total", 0)}

    # Sync -------------------------------------------------------------------

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id

        # requests percent-encodes the brackets in this filter string on its
        # own when it builds the query string from the params dict.
        window = f"lastmodifieddate:[{_iso(start)}..{_iso(end)}]"
        offset, orders = 0, 0
        while True:
            body = self._get("/order", {"filter": window, "limit": PAGE, "offset": offset})
            for node in body.get("orders") or []:
                self._upsert_order(node)
                orders += 1
            db.session.commit()
            offset += PAGE
            if offset >= int(body.get("total") or 0):
                break

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": orders, "records_synced": orders,
                "incremental": since is not None,
                "window": [start.date().isoformat(), end.date().isoformat()]}

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        cancel_state = ((node.get("cancelStatus") or {}).get("cancelState") or "").upper()
        fulfillment = (node.get("orderFulfillmentStatus") or "").upper()
        pricing = node.get("pricingSummary") or {}
        order_fee = _amount(pricing.get("fee"))

        lines = []
        for li in node.get("lineItems") or []:
            qty = int(li.get("quantity") or 0)
            total = _amount(li.get("lineItemCost")) or 0.0
            sku = li.get("sku") or li.get("legacyItemId")
            known = catalogue_for(brand_id, sku)
            refunded = sum(
                _amount(r.get("amount")) or 0.0 for r in li.get("refunds") or []
            )
            lines.append({
                "external_line_id": li.get("lineItemId"),
                "sku": sku,
                "product_name": known.get("product_name") or li.get("title") or sku,
                "product_external_id": known.get("product_external_id") or f"ebay:{li.get('legacyItemId')}",
                "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                "variant_title": known.get("variant_title"),
                "category": known.get("category"),
                "subcategory": known.get("subcategory"),
                "quantity": qty,
                "unit_price": (total / qty) if qty else total,
                "unit_cost": known.get("unit_cost"),
                "returned_amount": refunded,
                "returned_quantity": qty if refunded and refunded >= total else 0,
            })
        # eBay's fee sits at the order, not the line; the shared writer spreads
        # an order-level fee across lines by value on its own.
        upsert_order(
            brand_id, "ebay", node["orderId"],
            order_name=node.get("legacyOrderId") or node["orderId"],
            order_date=_time(node.get("creationDate")) or datetime.now(timezone.utc),
            lines=lines,
            currency=(pricing.get("total") or {}).get("currency"),
            status="delivered" if fulfillment == "FULFILLED" else
                  "shipped" if fulfillment == "IN_PROGRESS" else "placed",
            is_cancelled=cancel_state == "CANCELED",
            shipping=_amount(pricing.get("deliveryCost")) or 0.0,
            tax=_amount(pricing.get("tax")) or 0.0,
            marketplace_fee=order_fee,
        )
