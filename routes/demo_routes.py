"""The Demo Room's server side: /api/demo/...

GET    /api/demo/texts    texts filed to demo numbers (services/demo_texts)
DELETE /api/demo/texts    forget them
POST   /api/demo/sms      a demo customer texts the event: the real text-
                          ordering conversation runs, the reply is filed
POST   /api/demo/wipe     remove the demo's orders (and only those)

Staff only: demo texts carry nothing personal, but the Demo Room itself is
behind the login and so is what feeds it.
"""
import json
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


# A demo order is one placed inside the Demo Room (order_details.demo, set
# by the frames) or one on a demo number (texted, or typed at the kiosk).
_DEMO_ORDERS_SQL = (
    "SELECT id, order_number, station_id, order_details FROM orders "
    "WHERE phone LIKE %s OR order_details->>'demo' = 'true'"
)


@bp.route("/wipe", methods=["POST"])
@support_role_required
def wipe_demo():
    """Remove every demo order and what hangs off it, put back the stock
    those orders took (demo coffees were never really made), and forget
    the demo texts. Real orders are never touched: the WHERE clause above
    is the whole definition of "demo". Body: {"confirm": "DEMO"}."""
    body = request.get_json(silent=True) or {}
    if body.get("confirm") != "DEMO":
        return jsonify({"success": False, "status": "error",
                        "message": 'Send {"confirm": "DEMO"} to wipe the demo orders.'}), 400
    coffee_system = current_app.config.get("coffee_system")
    db = coffee_system.db
    like = demo_texts.DEMO_PHONE_PREFIX + "%"
    counts = {}
    try:
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(_DEMO_ORDERS_SQL, (like,))
        rows = cur.fetchall()
        ids, numbers = [], []
        restocked = 0
        for r in rows:
            if isinstance(r, dict):
                oid, onum, sid, det = r["id"], r["order_number"], r["station_id"], r["order_details"]
            else:
                oid, onum, sid, det = r
            ids.append(oid)
            numbers.append(str(onum))
            if isinstance(det, str):
                try:
                    det = json.loads(det)
                except ValueError:
                    det = None
            if isinstance(det, dict) and det.get("_stock_decremented") and not det.get("_stock_restocked"):
                coffee_system._restock_for_order(db, "postgres", sid, det)
                # Same as cancel: keep the helper's _stock_restocked mark, so
                # a wipe that fails below and is run again never restocks twice.
                cur = db.cursor()
                cur.execute("UPDATE orders SET order_details = %s WHERE id = %s",
                            (json.dumps(det), oid))
                db.commit()
                restocked += 1
        cur = db.cursor()
        if ids:
            for table in ("feedback", "payment_transactions", "loyalty_transactions"):
                cur.execute(f"DELETE FROM {table} WHERE order_id = ANY(%s)", (ids,))  # noqa: S608
                counts[table] = cur.rowcount
            cur.execute("DELETE FROM order_messages WHERE order_number = ANY(%s)", (numbers,))
            counts["order_messages"] = cur.rowcount
            cur.execute("DELETE FROM print_jobs WHERE order_id = ANY(%s)", (numbers,))
            counts["print_jobs"] = cur.rowcount
        for table, col in (("conversation_states", "phone"), ("customer_questions", "phone"),
                           ("partial_orders", "phone"), ("customer_preferences", "phone"),
                           ("order_messages", "phone"), ("sms_messages", "phone_number")):
            cur.execute(f"DELETE FROM {table} WHERE {col} LIKE %s", (like,))  # noqa: S608
            counts[table] = counts.get(table, 0) + cur.rowcount
        if ids:
            cur.execute("DELETE FROM orders WHERE id = ANY(%s)", (ids,))
        counts["orders"] = len(ids)
        db.commit()
    except Exception as e:
        logger.exception(f"demo wipe failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "status": "error",
                        "message": f"Wipe failed, nothing removed: {e}"}), 500
    demo_texts.clear()
    logger.info(f"demo wipe: {counts}")
    return jsonify({"success": True, "status": "success",
                    "data": {"removed": counts, "orders": len(ids), "restocked": restocked}})
