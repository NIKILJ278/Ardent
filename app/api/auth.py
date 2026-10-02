from flask import Blueprint, request
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    jwt_required, get_jwt_identity, get_jwt,
    decode_token,
)
from app.extensions import db
from app.models import User
from app.models.login_session import LoginSession
from app.utils.responses import ok, error

auth_bp = Blueprint("auth", __name__)


def _client_ip():
    """Best-effort client IP, respecting X-Forwarded-For from proxies."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _record_login(user_id: str, grant: str, access_token_str: str) -> None:
    """Insert a LoginSession row if AUDIT_LOGINS is enabled."""
    from flask import current_app
    if not current_app.config.get("AUDIT_LOGINS", True):
        return
    try:
        payload = decode_token(access_token_str)
        jti = payload.get("jti", "")
    except Exception:
        jti = ""
    row = LoginSession(
        user_id=user_id,
        grant=grant,
        ip_address=_client_ip(),
        user_agent=(request.headers.get("User-Agent") or "")[:512],
        jti_prefix=jti[:12],
    )
    db.session.add(row)
    # Flush inside the caller's transaction — the caller commits.
    db.session.flush()


@auth_bp.post("/register")
def register():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    full_name = data.get("full_name")

    if not email or not password:
        return error("email and password are required", status=400)
    if len(password) < 8:
        return error("password must be at least 8 characters", status=400)

    if User.query.filter_by(email=email).first():
        return error("An account with this email already exists", status=409)

    user = User(email=email, full_name=full_name)
    user.set_password(password)
    db.session.add(user)
    db.session.flush()  # get the new user.id before _record_login needs it

    access_token = create_access_token(identity=user.id)
    refresh_token = create_refresh_token(identity=user.id)
    _record_login(user.id, "password", access_token)
    db.session.commit()

    return ok({"user": user.to_dict(), "access_token": access_token, "refresh_token": refresh_token}, status=201)


@auth_bp.post("/login")
def login():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        return error("Invalid email or password", status=401)
    if not user.is_active:
        return error("This account has been disabled", status=403)

    access_token = create_access_token(identity=user.id)
    refresh_token = create_refresh_token(identity=user.id)
    _record_login(user.id, "password", access_token)
    db.session.commit()

    return ok({"user": user.to_dict(), "access_token": access_token, "refresh_token": refresh_token})


@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    access_token = create_access_token(identity=user_id)
    _record_login(user_id, "refresh", access_token)
    db.session.commit()
    return ok({"access_token": access_token})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = User.query.get(get_jwt_identity())
    if not user:
        return error("User not found", status=404)
    return ok(user.to_dict())


@auth_bp.get("/me/sessions")
@jwt_required()
def my_sessions():
    """Last 20 login sessions for the current user."""
    user_id = get_jwt_identity()
    rows = (
        LoginSession.query
        .filter_by(user_id=user_id)
        .order_by(LoginSession.created_at.desc())
        .limit(20)
        .all()
    )
    return ok([r.to_dict() for r in rows])
