"""The on-call roster (roadmap U4-6).

GET /api/settings/on-call   the roster, who is on now, the event's clock
PUT /api/settings/on-call   {shifts: [{name, phone, email, day, start, end}]}

Alerts and ? button requests text whoever is on call now, as well as the
admin alert number (services/admin_alerts). Times are the event's clock.
"""
import logging

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from services import on_call

logger = logging.getLogger("expresso.routes.on_call")

bp = Blueprint("on_call", __name__, url_prefix="/api/settings")
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer", "support"]


def _db():
    return current_app.config.get("coffee_system").db


def _payload(db, shifts):
    from routes.consolidated_api_routes import _event_timezone

    now = on_call.event_now()
    return {
        "success": True,
        "shifts": shifts,
        "on_now": [s["name"] for s in shifts if on_call.covers(s, now)],
        "timezone": _event_timezone(),
        "event_now": now.strftime("%Y-%m-%d %H:%M"),
    }


@bp.route("/on-call", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def get_on_call():
    db = _db()
    return jsonify(_payload(db, on_call.load(db)))


@bp.route("/on-call", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def put_on_call():
    from routes.consolidated_api_routes import _kv_put

    raw = (request.get_json(silent=True) or {}).get("shifts")
    if not isinstance(raw, list):
        return jsonify({"success": False, "message": "shifts must be a list"}), 400
    if len(raw) > on_call.MAX_SHIFTS:
        return jsonify({"success": False, "message": f"at most {on_call.MAX_SHIFTS} shifts"}), 400
    clean, problems = [], []
    for i, r in enumerate(raw):
        s, why = on_call.clean_shift(r)
        if s:
            clean.append(s)
        else:
            problems.append(f"Row {i + 1}: {why}")
    if problems:
        return jsonify({"success": False, "message": "Some shifts can't be saved.", "problems": problems}), 400
    db = _db()
    _kv_put(db, on_call.KV_KEY, clean)
    return jsonify(_payload(db, clean))
