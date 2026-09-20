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
    financial_status = db.Column(db.String(30))  # paid, partially_refunded, refunded, pending...
    # The shop's own currency. Every *_amount on this row is in it, because
    # Shopify converts each order into shop currency at that order's own rate.
    currency = db.Column(db.String(10))
    # What the customer actually paid in, and how much. Kept for reporting
    # which markets the store sells into; never summed with the amounts above,
    # because a mixed-currency total is meaningless without FX rates.
    presentment_currency = db.Column(db.String(10))
    presentment_total = db.Column(db.Float)
    taxes_included = db.Column(db.Boolean, default=True)

    gross_amount = db.Column(db.Float, default=0.0)  # merchandise before discounts
    discount_amount = db.Column(db.Float, default=0.0)
    shipping_amount = db.Column(db.Float, default=0.0)  # shipping charged to the customer, not courier cost
    tax_amount = db.Column(db.Float, default=0.0)
    refunded_amount = db.Column(db.Float, default=0.0)
    marketplace_fee_amount = db.Column(db.Float, default=0.0)  # commission etc.
    # Whether the fee above was actually reported. 0.0 alone cannot tell
    # "free" from "the source does not say", and the dashboard must not
    # present an unreported fee as zero.
    marketplace_fee_known = db.Column(db.Boolean, default=False)
    # The number a person would quote: "#1001" on Shopify, the order ID on a
    # marketplace. Shipping aggregators store this, not the platform's
    # internal ID, so it is how a parcel finds its order.
    order_name = db.Column(db.String(255), index=True)
    # What the courier charged for this order, forward plus any COD and
    # return-to-origin charge. Null until a shipping source has billed it.
    shipping_cost_amount = db.Column(db.Float)
    net_amount = db.Column(db.Float, default=0.0)  # gross - discounts - refunded merchandise

    cogs_amount = db.Column(db.Float, default=0.0)  # cost of goods sold
    cost_complete = db.Column(db.Boolean, default=False)  # every line carried a unit cost
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
            "financial_status": self.financial_status,
            "currency": self.currency,
            "presentment_currency": self.presentment_currency,
            "presentment_total": self.presentment_total,
            "gross_amount": self.gross_amount,
            "discount_amount": self.discount_amount,
            "refunded_amount": self.refunded_amount,
            "net_amount": self.net_amount,
            "net_margin_amount": self.net_margin_amount,
            "net_margin_pct": self.net_margin_pct,
            "cost_complete": self.cost_complete,
            "payment_mode": self.payment_mode,
            "shipping_state": self.shipping_state,
            "is_rto": self.is_rto,
            "is_cancelled": self.is_cancelled,
            "is_returned": self.is_returned,
            "order_name": self.order_name,
            "marketplace_fee_amount": self.marketplace_fee_amount if self.marketplace_fee_known else None,
            "shipping_cost_amount": self.shipping_cost_amount,
        }


class OrderItem(db.Model):
    __tablename__ = "order_items"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    order_id = db.Column(db.String(36), db.ForeignKey("orders.id"), nullable=False)
    external_line_id = db.Column(db.String(255))

    sku = db.Column(db.String(255), nullable=False, index=True)
    product_name = db.Column(db.String(255))
    product_external_id = db.Column(db.String(255), index=True)
    product_type = db.Column(db.String(255))  # merchant's own product type, used as category
    subcategory = db.Column(db.String(255))  # Shopify taxonomy leaf, else product type
    variant_external_id = db.Column(db.String(255))
    variant_title = db.Column(db.String(255))

    quantity = db.Column(db.Integer, default=1)
    unit_price = db.Column(db.Float, default=0.0)
    unit_cost = db.Column(db.Float, default=0.0)
    cost_known = db.Column(db.Boolean, default=False)
    line_total = db.Column(db.Float, default=0.0)  # unit price x quantity, before discounts
    discount_allocated = db.Column(db.Float, default=0.0)
    returned_quantity = db.Column(db.Integer, default=0)
    returned_amount = db.Column(db.Float, default=0.0)
    line_margin = db.Column(db.Float, default=0.0)

    order = db.relationship("Order", back_populates="items")

    def to_dict(self):
        return {
            "sku": self.sku,
            "product_name": self.product_name,
            "product_type": self.product_type,
            "variant_title": self.variant_title,
            "quantity": self.quantity,
            "unit_price": self.unit_price,
            "unit_cost": self.unit_cost,
            "cost_known": self.cost_known,
            "line_total": self.line_total,
            "discount_allocated": self.discount_allocated,
            "returned_quantity": self.returned_quantity,
            "returned_amount": self.returned_amount,
            "line_margin": self.line_margin,
        }
