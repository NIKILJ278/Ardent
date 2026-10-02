"""Every source beyond Shopify: credentials, connectors, and reconciliation.

Runs on an in-memory database with every network call mocked, so it touches
neither the real database nor any real platform.

    python tests/test_connectors.py
"""
import hashlib
import io
import os
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from unittest import mock
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

TEST_SECRET = "test-client-secret"
os.environ.update({
    "SECRET_KEY": "test-secret-key",
    "JWT_SECRET_KEY": "test-jwt-secret-that-is-long-enough-for-hs256",
    "DATABASE_URL": "sqlite:///:memory:",
    "CREDENTIALS_KEY": "test-credentials-key-also-long-enough",
    "SHOPIFY_API_KEY": "test-client-id",
    "SHOPIFY_API_SECRET": TEST_SECRET,
    "SHOPIFY_REDIRECT_URI": "http://localhost:5000/api/connectors/shopify/callback",
    "FRONTEND_URL": "http://localhost:5173",
})

from flask_jwt_extended import create_access_token  # noqa: E402

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.models import (  # noqa: E402
    AdSpendRecord, Brand, BrandMember, Connection, ConnectionSecret, Order, OrderItem,
    PaymentTransaction, Settlement, Shipment, User,
)
from app.services import credentials as creds  # noqa: E402
from app.services import http  # noqa: E402
from app.services.amazon_service import AmazonConnector, fee_from_transaction  # noqa: E402
from app.services.ads_writer import upsert_ad_day  # noqa: E402
from app.services.cashfree_service import CashfreeConnector  # noqa: E402
from app.services.connector_factory import CATALOG, get_connector, spec  # noqa: E402
from app.services.file_import_service import detect, money, when, read_table, ImportError_  # noqa: E402
from app.services.flipkart_service import FlipkartConnector  # noqa: E402
from app.services.payu_service import PayUConnector  # noqa: E402
from app.services.razorpay_service import RazorpayConnector, major as rzp_major  # noqa: E402
from app.services.shiprocket_service import ShiprocketConnector, parse_time as sr_parse_time  # noqa: E402
from app.services.stripe_service import StripeConnector, major as stripe_major  # noqa: E402
from app.services.writers import catalogue_for, upsert_order  # noqa: E402


def body(resp):
    payload = resp.get_json(silent=True) or {}
    return payload.get("data", payload)


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

    def connection(self, platform, **kwargs):
        conn = Connection(brand_id=self.brand.id, platform=platform, status="connected", **kwargs)
        db.session.add(conn)
        db.session.commit()
        return conn


# ── Credentials: encrypted at rest, never returned by the API ──────────────

class Credentials(Base):
    def test_round_trips_through_encryption(self):
        conn = self.connection("razorpay", external_account_id="rzp_test_abc")
        creds.save(conn, {"key_id": "rzp_test_abc", "key_secret": "supersecretvalue"},
                  secret_keys={"key_secret"})
        db.session.commit()

        row = ConnectionSecret.query.filter_by(connection_id=conn.id).first()
        self.assertNotIn("supersecretvalue", row.ciphertext)
        self.assertNotIn("rzp_test_abc", row.ciphertext)  # the whole blob is opaque

        loaded = creds.load(conn)
        self.assertEqual(loaded["key_secret"], "supersecretvalue")
        self.assertEqual(loaded["key_id"], "rzp_test_abc")

    def test_hints_mask_secrets_but_not_identifiers(self):
        conn = self.connection("razorpay", external_account_id="rzp_test_abc")
        creds.save(conn, {"key_id": "rzp_test_abcdefgh", "key_secret": "supersecretvalue"},
                  secret_keys={"key_secret"})
        db.session.commit()
        hints = creds.hints(conn)
        self.assertEqual(hints["key_id"], "rzp_test_abcdefgh")  # identifiers shown in full
        self.assertNotIn("supersecretvalue", hints["key_secret"])
        self.assertTrue(hints["key_secret"].startswith("supe"))
        self.assertTrue(hints["key_secret"].endswith("alue"))

    def test_a_changed_key_makes_old_credentials_unreadable_not_silently_wrong(self):
        conn = self.connection("razorpay")
        creds.save(conn, {"key_secret": "value"}, secret_keys={"key_secret"})
        db.session.commit()
        with mock.patch.dict(self.app.config, {"CREDENTIALS_KEY": "a-totally-different-key-value"}):
            with self.assertRaises(creds.CredentialError):
                creds.load(conn)

    def test_refuses_default_key_outside_debug(self):
        with mock.patch.dict(self.app.config, {"CREDENTIALS_KEY": "", "SECRET_KEY": "dev-secret",
                                                "DEBUG": False, "TESTING": False}):
            with self.assertRaises(creds.CredentialError):
                creds.encrypt({"x": 1})

    def test_credentials_never_appear_in_an_api_response(self):
        conn = self.connection("razorpay", external_account_id="rzp_test_abc")
        creds.save(conn, {"key_id": "rzp_test_abc", "key_secret": "supersecretvalue"},
                  secret_keys={"key_secret"})
        db.session.commit()
        resp = self.client.get(f"/api/brands/{self.brand.id}/connectors", headers=self.auth())
        self.assertNotIn("supersecretvalue", resp.get_data(as_text=True))


# ── The HTTP layer: retry, backoff, and auth failures ───────────────────────

class HttpLayer(unittest.TestCase):
    def test_retries_on_server_error_then_succeeds(self):
        calls = [fake_response(500), fake_response(200, {"ok": True})]
        with mock.patch("requests.request", side_effect=calls):
            resp = http.request("GET", "https://example.test", platform="Test",
                                sleep=lambda s: None)
        self.assertEqual(http.json_of(resp, "Test"), {"ok": True})

    def test_raises_auth_error_on_401_without_retrying(self):
        calls = [fake_response(401)]
        with mock.patch("requests.request", side_effect=calls) as m:
            with self.assertRaises(http.ConnectorAuthError):
                http.request("GET", "https://example.test", platform="Test", sleep=lambda s: None)
        self.assertEqual(m.call_count, 1)

    def test_gives_up_after_exhausting_attempts_on_a_server_error(self):
        calls = [fake_response(503)] * 5
        with mock.patch("requests.request", side_effect=calls):
            with self.assertRaises(http.ConnectorError):
                http.request("GET", "https://example.test", platform="Test",
                            attempts=5, sleep=lambda s: None)

    def test_gives_up_as_rate_limited_specifically_on_429(self):
        calls = [fake_response(429)] * 5
        with mock.patch("requests.request", side_effect=calls):
            with self.assertRaises(http.ConnectorRateLimited):
                http.request("GET", "https://example.test", platform="Test",
                            attempts=5, sleep=lambda s: None)

    def test_error_message_extracts_platform_reason_not_a_stack_dump(self):
        resp = fake_response(400, {"error": {"description": "invalid amount"}})
        with mock.patch("requests.request", return_value=resp):
            with self.assertRaises(http.ConnectorError) as ctx:
                http.request("GET", "https://example.test", platform="Test", sleep=lambda s: None)
        self.assertIn("invalid amount", str(ctx.exception))

    def test_custom_auth_failure_predicate(self):
        resp = fake_response(400, {"error": {"code": 190}})
        with mock.patch("requests.request", return_value=resp):
            with self.assertRaises(http.ConnectorAuthError):
                http.request("GET", "https://example.test", platform="Test", sleep=lambda s: None,
                            is_auth_failure=lambda r: r.json().get("error", {}).get("code") == 190)


