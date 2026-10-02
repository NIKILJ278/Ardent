"""Walmart Marketplace: orders, via the client-credentials grant.

The Client ID and Client Secret from Seller Center → Settings → API/Solution
Provider Onboarding are enough on their own — Walmart's own account is the one
this reads, so no consent screen is needed. The access token lasts fifteen
minutes and is minted fresh on demand, which is short enough that it is not
worth caching across a sync at all.
"""
import base64
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order

TOKEN_URL = "https://marketplace.walmartapis.com/v3/token"
ORDERS_URL = "https://marketplace.walmartapis.com/v3/orders"
PAGE = 200  # Walmart's maximum
CHUNK = timedelta(days=30)

CHARGE_TYPES = {"PRODUCT": "gross", "TAX": "tax", "SHIPPING": "shipping"}
LIVE_STATUSES = {"Created", "Acknowledged", "Shipped", "Delivered"}


def _num(value):
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def _time(millis):
    if not millis:
        return None
    return datetime.fromtimestamp(int(millis) / 1000, tz=timezone.utc)


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class WalmartConnector(BaseConnector):
    platform_name = "walmart"

    def _headers(self):
        c = self.credentials
        if not c.get("client_id") or not c.get("client_secret"):
            raise http.ConnectorAuthError("Enter both the Walmart Client ID and Client Secret")
        auth = base64.b64encode(f"{c['client_id']}:{c['client_secret']}".encode()).decode()
        resp = http.request(
            "POST", TOKEN_URL, platform="Walmart", auth_statuses=(400, 401, 403),
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
                "WM_SVC.NAME": "Walmart Marketplace",
                "WM_QOS.CORRELATION_ID": self.connection.id or "ardent-probe",
            },
            data={"grant_type": "client_credentials"},
        )
        token = http.json_of(resp, "Walmart").get("access_token")
        if not token:
            raise http.ConnectorAuthError("Walmart did not issue an access token for these credentials")
        return {
            "WM_SEC.ACCESS_TOKEN": token,
            "WM_QOS.CORRELATION_ID": self.connection.id or "ardent-sync",
            "WM_SVC.NAME": "Walmart Marketplace",
            "Accept": "application/json",
        }

    def _get(self, params, headers):
        resp = http.request("GET", ORDERS_URL, platform="Walmart", params=params, headers=headers)
        return http.json_of(resp, "Walmart")

    def test_connection(self):
        headers = self._headers()
        self._get({"limit": 1}, headers)
        return {"account_id": self.credentials["client_id"], "display_name": "Walmart Marketplace"}

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id
        orders = 0

        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            headers = self._headers()  # a fresh token per chunk; the old one may be 15 minutes stale
            cursor_token = None
            while True:
                params = {"limit": PAGE, "createdStartDate": _iso(cursor), "createdEndDate": _iso(chunk_end)}
                if cursor_token:
                    params = {"nextCursor": cursor_token}
                body = self._get(params, headers)
                listing = (body.get("list") or {})
                for node in ((listing.get("elements") or {}).get("order")) or []:
                    self._upsert_order(node)
                    orders += 1
                db.session.commit()
                cursor_token = (listing.get("meta") or {}).get("nextCursor")
                if not cursor_token:
                    break
            cursor = chunk_end

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": orders, "records_synced": orders,
                "incremental": since is not None}

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        order_date = _time(node.get("orderDate")) or datetime.now(timezone.utc)

        lines, cancelled_flags = [], []
        shipping_total = tax_total = 0.0
        statuses = set()
        for wrapper in ((node.get("orderLines") or {}).get("orderLine")) or []:
            item = wrapper.get("item") or {}
            qty = int((wrapper.get("orderLineQuantity") or {}).get("amount") or 0)
            charges = {c.get("chargeType"): _num((c.get("chargeAmount") or {}).get("amount"))
                      for c in (wrapper.get("charges") or {}).get("charge") or []}
            gross = charges.get("PRODUCT", 0.0)
            shipping_total += charges.get("SHIPPING", 0.0)
            tax_total += charges.get("TAX", 0.0)

            line_status = ((wrapper.get("orderLineStatuses") or [{}])[-1] or {}).get("status", "Created")
            statuses.add(line_status)
            cancelled_here = line_status == "Cancelled"
            refunded_here = line_status == "Refund"

            sku = item.get("sku")
            known = catalogue_for(brand_id, sku)
            lines.append({
                "external_line_id": wrapper.get("lineNumber"),
                "sku": sku,
                "product_name": known.get("product_name") or item.get("productName") or sku,
                "product_external_id": known.get("product_external_id") or f"walmart:{sku}",
                "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                "variant_title": known.get("variant_title"),
                "category": known.get("category"),
                "subcategory": known.get("subcategory"),
                "quantity": qty,
                "unit_price": (gross / qty) if qty else gross,
                "unit_cost": known.get("unit_cost"),
                "returned_amount": gross if refunded_here else 0.0,
                "returned_quantity": qty if refunded_here else 0,
            })
            cancelled_flags.append(cancelled_here)

        # A cancelled Walmart line is booked then reversed rather than simply
        # absent from the response, so it is dropped unless every line was
        # cancelled — in which case the whole order is kept, marked cancelled,
        # so it still nets to zero rather than vanishing.
        whole_order_cancelled = bool(lines) and all(cancelled_flags)
        live_lines = [li for li, cancelled in zip(lines, cancelled_flags) if not cancelled]

        upsert_order(
            brand_id, "walmart", node["purchaseOrderId"],
            order_name=node.get("customerOrderId") or node["purchaseOrderId"],
            order_date=order_date,
            lines=lines if whole_order_cancelled else live_lines,
            currency="USD",
            status="delivered" if statuses == {"Delivered"} else
                  "shipped" if statuses & {"Shipped", "Delivered"} else "placed",
            is_cancelled=whole_order_cancelled,
            shipping=shipping_total,
            tax=tax_total,
            marketplace_fee=None,  # not on the order; only in Walmart's settlement reports
        )
