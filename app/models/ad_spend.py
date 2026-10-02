import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class AdSpendRecord(db.Model):

    __tablename__ = "ad_spend_records"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False, index=True)

    platform = db.Column(db.String(50), nullable=False)  # meta_ads, google_ads, instagram
    campaign_id = db.Column(db.String(255))
    campaign_name = db.Column(db.String(255))
    ad_set_name = db.Column(db.String(255))
    creative_name = db.Column(db.String(255))

    date = db.Column(db.Date, nullable=False, index=True)

    spend = db.Column(db.Float, default=0.0)
    impressions = db.Column(db.Integer, default=0)
    clicks = db.Column(db.Integer, default=0)
    sessions = db.Column(db.Integer, default=0)
    purchases = db.Column(db.Integer, default=0)
    attributed_revenue = db.Column(db.Float, default=0.0)

    roas = db.Column(db.Float, default=0.0)
    cac = db.Column(db.Float, default=0.0)

    frequency = db.Column(db.Float, default=0.0)  # used for creative fatigue signal
    ctr = db.Column(db.Float, default=0.0)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    brand = db.relationship("Brand", back_populates="ad_spend_records")

    def to_dict(self):
        return {
            "platform": self.platform,
            "campaign_name": self.campaign_name,
            "ad_set_name": self.ad_set_name,
            "creative_name": self.creative_name,
            "date": self.date.isoformat() if self.date else None,
            "spend": self.spend,
            "impressions": self.impressions,
            "clicks": self.clicks,
            "sessions": self.sessions,
            "purchases": self.purchases,
            "attributed_revenue": self.attributed_revenue,
            "roas": self.roas,
            "cac": self.cac,
            "frequency": self.frequency,
            "ctr": self.ctr,
        }
