"""Editing the text bot's wording (roadmap X7-6).

GET /api/settings/sms-wording   every catalogued message: default, the
                                organiser's override, placeholders, cost
PUT /api/settings/sms-wording   {wording: {key: text}} save overrides

Cost is per message: how many billed segments it takes, and whether it
uses a character outside plain GSM text (an emoji or a curly quote makes
every segment 70 characters instead of 160, roughly tripling the cost;
see services/sms_meter). Placeholders count at a typical length.
"""
import logging

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from services import sms_wording

logger = logging.getLogger("expresso.routes.sms_wording")

bp = Blueprint("sms_wording", __name__, url_prefix="/api/settings")
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer"]

# Typical length of what a placeholder becomes, for the cost estimate.
SAMPLE = {
    "name": "Alex",
    "drink": "flat white",
    "order_number": "123",
    "size": "large",
    "sizes": "small, medium, large",
    "available": "latte, flat white, cappuccino, long black, mocha",
}


def _cost(key, text):
    from services.sms_meter import is_gsm, segments

    try:
        filled = text.format(
            **{k: SAMPLE.get(k, "xxxxxxxx") for k in sms_wording.CATALOG[key][1]}
        )
    except (KeyError, IndexError, ValueError):
        filled = text
    return {
        "segments": segments(filled),
        "plain_text": is_gsm(filled),
        "chars": len(filled),
    }


def _payload(overrides):
    out = []
    for key, (default, holders, where) in sms_wording.CATALOG.items():
        own = overrides.get(key, "")
        used = own if own and not sms_wording.problems(key, own) else default
        out.append(
            {
                "key": key,
                "where": where,
                "default": default,
                "placeholders": holders,
                "override": own,
                "problem": sms_wording.problems(key, own) if own else None,
                "cost": _cost(key, used),
            }
        )
    return out


def _read(db):
    from routes.consolidated_api_routes import _kv_get

    v = _kv_get(db, sms_wording.KV_KEY, default={}) or {}
    return (
        {k: str(t) for k, t in v.items() if k in sms_wording.CATALOG}
        if isinstance(v, dict)
        else {}
    )


@bp.route("/sms-wording", methods=["GET"])
@jwt_required_with_demo()
def get_sms_wording():
    db = current_app.config.get("coffee_system").db
    return jsonify(
        {
            "success": True,
            "messages": _payload(_read(db)),
            "max_length": sms_wording.MAX_LEN,
        }
    )


@bp.route("/sms-wording", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def put_sms_wording():
    from routes.consolidated_api_routes import _kv_put

    incoming = (request.get_json(silent=True) or {}).get("wording") or {}
    if not isinstance(incoming, dict):
        return jsonify({"success": False, "message": "wording must be an object"}), 400
    clean, refused = {}, {}
    for key, text in incoming.items():
        text = str(text or "").strip()
        if key not in sms_wording.CATALOG or not text:
            continue
        why = sms_wording.problems(key, text)
        if why:
            refused[key] = why
        else:
            clean[key] = text
    if refused:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Some messages can't be used.",
                    "problems": refused,
                }
            ),
            400,
        )
    db = current_app.config.get("coffee_system").db
    _kv_put(db, sms_wording.KV_KEY, clean)
    sms_wording.clear_cache()
    return jsonify({"success": True, "messages": _payload(clean)})
