from flask import Blueprint, request
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from app.extensions import db
from app.models import User
from app.utils.responses import ok, error

auth_bp = Blueprint("auth", __name__)


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
    db.session.commit()

    access_token = create_access_token(identity=user.id)
    refresh_token = create_refresh_token(identity=user.id)
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
    return ok({"user": user.to_dict(), "access_token": access_token, "refresh_token": refresh_token})


@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    return ok({"access_token": create_access_token(identity=user_id)})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = User.query.get(get_jwt_identity())
    if not user:
        return error("User not found", status=404)
    return ok(user.to_dict())
