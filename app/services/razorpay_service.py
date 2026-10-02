"""Razorpay: payments, their fees, refunds and settlements.

Basic auth with the key ID and key secret from Dashboard → Account & Settings →
API Keys. Amounts arrive in the currency's smallest unit (paise for rupees) and
timestamps in Unix seconds.
"""
from datetime import datetime, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import upsert_payment, upsert_settlement

API = "https://api.razorpay.com/v1"
PAGE = 100  # Razorpay's maximum `count`

# Currencies whose smallest unit is not a hundredth. Razorpay follows ISO 4217.
_EXPONENT = {"JPY": 0, "KRW": 0, "VND": 0, "CLP": 0, "BHD": 3, "KWD": 3, "OMR": 3, "JOD": 3, "TND": 3}


def major(amount, currency):
    if amount is None:
        return None
    return float(amount) / (10 ** _EXPONENT.get((currency or "INR").upper(), 2))


def _ts(value):
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None


class RazorpayConnector(BaseConnector):
    platform_name = "razorpay"

    def _auth(self):
        c = self.credentials
        if not c.get("key_id") or not c.get("key_secret"):
            raise http.ConnectorAuthError("Enter both the Razorpay key ID and key secret")
        return c["key_id"], c["key_secret"]

    def _get(self, path, params=None):
        resp = http.request("GET", f"{API}{path}", platform="Razorpay", auth=self._auth(), params=params)
        return http.json_of(resp, "Razorpay")

    def _pages(self, path, start, end):
        skip = 0
        while True:
            data = self._get(path, {
                "from": int(start.timestamp()), "to": int(end.timestamp()),
                "count": PAGE, "skip": skip,
            })
            items = data.get("items") or []
            yield from items
            if len(items) < PAGE:
                return
            skip += PAGE

    def test_connection(self):
        key_id, _ = self._auth()
        self._get("/payments", {"count": 1})
        mode = "live" if key_id.startswith("rzp_live_") else "test" if key_id.startswith("rzp_test_") else "unknown"
        return {"account_id": key_id, "display_name": f"Razorpay ({mode} mode)", "mode": mode}

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id

        payments = 0
        for p in self._pages("/payments", start, end):
            currency = p.get("currency")
            upsert_payment(
                brand_id, "razorpay", p["id"],
                order_ref=p.get("order_id"),
                status=p.get("status"),
                method=p.get("method"),
                currency=currency,
                amount=major(p.get("amount"), currency) or 0.0,
                # Razorpay's fee already includes GST; `tax` is that GST.
                fee=major(p.get("fee"), currency),
                tax=major(p.get("tax"), currency),
                refunded=major(p.get("amount_refunded"), currency) or 0.0,
                occurred_at=_ts(p.get("created_at")) or end,
            )
            payments += 1
        db.session.commit()

        settlements = 0
        for s in self._pages("/settlements", start, end):
            upsert_settlement(
                brand_id, "razorpay", s["id"],
                status=s.get("status"),
                currency="INR",
                amount=major(s.get("amount"), "INR") or 0.0,
                fees=major(s.get("fees"), "INR"),
                tax=major(s.get("tax"), "INR"),
                utr=s.get("utr"),
                settled_at=_ts(s.get("created_at")),
            )
            settlements += 1

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "payments": payments, "settlements": settlements,
                "records_synced": payments + settlements, "incremental": since is not None}