# ── The shared order writer: every channel obeys the same arithmetic ───────

class Writers(Base):
    def test_a_marketplace_order_reconciles_like_a_shopify_order(self):
        upsert_order(
            self.brand.id, "amazon", "AMZ-1", order_name="AMZ-1",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU1", "quantity": 2, "unit_price": 500, "unit_cost": 200,
                    "product_name": "Widget"}],
            currency="INR", marketplace_fee=150.0,
        )
        db.session.commit()
        order = Order.query.filter_by(brand_id=self.brand.id, channel="amazon").first()
        self.assertEqual(order.gross_amount, 1000)
        self.assertEqual(order.net_amount, 1000)  # no discount, no return
        self.assertTrue(order.marketplace_fee_known)
        self.assertEqual(order.marketplace_fee_amount, 150.0)
        self.assertTrue(order.cost_complete)
        self.assertEqual(order.cogs_amount, 400)
        self.assertEqual(order.net_margin_amount, 600)

    def test_unknown_fee_is_null_not_zero(self):
        upsert_order(
            self.brand.id, "flipkart", "FK-1", order_name="FK-1",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU2", "quantity": 1, "unit_price": 500}],
            currency="INR", marketplace_fee=None,
        )
        db.session.commit()
        order = Order.query.filter_by(brand_id=self.brand.id, channel="flipkart").first()
        self.assertFalse(order.marketplace_fee_known)
        self.assertEqual(order.marketplace_fee_amount, 0.0)  # stored value is a placeholder

    def test_cancelled_order_nets_to_zero_regardless_of_channel(self):
        upsert_order(
            self.brand.id, "myntra", "MY-1", order_name="MY-1",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU3", "quantity": 1, "unit_price": 500}],
            currency="INR", is_cancelled=True,
        )
        db.session.commit()
        order = Order.query.filter_by(brand_id=self.brand.id, channel="myntra").first()
        self.assertEqual(order.net_amount, 0.0)
        self.assertEqual(order.status, "cancelled")

    def test_resync_replaces_lines_without_duplicating(self):
        for _ in range(2):
            upsert_order(
                self.brand.id, "amazon", "AMZ-2", order_name="AMZ-2",
                order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
                lines=[{"sku": "SKU4", "quantity": 3, "unit_price": 100}],
                currency="INR",
            )
            db.session.commit()
        orders = Order.query.filter_by(brand_id=self.brand.id, channel="amazon",
                                       external_order_id="AMZ-2").all()
        self.assertEqual(len(orders), 1)
        self.assertEqual(len(orders[0].items), 1)

    def test_catalogue_lookup_carries_storefront_cost_onto_a_marketplace_sku(self):
        upsert_order(
            self.brand.id, "shopify", "SHOP-1", order_name="#1001",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SHARED-SKU", "quantity": 1, "unit_price": 999, "unit_cost": 400,
                    "product_name": "Cotton Kurta", "category": "Apparel"}],
            currency="INR",
        )
        db.session.commit()
        known = catalogue_for(self.brand.id, "SHARED-SKU")
        self.assertEqual(known["unit_cost"], 400)
        self.assertEqual(known["category"], "Apparel")
        self.assertEqual(known["product_name"], "Cotton Kurta")

    def test_catalogue_lookup_is_empty_for_an_unknown_sku(self):
        self.assertEqual(catalogue_for(self.brand.id, "NEVER-SEEN"), {})
        self.assertEqual(catalogue_for(self.brand.id, None), {})

    def test_a_partly_returned_order_leaves_net_sales_correct(self):
        upsert_order(
            self.brand.id, "amazon", "AMZ-3", order_name="AMZ-3",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU5", "quantity": 2, "unit_price": 500, "returned_amount": 500,
                    "returned_quantity": 1}],
            currency="INR",
        )
        db.session.commit()
        order = Order.query.filter_by(brand_id=self.brand.id, channel="amazon",
                                      external_order_id="AMZ-3").first()
        self.assertEqual(order.gross_amount, 1000)
        self.assertEqual(order.refunded_amount, 500)
        self.assertEqual(order.net_amount, 500)
        self.assertTrue(order.is_returned)


# ── Razorpay: money units, pagination, settlements ──────────────────────────

class RazorpayTests(Base):
    def test_major_units_convert_paise_to_rupees(self):
        self.assertEqual(rzp_major(50000, "INR"), 500.0)
        self.assertEqual(rzp_major(100, "JPY"), 100.0)  # zero-decimal currency
        self.assertEqual(rzp_major(50000, "BHD"), 50.0)  # three-decimal currency
        self.assertIsNone(rzp_major(None, "INR"))

    def test_sync_paginates_and_writes_payments_and_settlements(self):
        conn = self.connection("razorpay")
        creds.save(conn, {"key_id": "rzp_test_x", "key_secret": "y"}, secret_keys={"key_secret"})
        db.session.commit()
        connector = RazorpayConnector(conn)

        page1 = fake_response(200, {"items": [
            {"id": f"pay_{i}", "amount": 10000, "currency": "INR", "status": "captured",
             "method": "upi", "fee": 200, "tax": 30, "amount_refunded": 0,
             "created_at": int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp()),
             "order_id": "order_1"}
            for i in range(100)
        ]})
        page2 = fake_response(200, {"items": [
            {"id": "pay_100", "amount": 5000, "currency": "INR", "status": "captured",
             "fee": 100, "tax": 15, "created_at": int(datetime.now(timezone.utc).timestamp())},
        ]})
        settlements_page = fake_response(200, {"items": [
            {"id": "setl_1", "amount": 90000, "status": "processed", "fees": 1000, "tax": 150,
             "utr": "UTR123", "created_at": int(datetime.now(timezone.utc).timestamp())},
        ]})

        with mock.patch("requests.request", side_effect=[page1, page2, settlements_page]):
            summary = connector.sync()

        self.assertEqual(summary["payments"], 101)
        self.assertEqual(summary["settlements"], 1)
        self.assertEqual(PaymentTransaction.query.filter_by(gateway="razorpay").count(), 101)
        first = PaymentTransaction.query.filter_by(gateway="razorpay", external_id="pay_0").first()
        self.assertEqual(first.amount, 100.0)
        self.assertEqual(first.fee, 2.0)
        settlement = Settlement.query.filter_by(source="razorpay").first()
        self.assertEqual(settlement.amount, 900.0)
        self.assertEqual(settlement.utr, "UTR123")

    def test_missing_credentials_raise_a_clear_error(self):
        conn = self.connection("razorpay")
        connector = RazorpayConnector(conn)
        with self.assertRaises(http.ConnectorAuthError):
            connector.sync()


