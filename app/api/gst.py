"""GST, from synced orders and what the brand says about its SKUs.

The figures are an ESTIMATE and this module is built so that cannot be mistaken
for a filing:

- The server returns the NET VALUE of what was sold, grouped by day, category,
  HSN, the SKU's own rate (or none) and whether the customer is in the
  brand's own state. It never applies a fallback rate: a SKU with no rate comes
  back with rate null, and the caller decides (and shows) what it was estimated
  at.
- Cancelled orders are left out; refunded line value is taken off.
- Shipping charged is its own line, since it is taxable too.
- Whatever cannot be known stays unknown: a customer with no state is
  "unknown" supply, not silently intra- or inter-state.

Nothing here is required up front. A brand with no SKU sheet, no GSTIN and no
customer states still gets a total — with every gap counted and named.
"""
from collections import defaultdict

from flask import Blueprint, request

from app.api.facts import _local_day, _parse_day, _shop_calendar
from app.extensions import db
from app.models import Connection, Order, OrderItem
from app.models.gst import GstSettings, SkuMaster
from app.services.file_import_service import ImportError_, read_table
from app.services.gst_rules import check_gstin, parse_hsn, parse_rate, state_code
from app.utils.decorators import brand_access_required, role_required
from app.utils.responses import error, ok

gst_bp = Blueprint("gst", __name__)

MAX_DEFAULT = 40


def _settings(brand_id):
    return GstSettings.query.get(brand_id)


def _settings_payload(brand_id):
    s = _settings(brand_id)
    return s.to_dict() if s else {"gstin": None, "stateCode": None, "stateName": None, "defaultRate": None}


# ── The report ───────────────────────────────────────────────────────────────

@gst_bp.get("")
@brand_access_required
def get_gst(brand_id, role):
    start_day, end_day = request.args.get("start"), request.args.get("end")
    if (start_day and not _parse_day(start_day)) or (end_day and not _parse_day(end_day)):
        return error("start and end must be YYYY-MM-DD", status=400)

    tz, tz_name = _shop_calendar(Connection.query.filter_by(brand_id=brand_id).all())
    settings = _settings_payload(brand_id)
    home = settings["stateCode"]

    skus = {m.sku.lower(): m for m in SkuMaster.query.filter_by(brand_id=brand_id).all()}

    orders = Order.query.filter(Order.brand_id == brand_id, Order.is_cancelled.is_(False)).all()
    lines_by_order = defaultdict(list)
    ids = [o.id for o in orders]
    # Chunked so a large store never exceeds the database's parameter limit.
    for i in range(0, len(ids), 500):
        for item in OrderItem.query.filter(OrderItem.order_id.in_(ids[i:i + 500])).all():
            lines_by_order[item.order_id].append(item)

    buckets = {}
    recorded = defaultdict(float)
    unmapped = {}      # sku -> what it is worth, so the biggest gaps can be named
    no_sku_value = 0.0
    counted = 0
    states_known = 0

    for order in orders:
        day = _local_day(order.order_date, tz)
        if (start_day and day < start_day) or (end_day and day > end_day):
            continue
        counted += 1
        code = state_code(order.shipping_state)
        states_known += 1 if code else 0
        if code and home:
            supply = "intra" if code == home else "inter"
        else:
            supply = "unknown"
        inclusive = bool(order.taxes_included)
        recorded[day] += order.tax_amount or 0.0

        for item in lines_by_order.get(order.id, ()):
            net = (item.line_total or 0.0) - (item.discount_allocated or 0.0) - (item.returned_amount or 0.0)
            master = skus.get((item.sku or "").lower()) if item.sku else None
            category = (master.category if master and master.category else None) \
                or item.product_type or "Uncategorised"
            hsn = master.hsn if master else None
            rate = master.gst_rate if master else None
            key = (day, category, hsn, rate, inclusive, supply)
            b = buckets.setdefault(key, {"net": 0.0, "orders": set()})
            b["net"] += net
            b["orders"].add(order.id)
            if rate is None:
                if item.sku:
                    entry = unmapped.setdefault(item.sku, {"sku": item.sku, "name": item.product_name, "net": 0.0})
                    entry["net"] += net
                else:
                    no_sku_value += net

        if order.shipping_amount:
            key = (day, "Shipping charged", None, None, inclusive, supply)
            b = buckets.setdefault(key, {"net": 0.0, "orders": set()})
            b["net"] += order.shipping_amount
            b["orders"].add(order.id)

    worst = sorted(unmapped.values(), key=lambda e: e["net"], reverse=True)
    return ok({
        "timezone": tz_name,
        "currency": next((o.currency for o in orders if o.currency), "INR"),
        "orderCount": counted,
        "statesKnown": states_known,
        "settings": settings,
        "rows": [
            {"day": d, "category": c, "hsn": h, "rate": r, "inclusive": inc, "supply": sup,
             "net": round(v["net"], 2), "orders": len(v["orders"])}
            for (d, c, h, r, inc, sup), v in sorted(buckets.items(), key=lambda kv: tuple("" if x is None else str(x) for x in kv[0]))
        ],
        "recorded": [{"day": d, "tax": round(t, 2)} for d, t in sorted(recorded.items()) if t],
        "unmappedSkus": [{**e, "net": round(e["net"], 2)} for e in worst[:25]],
        "unmappedSkuCount": len(worst),
        "noSkuValue": round(no_sku_value, 2),
    })


# ── Brand GST identity ───────────────────────────────────────────────────────

@gst_bp.get("/settings")
@brand_access_required
def get_settings(brand_id, role):
    return ok(_settings_payload(brand_id))


