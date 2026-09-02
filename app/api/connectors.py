import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, current_app
from app.extensions import db
from app.models import Connection
from app.services.connector_factory import get_connector, CONNECTOR_REGISTRY
from app.utils.responses import ok, error
from app.utils.decorators import brand_access_required, role_required

connectors_bp = Blueprint("connectors", __name__)


@connectors_bp.get("")
@brand_access_required
def list_connectors(brand_id, role):
    connections = {c.platform: c for c in Connection.query.filter_by(brand_id=brand_id).all()}
    catalog = []
    for platform in current_app.config["SUPPORTED_CONNECTORS"]:
        conn = connections.get(platform)
        catalog.append({
            "platform": platform,
            "connected": conn is not None and conn.status == "connected",
            "connection": conn.to_dict() if conn else None,
        })
    return ok(catalog)


@connectors_bp.post("/<platform>/authorize-url")
@brand_access_required
@role_required("owner", "admin")
def get_authorize_url(brand_id, role, platform):
    if platform not in CONNECTOR_REGISTRY:
        return error(f"Unsupported platform '{platform}'", status=400)

    state = f"{brand_id}:{uuid.uuid4()}"
    stub_connection = Connection(brand_id=brand_id, platform=platform, status="pending")
    connector = get_connector(stub_connection)
    return ok({"authorize_url": connector.get_authorize_url(state), "state": state})


@connectors_bp.post("/<platform>/callback")
@brand_access_required
@role_required("owner", "admin")
def oauth_callback(brand_id, role, platform):
    # exchanges the code from the OAuth redirect for tokens and upserts the connection
    if platform not in CONNECTOR_REGISTRY:
        return error(f"Unsupported platform '{platform}'", status=400)

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
        connection.access_token = token_data.get("access_token")
        connection.refresh_token = token_data.get("refresh_token")
        connection.scopes = token_data.get("scope")
        connection.display_name = data.get("display_name") or external_account_id
        connection.status = "connected"
        connection.last_error = None
    except Exception as exc:  # noqa: BLE001
        connection.status = "error"
        connection.last_error = str(exc)
        db.session.commit()
        return error(f"Failed to connect {platform}: {exc}", status=502)

    db.session.commit()
    return ok(connection.to_dict(), status=201)


@connectors_bp.post("/<connection_id>/sync")
@brand_access_required
def trigger_sync(brand_id, role, connection_id):
    # TODO: move this to a celery task once volume gets big enough that this blocks the request
    connection = Connection.query.filter_by(id=connection_id, brand_id=brand_id).first()
    if not connection:
        return error("Connection not found", status=404)
    if connection.status != "connected":
        return error("Connection is not active; reconnect before syncing", status=400)

    connection.status = "syncing"
    db.session.commit()

    try:
        connector = get_connector(connection)
        since = connection.last_synced_at
        summary = connector.sync(since=since)
        connection.status = "connected"
        connection.last_synced_at = datetime.now(timezone.utc)
        connection.last_error = None
        db.session.commit()
        return ok(summary)
    except Exception as exc:  # noqa: BLE001
        connection.status = "error"
        connection.last_error = str(exc)
        db.session.commit()
        return error(f"Sync failed: {exc}", status=502)


@connectors_bp.post("/sync-all")
@brand_access_required
def sync_all(brand_id, role):
    connections = Connection.query.filter_by(brand_id=brand_id, status="connected").all()
    results = []
    for connection in connections:
        try:
            connector = get_connector(connection)
            summary = connector.sync(since=connection.last_synced_at)
            connection.last_synced_at = datetime.now(timezone.utc)
            connection.last_error = None
            results.append({"platform": connection.platform, "status": "ok", **summary})
        except Exception as exc:  # noqa: BLE001
            connection.status = "error"
            connection.last_error = str(exc)
            results.append({"platform": connection.platform, "status": "error", "error": str(exc)})
    db.session.commit()
    return ok(results)


@connectors_bp.delete("/<connection_id>")
@brand_access_required
@role_required("owner", "admin")
def disconnect(brand_id, role, connection_id):
    connection = Connection.query.filter_by(id=connection_id, brand_id=brand_id).first()
    if not connection:
        return error("Connection not found", status=404)
    connection.status = "disconnected"
    connection.access_token = None
    connection.refresh_token = None
    db.session.commit()
    return ok({"disconnected": True})