# ── PayU: signed hash, chunked date range ───────────────────────────────────

class PayUTests(Base):
    def test_sync_signs_each_request_and_writes_transactions(self):
        conn = self.connection("payu")
        creds.save(conn, {"merchant_key": "gtKFFx", "salt": "eCwWELxi"}, secret_keys={"salt"})
        db.session.commit()
        connector = PayUConnector(conn)

        captured = []

        def fake_post(method, url, **kwargs):
            captured.append(kwargs.get("data"))
            data = kwargs["data"]
            expected_hash = hashlib.sha512(
                f"{data['key']}|get_Transaction_Details|{data['var1']}|eCwWELxi".encode()
            ).hexdigest()
            self.assertEqual(data["hash"], expected_hash)
            return fake_response(200, {
                "status": "1", "msg": "ok",
                "Transaction_details": {
                    "0": {"id": "403993715526730000", "txnid": "txn1", "amount": "999.00",
                          "status": "success", "mode": "UPI", "addedon": "2026-09-05 10:30:00",
                          "transaction_fee": "20.50", "additional_charges": "0",
                          "settlement_id": "setl_abc"},
                },
            })

        with mock.patch("requests.request", side_effect=fake_post):
            connector.window_start = lambda since: datetime(2026, 9, 1, tzinfo=timezone.utc)
            summary = connector.sync()

        self.assertGreaterEqual(summary["payments"], 1)
        row = PaymentTransaction.query.filter_by(gateway="payu").first()
        self.assertEqual(row.amount, 999.0)
        self.assertEqual(row.fee, 20.5)
        self.assertEqual(row.settlement_ref, "setl_abc")
        self.assertGreaterEqual(len(captured), 1)

    def test_a_hash_rejection_is_reported_as_an_auth_error(self):
        conn = self.connection("payu")
        creds.save(conn, {"merchant_key": "k", "salt": "s"}, secret_keys={"salt"})
        db.session.commit()
        connector = PayUConnector(conn)
        resp = fake_response(200, {"status": "0", "msg": "Invalid hash used, transaction declined"})
        with mock.patch("requests.request", return_value=resp):
            with self.assertRaises(http.ConnectorAuthError):
                connector.test_connection()

    def test_no_records_found_is_not_an_error(self):
        conn = self.connection("payu")
        creds.save(conn, {"merchant_key": "k", "salt": "s"}, secret_keys={"salt"})
        db.session.commit()
        connector = PayUConnector(conn)
        resp = fake_response(200, {"status": "0", "msg": "No record found"})
        with mock.patch("requests.request", return_value=resp):
            self.assertEqual(connector._call("2026-09-01", "2026-09-01"), [])


# ── Cashfree: settlement recon, payments vs refunds ─────────────────────────

class CashfreeTests(Base):
    def test_sync_splits_payments_from_refunds_and_aggregates_settlements(self):
        conn = self.connection("cashfree")
        creds.save(conn, {"client_id": "app_id", "client_secret": "secret"},
                  secret_keys={"client_secret"})
        db.session.commit()
        connector = CashfreeConnector(conn)
        # Confine the sync to a single 15-day chunk, so the one mocked
        # response is not replayed across several date-range calls.
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        page = fake_response(200, {
            "cursor": None,
            "data": [
                {
                    "event_details": {"event_type": "PAYMENT", "event_id": "e1", "event_amount": 200,
                                      "event_currency": "INR", "event_settlement_amount": 198,
                                      "event_service_charge": 2, "event_service_tax": 0,
                                      "event_time": "2026-09-01T10:00:00+05:30"},
                    "order_details": {"order_id": "order_1"},
                    "payment_details": {"cf_payment_id": "cfpay1", "payment_group": "UPI",
                                        "payment_time": "2026-09-01T10:00:00+05:30"},
                    "settlement_details": {"cf_settlement_id": "setl_1", "settlement_utr": "UTR1",
                                           "settlement_date": "2026-09-02T10:00:00+05:30",
                                           "amount_settled": None},
                },
                {
                    "event_details": {"event_type": "REFUND", "event_id": "e2", "event_amount": -50,
                                      "event_currency": "INR", "event_settlement_amount": -50,
                                      "event_service_charge": 0, "event_service_tax": 0,
                                      "event_time": "2026-09-01T11:00:00+05:30"},
                    "order_details": {"order_id": "order_1"},
                    "payment_details": {},
                    "settlement_details": {"cf_settlement_id": "setl_1", "settlement_utr": "UTR1"},
                },
            ],
        })
        with mock.patch("requests.request", return_value=page):
            summary = connector.sync()

        self.assertEqual(summary["payments"], 1)
        self.assertEqual(summary["refunds"], 1)
        payment = PaymentTransaction.query.filter_by(gateway="cashfree", external_id="cfpay1").first()
        self.assertEqual(payment.amount, 200)
        self.assertEqual(payment.fee, 2)
        refund = PaymentTransaction.query.filter_by(gateway="cashfree", external_id="refund:e2").first()
        self.assertEqual(refund.refunded, 50)
        settlement = Settlement.query.filter_by(source="cashfree", external_id="setl_1").first()
        self.assertAlmostEqual(settlement.amount, 148)  # summed event_settlement_amount: 198 - 50


# ── Stripe: zero-decimal currencies, balance transactions ──────────────────

