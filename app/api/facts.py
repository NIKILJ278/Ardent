"""Live fact rows for the dashboard.

The dashboard derives every figure from one fact table at
(day × channel × product × variant). This endpoint builds that table from
synced orders, so the dashboard's arithmetic is unchanged — only its source is
real.

Costs are filled in from whichever source measured them:

- marketplace fees from the marketplace itself (Amazon's finance events, or a
  fee column in an uploaded report), spread over the order's lines by value;
- payment gateway fees from the gateway, totalled per day and spread over that
  day's prepaid storefront sales by value — exact per day and channel;
- courier cost from the shipping aggregator, matched to the order it shipped.

A cost nobody measured is returned as null, never zero. A zero reads as "free";
null lets the dashboard say plainly which source is missing. A row's cost is
null if any order in it lacks the measurement, the same rule as cost of goods.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, current_app, request

from app.models import (
    AdSpendRecord, Brand, Connection, Order, OrderItem, PaymentTransaction, ReturnRecord, Settlement,
    Shipment,
)
from app.utils.decorators import brand_access_required
from app.utils.responses import error, ok

facts_bp = Blueprint("facts", __name__)

CHANNELS = {
    "shopify": {"id": "shopify", "name": "Shopify", "kind": "owned"},
    "amazon": {"id": "amazon", "name": "Amazon", "kind": "marketplace"},
    "flipkart": {"id": "flipkart", "name": "Flipkart", "kind": "marketplace"},
    "myntra": {"id": "myntra", "name": "Myntra", "kind": "marketplace"},
    "nykaa": {"id": "nykaa", "name": "Nykaa", "kind": "marketplace"},
    "ajio": {"id": "ajio", "name": "AJIO", "kind": "marketplace"},
    "meesho": {"id": "meesho", "name": "Meesho", "kind": "marketplace"},
    "other_marketplace": {"id": "other_marketplace", "name": "Other marketplace", "kind": "marketplace"},
}
OWNED = {k for k, v in CHANNELS.items() if v["kind"] == "owned"}
GATEWAYS = ("razorpay", "payu", "cashfree", "stripe", "phonepe", "paytm", "other_gateway")
SHIPPERS = ("shiprocket",)
ADS = ("meta_ads", "google_ads", "ga4")


def _aware(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _in_window(day, start_day, end_day):
    return not ((start_day and day < start_day) or (end_day and day > end_day))


def _shop_calendar(connections):
    """The timezone the shop books its calendar day in, and its name.

    Read from the store itself and stored on the connection at sync. Falls back
    to configuration only before a first sync has reported one.

    A real zone rather than a fixed offset, because a fixed offset cannot follow
    daylight saving: a store in America/New_York would misfile a day's late
    sales twice a year.
    """
    name = next(
        (c.meta.get("timezone") for c in connections if (c.meta or {}).get("timezone")),
        None,
    ) or current_app.config.get("SHOP_TIMEZONE")
    if name:
        try:
            return ZoneInfo(name), name
        except (ZoneInfoNotFoundError, ValueError):
            current_app.logger.warning("Unknown shop timezone %r; using the configured offset", name)
    offset = int(current_app.config.get("SHOP_UTC_OFFSET_MINUTES", 330))
    sign = "+" if offset >= 0 else "-"
    return timezone(timedelta(minutes=offset)), f"UTC{sign}{abs(offset)//60:02d}:{abs(offset)%60:02d}"


def _local_day(dt, tz):
    """The calendar day the shop itself would book the order on.

    Stored times are UTC. An order at 1am local is the previous day in UTC, so
    grouping on the raw timestamp would push late-night sales into the wrong
    day's totals.
    """
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date().isoformat()


def _parse_day(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d") if value else None
    except ValueError:
        return None


@facts_bp.get("")
@brand_access_required
def get_facts(brand_id, role):
    connections = Connection.query.filter_by(brand_id=brand_id).all()
    shop_tz, tz_name = _shop_calendar(connections)
    start = _parse_day(request.args.get("start"))
    end = _parse_day(request.args.get("end"))
    if (request.args.get("start") and not start) or (request.args.get("end") and not end):
        return error("start and end must be YYYY-MM-DD", status=400)

    query = (
        OrderItem.query.join(Order, OrderItem.order_id == Order.id)
        .filter(Order.brand_id == brand_id)
        .with_entities(Order, OrderItem)
    )
    # Pad by a whole day so a local-day boundary never drops an order; no
    # timezone sits more than 14 hours from UTC. The exact edge is applied below.
    if start:
        query = query.filter(Order.order_date >= start - timedelta(days=1))
    if end:
        query = query.filter(Order.order_date < end + timedelta(days=2))

    pairs = query.all()
    start_day, end_day = request.args.get("start"), request.args.get("end")
    live = {c.platform for c in connections if c.status in ("connected", "error", "syncing")}

    # Gateway fees, per shop day. Refund rows carry their own fee too.
    day_fees = defaultdict(float)
    fee_days = set()
    pay_query = PaymentTransaction.query.filter(
        PaymentTransaction.brand_id == brand_id, PaymentTransaction.gateway.in_(GATEWAYS),
    )
    if start:
        pay_query = pay_query.filter(PaymentTransaction.occurred_at >= start - timedelta(days=1))
    if end:
        pay_query = pay_query.filter(PaymentTransaction.occurred_at < end + timedelta(days=2))
    payments = pay_query.all()
    for p in payments:
        if p.fee is None:
            continue
        day = _local_day(p.occurred_at, shop_tz)
        day_fees[day] += p.fee
        fee_days.add(day)

    # What those fees are spread over: each day's live prepaid storefront sales.
    prepaid_by_day = defaultdict(float)
    for order, item in pairs:
        if order.channel in OWNED and not order.is_cancelled and order.payment_mode != "cod":
            prepaid_by_day[_local_day(order.order_date, shop_tz)] += item.line_total or 0.0
    shipping_live = any(p in live for p in SHIPPERS)

    groups = {}
    order_ids = defaultdict(set)
    order_index = {}
    products = {}
    first_day, last_day = None, None
    fee_lines = [0, 0]  # known, unknown
    ship_lines = [0, 0]

    # What customers actually paid in, counted per order rather than per line.
    presentment = {}

    for order, item in pairs:
        day = _local_day(order.order_date, shop_tz)
        # The query window is padded by the UTC offset so it never drops an
        # order, which means it can also return the neighbouring local day.
        # Apply the exact boundary here, on the day the shop itself books.
        if (start_day and day < start_day) or (end_day and day > end_day):
            continue
        first_day = day if first_day is None or day < first_day else first_day
        last_day = day if last_day is None or day > last_day else last_day

        product_id = item.product_external_id or f"sku:{item.sku}"
        variant_id = item.variant_external_id or f"sku:{item.sku}"
        key = (day, order.channel, item.product_type or "Uncategorised",
               item.subcategory or item.product_type or "Uncategorised", product_id, variant_id)

        row = groups.get(key)
        if row is None:
            row = groups[key] = {
                "date": day, "channel": order.channel,
                "category": key[2], "subcategory": key[3],
                "product": product_id, "variant": variant_id,
                "units": 0, "grossSales": 0.0, "cancelValue": 0.0, "discount": 0.0,
                "returnsValue": 0.0, "returnUnits": 0, "cogs": 0.0,
                "costKnownUnits": 0, "costUnknownUnits": 0,
                "fees": 0.0, "logistics": 0.0, "feeUnknown": 0, "logisticsUnknown": 0,
            }

        qty = item.quantity or 0
        row["units"] += qty
        row["grossSales"] += item.line_total or 0.0
        if order.is_cancelled:
            row["cancelValue"] += item.line_total or 0.0
        else:
            row["discount"] += item.discount_allocated or 0.0
            row["returnsValue"] += item.returned_amount or 0.0
            row["returnUnits"] += item.returned_quantity or 0
            if item.cost_known:
                row["cogs"] += (item.unit_cost or 0.0) * qty
                row["costKnownUnits"] += qty
            else:
                row["costUnknownUnits"] += qty
        order_ids[key].add(order.id)

        # This line's slice of order-level costs, by value.
        line_value = item.line_total or 0.0
        share = (line_value / order.gross_amount) if order.gross_amount else 0.0

        fee = None
        if order.channel in OWNED:
            if order.is_cancelled or order.payment_mode == "cod":
                fee = 0.0  # no gateway took a cut
            elif day in fee_days and prepaid_by_day.get(day):
                fee = day_fees[day] * line_value / prepaid_by_day[day]
        elif order.marketplace_fee_known:
            fee = (order.marketplace_fee_amount or 0.0) * share
        if fee is None:
            row["feeUnknown"] += 1
            fee_lines[1] += 1
        else:
            row["fees"] += fee
            fee_lines[0] += 1

        logistics = None
        if order.shipping_cost_amount is not None:
            logistics = order.shipping_cost_amount * share
        elif order.is_cancelled and not order.is_rto:
            logistics = 0.0  # never left the warehouse
        elif order.channel not in OWNED and order.marketplace_fee_known:
            # Marketplace-fulfilled shipping is deducted inside the marketplace
            # fee already counted above; charging it again would double it.
            logistics = 0.0
        elif not shipping_live:
            logistics = None
        if logistics is None:
            row["logisticsUnknown"] += 1
            ship_lines[1] += 1
        else:
            row["logistics"] += logistics
            ship_lines[0] += 1

        if order.presentment_currency:
            seen = presentment.setdefault(
                order.presentment_currency,
                {"currency": order.presentment_currency, "orders": set(), "total": 0.0},
            )
            if order.id not in seen["orders"]:
                seen["orders"].add(order.id)
                seen["total"] += order.presentment_total or 0.0

        entry = products.setdefault(product_id, {
            "id": product_id, "name": item.product_name or item.sku,
            "category": key[2], "subcategory": key[3], "variants": {},
        })
        entry["variants"].setdefault(variant_id, {
            "id": variant_id, "title": item.variant_title or "Default", "sku": item.sku,
        })

    rows = []
    known_units = unknown_units = 0
    for key, row in groups.items():
        row["orders"] = len(order_ids[key])
        # WHICH orders, not just how many. An order with three products sits in
        # three rows, so adding row counts up counts it three times — a day with
        # 5 orders and 7 order lines reads as 7. With the identities the
        # dashboard can count distinct orders at any level it groups by.
        # Dense integers, not the 36-character ids, to keep the payload small.
        row["orderIds"] = sorted(order_index.setdefault(oid, len(order_index)) for oid in order_ids[key])
        row["netSales"] = row["grossSales"] - row["cancelValue"] - row["discount"] - row["returnsValue"]
        # Only a fully costed row carries COGS; a partial one would understate it.
        row["cogs"] = row["cogs"] if row["costUnknownUnits"] == 0 else None
        # A cost is only as complete as its least-measured order.
        row["fees"] = None if row.pop("feeUnknown") else round(row["fees"], 2)
        row["logistics"] = None if row.pop("logisticsUnknown") else round(row["logistics"], 2)
        known_units += row.pop("costKnownUnits")
        unknown_units += row.pop("costUnknownUnits")
        rows.append(row)
    rows.sort(key=lambda r: (r["date"], r["product"], r["variant"]))

    last_synced = max((c.last_synced_at for c in connections if c.last_synced_at), default=None)
    channel_ids = sorted({r["channel"] for r in rows} | {c.platform for c in connections if c.platform in CHANNELS})

    # The currency every figure above is stated in. Shopify converts each order
    # into shop currency at that order's own rate, so these totals are exact and
    # need no exchange rate of ours.
    brand = Brand.query.get(brand_id)
    currency = next(
        (c.meta.get("currency") for c in connections if (c.meta or {}).get("currency")),
        None,
    ) or (brand.currency if brand else None) or "INR"

    markets = sorted(
        ({"currency": v["currency"], "orders": len(v["orders"]), "total": round(v["total"], 2)}
         for v in presentment.values()),
        key=lambda m: m["orders"], reverse=True,
    )

    summaries = _summaries(brand_id, shop_tz, start, end, start_day, end_day, payments, day_fees, prepaid_by_day)
    measured = lambda pair: (pair[0] / sum(pair)) if sum(pair) else None  # noqa: E731
    available = {
        "sales": bool(rows),
        "marketplaces": any(r["channel"] not in OWNED for r in rows),
        "fees": fee_lines[0] > 0,
        "logistics": ship_lines[0] > 0 and shipping_live,
        "payments": bool(summaries["payments"]["gateways"]),
        "settlements": bool(summaries["settlements"]["sources"]),
        "shipping": shipping_live,
        "ads": bool(summaries["ads"]["platforms"]),
    }
    unavailable = [k for k in ("fees", "logistics", "settlements", "ads") if not available[k]]
    unavailable += ["inventory"]

    return ok({
        "rows": rows,
        "available": available,
        "feeCoverage": measured(fee_lines),
        "logisticsCoverage": measured(ship_lines),
        **summaries,
        "currency": currency,
        "timezone": tz_name,
        # Reported, never summed: mixed currencies do not add without FX rates.
        "presentmentCurrencies": markets,
        "products": [{**p, "variants": list(p["variants"].values())} for p in products.values()],
        "channels": [CHANNELS[c] for c in channel_ids if c in CHANNELS],
        "range": {"first": first_day, "last": last_day},
        "orderCount": len({oid for ids in order_ids.values() for oid in ids}),
        "returnCount": ReturnRecord.query.filter_by(brand_id=brand_id).count(),
        "costCoverage": (known_units / (known_units + unknown_units)) if (known_units + unknown_units) else None,
        "connections": [c.to_dict() for c in connections],
        # Stored without a timezone; state UTC so the browser does not read it as local.
        "lastSyncedAt": (
            (last_synced if last_synced.tzinfo else last_synced.replace(tzinfo=timezone.utc)).isoformat()
            if last_synced else None
        ),
        "unavailable": unavailable,
    })


def _summaries(brand_id, tz, start, end, start_day, end_day, payments, day_fees, prepaid_by_day):
    """Totals for the sources that are not order lines.

    Each is filtered to the same shop-day window as the rows, so a figure here
    always describes the same period as the sales beside it.
    """
    def pad(query, column):
        if start:
            query = query.filter(column >= start - timedelta(days=1))
        if end:
            query = query.filter(column < end + timedelta(days=2))
        return query

    # Payments
    gateways = {}
    for p in payments:
        day = _local_day(p.occurred_at, tz)
        if not _in_window(day, start_day, end_day):
            continue
        g = gateways.setdefault(p.gateway, {
            "gateway": p.gateway, "payments": 0, "failed": 0, "amount": 0.0,
            "fees": 0.0, "refunded": 0.0, "feeReported": 0,
        })
        status = (p.status or "").lower()
        if status in ("failed", "failure", "bounced", "dropped", "usercancelled"):
            g["failed"] += 1
        elif status != "refund":
            g["payments"] += 1
            g["amount"] += p.amount or 0.0
        g["refunded"] += p.refunded or 0.0
        if p.fee is not None:
            g["fees"] += p.fee
            g["feeReported"] += 1
    in_window = {d for d in day_fees if _in_window(d, start_day, end_day)}
    unallocated = sum(day_fees[d] for d in in_window if not prepaid_by_day.get(d))
    for g in gateways.values():
        g["amount"] = round(g["amount"], 2)
        g["fees"] = round(g["fees"], 2)
        g["refunded"] = round(g["refunded"], 2)
        g["feeRate"] = round(g["fees"] / g["amount"] * 100, 2) if g["amount"] else None

    # Settlements
    sources = {}
    for s_ in pad(Settlement.query.filter_by(brand_id=brand_id), Settlement.settled_at).all():
        if s_.settled_at is None or not _in_window(_local_day(s_.settled_at, tz), start_day, end_day):
            continue
        agg = sources.setdefault(s_.source, {"source": s_.source, "count": 0, "amount": 0.0,
                                             "fees": 0.0, "lastSettledAt": None})
        agg["count"] += 1
        agg["amount"] += s_.amount or 0.0
        agg["fees"] += s_.fees or 0.0
        at = _aware(s_.settled_at).isoformat()
        agg["lastSettledAt"] = max(agg["lastSettledAt"] or at, at)

    # Shipping
    ship = {"shipments": 0, "matched": 0, "billed": 0, "freight": 0.0, "codCharges": 0.0,
            "rto": 0, "rtoFreight": 0.0, "delivered": 0, "byCourier": {}}
    for sh in pad(Shipment.query.filter_by(brand_id=brand_id), Shipment.created_on).all():
        if sh.created_on is None or not _in_window(_local_day(sh.created_on, tz), start_day, end_day):
            continue
        ship["shipments"] += 1
        ship["matched"] += 1 if sh.order_id else 0
        ship["delivered"] += 1 if sh.delivered_at else 0
        if sh.freight is not None:
            ship["billed"] += 1
            ship["freight"] += sh.freight
        ship["codCharges"] += sh.cod_charges or 0.0
        if sh.is_rto:
            ship["rto"] += 1
            ship["rtoFreight"] += sh.rto_freight or 0.0
        courier = ship["byCourier"].setdefault(sh.courier or "Unassigned", {
            "courier": sh.courier or "Unassigned", "shipments": 0, "rto": 0, "freight": 0.0,
        })
        courier["shipments"] += 1
        courier["rto"] += 1 if sh.is_rto else 0
        courier["freight"] += sh.freight or 0.0
    ship["byCourier"] = sorted(ship["byCourier"].values(), key=lambda c: c["shipments"], reverse=True)
    ship["rtoRate"] = round(ship["rto"] / ship["shipments"] * 100, 2) if ship["shipments"] else None

    # Advertising (stored per calendar day already)
    ads = {}
    ad_query = AdSpendRecord.query.filter_by(brand_id=brand_id)
    if start:
        ad_query = ad_query.filter(AdSpendRecord.date >= start.date())
    if end:
        ad_query = ad_query.filter(AdSpendRecord.date <= end.date())
    daily = defaultdict(lambda: {"spend": 0.0, "revenue": 0.0})
    for a in ad_query.all():
        agg = ads.setdefault(a.platform, {"platform": a.platform, "spend": 0.0, "revenue": 0.0,
                                          "impressions": 0, "clicks": 0, "purchases": 0, "sessions": 0})
        agg["spend"] += a.spend or 0.0
        agg["revenue"] += a.attributed_revenue or 0.0
        agg["impressions"] += a.impressions or 0
        agg["clicks"] += a.clicks or 0
        agg["purchases"] += a.purchases or 0
        agg["sessions"] += a.sessions or 0
        if a.platform != "ga4":
            daily[a.date.isoformat()]["spend"] += a.spend or 0.0
            daily[a.date.isoformat()]["revenue"] += a.attributed_revenue or 0.0
    for agg in ads.values():
        agg["roas"] = round(agg["revenue"] / agg["spend"], 2) if agg["spend"] else None

    return {
        "payments": {"gateways": sorted(gateways.values(), key=lambda g: g["amount"], reverse=True),
                     "unallocatedFees": round(unallocated, 2)},
        "settlements": {"sources": sorted(sources.values(), key=lambda x: x["amount"], reverse=True)},
        "shipping": ship,
        "ads": {"platforms": sorted(ads.values(), key=lambda x: x["spend"], reverse=True),
                "daily": [{"date": d, **v} for d, v in sorted(daily.items())]},
    }
