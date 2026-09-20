from collections import defaultdict
from datetime import datetime, timedelta
from sqlalchemy import func
from app.extensions import db
from app.models import Order, OrderItem, AdSpendRecord, ReturnRecord, InventoryItem, Customer


def _date_range(days: int):
    end = datetime.utcnow()
    start = end - timedelta(days=days)
    return start, end


def channel_profitability(brand_id: str, days: int = 30):
    start, end = _date_range(days)
    rows = (
        db.session.query(
            Order.channel,
            func.count(Order.id).label("orders"),
            func.sum(Order.net_amount).label("net_sales"),
            func.sum(Order.net_margin_amount).label("net_margin"),
        )
        .filter(Order.brand_id == brand_id, Order.order_date >= start, Order.order_date <= end)
        .group_by(Order.channel)
        .all()
    )

    total_net_sales = sum(r.net_sales or 0 for r in rows) or 1
    result = []
    for r in rows:
        net_sales = r.net_sales or 0
        net_margin = r.net_margin or 0
        result.append({
            "channel": r.channel,
            "orders": r.orders,
            "net_sales": round(net_sales, 2),
            "net_margin": round(net_margin, 2),
            "margin_pct": round((net_margin / net_sales) * 100, 1) if net_sales else 0,
            "share_of_sales_pct": round((net_sales / total_net_sales) * 100, 1),
        })
    result.sort(key=lambda x: x["net_sales"], reverse=True)
    return result


def gross_to_net_waterfall(brand_id: str, days: int = 30):
    start, end = _date_range(days)
    agg = (
        db.session.query(
            func.sum(Order.gross_amount).label("gross"),
            func.sum(Order.discount_amount).label("discounts"),
            func.sum(Order.marketplace_fee_amount).label("fees"),
            func.sum(Order.shipping_amount).label("shipping"),
            func.sum(Order.net_amount).label("net"),
            func.count(Order.id).label("total_orders"),
            func.sum(func.cast(Order.is_cancelled, db.Integer)).label("cancelled"),
            func.sum(func.cast(Order.is_rto, db.Integer)).label("rto"),
            func.sum(func.cast(Order.is_returned, db.Integer)).label("returned"),
        )
        .filter(Order.brand_id == brand_id, Order.order_date >= start, Order.order_date <= end)
        .first()
    )

    returns_value = (
        db.session.query(func.coalesce(func.sum(ReturnRecord.value_lost), 0))
        .filter(ReturnRecord.brand_id == brand_id, ReturnRecord.event_date >= start)
        .scalar()
    )

    payment_mix = (
        db.session.query(Order.payment_mode, func.count(Order.id))
        .filter(Order.brand_id == brand_id, Order.order_date >= start)
        .group_by(Order.payment_mode)
        .all()
    )

    return {
        "gross_sales": round(agg.gross or 0, 2),
        "discounts": round(agg.discounts or 0, 2),
        "returns_rto_value_lost": round(returns_value or 0, 2),
        "marketplace_fees": round(agg.fees or 0, 2),
        "shipping_cost": round(agg.shipping or 0, 2),
        "net_sales": round(agg.net or 0, 2),
        "total_orders": agg.total_orders or 0,
        "cancelled_orders": int(agg.cancelled or 0),
        "rto_orders": int(agg.rto or 0),
        "returned_orders": int(agg.returned or 0),
        "cancellation_rate_pct": round(((agg.cancelled or 0) / agg.total_orders) * 100, 1) if agg.total_orders else 0,
        "payment_mix": {mode: count for mode, count in payment_mix},
    }


def sku_profit_pareto(brand_id: str, days: int = 30, top_n: int = 50):
    start, end = _date_range(days)
    rows = (
        db.session.query(
            OrderItem.sku,
            OrderItem.product_name,
            func.sum(OrderItem.quantity).label("units"),
            func.sum(OrderItem.line_total).label("revenue"),
            func.sum(OrderItem.line_margin).label("margin"),
        )
        .join(Order, Order.id == OrderItem.order_id)
        .filter(Order.brand_id == brand_id, Order.order_date >= start, Order.order_date <= end)
        .group_by(OrderItem.sku, OrderItem.product_name)
        .order_by(func.sum(OrderItem.line_margin).desc())
        .limit(top_n)
        .all()
    )

    total_margin = sum(r.margin or 0 for r in rows) or 1
    cumulative = 0
    result = []
    for r in rows:
        margin = r.margin or 0
        cumulative += margin
        result.append({
            "sku": r.sku,
            "product_name": r.product_name,
            "units_sold": int(r.units or 0),
            "revenue": round(r.revenue or 0, 2),
            "margin": round(margin, 2),
            "margin_pct_of_total": round((margin / total_margin) * 100, 1),
            "cumulative_pct": round((cumulative / total_margin) * 100, 1),
        })
    return result