class StripeTests(Base):
    def test_major_handles_zero_and_three_decimal_currencies(self):
        self.assertEqual(stripe_major(10000, "usd"), 100.0)
        self.assertEqual(stripe_major(10000, "jpy"), 10000.0)
        self.assertEqual(stripe_major(10000, "bhd"), 10.0)

    def test_sync_separates_charges_and_refunds_and_reads_payouts(self):
        conn = self.connection("stripe")
        creds.save(conn, {"secret_key": "rk_test_abc"}, secret_keys={"secret_key"})
        db.session.commit()
        connector = StripeConnector(conn)

        txns = fake_response(200, {"data": [
            {"id": "txn_1", "type": "charge", "source": "ch_1", "amount": 10000, "fee": 320,
             "currency": "usd", "status": "available",
             "created": int(datetime.now(timezone.utc).timestamp())},
            {"id": "txn_2", "type": "refund", "amount": -5000, "fee": 0, "currency": "usd",
             "created": int(datetime.now(timezone.utc).timestamp())},
        ], "has_more": False})
        payouts = fake_response(200, {"data": [
            {"id": "po_1", "amount": 50000, "currency": "usd", "status": "paid",
             "arrival_date": int(datetime.now(timezone.utc).timestamp())},
        ], "has_more": False})

        with mock.patch("requests.request", side_effect=[txns, payouts]):
            summary = connector.sync()

        self.assertEqual(summary["payments"], 1)
        self.assertEqual(summary["refunds"], 1)
        self.assertEqual(summary["settlements"], 1)
        charge = PaymentTransaction.query.filter_by(gateway="stripe", external_id="ch_1").first()
        self.assertEqual(charge.amount, 100.0)
        self.assertEqual(charge.fee, 3.2)


# ── Shiprocket: messy date formats, order matching, RTO cost ───────────────

class ShiprocketTests(Base):
    def test_parses_every_date_shape_shiprocket_actually_sends(self):
        self.assertIsNotNone(sr_parse_time("31 Jul 2019, 03:03 PM"))
        self.assertIsNotNone(sr_parse_time("28th Aug 2018 07:11 PM"))
        self.assertIsNotNone(sr_parse_time("2022-09-21 17:28:00"))
        self.assertIsNone(sr_parse_time("0000-00-00 00:00:00"))
        self.assertIsNone(sr_parse_time(""))
        self.assertIsNone(sr_parse_time(None))

    def test_a_shipment_links_to_its_order_by_order_name_and_costs_it(self):
        upsert_order(
            self.brand.id, "shopify", "gid://shopify/Order/1", order_name="#1001",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU1", "quantity": 1, "unit_price": 999}], currency="INR",
        )
        db.session.commit()

        conn = self.connection("shiprocket")
        creds.save(conn, {"email": "api@example.test", "password": "pw"}, secret_keys={"password"})
        db.session.commit()
        connector = ShiprocketConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        login = fake_response(200, {"token": "tok123"})
        orders_page = fake_response(200, {
            "data": [{
                "id": 555, "channel_order_id": "1001", "status": "DELIVERED",
                "payment_method": "prepaid", "created_at": "2026-09-01 10:00:00",
                "shipments": [{"id": 999, "awb": "AWB1", "courier": "Delhivery",
                               "delivered_date": "2026-09-05 12:00:00"}],
            }],
            "meta": {"pagination": {"total_pages": 1}},
        })
        detail = fake_response(200, {"data": {
            "shipments": {"awb": "AWB1", "courier": "Delhivery", "is_rto": False},
            "awb_data": {"charges": {"freight_charges": "85.50", "cod_charges": "0"}},
        }})

        with mock.patch("requests.request", side_effect=[login, orders_page, detail]):
            summary = connector.sync()

        self.assertEqual(summary["shipments"], 1)
        self.assertEqual(summary["matched_to_orders"], 1)
        order = Order.query.filter_by(brand_id=self.brand.id, order_name="#1001").first()
        self.assertEqual(order.shipping_cost_amount, 85.5)
        self.assertEqual(order.courier, "Delhivery")

    def test_rto_shipment_is_flagged_and_marks_the_order(self):
        upsert_order(
            self.brand.id, "shopify", "gid://shopify/Order/2", order_name="#1002",
            order_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            lines=[{"sku": "SKU2", "quantity": 1, "unit_price": 500}], currency="INR",
        )
        db.session.commit()
        conn = self.connection("shiprocket")
        creds.save(conn, {"email": "api@example.test", "password": "pw"}, secret_keys={"password"})
        db.session.commit()
        connector = ShiprocketConnector(conn)
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        login = fake_response(200, {"token": "tok123"})
        orders_page = fake_response(200, {
            "data": [{
                "id": 556, "channel_order_id": "1002", "status": "RTO DELIVERED",
                "payment_method": "cod", "created_at": "2026-09-01 10:00:00",
                "shipments": [{"id": 1000, "awb": "AWB2", "is_rto": True}],
            }],
            "meta": {"pagination": {"total_pages": 1}},
        })
        detail = fake_response(200, {"data": {
            "shipments": {"awb": "AWB2", "is_rto": True},
            "awb_data": {"charges": {"freight_charges": "60", "cod_charges": "20",
                                     "charged_weight_amount_rto": "45"}},
        }})
        with mock.patch("requests.request", side_effect=[login, orders_page, detail]):
            connector.sync()

        order = Order.query.filter_by(brand_id=self.brand.id, order_name="#1002").first()
        self.assertTrue(order.is_rto)
        self.assertEqual(order.status, "rto")
        self.assertEqual(order.shipping_cost_amount, 60 + 20 + 45)


# ── Amazon: fee breakdown sign, SP-API pagination, throttle resumption ─────

class AmazonTests(unittest.TestCase):
    def test_fee_from_transaction_sums_expense_breakdowns_as_positive(self):
        txn = {"breakdowns": [
            {"breakdownType": "Product Charges", "breakdownAmount": {"currencyAmount": 500}},
            {"breakdownType": "Expenses", "breakdownAmount": {"currencyAmount": -75}},
            {"breakdownType": "FBA fees", "breakdownAmount": {"currencyAmount": -25}},
        ]}
        self.assertEqual(fee_from_transaction(txn), 100.0)

    def test_fee_from_transaction_nets_a_reversed_fee(self):
        txn = {"breakdowns": [
            {"breakdownType": "Expenses", "breakdownAmount": {"currencyAmount": -50}},
            {"breakdownType": "Expenses", "breakdownAmount": {"currencyAmount": 50}},  # reversal
        ]}
        self.assertEqual(fee_from_transaction(txn), 0.0)


