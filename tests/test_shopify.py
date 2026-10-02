"""Shopify install and sync.

Runs on an in-memory database with every network call mocked, so it touches
neither the real database nor Shopify. Uses throwaway credentials, never the
values in .env.

    python tests/test_shopify.py
"""
import hashlib
import hmac
import os
import sys
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlencode, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TEST_SECRET = "test-client-secret"
os.environ.update({
    "SECRET_KEY": "test-secret-key",
    "JWT_SECRET_KEY": "test-jwt-secret-that-is-long-enough-for-hs256",
    "DATABASE_URL": "sqlite:///:memory:",
    "SHOPIFY_API_KEY": "test-client-id",
    "SHOPIFY_API_SECRET": TEST_SECRET,
    "SHOPIFY_REDIRECT_URI": "http://localhost:5000/api/connectors/shopify/callback",
    "FRONTEND_URL": "http://localhost:5173",
})

from flask_jwt_extended import create_access_token  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Brand, BrandMember, Connection, Order, OrderItem, ReturnRecord, User  # noqa: E402
from app.services import shopify_service  # noqa: E402
from app.services.shopify_service import (  # noqa: E402
    ShopifyConnector, ShopifyCostError, normalise_shop, verify_callback_hmac,
)


def sign(params, secret=TEST_SECRET):
    message = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    return {**params, "hmac": hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()}


def body(resp):
    payload = resp.get_json(silent=True) or {}
    return payload.get("data", payload)


def money(amount):
    return {"shopMoney": {"amount": str(amount)}}


def line(line_id, qty, price, *, product="1", title="Bedsheet", ptype="Bedding",
         variant="11", vtitle="King", sku="BED-K", cost=None, taxonomy="Bed Sheets"):
    return {
        "id": f"gid://shopify/LineItem/{line_id}",
        "name": f"{title} - {vtitle}",
        "sku": sku,
        "quantity": qty,
        "originalUnitPriceSet": money(price),
        "product": {"id": f"gid://shopify/Product/{product}", "title": title,
                    "productType": ptype, "category": {"name": taxonomy}},
        "variant": {"id": f"gid://shopify/ProductVariant/{variant}", "title": vtitle, "sku": sku,
                    "inventoryItem": {"unitCost": {"amount": str(cost)} if cost is not None else None}},
    }


SHOP_PAGE = {"shop": {"name": "Demo Store", "currencyCode": "INR", "ianaTimezone": "Asia/Kolkata"}}


def order_node(order_id, lines, *, created="2026-09-10T08:00:00Z", discounts=0, cancelled=None,
               refunds=(), test=False, more_lines=False, paid_in="INR", paid_total=0):
    return {
        "id": f"gid://shopify/Order/{order_id}",
        "name": f"#{order_id}",
        "test": test,
        "createdAt": created,
        "cancelledAt": cancelled,
        "taxesIncluded": True,
        "currencyCode": "INR",
        "presentmentCurrencyCode": paid_in,
        "totalPriceSet": {"presentmentMoney": {"amount": str(paid_total), "currencyCode": paid_in}},
        "displayFinancialStatus": "PAID",
        "displayFulfillmentStatus": "FULFILLED",
        "paymentGatewayNames": ["razorpay"],
        "totalDiscountsSet": money(discounts),
        "totalShippingPriceSet": money(0),
        "totalTaxSet": money(0),
        "totalRefundedSet": money(sum(r["amount"] for r in refunds)),
        "lineItems": {"pageInfo": {"hasNextPage": more_lines, "endCursor": "L1" if more_lines else None},
                      "nodes": lines},
        "refunds": [{
            "id": f"gid://shopify/Refund/{i}",
            "createdAt": "2026-09-12T08:00:00Z",
            "refundLineItems": {"nodes": [{
                "quantity": r["qty"], "lineItem": {"id": f"gid://shopify/LineItem/{r['line']}"},
                "subtotalSet": money(r["amount"]),
            }]},
        } for i, r in enumerate(refunds)],
    }


