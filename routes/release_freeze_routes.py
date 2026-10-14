"""Event freeze: no updates while an event is being served (roadmap S1-4).

GET /api/public/release-freeze      {frozen, reason}   no login (CI reads it)
GET /api/settings/release-freeze    the switch          staff
PUT /api/settings/release-freeze    {on: bool}          admin

Frozen when the organiser has switched it on (Runner > Settings), OR when
an order was placed or changed in the last 30 minutes, so a busy morning
freezes itself even if nobody remembered. The CI check "Event freeze"
fails every change while cupq.app says it is frozen; an emergency fix gets
the PR label freeze-override.

Says nothing personal: just frozen or not, and why in one line.
"""
import logging
from datetime import datetime, timezone

from flask import Blueprint, current_app, g, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo

logger = logging.getLogger("expresso.routes.release_freeze")

public_bp = Blueprint("release_freeze_public", __name__, url_prefix="/api/public")
bp = Blueprint("release_freeze", __name__, url_prefix="/api/settings")

KV_KEY = "release_freeze"
SERVICE_WINDOW_MIN = 30


def _db():
    return current_app.config.get("coffee_system").db


def _switch(db):
    from routes.consolidated_api_routes import _kv_get

    v = _kv_get(db, KV_KEY, default={}) or {}
    return v if isinstance(v, dict) else {}


def _in_service(db):
    db.rollback()
    cur = db.cursor()
    cur.execute(
        "SELECT 1 FROM orders WHERE COALESCE(updated_at, created_at) > NOW() - "
        "(%s || ' minutes')::interval LIMIT 1",
        (str(SERVICE_WINDOW_MIN),),
    )
    busy = cur.fetchone() is not None
    db.rollback()
    return busy


def freeze_state(db):
    sw = _switch(db)
    if sw.get("on"):
        return {
            "frozen": True,
            "reason": "The organiser has frozen updates for the event.",
        }
    try:
        if _in_service(db):
            return {
                "frozen": True,
                "reason": f"Orders in the last {SERVICE_WINDOW_MIN} minutes: an event is being served.",
            }
    except Exception as e:
        logger.warning("release freeze: service check failed: %s", e)
    return {"frozen": False, "reason": "No event being served."}


@public_bp.route("/release-freeze", methods=["GET"])
def public_freeze():
    try:
        return jsonify({"success": True, **freeze_state(_db())})
    except Exception as e:
        # Unknown is treated as frozen by the CI check: safer to wait.
        logger.warning("release freeze unknown: %s", e)
        return (
            jsonify({"success": False, "frozen": True, "reason": "Couldn't check."}),
            503,
        )


@bp.route("/release-freeze", methods=["GET"])
@jwt_required_with_demo()
def get_switch():
    db = _db()
    sw = _switch(db)
    return jsonify(
        {
            "success": True,
            "on": bool(sw.get("on")),
            "by": sw.get("by"),
            "at": sw.get("at"),
            **{"state": freeze_state(db)},
        }
    )


@bp.route("/release-freeze", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def put_switch():
    from routes.consolidated_api_routes import _kv_put

    on = bool((request.get_json(silent=True) or {}).get("on"))
    who = (getattr(g, "user", None) or {}).get("username") or ""
    _kv_put(
        _db(),
        KV_KEY,
        {"on": on, "by": who, "at": datetime.now(timezone.utc).isoformat()},
    )
    logger.warning("release freeze %s by %s", "ON" if on else "off", who)
    return jsonify({"success": True, "on": on})
