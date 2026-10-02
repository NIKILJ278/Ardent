"""Amazon Selling Partner API: orders and the fees Amazon deducted.

Authentication is Login with Amazon: a refresh token plus the app's client ID
and secret, exchanged for a one-hour access token sent as `x-amz-access-token`.
A seller registers a private SP-API app in Seller Central → Apps and Services →
Develop Apps, authorises it, and gets all three from there. India is served by
the Europe endpoint.

Orders come from Orders API v2026-01-01 (v0 is deprecated), fees from Finances
API v2024-06-19. Orders are limited to about one page every three minutes after
a burst of twenty, so a large first sync stops when throttled and the next sync
continues from the same page instead of starting over.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from app.extensions import db
from app.models import Order, PaymentTransaction
from app.services import http
from app.services.base_connector import BaseConnector
from app.services.writers import catalogue_for, upsert_order, upsert_payment

LWA_URL = "https://api.amazon.com/auth/o2/token"
HOSTS = {
    "eu": "https://sellingpartnerapi-eu.amazon.com",  # India, UK, EU, Middle East
    "na": "https://sellingpartnerapi-na.amazon.com",
    "fe": "https://sellingpartnerapi-fe.amazon.com",
}
INDIA = "A21TJRUUN4KGV"
PAGE = 100
INCLUDED = "PROCEEDS,PROMOTION,CANCELLATION,FULFILLMENT,TAX"


def _money(block):
    try:
        return float((block or {}).get("amount"))
    except (TypeError, ValueError):
        return None


def _time(value):
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _breakdown(proceeds, kind):
    """Sum of one proceeds category, e.g. ITEM or DISCOUNT, or None if absent."""
    total, found = 0.0, False
    for b in (proceeds or {}).get("breakdowns") or []:
        if (b.get("type") or "").upper() == kind:
            value = _money(b.get("subtotal"))
            if value is not None:
                total += value
                found = True
    return total if found else None


def fee_from_transaction(txn):
    """What Amazon charged in one finance transaction, as a positive number.

    Fees sit under breakdowns named for expenses or fees (referral, closing,
    FBA, shipping). They are negative when charged and positive when reversed,
    so a refunded fee nets back out.
    """
    total = 0.0
    for b in txn.get("breakdowns") or []:
        name = (b.get("breakdownType") or "").lower()
        if "expense" in name or "fee" in name:
            amount = (b.get("breakdownAmount") or {}).get("currencyAmount")
            try:
                total += float(amount)
            except (TypeError, ValueError):
                continue
    return -total


def _related(txn, needle):
    for rid in txn.get("relatedIdentifiers") or []:
        if needle in (rid.get("relatedIdentifierName") or "").upper():
            return rid.get("relatedIdentifierValue")
    return None


class AmazonConnector(BaseConnector):
    platform_name = "amazon"

    # Auth ---------------------------------------------------------------------

    def _host(self):
        return HOSTS.get(self.credentials.get("region") or "eu", HOSTS["eu"])

    def _marketplace(self):
        return self.credentials.get("marketplace_id") or INDIA

    def _access_token(self):
        c = self.credentials
        expires = c.get("_access_expires")
        if c.get("_access_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_access_token"]
        missing = [k for k in ("refresh_token", "client_id", "client_secret") if not c.get(k)]
        if missing:
            raise http.ConnectorAuthError(f"Enter the Amazon {', '.join(missing).replace('_', ' ')}")
        resp = http.request("POST", LWA_URL, platform="Amazon", auth_statuses=(400, 401, 403), data={
            "grant_type": "refresh_token",
            "refresh_token": c["refresh_token"],
            "client_id": c["client_id"],
            "client_secret": c["client_secret"],
        })
        body = http.json_of(resp, "Amazon")
        token = body.get("access_token")
        if not token:
            raise http.ConnectorAuthError("Amazon did not issue an access token for these credentials")
        # A minute early, so a token never expires mid-request.
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
        self.remember(_access_token=token, _access_expires=expires_at.isoformat())
        return token

    def _get(self, path, params, attempts=3):
        resp = http.request("GET", f"{self._host()}{path}", platform="Amazon", params=params,
                            attempts=attempts, headers={"x-amz-access-token": self._access_token()})
        return http.json_of(resp, "Amazon")

    def test_connection(self):
        body = self._get("/sellers/v1/marketplaceParticipations", None)
        rows = body.get("payload") or []
        mine = next((r for r in rows if (r.get("marketplace") or {}).get("id") == self._marketplace()), None)
        if rows and mine is None:
            raise http.ConnectorError(
                f"This seller account does not sell in marketplace {self._marketplace()}"
            )
        store = ((mine or {}).get("storeName")) or ((mine or {}).get("marketplace") or {}).get("name") or "Amazon"
        return {"account_id": self.credentials["client_id"], "display_name": f"Amazon · {store}",
                "marketplace": self._marketplace()}

    # Sync ---------------------------------------------------------------------

    def sync(self, since=None):
        brand_id = self.connection.brand_id
        meta = dict(self.connection.meta or {})
        resume = meta.get("amazon_resume") or {}

        start = datetime.fromisoformat(resume["start"]) if resume.get("start") else self.window_start(since)
        # Amazon refuses a window ending less than two minutes ago.
        end = datetime.fromisoformat(resume["end"]) if resume.get("end") else \
            datetime.now(timezone.utc) - timedelta(minutes=3)
        token = resume.get("token")

        orders = 0
        partial = False
        while True:
            params = {
                "marketplaceIds": self._marketplace(),
                "lastUpdatedAfter": _iso(start),
                "lastUpdatedBefore": _iso(end),
                "includedData": INCLUDED,
                "maxResultsPerPage": PAGE,
            }
            if token:
                params["paginationToken"] = token
            try:
                body = self._get("/orders/2026-01-01/orders", params)
            except http.ConnectorRateLimited:
                partial = True
                break
            for node in body.get("orders") or []:
                self._upsert_order(node)
                orders += 1
            db.session.commit()
            token = (body.get("pagination") or {}).get("nextToken")
            # Saved after every page, so a throttle or a crash loses nothing.
            meta["amazon_resume"] = {"start": start.isoformat(), "end": end.isoformat(), "token": token} \
                if token else {}
            self.connection.meta = dict(meta)
            db.session.commit()
            if not token:
                break

        fees = 0
        if not partial:
            try:
                fees = self._sync_fees(self.window_start(since), end)
            except http.ConnectorRateLimited:
                partial = True

        if partial:
            self.connection.status = "connected"
            self.connection.last_error = "Amazon is throttling; the next sync continues where this one stopped."
        else:
            meta.pop("amazon_resume", None)
            self.connection.meta = dict(meta)
            self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "orders": orders, "fee_transactions": fees,
                "records_synced": orders, "partial": partial, "incremental": since is not None}

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        fulfillment = node.get("fulfillment") or {}
        status = (fulfillment.get("fulfillmentStatus") or "PENDING").upper()
        currency = None
        lines = []
        order_discount = 0.0
        tax = 0.0

        for item in node.get("orderItems") or []:
            product = item.get("product") or {}
            qty = int(item.get("quantityOrdered") or 0)
            unit_block = (product.get("price") or {}).get("unitPrice") or {}
            currency = currency or unit_block.get("currencyCode")
            unit = _money(unit_block)
            item_total = _breakdown(item.get("proceeds"), "ITEM")
            if unit is None and item_total is not None and qty:
                unit = item_total / qty
            discount = _breakdown(item.get("proceeds"), "DISCOUNT")
            tax += abs(_breakdown(item.get("proceeds"), "TAX") or 0.0)

            sku = product.get("sellerSku") or product.get("asin")
            known = catalogue_for(brand_id, sku)
            lines.append({
                "external_line_id": item.get("orderItemId"),
                "sku": sku,
                "product_name": known.get("product_name") or product.get("title"),
                # Same SKU as the storefront means the same product in Ardent.
                "product_external_id": known.get("product_external_id") or f"asin:{product.get('asin')}",
                "variant_external_id": known.get("variant_external_id") or f"sku:{sku}",
                "variant_title": known.get("variant_title"),
                "category": known.get("category"),
                "subcategory": known.get("subcategory"),
                "quantity": qty,
                "unit_price": unit or 0.0,
                "unit_cost": known.get("unit_cost"),
                "discount": abs(discount or 0.0),
            })

        order = upsert_order(
            brand_id, "amazon", node["orderId"],
            order_name=node["orderId"],
            order_date=_time(node.get("createdTime")) or datetime.now(timezone.utc),
            lines=lines,
            currency=currency,
            status=status.lower(),
            is_cancelled=status == "CANCELLED",
            discount=order_discount,
            tax=tax,
            marketplace_fee=self._known_fee(node["orderId"]),
        )
        order.courier = "Amazon (FBA)" if (fulfillment.get("fulfilledBy") or "").upper() == "AMAZON" else order.courier
        return order

    def _known_fee(self, order_id):
        rows = PaymentTransaction.query.filter_by(
            brand_id=self.connection.brand_id, gateway="amazon", order_ref=order_id,
        ).all()
        return sum(r.fee or 0.0 for r in rows) if rows else None

    def _sync_fees(self, start, end):
        """Record each finance transaction, then total the fees per order."""
        brand_id = self.connection.brand_id
        touched = set()
        count = 0
        token = None
        while True:
            params = {"postedAfter": _iso(start), "postedBefore": _iso(end),
                      "marketplaceId": self._marketplace()}
            if token:
                params["nextToken"] = token
            payload = (self._get("/finances/2024-06-19/transactions", params) or {}).get("payload") or {}
            for txn in payload.get("transactions") or []:
                order_id = _related(txn, "ORDER")
                if not order_id or not txn.get("transactionId"):
                    continue
                total = (txn.get("totalAmount") or {}).get("currencyAmount")
                upsert_payment(
                    brand_id, "amazon", txn["transactionId"],
                    order_ref=order_id,
                    status=(txn.get("transactionStatus") or "").lower() or None,
                    method=(txn.get("description") or "")[:40] or None,
                    currency=(txn.get("totalAmount") or {}).get("currencyCode"),
                    amount=float(total) if total is not None else 0.0,
                    fee=fee_from_transaction(txn),
                    settlement_ref=_related(txn, "FINANCIAL_EVENT_GROUP"),
                    occurred_at=_time(txn.get("postedDate")) or end,
                )
                touched.add(order_id)
                count += 1
            db.session.commit()
            token = payload.get("nextToken")
            if not token:
                break

        # An order's fee is every transaction against it, not just this window's.
        totals = defaultdict(float)
        for row in PaymentTransaction.query.filter(
            PaymentTransaction.brand_id == brand_id,
            PaymentTransaction.gateway == "amazon",
            PaymentTransaction.order_ref.in_(touched),
        ).all():
            totals[row.order_ref] += row.fee or 0.0
        for order in Order.query.filter(
            Order.brand_id == brand_id, Order.channel == "amazon",
            Order.external_order_id.in_(touched),
        ).all():
            order.marketplace_fee_amount = totals[order.external_order_id]
            order.marketplace_fee_known = True
        db.session.commit()
        return count
