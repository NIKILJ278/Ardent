import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class ReturnRecord(db.Model):

    __tablename__ = "return_records"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    order_id = db.Column(db.String(36), db.ForeignKey("orders.id"))

    type = db.Column(db.String(20), nullable=False)  # "return" or "rto"
    reason = db.Column(db.String(255))
    channel = db.Column(db.String(50))
    state = db.Column(db.String(100))
    courier = db.Column(db.String(100))

    value_lost = db.Column(db.Float, default=0.0)
    event_date = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    brand = db.relationship("Brand", back_populates="returns")

    def to_dict(self):
        return {
            "type": self.type,
            "reason": self.reason,
            "channel": self.channel,
            "state": self.state,
            "courier": self.courier,
            "value_lost": self.value_lost,
            "event_date": self.event_date.isoformat() if self.event_date else None,
        }
