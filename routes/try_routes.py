"""Try it live: a public, self-guided demo (demo.cupq.app/try).

A visitor orders a coffee, by text on the page or on their own phone from
a QR code, then presses Next to play the barista: Start, Ready, Collected.
Every step is the real system: the text conversation is
coffee_system.handle_sms, and the barista's buttons call the same
/api/orders/<id>/start|complete|pickup a barista's tablet calls, signed in
as a demo barista. So the started and ready texts, the cup label and the
board all happen for real, on the demo copy.

OFF unless TRY_DEMO_ENABLED=true, which is set on demo.cupq.app only, never
on a client's copy. Each visitor gets a session token and a demo number
(0400 009 950 - 999; texts to demo numbers are recorded, never sent, see
services/demo_texts.py). A session only ever sees and moves its own order.

POST /api/try/session          start: {token, phone}
POST /api/try/text             {token, text}: text the event as the visitor
GET  /api/try/state?token=     texts, the order and where it's up to
POST /api/try/advance          {token, action: start|ready|collect}
GET  /api/try/label?token=     the cup label as the printer would print it
"""
import logging
import os
import secrets
import threading
import time

from flask import Blueprint, Response, current_app, jsonify, request

from security_middleware import _client_ip, limiter
from services import demo_texts

logger = logging.getLogger("expresso.routes.try")

bp = Blueprint("try_demo", __name__, url_prefix="/api/try")

POOL = [f"+6140000{9950 + i}" for i in range(50)]  # +61400009950 .. +61400009999
SESSION_TTL_S = 2 * 3600
ACTIONS = {"start": "start", "ready": "complete", "collect": "pickup"}

_lock = threading.Lock()
_sessions = {}  # token -> {"phone", "created", "src"}
_next = {"i": 0}


def enabled():
    return (os.getenv("TRY_DEMO_ENABLED") or "").lower() == "true"


def _off():
    return jsonify({"success": False, "message": "The live demo isn't on here."}), 404


def _session(token):
    with _lock:
        s = _sessions.get(str(token or ""))
        if s and time.time() - s["created"] > SESSION_TTL_S:
            _sessions.pop(token, None)
            return None
        return s


def _fresh_start(phone):
    """Forget everything this demo number did before, so the next visitor
    isn't greeted as the last one: the saved name and drink, the conversation,
    and any of its orders still open (cancelled, so the board clears)."""
    cs = current_app.config.get("coffee_system")
    try:
        cs._reset_conversation_state(phone)
    except Exception as e:
        logger.debug("try: reset conversation %s: %s", phone[-3:], e)
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM customer_preferences WHERE phone = %s", (phone,))
        cur.execute("UPDATE orders SET status = 'cancelled' WHERE phone = %s "
                    "AND status NOT IN ('completed', 'picked_up', 'cancelled')", (phone,))
        # Any demo a visitor walked away from more than an hour ago, so the
        # demo board doesn't fill up with half-made coffees.
        cur.execute("UPDATE orders SET status = 'cancelled' WHERE status NOT IN "
                    "('completed', 'picked_up', 'cancelled') AND created_at < NOW() - INTERVAL '1 hour' "
                    "AND (phone = ANY(%s) OR order_details->>'source_code' LIKE 'try-%%')", (POOL,))
        # This only runs on a demo copy (TRY_DEMO_ENABLED). Anything left open
        # there for 6 hours is a test or a forgotten demo, and it made every
        # visitor "#104 in line" (16 Oct 2026). Today's demos are untouched.
        cur.execute("UPDATE orders SET status = 'cancelled' WHERE status NOT IN "
                    "('completed', 'picked_up', 'cancelled') AND created_at < NOW() - INTERVAL '6 hours'")
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.warning("try: fresh start for %s failed: %s", phone[-3:], e)
    finally:
        close_connection(conn)


def _order_for(s):
    """This session's newest order: placed by text from its demo number, or
    on the visitor's phone with the session's tag (source_code)."""
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, order_number, status, station_id, order_details, created_at "
            "FROM orders WHERE (phone = %s OR order_details->>'source_code' = %s) "
            "AND created_at > NOW() - make_interval(secs => %s) ORDER BY created_at DESC LIMIT 1",
            # Only orders placed since THIS session began: demo numbers are
            # reused, and the last visitor's order on the same number showed
            # up as this visitor's (found on demo.cupq.app, 16 Oct 2026).
            (s["phone"], s["src"], max(1.0, time.time() - s["created"] + 5)))
        r = cur.fetchone()
    finally:
        close_connection(conn)
    if not r:
        return None
    v = list(r.values()) if isinstance(r, dict) else list(r)
    det = v[4]
    if isinstance(det, str):
        import json

        try:
            det = json.loads(det)
        except ValueError:
            det = {}
    det = det or {}
    return {
        "id": v[0], "number": v[1], "status": v[2], "station_id": v[3], "name": det.get("name") or "",
        "drink": det.get("type") or det.get("coffee_type") or det.get("drink") or "",
        "size": det.get("size") or "", "milk": det.get("milk") or det.get("milk_type") or "",
        "via": "phone" if det.get("source_code") == s["src"] else "text",
    }


