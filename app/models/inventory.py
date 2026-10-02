import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class InventoryItem(db.Model):
    __tablename__ = "inventory_items"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)

    sku = db.Column(db.String(255), nullable=False, index=True)
    product_name = db.Column(db.String(255))
    category = db.Column(db.String(150))

    stock_on_hand = db.Column(db.Integer, default=0)
    reorder_point = db.Column(db.Integer, default=0)
    unit_cost = db.Column(db.Float, default=0.0)

    is_dead_stock = db.Column(db.Boolean, default=False)  # no sales in N days
    is_fast_mover = db.Column(db.Boolean, default=False)
    days_of_cover = db.Column(db.Float)  # stock_on_hand / avg daily sales

    warehouse = db.Column(db.String(150))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                            onupdate=lambda: datetime.now(timezone.utc))

    brand = db.relationship("Brand", back_populates="inventory_items")

    __table_args__ = (db.UniqueConstraint("brand_id", "sku", "warehouse", name="uq_brand_sku_warehouse"),)

    def to_dict(self):
        return {
            "sku": self.sku,
            "product_name": self.product_name,
            "category": self.category,
            "stock_on_hand": self.stock_on_hand,
            "reorder_point": self.reorder_point,
            "unit_cost": self.unit_cost,
            "is_dead_stock": self.is_dead_stock,
            "is_fast_mover": self.is_fast_mover,
            "days_of_cover": self.days_of_cover,
            "warehouse": self.warehouse,
        }
