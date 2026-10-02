import os
from datetime import timedelta


def _db_url(raw: str) -> str:
    """Rewrite legacy 'postgres://' scheme that Heroku, Railway, Neon and Supabase
    still emit — SQLAlchemy 1.4+ only recognises 'postgresql://'."""
    if raw and raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://"):]
    return raw


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-jwt-secret")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=12)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    SQLALCHEMY_DATABASE_URI = _db_url(os.environ.get("DATABASE_URL", "sqlite:///brandstack.db"))
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Connection pool settings — ignored by SQLite, used by Postgres.
    SQLALCHEMY_ENGINE_OPTIONS = {
        "pool_pre_ping": True,       # detect stale connections on checkout
        "pool_recycle": 280,         # recycle before most hosted-DB idle timeouts (300 s)
        "pool_size": 5,
        "max_overflow": 10,
    }
    # Emit a login-session row on every successful sign-in.
    AUDIT_LOGINS = os.environ.get("AUDIT_LOGINS", "true").lower() != "false"

    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5")

    # OAuth app credentials, one block per connector
    SHOPIFY_API_KEY = os.environ.get("SHOPIFY_API_KEY", "")
    SHOPIFY_API_SECRET = os.environ.get("SHOPIFY_API_SECRET", "")
    SHOPIFY_SCOPES = os.environ.get("SHOPIFY_SCOPES", "read_orders,read_products,read_inventory,read_customers")
    SHOPIFY_REDIRECT_URI = os.environ.get("SHOPIFY_REDIRECT_URI", "")
    # Shopify retires API versions about a year after release; pinning an old
    # one breaks the sync silently. Override in .env when Shopify moves on.
    SHOPIFY_API_VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-07")
    # How a store's calendar day is decided. The real timezone is read from
    # Shopify per shop and stored on the connection; these are only the
    # fallbacks used before the first sync has reported one.
    #
    # An IANA zone is preferred over a fixed offset because it handles daylight
    # saving. A store in America/New_York shifts by an hour twice a year, and a
    # fixed offset would silently misfile a day's late sales each time.
    SHOP_TIMEZONE = os.environ.get("SHOP_TIMEZONE", "")
    SHOP_UTC_OFFSET_MINUTES = int(os.environ.get("SHOP_UTC_OFFSET_MINUTES", "330"))

    # Where the dashboard runs. Used for CORS and to send the browser back after
    # a Shopify install.
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    META_APP_ID = os.environ.get("META_APP_ID", "")
    META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
    META_REDIRECT_URI = os.environ.get("META_REDIRECT_URI", "")

    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")

    UNICOMMERCE_API_KEY = os.environ.get("UNICOMMERCE_API_KEY", "")
    JUDGEME_API_KEY = os.environ.get("JUDGEME_API_KEY", "")

    # Encrypts the platform keys users enter on the website. Falls back to
    # SECRET_KEY; changing whichever is in use means re-entering every key.
    CREDENTIALS_KEY = os.environ.get("CREDENTIALS_KEY", "")

    # API versions that platforms retire on a schedule. Override in .env when
    # a platform announces a sunset, without a code change.
    META_GRAPH_VERSION = os.environ.get("META_GRAPH_VERSION", "v25.0")
    GOOGLE_ADS_API_VERSION = os.environ.get("GOOGLE_ADS_API_VERSION", "v25")
    CASHFREE_API_VERSION = os.environ.get("CASHFREE_API_VERSION", "2026-01-01")

    # Report uploads (Myntra, Meesho, PhonePe …) are read in memory.
    MAX_CONTENT_LENGTH = 26 * 1024 * 1024


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    # SQLite is fine locally; block it in production so a missing DATABASE_URL
    # causes an obvious startup error rather than silently writing to a file.
    @classmethod
    def _check(cls):
        uri = cls.SQLALCHEMY_DATABASE_URI or ""
        if uri.startswith("sqlite"):
            import warnings
            warnings.warn(
                "DATABASE_URL is not set (or is still SQLite). "
                "Set it to a PostgreSQL connection string for production.",
                RuntimeWarning,
                stacklevel=2,
            )


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    AUDIT_LOGINS = False
    SQLALCHEMY_ENGINE_OPTIONS = {}  # no pool settings for in-memory SQLite


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}
