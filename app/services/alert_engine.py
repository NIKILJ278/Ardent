from app.extensions import db
from app.models import Alert
from app.services import analytics_engine as engine

MARGIN_NEGATIVE_CHANNEL_THRESHOLD = 0.0
RTO_SPIKE_THRESHOLD_PCT = 20.0
CANCELLATION_RATE_THRESHOLD_PCT = 25.0
CREATIVE_FATIGUE_FREQUENCY = 3.0
OOS_RATE_THRESHOLD_PCT = 15.0


def generate_alerts(brand_id: str):
    created = []

    for c in engine.channel_profitability(brand_id, days=30):
        if c["net_margin"] < MARGIN_NEGATIVE_CHANNEL_THRESHOLD:
            created.append(_make(
                brand_id, "margin_leak", "critical",
                f"{c['channel']} is margin-negative",
                f"{c['channel']} lost {abs(c['net_margin'])} in net margin over the last 30 days "
                f"({c['margin_pct']}% margin on {c['net_sales']} net sales).",
                c,
            ))

    for s in engine.rto_by_state(brand_id, days=90):
        if s["rto_pct"] > RTO_SPIKE_THRESHOLD_PCT:
            created.append(_make(
                brand_id, "rto_spike", "warning",
                f"RTO above {RTO_SPIKE_THRESHOLD_PCT:.0f}% in {s['state']}",
                f"{s['state']} has a {s['rto_pct']}% RTO rate across {s['total_orders']} orders. "
                f"Recommended action: {s['recommended_action'].replace('_', ' ')}.",
                s,
            ))

    waterfall = engine.gross_to_net_waterfall(brand_id, days=30)
    if waterfall["cancellation_rate_pct"] > CANCELLATION_RATE_THRESHOLD_PCT:
        created.append(_make(
            brand_id, "cancellation_spike", "warning",
            "High order cancellation rate",
            f"{waterfall['cancelled_orders']} cancellations out of {waterfall['total_orders']} orders placed "
            f"({waterfall['cancellation_rate_pct']}%), dragging down the gross-to-net funnel.",
            waterfall,
        ))

    for camp in engine.marketing_scale_cut_monitor(brand_id, days=14):
        if camp["creative_fatigue"]:
            created.append(_make(
                brand_id, "creative_fatigue", "info",
                f"Creative fatigue on {camp['campaign_name']}",
                f"{camp['platform']} campaign '{camp['campaign_name']}' shows signs of creative fatigue "
                f"(ROAS {camp['roas']}). Consider refreshing creative.",
                camp,
            ))

    inventory = engine.inventory_health(brand_id)
    if inventory["oos_pct"] > OOS_RATE_THRESHOLD_PCT:
        created.append(_make(
            brand_id, "oos", "critical",
            "Out-of-stock rate is high",
            f"{inventory['oos_pct']}% of active SKUs are currently out of stock "
            f"({len(inventory['out_of_stock'])} of {inventory['total_skus']}).",
            {"oos_pct": inventory["oos_pct"]},
        ))

    db.session.add_all(created)
    db.session.commit()
    return created


def _make(brand_id, category, severity, title, message, payload):
    return Alert(
        brand_id=brand_id,
        category=category,
        severity=severity,
        title=title,
        message=message,
        payload=payload,
    )
