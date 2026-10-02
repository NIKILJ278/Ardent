from functools import wraps
from flask import request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from app.models import BrandMember
from app.utils.responses import error


def brand_access_required(fn):
    # checks the JWT user belongs to brand_id (from url kwarg, header, or query param)
    # and injects brand_id/role into the view
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        user_id = get_jwt_identity()

        brand_id = kwargs.get("brand_id") or request.headers.get("X-Brand-Id") or request.args.get("brand_id")
        if not brand_id:
            return error("brand_id is required", status=400)

        membership = BrandMember.query.filter_by(brand_id=brand_id, user_id=user_id).first()
        if not membership:
            return error("You do not have access to this brand", status=403)

        kwargs["brand_id"] = brand_id
        kwargs["role"] = membership.role
        return fn(*args, **kwargs)

    return wrapper


def role_required(*allowed_roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            role = kwargs.get("role")
            if role not in allowed_roles:
                return error("Insufficient permissions for this action", status=403)
            return fn(*args, **kwargs)

        return wrapper

    return decorator