@gst_bp.put("/settings")
@brand_access_required
@role_required("owner", "admin")
def put_settings(brand_id, role):
    body = request.get_json(silent=True) or {}
    s = _settings(brand_id) or GstSettings(brand_id=brand_id)
    if "gstin" in body:
        gstin, why = check_gstin(body["gstin"])
        if why:
            return error(why, status=400)
        s.gstin = gstin
    if "defaultRate" in body:
        raw = body["defaultRate"]
        if raw in (None, ""):
            s.default_rate = None
        else:
            rate, why = parse_rate(f"{raw}%")
            if why:
                return error(why, status=400)
            s.default_rate = rate
    db.session.add(s)
    db.session.commit()
    return ok(s.to_dict())


# ── The SKU master ───────────────────────────────────────────────────────────

def _sold_skus(brand_id):
    """Every SKU that has appeared on an order, with what it is called."""
    rows = (
        db.session.query(OrderItem.sku, OrderItem.product_name, OrderItem.variant_title, OrderItem.product_type)
        .join(Order, OrderItem.order_id == Order.id)
        .filter(Order.brand_id == brand_id, OrderItem.sku.isnot(None), OrderItem.sku != "")
        .distinct().all()
    )
    seen = {}
    for sku, name, variant, ptype in rows:
        seen.setdefault(sku.lower(), {"sku": sku, "name": name, "variant": variant, "productType": ptype})
    return seen


@gst_bp.get("/skus")
@brand_access_required
def list_skus(brand_id, role):
    sold = _sold_skus(brand_id)
    master = {m.sku.lower(): m for m in SkuMaster.query.filter_by(brand_id=brand_id).all()}
    out = []
    for key in sorted(set(sold) | set(master)):
        s, m = sold.get(key), master.get(key)
        out.append({
            "sku": (s or {}).get("sku") or m.sku,
            "name": (s or {}).get("name"),
            "variant": (s or {}).get("variant"),
            "sold": s is not None,
            "category": m.category if m else None,
            "hsn": m.hsn if m else None,
            "gstRate": m.gst_rate if m else None,
        })
    complete = sum(1 for r in out if r["category"] and r["hsn"] and r["gstRate"] is not None)
    return ok({"skus": out, "total": len(out), "complete": complete})


_HEADERS = {
    "sku": {"sku", "skucode", "variantsku", "itemcode", "sellersku", "code"},
    "category": {"category", "productcategory", "producttype", "type"},
    "hsn": {"hsn", "hsncode", "hsnsac", "hsnsaccode", "sac"},
    "rate": {"gstrate", "gst", "gstpercent", "gstpercentage", "taxrate", "rate", "gst%"},
}


def _column_for(headers):
    def norm(h):
        return "".join(ch for ch in str(h).lower() if ch.isalnum() or ch == "%")
    found = {}
    for h in headers:
        n = norm(h)
        for field, names in _HEADERS.items():
            if n in names and field not in found:
                found[field] = h
    return found


def _clean_sku(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)  # Excel turns 10045 into 10045.0
    return str(value).strip()


@gst_bp.post("/skus/import")
@brand_access_required
@role_required("owner", "admin")
def import_skus(brand_id, role):
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return error("Choose a CSV or Excel file", status=400)
    try:
        headers, body = read_table(upload.filename, upload.read())
    except ImportError_ as exc:
        return error(str(exc), status=400)

    cols = _column_for(headers)
    if "sku" not in cols:
        return error("The sheet needs a SKU column (found: " + ", ".join(h for h in headers if h) + ")", status=400)
    if not ({"category", "hsn", "rate"} & set(cols)):
        return error("The sheet has a SKU column but none of Category, HSN or GST rate", status=400)

    existing = {m.sku.lower(): m for m in SkuMaster.query.filter_by(brand_id=brand_id).all()}
    sold = _sold_skus(brand_id)
    created = updated = 0
    skipped, not_in_orders, seen_in_sheet = [], [], set()

    for n, row in enumerate(body, start=2):  # row 1 is the header
        sku = _clean_sku(row.get(cols["sku"]))
        if not sku:
            continue
        if sku.lower() in seen_in_sheet:
            skipped.append({"row": n, "sku": sku, "reason": "Listed twice — the first row was used"})
            continue
        seen_in_sheet.add(sku.lower())

        problems, fields = [], {}
        if "rate" in cols:
            rate, why = parse_rate(row.get(cols["rate"]))
            problems += [why] if why else []
            if rate is not None:
                fields["gst_rate"] = rate
        if "hsn" in cols:
            hsn, why = parse_hsn(row.get(cols["hsn"]))
            problems += [why] if why else []
            if hsn is not None:
                fields["hsn"] = hsn
        if "category" in cols:
            cat = str(row.get(cols["category"]) or "").strip()
            if cat:
                fields["category"] = cat[:120]
        if problems:
            skipped.append({"row": n, "sku": sku, "reason": "; ".join(problems)})
            continue
        if not fields:
            continue  # a blank row leaves what is already saved alone

        m = existing.get(sku.lower())
        if m is None:
            m = SkuMaster(brand_id=brand_id, sku=sku)
            db.session.add(m)
            existing[sku.lower()] = m
            created += 1
        else:
            updated += 1
        for k, v in fields.items():
            setattr(m, k, v)
        if sku.lower() not in sold:
            not_in_orders.append(sku)

    db.session.commit()
    return ok({
        "created": created, "updated": updated,
        "skipped": skipped[:50], "skippedCount": len(skipped),
        "notInOrders": not_in_orders[:50], "notInOrdersCount": len(not_in_orders),
        "columns": {k: v for k, v in cols.items()},
    })
