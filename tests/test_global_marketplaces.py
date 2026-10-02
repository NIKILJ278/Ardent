"""eBay, Walmart, TikTok Shop and Mercado Libre: orders and fees.

Runs on an in-memory database with every network call mocked, so it touches
neither the real database nor any real platform.

    python tests/test_global_marketplaces.py
"""
import hashlib
import hmac
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.update({
    "SECRET_KEY": "test-secret-key",
    "JWT_SECRET_KEY": "test-jwt-secret-that-is-long-enough-for-hs256",
    "DATABASE_URL": "sqlite:///:memory:",
    "CREDENTIALS_KEY": "test-credentials-key-also-long-enough",
    "SHOPIFY_API_KEY": "test-client-id",
    "SHOPIFY_API_SECRET": "test-client-secret",
    "SHOPIFY_REDIRECT_URI": "http://localhost:5000/api/connectors/shopify/callback",
    "FRONTEND_URL": "http://localhost:5173",
})

from flask_jwt_extended import create_access_token  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import Brand, BrandMember, Connection, Order, User  # noqa: E402
from app.services import credentials as creds  # noqa: E402
from app.services import http  # noqa: E402
from app.services.connector_factory import CATALOG, spec  # noqa: E402
from app.services.ebay_service import EbayConnector, MAX_LOOKBACK  # noqa: E402
from app.services.mercadolibre_service import MercadoLibreConnector  # noqa: E402
from app.services.tiktok_shop_service import TikTokShopConnector, _sign  # noqa: E402
from app.services.walmart_service import WalmartConnector  # noqa: E402


def fake_response(status_code=200, json_data=None, text="", headers=None):
    resp = mock.Mock()
    resp.status_code = status_code
    resp.headers = headers or {}
    resp.text = text
    resp.reason = "error"
    resp.json = mock.Mock(return_value=json_data if json_data is not None else {})
    return resp


class Base(unittest.TestCase):
    def setUp(self):
        self.app = create_app("testing")
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.create_all()
        self.client = self.app.test_client()
        self.user, self.brand, self.token = self.make_owner("owner@example.test", "Global Co")

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

    def connection(self, platform, **kwargs):
        conn = Connection(brand_id=self.brand.id, platform=platform, status="connected", **kwargs)
        db.session.add(conn)
        db.session.commit()
        return conn


# ── eBay ─────────────────────────────────────────────────────────────────────

class EbayTests(Base):
    def test_sync_writes_orders_and_spreads_the_order_level_fee(self):
        conn = self.connection("ebay")
        creds.save(conn, {"client_id": "ebay-id", "client_secret": "ebay-secret",
                          "refresh_token": "v^1.1#refresh"}, secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = EbayConnector(conn)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 7200})
        page = fake_response(200, {
            "total": 1,
            "orders": [{
                "orderId": "03-12345-67890", "legacyOrderId": "110012345678",
                "creationDate": "2026-09-01T10:00:00.000Z",
                "orderFulfillmentStatus": "FULFILLED",
                "cancelStatus": {"cancelState": "NONE_REQUESTED"},
                "pricingSummary": {
                    "total": {"value": "108.00", "currency": "USD"},
                    "deliveryCost": {"value": "8.00", "currency": "USD"},
                    "tax": {"value": "0.00", "currency": "USD"},
                    "fee": {"value": "3.50", "currency": "USD"},
                },
                "lineItems": [{
                    "lineItemId": "li-1", "sku": "EBAY-SKU", "title": "Widget",
                    "quantity": 2, "lineItemCost": {"value": "100.00", "currency": "USD"},
                    "refunds": [],
                }],
            }],
        })
        with mock.patch("requests.request", side_effect=[token_resp, page]):
            summary = connector.sync()

        self.assertEqual(summary["orders"], 1)
        order = Order.query.filter_by(brand_id=self.brand.id, channel="ebay").first()
        self.assertEqual(order.gross_amount, 100.0)
        self.assertEqual(order.shipping_amount, 8.0)
        self.assertTrue(order.marketplace_fee_known)
        self.assertEqual(order.marketplace_fee_amount, 3.5)
        self.assertFalse(order.is_cancelled)
        self.assertEqual(order.order_name, "110012345678")

    def test_cancelled_order_is_flagged_from_cancel_state(self):
        conn = self.connection("ebay")
        creds.save(conn, {"client_id": "x", "client_secret": "y", "refresh_token": "z"},
                  secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = EbayConnector(conn)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 7200})
        page = fake_response(200, {
            "total": 1,
            "orders": [{
                "orderId": "03-cancel-1", "creationDate": "2026-09-01T10:00:00.000Z",
                "orderFulfillmentStatus": "NOT_STARTED",
                "cancelStatus": {"cancelState": "CANCELED"},
                "pricingSummary": {"total": {"value": "50.00", "currency": "USD"}},
                "lineItems": [{"lineItemId": "li-1", "sku": "S1", "quantity": 1,
                              "lineItemCost": {"value": "50.00", "currency": "USD"}, "refunds": []}],
            }],
        })
        with mock.patch("requests.request", side_effect=[token_resp, page]):
            connector.sync()
        order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="03-cancel-1").first()
        self.assertTrue(order.is_cancelled)
        self.assertEqual(order.net_amount, 0.0)

    def test_window_never_reaches_further_back_than_ebays_own_limit(self):
        conn = self.connection("ebay")
        connector = EbayConnector(conn)
        far_back = datetime.now(timezone.utc) - timedelta(days=400)
        start = connector.window_start(far_back)
        floor = datetime.now(timezone.utc) - MAX_LOOKBACK
        self.assertGreaterEqual(start, floor - timedelta(seconds=5))

    def test_missing_refresh_token_is_a_clear_auth_error(self):
        conn = self.connection("ebay")
        creds.save(conn, {"client_id": "x", "client_secret": "y"}, secret_keys={"client_secret"})
        db.session.commit()
        connector = EbayConnector(conn)
        with self.assertRaises(http.ConnectorAuthError):
            connector.sync()


