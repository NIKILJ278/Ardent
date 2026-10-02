"""Mercado Libre: orders and marketplace fees, across Latin America.

Connecting needs one authorisation through Mercado Libre's consent screen to
get a refresh token (the client credentials grant only mints tokens for public
catalogue data, not a seller's own orders) — paste the client ID, client
secret and that refresh token here.

Mercado Libre's refresh token is single-use: every refresh returns a new one,
and the one just used stops working immediately. If the new token is not
saved, the next sync cannot authenticate at all — every refresh here saves it
before doing anything else with the access token it came with.
"""
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order

TOKEN_URL = "https://api.mercadolibre.com/oauth/token"
API = "https://api.mercadolibre.com"
PAGE = 50  # Mercado Libre's maximum for /orders/search
CHUNK = timedelta(days=30)

# What the seller keeps after Mercado Libre's commission and financing fee —
# reported per order under sale_fee/marketplace_fee-shaped fields depending on
# category; both are read and summed so nothing is missed.
FEE_KEYS = ("sale_fee", "marketplace_fee")


def _num(value):
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _time(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


class MercadoLibreConnector(BaseConnector):
    platform_name = "mercadolibre"

    # Auth ---------------------------------------------------------------------

    def _access_token(self):
        c = self.credentials
        expires = c.get("_access_expires")
        if c.get("_access_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_access_token"]
        missing = [k for k in ("client_id", "client_secret", "refresh_token") if not c.get(k)]
        if missing:
            raise http.ConnectorAuthError(f"Enter the Mercado Libre {', '.join(missing).replace('_', ' ')}")
        resp = http.request(
            "POST", TOKEN_URL, platform="Mercado Libre", auth_statuses=(400, 401, 403),
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            data={"grant_type": "refresh_token", "client_id": c["client_id"],
                  "client_secret": c["client_secret"], "refresh_token": c["refresh_token"]},
        )
        body = http.json_of(resp, "Mercado Libre")
        token = body.get("access_token")
        if not token:
            raise http.ConnectorAuthError("Mercado Libre did not issue an access token for this refresh token")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 21600)) - 60)
        # The refresh token just used is now dead — Mercado Libre issues a new
        # one on every call and only the newest one still works. Saving the
        # access token without this would strand the connection after exactly
        # one successful sync.
        new_refresh = body.get("refresh_token")
        if not new_refresh:
            raise http.ConnectorError(
                "Mercado Libre did not return a new refresh token; refusing to continue, "
                "since the one just used will no longer work"
            )
        self.remember(_access_token=token, _access_expires=expires_at.isoformat(), refresh_token=new_refresh,
                      seller_id=body.get("user_id") or c.get("seller_id"))
        return token

    def _get(self, path, params):
        resp = http.request("GET", f"{API}{path}", platform="Mercado Libre", params=params,
                            headers={"Authorization": f"Bearer {self._access_token()}"})
        return http.json_of(resp, "Mercado Libre")

    def test_connection(self):
        token = self._access_token()
        me = http.json_of(
            http.request("GET", f"{API}/users/me", platform="Mercado Libre",
                        headers={"Authorization": f"Bearer {token}"}),
            "Mercado Libre",
        )
        seller_id = me.get("id")
        if seller_id:
            self.remember(seller_id=seller_id)
        return {"account_id": str(seller_id), "display_name": f"Mercado Libre · {me.get('nickname', seller_id)}"}

    # Sync -------------------------------------------------------------------

    def _seller_id(self):
        seller_id = self.credentials.get("seller_id")
        if not seller_id:
            raise http.ConnectorError("The seller ID is not known yet; run Test connection again")
        return seller_id

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id
        orders = 0

        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            offset = 0
            while True:
                body = self._get("/orders/search", {
                    "seller": self._seller_id(),
                    "order.date_last_updated.from": cursor.strftime("%Y-%m-%dT%H:%M:%S.000-00:00"),
                    "order.date_last_updated.to": chunk_end.strftime("%Y-%m-%dT%H:%M:%S.000-00:00"),
                    "sort": "date_asc", "limit": PAGE, "offset": offset,
                })
                results = body.get("results") or []
                for node in results:
                    self._upsert_order(node)
                    orders += 1
                db.session.commit()
                offset += PAGE
                total = (body.get("paging") or {}).get("total", 0)
                if offset >= total or not results:
                    break
            cursor = chunk_end

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": orders, "records_synced": orders,
                "incremental": since is not None}

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        status = (node.get("status") or "").lower()
        tags = set(node.get("tags") or [])
        cancelled = status in ("cancelled", "invalid") or "cancelled" in tags

        lines = []
        for oi in node.get("order_items") or []:
            item = oi.get("item") or {}
            qty = int(oi.get("quantity") or 0)
            unit_price = _num(oi.get("unit_price"))
            fee = sum(_num(oi.get(k)) for k in FEE_KEYS if oi.get(k) is not None)
            sku = item.get("seller_sku") or item.get("seller_custom_field") or item.get("id")
            known = catalogue_for(brand_id, sku)
            lines.append({
                "external_line_id": item.get("id"),
                "sku": sku,
                "product_name": known.get("product_name") or item.get("title") or sku,
                "product_external_id": known.get("product_external_id") or f"meli:{item.get('id')}",
                "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                "variant_title": known.get("variant_title"),
                "category": known.get("category"),
                "subcategory": known.get("subcategory"),
                "quantity": qty,
                "unit_price": unit_price,
                "unit_cost": known.get("unit_cost"),
                "_fee": fee,
            })
        order_fee = sum(li.pop("_fee") for li in lines) or None

        payments = node.get("payments") or []
        paid = any((p.get("status") or "").lower() == "approved" for p in payments)

        upsert_order(
            brand_id, "mercadolibre", node["id"],
            order_name=str(node["id"]),
            order_date=_time(node.get("date_created")) or datetime.now(timezone.utc),
            lines=lines,
            currency=node.get("currency_id") or "USD",
            status="delivered" if "delivered" in tags else
                  "shipped" if "shipped" in tags or "ready_to_ship" in tags else
                  "placed" if paid else "pending",
            is_cancelled=cancelled,
            marketplace_fee=order_fee,
        )
