import json
from flask import current_app
from app.services import analytics_engine as engine

SYSTEM_PROMPT = """You are an embedded analyst inside a D2C business dashboard.
You answer the founder's question using ONLY the JSON data supplied to you in the user message.
Rules:
- Never invent numbers that are not present in the supplied data.
- If the data needed to answer isn't present, say so plainly and suggest what to check instead.
- Be direct and concise. Lead with the answer, then 1-3 sentences of the "why" or "what's driving it".
- Use the brand's actual currency figures and %ages from the data, not rounded guesses.
- Where relevant, note a concrete next action (e.g. restrict a state to prepaid, cut a campaign, reorder a SKU).
"""


def _gather_context(brand_id: str, question: str) -> dict:
    # not doing any real intent routing yet, just pulling the standard bundle every time
    # since these are all cheap aggregate queries anyway
    return {
        "channel_profitability": engine.channel_profitability(brand_id, days=30),
        "gross_to_net_waterfall": engine.gross_to_net_waterfall(brand_id, days=30),
        "sku_profit_pareto": engine.sku_profit_pareto(brand_id, days=30, top_n=20),
        "state_action_matrix": engine.rto_by_state(brand_id, days=90),
        "campaign_performance": engine.marketing_scale_cut_monitor(brand_id, days=14),
        "inventory_health": engine.inventory_health(brand_id),
    }


def answer_question(brand_id: str, question: str) -> dict:
    context = _gather_context(brand_id, question)

    api_key = current_app.config.get("ANTHROPIC_API_KEY")
    if not api_key:
        return {
            "answer": (
                "AI assistant is not configured yet (missing ANTHROPIC_API_KEY). "
                "Here is the raw data that would have been used to answer your question."
            ),
            "context_used": context,
            "configured": False,
        }

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    user_message = (
        f"Founder's question: {question}\n\n"
        f"Live business data (JSON):\n{json.dumps(context, indent=2)}"
    )

    response = client.messages.create(
        model=current_app.config.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
        max_tokens=1000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )

    answer_text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
    return {"answer": answer_text, "context_used": context, "configured": True}
