"""Stripe: charges with their fees, refunds and payouts.

Read from balance transactions, which is where Stripe states the fee and net of
every movement of money. A restricted key with read access to Balance and
Payouts is enough; a full secret key also works.
"""
from datetime import datetime, timezone

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import upsert_payment, upsert_settlement

API = "https://api.stripe.com/v1"
PAGE = 100

# Stripe's zero-decimal currencies: amounts are already in whole units.
_ZERO_DECIMAL = {"BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
                 "UGX", "VND", "VUV", "XAF", "XOF", "XPF"}
_THREE_DECIMAL = {"BHD", "JOD", "KWD", "OMR", "TND"}

PAYMENT_TYPES = {"charge", "payment"}
REFUND_TYPES = {"refund", "payment_refund"}


def major(amount, currency):
    if amount is None:
        return None
    code = (currency or "").upper()
    if code in _ZERO_DECIMAL:
        return float(amount)
    if code in _THREE_DECIMAL:
        return float(amount) / 1000
    return float(amount) / 100


def _ts(value):
    return datetime.fromtimestamp(int(value), tz=timezone.utc) if value else None


class StripeConnector(BaseConnector):
    platform_name = "stripe"

    def _key(self):
        key = self.credentials.get("secret_key")
        if not key:
            raise http.ConnectorAuthError("Enter a Stripe secret or restricted key")
        return key

    def _get(self, path, params=None):
        resp = http.request("GET", f"{API}{path}", platform="Stripe",
                            headers={"Authorization": f"Bearer {self._key()}"}, params=params)
        return http.json_of(resp, "Stripe")

    def _list(self, path, since):
        after = None
        while True:
            params = {"limit": PAGE, "created[gte]": int(since.timestamp())}
            if after:
                params["starting_after"] = after
            page = self._get(path, params)
            items = page.get("data") or []
            yield from items
            if not page.get("has_more") or not items:
                return
            after = items[-1]["id"]

    def test_connection(self):
        key = self._key()
        self._get("/balance")
        mode = "live" if "_live_" in key else "test" if "_test_" in key else "unknown"
        return {"account_id": f"{key[:8]}…{key[-4:]}", "display_name": f"Stripe ({mode} mode)", "mode": mode}

    def sync(self, since=None):
        start = self.window_start(since)
        brand_id = self.connection.brand_id
        payments = refunds = 0

        for t in self._list("/balance_transactions", start):
            kind = t.get("type")
            currency = (t.get("currency") or "").upper()
            source = t.get("source")
            if kind in PAYMENT_TYPES:
                upsert_payment(
                    brand_id, "stripe", source or t["id"],
                    status=t.get("status"),
                    method=None,
                    currency=currency,
                    amount=major(t.get("amount"), currency) or 0.0,
                    fee=major(t.get("fee"), currency),
                    tax=None,
                    refunded=0.0,
                    settlement_ref=None,
                    occurred_at=_ts(t.get("created")) or datetime.now(timezone.utc),
                )
                payments += 1
            elif kind in REFUND_TYPES:
                upsert_payment(
                    brand_id, "stripe", f"refund:{t['id']}",
                    status="refund",
                    currency=currency,
                    amount=0.0,
                    fee=major(t.get("fee"), currency),
                    refunded=abs(major(t.get("amount"), currency) or 0.0),
                    occurred_at=_ts(t.get("created")) or datetime.now(timezone.utc),
                )
                refunds += 1
        db.session.commit()

        payouts = 0
        for p in self._list("/payouts", start):
            currency = (p.get("currency") or "").upper()
            upsert_settlement(
                brand_id, "stripe", p["id"],
                status=p.get("status"),
                currency=currency,
                amount=major(p.get("amount"), currency) or 0.0,
                fees=None, tax=None,
                utr=p.get("trace_id", {}).get("value") if isinstance(p.get("trace_id"), dict) else None,
                settled_at=_ts(p.get("arrival_date")),
            )
            payouts += 1

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "payments": payments, "refunds": refunds,
                "settlements": payouts, "records_synced": payments + refunds + payouts,
                "incremental": since is not None}
