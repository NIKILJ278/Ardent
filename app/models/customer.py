import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class Customer(db.Model):
    __tablename__ = "customers"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)

    external_customer_id = db.Column(db.String(255))
    email = db.Column(db.String(255))
    phone = db.Column(db.String(50))
    state = db.Column(db.String(100))
    city = db.Column(db.String(100))

    first_order_date = db.Column(db.DateTime)
    last_order_date = db.Column(db.DateTime)
    total_orders = db.Column(db.Integer, default=0)
    total_spend = db.Column(db.Float, default=0.0)
    avg_purchase_interval_days = db.Column(db.Float)

    rfm_segment = db.Column(db.String(50))  # champion, loyal, at_risk, new, lost, vip
    ltv = db.Column(db.Float, default=0.0)

    brand = db.relationship("Brand", back_populates="customers")
    orders = db.relationship("Order", back_populates="customer")

    __table_args__ = (db.UniqueConstraint("brand_id", "external_customer_id", name="uq_brand_customer"),)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "state": self.state,
            "city": self.city,
            "total_orders": self.total_orders,
            "total_spend": self.total_spend,
            "avg_purchase_interval_days": self.avg_purchase_interval_days,
            "rfm_segment": self.rfm_segment,
            "ltv": self.ltv,
        }
