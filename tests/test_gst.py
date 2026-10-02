"""GST from synced orders and the SKU master.

    python -m unittest tests.test_gst
"""
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from test_shopify import Base, ShopifyConnector, body, line, order_node  # noqa: E402

from app.extensions import db  # noqa: E402
from app.models import Order  # noqa: E402
from app.services.gst_rules import check_gstin, parse_hsn, parse_rate, state_code  # noqa: E402

KA_GSTIN = "29AAPFU0939F1ZR"  # a valid Karnataka GSTIN (checksum included)


class Rules(unittest.TestCase):
    def test_gstin_is_checked_including_its_check_character(self):
        self.assertEqual(check_gstin(KA_GSTIN), (KA_GSTIN, None))
        self.assertEqual(check_gstin(" 29aapfu0939f1zr ")[0], KA_GSTIN)
        self.assertEqual(check_gstin(""), (None, None))
        self.assertIsNotNone(check_gstin("29AAPFU0939F1ZX")[1], "a wrong check character is caught")
        self.assertIsNotNone(check_gstin("ABC")[1])
        self.assertIsNotNone(check_gstin("99AAPFU0939F1ZR")[1], "99 is not a state code")

    def test_rates_from_a_spreadsheet(self):
        for raw in (18, "18", "18%", 0.18, " 18 "):
            self.assertEqual(parse_rate(raw), (18.0, None), raw)
        self.assertEqual(parse_rate(12.5), (12.5, None))
        self.assertEqual(parse_rate(""), (None, None))
        self.assertEqual(parse_rate(0), (0.0, None), "zero-rated is a real rate, not blank")
        self.assertIsNotNone(parse_rate("abc")[1])
        self.assertIsNotNone(parse_rate(45)[1])
        self.assertIsNotNone(parse_rate(-5)[1])

    def test_hsn_survives_excel_and_rejects_wrong_lengths(self):
        self.assertEqual(parse_hsn("6302"), ("6302", None))
        self.assertEqual(parse_hsn(6302.0), ("6302", None))
        self.assertEqual(parse_hsn("63021000"), ("63021000", None))
        self.assertEqual(parse_hsn(""), (None, None))
        self.assertIsNotNone(parse_hsn("63")[1])
        self.assertIsNotNone(parse_hsn("63A2")[1])

    def test_state_names_as_shopify_writes_them(self):
        self.assertEqual(state_code("Karnataka"), "29")
        self.assertEqual(state_code("  tamil  nadu "), "33")
        self.assertEqual(state_code("Delhi"), "07")
        self.assertEqual(state_code("Orissa"), "21")
        self.assertIsNone(state_code("Atlantis"))
        self.assertIsNone(state_code(None))


