"""Shiprocket: shipments, what each cost to ship, and which came back (RTO).

Shiprocket authenticates an API user by email and password and returns a token
valid for ten days. Create that user in Shiprocket under Settings → API →
Configure; it is separate from your normal login.

The order list carries status and courier but not charges, so each shipped
order's detail is read for its freight, COD and return-to-origin charges. Each
parcel is then matched to its storefront or marketplace order by the order
number Shiprocket stores, which is what puts a courier cost against a sale.
"""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.extensions import db
from app.models import Shipment
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import link_shipment, upsert_shipment

API = "https://apiv2.shiprocket.in/v1/external"
IST = ZoneInfo("Asia/Kolkata")
PAGE = 50
CHUNK = timedelta(days=30)
TOKEN_LIFETIME = timedelta(days=9)  # Shiprocket issues 10; refresh a day early
_EMPTY_DATES = {"", "0000-00-00 00:00:00", "0000-00-00", "NA", None}


def _num(value):
    try:
        return float(value) if value not in (None, "", "NA") else None
    except (TypeError, ValueError):
        return None


def parse_time(value):
    """Shiprocket writes dates several ways: '31 Jul 2019, 03:03 PM',
    '28th Aug 2018 07:11 PM', '2022-09-21 17:28:00'. All are India time."""
    if value in _EMPTY_DATES:
        return None
    text = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", str(value)).replace(",", "").strip()
    for fmt in ("%d %b %Y %I:%M %p", "%Y-%m-%d %H:%M:%S", "%d %b %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=IST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _first(value):
    """Shiprocket returns `shipments` as a list in listings and a dict in detail."""
    if isinstance(value, list):
        return value[0] if value else {}
    return value or {}


class ShiprocketConnector(BaseConnector):
    platform_name = "shiprocket"
    # Parcels keep changing state for weeks after dispatch, so every sync
    # re-reads orders from the last 45 days.
    OVERLAP = timedelta(days=45)

    # Auth ---------------------------------------------------------------------

    def _login(self):
        c = self.credentials
        if not c.get("email") or not c.get("password"):
            raise http.ConnectorAuthError("Enter the Shiprocket API user's email and password")
        resp = http.request("POST", f"{API}/auth/login", platform="Shiprocket",
                            json={"email": c["email"], "password": c["password"]},
                            auth_statuses=(400, 401, 403))
        token = http.json_of(resp, "Shiprocket").get("token")
        if not token:
            raise http.ConnectorAuthError("Shiprocket did not return a token for this API user")
        expires = (datetime.now(timezone.utc) + TOKEN_LIFETIME).isoformat()
        self.remember(_token=token, _token_expires=expires)
        return token

    def _token(self):
        c = self.credentials
        expires = c.get("_token_expires")
        if c.get("_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_token"]
        return self._login()

    def _get(self, path, params=None, retried=False):
        try:
            resp = http.request("GET", f"{API}{path}", platform="Shiprocket", params=params,
                                headers={"Authorization": f"Bearer {self._token()}"})
        except http.ConnectorAuthError:
            if retried:
                raise
            # A cached token can be revoked early; log in once more and retry.
            self.remember(_token=None, _token_expires=None)
            return self._get(path, params, retried=True)
        return http.json_of(resp, "Shiprocket")

    def test_connection(self):
        self._login()
        self._get("/orders", {"per_page": 1})
        return {"account_id": self.credentials["email"], "display_name": f"Shiprocket · {self.credentials['email']}"}

    # Sync ---------------------------------------------------------------------

    def _orders(self, start, end):
        page = 1
        while True:
            body = self._get("/orders", {
                "page": page, "per_page": PAGE,
                "from": start.astimezone(IST).date().isoformat(),
                "to": end.astimezone(IST).date().isoformat(),
            })
            yield from body.get("data") or []
            info = ((body.get("meta") or {}).get("pagination")) or {}
            if page >= int(info.get("total_pages") or 1):
                return
            page += 1

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id
        seen = matched = detailed = 0

        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            for order in self._orders(cursor, chunk_end):
                listed = _first(order.get("shipments"))
                external = str(listed.get("id") or order.get("id"))
                existing = Shipment.query.filter_by(
                    brand_id=brand_id, provider="shiprocket", external_id=external,
                ).first()

                # Detail costs one call per order, so only read it when there is
                # something new to learn: a parcel with an AWB that is not yet
                # billed, or whose status has moved.
                status = order.get("status")
                needs_detail = bool(listed.get("awb")) and (
                    existing is None or existing.freight is None or existing.status != status
                )
                detail = {}
                if needs_detail:
                    detail = self._get(f"/orders/show/{order['id']}").get("data") or {}
                    detailed += 1

                ship = _first(detail.get("shipments")) or listed
                charges = ((detail.get("awb_data") or {}).get("charges")) or {}
                rto_date = ship.get("rto_delivered_date") or listed.get("rto_delivered_date")
                is_rto = bool(ship.get("is_rto")) or "RTO" in (status or "").upper() or rto_date not in _EMPTY_DATES

                fields = dict(
                    channel_order_ref=order.get("channel_order_id"),
                    awb=ship.get("awb") or listed.get("awb") or None,
                    courier=ship.get("courier") or listed.get("courier") or None,
                    status=status,
                    payment_method=(order.get("payment_method") or "").lower() or None,
                    destination_state=detail.get("customer_state") or order.get("customer_state"),
                    is_rto=is_rto,
                    shipped_at=parse_time(ship.get("shipped_date")),
                    delivered_at=parse_time(ship.get("delivered_date") or listed.get("delivered_date")),
                    created_on=parse_time(order.get("created_at")),
                )
                if needs_detail:
                    # Only a detail read carries charges; never blank a known cost.
                    fields.update(
                        freight=_num(charges.get("freight_charges")),
                        cod_charges=_num(charges.get("cod_charges")) or _num(ship.get("cod_charges")),
                        rto_freight=_num(charges.get("charged_weight_amount_rto")) if is_rto else 0.0,
                    )
                shipment = upsert_shipment(brand_id, "shiprocket", external, **fields)
                db.session.flush()
                if link_shipment(shipment):
                    matched += 1
                seen += 1
            db.session.commit()
            cursor = chunk_end

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "shipments": seen, "matched_to_orders": matched,
                "detail_reads": detailed, "records_synced": seen, "incremental": since is not None}
