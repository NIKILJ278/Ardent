from flask import Blueprint, request
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import db
from app.models import Brand, BrandMember
from app.utils.responses import ok, error
from app.utils.decorators import brand_access_required, role_required

brands_bp = Blueprint("brands", __name__)


@brands_bp.post("")
@jwt_required()
def create_brand():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return error("name is required", status=400)

    brand = Brand(
        name=name,
        industry=data.get("industry"),
        currency=data.get("currency", "INR"),
        plan=data.get("plan", "custom"),
    )
    db.session.add(brand)
    db.session.flush()

    membership = BrandMember(brand_id=brand.id, user_id=get_jwt_identity(), role="owner")
    db.session.add(membership)
    db.session.commit()
    return ok(brand.to_dict(), status=201)


@brands_bp.get("")
@jwt_required()
def list_my_brands():
    user_id = get_jwt_identity()
    memberships = BrandMember.query.filter_by(user_id=user_id).all()
    brands = [{"role": m.role, **m.brand.to_dict()} for m in memberships]
    return ok(brands)


@brands_bp.get("/<brand_id>")
@brand_access_required
def get_brand(brand_id, role):
    brand = Brand.query.get(brand_id)
    if not brand:
        return error("Brand not found", status=404)
    return ok({"role": role, **brand.to_dict()})


@brands_bp.patch("/<brand_id>")
@brand_access_required
@role_required("owner", "admin")
def update_brand(brand_id, role):
    brand = Brand.query.get(brand_id)
    if not brand:
        return error("Brand not found", status=404)

    data = request.get_json(force=True) or {}
    for field in ("name", "industry", "currency", "plan"):
        if field in data:
            setattr(brand, field, data[field])
    db.session.commit()
    return ok(brand.to_dict())


@brands_bp.post("/<brand_id>/members")
@brand_access_required
@role_required("owner", "admin")
def invite_member(brand_id, role):
    data = request.get_json(force=True) or {}
    target_user_id = data.get("user_id")
    target_role = data.get("role", "viewer")
    if not target_user_id:
        return error("user_id is required", status=400)

    if BrandMember.query.filter_by(brand_id=brand_id, user_id=target_user_id).first():
        return error("User is already a member of this brand", status=409)

    membership = BrandMember(brand_id=brand_id, user_id=target_user_id, role=target_role)
    db.session.add(membership)
    db.session.commit()
    return ok({"brand_id": brand_id, "user_id": target_user_id, "role": target_role}, status=201)


@brands_bp.get("/<brand_id>/members")
@brand_access_required
def list_members(brand_id, role):
    members = BrandMember.query.filter_by(brand_id=brand_id).all()
    return ok([{"user": m.user.to_dict(), "role": m.role} for m in members])