class Gst(Base):
    def seed(self):
        connector = ShopifyConnector(self.connection())
        connector._upsert_order(order_node(4001, [line(1, 2, 1000, sku="BED-K", ptype="Bedding")],
                                           created="2026-09-10T08:00:00Z"))
        connector._upsert_order(order_node(4002, [line(2, 1, 500, product="2", variant="21", sku="PIL", ptype="Pillow")],
                                           created="2026-09-11T08:00:00Z"))
        connector._upsert_order(order_node(4003, [line(3, 1, 700, sku="BED-K")],
                                           created="2026-09-11T09:00:00Z", cancelled="2026-09-11T10:00:00Z"))
        db.session.commit()

    def url(self, tail=""):
        return f"/api/brands/{self.brand.id}/gst{tail}"

    def get(self, tail="", token=None):
        return self.client.get(self.url(tail), headers=self.auth(token))

    def put_settings(self, **payload):
        return self.client.put(self.url("/settings"), json=payload, headers=self.auth())

    def upload(self, csv_text, name="skus.csv"):
        return self.client.post(
            self.url("/skus/import"), headers=self.auth(),
            data={"file": (io.BytesIO(csv_text.encode()), name)}, content_type="multipart/form-data",
        )

    # ── the report on its own ───────────────────────────────────────────────

    def test_with_nothing_set_up_it_reports_values_and_names_every_gap(self):
        self.seed()
        data = body(self.get())
        self.assertEqual(data["orderCount"], 2, "the cancelled order is left out")
        self.assertAlmostEqual(sum(r["net"] for r in data["rows"]), 2000 + 500)
        self.assertTrue(all(r["rate"] is None and r["supply"] == "unknown" for r in data["rows"]),
                        "no rate and no state are left unknown, not invented")
        self.assertEqual(data["unmappedSkuCount"], 2)
        self.assertEqual(data["unmappedSkus"][0]["sku"], "BED-K", "the biggest gap is listed first")
        self.assertIsNone(data["settings"]["gstin"])

    def test_requires_a_signed_in_member(self):
        self.assertEqual(self.client.get(self.url()).status_code, 401)
        self.assertEqual(self.client.get(self.url("/skus")).status_code, 401)

    # ── settings ────────────────────────────────────────────────────────────

    def test_settings_validate_the_gstin_and_derive_the_home_state(self):
        bad = self.put_settings(gstin="29AAPFU0939F1ZX")
        self.assertEqual(bad.status_code, 400)
        ok = self.put_settings(gstin=KA_GSTIN, defaultRate=5)
        self.assertEqual(ok.status_code, 200)
        s = body(self.get("/settings"))
        self.assertEqual((s["stateCode"], s["stateName"], s["defaultRate"]), ("29", "Karnataka", 5.0))
        self.assertEqual(self.put_settings(defaultRate=99).status_code, 400)
        # Clearing the default is allowed.
        self.assertIsNone(body(self.put_settings(defaultRate=""))["defaultRate"])

    # ── the sheet ───────────────────────────────────────────────────────────

    def test_sheet_sets_rate_hsn_and_category_and_the_report_uses_them(self):
        self.seed()
        resp = self.upload("SKU,Category,HSN,GST rate\nBED-K,Bed linen,6302,5%\nPIL,,,0.12\n")
        data = body(resp)
        self.assertEqual((resp.status_code, data["created"], data["updated"], data["skippedCount"]), (200, 2, 0, 0))

        rows = body(self.get())["rows"]
        bed = next(r for r in rows if r["category"] == "Bed linen")
        self.assertEqual((bed["rate"], bed["hsn"]), (5.0, "6302"))
        pillow = next(r for r in rows if r["net"] == 500)
        self.assertEqual(pillow["rate"], 12.0, "a spreadsheet 0.12 is 12%")
        self.assertEqual(pillow["category"], "Pillow", "no category in the sheet: the store's product type stays")
        self.assertEqual(body(self.get())["unmappedSkuCount"], 0)

    def test_a_blank_cell_keeps_what_is_saved_and_a_bad_cell_skips_only_its_row(self):
        self.seed()
        self.upload("SKU,HSN,GST rate\nBED-K,6302,5\nPIL,6304,12\n")
        data = body(self.upload("SKU,HSN,GST rate\nBED-K,,18\nPIL,99,12\nGHOST,6302,5\n"))
        self.assertEqual(data["updated"], 1)
        self.assertEqual(data["skippedCount"], 1)
        self.assertIn("4, 6 or 8 digits", data["skipped"][0]["reason"])
        self.assertEqual(data["notInOrders"], ["GHOST"], "an unknown SKU is saved but flagged as a possible typo")

        skus = {s["sku"]: s for s in body(self.get("/skus"))["skus"]}
        self.assertEqual((skus["BED-K"]["hsn"], skus["BED-K"]["gstRate"]), ("6302", 18.0))
        self.assertEqual((skus["PIL"]["hsn"], skus["PIL"]["gstRate"]), ("6304", 12.0), "the bad row changed nothing")

    def test_a_sheet_without_a_sku_column_is_refused_with_what_it_found(self):
        resp = self.upload("Item,Rate\nA,5\n")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("SKU column", resp.get_json()["message"])
        self.assertEqual(self.upload("SKU,Name\nA,x\n").status_code, 400)

    def test_excel_style_numeric_skus_and_duplicate_rows(self):
        self.seed()
        data = body(self.upload("SKU,GST rate\nPIL,12\npil,18\n"))
        self.assertEqual(data["skippedCount"], 1, "a repeated SKU keeps its first row")
        self.assertEqual(next(s for s in body(self.get("/skus"))["skus"] if s["sku"] == "PIL")["gstRate"], 12.0)

    def test_sku_list_says_which_are_complete(self):
        self.seed()
        self.upload("SKU,Category,HSN,GST rate\nBED-K,Bed linen,6302,5\n")
        data = body(self.get("/skus"))
        self.assertEqual((data["total"], data["complete"]), (2, 1))

    # ── place of supply ─────────────────────────────────────────────────────

    def test_supply_is_intra_inter_or_unknown_never_guessed(self):
        self.seed()
        db.session.query(Order).filter_by(order_name="#4001").update({"shipping_state": "Karnataka"})
        db.session.query(Order).filter_by(order_name="#4002").update({"shipping_state": "Maharashtra"})
        db.session.commit()

        # Without a GSTIN the home state is unknown, so nothing can be placed.
        self.assertEqual({r["supply"] for r in body(self.get())["rows"]}, {"unknown"})

        self.put_settings(gstin=KA_GSTIN)
        data = body(self.get())
        by_net = {r["net"]: r["supply"] for r in data["rows"]}
        self.assertEqual(by_net[2000], "intra")
        self.assertEqual(by_net[500], "inter")
        self.assertEqual(data["statesKnown"], 2)

    def test_a_state_shopify_did_not_send_stays_unknown(self):
        self.seed()
        self.put_settings(gstin=KA_GSTIN)
        db.session.query(Order).filter_by(order_name="#4001").update({"shipping_state": "Karnataka"})
        db.session.commit()
        data = body(self.get())
        self.assertEqual({r["net"]: r["supply"] for r in data["rows"]}, {2000.0: "intra", 500.0: "unknown"})

    def test_the_period_window_uses_the_shops_days(self):
        self.seed()
        data = body(self.get("?start=2026-09-11&end=2026-09-11"))
        self.assertEqual(data["orderCount"], 1)
        none = body(self.get("?start=2026-01-01&end=2026-01-02"))
        self.assertEqual(none["orderCount"], 0)


class ShopifyState(Base):
    def test_the_ship_to_state_is_saved_from_the_order(self):
        node = order_node(5001, [line(1, 1, 900)])
        node["shippingAddress"] = {"provinceCode": "KA", "province": "Karnataka"}
        ShopifyConnector(self.connection())._upsert_order(node)
        db.session.commit()
        self.assertEqual(Order.query.filter_by(order_name="#5001").one().shipping_state, "Karnataka")

    def test_an_order_with_no_address_leaves_the_state_alone(self):
        conn = ShopifyConnector(self.connection())
        first = order_node(5002, [line(1, 1, 900)])
        first["shippingAddress"] = {"provinceCode": "TN", "province": "Tamil Nadu"}
        conn._upsert_order(first)
        conn._upsert_order(order_node(5002, [line(1, 1, 900)]))  # re-synced, no address this time
        db.session.commit()
        self.assertEqual(Order.query.filter_by(order_name="#5002").one().shipping_state, "Tamil Nadu")


if __name__ == "__main__":
    unittest.main(verbosity=2)
