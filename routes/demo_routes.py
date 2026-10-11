"""The Demo Room's server side: /api/demo/...

GET    /api/demo/texts    texts filed to demo numbers (services/demo_texts)
DELETE /api/demo/texts    forget them
POST   /api/demo/sms      a demo customer texts the event: the real text-
                          ordering conversation runs, the reply is filed

Staff only: demo texts carry nothing personal, but the Demo Room itself is
behind the login and so is what feeds it.
"""
import logging

from flask import Blueprint, current_app, jsonify, request

from routes.support_api_routes import support_role_required
from services import demo_texts
from services.messaging import _to_e164_au

logger = logging.getLogger("expresso.routes.demo")

bp = Blueprint("demo_api", __name__, url_prefix="/api/demo")


@bp.route("/texts", methods=["GET"])
@support_role_required
def get_texts():
    phone = request.args.get("phone")
    phone = _to_e164_au(phone) if phone else None
    try:
        after = int(request.args.get("after") or 0)
    except ValueError:
        after = 0
    return jsonify(
        {
            "success": True,
            "status": "success",
            "data": {
                "texts": demo_texts.list_texts(phone=phone, after=after),
                "first_demo_phone": demo_texts.FIRST_DEMO_PHONE,
            },
        }
    )


@bp.route("/texts", methods=["DELETE"])
@support_role_required
def clear_texts():
    demo_texts.clear()
    return jsonify({"success": True, "status": "success", "data": {"texts": []}})


@bp.route("/sms", methods=["POST"])
@support_role_required
def demo_sms():
    """Text the event as a demo customer would, from the Demo Room.

    Runs coffee_system.handle_sms -- the same conversation a real text
    gets, so the order it makes is a real order on this event -- and files
    both sides in the Messages pane. Only demo numbers are accepted, so
    this can never speak as, or reply to, a real person."""
    body = request.get_json(silent=True) or {}
    text = str(body.get("text") or "").strip()
    phone = _to_e164_au(str(body.get("phone") or demo_texts.FIRST_DEMO_PHONE).strip())
    if not demo_texts.is_demo(phone):
        return jsonify({"success": False, "status": "error",
                        "message": "Demo texts must come from 0400 009 900 to 0400 009 999."}), 400
    if not text:
        return jsonify({"success": False, "status": "error", "message": "Type a message."}), 400
    if len(text) > 480:
        return jsonify({"success": False, "status": "error", "message": "That message is too long."}), 400
    coffee_system = current_app.config.get("coffee_system")
    messaging_service = current_app.config.get("messaging_service")
    if coffee_system is None or messaging_service is None:
        return jsonify({"success": False, "status": "error",
                        "message": "Text ordering isn't running on this server."}), 503
    demo_texts.add(phone, text, "customer", direction="in")
    try:
        reply = coffee_system.handle_sms(phone, text, messaging_service, {"sms_provider": "demo"})
    except Exception as e:
        logger.exception(f"demo sms: handle_sms failed: {e}")
        reply = "Sorry, our system is having a moment. Please try again."
    if isinstance(reply, str) and reply.strip():
        demo_texts.add(phone, reply, "reply")
    return jsonify({"success": True, "status": "success",
                    "data": {"texts": demo_texts.list_texts(phone=phone)}})
