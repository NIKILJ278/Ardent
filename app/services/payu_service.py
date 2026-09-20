"""PayU (India): transactions with their fees and settlement references.

PayU's reporting call is a form post signed with the merchant salt:
hash = sha512(key|command|var1|salt). Dates are sent as YYYY-MM-DD and returned
in India time. The merchant key and salt come from the PayU dashboard under
Developers → API Keys.
"""
import hashlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import upsert_payment

ENDPOINTS = {
    "production": "https://info.payu.in/merchant/postservice.php?form=2",
    "test": "https://test.payu.in/merchant/postservice.php?form=2",
}
COMMAND = "get_Transaction_Details"
IST = ZoneInfo("Asia/Kolkata")
# PayU does not document a maximum range; short windows keep each response
# small and a failure cheap to retry.
CHUNK = timedelta(days=7)


def _num(value):
    try:
        return float(value) if value not in (None, "", "NA") else None
    except (TypeError, ValueError):
        return None


def _ist(value):
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=IST).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


class PayUConnector(BaseConnector):
    platform_name = "payu"

    def _call(self, var1, var2):
        c = self.credentials
        key, salt = c.get("merchant_key"), c.get("salt")
        if not key or not salt:
            raise http.ConnectorAuthError("Enter both the PayU merchant key and salt")
        digest = hashlib.sha512(f"{key}|{COMMAND}|{var1}|{salt}".encode()).hexdigest()
        url = ENDPOINTS.get(c.get("environment") or "production", ENDPOINTS["production"])
        resp = http.request("POST", url, platform="PayU", data={
            "key": key, "command": COMMAND, "var1": var1, "var2": var2, "hash": digest,
        })
        body = http.json_of(resp, "PayU")
        msg = str(body.get("msg") or "")
        if str(body.get("status")) != "1":
            lowered = msg.lower()
            if "hash" in lowered or "key" in lowered or "unauthor" in lowered:
                raise http.ConnectorAuthError(f"PayU rejected the key or salt: {msg}")
            if "no record" in lowered or "not found" in lowered:
                return []
            raise http.ConnectorError(f"PayU returned an error: {msg or 'unknown'}")
        rows = body.get("Transaction_details") or []
        return list(rows.values()) if isinstance(rows, dict) else rows

    def test_connection(self):
        today = datetime.now(IST).date().isoformat()
        self._call(today, today)
        env = self.credentials.get("environment") or "production"
        return {"account_id": self.credentials["merchant_key"],
                "display_name": f"PayU ({env})"}

    def sync(self, since=None):
        start = self.window_start(since).astimezone(IST).date()
        end = datetime.now(IST).date()
        brand_id = self.connection.brand_id
        count = 0

        cursor = start
        while cursor <= end:
            chunk_end = min(cursor + CHUNK - timedelta(days=1), end)
            for t in self._call(cursor.isoformat(), chunk_end.isoformat()):
                external = t.get("id") or t.get("mihpayid") or t.get("txnid")
                if not external:
                    continue
                fee = _num(t.get("transaction_fee"))
                extra = _num(t.get("additional_charges"))
                upsert_payment(
                    brand_id, "payu", external,
                    order_ref=t.get("txnid"),
                    status=(t.get("status") or "").lower() or None,
                    method=(t.get("mode") or "").lower() or None,
                    currency="INR",
                    amount=_num(t.get("amount")) or 0.0,
                    # Additional charges are what PayU levied on top; both are
                    # a cost of collection.
                    fee=None if fee is None and extra is None else (fee or 0.0) + (extra or 0.0),
                    tax=None,
                    refunded=0.0,
                    settlement_ref=t.get("settlement_id") or t.get("UTR_no"),
                    occurred_at=_ist(t.get("addedon")) or datetime.now(timezone.utc),
                )
                count += 1
            db.session.commit()
            cursor = chunk_end + timedelta(days=1)

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "payments": count,
                "records_synced": count, "incremental": since is not None}
