"""The runner's Text meter: how many texts this event has used, the cap,
and what the cap has held back. All the counting lives in
services/sms_meter.py; this file only reads it out and saves the two
things an organiser can change (the cap, and when the count starts)."""
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from auth import jwt_required_with_demo, role_required_with_demo
from services import sms_meter

logger = logging.getLogger("expresso.routes.sms_meter")

bp = Blueprint("sms_meter_api", __name__, url_prefix="/api")

# A cap past this is a typo, not a plan: Treenet's worst case was ~4,200.
MAX_CAP = 100000


def _who():
    try:
        return str(get_jwt_identity() or "")[:50] or None
    except Exception:
        return None


@bp.route("/sms/meter", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def get_meter():
    try:
        return jsonify(
            {"success": True, "status": "success", "data": sms_meter.snapshot()}
        )
    except Exception as e:
        logger.error(f"sms meter read failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not read the text meter.",
                }
            ),
            500,
        )


@bp.route("/sms/meter/cap", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def put_cap():
    """Body: {"cap": <whole number>} or {"cap": null} to follow the plan."""
    data = request.get_json(silent=True) or {}
    raw = data.get("cap")
    cap = None
    if raw not in (None, ""):
        try:
            cap = int(raw)
        except (TypeError, ValueError):
            return (
                jsonify(
                    {
                        "success": False,
                        "status": "error",
                        "message": "The cap must be a whole number of texts.",
                    }
                ),
                400,
            )
        if cap < 0 or cap > MAX_CAP:
            return (
                jsonify(
                    {
                        "success": False,
                        "status": "error",
                        "message": f"The cap must be between 0 and {MAX_CAP:,}.",
                    }
                ),
                400,
            )
    try:
        sms_meter.set_cap(cap, by=_who())
        return jsonify(
            {"success": True, "status": "success", "data": sms_meter.snapshot()}
        )
    except Exception as e:
        logger.error(f"sms meter cap save failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not save the cap.",
                }
            ),
            500,
        )


@bp.route("/sms/meter/new-count", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def new_count():
    """Start counting from zero for the next event on this instance. Deletes
    nothing -- every logged text stays; the meter just counts from now."""
    try:
        sms_meter.start_new_count(by=_who())
        return jsonify(
            {"success": True, "status": "success", "data": sms_meter.snapshot()}
        )
    except Exception as e:
        logger.error(f"sms meter reset failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not start a new count.",
                }
            ),
            500,
        )