class AmazonSync(Base):
    def test_sync_resumes_from_the_same_page_after_a_throttle(self):
        conn = self.connection("amazon")
        creds.save(conn, {"client_id": "amzn1.app", "client_secret": "s", "refresh_token": "Atzr|x"},
                  secret_keys={"client_secret", "refresh_token"})
        db.session.commit()
        connector = AmazonConnector(conn)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 3600})
        page1 = fake_response(200, {
            "orders": [{
                "orderId": "111-2223334",
                "createdTime": "2026-09-01T10:00:00Z",
                "lastUpdatedTime": "2026-09-01T10:00:00Z",
                "salesChannel": {"channelName": "Amazon.in"},
                "fulfillment": {"fulfillmentStatus": "SHIPPED"},
                "orderItems": [{
                    "orderItemId": "item1", "quantityOrdered": 1,
                    "product": {"asin": "B0X", "sellerSku": "SKU-A", "title": "Widget",
                               "price": {"unitPrice": {"amount": "499.00", "currencyCode": "INR"}}},
                }],
            }],
            "pagination": {"nextToken": "page2token"},
        })
        throttled = fake_response(429, headers={"Retry-After": "1"})

        with mock.patch("requests.request", side_effect=[token_resp, page1, throttled, throttled,
                                                          throttled, throttled, throttled]):
            summary = connector.sync()

        self.assertTrue(summary["partial"])
        self.assertEqual(summary["orders"], 1)
        self.assertEqual(conn.meta.get("amazon_resume", {}).get("token"), "page2token")
        order = Order.query.filter_by(brand_id=self.brand.id, channel="amazon").first()
        self.assertIsNotNone(order)
        self.assertEqual(order.gross_amount, 499.0)

        # A follow-up sync must resume from the saved page. It also reuses the
        # still-valid LWA token cached on the connection during the first sync,
        # so no fresh token exchange happens here — only the orders and
        # finance calls.
        page2 = fake_response(200, {"orders": [], "pagination": {}})
        fees = fake_response(200, {"payload": {"transactions": []}})
        with mock.patch("requests.request", side_effect=[page2, fees]) as m:
            connector2 = AmazonConnector(conn)
            connector2.sync()
        first_call_params = m.call_args_list[0].kwargs.get("params", {})
        self.assertEqual(first_call_params.get("paginationToken"), "page2token")
        self.assertNotIn("amazon_resume", conn.meta)


# ── Flipkart: token grant, cancelled-line handling ──────────────────────────

class FlipkartTests(Base):
    def test_sync_writes_shipped_orders_and_excludes_cancelled_lines(self):
        conn = self.connection("flipkart")
        creds.save(conn, {"app_id": "app1", "app_secret": "secret1"}, secret_keys={"app_secret"})
        db.session.commit()
        connector = FlipkartConnector(conn)
        # Confine the sync to a single 30-day chunk: one call per lifecycle
        # stage (preDispatch, postDispatch, cancelled), not one per chunk.
        connector.window_start = lambda since: datetime.now(timezone.utc) - timedelta(days=5)

        token_resp = fake_response(200, {"access_token": "tok", "expires_in": 3600})
        empty = fake_response(200, {"shipments": [], "hasMore": False})
        shipped = fake_response(200, {
            "shipments": [{
                "orderItems": [
                    {"orderItemId": "oi1", "orderId": "OD1", "sku": "FK-SKU", "fsn": "FSN1",
                     "quantity": 2, "status": "DELIVERED", "orderDate": "2026-09-01T10:00:00Z",
                     "priceComponents": {"sellingPrice": 1000, "shippingCharge": 0}},
                ],
            }],
            "hasMore": False,
        })
        cancelled = fake_response(200, {
            "shipments": [{
                "orderItems": [
                    {"orderItemId": "oi2", "orderId": "OD2", "sku": "FK-SKU2",
                     "quantity": 1, "status": "CANCELLED", "orderDate": "2026-09-01T10:00:00Z",
                     "priceComponents": {"sellingPrice": 500}},
                ],
            }],
            "hasMore": False,
        })

        with mock.patch("requests.request", side_effect=[token_resp, empty, shipped, cancelled]):
            summary = connector.sync()

        self.assertEqual(summary["orders"], 2)
        live_order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="OD1").first()
        self.assertFalse(live_order.is_cancelled)
        self.assertEqual(live_order.gross_amount, 1000)
        cancelled_order = Order.query.filter_by(brand_id=self.brand.id, external_order_id="OD2").first()
        self.assertTrue(cancelled_order.is_cancelled)
        self.assertIsNone(live_order.marketplace_fee_known and None or live_order.marketplace_fee_amount
                          if live_order.marketplace_fee_known else None)
        self.assertFalse(live_order.marketplace_fee_known)  # Flipkart's order API has no commission


# ── File imports: column detection, money/date parsing, CSV and Excel ──────