def _barista_token():
    """A short-lived login for the demo barista, used only to press this
    session's buttons through the real routes."""
    from flask_jwt_extended import create_access_token
    from datetime import timedelta

    return create_access_token(
        identity="try-demo-barista",
        additional_claims={"username": "demo-barista", "role": "barista", "full_name": "Demo barista"},
        expires_delta=timedelta(minutes=2))


def _as_barista(method, path, **kw):
    client = current_app._get_current_object().test_client()
    headers = {"Authorization": f"Bearer {_barista_token()}"}
    return getattr(client, method)(path, headers=headers, **kw)


@bp.route("/session", methods=["POST"])
@limiter.limit("20 per hour", key_func=_client_ip)
def start_session():
    if not enabled():
        return _off()
    with _lock:
        phone = POOL[_next["i"] % len(POOL)]
        _next["i"] += 1
        token = secrets.token_urlsafe(12)
        # Drop expired sessions and any older session on the same number.
        now = time.time()
        for t in [t for t, s in _sessions.items() if now - s["created"] > SESSION_TTL_S or s["phone"] == phone]:
            _sessions.pop(t, None)
        src = "try-" + "".join(ch for ch in token.lower() if ch.isalnum())[:16]
        _sessions[token] = {"phone": phone, "created": now, "src": src}
    _fresh_start(phone)
    local = f"0{phone[3:6]} {phone[6:9]} {phone[9:]}"
    return jsonify({"success": True, "token": token, "phone": local, "src": src})


@bp.route("/text", methods=["POST"])
@limiter.limit("40 per minute", key_func=_client_ip)
def text():
    if not enabled():
        return _off()
    body = request.get_json(silent=True) or {}
    s = _session(body.get("token"))
    if not s:
        return jsonify({"success": False, "message": "This demo has timed out. Start again."}), 410
    msg = str(body.get("text") or "").strip()[:300]
    if not msg:
        return jsonify({"success": False, "message": "Type a message."}), 400
    cs = current_app.config.get("coffee_system")
    ms = current_app.config.get("messaging_service")
    demo_texts.add(s["phone"], msg, "customer", direction="in")
    try:
        reply = cs.handle_sms(s["phone"], msg, ms, {"sms_provider": "demo"})
    except Exception as e:
        logger.exception("try: handle_sms failed: %s", e)
        reply = "Sorry, our system is having a moment. Please try again."
    if isinstance(reply, str) and reply.strip():
        demo_texts.add(s["phone"], reply, "reply")
    return jsonify({"success": True, "texts": demo_texts.list_texts(phone=s["phone"])})


@bp.route("/state", methods=["GET"])
@limiter.limit("120 per minute", key_func=_client_ip)
def state():
    if not enabled():
        return _off()
    s = _session(request.args.get("token"))
    if not s:
        return jsonify({"success": False, "message": "This demo has timed out. Start again."}), 410
    return jsonify({"success": True, "order": _order_for(s),
                    "texts": demo_texts.list_texts(phone=s["phone"])})


@bp.route("/advance", methods=["POST"])
@limiter.limit("30 per minute", key_func=_client_ip)
def advance():
    if not enabled():
        return _off()
    body = request.get_json(silent=True) or {}
    s = _session(body.get("token"))
    if not s:
        return jsonify({"success": False, "message": "This demo has timed out. Start again."}), 410
    action = ACTIONS.get(str(body.get("action") or ""))
    if not action:
        return jsonify({"success": False, "message": "action must be start, ready or collect"}), 400
    o = _order_for(s)
    if not o:
        return jsonify({"success": False, "message": "Order a coffee first."}), 409
    payload = {"station_id": o["station_id"]} if action == "start" else {}
    r = _as_barista("post", f"/api/orders/{o['number']}/{action}", json=payload)
    ok = r.status_code < 400
    if not ok:
        logger.warning("try: %s on order %s answered %s: %s", action, o["number"], r.status_code,
                       r.get_data(as_text=True)[:200])
    return jsonify({"success": ok, "order": _order_for(s),
                    "texts": demo_texts.list_texts(phone=s["phone"])}), (200 if ok else 502)


@bp.route("/label", methods=["GET"])
@limiter.limit("30 per minute", key_func=_client_ip)
def label():
    if not enabled():
        return _off()
    s = _session(request.args.get("token"))
    o = _order_for(s) if s else None
    if not o:
        return jsonify({"success": False, "message": "No order yet."}), 404
    r = _as_barista("get", f"/api/print/preview?order_id={o['number']}")
    if r.status_code >= 400:
        return jsonify({"success": False, "message": "The label couldn't be drawn."}), 502
    return Response(r.get_data(), mimetype=r.mimetype or "image/png",
                    headers={"Cache-Control": "no-store"})