class Base(unittest.TestCase):
    def setUp(self):
        self.app = create_app("testing")
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.client = self.app.test_client()
        self.user, self.brand, self.token = self.make_owner("owner@example.test", "Tranquebar Home")

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.ctx.pop()

    def make_owner(self, email, brand_name):
        user = User(email=email, full_name="Owner")
        user.set_password("a-long-test-password")
        brand = Brand(name=brand_name)
        db.session.add_all([user, brand])
        db.session.flush()
        db.session.add(BrandMember(brand_id=brand.id, user_id=user.id, role="owner"))
        db.session.commit()
        return user, brand, create_access_token(identity=user.id)

    def auth(self, token=None):
        return {"Authorization": f"Bearer {token or self.token}"}

    def connection(self, shop="demo-store.myshopify.com"):
        conn = Connection(brand_id=self.brand.id, platform="shopify",
                          external_account_id=shop, access_token="shpat_test", status="connected")
        db.session.add(conn)
        db.session.commit()
        return conn


class ShopDomain(unittest.TestCase):
    def test_accepts_the_forms_a_merchant_types(self):
        self.assertEqual(normalise_shop("demo-store"), "demo-store.myshopify.com")
        self.assertEqual(normalise_shop("Demo-Store.myshopify.com"), "demo-store.myshopify.com")
        self.assertEqual(normalise_shop("https://demo-store.myshopify.com/admin"), "demo-store.myshopify.com")

    def test_refuses_anything_that_is_not_a_myshopify_host(self):
        for hostile in ("evil.com", "demo.myshopify.com.evil.com", "evil.com/.myshopify.com",
                        "-bad.myshopify.com", "a b.myshopify.com", "", None):
            self.assertIsNone(normalise_shop(hostile), hostile)


class CallbackSignature(unittest.TestCase):
    def test_accepts_a_genuine_signature(self):
        self.assertTrue(verify_callback_hmac(sign({"code": "c", "shop": "s.myshopify.com", "state": "x"}), TEST_SECRET))

    def test_rejects_tampering_missing_or_wrong_secret(self):
        signed = sign({"code": "c", "shop": "s.myshopify.com", "state": "x"})
        self.assertFalse(verify_callback_hmac({**signed, "shop": "evil.myshopify.com"}, TEST_SECRET))
        self.assertFalse(verify_callback_hmac({k: v for k, v in signed.items() if k != "hmac"}, TEST_SECRET))
        self.assertFalse(verify_callback_hmac(signed, "some-other-secret"))
        self.assertFalse(verify_callback_hmac(signed, ""))


