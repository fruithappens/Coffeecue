"""The "Book a demo" form on cupq.com.au.

The marketing site is static (a Cloudflare Worker serving files), so it
has nowhere to send a form. It used to be a mailto: link, which does
nothing on a computer with no mail app set up -- Steve clicked it and
nothing happened -- and it put his personal address on a public page.

Now the form posts here. Each enquiry is saved (demo_requests) and texted
to the admin alert number (Runner > Live > Readiness > Admin alerts), plus
emailed if an alert email and SMTP are configured. The Runner lists them
under System > Enquiries, so nothing depends on the text arriving.

This is the one endpoint anyone on the internet can post to, so:
  - CORS allows the marketing site's origins only (DEMO_FORM_ORIGINS adds
    more, e.g. a local preview);
  - rate limited per client;
  - a hidden "website" field that people never see and bots fill in:
    filled means drop it quietly, with the same reply as success so a bot
    learns nothing;
  - every field length-capped, and the text to Steve is plain ASCII.
"""
import logging
import os
import re

from flask import Blueprint, jsonify, request
from flask_cors import cross_origin

from auth import jwt_required_with_demo, role_required_with_demo
from security_middleware import _client_ip, limiter

logger = logging.getLogger("expresso.routes.demo_request")

bp = Blueprint("demo_request_api", __name__, url_prefix="/api")

_ORIGINS = ["https://cupq.com.au", "https://www.cupq.com.au"] + [
    o.strip() for o in os.getenv("DEMO_FORM_ORIGINS", "").split(",") if o.strip()
]

_LIMITS = {
    "name": 120,
    "organisation": 160,
    "email": 200,
    "phone": 40,
    "event_when": 120,
    "attendees": 40,
    "message": 2000,
    "quote": 4000,
    "source": 40,
}
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _clean(data, key):
    return str(data.get(key) or "").strip()[: _LIMITS[key]]


def _ascii(text):
    """What survives in a single-cost text: no emoji, no curly quotes."""
    text = (text or "").replace("’", "'").replace("‘", "'")
    text = text.replace("“", '"').replace("”", '"')
    text = text.replace("—", "-").replace("–", "-")
    return text.encode("ascii", "ignore").decode()


def _db():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    try:
        from utils.database import close_connection

        close_connection(conn)
    except Exception:
        pass


def _notify(row_id, f):
    """Text (and email, if set up) the admin alert recipient. Never raises."""
    try:
        from services.admin_alerts import load_config

        conn = _db()
        try:
            cfg = load_config(conn)
        finally:
            _release(conn)
    except Exception as e:
        logger.warning("demo request #%s: alert config unreadable: %s", row_id, e)
        return False

    reach = f["phone"] or f["email"]
    who = f["name"] + (f" ({f['organisation']})" if f["organisation"] else "")
    size = f" ~{f['attendees']} pax." if f["attendees"] else ""
    body = _ascii(
        f"CupQ demo request: {who}, {reach}.{size} "
        f"Full details: Runner > System > Enquiries."
    )[:300]

    sent = False
    phone = (cfg.get("phone") or "").strip()
    if phone:
        try:
            from services.sms import get_outbound_provider

            result = get_outbound_provider().send(phone, body)
            sent = sent or bool(result.ok)
            if not result.ok:
                logger.warning(
                    "demo request #%s: text failed: %s", row_id, result.error
                )
        except Exception as e:
            logger.warning("demo request #%s: text crashed: %s", row_id, e)

    email = (cfg.get("email") or "").strip()
    if email:
        try:
            from html import escape
            from services.email_utils import send_html_email

            rows = "".join(
                f"<tr><td style='padding:4px 12px 4px 0;color:#888'>{escape(k)}</td>"
                f"<td style='padding:4px 0'>{escape(v)}</td></tr>"
                for k, v in (
                    ("Name", f["name"]),
                    ("Organisation", f["organisation"]),
                    ("Email", f["email"]),
                    ("Phone", f["phone"]),
                    ("When", f["event_when"]),
                    ("Attendees", f["attendees"]),
                    ("Message", f["message"]),
                    ("Quote", f["quote"]),
                )
                if v
            )
            send_html_email(
                email, f"CupQ demo request: {who}", f"<table>{rows}</table>"
            )
            sent = True
        except Exception as e:
            logger.warning("demo request #%s: email crashed: %s", row_id, e)

    if not (phone or email):
        logger.warning(
            "demo request #%s saved, but no admin alert phone or email "
            "is set -- it is only in Runner > System > Enquiries",
            row_id,
        )
    return sent


