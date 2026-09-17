"""Live fact rows for the dashboard.

The dashboard derives every figure from one fact table at
(day × channel × product × variant). This endpoint builds that table from
synced orders, so the dashboard's arithmetic is unchanged — only its source is
real.

Costs Shopify does not report — gateway fees, courier charges, warehousing —
are returned as null, never zero. A zero reads as "free"; null lets the
dashboard say plainly that the source is not connected.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, current_app, request

from app.models import Brand, Connection, Order, OrderItem, ReturnRecord
from app.utils.decorators import brand_access_required
from app.utils.responses import error, ok

facts_bp = Blueprint("facts", __name__)

CHANNELS = {
    "shopify": {"id": "shopify", "name": "Shopify", "kind": "owned"},
}


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

    groups = {}
    order_ids = defaultdict(set)
    products = {}
    first_day, last_day = None, None

    # What customers actually paid in, counted per order rather than per line.
    presentment = {}

    start_day, end_day = request.args.get("start"), request.args.get("end")
    for order, item in query.all():
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
        row["netSales"] = row["grossSales"] - row["cancelValue"] - row["discount"] - row["returnsValue"]
        # Only a fully costed row carries COGS; a partial one would understate it.
        row["cogs"] = row["cogs"] if row["costUnknownUnits"] == 0 else None
        # Not reported by Shopify's Orders API.
        row["fees"] = None
        row["logistics"] = None
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

    return ok({
        "rows": rows,
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
        "unavailable": ["fees", "logistics", "adSpend", "inventory", "settlements"],
    })
