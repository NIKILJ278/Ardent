"""Connecting sources to a brand, and pulling their data.

Most platforms are connected by typing keys into the dashboard. Those keys are
tested against the platform before anything is stored, encrypted when they are,
and never sent back — the dashboard only ever sees a masked hint. Platforms
without an API are fed by uploading their reports.
"""
import json
import uuid
from datetime import datetime, timezone

from flask import Blueprint, current_app, request

from app.extensions import db
from app.models import Connection
from app.services import credentials as creds
from app.services import http
from app.services.connector_factory import (
    CATALOG, CATEGORIES, CONNECTOR_REGISTRY, get_connector, public_spec, secret_keys, spec,
)
from app.services.file_import_service import KINDS, ImportError_
from app.services.shopify_service import ShopifyError
from app.utils.decorators import brand_access_required, role_required
from app.utils.responses import error, ok

connectors_bp = Blueprint("connectors", __name__)

# Failures a user can act on, as opposed to bugs.
EXPECTED = (http.ConnectorError, ShopifyError, creds.CredentialError, NotImplementedError)


def _describe(connection):
    data = connection.to_dict()
    data["credential_hints"] = creds.hints(connection)
    entry = spec(connection.platform) or {}
    data["auth"] = entry.get("auth")
    data["name"] = entry.get("name", connection.platform)
    data["category"] = entry.get("category")
    return data


# ── Catalogue ────────────────────────────────────────────────────────────────

@connectors_bp.get("")
@brand_access_required
def list_connectors(brand_id, role):
    """Every platform Ardent supports, with this brand's connections to each."""
    by_platform = {}
    for conn in Connection.query.filter_by(brand_id=brand_id).all():
        by_platform.setdefault(conn.platform, []).append(_describe(conn))

    platforms = []
    for entry in CATALOG:
        item = public_spec(entry)
        if entry["auth"] == "file":
            kind = entry.get("kind", "orders")
            item["import_fields"] = [
                {"key": k, "label": v["label"], "required": v["required"]}
                for k, v in KINDS[kind].items()
            ]
        item["connections"] = by_platform.get(entry["id"], [])
        item["connected"] = any(c["status"] == "connected" for c in item["connections"])
        platforms.append(item)
    return ok({"categories": CATEGORIES, "platforms": platforms, "can_manage": role in ("owner", "admin")})


# ── Credentials ──────────────────────────────────────────────────────────────

def _validate(entry, values):
    fields = {f["key"]: f for f in entry.get("fields") or []}
    groups = entry.get("one_of")
    grouped = {k for group in groups or [] for k in group}
    missing = [
        f["label"] for key, f in fields.items()
        if f["required"] and key not in grouped and not values.get(key)
    ]
    if groups and not any(all(values.get(k) for k in group) for group in groups):
        options = " or ".join(" + ".join(fields[k]["label"] for k in group) for group in groups)
        missing.append(options)
    return missing


@connectors_bp.post("/<platform>/credentials")
@brand_access_required
@role_required("owner", "admin")
def save_credentials(brand_id, role, platform):
    """Test the keys against the platform; store them only if they work.

    Editing an existing connection may leave secret fields blank to keep what
    is already stored.
    """
    entry = spec(platform)
    if not entry or entry["auth"] != "credentials":
        return error(f"{platform} is not connected with credentials", status=400)

    body = request.get_json(silent=True) or {}
    allowed = {f["key"] for f in entry["fields"]}
    submitted = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.items() if k in allowed}
    for f in entry["fields"]:
        if not submitted.get(f["key"]) and f.get("default") is not None:
            submitted[f["key"]] = f["default"]

    existing = None
    if body.get("connection_id"):
        existing = Connection.query.filter_by(id=body["connection_id"], brand_id=brand_id).first()
        if existing is None or existing.platform != platform:
            return error("Connection not found", status=404)

    # Blank secrets on an edit keep the stored ones; cached tokens are dropped
    # because the keys they were issued for may have changed.
    stored = creds.load(existing) if existing else {}
    values = {k: v for k, v in stored.items() if not k.startswith("_")}
    values.update({k: v for k, v in submitted.items() if v not in (None, "")})

    missing = _validate(entry, values)
    if missing:
        return error(f"Missing: {', '.join(missing)}", status=400, code="missing_fields")

    account_field = entry.get("account_field")
    probe = Connection(
        brand_id=brand_id, platform=platform,
        external_account_id=(existing.external_account_id if existing else None)
        or (values.get(account_field) if account_field else None),
        meta=dict(existing.meta or {}) if existing else {},
    )
    if platform == "shopify":
        from app.services.shopify_service import normalise_shop
        shop = normalise_shop(values.get("shop"))
        if not shop:
            return error("Enter your store domain, for example yourstore.myshopify.com", status=400)
        values["shop"] = shop
        probe.external_account_id = shop

    connector = get_connector(probe).use_credentials(values)
    try:
        profile = connector.test_connection() or {}
    except EXPECTED as exc:
        return error(f"Could not connect to {entry['name']}: {exc}", status=400, code="test_failed")

    account_id = str(profile.get("account_id") or probe.external_account_id or uuid.uuid4())
    connection = existing or Connection.query.filter_by(
        brand_id=brand_id, platform=platform, external_account_id=account_id,
    ).first()
    if connection is None:
        connection = Connection(brand_id=brand_id, platform=platform)
        db.session.add(connection)

    connection.external_account_id = account_id
    connection.display_name = profile.get("display_name") or entry["name"]
    connection.status = "connected"
    connection.last_error = None
    meta = dict(connection.meta or {})
    meta.update({k: v for k, v in profile.items()
                 if k in ("currency", "timezone", "mode", "marketplace", "name") and v})
    connection.meta = meta
    if probe.scopes:
        connection.scopes = probe.scopes
    db.session.flush()

    # Keep whatever the test minted (a fresh token saves a call on first sync).
    creds.save(connection, {**values, **{k: v for k, v in connector.credentials.items() if k.startswith("_")}},
               secret_keys=secret_keys(platform))
    db.session.commit()
    return ok(_describe(connection), status=201 if existing is None else 200)