class InstallFlow(Base):
    def start(self, shop="demo-store"):
        resp = self.client.post(f"/api/brands/{self.brand.id}/shopify/start",
                                json={"shop": shop}, headers=self.auth())
        return resp, body(resp)

    def callback(self, params):
        return self.client.get(f"/api/connectors/shopify/callback?{urlencode(params)}")

    def redirect_query(self, resp):
        self.assertEqual(resp.status_code, 302)
        location = urlparse(resp.headers["Location"])
        self.assertEqual(f"{location.scheme}://{location.netloc}", "http://localhost:5173")
        return {k: v[0] for k, v in parse_qs(location.query).items()}

    def state_from(self, data):
        return parse_qs(urlparse(data["authorize_url"]).query)["state"][0]

    def test_start_builds_consent_url_for_the_store(self):
        resp, data = self.start()
        self.assertEqual(resp.status_code, 200)
        url = urlparse(data["authorize_url"])
        self.assertEqual(url.netloc, "demo-store.myshopify.com")
        query = parse_qs(url.query)
        self.assertEqual(query["client_id"], ["test-client-id"])
        self.assertIn("state", query)

    def test_start_requires_login_and_a_valid_store(self):
        self.assertEqual(self.client.post(f"/api/brands/{self.brand.id}/shopify/start",
                                          json={"shop": "demo-store"}).status_code, 401)
        resp, _ = self.start("evil.com")
        self.assertEqual(resp.status_code, 400)

    def test_another_brands_owner_cannot_start_an_install_here(self):
        _, _, intruder = self.make_owner("intruder@example.test", "Other Brand")
        resp = self.client.post(f"/api/brands/{self.brand.id}/shopify/start",
                                json={"shop": "demo-store"}, headers=self.auth(intruder))
        self.assertEqual(resp.status_code, 403)

    def test_genuine_callback_stores_the_connection(self):
        _, data = self.start()
        params = sign({"code": "one-time-code", "shop": "demo-store.myshopify.com",
                       "state": self.state_from(data), "timestamp": "1"})
        exchange = mock.Mock(status_code=200)
        exchange.json.return_value = {"access_token": "shpat_live_token", "scope": "read_orders"}
        with mock.patch.object(shopify_service.requests, "post", return_value=exchange) as post:
            resp = self.callback(params)

        self.assertEqual(self.redirect_query(resp), {"shopify": "connected", "shop": "demo-store.myshopify.com"})
        post.assert_called_once()
        self.assertEqual(post.call_args.args[0], "https://demo-store.myshopify.com/admin/oauth/access_token")
        conn = Connection.query.filter_by(brand_id=self.brand.id, platform="shopify").one()
        self.assertEqual(conn.status, "connected")
        self.assertEqual(conn.access_token, "shpat_live_token")
        self.assertNotIn("access_token", conn.to_dict())

    def test_forged_signature_is_refused_without_calling_shopify(self):
        _, data = self.start()
        params = sign({"code": "c", "shop": "demo-store.myshopify.com", "state": self.state_from(data)})
        params["hmac"] = "0" * 64
        with mock.patch.object(shopify_service.requests, "post") as post:
            resp = self.callback(params)
        self.assertEqual(self.redirect_query(resp)["reason"], "signature")
        post.assert_not_called()
        self.assertEqual(Connection.query.count(), 0)

    def test_state_from_a_different_store_is_refused(self):
        _, data = self.start("demo-store")
        params = sign({"code": "c", "shop": "other-store.myshopify.com", "state": self.state_from(data)})
        with mock.patch.object(shopify_service.requests, "post") as post:
            resp = self.callback(params)
        self.assertEqual(self.redirect_query(resp)["reason"], "shop")
        post.assert_not_called()

    def test_forged_and_expired_state_are_refused(self):
        forged = sign({"code": "c", "shop": "demo-store.myshopify.com", "state": "not-a-real-state"})
        self.assertEqual(self.redirect_query(self.callback(forged))["reason"], "state")

        _, data = self.start()
        stale = sign({"code": "c", "shop": "demo-store.myshopify.com", "state": self.state_from(data)})
        with mock.patch("app.api.shopify_oauth.STATE_MAX_AGE", -1):
            self.assertEqual(self.redirect_query(self.callback(stale))["reason"], "expired")

    def test_the_old_unverified_callback_route_is_closed_for_shopify(self):
        resp = self.client.post(f"/api/brands/{self.brand.id}/connectors/shopify/callback",
                                json={"code": "c", "external_account_id": "demo-store.myshopify.com"},
                                headers=self.auth())
        self.assertEqual(resp.status_code, 400)


class OrderMapping(Base):
    def test_money_discounts_refunds_and_costs(self):
        conn = self.connection()
        node = order_node(1001, [
            line(1, 2, 1000, cost=400),
            line(2, 1, 500, product="2", title="Pillow", variant="21", vtitle="Standard", sku="PIL", cost=None),
        ], discounts=150, refunds=[{"line": 1, "qty": 1, "amount": 900}])
        ShopifyConnector(conn)._upsert_order(node)
        db.session.commit()

        order = Order.query.one()
        self.assertAlmostEqual(order.gross_amount, 2500)
        self.assertAlmostEqual(order.discount_amount, 150)
        self.assertAlmostEqual(order.net_amount, 2500 - 150 - 900)
        # One line has no unit cost, so no margin is claimed for the order.
        self.assertFalse(order.cost_complete)
        self.assertEqual(order.net_margin_amount, 0)

        items = {i.sku: i for i in OrderItem.query.all()}
        self.assertAlmostEqual(items["BED-K"].discount_allocated + items["PIL"].discount_allocated, 150)
        self.assertAlmostEqual(items["BED-K"].discount_allocated, 120)
        self.assertEqual(items["BED-K"].returned_quantity, 1)
        self.assertAlmostEqual(items["BED-K"].returned_amount, 900)
        self.assertEqual(items["BED-K"].product_type, "Bedding")
        self.assertEqual(items["BED-K"].subcategory, "Bed Sheets")
        self.assertTrue(items["BED-K"].cost_known)
        self.assertFalse(items["PIL"].cost_known)
        self.assertEqual(ReturnRecord.query.one().value_lost, 900)

    def test_cancelled_order_nets_to_zero(self):
        conn = self.connection()
        ShopifyConnector(conn)._upsert_order(order_node(1002, [line(1, 1, 800, cost=300)],
                                                        cancelled="2026-09-10T09:00:00Z"))
        db.session.commit()
        order = Order.query.one()
        self.assertTrue(order.is_cancelled)
        self.assertEqual(order.net_amount, 0)
        self.assertEqual(order.status, "cancelled")

    def test_resync_updates_in_place_without_duplicating(self):
        conn = self.connection()
        connector = ShopifyConnector(conn)
        connector._upsert_order(order_node(1003, [line(1, 1, 800)]))
        db.session.commit()
        connector._upsert_order(order_node(1003, [line(1, 3, 800)]))
        db.session.commit()
        self.assertEqual(Order.query.count(), 1)
        self.assertEqual(OrderItem.query.count(), 1)
        self.assertEqual(OrderItem.query.one().quantity, 3)