# ── Walmart ──────────────────────────────────────────────────────────────────

class WalmartTests(Base):
    def _order_node(self, order_id="PO123", line_statuses=("Shipped",)):
        return {
            "purchaseOrderId": order_id, "customerOrderId": f"CO-{order_id}",
            "orderDate": int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp() * 1000),
            "orderLines": {"orderLine": [
                {
                    "lineNumber": str(i + 1),
                    "item": {"sku": f"WMT-SKU-{i}", "productName": "Widget"},
                    "orderLineQuantity": {"amount": 1},
                    "charges": {"charge": [
                        {"chargeType": "PRODUCT", "chargeAmount": {"amount": 25.0}},
                        {"chargeType": "SHIPPING", "chargeAmount": {"amount": 5.0}},
                        {"chargeType": "TAX", "chargeAmount": {"amount": 2.0}},
                    ]},
                    "orderLineStatuses": [{"status": status}],
                }
                for i, status in enumerate(line_statuses)
            ]},
        }

    def test_sync_writes_an_order_and_sums_shipping_and_tax_across_lines(self):
        conn = self.connection("walmart")
        creds.save(conn, {"client_id": "wmt-id", "client_secret": "wmt-secret"},
                  secret_keys={"client_secret"})
        db.session.commit()
        connector = WalmartConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"access_token": "tok", "token_type": "Bearer", "expires_in": 900})
        orders_page = fake_response(200, {"list": {"meta": {"totalCount": 1, "nextCursor": None},
                                                   "elements": {"order": [self._order_node(
                                                       line_statuses=("Shipped", "Shipped"))]}}})
        with mock.patch("requests.request", side_effect=[token_resp, orders_page]):
            summary = connector.sync()

        self.assertEqual(summary["orders"], 1)
        order = Order.query.filter_by(brand_id=self.brand.id, channel="walmart").first()
        self.assertEqual(order.gross_amount, 50.0)  # two lines at 25 each
        self.assertEqual(order.shipping_amount, 10.0)
        self.assertEqual(order.tax_amount, 4.0)
        self.assertEqual(order.status, "shipped")
        self.assertEqual(order.order_name, "CO-PO123")

    def test_a_fully_cancelled_order_nets_to_zero_but_is_not_dropped(self):
        conn = self.connection("walmart")
        creds.save(conn, {"client_id": "x", "client_secret": "y"}, secret_keys={"client_secret"})
        db.session.commit()
        connector = WalmartConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 900})
        orders_page = fake_response(200, {"list": {"meta": {"totalCount": 1, "nextCursor": None},
                                                   "elements": {"order": [self._order_node(
                                                       order_id="PO-CANCEL", line_statuses=("Cancelled",))]}}})
        with mock.patch("requests.request", side_effect=[token_resp, orders_page]):
            connector.sync()
        order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="PO-CANCEL").first()
        self.assertIsNotNone(order, "a fully cancelled order must still be written, not silently dropped")
        self.assertTrue(order.is_cancelled)
        self.assertEqual(order.net_amount, 0.0)

    def test_a_partly_cancelled_order_keeps_only_the_live_lines(self):
        conn = self.connection("walmart")
        creds.save(conn, {"client_id": "x", "client_secret": "y"}, secret_keys={"client_secret"})
        db.session.commit()
        connector = WalmartConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 900})
        orders_page = fake_response(200, {"list": {"meta": {"totalCount": 1, "nextCursor": None},
                                                   "elements": {"order": [self._order_node(
                                                       order_id="PO-PARTIAL",
                                                       line_statuses=("Shipped", "Cancelled"))]}}})
        with mock.patch("requests.request", side_effect=[token_resp, orders_page]):
            connector.sync()
        order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="PO-PARTIAL").first()
        self.assertFalse(order.is_cancelled)
        self.assertEqual(len(order.items), 1)
        self.assertEqual(order.gross_amount, 25.0)  # only the live line

    def test_missing_credentials_raise_a_clear_error(self):
        conn = self.connection("walmart")
        connector = WalmartConnector(conn)
        with self.assertRaises(http.ConnectorAuthError):
            connector.sync()


