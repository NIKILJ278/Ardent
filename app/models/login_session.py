"""Audit trail for every successful sign-in.

One row per token pair issued. Keeps the user ID, the time, the requesting
IP and the user-agent so that, if a breach is suspected, an admin can tell
which accounts were active, when, and from where.

The table is always written \u2014 controlled by AUDIT_LOGINS in config. It is
deliberately append-only: rows are never updated, only inserted and
(optionally) expired.
"""
import uuid
from datetime import datetime, timezone

from app.extensions import db


def _uuid():
    return str(uuid.uuid4())


def _utcnow():
    return datetime.now(timezone.utc)


class LoginSession(db.Model):
    """One successful authentication event."""

    __tablename__ = "login_sessions"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)

    user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # How the token was obtained.
    grant = db.Column(db.String(20), nullable=False, default="password")
    # password | refresh | oauth

    ip_address = db.Column(db.String(45))   # IPv4 or IPv6
    user_agent = db.Column(db.String(512))

    # We store only the first 12 chars of the jti so a breach of this table
    # cannot be used to forge tokens.
    jti_prefix = db.Column(db.String(12))

    created_at = db.Column(db.DateTime, nullable=False, default=_utcnow, index=True)

    # Populated when the session is explicitly logged out or a refresh issues a
    # new pair. Null = still valid as far as the audit table knows.
    revoked_at = db.Column(db.DateTime)

    user = db.relationship("User", backref=db.backref("login_sessions", lazy="dynamic"))

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "grant": self.grant,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
        }