def rto_by_state(brand_id: str, days: int = 90):
    start, end = _date_range(days)
    rows = (
        db.session.query(
            Order.shipping_state,
            func.count(Order.id).label("total_orders"),
            func.sum(func.cast(Order.is_rto, db.Integer)).label("rto_orders"),
            func.sum(Order.net_amount).label("net_sales"),
        )
        .filter(Order.brand_id == brand_id, Order.order_date >= start, Order.shipping_state.isnot(None))
        .group_by(Order.shipping_state)
        .all()
    )

    result = []
    for r in rows:
        rto_orders = int(r.rto_orders or 0)
        rto_pct = round((rto_orders / r.total_orders) * 100, 1) if r.total_orders else 0
        recommended_action = "restrict_to_prepaid" if rto_pct > 20 else ("monitor" if rto_pct > 10 else "none")
        result.append({
            "state": r.shipping_state,
            "total_orders": r.total_orders,
            "rto_orders": rto_orders,
            "rto_pct": rto_pct,
            "net_sales": round(r.net_sales or 0, 2),
            "recommended_action": recommended_action,
        })
    result.sort(key=lambda x: x["rto_pct"], reverse=True)
    return result


def marketing_scale_cut_monitor(brand_id: str, days: int = 14):
    start, end = _date_range(days)
    rows = (
        db.session.query(
            AdSpendRecord.platform,
            AdSpendRecord.campaign_name,
            func.sum(AdSpendRecord.spend).label("spend"),
            func.sum(AdSpendRecord.attributed_revenue).label("revenue"),
            func.sum(AdSpendRecord.purchases).label("purchases"),
            func.avg(AdSpendRecord.frequency).label("avg_frequency"),
        )
        .filter(AdSpendRecord.brand_id == brand_id, AdSpendRecord.date >= start.date())
        .group_by(AdSpendRecord.platform, AdSpendRecord.campaign_name)
        .all()
    )

    result = []
    for r in rows:
        spend = r.spend or 0
        revenue = r.revenue or 0
        roas = round(revenue / spend, 2) if spend else 0
        cac = round(spend / r.purchases, 2) if r.purchases else None
        creative_fatigue = (r.avg_frequency or 0) > 3.0

        if roas >= 3:
            action = "scale"
        elif roas < 1.2:
            action = "cut"
        else:
            action = "monitor"

        result.append({
            "platform": r.platform,
            "campaign_name": r.campaign_name,
            "spend": round(spend, 2),
            "revenue": round(revenue, 2),
            "roas": roas,
            "cac": cac,
            "purchases": int(r.purchases or 0),
            "creative_fatigue": creative_fatigue,
            "action": action,
        })
    result.sort(key=lambda x: x["spend"], reverse=True)
    return result


def customer_rfm_segments(brand_id: str):
    customers = Customer.query.filter_by(brand_id=brand_id).all()
    now = datetime.utcnow()
    segments = defaultdict(list)

    for c in customers:
        if not c.last_order_date:
            continue
        recency_days = (now - c.last_order_date).days

        if c.total_orders >= 5 and recency_days <= 60:
            segment = "champion"
        elif c.total_orders >= 2 and recency_days <= 90:
            segment = "loyal"
        elif c.total_orders == 1 and recency_days <= 30:
            segment = "new"
        elif recency_days > 180:
            segment = "lost"
        elif recency_days > 90:
            segment = "at_risk"
        else:
            segment = "regular"

        c.rfm_segment = segment
        segments[segment].append(c.id)

    db.session.commit()
    return {seg: len(ids) for seg, ids in segments.items()}


def inventory_health(brand_id: str):
    items = InventoryItem.query.filter_by(brand_id=brand_id).all()
    fast_movers = [i.to_dict() for i in items if i.is_fast_mover]
    dead_stock = [i.to_dict() for i in items if i.is_dead_stock]
    needs_reorder = [i.to_dict() for i in items if i.reorder_point and i.stock_on_hand <= i.reorder_point]
    out_of_stock = [i.to_dict() for i in items if i.stock_on_hand <= 0]

    total = len(items) or 1
    return {
        "total_skus": len(items),
        "fast_movers": fast_movers,
        "dead_stock": dead_stock,
        "needs_reorder": needs_reorder,
        "out_of_stock": out_of_stock,
        "oos_pct": round((len(out_of_stock) / total) * 100, 1),
    }


def dashboard_summary(brand_id: str, days: int = 30):
    channels = channel_profitability(brand_id, days)
    waterfall = gross_to_net_waterfall(brand_id, days)
    rto = rto_by_state(brand_id, 90)[:5]
    marketing = marketing_scale_cut_monitor(brand_id, 14)[:5]
    inventory = inventory_health(brand_id)

    return {
        "period_days": days,
        "channels": channels,
        "waterfall": waterfall,
        "top_rto_states": rto,
        "top_campaigns": marketing,
        "inventory": {
            "total_skus": inventory["total_skus"],
            "out_of_stock_count": len(inventory["out_of_stock"]),
            "needs_reorder_count": len(inventory["needs_reorder"]),
            "oos_pct": inventory["oos_pct"],
        },
    }
