"""Writing synced records, the same way for every source.

Shopify's connector established how an order is stored: gross is merchandise
before discounts, discounts are spread across lines by value, a cancelled order
nets to zero, and cost of goods counts only when every line carries a cost.
Marketplaces and file imports go through here so their orders obey exactly the
same rules — otherwise channels would not add up against each other.
"""
from app.extensions import db
from app.models import Order, OrderItem, PaymentTransaction, ReturnRecord, Settlement, Shipment


def _f(value):
    try:
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _opt(value):
    """A float, or None when the source did not say."""
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def catalogue_for(brand_id, sku):
    """What the storefront already knows about a SKU.

    Marketplaces report a SKU and a title but not the merchant's own category
    or cost. When the same SKU has sold on the storefront, its product, variant,
    category and unit cost are reused, so one product sold on three channels is
    one product in Ardent rather than three.
    """
    if not sku:
        return {}
    item = (
        OrderItem.query.join(Order, OrderItem.order_id == Order.id)
        .filter(Order.brand_id == brand_id, Order.channel == "shopify", OrderItem.sku == sku)
        .order_by(Order.order_date.desc())
        .first()
    )
    if item is None:
        return {}
    return {
        "product_name": item.product_name,
        "product_external_id": item.product_external_id,
        "variant_external_id": item.variant_external_id,
        "variant_title": item.variant_title,
        "category": item.product_type,
        "subcategory": item.subcategory,
        "unit_cost": item.unit_cost if item.cost_known else None,
    }


def upsert_order(brand_id, channel, external_id, *, order_date, lines, order_name=None,
                 currency=None, status="placed", financial_status=None, is_cancelled=False,
                 is_rto=False, payment_mode=None, shipping_state=None, discount=0.0,
                 shipping=0.0, tax=0.0, marketplace_fee=None, returns=()):
    """Create or replace one order and its lines.

    `lines` are dicts with: sku, quantity, unit_price, and optionally
    external_line_id, product_name, product_external_id, category, subcategory,
    variant_external_id, variant_title, unit_cost, returned_quantity,
    returned_amount, discount (a line-level discount, added to any order-level
    one).

    `marketplace_fee` is None when the source does not report it — stored as
    unknown, never as zero. `returns` are (value, event_date, type, reason).
    """
    external_id = str(external_id)
    order = Order.query.filter_by(brand_id=brand_id, channel=channel, external_order_id=external_id).first()
    if order is None:
        order = Order(brand_id=brand_id, channel=channel, external_order_id=external_id)
        db.session.add(order)

    line_gross = [_f(li.get("unit_price")) * int(li.get("quantity") or 0) for li in lines]
    gross = sum(line_gross)
    line_discounts = [_f(li.get("discount")) for li in lines]
    order_discount = _f(discount)
    total_discount = order_discount + sum(line_discounts)
    refunded_merch = sum(_f(li.get("returned_amount")) for li in lines)

    cost_complete = bool(lines) and all(li.get("unit_cost") is not None for li in lines)
    cogs = sum(_f(li.get("unit_cost")) * int(li.get("quantity") or 0) for li in lines) if cost_complete else 0.0

    order.order_date = order_date
    order.order_name = order_name or external_id
    order.currency = currency
    order.financial_status = financial_status
    order.gross_amount = gross
    order.discount_amount = total_discount
    order.shipping_amount = _f(shipping)
    order.tax_amount = _f(tax)
    order.refunded_amount = refunded_merch
    order.marketplace_fee_known = marketplace_fee is not None
    order.marketplace_fee_amount = _f(marketplace_fee) if marketplace_fee is not None else 0.0
    order.is_cancelled = bool(is_cancelled)
    order.is_rto = bool(is_rto)
    order.is_returned = refunded_merch > 0 or bool(returns)
    order.net_amount = 0.0 if is_cancelled else gross - total_discount - refunded_merch
    if payment_mode:
        order.payment_mode = payment_mode
    order.shipping_state = shipping_state
    order.cost_complete = cost_complete
    order.cogs_amount = cogs
    order.net_margin_amount = (order.net_amount - cogs) if (cost_complete and not is_cancelled) else 0.0
    order.net_margin_pct = (
        round(order.net_margin_amount / order.net_amount * 100, 1)
        if cost_complete and order.net_amount else 0.0
    )
    order.status = "cancelled" if is_cancelled else ("rto" if is_rto else status)

    db.session.flush()

    OrderItem.query.filter_by(order_id=order.id).delete()
    for li, lg, ld in zip(lines, line_gross, line_discounts):
        share = (lg / gross) if gross else 0.0
        qty = int(li.get("quantity") or 0)
        unit_cost = li.get("unit_cost")
        allocated = order_discount * share + ld
        returned_amount = _f(li.get("returned_amount"))
        category = (li.get("category") or "").strip() or "Uncategorised"
        db.session.add(OrderItem(
            order_id=order.id,
            external_line_id=li.get("external_line_id"),
            sku=li.get("sku") or f"no-sku-{li.get('external_line_id') or li.get('product_external_id') or 'unknown'}",
            product_name=li.get("product_name") or li.get("sku"),
            product_external_id=li.get("product_external_id"),
            product_type=category,
            subcategory=(li.get("subcategory") or "").strip() or category,
            variant_external_id=li.get("variant_external_id"),
            variant_title=li.get("variant_title"),
            quantity=qty,
            unit_price=_f(li.get("unit_price")),
            unit_cost=_f(unit_cost),
            cost_known=unit_cost is not None,
            line_total=lg,
            discount_allocated=allocated,
            returned_quantity=int(li.get("returned_quantity") or 0),
            returned_amount=returned_amount,
            line_margin=(lg - allocated - returned_amount - _f(unit_cost) * qty)
            if unit_cost is not None and not is_cancelled else 0.0,
        ))

    ReturnRecord.query.filter_by(order_id=order.id).delete()
    for value, event_date, kind, reason in returns:
        if _f(value) <= 0:
            continue
        db.session.add(ReturnRecord(
            brand_id=brand_id, order_id=order.id, type=kind or "return", reason=reason,
            channel=channel, value_lost=_f(value), event_date=event_date or order_date,
        ))
    return order


