"""Help requests from inside the app (roadmap U4-5).

POST /api/support-requests            any logged-in staff (barista included)
GET  /api/support-requests            manager roles: the list, newest first
POST /api/support-requests/<id>/handled

The ? button sends what the person typed plus where they were (screen,
station, version) and the server adds who they are and the latest
crashes, so nobody has to ask "which tablet, what were you doing?". The
admin alert number gets a short text (services/admin_alerts), once per
request, not rate-limited away: each request is a person waiting.
"""
import json
import logging

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo

logger = logging.getLogger("expresso.routes.support_requests")

bp = Blueprint("support_requests", __name__, url_prefix="/api/support-requests")

STAFF = ["admin", "staff", "barista", "organizer", "organiser", "event_organizer", "support"]
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer", "support"]


def _db():
    return current_app.config.get("coffee_system").db


def _who():
    # The app's before_request decodes the login into g.user, and then
    # jwt_required_with_demo skips flask_jwt_extended entirely, so get_jwt()
    # is empty. Read g.user first.
    try:
        from flask import g

        u = getattr(g, "user", None)
        if isinstance(u, dict) and (u.get("username") or u.get("role")):
            return str(u.get("username") or u.get("full_name") or "")[:100], str(u.get("role") or "")[:40]
    except Exception:
        pass
    try:
        from flask_jwt_extended import get_jwt, get_jwt_identity

        claims = get_jwt() or {}
        # identity is the numeric user id; the username is a claim
        name = claims.get("username") or claims.get("full_name") or get_jwt_identity() or ""
        return str(name)[:100], str(claims.get("role") or "")[:40]
    except Exception:
        return "", ""


@bp.route("", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(STAFF)
def create():
    body = request.get_json(silent=True) or {}
    message = str(body.get("message") or "").strip()
    if not message:
        return jsonify({"success": False, "message": "Say what's wrong first."}), 400
    username, role = _who()
    screen = str(body.get("screen") or "")[:300]
    station = str(body.get("station") or "")[:40]
    version = str(body.get("app_version") or "")[:80]
    db = _db()
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    crashes = []
    try:
        cur.execute(
            "SELECT occurred_at, component, LEFT(message, 200), url FROM client_errors "
            "WHERE occurred_at > NOW() - INTERVAL '30 minutes' ORDER BY occurred_at DESC LIMIT 5")
        crashes = [{"at": str(r[0]), "where": r[1], "message": r[2], "url": r[3]} for r in cur.fetchall()]
    except Exception:
        db.rollback()
        cur = db.cursor()
    diagnostics = {"crashes_last_30_min": crashes, "client": body.get("diagnostics") or {}}
    cur.execute(
        "INSERT INTO support_requests (username, role, message, screen, station, app_version, user_agent, diagnostics) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (username, role, message[:4000], screen, station, version,
         (request.headers.get("User-Agent") or "")[:400], json.dumps(diagnostics)[:20000]))
    rid = cur.fetchone()[0]
    db.commit()
    notified = False
    try:
        from services.admin_alerts import send_admin_alert, _last_sent

        _last_sent.pop(f"SUPPORT_REQUEST_{rid}", None)
        where = f"station {station}" if station else (screen or "the app")
        text = (f"CupQ help request #{rid} from {username or 'someone'} at {where}: "
                f"{message[:240]}" + (f" ({len(crashes)} crash(es) in the last 30 min)" if crashes else ""))
        notified = bool(send_admin_alert(f"SUPPORT_REQUEST_{rid}", "critical", text, db=db))
        if notified:
            cur = db.cursor()
            cur.execute("UPDATE support_requests SET notified = TRUE WHERE id = %s", (rid,))
            db.commit()
    except Exception as e:
        logger.warning(f"support request {rid}: alert not sent: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    return jsonify({"success": True, "id": rid, "notified": notified})


@bp.route("", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def list_requests():
    db = _db()
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute(
        "SELECT id, created_at, username, role, message, screen, station, app_version, diagnostics, notified, handled_at "
        "FROM support_requests ORDER BY id DESC LIMIT 100")
    out = []
    for r in cur.fetchall():
        v = list(r.values()) if isinstance(r, dict) else list(r)
        try:
            diag = json.loads(v[8] or "{}")
        except ValueError:
            diag = {}
        # Stored as UTC without a zone; say so, or the browser reads it as local time.
        out.append({"id": v[0], "created_at": (v[1].isoformat() + "Z") if v[1] else None, "username": v[2], "role": v[3],
                    "message": v[4], "screen": v[5], "station": v[6], "app_version": v[7],
                    "crashes": len(diag.get("crashes_last_30_min") or []), "diagnostics": diag,
                    "notified": bool(v[9]), "handled_at": (v[10].isoformat() + "Z") if v[10] else None})
    db.rollback()
    return jsonify({"success": True, "requests": out})


@bp.route("/<int:rid>/handled", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def mark_handled(rid):
    db = _db()
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("UPDATE support_requests SET handled_at = NOW() AT TIME ZONE 'UTC' WHERE id = %s AND handled_at IS NULL", (rid,))
    db.commit()
    return jsonify({"success": True})
