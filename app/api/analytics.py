from flask import Blueprint, request
from app.services import analytics_engine as engine
from app.utils.responses import ok
from app.utils.decorators import brand_access_required

analytics_bp = Blueprint("analytics", __name__)


@analytics_bp.get("/channel-profitability")
@brand_access_required
def channel_profitability(brand_id, role):
    days = request.args.get("days", default=30, type=int)
    return ok(engine.channel_profitability(brand_id, days=days))


@analytics_bp.get("/gross-to-net-waterfall")
@brand_access_required
def gross_to_net(brand_id, role):
    days = request.args.get("days", default=30, type=int)
    return ok(engine.gross_to_net_waterfall(brand_id, days=days))


@analytics_bp.get("/sku-profit-pareto")
@brand_access_required
def sku_pareto(brand_id, role):
    days = request.args.get("days", default=30, type=int)
    top_n = request.args.get("top_n", default=50, type=int)
    return ok(engine.sku_profit_pareto(brand_id, days=days, top_n=top_n))


@analytics_bp.get("/state-action-matrix")
@brand_access_required
def state_action_matrix(brand_id, role):
    days = request.args.get("days", default=90, type=int)
    return ok(engine.rto_by_state(brand_id, days=days))


@analytics_bp.get("/campaign-performance")
@brand_access_required
def campaign_performance(brand_id, role):
    days = request.args.get("days", default=14, type=int)
    return ok(engine.marketing_scale_cut_monitor(brand_id, days=days))


@analytics_bp.get("/customer-segments")
@brand_access_required
def customer_segments(brand_id, role):
    return ok(engine.customer_rfm_segments(brand_id))


@analytics_bp.get("/inventory-health")
@brand_access_required
def inventory_health(brand_id, role):
    return ok(engine.inventory_health(brand_id))
