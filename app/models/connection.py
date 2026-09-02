import uuid
from datetime import datetime, timezone
from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


class Connection(db.Model):
    __tablename__ = "connections"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    brand_id = db.Column(db.String(36), db.ForeignKey("brands.id"), nullable=False)

    platform = db.Column(db.String(50), nullable=False)  # e.g. "shopify", "meta_ads", "google_ads", "ga4"
    external_account_id = db.Column(db.String(255))  # e.g. shop domain, ad account id, GA4 property id
    display_name = db.Column(db.String(255))

    access_token = db.Column(db.Text)
    refresh_token = db.Column(db.Text)
    token_expires_at = db.Column(db.DateTime)

    status = db.Column(db.String(30), default="connected")  # connected, error, disconnected, syncing
    last_synced_at = db.Column(db.DateTime)
    last_error = db.Column(db.Text)

    scopes = db.Column(db.String(500))
    meta = db.Column(db.JSON, default=dict)  # arbitrary platform-specific config

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc),
                            onupdate=lambda: datetime.now(timezone.utc))

    brand = db.relationship("Brand", back_populates="connections")

    __table_args__ = (
        db.UniqueConstraint("brand_id", "platform", "external_account_id", name="uq_brand_platform_account"),
    )

    def to_dict(self, include_tokens=False):
        data = {
            "id": self.id,
            "brand_id": self.brand_id,
            "platform": self.platform,
            "external_account_id": self.external_account_id,
            "display_name": self.display_name,
            "status": self.status,
            "last_synced_at": self.last_synced_at.isoformat() if self.last_synced_at else None,
            "last_error": self.last_error,
            "scopes": self.scopes,
        }
        if include_tokens:
            data["access_token"] = self.access_token
            data["refresh_token"] = self.refresh_token
        return data
