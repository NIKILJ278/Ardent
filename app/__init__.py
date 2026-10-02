import os
from flask import Flask
from app.config import config_by_name
from app.extensions import db, migrate, jwt, cors


def create_app(env=None):
    env = env or os.environ.get("FLASK_ENV", "development")
    app = Flask(__name__)
    app.config.from_object(config_by_name.get(env, config_by_name["development"]))

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    # Only the dashboard may call the API from a browser. A wildcard origin let
    # any site a signed-in user visited read brand data with their token.
    origins = [o.strip() for o in app.config["FRONTEND_URL"].split(",") if o.strip()]
    cors.init_app(app, resources={r"/api/*": {"origins": origins}})

    # Import models so Flask-Migrate/SQLAlchemy sees every table.
    from app import models  # noqa: F401

    register_blueprints(app)
    register_error_handlers(app)
    upgrade_schema(app)
    register_frontend(app)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "brandstack-backend"}

    return app


def register_frontend(app):
    """Serve the built dashboard from this same server, when asked to.

    Opt-in through FRONTEND_DIST (the path to `frontend/dist`), so ordinary
    development — Vite on one port, this API on another — is unchanged. Serving
    both from one origin is what makes a single public URL possible: one tunnel
    or one host, no cross-origin setup between the page and its API.

    Anything under /api/ that no route claimed stays a JSON 404 rather than
    falling through to the page, so a mistyped API path is not mistaken for a
    working one.
    """
    dist = os.environ.get("FRONTEND_DIST")
    if not dist or not os.path.isfile(os.path.join(dist, "index.html")):
        return
    from flask import send_from_directory
    from app.utils.responses import error

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def dashboard(path):
        if path.startswith("api/") or path == "api":
            return error("Resource not found", status=404)
        # send_from_directory refuses any path that escapes `dist`.
        if path and os.path.isfile(os.path.join(dist, path)):
            return send_from_directory(dist, path)
        # Every other path is a client-side route (/sales, /sources …).
        return send_from_directory(dist, "index.html")


def upgrade_schema(app):
    """Add any tables or columns the models gained since the database was made.

    A failure here is logged rather than raised: a database that is briefly
    unreachable should not stop the server from starting.
    """
    if not app.config.get("AUTO_UPGRADE_SCHEMA", True):
        return
    from app.schema import upgrade

    with app.app_context():
        try:
            added = upgrade()
            if added:
                app.logger.info("Database upgraded: added %s", ", ".join(added))
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            app.logger.error("Could not upgrade the database schema: %s", exc)


def register_blueprints(app):
    from app.api.auth import auth_bp
    from app.api.brands import brands_bp
    from app.api.connectors import connectors_bp
    from app.api.dashboard import dashboard_bp
    from app.api.analytics import analytics_bp
    from app.api.reports import reports_bp
    from app.api.alerts import alerts_bp
    from app.api.ai import ai_bp
    from app.api.shopify_oauth import shopify_oauth_bp
    from app.api.facts import facts_bp
    from app.api.gst import gst_bp

    # Full paths live on the routes themselves: the callback URL is fixed by the
    # Shopify app's configuration and must not move under a brand prefix.
    app.register_blueprint(shopify_oauth_bp)
    app.register_blueprint(facts_bp, url_prefix="/api/brands/<brand_id>/facts")
    app.register_blueprint(gst_bp, url_prefix="/api/brands/<brand_id>/gst")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(brands_bp, url_prefix="/api/brands")
    app.register_blueprint(connectors_bp, url_prefix="/api/brands/<brand_id>/connectors")
    app.register_blueprint(dashboard_bp, url_prefix="/api/brands/<brand_id>/dashboard")
    app.register_blueprint(analytics_bp, url_prefix="/api/brands/<brand_id>/analytics")
    app.register_blueprint(reports_bp, url_prefix="/api/brands/<brand_id>/reports")
    app.register_blueprint(alerts_bp, url_prefix="/api/brands/<brand_id>/alerts")
    app.register_blueprint(ai_bp, url_prefix="/api/brands/<brand_id>/ai")


def register_error_handlers(app):
    from app.utils.responses import error

    @app.errorhandler(404)
    def not_found(e):
        return error("Resource not found", status=404)

    @app.errorhandler(405)
    def method_not_allowed(e):
        return error("Method not allowed", status=405)

    @app.errorhandler(500)
    def server_error(e):
        return error("Internal server error", status=500)