# ── Report uploads ───────────────────────────────────────────────────────────

@connectors_bp.post("/<platform>/import")
@brand_access_required
@role_required("owner", "admin")
def import_report(brand_id, role, platform):
    entry = spec(platform)
    if not entry or entry["auth"] != "file":
        return error(f"{platform} does not take report uploads", status=400)
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return error("Choose a report file to upload", status=400)

    mapping = None
    if request.form.get("mapping"):
        try:
            mapping = json.loads(request.form["mapping"])
        except ValueError:
            return error("The column mapping could not be read", status=400)
        if not isinstance(mapping, dict):
            return error("The column mapping could not be read", status=400)

    connection = Connection.query.filter_by(brand_id=brand_id, platform=platform).first()
    created = connection is None
    if created:
        connection = Connection(brand_id=brand_id, platform=platform, external_account_id="upload",
                                display_name=entry["name"], status="connected")
        db.session.add(connection)
        db.session.flush()

    try:
        summary = get_connector(connection).import_file(upload.filename, upload.read(), mapping)
    except ImportError_ as exc:
        db.session.rollback()
        return error(str(exc), status=422, code="mapping_needed", details={
            "headers": exc.headers,
            "missing": exc.missing,
            "fields": [{"key": k, "label": v["label"], "required": v["required"]}
                       for k, v in KINDS[entry.get("kind", "orders")].items()],
        })
    connection.status = "connected"
    connection.last_error = None
    meta = dict(connection.meta or {})
    meta["last_file"] = upload.filename
    meta["mapping"] = summary.get("mapping")
    connection.meta = meta
    db.session.commit()
    return ok({**summary, "connection": _describe(connection)}, status=201 if created else 200)


# ── OAuth (Meta and Google app installs) ─────────────────────────────────────

@connectors_bp.post("/<platform>/authorize-url")
@brand_access_required
@role_required("owner", "admin")
def get_authorize_url(brand_id, role, platform):
    if platform not in CONNECTOR_REGISTRY:
        return error(f"Unsupported platform '{platform}'", status=400)
    if platform == "shopify":
        return error("Start a Shopify install with POST /api/brands/<brand_id>/shopify/start", status=400)

    state = f"{brand_id}:{uuid.uuid4()}"
    connector = get_connector(Connection(brand_id=brand_id, platform=platform, status="pending"))
    try:
        return ok({"authorize_url": connector.get_authorize_url(state), "state": state})
    except (NotImplementedError, KeyError) as exc:
        return error(f"{platform} cannot be connected by redirect: {exc}", status=400)


