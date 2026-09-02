import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class Order(db.Model):

    __tablename__ = "orders"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    customer_id = db.Column(db.String(36), db.ForeignKey("customers.id"))

    channel = db.Column(db.String(50), nullable=False, index=True)  # shopify, amazon, flipkart, myntra, eternz...
    external_order_id = db.Column(db.String(255), nullable=False)

    order_date = db.Column(db.DateTime, nullable=False, index=True)
    status = db.Column(db.String(30), default="placed")  # placed, shipped, delivered, cancelled, rto, returned

    gross_amount = db.Column(db.Float, default=0.0)
    discount_amount = db.Column(db.Float, default=0.0)
    shipping_amount = db.Column(db.Float, default=0.0)
    tax_amount = db.Column(db.Float, default=0.0)
    marketplace_fee_amount = db.Column(db.Float, default=0.0)  # commission etc.
    net_amount = db.Column(db.Float, default=0.0)  # gross - discounts - fees, before COGS

    cogs_amount = db.Column(db.Float, default=0.0)  # cost of goods sold
    net_margin_amount = db.Column(db.Float, default=0.0)
    net_margin_pct = db.Column(db.Float, default=0.0)

    payment_mode = db.Column(db.String(20), default="prepaid")  # prepaid, cod
    shipping_state = db.Column(db.String(100))
    courier = db.Column(db.String(100))

    is_rto = db.Column(db.Boolean, default=False)
    is_cancelled = db.Column(db.Boolean, default=False)
    is_returned = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                            onupdate=lambda: datetime.now(timezone.utc))

    brand = db.relationship("Brand", back_populates="orders")
    customer = db.relationship("Customer", back_populates="orders")
    items = db.relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")

    __table_args__ = (
        db.UniqueConstraint("brand_id", "channel", "external_order_id", name="uq_brand_channel_order"),
    )

    def to_dict(self):
        return {
            "id": self.id,
            "channel": self.channel,
            "external_order_id": self.external_order_id,
            "order_date": self.order_date.isoformat() if self.order_date else None,
            "status": self.status,
            "gross_amount": self.gross_amount,
            "net_amount": self.net_amount,
            "net_margin_amount": self.net_margin_amount,
            "net_margin_pct": self.net_margin_pct,
            "payment_mode": self.payment_mode,
            "shipping_state": self.shipping_state,
            "is_rto": self.is_rto,
            "is_cancelled": self.is_cancelled,
            "is_returned": self.is_returned,
        }


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    order_id = db.Column(db.String(36), db.ForeignKey("orders.id"), nullable=False)

    sku = db.Column(db.String(255), nullable=False, index=True)
    product_name = db.Column(db.String(255))
    quantity = db.Column(db.Integer, default=1)
    unit_price = db.Column(db.Float, default=0.0)
    unit_cost = db.Column(db.Float, default=0.0)
    line_total = db.Column(db.Float, default=0.0)
    line_margin = db.Column(db.Float, default=0.0)

    order = db.relationship("Order", back_populates="items")

    def to_dict(self):
        return {
            "sku": self.sku,
            "product_name": self.product_name,
            "quantity": self.quantity,
            "unit_price": self.unit_price,
            "unit_cost": self.unit_cost,
            "line_total": self.line_total,
            "line_margin": self.line_margin,
        }