class FileImportTests(unittest.TestCase):
    def test_money_parses_currency_symbols_commas_and_parens_as_negative(self):
        self.assertEqual(money("₹1,234.50"), 1234.5)
        self.assertEqual(money("Rs. 999"), 999.0)
        self.assertEqual(money("(500.00)"), -500.0)
        self.assertEqual(money("NA"), None)
        self.assertEqual(money(""), None)
        self.assertEqual(money(1500), 1500.0)

    def test_when_reads_day_first_indian_formats(self):
        # `when()` returns a UTC instant; a bare date is read as IST midnight,
        # which is the previous UTC calendar day. That is correct as long as
        # whoever reads the day back converts through IST too — which is what
        # every consumer in this app does — so the round trip is the real
        # invariant, not the raw UTC day.
        ist = ZoneInfo("Asia/Kolkata")
        dt = when("15-09-2026")
        self.assertEqual((dt.astimezone(ist).month, dt.astimezone(ist).day), (9, 15))
        dt2 = when("15/09/2026 14:30:00")
        self.assertEqual((dt2.astimezone(ist).month, dt2.astimezone(ist).day, dt2.astimezone(ist).hour),
                         (9, 15, 14))
        self.assertIsNone(when(""))
        self.assertIsNone(when(None))

    def test_detect_matches_columns_by_meaning_across_platforms(self):
        myntra_headers = ["Order Release Id", "Order Created Date", "Seller SKU Code",
                          "Final Amount", "Order Status"]
        mapping, missing = detect(myntra_headers, "orders")
        self.assertEqual(missing, [])
        self.assertEqual(mapping["order_id"], "Order Release Id")
        self.assertEqual(mapping["sku"], "Seller SKU Code")
        self.assertEqual(mapping["amount"], "Final Amount")

    def test_detect_reports_missing_required_columns(self):
        mapping, missing = detect(["Some Random Column"], "orders")
        self.assertIn("order_id", missing)
        self.assertIn("sku", missing)
        self.assertIn("amount", missing)

    def test_detect_respects_a_manual_override(self):
        mapping, missing = detect(["Col A", "Col B"], "orders",
                                  override={"order_id": "Col A", "sku": "Col A",
                                           "amount": "Col A", "order_date": "Col A"})
        self.assertEqual(mapping["order_id"], "Col A")

    def test_override_to_a_column_not_in_the_file_is_rejected(self):
        with self.assertRaises(ImportError_):
            detect(["Col A"], "orders", override={"order_id": "Nonexistent"})

    def test_read_table_parses_csv_with_bom_and_various_delimiters(self):
        raw = "﻿Order ID,SKU,Amount\nORD1,SKU1,999.00\nORD2,SKU2,499.00\n".encode("utf-8")
        headers, rows = read_table("orders.csv", raw)
        self.assertEqual(headers, ["Order ID", "SKU", "Amount"])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["Order ID"], "ORD1")

    def test_read_table_rejects_oversized_files(self):
        raw = b"a" * (26 * 1024 * 1024)
        with self.assertRaises(ImportError_):
            read_table("huge.csv", raw)

    def test_read_table_rejects_legacy_xls(self):
        with self.assertRaises(ImportError_):
            read_table("report.xls", b"binary junk")

    def test_read_table_finds_the_header_row_in_an_excel_report_with_a_title_block(self):
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(["Myntra Order Report"])
        ws.append([])
        ws.append(["Order Release Id", "Order Created Date", "Seller SKU Code", "Final Amount"])
        ws.append(["ORD1", "2026-09-01", "SKU1", 999.0])
        buf = io.BytesIO()
        wb.save(buf)
        headers, rows = read_table("myntra.xlsx", buf.getvalue())
        self.assertIn("Order Release Id", headers)
        self.assertEqual(len(rows), 1)


