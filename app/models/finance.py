"""Tables for the sources beyond orders: credentials, money movement, shipping.

Payment gateways and couriers report things no storefront does — what each
payment cost to collect, when the money actually arrived, and what each parcel
cost to ship or bring back. Each gets its own table rather than being folded
into orders, because a settlement covers many orders and a payment can exist
without an order Ardent has seen.
"""
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class ConnectionSecret(db.Model):
    """A connection's credentials, encrypted. See services/credentials.py."""

    __tablename__ = "connection_secrets"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    connection_id = db.Column(db.String(36), db.ForeignKey("connections.id"), nullable=False, unique=True)
    ciphertext = db.Column(db.Text, nullable=False)
    # Masked values safe to show in the dashboard, e.g. {"key_id": "rzp_••••AbCd"}.
    hints = db.Column(db.JSON, default=dict)
    updated_at = db.Column(db.DateTime, default=_now, onupdate=_now)


class PaymentTransaction(db.Model):
    """One payment as the gateway recorded it."""

    __tablename__ = "payment_transactions"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    gateway = db.Column(db.String(30), nullable=False, index=True)  # razorpay, payu, cashfree, stripe
    external_id = db.Column(db.String(255), nullable=False)
    order_ref = db.Column(db.String(255), index=True)  # the gateway's order or merchant reference

    status = db.Column(db.String(30))  # captured, failed, refunded, pending ...
    method = db.Column(db.String(40))  # upi, card, netbanking, wallet ...
    currency = db.Column(db.String(10))
    amount = db.Column(db.Float, default=0.0)  # major units, e.g. rupees
    fee = db.Column(db.Float)  # gateway charge including tax; null when not reported
    tax = db.Column(db.Float)
    refunded = db.Column(db.Float, default=0.0)
    settlement_ref = db.Column(db.String(255), index=True)

    occurred_at = db.Column(db.DateTime, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=_now)

    __table_args__ = (
        db.UniqueConstraint("brand_id", "gateway", "external_id", name="uq_brand_gateway_payment"),
    )

    def to_dict(self):
        return {
            "gateway": self.gateway, "external_id": self.external_id, "order_ref": self.order_ref,
            "status": self.status, "method": self.method, "currency": self.currency,
            "amount": self.amount, "fee": self.fee, "tax": self.tax, "refunded": self.refunded,
            "settlement_ref": self.settlement_ref, "occurred_at": _iso(self.occurred_at),
        }


class Settlement(db.Model):
    """Money a gateway or marketplace actually paid into the bank."""

    __tablename__ = "settlements"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    source = db.Column(db.String(30), nullable=False, index=True)  # razorpay, cashfree, stripe, amazon ...
    external_id = db.Column(db.String(255), nullable=False)

    status = db.Column(db.String(30))
    currency = db.Column(db.String(10))
    amount = db.Column(db.Float, default=0.0)  # what landed
    fees = db.Column(db.Float)
    tax = db.Column(db.Float)
    utr = db.Column(db.String(100))

    settled_at = db.Column(db.DateTime, index=True)
    created_at = db.Column(db.DateTime, default=_now)

    __table_args__ = (
        db.UniqueConstraint("brand_id", "source", "external_id", name="uq_brand_source_settlement"),
    )

    def to_dict(self):
        return {
            "source": self.source, "external_id": self.external_id, "status": self.status,
            "currency": self.currency, "amount": self.amount, "fees": self.fees, "tax": self.tax,
            "utr": self.utr, "settled_at": _iso(self.settled_at),
        }


class Shipment(db.Model):
    """A parcel as the shipping aggregator recorded it."""

    __tablename__ = "shipments"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    provider = db.Column(db.String(30), nullable=False, index=True)  # shiprocket ...
    external_id = db.Column(db.String(255), nullable=False)
    # The storefront or marketplace order number the parcel was shipped for.
    channel_order_ref = db.Column(db.String(255), index=True)
    order_id = db.Column(db.String(36), db.ForeignKey("orders.id"), index=True)

    awb = db.Column(db.String(100))
    courier = db.Column(db.String(100))
    status = db.Column(db.String(50))
    payment_method = db.Column(db.String(20))
    destination_state = db.Column(db.String(100))

    freight = db.Column(db.Float)  # forward shipping charge; null until billed
    cod_charges = db.Column(db.Float)
    rto_freight = db.Column(db.Float)
    is_rto = db.Column(db.Boolean, default=False)

    shipped_at = db.Column(db.DateTime)
    delivered_at = db.Column(db.DateTime)
    created_on = db.Column(db.DateTime, index=True)
    created_at = db.Column(db.DateTime, default=_now)

    __table_args__ = (
        db.UniqueConstraint("brand_id", "provider", "external_id", name="uq_brand_provider_shipment"),
    )

    @property
    def total_cost(self):
        parts = [self.freight, self.cod_charges, self.rto_freight]
        known = [p for p in parts if p is not None]
        return sum(known) if known else None

    def to_dict(self):
        return {
            "provider": self.provider, "external_id": self.external_id,
            "channel_order_ref": self.channel_order_ref, "awb": self.awb, "courier": self.courier,
            "status": self.status, "payment_method": self.payment_method,
            "destination_state": self.destination_state, "freight": self.freight,
            "cod_charges": self.cod_charges, "rto_freight": self.rto_freight, "is_rto": self.is_rto,
            "shipped_at": _iso(self.shipped_at), "delivered_at": _iso(self.delivered_at),
            "created_on": _iso(self.created_on),
        }
