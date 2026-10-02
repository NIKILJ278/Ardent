"""Encrypted storage for the keys a merchant enters on the website.

Platform credentials — API secrets, refresh tokens, passwords — are the most
sensitive thing this backend holds. They are encrypted before they reach the
database and decrypted only inside a connector at the moment of a call. The API
never returns them; the dashboard sees a masked hint and nothing more.

The key comes from `CREDENTIALS_KEY`, falling back to `SECRET_KEY`. Rotating
whichever one is in use makes every stored credential unreadable, so each
connection would need its keys entered again.
"""
import base64
import hashlib
import json

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app

from app.extensions import db

# Values that must never protect real credentials outside local development.
_DEFAULT_KEYS = {"dev-secret", "change-me", "test-secret-key", ""}


class CredentialError(Exception):
    """Credentials could not be stored or read."""


def _key_material():
    material = current_app.config.get("CREDENTIALS_KEY") or current_app.config.get("SECRET_KEY") or ""
    if material in _DEFAULT_KEYS and not (current_app.debug or current_app.testing):
        raise CredentialError(
            "Refusing to store platform credentials under a default key. "
            "Set CREDENTIALS_KEY (or SECRET_KEY) to a long random value in .env."
        )
    return material


def _fernet():
    # Fernet needs a 32-byte urlsafe key; derive one so any length of secret works.
    digest = hashlib.sha256(b"ardent-credentials|" + _key_material().encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(values):
    return _fernet().encrypt(json.dumps(values).encode()).decode()


def decrypt(token):
    try:
        return json.loads(_fernet().decrypt(token.encode()).decode())
    except InvalidToken as exc:
        raise CredentialError(
            "Stored credentials cannot be read — the encryption key changed. Enter the keys again."
        ) from exc


def mask(value):
    """Enough of a value to recognise it, never enough to use it."""
    if value is None:
        return None
    text = str(value)
    if len(text) <= 6:
        return "•" * len(text)
    return f"{text[:4]}••••{text[-4:]}"


# ── Per-connection access ────────────────────────────────────────────────

def load(connection):
    """The decrypted credentials for a connection, or an empty dict."""
    from app.models import ConnectionSecret

    if connection is None or connection.id is None:
        return {}
    row = ConnectionSecret.query.filter_by(connection_id=connection.id).first()
    return decrypt(row.ciphertext) if row else {}


def save(connection, values, *, secret_keys=()):
    """Replace a connection's stored credentials.

    `secret_keys` names the fields that are secret, so their hints are masked;
    identifiers such as a store domain or merchant ID are shown in full.
    """
    from app.models import ConnectionSecret

    if connection.id is None:
        db.session.flush()
    clean = {k: v for k, v in values.items() if v not in (None, "")}
    row = ConnectionSecret.query.filter_by(connection_id=connection.id).first()
    if row is None:
        row = ConnectionSecret(connection_id=connection.id)
        db.session.add(row)
    row.ciphertext = encrypt(clean)
    row.hints = {
        k: (mask(v) if k in secret_keys else str(v))
        for k, v in clean.items()
        if not k.startswith("_")  # internal cache entries are never hinted
    }
    return row


def update(connection, **changes):
    """Merge values into the stored credentials, keeping existing hints."""
    from app.models import ConnectionSecret

    row = ConnectionSecret.query.filter_by(connection_id=connection.id).first()
    if row is None:
        raise CredentialError("This connection has no stored credentials")
    values = decrypt(row.ciphertext)
    values.update(changes)
    row.ciphertext = encrypt({k: v for k, v in values.items() if v is not None})
    return values


def forget(connection):
    from app.models import ConnectionSecret

    if connection.id is not None:
        ConnectionSecret.query.filter_by(connection_id=connection.id).delete()


def hints(connection):
    from app.models import ConnectionSecret

    if connection is None or connection.id is None:
        return {}
    row = ConnectionSecret.query.filter_by(connection_id=connection.id).first()
    return dict(row.hints or {}) if row else {}
