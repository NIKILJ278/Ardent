"""Cashfree Payments: payments, refunds and settlements from settlement recon.

Cashfree has no "list every payment" call, but its settlement reconciliation
API returns every settled event — payments and refunds — with the charges
deducted and the settlement they landed in. That is exactly what a finance view
needs. Payments not yet settled appear once they settle.

Credentials are the App ID and Secret Key from Developers → API Keys.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import current_app

from app.extensions import db
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import upsert_payment, upsert_settlement

HOSTS = {"production": "https://api.cashfree.com", "sandbox": "https://sandbox.cashfree.com"}
IST = ZoneInfo("Asia/Kolkata")
PAGE = 50
CHUNK = timedelta(days=15)


def _num(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _time(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=IST)).astimezone(timezone.utc)


class CashfreeConnector(BaseConnector):
    platform_name = "cashfree"

    def _post(self, body):
        c = self.credentials
        if not c.get("client_id") or not c.get("client_secret"):
            raise http.ConnectorAuthError("Enter both the Cashfree App ID and Secret Key")
        host = HOSTS.get(c.get("environment") or "production", HOSTS["production"])
        resp = http.request(
            "POST", f"{host}/pg/settlement/recon", platform="Cashfree", json=body,
            headers={
                "x-client-id": c["client_id"],
                "x-client-secret": c["client_secret"],
                "x-api-version": current_app.config.get("CASHFREE_API_VERSION", "2026-01-01"),
                "Accept": "application/json",
            },
        )
        return http.json_of(resp, "Cashfree")

    def _events(self, start, end):
        cursor = None
        while True:
            body = self._post({
                "pagination": {"limit": PAGE, "cursor": cursor},
                "filters": {
                    "start_date_processed_on": start.astimezone(IST).isoformat(timespec="seconds"),
                    "end_date_processed_on": end.astimezone(IST).isoformat(timespec="seconds"),
                },
            })
            yield from body.get("data") or []
            cursor = body.get("cursor")
            if not cursor or not body.get("data"):
                return

    def test_connection(self):
        now = datetime.now(timezone.utc)
        self._post({
            "pagination": {"limit": 1, "cursor": None},
            "filters": {
                "start_date_processed_on": (now - timedelta(days=1)).astimezone(IST).isoformat(timespec="seconds"),
                "end_date_processed_on": now.astimezone(IST).isoformat(timespec="seconds"),
            },
        })
        env = self.credentials.get("environment") or "production"
        return {"account_id": self.credentials["client_id"], "display_name": f"Cashfree ({env})"}

    def sync(self, since=None):
        start = self.window_start(since)
        end = datetime.now(timezone.utc)
        brand_id = self.connection.brand_id
        payments = refunds = 0
        settlements = {}

        cursor = start
        while cursor < end:
            chunk_end = min(cursor + CHUNK, end)
            for rec in self._events(cursor, chunk_end):
                ev = rec.get("event_details") or {}
                pay = rec.get("payment_details") or {}
                order = rec.get("order_details") or {}
                setl = rec.get("settlement_details") or {}
                kind = (ev.get("event_type") or "").upper()
                charge = _num(ev.get("event_service_charge"))
                tax = _num(ev.get("event_service_tax"))
                fee = None if charge is None and tax is None else (charge or 0.0) + (tax or 0.0)
                settlement_id = setl.get("cf_settlement_id")

                if kind == "PAYMENT":
                    upsert_payment(
                        brand_id, "cashfree", pay.get("cf_payment_id") or ev.get("event_id"),
                        order_ref=order.get("order_id"),
                        status="captured",
                        method=(pay.get("payment_group") or "").lower() or None,
                        currency=ev.get("event_currency") or "INR",
                        amount=_num(ev.get("event_amount")) or 0.0,
                        fee=fee, tax=tax, refunded=0.0,
                        settlement_ref=settlement_id,
                        occurred_at=_time(pay.get("payment_time") or ev.get("event_time")) or end,
                    )
                    payments += 1
                elif kind == "REFUND":
                    # Kept as its own row so a refund spread across sync windows
                    # is never double-counted onto the payment.
                    upsert_payment(
                        brand_id, "cashfree", f"refund:{ev.get('event_id')}",
                        order_ref=order.get("order_id"),
                        status="refund",
                        currency=ev.get("event_currency") or "INR",
                        amount=0.0,
                        fee=fee, tax=tax,
                        refunded=abs(_num(ev.get("event_amount")) or 0.0),
                        settlement_ref=settlement_id,
                        occurred_at=_time(ev.get("event_time")) or end,
                    )
                    refunds += 1

                if settlement_id:
                    agg = settlements.setdefault(settlement_id, {
                        "amount": 0.0, "fees": 0.0, "tax": 0.0, "stated": None,
                        "utr": setl.get("settlement_utr"), "at": _time(setl.get("settlement_date")),
                    })
                    agg["amount"] += _num(ev.get("event_settlement_amount")) or 0.0
                    agg["fees"] += charge or 0.0
                    agg["tax"] += tax or 0.0
                    if _num(setl.get("amount_settled")) is not None:
                        agg["stated"] = _num(setl.get("amount_settled"))
            db.session.commit()
            cursor = chunk_end

        for settlement_id, agg in settlements.items():
            upsert_settlement(
                brand_id, "cashfree", settlement_id, status="processed", currency="INR",
                # Cashfree's own settled figure wins; the event sum is a fallback.
                amount=agg["stated"] if agg["stated"] is not None else agg["amount"],
                fees=agg["fees"], tax=agg["tax"], utr=agg["utr"], settled_at=agg["at"],
            )

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "payments": payments, "refunds": refunds,
                "settlements": len(settlements), "records_synced": payments + refunds,
                "incremental": since is not None}
