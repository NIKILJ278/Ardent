import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class Alert(db.Model):

    __tablename__ = "alerts"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)

    category = db.Column(db.String(50), nullable=False)
    # margin_leak, rto_spike, oos, creative_fatigue, cancellation_spike, anomaly

    severity = db.Column(db.String(20), default="info")  # info, warning, critical
    title = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text)
    payload = db.Column(db.JSON, default=dict)

    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            "id": self.id,
            "category": self.category,
            "severity": self.severity,
            "title": self.title,
            "message": self.message,
            "payload": self.payload,
            "is_read": self.is_read,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
