"""What the customer's phone says at each stage (roadmap X7-5).

GET /api/settings/customer-wording   the organiser's wording (staff)
PUT /api/settings/customer-wording   save it (manager roles)

The phone page and /my get it through the public /api/display/config as
`customer_wording`. Only the stages below, each one line; an empty entry
means "use CupQ's wording" (constants/customerStatus.js on the frontend).
"""
import logging

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo

logger = logging.getLogger("expresso.routes.customer_wording")

bp = Blueprint("customer_wording", __name__, url_prefix="/api/settings")

KV_KEY = "customer_wording"
# Same keys as CUSTOMER_STATUS in the frontend.
STAGES = (
    "awaiting_payment",
    "pending",
    "in-progress",
    "completed",
    "picked_up",
    "cancelled",
)
MAX_LEN = 60
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer"]


def clean(raw):
    """Only known stages, trimmed, one line, at most MAX_LEN characters."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k in STAGES:
        v = raw.get(k)
        if v is None:
            continue
        v = " ".join(str(v).split())[:MAX_LEN]
        if v:
            out[k] = v
    return out


def for_display(db):
    """For the public display config. Never raises: a broken setting means
    the phone shows CupQ's own wording, not an error."""
    try:
        from routes.consolidated_api_routes import _kv_get

        return clean(_kv_get(db, KV_KEY, default={}) or {})
    except Exception as e:
        logger.warning("customer wording unavailable: %s", e)
        return {}


def _db():
    return current_app.config.get("coffee_system").db


@bp.route("/customer-wording", methods=["GET"])
@jwt_required_with_demo()
def get_wording():
    return jsonify(
        {
            "success": True,
            "wording": for_display(_db()),
            "stages": list(STAGES),
            "max_length": MAX_LEN,
        }
    )


@bp.route("/customer-wording", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def put_wording():
    from routes.consolidated_api_routes import _kv_put

    body = request.get_json(silent=True) or {}
    wording = clean(body.get("wording") if "wording" in body else body)
    db = _db()
    _kv_put(db, KV_KEY, wording)
    return jsonify({"success": True, "wording": wording})
