"""Flipkart Marketplace Seller API: orders, from the shipments they ship in.

A self-access app (Seller Hub → Manage Profile → Developer Access) gives an
application ID and secret, exchanged with the client-credentials grant for a
long-lived token. Orders are read through the v3 shipments filter, once for
each lifecycle stage.

Flipkart's order data does not carry its commission or fixed fees; those are
only in its settlement reports. Fees therefore stay unknown for Flipkart rather
than being shown as zero. `flipkartDiscount` is funded by Flipkart, so it is not
counted as the brand's discount.
"""
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order

BASE = "https://api.flipkart.net"
SELLERS = f"{BASE}/sellers"
PAGE = 20  # Flipkart's maximum
CHUNK = timedelta(days=30)
STAGES = [
    ("preDispatch", ["APPROVED", "PACKING_IN_PROGRESS", "PACKED", "FORM_FAILED", "READY_TO_DISPATCH"], "orderDate"),
    ("postDispatch", ["SHIPPED", "DELIVERED", "PICKUP_COMPLETE"], "orderDate"),
    ("cancelled", ["CANCELLED"], "cancellationDate"),
]


def _num(value):
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _time(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


class FlipkartConnector(BaseConnector):
    platform_name = "flipkart"

    def _token(self):
        c = self.credentials
        expires = c.get("_token_expires")
        if c.get("_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_token"]
        if not c.get("app_id") or not c.get("app_secret"):
            raise http.ConnectorAuthError("Enter both the Flipkart application ID and secret")
        resp = http.request(
            "GET", f"{BASE}/oauth-service/oauth/token", platform="Flipkart",
            params={"grant_type": "client_credentials", "scope": "Seller_Api"},
            auth=(c["app_id"], c["app_secret"]), auth_statuses=(400, 401, 403),
        )
        body = http.json_of(resp, "Flipkart")
        token = body.get("access_token")
        if not token:
            raise http.ConnectorAuthError("Flipkart did not issue a token for this application")
        lifetime = int(body.get("expires_in") or 3600)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(60, lifetime - 300))
        self.remember(_token=token, _token_expires=expires_at.isoformat())
        return token

    def _headers(self):
        return {"Authorization": f"Bearer {self._token()}", "Content-Type": "application/json"}

    def _shipments(self, stage, states, date_field, start, end):
        body = {
            "filter": {
                "type": stage,
                "states": states,
                date_field: {"from": start.isoformat(timespec="seconds"), "to": end.isoformat(timespec="seconds")},
            },
            "pagination": {"pageSize": PAGE},
        }
        resp = http.request("POST", f"{SELLERS}/v3/shipments/filter/", platform="Flipkart",
                            json=body, headers=self._headers())
        page = http.json_of(resp, "Flipkart")
        while True:
            yield from page.get("shipments") or []
            nxt = page.get("nextPageUrl")
            if not page.get("hasMore") or not nxt:
                return
            # Flipkart returns the next page as a path under /sellers.
            url = nxt if nxt.startswith("http") else f"{SELLERS}{nxt if nxt.startswith('/') else '/' + nxt}"
            page = http.json_of(http.request("GET", url, platform="Flipkart", headers=self._headers()), "Flipkart")

    def test_connection(self):
        now = datetime.now(timezone.utc)
        stage, states, field = STAGES[0]
        next(self._shipments(stage, states, field, now - timedelta(days=1), now), None)
        return {"account_id": self.credentials["app_id"], "display_name": "Flipkart Seller Hub"}

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id

        # An order can ship in several shipments and sit in several stages, so
        # gather every item first and write each order once.
        orders = {}
        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            for stage, states, field in STAGES:
                for shipment in self._shipments(stage, states, field, cursor, chunk_end):
                    for item in shipment.get("orderItems") or []:
                        order_id = item.get("orderId")
                        if not order_id:
                            continue
                        entry = orders.setdefault(order_id, {"items": {}, "date": None})
                        entry["items"][item.get("orderItemId") or item.get("sku")] = item
                        entry["date"] = entry["date"] or _time(item.get("orderDate"))
            cursor = chunk_end

        for order_id, entry in orders.items():
            items = list(entry["items"].values())
            live = [i for i in items if (i.get("status") or "").upper() != "CANCELLED"]
            cancelled = not live
            # A partly cancelled order is written with only what went ahead:
            # the cancelled lines never shipped and were never paid for.
            lines = []
            for item in (items if cancelled else live):
                qty = int(item.get("quantity") or 0) or 1
                prices = item.get("priceComponents") or {}
                sku = item.get("sku") or item.get("fsn")
                known = catalogue_for(brand_id, sku)
                lines.append({
                    "external_line_id": item.get("orderItemId"),
                    "sku": sku,
                    "product_name": known.get("product_name") or item.get("title") or sku,
                    "product_external_id": known.get("product_external_id") or f"fsn:{item.get('fsn')}",
                    "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                    "variant_title": known.get("variant_title"),
                    "category": known.get("category"),
                    "subcategory": known.get("subcategory"),
                    "quantity": qty,
                    "unit_price": _num(prices.get("sellingPrice")) / qty,
                    "unit_cost": known.get("unit_cost"),
                })
            statuses = {(i.get("status") or "").upper() for i in live}
            status = "delivered" if statuses == {"DELIVERED"} else \
                "shipped" if statuses & {"SHIPPED", "DELIVERED", "PICKUP_COMPLETE"} else "placed"
            upsert_order(
                brand_id, "flipkart", order_id,
                order_name=order_id,
                order_date=entry["date"] or end,
                lines=lines,
                currency="INR",
                status=status,
                is_cancelled=cancelled,
                shipping=sum(_num((i.get("priceComponents") or {}).get("shippingCharge")) for i in live),
                marketplace_fee=None,
            )
        db.session.commit()

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": len(orders),
                "records_synced": len(orders), "incremental": since is not None}
