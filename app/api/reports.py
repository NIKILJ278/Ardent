import csv
import io
from flask import Blueprint, request, Response
from app.extensions import db
from app.models import SavedReport
from app.services import analytics_engine as engine
from app.utils.responses import ok, error
from app.utils.decorators import brand_access_required
from flask_jwt_extended import get_jwt_identity

reports_bp = Blueprint("reports", __name__)

# report_type -> engine function
REPORT_RUNNERS = {
    "channel_profitability": lambda brand_id, filters: engine.channel_profitability(
        brand_id, days=filters.get("days", 30)
    ),
    "gross_to_net_waterfall": lambda brand_id, filters: engine.gross_to_net_waterfall(
        brand_id, days=filters.get("days", 30)
    ),
    "sku_profit_pareto": lambda brand_id, filters: engine.sku_profit_pareto(
        brand_id, days=filters.get("days", 30), top_n=filters.get("top_n", 50)
    ),
    "state_action_matrix": lambda brand_id, filters: engine.rto_by_state(
        brand_id, days=filters.get("days", 90)
    ),
    "campaign_performance": lambda brand_id, filters: engine.marketing_scale_cut_monitor(
        brand_id, days=filters.get("days", 14)
    ),
    "inventory_health": lambda brand_id, filters: engine.inventory_health(brand_id),
}


@reports_bp.get("")
@brand_access_required
def list_reports(brand_id, role):
    favourite_only = request.args.get("favourite") == "true"
    query = SavedReport.query.filter_by(brand_id=brand_id)
    if favourite_only:
        query = query.filter_by(is_favourite=True)
    reports = query.order_by(SavedReport.created_at.desc()).all()
    return ok([r.to_dict() for r in reports])


@reports_bp.post("")
@brand_access_required
def save_report(brand_id, role):
    data = request.get_json(force=True) or {}
    report_type = data.get("report_type")
    if report_type not in REPORT_RUNNERS:
        return error(f"Unknown report_type. Valid options: {list(REPORT_RUNNERS)}", status=400)

    report = SavedReport(
        brand_id=brand_id,
        created_by_user_id=get_jwt_identity(),
        name=data.get("name", report_type),
        report_type=report_type,
        filters=data.get("filters", {}),
        is_favourite=data.get("is_favourite", False),
    )
    db.session.add(report)
    db.session.commit()
    return ok(report.to_dict(), status=201)


@reports_bp.get("/<report_id>/run")
@brand_access_required
def run_report(brand_id, role, report_id):
    report = SavedReport.query.filter_by(id=report_id, brand_id=brand_id).first()
    if not report:
        return error("Report not found", status=404)
    runner = REPORT_RUNNERS[report.report_type]
    return ok({"report": report.to_dict(), "results": runner(brand_id, report.filters or {})})


@reports_bp.get("/<report_id>/export.csv")
@brand_access_required
def export_report_csv(brand_id, role, report_id):
    report = SavedReport.query.filter_by(id=report_id, brand_id=brand_id).first()
    if not report:
        return error("Report not found", status=404)

    runner = REPORT_RUNNERS[report.report_type]
    rows = runner(brand_id, report.filters or {})
    if isinstance(rows, dict):
        rows = [rows]

    buffer = io.StringIO()
    if rows:
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename={report.report_type}.csv"},
    )


@reports_bp.delete("/<report_id>")
@brand_access_required
def delete_report(brand_id, role, report_id):
    report = SavedReport.query.filter_by(id=report_id, brand_id=brand_id).first()
    if not report:
        return error("Report not found", status=404)
    db.session.delete(report)
    db.session.commit()
    return ok({"deleted": True})