class FileImportEndToEnd(Base):
    def test_uploading_a_myntra_style_report_writes_orders(self):
        conn = self.connection("myntra", external_account_id="upload")
        db.session.commit()
        from app.services.file_import_service import OrderReportConnector
        connector = OrderReportConnector(conn)

        csv_data = (
            "Order Release Id,Order Created Date,Seller SKU Code,Final Amount,Order Status\n"
            "ORD1,2026-09-01,SKU1,999.00,Delivered\n"
            "ORD1,2026-09-01,SKU2,499.00,Delivered\n"
            "ORD2,2026-09-02,SKU3,1500.00,Cancelled\n"
        ).encode("utf-8")

        summary = connector.import_file("myntra_orders.csv", csv_data)
        self.assertEqual(summary["orders"], 2)

        combined = Order.query.filter_by(brand_id=self.brand.id, channel="myntra",
                                         external_order_id="ORD1").first()
        self.assertEqual(len(combined.items), 2)
        self.assertAlmostEqual(combined.gross_amount, 999 + 499)
        self.assertFalse(combined.is_cancelled)

        cancelled = Order.query.filter_by(brand_id=self.brand.id, channel="myntra",
                                          external_order_id="ORD2").first()
        self.assertTrue(cancelled.is_cancelled)

    def test_upload_with_missing_column_asks_for_a_mapping_not_silent_failure(self):
        conn = self.connection("myntra", external_account_id="upload")
        db.session.commit()
        from app.services.file_import_service import OrderReportConnector
        connector = OrderReportConnector(conn)
        csv_data = "Weird Header 1,Weird Header 2\nx,y\n".encode("utf-8")
        with self.assertRaises(ImportError_) as ctx:
            connector.import_file("mystery.csv", csv_data)
        self.assertIn("order_id", ctx.exception.missing)

    def test_upload_via_the_api_returns_the_mapping_fields_on_failure(self):
        resp = self.client.post(
            f"/api/brands/{self.brand.id}/connectors/myntra/import",
            headers=self.auth(),
            data={"file": (io.BytesIO(b"Col A,Col B\n1,2\n"), "report.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 422)
        payload = resp.get_json()
        self.assertEqual(payload["code"], "mapping_needed")
        self.assertIn("fields", payload["details"])


# ── Ad platforms: the shared upsert never duplicates a campaign-day ────────

class AdsWriterTests(Base):
    def test_re_syncing_the_same_campaign_day_replaces_rather_than_adds(self):
        upsert_ad_day(self.brand.id, "meta_ads", campaign_id="c1", day=date(2026, 9, 1),
                     campaign_name="Prospecting", spend=100.0, impressions=1000, clicks=50,
                     purchases=2, attributed_revenue=400.0)
        db.session.commit()
        upsert_ad_day(self.brand.id, "meta_ads", campaign_id="c1", day=date(2026, 9, 1),
                     campaign_name="Prospecting", spend=150.0, impressions=1500, clicks=70,
                     purchases=3, attributed_revenue=600.0)
        db.session.commit()
        rows = AdSpendRecord.query.filter_by(brand_id=self.brand.id, platform="meta_ads",
                                             campaign_id="c1", date=date(2026, 9, 1)).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].spend, 150.0)
        self.assertEqual(rows[0].roas, round(600 / 150, 2))

    def test_roas_and_cac_are_derived_not_trusted_from_input(self):
        row = upsert_ad_day(self.brand.id, "google_ads", campaign_id="c2", day=date(2026, 9, 1),
                            spend=200.0, purchases=4, attributed_revenue=1000.0)
        self.assertEqual(row.roas, 5.0)
        self.assertEqual(row.cac, 50.0)

    def test_zero_spend_does_not_divide_by_zero(self):
        row = upsert_ad_day(self.brand.id, "ga4", campaign_id="channel:organic", day=date(2026, 9, 1),
                            spend=0.0, purchases=0, attributed_revenue=0.0)
        self.assertEqual(row.roas, 0.0)
        self.assertEqual(row.cac, 0.0)


# ── Connector factory: every catalogue entry is internally consistent ──────

class CatalogTests(unittest.TestCase):
    def test_every_entry_has_a_working_connector_class(self):
        for entry in CATALOG:
            self.assertTrue(hasattr(entry["connector"], "sync"), entry["id"])

    def test_every_credentials_entry_declares_at_least_one_required_path(self):
        for entry in CATALOG:
            if entry["auth"] != "credentials":
                continue
            fields = entry.get("fields") or []
            self.assertTrue(fields, entry["id"])
            groups = entry.get("one_of")
            if groups:
                for group in groups:
                    for key in group:
                        self.assertIn(key, {f["key"] for f in fields}, f"{entry['id']}.{key}")
            else:
                required = [f for f in fields if f["required"]]
                self.assertTrue(required, entry["id"])

    def test_file_entries_declare_a_known_kind(self):
        for entry in CATALOG:
            if entry["auth"] == "file":
                self.assertIn(entry.get("kind", "orders"), ("orders", "payments"), entry["id"])

    def test_spec_lookup_matches_catalog(self):
        self.assertEqual(spec("razorpay")["name"], "Razorpay")
        self.assertIsNone(spec("not-a-real-platform"))


# ── The credentials API: test-before-store, never echo secrets ─────────────

class CredentialsApi(Base):
    def test_bad_credentials_are_rejected_and_never_stored(self):
        resp = self.client.post(
            f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
            headers=self.auth(), json={"key_id": "rzp_test_x", "key_secret": "wrong"},
        )
        with mock.patch("requests.request", return_value=fake_response(401)):
            resp = self.client.post(
                f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
                headers=self.auth(), json={"key_id": "rzp_test_x", "key_secret": "wrong"},
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Connection.query.filter_by(brand_id=self.brand.id, platform="razorpay").count(), 0)

    def test_good_credentials_are_tested_then_stored_encrypted(self):
        probe = fake_response(200, {"items": []})
        with mock.patch("requests.request", return_value=probe):
            resp = self.client.post(
                f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
                headers=self.auth(), json={"key_id": "rzp_test_x", "key_secret": "realvalue"},
            )
        self.assertEqual(resp.status_code, 201)
        data = body(resp)
        self.assertEqual(data["status"], "connected")
        self.assertNotIn("realvalue", resp.get_data(as_text=True))
        conn = Connection.query.filter_by(brand_id=self.brand.id, platform="razorpay").first()
        self.assertIsNotNone(conn)
        self.assertEqual(creds.load(conn)["key_secret"], "realvalue")

    def test_missing_required_field_is_rejected_before_any_network_call(self):
        with mock.patch("requests.request") as m:
            resp = self.client.post(
                f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
                headers=self.auth(), json={"key_id": "rzp_test_x"},
            )
        self.assertEqual(resp.status_code, 400)
        m.assert_not_called()

    def test_a_viewer_cannot_save_credentials(self):
        viewer = User(email="viewer@example.test", full_name="Viewer")
        viewer.set_password("a-long-test-password")
        db.session.add(viewer)
        db.session.flush()
        db.session.add(BrandMember(brand_id=self.brand.id, user_id=viewer.id, role="viewer"))
        db.session.commit()
        viewer_token = create_access_token(identity=viewer.id)
        resp = self.client.post(
            f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
            headers=self.auth(viewer_token), json={"key_id": "x", "key_secret": "y"},
        )
        self.assertEqual(resp.status_code, 403)

    def test_editing_a_connection_can_leave_secret_fields_blank_to_keep_them(self):
        probe = fake_response(200, {"items": []})
        with mock.patch("requests.request", return_value=probe):
            resp = self.client.post(
                f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
                headers=self.auth(), json={"key_id": "rzp_test_x", "key_secret": "original"},
            )
        conn_id = body(resp)["id"]
        with mock.patch("requests.request", return_value=probe):
            resp2 = self.client.post(
                f"/api/brands/{self.brand.id}/connectors/razorpay/credentials",
                headers=self.auth(),
                json={"connection_id": conn_id, "key_id": "rzp_test_x_renamed"},
            )
        self.assertEqual(resp2.status_code, 200)
        conn = Connection.query.get(conn_id)
        self.assertEqual(creds.load(conn)["key_secret"], "original")
        self.assertEqual(creds.load(conn)["key_id"], "rzp_test_x_renamed")


# ── Sync API: status transitions, partial syncs, crash safety ──────────────

class SyncApi(Base):
    def test_sync_failure_sets_error_status_and_a_readable_message(self):
        conn = self.connection("razorpay")
        creds.save(conn, {"key_id": "x", "key_secret": "y"}, secret_keys={"key_secret"})
        db.session.commit()
        with mock.patch("requests.request", return_value=fake_response(500)):
            resp = self.client.post(f"/api/brands/{self.brand.id}/connectors/{conn.id}/sync",
                                    headers=self.auth())
        self.assertEqual(resp.status_code, 502)
        db.session.refresh(conn)
        self.assertEqual(conn.status, "error")
        self.assertIsNotNone(conn.last_error)

    def test_a_disconnected_source_cannot_be_synced(self):
        conn = self.connection("razorpay")
        conn.status = "disconnected"
        db.session.commit()
        resp = self.client.post(f"/api/brands/{self.brand.id}/connectors/{conn.id}/sync",
                                headers=self.auth())
        self.assertEqual(resp.status_code, 400)

    def test_an_unexpected_crash_never_leaks_a_stack_trace_or_sticks_on_syncing(self):
        conn = self.connection("razorpay")
        creds.save(conn, {"key_id": "x", "key_secret": "y"}, secret_keys={"key_secret"})
        db.session.commit()
        with mock.patch("requests.request", side_effect=RuntimeError("boom, unexpected")):
            resp = self.client.post(f"/api/brands/{self.brand.id}/connectors/{conn.id}/sync",
                                    headers=self.auth())
        self.assertEqual(resp.status_code, 500)
        self.assertNotIn("RuntimeError", resp.get_data(as_text=True))
        db.session.refresh(conn)
        self.assertNotEqual(conn.status, "syncing")

    def test_disconnect_forgets_credentials_but_keeps_synced_history(self):
        conn = self.connection("razorpay")
        creds.save(conn, {"key_id": "x", "key_secret": "y"}, secret_keys={"key_secret"})
        db.session.commit()
        from app.services.writers import upsert_payment
        upsert_payment(self.brand.id, "razorpay", "pay_kept", amount=100.0,
                       occurred_at=datetime.now(timezone.utc))
        db.session.commit()

        resp = self.client.delete(f"/api/brands/{self.brand.id}/connectors/{conn.id}",
                                  headers=self.auth())
        self.assertEqual(resp.status_code, 200)
        db.session.refresh(conn)
        self.assertEqual(conn.status, "disconnected")
        self.assertEqual(creds.load(conn), {})
        self.assertEqual(PaymentTransaction.query.filter_by(external_id="pay_kept").count(), 1)


# ── Facts endpoint: fees and shipping attribute across every source ────────

class CrossSourceFacts(Base):
    def seed_shopify_order(self, order_id, name, day, total, cod=False):
        from app.services.shopify_service import ShopifyConnector

        conn = Connection.query.filter_by(brand_id=self.brand.id, platform="shopify").first()
        if conn is None:
            conn = Connection(brand_id=self.brand.id, platform="shopify",
                              external_account_id="demo.myshopify.com", access_token="tok",
                              status="connected")
            db.session.add(conn)
            db.session.commit()
        connector = ShopifyConnector(conn)
        node = {
            "id": order_id, "name": name, "test": False,
            "createdAt": f"{day}T08:00:00Z", "cancelledAt": None, "taxesIncluded": True,
            "currencyCode": "INR", "presentmentCurrencyCode": "INR",
            "totalPriceSet": {"presentmentMoney": {"amount": str(total), "currencyCode": "INR"}},
            "displayFinancialStatus": "PAID", "displayFulfillmentStatus": "FULFILLED",
            "paymentGatewayNames": ["cash on delivery"] if cod else ["razorpay"],
            "totalDiscountsSet": {"shopMoney": {"amount": "0"}},
            "totalShippingPriceSet": {"shopMoney": {"amount": "0"}},
            "totalTaxSet": {"shopMoney": {"amount": "0"}},
            "totalRefundedSet": {"shopMoney": {"amount": "0"}},
            "lineItems": {"pageInfo": {"hasNextPage": False}, "nodes": [{
                "id": f"{order_id}-line", "name": "Widget", "sku": f"SKU-{order_id[-1]}", "quantity": 1,
                "originalUnitPriceSet": {"shopMoney": {"amount": str(total)}},
                "product": {"id": f"gid://p/{order_id[-1]}", "title": "Widget", "productType": "Home",
                           "category": {"name": "Home"}},
                "variant": {"id": f"gid://v/{order_id[-1]}", "title": "Default", "sku": f"SKU-{order_id[-1]}",
                           "inventoryItem": {"unitCost": None}},
            }]},
            "refunds": [],
        }
        connector._upsert_order(node)
        db.session.commit()
        return conn

    def test_gateway_fees_attribute_only_to_that_days_prepaid_sales_not_cod(self):
        self.seed_shopify_order("gid://o/1", "#2001", "2026-09-10", 1000, cod=False)
        self.seed_shopify_order("gid://o/2", "#2002", "2026-09-10", 500, cod=True)

        from app.services.writers import upsert_payment
        upsert_payment(self.brand.id, "razorpay", "pay_x", order_ref="#2001", amount=1000.0,
                      fee=30.0, occurred_at=datetime(2026, 9, 10, 12, 0, tzinfo=timezone.utc))
        db.session.commit()

        resp = self.client.get(f"/api/brands/{self.brand.id}/facts?start=2026-09-10&end=2026-09-10",
                               headers=self.auth())
        data = body(resp)
        rows_by_order_gross = {r["grossSales"]: r for r in data["rows"]}
        prepaid_row = rows_by_order_gross[1000.0]
        cod_row = rows_by_order_gross[500.0]
        self.assertAlmostEqual(prepaid_row["fees"], 30.0)
        self.assertEqual(cod_row["fees"], 0.0)  # COD: no gateway involved
        self.assertTrue(data["available"]["fees"])

    def test_a_marketplace_order_with_no_fee_source_reports_fees_as_null(self):
        upsert_order(
            self.brand.id, "amazon", "AMZ-99", order_name="AMZ-99",
            order_date=datetime(2026, 9, 10, tzinfo=timezone.utc),
            lines=[{"sku": "SKU9", "quantity": 1, "unit_price": 800}], currency="INR",
        )
        db.session.commit()
        resp = self.client.get(f"/api/brands/{self.brand.id}/facts?start=2026-09-10&end=2026-09-10",
                               headers=self.auth())
        data = body(resp)
        row = next(r for r in data["rows"] if r["channel"] == "amazon")
        self.assertIsNone(row["fees"])

    def test_shipping_cost_appears_once_a_shipment_is_linked(self):
        conn = self.seed_shopify_order("gid://o/3", "#2003", "2026-09-10", 999, cod=False)
        order = Order.query.filter_by(brand_id=self.brand.id, order_name="#2003").first()
        order.shipping_cost_amount = 65.0
        db.session.commit()

        resp = self.client.get(f"/api/brands/{self.brand.id}/facts?start=2026-09-10&end=2026-09-10",
                               headers=self.auth())
        data = body(resp)
        row = next(r for r in data["rows"] if r["grossSales"] == 999.0)
        self.assertEqual(row["logistics"], 65.0)

    def test_the_facts_payload_summarises_every_connected_source(self):
        from app.services.writers import upsert_payment, upsert_settlement, upsert_shipment
        upsert_payment(self.brand.id, "razorpay", "pay_a", amount=500.0, fee=15.0, status="captured",
                      occurred_at=datetime(2026, 9, 10, tzinfo=timezone.utc))
        upsert_settlement(self.brand.id, "razorpay", "setl_a", amount=485.0, fees=15.0,
                         settled_at=datetime(2026, 9, 11, tzinfo=timezone.utc))
        upsert_shipment(self.brand.id, "shiprocket", "ship_a", freight=80.0,
                       created_on=datetime(2026, 9, 10, tzinfo=timezone.utc))
        upsert_ad_day(self.brand.id, "meta_ads", campaign_id="c1", day=date(2026, 9, 10),
                     spend=1000.0, attributed_revenue=3000.0)
        db.session.commit()

        resp = self.client.get(f"/api/brands/{self.brand.id}/facts?start=2026-09-10&end=2026-09-11",
                               headers=self.auth())
        data = body(resp)
        self.assertEqual(len(data["payments"]["gateways"]), 1)
        self.assertEqual(data["payments"]["gateways"][0]["gateway"], "razorpay")
        self.assertEqual(len(data["settlements"]["sources"]), 1)
        self.assertEqual(data["shipping"]["shipments"], 1)
        self.assertEqual(len(data["ads"]["platforms"]), 1)
        self.assertEqual(data["ads"]["platforms"][0]["roas"], 3.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