@bp.route("/public/demo-request", methods=["POST", "OPTIONS"])
@cross_origin(
    origins=_ORIGINS,
    methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    supports_credentials=False,
)
@limiter.limit("5 per minute; 20 per hour", key_func=_client_ip)
def create_demo_request():
    data = request.get_json(silent=True) or request.form.to_dict() or {}

    if str(data.get("website") or "").strip():
        logger.info("demo request dropped: honeypot filled (%s)", _client_ip())
        return jsonify({"success": True, "status": "success"})

    f = {k: _clean(data, k) for k in _LIMITS}
    if not f["name"]:
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Please tell us your name.",
                }
            ),
            400,
        )
    if not (f["email"] or f["phone"]):
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Please leave an email or a phone number so we can reply.",
                }
            ),
            400,
        )
    if f["email"] and not _EMAIL_RE.match(f["email"]):
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "That email address doesn't look right.",
                }
            ),
            400,
        )
    if f["phone"] and len(re.sub(r"\D", "", f["phone"])) < 8:
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "That phone number looks too short.",
                }
            ),
            400,
        )

    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO demo_requests
                (name, organisation, email, phone, event_when, attendees,
                 message, quote, source, ip)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                f["name"],
                f["organisation"] or None,
                f["email"] or None,
                f["phone"] or None,
                f["event_when"] or None,
                f["attendees"] or None,
                f["message"] or None,
                f["quote"] or None,
                f["source"] or None,
                _client_ip()[:64],
            ),
        )
        row = cur.fetchone()
        row_id = row["id"] if isinstance(row, dict) else row[0]
        conn.commit()
    except Exception as e:
        logger.error(f"demo request save failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Sorry, that didn't go through. Please try again in a minute.",
                }
            ),
            500,
        )
    finally:
        if conn is not None:
            _release(conn)

    if _notify(row_id, f):
        conn = None
        try:
            conn = _db()
            conn.cursor().execute(
                "UPDATE demo_requests SET notified = TRUE WHERE id = %s", (row_id,)
            )
            conn.commit()
        except Exception:
            pass
        finally:
            if conn is not None:
                _release(conn)

    logger.info("demo request #%s received", row_id)
    return jsonify({"success": True, "status": "success"})


@bp.route("/demo-requests", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def list_demo_requests():
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, created_at, name, organisation, email, phone, event_when,
                   attendees, message, quote, notified, handled_at
            FROM demo_requests ORDER BY created_at DESC LIMIT 200
            """
        )
        cols = [d[0] for d in cur.description]
        out = []
        for r in cur.fetchall():
            item = dict(r) if isinstance(r, dict) else dict(zip(cols, r))
            for k in ("created_at", "handled_at"):
                if item.get(k):
                    item[k] = item[k].isoformat() + "Z"
            out.append(item)
        return jsonify(
            {"success": True, "status": "success", "data": {"requests": out}}
        )
    except Exception as e:
        logger.error(f"demo request list failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not load enquiries.",
                }
            ),
            500,
        )
    finally:
        _release(conn)


@bp.route("/demo-requests/<int:rid>/handled", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin", "staff"])
def mark_handled(rid):
    """Toggle 'dealt with'. Body: {"handled": true|false}."""
    handled = bool((request.get_json(silent=True) or {}).get("handled", True))
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE demo_requests SET handled_at = "
            + ("(NOW() AT TIME ZONE 'UTC')" if handled else "NULL")
            + " WHERE id = %s",
            (rid,),
        )
        conn.commit()
        return jsonify({"success": True, "status": "success"})
    except Exception as e:
        logger.error(f"demo request update failed: {e}")
        return (
            jsonify(
                {
                    "success": False,
                    "status": "error",
                    "message": "Could not update that enquiry.",
                }
            ),
            500,
        )
    finally:
        _release(conn)
