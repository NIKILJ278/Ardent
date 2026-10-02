import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class Brand(db.Model):

    __tablename__ = "brands"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    name = db.Column(db.String(255), nullable=False)
    industry = db.Column(db.String(100))  # apparel, beauty, home_living, pet, food_beverage, health, jewellery
    currency = db.Column(db.String(10), default="INR")
    plan = db.Column(db.String(50), default="custom")  # custom, path_02, path_03
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    members = db.relationship("BrandMember", back_populates="brand", cascade="all, delete-orphan")
    connections = db.relationship("Connection", back_populates="brand", cascade="all, delete-orphan")
    orders = db.relationship("Order", back_populates="brand", cascade="all, delete-orphan")
    ad_spend_records = db.relationship("AdSpendRecord", back_populates="brand", cascade="all, delete-orphan")
    inventory_items = db.relationship("InventoryItem", back_populates="brand", cascade="all, delete-orphan")
    customers = db.relationship("Customer", back_populates="brand", cascade="all, delete-orphan")
    returns = db.relationship("ReturnRecord", back_populates="brand", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "industry": self.industry,
            "currency": self.currency,
            "plan": self.plan,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class BrandMember(db.Model):

    __tablename__ = "brand_members"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False)
    user_id = db.Column(db.String(36), db.ForeignKey("users.id"), nullable=False)
    role = db.Column(db.String(50), default="owner")  # owner, admin, analyst, viewer

    brand = db.relationship("Brand", back_populates="members")
    user = db.relationship("User", back_populates="memberships")

    __table_args__ = (db.UniqueConstraint("brand_id", "user_id", name="uq_brand_user"),)
