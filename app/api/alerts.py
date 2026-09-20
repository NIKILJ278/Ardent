from flask import Blueprint, request
from app.extensions import db
from app.models import Alert
from app.services.alert_engine import generate_alerts
from app.utils.responses import ok, error
from app.utils.decorators import brand_access_required

alerts_bp = Blueprint("alerts", __name__)


@alerts_bp.get("")
@brand_access_required
def list_alerts(brand_id, role):
    unread_only = request.args.get("unread") == "true"
    query = Alert.query.filter_by(brand_id=brand_id)
    if unread_only:
        query = query.filter_by(is_read=False)
    alerts = query.order_by(Alert.created_at.desc()).limit(100).all()
    return ok([a.to_dict() for a in alerts])


@alerts_bp.post("/generate")
@brand_access_required
def generate(brand_id, role):
    created = generate_alerts(brand_id)
    return ok({"created": len(created), "alerts": [a.to_dict() for a in created]})


@alerts_bp.post("/<alert_id>/read")
@brand_access_required
def mark_read(brand_id, role, alert_id):
    alert = Alert.query.filter_by(id=alert_id, brand_id=brand_id).first()
    if not alert:
        return error("Alert not found", status=404)
    alert.is_read = True
    db.session.commit()
    return ok(alert.to_dict())
