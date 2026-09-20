"""Shopify install flow.

Two routes, because Shopify's redirect cannot carry a login token:

1. `start` is called by the signed-in dashboard. It validates the store domain
   and returns Shopify's consent URL with a signed, expiring `state`.
2. `callback` is where Shopify sends the browser back. It carries no JWT, so it
   trusts nothing until the HMAC proves Shopify sent it and the signed state
   proves this backend started it — and names which brand it belongs to.
"""
import secrets
from urllib.parse import urlencode

from flask import Blueprint, current_app, redirect, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.extensions import db
from app.models import Connection
from app.services.shopify_service import (
    ShopifyConnector, ShopifyError, normalise_shop, verify_callback_hmac,
)
from app.utils.decorators import brand_access_required, role_required
from app.utils.responses import error, ok

shopify_oauth_bp = Blueprint("shopify_oauth", __name__)

STATE_MAX_AGE = 600  # seconds a consent screen may sit open


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="shopify-oauth")


def _missing_config():
    required = ("SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_REDIRECT_URI")
    return [key for key in required if not current_app.config.get(key)]


def _back_to_app(**params):
    base = current_app.config["FRONTEND_URL"].rstrip("/")
    return redirect(f"{base}/sources?{urlencode(params)}")


@shopify_oauth_bp.post("/api/brands/<brand_id>/shopify/start")
@brand_access_required
@role_required("owner", "admin")
def start(brand_id, role):
    missing = _missing_config()
    if missing:
        return error(f"Shopify is not configured on the server: set {', '.join(missing)} in .env", status=503)

    data = request.get_json(silent=True) or {}
    shop = normalise_shop(data.get("shop"))
    if not shop:
        return error("Enter your store domain, for example yourstore.myshopify.com", status=400)

    state = _serializer().dumps({"brand_id": brand_id, "shop": shop, "nonce": secrets.token_urlsafe(16)})
    connector = ShopifyConnector(Connection(brand_id=brand_id, platform="shopify", external_account_id=shop))
    return ok({"authorize_url": connector.get_authorize_url(state), "shop": shop})


@shopify_oauth_bp.get("/api/connectors/shopify/callback")
def callback():
    params = request.args.to_dict()

    if not verify_callback_hmac(params, current_app.config.get("SHOPIFY_API_SECRET", "")):
        return _back_to_app(shopify="error", reason="signature")

    try:
        state = _serializer().loads(params.get("state", ""), max_age=STATE_MAX_AGE)
    except SignatureExpired:
        return _back_to_app(shopify="error", reason="expired")
    except BadSignature:
        return _back_to_app(shopify="error", reason="state")

    shop = normalise_shop(params.get("shop"))
    # The store that consented must be the store this install was started for.
    if not shop or shop != state.get("shop"):
        return _back_to_app(shopify="error", reason="shop")

    code = params.get("code")
    if not code:
        return _back_to_app(shopify="error", reason="code")

    brand_id = state["brand_id"]
    connection = Connection.query.filter_by(
        brand_id=brand_id, platform="shopify", external_account_id=shop,
    ).first()
    if not connection:
        connection = Connection(brand_id=brand_id, platform="shopify", external_account_id=shop)
        db.session.add(connection)

    try:
        ShopifyConnector(connection).exchange_code_for_token(code)
        connection.display_name = shop.replace(".myshopify.com", "")
        db.session.commit()
    except ShopifyError as exc:
        db.session.rollback()
        current_app.logger.warning("Shopify install failed for %s: %s", shop, exc)
        return _back_to_app(shopify="error", reason="exchange")

    return _back_to_app(shopify="connected", shop=shop)
