import uuid
from datetime import datetime, timezone

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class SkuMaster(db.Model):
    """What a brand says about each SKU for tax and reporting.

    Every field is optional on purpose: nobody has the full set on day one. A
    SKU with no rate is estimated at the brand's default rate and flagged as
    such; it is never silently treated as fully set up.
    """

    __tablename__ = "sku_master"
    __table_args__ = (db.UniqueConstraint("brand_id", "sku", name="uq_sku_master_brand_sku"),)

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)
    sku = db.Column(db.String(120), nullable=False)
    category = db.Column(db.String(120))
    hsn = db.Column(db.String(8))
    gst_rate = db.Column(db.Float)  # percent, e.g. 5.0
    updated_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self):
        return {"sku": self.sku, "category": self.category, "hsn": self.hsn, "gstRate": self.gst_rate}


class GstSettings(db.Model):
    """A brand's own GST identity and its fallback rate."""

    __tablename__ = "gst_settings"

    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), primary_key=True)
    gstin = db.Column(db.String(15))
    default_rate = db.Column(db.Float)  # percent; what an unmapped SKU is estimated at

    def to_dict(self):
        from app.services.gst_rules import state_of_gstin
        state = state_of_gstin(self.gstin)
        return {
            "gstin": self.gstin,
            "stateCode": state["code"] if state else None,
            "stateName": state["name"] if state else None,
            "defaultRate": self.default_rate,
        }