# ── TikTok Shop ──────────────────────────────────────────────────────────────

class TikTokSignTests(unittest.TestCase):
    def test_sign_matches_the_documented_recipe(self):
        params = {"app_key": "ak", "timestamp": "1000", "shop_cipher": "sc", "access_token": "at"}
        secret = "shh"
        expected = hmac.new(
            secret.encode(),
            f"{secret}/order/202309/orders/searchapp_keyakshop_ciphersctimestamp1000{secret}".encode(),
            hashlib.sha256,
        ).hexdigest()
        self.assertEqual(_sign("/order/202309/orders/search", params, secret), expected)

    def test_sign_excludes_sign_and_access_token_from_the_base_string(self):
        base_without = _sign("/path", {"a": "1", "access_token": "ignored"}, "secret")
        base_with_different_token = _sign("/path", {"a": "1", "access_token": "different"}, "secret")
        self.assertEqual(base_without, base_with_different_token)


class TikTokShopTests(Base):
    def test_sync_writes_orders_and_excludes_cancelled_lines(self):
        conn = self.connection("tiktok_shop")
        creds.save(conn, {"app_key": "ak", "app_secret": "as", "refresh_token": "rt",
                          "shop_cipher": "sc"}, secret_keys={"app_secret", "refresh_token"})
        db.session.commit()
        connector = TikTokShopConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"code": 0, "data": {
            "access_token": "tok", "access_token_expire_in": 7200, "refresh_token": "rt-new",
        }})
        orders_page = fake_response(200, {"code": 0, "message": "success", "data": {
            "orders": [{
                "id": "TT-ORDER-1", "status": "COMPLETED",
                "create_time": int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()),
                "payment": {"currency": "USD", "shipping_fee": "5.00", "tax": "1.00"},
                "line_items": [
                    {"id": "li-1", "seller_sku": "TT-SKU-1", "product_name": "Widget",
                     "sale_price": "20.00", "display_status": "COMPLETED"},
                    {"id": "li-2", "seller_sku": "TT-SKU-2", "product_name": "Gadget",
                     "sale_price": "10.00", "display_status": "CANCELLED"},
                ],
            }],
            "next_page_token": "",
        }})
        with mock.patch("requests.request", side_effect=[token_resp, orders_page]):
            summary = connector.sync()

        self.assertEqual(summary["orders"], 1)
        order = Order.query.filter_by(brand_id=self.brand.id, channel="tiktok_shop").first()
        self.assertEqual(len(order.items), 1)
        self.assertEqual(order.gross_amount, 20.0)
        self.assertFalse(order.is_cancelled)
        # The rotated refresh token from the response must be saved.
        self.assertEqual(creds.load(conn)["refresh_token"], "rt-new")

    def test_a_body_level_error_code_is_treated_as_an_auth_failure(self):
        conn = self.connection("tiktok_shop")
        creds.save(conn, {"app_key": "ak", "app_secret": "as", "refresh_token": "rt",
                          "shop_cipher": "sc"}, secret_keys={"app_secret", "refresh_token"})
        db.session.commit()
        connector = TikTokShopConnector(conn)
        token_resp = fake_response(200, {"code": 0, "data": {"access_token": "tok",
                                                             "access_token_expire_in": 7200,
                                                             "refresh_token": "rt2"}})
        expired = fake_response(200, {"code": 105002, "message": "Access token is expired"})
        with mock.patch("requests.request", side_effect=[token_resp, expired]):
            with self.assertRaises(http.ConnectorAuthError):
                connector.sync()

    def test_a_dead_refresh_token_is_reported_clearly(self):
        conn = self.connection("tiktok_shop")
        creds.save(conn, {"app_key": "ak", "app_secret": "as", "refresh_token": "rt",
                          "shop_cipher": "sc"}, secret_keys={"app_secret", "refresh_token"})
        db.session.commit()
        connector = TikTokShopConnector(conn)
        bad = fake_response(200, {"code": 36004102, "message": "Invalid refresh token"})
        with mock.patch("requests.request", return_value=bad):
            with self.assertRaises(http.ConnectorAuthError):
                connector.sync()


