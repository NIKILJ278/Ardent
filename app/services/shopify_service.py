"""Shopify connector.

Installs through Shopify's OAuth authorization-code grant and syncs orders over
the GraphQL Admin API. REST is legacy on Shopify, so everything here speaks
GraphQL.

Money is read in shop currency (`shopMoney`), so a storefront that sells in
several currencies still reconciles to the merchant's own books.

Three ways to hold a token:

- OAuth install: the store approves the app and the offline token is kept on
  the connection (the original flow, unchanged).
- Client ID and secret typed into the dashboard: exchanged with the client
  credentials grant for a 24-hour token, renewed automatically. Shopify only
  allows this when the app and the store belong to the same organization.
- An Admin API access token (`shpat_…`) from an existing custom app.
"""
import hashlib
import hmac
import re
import time
from datetime import datetime, timezone

import requests
from flask import current_app

from app.extensions import db
from app.models import Order, OrderItem, ReturnRecord
from app.services import http
from app.services.base_connector import BaseConnector


class ShopifyError(Exception):
    """Shopify answered, but not with data we can use."""


class ShopifyAuthError(ShopifyError):
    """The stored token no longer works; the store must be reconnected."""


class ShopifyCostError(ShopifyError):
    """A single query asked for more than Shopify's per-query cost ceiling."""


# ── Install safety ───────────────────────────────────────────────────────

_SHOP_DOMAIN = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


def normalise_shop(raw):
    """Turn whatever the user typed into `store.myshopify.com`, or None.

    Accepts a bare handle, a full admin URL or the domain itself. Anything that
    does not resolve to a myshopify.com host is refused, because the domain is
    interpolated into the URL the access token is sent to.
    """
    if not raw:
        return None
    shop = raw.strip().lower()
    shop = re.sub(r"^https?://", "", shop).split("/")[0]
    if "." not in shop:
        shop = f"{shop}.myshopify.com"
    return shop if _SHOP_DOMAIN.match(shop) else None


def verify_callback_hmac(params, secret):
    """Check Shopify signed this redirect.

    Without this, anyone could hit the callback with a forged `code` and `shop`
    and have the backend exchange it against an attacker-controlled store.
    """
    received = params.get("hmac") or ""
    if not received or not secret:
        return False
    message = "&".join(
        f"{key}={value}"
        for key, value in sorted(params.items())
        if key not in ("hmac", "signature")
    )
    digest = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, received)


# ── Queries ──────────────────────────────────────────────────────────────

_LINE_FIELDS = """
fragment LineFields on LineItem {
  id
  name
  sku
  quantity
  originalUnitPriceSet { shopMoney { amount } }
  product { id title productType category { name } }
  variant { id title sku inventoryItem { unitCost { amount } } }
}
"""

# Page sizes are kept well under Shopify's 1,000-point query cost. Nested
# connections multiply cost, so 10 orders × 50 lines is the safe default; a
# cost error halves the page size and retries rather than failing the sync.
ORDERS_QUERY = _LINE_FIELDS + """
query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      test
      createdAt
      cancelledAt
      taxesIncluded
      currencyCode
      presentmentCurrencyCode
      totalPriceSet { presentmentMoney { amount currencyCode } }
      displayFinancialStatus
      displayFulfillmentStatus
      paymentGatewayNames
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 50) {
        pageInfo { hasNextPage endCursor }
        nodes { ...LineFields }
      }
      refunds {
        id
        createdAt
        refundLineItems(first: 50) {
          nodes {
            quantity
            lineItem { id }
            subtotalSet { shopMoney { amount } }
          }
        }
      }
    }
  }
}
"""

# The shop's own settings. Cheap, and the only place the store's real currency
# and calendar timezone can come from — both were previously assumed.
SHOP_QUERY = """
query Shop {
  shop {
    name
    currencyCode
    ianaTimezone
  }
}
"""

MORE_LINES_QUERY = _LINE_FIELDS + """
query MoreLines($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ...LineFields }
    }
  }
}
"""


