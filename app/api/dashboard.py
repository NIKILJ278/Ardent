from flask import Blueprint, request
from app.services import analytics_engine as engine
from app.utils.responses import ok
from app.utils.decorators import brand_access_required

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("")
@brand_access_required
def dashboard_summary(brand_id, role):
    days = request.args.get("days", default=30, type=int)
    return ok(engine.dashboard_summary(brand_id, days=days))