# ── Mercado Libre ────────────────────────────────────────────────────────────

class MercadoLibreTests(Base):
    def test_sync_writes_orders_and_rotates_the_refresh_token(self):
        conn = self.connection("mercadolibre")
        creds.save(conn, {"client_id": "ml-id", "client_secret": "ml-secret", "refresh_token": "old-rt"},
                  secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = MercadoLibreConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"access_token": "tok", "token_type": "bearer",
                                         "expires_in": 21600, "refresh_token": "new-rt",
                                         "user_id": 999888})
        me_resp = fake_response(200, {"id": 999888, "nickname": "MY_STORE"})
        search_page = fake_response(200, {
            "paging": {"total": 1, "offset": 0, "limit": 50},
            "results": [{
                "id": 2000001, "status": "paid", "tags": ["delivered"],
                "date_created": "2026-09-01T10:00:00.000-00:00",
                "currency_id": "ARS",
                "payments": [{"status": "approved"}],
                "order_items": [{
                    "item": {"id": "MLA123", "title": "Widget", "seller_sku": "ML-SKU-1"},
                    "quantity": 2, "unit_price": 500.0, "sale_fee": 30.0,
                }],
            }],
        })
        # test_connection() mints the access token (and, since Mercado Libre
        # rotates refresh tokens, a new refresh token). sync() reuses this
        # same connector instance's still-valid cached access token, so it
        # makes only the search call — no second token exchange.
        with mock.patch("requests.request", side_effect=[token_resp, me_resp, search_page]):
            connector.test_connection()
            summary = connector.sync()

        self.assertEqual(summary["orders"], 1)
        order = Order.query.filter_by(brand_id=self.brand.id, channel="mercadolibre").first()
        self.assertEqual(order.gross_amount, 1000.0)
        self.assertTrue(order.marketplace_fee_known)
        self.assertEqual(order.marketplace_fee_amount, 30.0)
        self.assertEqual(order.status, "delivered")
        # Mercado Libre's rotating refresh token must have been saved from the
        # test_connection() call, since the one used there is now dead.
        self.assertEqual(creds.load(conn)["refresh_token"], "new-rt")

    def test_a_refresh_that_returns_no_new_token_is_refused_rather_than_stranding_the_connection(self):
        conn = self.connection("mercadolibre")
        creds.save(conn, {"client_id": "x", "client_secret": "y", "refresh_token": "z"},
                  secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = MercadoLibreConnector(conn)
        # A response with an access token but no rotated refresh token would
        # otherwise silently strand the connection after this one sync.
        bad = fake_response(200, {"access_token": "tok", "expires_in": 21600})
        with mock.patch("requests.request", return_value=bad):
            with self.assertRaises(http.ConnectorError):
                connector.sync()
        # The old refresh token must still be intact — nothing was consumed.
        self.assertEqual(creds.load(conn)["refresh_token"], "z")

    def test_cancelled_and_invalid_orders_are_flagged(self):
        conn = self.connection("mercadolibre")
        creds.save(conn, {"client_id": "x", "client_secret": "y", "refresh_token": "z", "seller_id": "1"},
                  secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = MercadoLibreConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)
        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 21600, "refresh_token": "z2"})
        search_page = fake_response(200, {
            "paging": {"total": 1, "offset": 0, "limit": 50},
            "results": [{
                "id": 3000001, "status": "cancelled", "tags": [],
                "date_created": "2026-09-01T10:00:00.000-00:00", "currency_id": "MXN",
                "payments": [], "order_items": [{
                    "item": {"id": "MLM1", "seller_sku": "SKU-X"}, "quantity": 1, "unit_price": 100.0,
                }],
            }],
        })
        with mock.patch("requests.request", side_effect=[token_resp, search_page]):
            connector.sync()
        order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="3000001").first()
        self.assertTrue(order.is_cancelled)


# ── Catalogue: the four new entries are well-formed ─────────────────────────

class CatalogTests(unittest.TestCase):
    def test_all_four_new_platforms_are_registered(self):
        ids = {e["id"] for e in CATALOG}
        for expected in ("ebay", "walmart", "tiktok_shop", "mercadolibre"):
            self.assertIn(expected, ids)

    def test_each_has_a_working_connector_and_required_fields(self):
        for platform in ("ebay", "walmart", "tiktok_shop", "mercadolibre"):
            entry = spec(platform)
            self.assertEqual(entry["auth"], "credentials")
            self.assertTrue(hasattr(entry["connector"], "sync"))
            required = [f for f in entry["fields"] if f["required"]]
            self.assertTrue(required, platform)


if __name__ == "__main__":
    unittest.main(verbosity=2)