@connectors_bp.post("/<platform>/callback")
@brand_access_required
@role_required("owner", "admin")
def oauth_callback(brand_id, role, platform):
    if platform not in CONNECTOR_REGISTRY:
        return error(f"Unsupported platform '{platform}'", status=400)
    if platform == "shopify":
        return error("Shopify installs complete through /api/connectors/shopify/callback", status=400)

    data = request.get_json(force=True) or {}
    code = data.get("code")
    external_account_id = data.get("external_account_id")
    if not code:
        return error("code is required", status=400)

    connection = Connection.query.filter_by(
        brand_id=brand_id, platform=platform, external_account_id=external_account_id
    ).first()
    if not connection:
        connection = Connection(brand_id=brand_id, platform=platform, external_account_id=external_account_id)
        db.session.add(connection)

    connector = get_connector(connection)
    try:
        token_data = connector.exchange_code_for_token(code)
        connection.access_token = token_data.get("access_token") or connection.access_token
        connection.refresh_token = token_data.get("refresh_token") or connection.refresh_token
        connection.scopes = token_data.get("scope")
        connection.display_name = data.get("display_name") or external_account_id
        connection.status = "connected"
        connection.last_error = None
    except EXPECTED as exc:
        db.session.rollback()
        return error(f"Failed to connect {platform}: {exc}", status=502)

    db.session.commit()
    return ok(connection.to_dict(), status=201)


# ── Sync ─────────────────────────────────────────────────────────────────────

def _run_sync(connection):
    """Sync one connection and record the outcome on it. Returns the summary."""
    connection.status = "syncing"
    db.session.commit()
    try:
        summary = get_connector(connection).sync(since=connection.last_synced_at) or {}
    except http.ConnectorAuthError as exc:
        db.session.rollback()
        connection.status = "error"
        connection.last_error = f"{exc} Update the keys to reconnect."
        db.session.commit()
        raise
    except EXPECTED as exc:
        db.session.rollback()
        connection.status = "error"
        connection.last_error = str(exc)
        db.session.commit()
        raise
    except Exception:
        # A bug, not a platform problem. Never leave the connection stuck on
        # "syncing", and never show the user a stack trace.
        db.session.rollback()
        current_app.logger.exception("Sync crashed for %s connection %s", connection.platform, connection.id)
        connection.status = "error"
        connection.last_error = "The sync stopped on an unexpected error. It has been logged; try again."
        db.session.commit()
        raise

    connection.status = "connected"
    # A partial sync (e.g. Amazon throttling) must not move the watermark, or
    # the records it did not reach would never be read.
    if not summary.get("partial"):
        connection.last_synced_at = datetime.now(timezone.utc)
        connection.last_error = None
    db.session.commit()
    return summary


@connectors_bp.post("/<connection_id>/sync")
@brand_access_required
def trigger_sync(brand_id, role, connection_id):
    connection = Connection.query.filter_by(id=connection_id, brand_id=brand_id).first()
    if not connection:
        return error("Connection not found", status=404)
    if connection.status == "disconnected":
        return error("This connection is disconnected; connect it again before syncing", status=400)
    if connection.status == "syncing":
        return error("A sync is already running for this connection", status=409)
    try:
        return ok(_run_sync(connection))
    except EXPECTED as exc:
        return error(f"Sync failed: {exc}", status=502)
    except Exception as exc:  # noqa: BLE001
        # _run_sync already logged and marked the connection errored; this only
        # keeps a bug from reaching the caller as a raw stack trace.
        current_app.logger.exception("Unhandled sync error for connection %s", connection_id)
        return error("The sync stopped on an unexpected error. It has been logged; try again.", status=500)


@connectors_bp.post("/sync-all")
@brand_access_required
def sync_all(brand_id, role):
    results = []
    for connection in Connection.query.filter(
        Connection.brand_id == brand_id, Connection.status.in_(("connected", "error")),
    ).all():
        entry = spec(connection.platform) or {}
        if entry.get("auth") == "file":
            continue  # nothing to pull; these update on upload
        try:
            summary = _run_sync(connection)
            results.append({"platform": connection.platform, "id": connection.id, "status": "ok", **summary})
        except EXPECTED as exc:
            results.append({"platform": connection.platform, "id": connection.id,
                            "status": "error", "error": str(exc)})
        except Exception:  # noqa: BLE001
            # One connector's bug must not abort the sweep for the rest.
            current_app.logger.exception("Unhandled sync error for connection %s", connection.id)
            results.append({"platform": connection.platform, "id": connection.id, "status": "error",
                            "error": "The sync stopped on an unexpected error. It has been logged."})
    return ok(results)


@connectors_bp.delete("/<connection_id>")
@brand_access_required
@role_required("owner", "admin")
def disconnect(brand_id, role, connection_id):
    """Forget the credentials. Data already synced stays, so history is kept."""
    connection = Connection.query.filter_by(id=connection_id, brand_id=brand_id).first()
    if not connection:
        return error("Connection not found", status=404)
    creds.forget(connection)
    connection.status = "disconnected"
    connection.access_token = None
    connection.refresh_token = None
    db.session.commit()
    return ok({"disconnected": True})