class SyncLoop(Base):
    def test_paginates_skips_test_orders_and_follows_long_orders(self):
        conn = self.connection()
        pages = [
            {"orders": {"pageInfo": {"hasNextPage": True, "endCursor": "P1"},
                        "nodes": [order_node(2001, [line(1, 1, 100)], more_lines=True),
                                  order_node(2002, [line(2, 1, 100)], test=True)]}},
            {"order": {"lineItems": {"pageInfo": {"hasNextPage": False, "endCursor": None},
                                     "nodes": [line(9, 2, 50, product="9", variant="91", sku="EXTRA")]}}},
            {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None},
                        "nodes": [order_node(2003, [line(3, 1, 100)])]}},
        ]
        with mock.patch.object(ShopifyConnector, "_graphql", side_effect=[SHOP_PAGE, *pages]) as gql:
            summary = ShopifyConnector(conn).sync()

        self.assertEqual(summary["records_synced"], 2)
        self.assertEqual(summary["test_orders_skipped"], 1)
        self.assertEqual(summary["pages"], 2)
        # One shop-profile call, then the three order/line pages.
        self.assertEqual(gql.call_count, 4)
        self.assertEqual(Order.query.count(), 2)
        # The order with more than one page of lines kept all of them.
        long_order = Order.query.filter_by(external_order_id="gid://shopify/Order/2001").one()
        self.assertEqual(OrderItem.query.filter_by(order_id=long_order.id).count(), 2)
        self.assertIsNotNone(conn.last_synced_at)

    def test_halves_page_size_when_a_query_is_too_expensive(self):
        conn = self.connection()
        ok_page = {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": []}}
        with mock.patch.object(ShopifyConnector, "_graphql",
                               side_effect=[SHOP_PAGE, ShopifyCostError("too big"), ok_page]) as gql:
            ShopifyConnector(conn).sync()
        # Index 0 is the shop profile; the order pages follow it.
        self.assertEqual(gql.call_args_list[1].args[1]["first"], ShopifyConnector.PAGE_SIZE)
        self.assertEqual(gql.call_args_list[2].args[1]["first"], ShopifyConnector.PAGE_SIZE // 2)

    def test_incremental_sync_filters_on_updated_at(self):
        from datetime import datetime
        conn = self.connection()
        ok_page = {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": []}}
        with mock.patch.object(ShopifyConnector, "_graphql", return_value=ok_page) as gql:
            ShopifyConnector(conn).sync(since=datetime(2026, 9, 1, 6, 30))
        self.assertEqual(gql.call_args.args[1]["query"], "updated_at:>='2026-09-01T06:30:00Z'")


class Facts(Base):
    def seed(self):
        conn = self.connection()
        connector = ShopifyConnector(conn)
        # 20:00 UTC on the 14th is 01:30 IST on the 15th.
        connector._upsert_order(order_node(3001, [line(1, 2, 1000, cost=400)],
                                           created="2026-09-14T20:00:00Z", discounts=200,
                                           refunds=[{"line": 1, "qty": 1, "amount": 900}]))
        connector._upsert_order(order_node(3002, [line(2, 1, 500, product="2", variant="21", sku="PIL")],
                                           created="2026-09-15T05:00:00Z"))
        connector._upsert_order(order_node(3003, [line(3, 1, 700, cost=300)],
                                           created="2026-09-15T06:00:00Z", cancelled="2026-09-15T07:00:00Z"))
        db.session.commit()

    def facts(self, token=None, **params):
        return self.client.get(f"/api/brands/{self.brand.id}/facts?{urlencode(params)}",
                               headers=self.auth(token))

    def test_rows_reconcile_to_orders_and_leave_unknown_costs_unknown(self):
        self.seed()
        resp = self.facts()
        self.assertEqual(resp.status_code, 200)
        data = body(resp)
        rows = data["rows"]

        self.assertAlmostEqual(sum(r["grossSales"] for r in rows), 2000 + 500 + 700)
        self.assertAlmostEqual(sum(r["cancelValue"] for r in rows), 700)
        self.assertAlmostEqual(sum(r["discount"] for r in rows), 200)
        self.assertAlmostEqual(sum(r["returnsValue"] for r in rows), 900)
        for r in rows:
            self.assertAlmostEqual(r["netSales"], r["grossSales"] - r["cancelValue"] - r["discount"] - r["returnsValue"])
            self.assertIsNone(r["fees"])
            self.assertIsNone(r["logistics"])

        pillow = next(r for r in rows if r["product"].endswith("/2"))
        self.assertIsNone(pillow["cogs"], "a product with no unit cost must not report zero cost")
        bedsheet = next(r for r in rows if r["product"].endswith("/1"))
        self.assertAlmostEqual(bedsheet["cogs"], 800)

        self.assertEqual(data["orderCount"], 3)
        self.assertEqual({r["date"] for r in rows}, {"2026-09-15"})
        # Cancelled units carry no cost claim; of the rest, 2 of 3 units are costed.
        self.assertAlmostEqual(data["costCoverage"], 2 / 3)
        self.assertEqual([c["id"] for c in data["channels"]], ["shopify"])
        self.assertNotIn("shpat_test", resp.get_data(as_text=True))

    def test_local_day_boundary_and_date_filter(self):
        self.seed()
        self.assertEqual(body(self.facts(start="2026-09-14", end="2026-09-14"))["rows"], [])
        # Orders 3001 and 3003 sell the same variant on the same local day, so
        # they aggregate into one row: three orders, two rows.
        day = body(self.facts(start="2026-09-15", end="2026-09-15"))
        self.assertEqual(len(day["rows"]), 2)
        self.assertEqual(day["orderCount"], 3)
        self.assertEqual(self.facts(start="15-09-2026").status_code, 400)

    def test_rows_name_their_orders_so_an_order_is_counted_once_not_per_product(self):
        conn = self.connection()
        connector = ShopifyConnector(conn)
        # One order with THREE products, and one order with one — two orders,
        # four order lines, on the same day.
        connector._upsert_order(order_node(
            4001, [line(1, 1, 100, product="1", variant="11", sku="A"),
                   line(2, 1, 200, product="2", variant="21", sku="B"),
                   line(3, 1, 300, product="3", variant="31", sku="C")],
            created="2026-09-01T05:00:00Z"))
        connector._upsert_order(order_node(
            4002, [line(4, 1, 400, product="1", variant="11", sku="A")],
            created="2026-09-01T06:00:00Z"))
        db.session.commit()

        data = body(self.facts(start="2026-09-01", end="2026-09-01"))
        rows = data["rows"]
        self.assertEqual(data["orderCount"], 2)
        # The pitfall: per-row counts add up to more than the real number.
        self.assertEqual(sum(r["orders"] for r in rows), 4)
        # The fix: every row names its orders, and the union is the truth.
        self.assertTrue(all(isinstance(r["orderIds"], list) and r["orderIds"] for r in rows))
        self.assertEqual(len({i for r in rows for i in r["orderIds"]}), 2)
        # Product 1 was on both orders; products 2 and 3 on only one.
        by_product = {r["product"].rsplit("/", 1)[-1]: set(r["orderIds"]) for r in rows}
        self.assertEqual(len(by_product["1"]), 2)
        self.assertEqual(len(by_product["2"]), 1)
        self.assertEqual(by_product["2"], by_product["3"])

    def test_another_brand_cannot_read_these_facts(self):
        self.seed()
        _, _, intruder = self.make_owner("intruder@example.test", "Other Brand")
        self.assertEqual(self.facts(token=intruder).status_code, 403)
        self.assertEqual(self.client.get(f"/api/brands/{self.brand.id}/facts").status_code, 401)


class Currency(Base):
    """Going global: the store's own currency and calendar, not an assumed one."""

    def test_sync_reads_the_shops_currency_and_timezone(self):
        conn = self.connection()
        usd = {"shop": {"name": "US Store", "currencyCode": "USD", "ianaTimezone": "America/New_York"}}
        empty = {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": []}}
        with mock.patch.object(ShopifyConnector, "_graphql", side_effect=[usd, empty]):
            ShopifyConnector(conn).sync()

        self.assertEqual(conn.meta["currency"], "USD")
        self.assertEqual(conn.meta["timezone"], "America/New_York")
        # The brand reports in whatever its store sells in.
        self.assertEqual(conn.brand.currency, "USD")

    def test_a_shop_that_cannot_answer_still_syncs_its_orders(self):
        conn = self.connection()
        page = {"orders": {"pageInfo": {"hasNextPage": False, "endCursor": None},
                           "nodes": [order_node(4001, [line(1, 1, 500)])]}}
        with mock.patch.object(ShopifyConnector, "_graphql",
                               side_effect=[shopify_service.ShopifyError("no scope"), page]):
            summary = ShopifyConnector(conn).sync()
        self.assertEqual(summary["records_synced"], 1)

    def test_order_records_what_the_customer_actually_paid(self):
        conn = self.connection()
        ShopifyConnector(conn)._upsert_order(
            order_node(4002, [line(1, 1, 8300)], paid_in="EUR", paid_total=92.5)
        )
        db.session.commit()

        order = Order.query.one()
        # Shop currency for the figures that get summed...
        self.assertEqual(order.currency, "INR")
        self.assertAlmostEqual(order.gross_amount, 8300)
        # ...and the customer's own currency, kept only for reporting.
        self.assertEqual(order.presentment_currency, "EUR")
        self.assertAlmostEqual(order.presentment_total, 92.5)


class GlobalFacts(Base):
    def facts(self, **params):
        return self.client.get(f"/api/brands/{self.brand.id}/facts?{urlencode(params)}",
                               headers=self.auth())

    def test_facts_state_the_currency_and_the_markets_behind_it(self):
        conn = self.connection()
        conn.meta = {"currency": "USD", "timezone": "America/New_York"}
        connector = ShopifyConnector(conn)
        connector._upsert_order(order_node(5001, [line(1, 1, 100)], paid_in="USD", paid_total=100))
        connector._upsert_order(order_node(5002, [line(2, 1, 100)], paid_in="GBP", paid_total=79))
        connector._upsert_order(order_node(5003, [line(3, 1, 100)], paid_in="GBP", paid_total=79))
        db.session.commit()

        data = body(self.facts())
        self.assertEqual(data["currency"], "USD")
        self.assertEqual(data["timezone"], "America/New_York")
        # Listed by how many orders came in each, never added together.
        self.assertEqual([m["currency"] for m in data["presentmentCurrencies"]], ["GBP", "USD"])
        self.assertEqual(data["presentmentCurrencies"][0]["orders"], 2)
        self.assertAlmostEqual(data["presentmentCurrencies"][0]["total"], 158)

    def test_the_day_a_sale_lands_on_follows_the_shops_own_timezone(self):
        conn = self.connection()
        conn.meta = {"currency": "USD", "timezone": "America/New_York"}
        # 02:00 UTC on the 15th is still 22:00 on the 14th in New York.
        ShopifyConnector(conn)._upsert_order(
            order_node(5004, [line(1, 1, 100)], created="2026-09-15T02:00:00Z")
        )
        db.session.commit()

        rows = body(self.facts())["rows"]
        self.assertEqual([r["date"] for r in rows], ["2026-09-14"])
        # And the same instant books a day later for a shop in India.
        conn.meta = {"currency": "INR", "timezone": "Asia/Kolkata"}
        db.session.commit()
        self.assertEqual([r["date"] for r in body(self.facts())["rows"]], ["2026-09-15"])


class Cors(Base):
    def test_only_the_dashboard_origin_is_allowed(self):
        allowed = self.client.get("/api/auth/me", headers={"Origin": "http://localhost:5173", **self.auth()})
        self.assertEqual(allowed.headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        hostile = self.client.get("/api/auth/me", headers={"Origin": "https://evil.example", **self.auth()})
        self.assertIsNone(hostile.headers.get("Access-Control-Allow-Origin"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
