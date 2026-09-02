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
    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})

    # Import models so Flask-Migrate/SQLAlchemy sees every table.
    from app import models  # noqa: F401

    register_blueprints(app)
    register_error_handlers(app)

    @app.get("/health")
    def health():
        return {"status": "ok", "service": "brandstack-backend"}

    return app


def register_blueprints(app):
    from app.api.auth import auth_bp
    from app.api.brands import brands_bp
    from app.api.connectors import connectors_bp
    from app.api.dashboard import dashboard_bp
    from app.api.analytics import analytics_bp
    from app.api.reports import reports_bp
    from app.api.alerts import alerts_bp
    from app.api.ai import ai_bp

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
