from flask import Blueprint, request
from app.services.ai_service import answer_question
from app.utils.responses import ok, error
from app.utils.decorators import brand_access_required

ai_bp = Blueprint("ai", __name__)


@ai_bp.post("/query")
@brand_access_required
def query(brand_id, role):
    # body: {"question": "Which SKUs drive 80% of my net margin?"}
    data = request.get_json(force=True) or {}
    question = (data.get("question") or "").strip()
    if not question:
        return error("question is required", status=400)

    result = answer_question(brand_id, question)
    return ok(result)