def _money(money_set):
    try:
        return float(money_set["shopMoney"]["amount"])
    except (TypeError, KeyError, ValueError):
        return 0.0


def _presentment(money_set):
    """(amount, currency) as the customer paid it, or (None, None).

    Never added to a shop-currency figure: two orders paid in different
    currencies do not sum without an exchange rate, and none is available here.
    """
    try:
        block = money_set["presentmentMoney"]
        return float(block["amount"]), block.get("currencyCode")
    except (TypeError, KeyError, ValueError):
        return None, None


def _parse_time(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# ── Connector ────────────────────────────────────────────────────────────

class ShopifyConnector(BaseConnector):
    platform_name = "shopify"
    PAGE_SIZE = 10

    # OAuth ------------------------------------------------------------------

    def get_authorize_url(self, state):
        from urllib.parse import urlencode

        shop = normalise_shop(self.connection.external_account_id)
        if not shop:
            raise ShopifyError("A valid store domain is required to connect Shopify")
        params = {
            "client_id": current_app.config["SHOPIFY_API_KEY"],
            "scope": current_app.config["SHOPIFY_SCOPES"],
            "redirect_uri": current_app.config["SHOPIFY_REDIRECT_URI"],
            "state": state,
        }
        return f"https://{shop}/admin/oauth/authorize?{urlencode(params)}"

    def exchange_code_for_token(self, code):
        """Swap the one-time code for a permanent offline token.

        Only called after the callback's HMAC and state have been verified. The
        caller commits, so a failure here never leaves a half-written
        connection behind.
        """
        shop = normalise_shop(self.connection.external_account_id)
        if not shop:
            raise ShopifyError("Refusing to exchange a code for an invalid store domain")
        resp = requests.post(
            f"https://{shop}/admin/oauth/access_token",
            json={
                "client_id": current_app.config["SHOPIFY_API_KEY"],
                "client_secret": current_app.config["SHOPIFY_API_SECRET"],
                "code": code,
            },
            timeout=30,
        )
        if resp.status_code >= 400:
            raise ShopifyError(f"Shopify refused the install ({resp.status_code})")
        data = resp.json()
        if not data.get("access_token"):
            raise ShopifyError("Shopify did not return an access token")
        self.connection.access_token = data["access_token"]
        self.connection.scopes = data.get("scope")
        self.connection.status = "connected"
        self.connection.last_error = None
        return {"scope": data.get("scope")}

    # Credentials ------------------------------------------------------------

    def _token(self):
        """The access token for this store, whichever way it was connected."""
        c = self.credentials
        if c.get("admin_api_token"):
            return c["admin_api_token"]
        if c.get("client_id") and c.get("client_secret"):
            expires = c.get("_token_expires")
            if c.get("_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
                return c["_token"]
            return self._client_credentials_token()
        return self.connection.access_token

    def _client_credentials_token(self):
        shop = normalise_shop(self.connection.external_account_id or self.credentials.get("shop"))
        if not shop:
            raise ShopifyError("Enter the store's myshopify.com domain")
        try:
            resp = http.request(
                "POST", f"https://{shop}/admin/oauth/access_token", platform="Shopify",
                auth_statuses=(400, 401, 403),
                data={
                    "grant_type": "client_credentials",
                    "client_id": self.credentials["client_id"],
                    "client_secret": self.credentials["client_secret"],
                },
            )
        except http.ConnectorAuthError as exc:
            raise ShopifyAuthError(
                "Shopify refused the client ID and secret. The client credentials grant only works "
                "when the app and the store are in the same Shopify organization; otherwise paste "
                "an Admin API access token or use Connect store."
            ) from exc
        body = http.json_of(resp, "Shopify")
        token = body.get("access_token")
        if not token:
            raise ShopifyAuthError("Shopify did not return an access token")
        lifetime = int(body.get("expires_in") or 86399)
        expires = datetime.now(timezone.utc).timestamp() + lifetime - 300
        self.remember(
            _token=token,
            _token_expires=datetime.fromtimestamp(expires, tz=timezone.utc).isoformat(),
        )
        self.connection.scopes = body.get("scope") or self.connection.scopes
        return token

    def test_connection(self):
        """Read the shop profile with the typed credentials."""
        profile = self.fetch_shop_profile()
        shop = normalise_shop(self.connection.external_account_id or self.credentials.get("shop"))
        return {"account_id": shop, "display_name": profile.get("name") or shop, **profile}

    # Transport --------------------------------------------------------------

    def _graphql(self, query, variables=None, attempts=6):
        shop = normalise_shop(self.connection.external_account_id or self.credentials.get("shop"))
        token = self._token() if shop else None
        if not shop or not token:
            raise ShopifyAuthError("This store is not connected")
        version = current_app.config["SHOPIFY_API_VERSION"]
        url = f"https://{shop}/admin/api/{version}/graphql.json"
        headers = {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
        }

        for _ in range(attempts):
            resp = requests.post(
                url, headers=headers,
                json={"query": query, "variables": variables or {}}, timeout=60,
            )
            if resp.status_code == 429:
                time.sleep(float(resp.headers.get("Retry-After", 2)))
                continue
            if resp.status_code in (401, 403):
                if self.credentials.get("client_secret") and self.credentials.get("_token"):
                    self.remember(_token=None, _token_expires=None)
                    headers["X-Shopify-Access-Token"] = self._token()
                    continue
                raise ShopifyAuthError("Shopify rejected the access token; reconnect the store")
            if resp.status_code == 404:
                raise ShopifyError(
                    f"Shopify API version {version} was not found; set SHOPIFY_API_VERSION to a supported version"
                )
            resp.raise_for_status()

            payload = resp.json()
            errors = payload.get("errors") or []
            codes = {(e.get("extensions") or {}).get("code") for e in errors}
            if "THROTTLED" in codes:
                # Wait just long enough for the bucket to refill the points
                # this query needs, rather than a fixed back-off.
                cost = (payload.get("extensions") or {}).get("cost") or {}
                status = cost.get("throttleStatus") or {}
                need = cost.get("requestedQueryCost", 100) - status.get("currentlyAvailable", 0)
                rate = status.get("restoreRate", 50) or 50
                time.sleep(max(1.0, need / rate))
                continue
            if "MAX_COST_EXCEEDED" in codes:
                raise ShopifyCostError("Query too expensive for one request")
            if errors:
                raise ShopifyError("; ".join(e.get("message", "unknown error") for e in errors))
            return payload.get("data") or {}

        raise ShopifyError("Shopify kept throttling the sync; try again in a minute")

    # Shop profile -----------------------------------------------------------

    def fetch_shop_profile(self):
        """The store's own currency and calendar timezone.

        Both used to be assumed: every figure was labelled in rupees and every
        day was bucketed as if the store booked it in IST. A store selling from
        anywhere else was mislabelled and, near midnight, misdated.
        """
        shop = (self._graphql(SHOP_QUERY).get("shop") or {})
        profile = {
            "name": shop.get("name"),
            "currency": shop.get("currencyCode"),
            "timezone": shop.get("ianaTimezone"),
        }
        meta = dict(self.connection.meta or {})
        meta.update({k: v for k, v in profile.items() if v})
        # SQLAlchemy only notices a reassigned JSON column, not a mutated one.
        self.connection.meta = meta

        # The brand reports in whatever its store sells in.
        brand = self.connection.brand
        if brand is not None and profile.get("currency"):
            brand.currency = profile["currency"]
        return profile

    # Sync -------------------------------------------------------------------

    def sync(self, since=None):
        """Pull every order changed since the last sync.

        Filtered on `updated_at`, not `created_at`: a refund or cancellation
        changes an old order, and syncing by creation date would never see it.
        """
        # Ahead of the orders, so the rows are never stored under a stale
        # currency. A shop that cannot answer this is still worth syncing.
        try:
            self.fetch_shop_profile()
        except ShopifyError as exc:
            current_app.logger.warning("Could not read Shopify shop profile: %s", exc)

        search = None
        if since:
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            search = f"updated_at:>='{since.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}'"

        cursor, pages, synced, skipped = None, 0, 0, 0
        page_size = self.PAGE_SIZE
        while True:
            try:
                data = self._graphql(ORDERS_QUERY, {"first": page_size, "after": cursor, "query": search})
            except ShopifyCostError:
                if page_size == 1:
                    raise
                page_size = max(1, page_size // 2)
                continue

            connection = data.get("orders") or {}
            for node in connection.get("nodes") or []:
                if node.get("test"):
                    self._remove_order(node["id"])
                    skipped += 1
                    continue
                self._upsert_order(node)
                synced += 1
            db.session.commit()
            pages += 1

            info = connection.get("pageInfo") or {}
            if not info.get("hasNextPage"):
                break
            cursor = info.get("endCursor")

        self.connection.last_synced_at = datetime.now(timezone.utc)
        self.connection.status = "connected"
        self.connection.last_error = None
        db.session.commit()
        return {
            "platform": self.platform_name,
            "records_synced": synced,
            "test_orders_skipped": skipped,
            "pages": pages,
            "incremental": since is not None,
        }

    def _all_lines(self, node):
        lines = list((node.get("lineItems") or {}).get("nodes") or [])
        info = (node.get("lineItems") or {}).get("pageInfo") or {}
        while info.get("hasNextPage"):
            data = self._graphql(MORE_LINES_QUERY, {"id": node["id"], "after": info.get("endCursor")})
            block = ((data.get("order") or {}).get("lineItems")) or {}
            lines.extend(block.get("nodes") or [])
            info = block.get("pageInfo") or {}
        return lines

    def _remove_order(self, external_id):
        order = Order.query.filter_by(
            brand_id=self.connection.brand_id, channel="shopify", external_order_id=external_id,
        ).first()
        if order:
            ReturnRecord.query.filter_by(order_id=order.id).delete()
            db.session.delete(order)

    def _upsert_order(self, node):
        brand_id = self.connection.brand_id
        external_id = node["id"]

        order = Order.query.filter_by(
            brand_id=brand_id, channel="shopify", external_order_id=external_id,
        ).first()
        if not order:
            order = Order(brand_id=brand_id, channel="shopify", external_order_id=external_id)
            db.session.add(order)

        lines = self._all_lines(node)
        cancelled = node.get("cancelledAt") is not None

        # Refunds, keyed by the line they refund, so returns attach to the
        # product that was actually sent back.
        refunded_qty, refunded_amt = {}, {}
        refunds = []
        for refund in node.get("refunds") or []:
            merch = 0.0
            for rli in ((refund.get("refundLineItems") or {}).get("nodes") or []):
                line_id = (rli.get("lineItem") or {}).get("id")
                amount = _money(rli.get("subtotalSet"))
                merch += amount
                if line_id:
                    refunded_qty[line_id] = refunded_qty.get(line_id, 0) + (rli.get("quantity") or 0)
                    refunded_amt[line_id] = refunded_amt.get(line_id, 0.0) + amount
            refunds.append((refund, merch))

        line_gross = [_money(li.get("originalUnitPriceSet")) * (li.get("quantity") or 0) for li in lines]
        gross = sum(line_gross)
        discounts = _money(node.get("totalDiscountsSet"))
        merch_refunded = sum(refunded_amt.values())

        cost_complete = True
        cogs = 0.0
        for li in lines:
            unit_cost = ((((li.get("variant") or {}).get("inventoryItem") or {}).get("unitCost")) or {}).get("amount")
            if unit_cost is None:
                cost_complete = False
            else:
                cogs += float(unit_cost) * (li.get("quantity") or 0)

        gateways = " ".join(node.get("paymentGatewayNames") or []).lower()

        order.order_date = _parse_time(node.get("createdAt")) or datetime.now(timezone.utc)
        order.order_name = node.get("name")
        # Shopify's Orders API carries no marketplace fee: known to be none.
        order.marketplace_fee_known = True
        order.currency = node.get("currencyCode")
        presentment_total, presentment_currency = _presentment(node.get("totalPriceSet"))
        order.presentment_currency = presentment_currency or node.get("presentmentCurrencyCode")
        order.presentment_total = presentment_total
        order.taxes_included = bool(node.get("taxesIncluded"))
        order.financial_status = (node.get("displayFinancialStatus") or "").lower() or None
        order.gross_amount = gross
        order.discount_amount = discounts
        order.shipping_amount = _money(node.get("totalShippingPriceSet"))
        order.tax_amount = _money(node.get("totalTaxSet"))
        order.refunded_amount = _money(node.get("totalRefundedSet"))
        # Shopify's Orders API carries no gateway or courier cost. Those stay
        # unknown here rather than being guessed.
        order.marketplace_fee_amount = 0.0
        order.is_cancelled = cancelled
        order.is_returned = merch_refunded > 0
        order.net_amount = 0.0 if cancelled else gross - discounts - merch_refunded
        order.payment_mode = "cod" if ("cash on delivery" in gateways or "cod" in gateways.split()) else "prepaid"
        order.cost_complete = cost_complete
        order.cogs_amount = cogs if cost_complete else 0.0
        order.net_margin_amount = (order.net_amount - cogs) if (cost_complete and not cancelled) else 0.0
        order.net_margin_pct = (
            round((order.net_margin_amount / order.net_amount) * 100, 1)
            if cost_complete and order.net_amount else 0.0
        )
        if cancelled:
            order.status = "cancelled"
        elif order.financial_status == "refunded":
            order.status = "returned"
        else:
            order.status = (node.get("displayFulfillmentStatus") or "placed").lower()

        db.session.flush()

        OrderItem.query.filter_by(order_id=order.id).delete()
        for li, lg in zip(lines, line_gross):
            product = li.get("product") or {}
            variant = li.get("variant") or {}
            unit_cost = ((variant.get("inventoryItem") or {}).get("unitCost") or {}).get("amount")
            qty = li.get("quantity") or 0
            share = (lg / gross) if gross else 0.0
            category = (product.get("productType") or "").strip() or "Uncategorised"
            taxonomy = ((product.get("category") or {}).get("name") or "").strip()
            db.session.add(OrderItem(
                order_id=order.id,
                external_line_id=li.get("id"),
                sku=variant.get("sku") or li.get("sku") or f"no-sku-{(variant.get('id') or li.get('id') or '').split('/')[-1]}",
                product_name=product.get("title") or li.get("name"),
                product_external_id=product.get("id"),
                product_type=category,
                subcategory=taxonomy or category,
                variant_external_id=variant.get("id"),
                variant_title=variant.get("title"),
                quantity=qty,
                unit_price=_money(li.get("originalUnitPriceSet")),
                unit_cost=float(unit_cost) if unit_cost is not None else 0.0,
                cost_known=unit_cost is not None,
                line_total=lg,
                # Order-level discounts are spread across lines by value, so
                # the lines always sum back to the order's own discount.
                discount_allocated=discounts * share,
                returned_quantity=refunded_qty.get(li.get("id"), 0),
                returned_amount=refunded_amt.get(li.get("id"), 0.0),
                line_margin=(lg - discounts * share - refunded_amt.get(li.get("id"), 0.0) - float(unit_cost) * qty)
                if unit_cost is not None and not cancelled else 0.0,
            ))

        ReturnRecord.query.filter_by(order_id=order.id).delete()
        for refund, merch in refunds:
            if merch <= 0:
                continue
            db.session.add(ReturnRecord(
                brand_id=brand_id,
                order_id=order.id,
                type="return",
                channel="shopify",
                value_lost=merch,
                event_date=_parse_time(refund.get("createdAt")) or order.order_date,
            ))
