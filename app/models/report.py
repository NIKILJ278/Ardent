import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class SavedReport(db.Model):

    __tablename__ = "saved_reports"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    created_by_user_id = db.Column(db.String(36), db.ForeignKey("users.id"))

    name = db.Column(db.String(255), nullable=False)
    report_type = db.Column(db.String(100), nullable=False)
    # channel_profitability, sku_contribution, marketplace_fee_leakage, kit_vs_single,
    # cod_remittance, reorder_signal, gross_to_net_waterfall, state_action_matrix, ...

    filters = db.Column(db.JSON, default=dict)
    is_favourite = db.Column(db.Boolean, default=False)
    shared_with = db.Column(db.JSON, default=list)  # list of user ids / emails

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "report_type": self.report_type,
            "filters": self.filters,
            "is_favourite": self.is_favourite,
            "shared_with": self.shared_with,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
