"""The public status of this event (roadmap U4-4): cupq.app/status.

GET /api/public/status, no login. Answers the question a client or venue
asks on the day -- is it working? -- without anything personal: ordering
up, texts up, printers up, stations open. Cached 15 seconds so a page left
open on twenty phones can't add load.
"""
import logging
import threading
import time
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify

logger = logging.getLogger("expresso.routes.public_status")

bp = Blueprint("public_status", __name__, url_prefix="/api/public")

_CACHE = {"at": 0.0, "body": None}
_LOCK = threading.Lock()
TTL_S = 15
PRINTER_ONLINE_S = 90


def _one(cur, sql, params=()):
    cur.execute(sql, params)
    r = cur.fetchone()
    if not r:
        return 0
    return (r[0] if not isinstance(r, dict) else list(r.values())[0]) or 0


def build_status():
    parts = []
    event_name = ""
    cs = current_app.config.get("coffee_system")
    db = cs.db if cs else None
    ordering_up = False
    try:
        db.rollback()
        cur = db.cursor()
        cur.execute("SELECT 1")
        cur.fetchone()
        ordering_up = True
        try:
            event_name = getattr(cs, "event_name", "") or ""
        except Exception:
            event_name = ""
        stations = int(_one(cur, "SELECT COUNT(*) FROM station_stats WHERE status = 'active'"))
        printers = int(_one(cur, "SELECT COUNT(*) FROM printers WHERE enabled = TRUE"))
        online = int(_one(cur, "SELECT COUNT(*) FROM printers WHERE enabled = TRUE AND last_poll_at > NOW() - "
                               "(%s || ' seconds')::interval", (str(PRINTER_ONLINE_S),)))
        db.rollback()
    except Exception as e:
        logger.warning(f"public status: database check failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        stations = printers = online = 0

    parts.append({"name": "Ordering", "state": "up" if ordering_up else "down",
                  "detail": "Taking orders" if ordering_up else "Not answering. The team has been alerted."})
    if ordering_up:
        parts.append({"name": "Coffee stations", "state": "up" if stations else "down",
                      "detail": f"{stations} open" if stations else "None open right now"})

    ms = current_app.config.get("messaging_service")
    if ms is None or getattr(ms, "testing_mode", False):
        parts.append({"name": "Text messages", "state": "off", "detail": "Not used at this event"})
    else:
        try:
            from services import sms_health

            snap = sms_health.snapshot(db=None, messaging_service=ms)
            down = bool(snap.get("outbound_down"))
        except Exception:
            down = False
        parts.append({"name": "Text messages", "state": "down" if down else "up",
                      "detail": "Delayed. Watch the screen or your phone page for your name." if down
                      else "Sending normally"})

    if printers:
        state = "up" if online == printers else ("degraded" if online else "down")
        parts.append({"name": "Cup labels", "state": state,
                      "detail": f"{online} of {printers} printer{'s' if printers != 1 else ''} online"})

    states = [p["state"] for p in parts if p["state"] != "off"]
    overall = "down" if not ordering_up else ("degraded" if any(s != "up" for s in states) else "up")
    return {"success": True, "event_name": event_name, "overall": overall, "parts": parts,
            "checked_at": datetime.now(timezone.utc).isoformat()}


@bp.route("/status", methods=["GET"])
def public_status():
    with _LOCK:
        if _CACHE["body"] is not None and time.monotonic() - _CACHE["at"] < TTL_S:
            return jsonify(_CACHE["body"])
    body = build_status()
    with _LOCK:
        _CACHE.update(at=time.monotonic(), body=body)
    return jsonify(body)