def upsert_payment(brand_id, gateway, external_id, **fields):
    row = PaymentTransaction.query.filter_by(
        brand_id=brand_id, gateway=gateway, external_id=str(external_id),
    ).first()
    if row is None:
        row = PaymentTransaction(brand_id=brand_id, gateway=gateway, external_id=str(external_id))
        db.session.add(row)
    for key, value in fields.items():
        setattr(row, key, value)
    return row


def upsert_settlement(brand_id, source, external_id, **fields):
    row = Settlement.query.filter_by(brand_id=brand_id, source=source, external_id=str(external_id)).first()
    if row is None:
        row = Settlement(brand_id=brand_id, source=source, external_id=str(external_id))
        db.session.add(row)
    for key, value in fields.items():
        setattr(row, key, value)
    return row


def upsert_shipment(brand_id, provider, external_id, **fields):
    row = Shipment.query.filter_by(brand_id=brand_id, provider=provider, external_id=str(external_id)).first()
    if row is None:
        row = Shipment(brand_id=brand_id, provider=provider, external_id=str(external_id))
        db.session.add(row)
    for key, value in fields.items():
        setattr(row, key, value)
    return row


def link_shipment(shipment):
    """Attach a parcel to the order it was shipped for, and cost that order.

    Matched on the number a person would quote — the storefront's "#1001" or a
    marketplace order ID — with and without a leading '#', since aggregators
    store it either way.
    """
    ref = (shipment.channel_order_ref or "").strip()
    if not ref:
        return None
    candidates = {ref, ref.lstrip("#"), f"#{ref.lstrip('#')}"}
    order = (
        Order.query.filter(Order.brand_id == shipment.brand_id)
        .filter((Order.order_name.in_(candidates)) | (Order.external_order_id.in_(candidates)))
        .first()
    )
    if order is None:
        return None
    shipment.order_id = order.id

    # An order can ship in several parcels; its cost is all of them.
    parcels = Shipment.query.filter_by(brand_id=shipment.brand_id, order_id=order.id).all()
    if shipment not in parcels:
        parcels.append(shipment)
    costs = [p.total_cost for p in parcels]
    order.shipping_cost_amount = sum(costs) if all(c is not None for c in costs) else None
    if shipment.courier:
        order.courier = shipment.courier
    if shipment.is_rto:
        order.is_rto = True
        if not order.is_cancelled:
            order.status = "rto"
    if shipment.destination_state and not order.shipping_state:
        order.shipping_state = shipment.destination_state
    return order
