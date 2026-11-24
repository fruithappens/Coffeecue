"""The client's event report and their feedback (roadmap U4-11).

GET  /api/settings/client-report   who it goes to, which days, sent or not
PUT  /api/settings/client-report   {on, email, from, to}
GET  /event-feedback/<token>       the 3-question form in the report email
POST /event-feedback/<token>       their answers -> System > Enquiries

Sending is in services/client_report.py (the morning after the last day).
"""
import logging
import re
from html import escape

from flask import Blueprint, Response, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from security_middleware import _client_ip, limiter
from services import client_report
from utils import event_time

logger = logging.getLogger("expresso.routes.client_report")

bp = Blueprint("client_report", __name__)
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer"]
EMAIL_RE = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
MAX_ANSWER = 1500


def _conn():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    from utils.database import close_connection

    close_connection(conn)


def _public(cfg):
    from services.email_utils import email_enabled

    cfg = cfg if isinstance(cfg, dict) else {}
    return {
        "on": bool(cfg.get("on")),
        **{k: cfg.get(k) or "" for k in ("email", "from", "to")},
        "sent_at": cfg.get("sent_at"),
        "error": cfg.get("error"),
        "email_enabled": email_enabled(),
    }


@bp.route("/api/settings/client-report", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def get_client_report():
    conn = _conn()
    try:
        cfg = client_report._get(conn.cursor(), client_report.KV_KEY)
        return jsonify({"success": True, **_public(cfg)})
    finally:
        _release(conn)


@bp.route("/api/settings/client-report", methods=["PUT"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def put_client_report():
    body = request.get_json(silent=True) or {}
    email = str(body.get("email") or "").strip()[:200]
    first, last = event_time.parse_date(body.get("from")), event_time.parse_date(body.get("to"))
    on = bool(body.get("on"))
    if on and not EMAIL_RE.match(email):
        return jsonify({"success": False, "message": "Enter the client's email address."}), 400
    if on and (not first or not last or last < first):
        return jsonify({"success": False, "message": "Enter the first and last event day."}), 400

    from routes.account_recovery_routes import _base_url

    conn = _conn()
    try:
        cur = conn.cursor()
        old = client_report._get(cur, client_report.KV_KEY)
        old = old if isinstance(old, dict) else {}
        cfg = {
            "on": on,
            "email": email,
            "from": first.isoformat() if first else "",
            "to": last.isoformat() if last else "",
            "base_url": _base_url(),
        }
        if on:
            tz = event_time.resolve_zone(lambda k, d: client_report._get(cur, k) or d)
            if (event_time.local_today(tz) - last).days > client_report.GIVE_UP_DAYS:
                conn.rollback()
                return jsonify({"success": False, "message": "That event ended over a week ago. "
                                "Use Email it now instead."}), 400
        # The same event saved again isn't a second send.
        if all(old.get(k) == cfg[k] for k in ("email", "from", "to")):
            cfg["sent_at"] = old.get("sent_at")
        client_report._put(cur, client_report.KV_KEY, cfg)
        conn.commit()
        return jsonify({"success": True, **_public(cfg)})
    except Exception as e:
        conn.rollback()
        logger.error("client report settings not saved: %s", e)
        return jsonify({"success": False, "message": "Couldn't save that. Please try again."}), 500
    finally:
        _release(conn)


# -- the feedback form ------------------------------------------------------

_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>How did it go?</title><style>
body{{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#F7F2EA;color:#2B1E16;margin:0}}
main{{max-width:560px;margin:0 auto;padding:24px 16px}}h1{{font-size:24px;margin:0 0 4px}}
p{{margin:0 0 20px;color:#5C4A3D}}fieldset{{border:0;padding:0;margin:0 0 24px}}
legend,label.q{{font-weight:700;display:block;margin-bottom:8px}}
.r label{{display:inline-block;padding:10px 14px;margin:0 6px 8px 0;background:#fff;border:1px solid #8A7565;border-radius:8px}}
textarea{{width:100%;box-sizing:border-box;min-height:96px;padding:10px;font:inherit;border:1px solid #8A7565;border-radius:8px;margin-bottom:24px}}
button{{background:#3B2A20;color:#fff;border:0;border-radius:8px;padding:14px 22px;font:inherit;font-weight:700}}
.hp{{position:absolute;left:-9999px}}</style></head><body><main>{body}</main></body></html>"""

_RATINGS = [("5", "Great"), ("4", "Good"), ("3", "OK"), ("2", "Not great"), ("1", "Poor")]


def _page(body, status=200):
    resp = Response(_PAGE.format(body=body), status=status, mimetype="text/html")
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


def _gone():
    return _page("<h1>This link has expired</h1><p>Please reply to the email instead.</p>", 404)


def _link(token):
    conn = _conn()
    try:
        return client_report.find_link(client_report._get(conn.cursor(), client_report.LINKS_KEY), token)
    finally:
        _release(conn)


def _form(row, problem=""):
    ratings = "".join(
        f'<label><input type="radio" name="rating" value="{v}" required> {t}</label>' for v, t in _RATINGS
    )
    note = f'<p role="alert"><b>{escape(problem)}</b></p>' if problem else ""
    return (
        f"<h1>How did it go?</h1><p>{escape(str(row.get('event') or 'Your event'))}</p>{note}"
        '<form method="post"><fieldset class="r"><legend>1. How was the coffee service?</legend>'
        f"{ratings}</fieldset>"
        '<label class="q" for="worked">2. What worked well?</label>'
        f'<textarea id="worked" name="worked" maxlength="{MAX_ANSWER}"></textarea>'
        '<label class="q" for="change">3. What should we change next time?</label>'
        f'<textarea id="change" name="change" maxlength="{MAX_ANSWER}"></textarea>'
        '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">'
        "<button>Send</button></form>"
    )


@bp.route("/event-feedback/<token>", methods=["GET"])
@limiter.limit("60 per minute", key_func=_client_ip)
def feedback_form(token):
    row = _link(token)
    return _page(_form(row)) if row else _gone()


@bp.route("/event-feedback/<token>", methods=["POST"])
@limiter.limit("5 per minute; 20 per hour", key_func=_client_ip)
def feedback_send(token):
    row = _link(token)
    if not row:
        return _gone()
    thanks = "<h1>Thank you</h1><p>Your feedback has been sent.</p>"
    if str(request.form.get("website") or "").strip():
        return _page(thanks)
    rating = dict(_RATINGS).get(str(request.form.get("rating") or ""))
    if not rating:
        return _page(_form(row, "Please choose an answer to question 1."), 400)
    worked, change = (str(request.form.get(k) or "").strip()[:MAX_ANSWER] for k in ("worked", "change"))
    message = f"Coffee service: {rating}"
    if worked:
        message += f"\nWorked well: {worked}"
    if change:
        message += f"\nChange next time: {change}"
    conn = _conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO demo_requests (name, organisation, email, message, source, ip) "
            "VALUES (%s, %s, %s, %s, 'event_feedback', %s)",
            ("Event feedback", str(row.get("event") or "")[:160], str(row.get("email") or "")[:200],
             message, _client_ip()[:64]),
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error("event feedback not saved: %s", e)
        return _page(_form(row, "Sorry, that didn't send. Please try again."), 500)
    finally:
        _release(conn)
    try:
        from services.admin_alerts import send_admin_alert

        send_admin_alert("EVENT_FEEDBACK", "info", f"CupQ: event feedback ({rating}). See System > Enquiries.")
    except Exception as e:
        logger.warning("event feedback alert failed: %s", e)
    return _page(thanks)
