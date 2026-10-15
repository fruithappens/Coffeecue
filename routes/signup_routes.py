"""Self-serve sign-up (roadmap X7-9, part 1).

POST /api/public/signup              the cupq.app/start form (anyone)
GET  /api/signups                    manager roles: the list, newest first
GET  /api/signups/<id>/event-file    their answers as a saved event (.cupq-event.json)
POST /api/signups/<id>/decision      {decision: approved|declined|new}

A client describes their event (name, dates, drinks, milks, sizes,
colours, logo). The request is saved and texted to the admin alert number
(and whoever is on call). Approving it gives Steve their saved event and
the one command that builds their copy:

    python scripts/new_client.py <slug> --apply --event-file <their file>

The server never builds copies itself: it holds no Railway or Cloudflare
token, so a form on the internet can't create servers or spend money.

Like the demo form, this is open to the internet, so: rate limited, a
hidden honeypot field, every field capped, the logo limited to a small PNG
or JPEG checked by its bytes (no SVG: it can carry script).
"""
import base64
import json
import logging
import os
import re
from datetime import date

from flask import Blueprint, Response, jsonify, request
from flask_cors import cross_origin

from auth import jwt_required_with_demo, role_required_with_demo
from security_middleware import _client_ip, limiter

logger = logging.getLogger("expresso.routes.signup")

bp = Blueprint("signup_api", __name__, url_prefix="/api")
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer", "support"]

_ORIGINS = ["https://cupq.com.au", "https://www.cupq.com.au"] + [
    o.strip() for o in os.getenv("DEMO_FORM_ORIGINS", "").split(",") if o.strip()
]
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,28}[a-z0-9]$")
# Ours, never a client's: scripts/new_client.py's list, plus the demo copy
# and the name kept for a release trial copy.
RESERVED = {"www", "api", "app", "admin", "staging", "next", "mail", "status", "cupq", "demo", "preview"}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")
COLOUR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MILKS = ("full cream", "skim", "oat", "almond", "lactose free", "soy", "coconut", "macadamia")
SIZES = ("small", "medium", "large")
DRINKS = ("espresso_drinks", "hot_chocolate", "chai", "matcha")
PLANS = ("lite", "standard", "pro", "urn", "unsure")
ZONES = ("Australia/Adelaide", "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane",
         "Australia/Perth", "Australia/Hobart", "Australia/Darwin", "Pacific/Auckland")
LIMITS = {"organisation": 160, "name": 120, "email": 200, "phone": 40, "event_name": 80,
          "attendees": 12, "notes": 1500, "slug": 30}
LOGO_MAX_BYTES = 300 * 1024
STATUSES = ("new", "approved", "declined")


def _db():
    from utils.database import get_db_connection

    return get_db_connection()


def _release(conn):
    try:
        from utils.database import close_connection

        close_connection(conn)
    except Exception:
        pass


def slug_from(text):
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")[:30].strip("-")
    return s if SLUG_RE.match(s or "") and s not in RESERVED else ""


def clean_logo(data_url):
    """(data_url, problem). A PNG or JPEG data URL under 300 KB, checked by
    its first bytes, not by what it claims to be."""
    if not data_url:
        return "", None
    m = re.match(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$", str(data_url))
    if not m:
        return "", "The logo must be a PNG or JPEG image."
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except (ValueError, TypeError):
        return "", "The logo file couldn't be read."
    if len(raw) > LOGO_MAX_BYTES:
        return "", "The logo is too big: keep it under 300 KB."
    if not (raw.startswith(b"\x89PNG\r\n\x1a\n") or raw.startswith(b"\xff\xd8\xff")):
        return "", "The logo must be a PNG or JPEG image."
    kind = "png" if raw.startswith(b"\x89PNG") else "jpeg"
    return f"data:image/{kind};base64,{base64.b64encode(raw).decode()}", None


def clean(data):
    """(fields, problem): the form, tidied, or the first thing wrong with it."""
    f = {k: str(data.get(k) or "").strip()[:n] for k, n in LIMITS.items()}
    f["slug"] = f["slug"].lower()
    if not f["organisation"]:
        return None, "Please tell us your organisation."
    if not f["name"]:
        return None, "Please tell us your name."
    if not EMAIL_RE.match(f["email"]):
        return None, "Please give an email address we can reply to."
    if f["phone"] and len(re.sub(r"\D", "", f["phone"])) < 8:
        return None, "That phone number looks too short."
    if not f["event_name"]:
        return None, "What's the event called?"
    f["slug"] = f["slug"] or slug_from(f["organisation"])
    if not SLUG_RE.match(f["slug"]) or f["slug"] in RESERVED:
        return None, ("Choose a web address: 3-30 lowercase letters, numbers or dashes, "
                      "starting with a letter (it becomes <name>.cupq.app).")
    for key in ("starts", "ends"):
        try:
            f[key] = date.fromisoformat(str(data.get(key) or "")).isoformat()
        except ValueError:
            return None, "Please give the event's first and last day."
    if f["ends"] < f["starts"]:
        return None, "The last day is before the first day."
    f["timezone"] = data.get("timezone") if data.get("timezone") in ZONES else ZONES[0]
    f["texts"] = bool(data.get("texts"))
    f["plan"] = data.get("plan") if data.get("plan") in PLANS else "unsure"
    drinks = data.get("drinks") if isinstance(data.get("drinks"), dict) else {}
    f["drinks"] = {k: bool(drinks.get(k)) for k in DRINKS}
    f["teas"] = bool(data.get("teas"))
    f["milks"] = [m for m in MILKS if m in (data.get("milks") or [])] or ["full cream"]
    f["sizes"] = [s for s in SIZES if s in (data.get("sizes") or [])] or ["medium"]
    for key, default in (("primary_colour", "#3B2A20"), ("header_colour", "#3B2A20")):
        v = str(data.get(key) or "")
        f[key] = v if COLOUR_RE.match(v) else default
    f["logo"], why = clean_logo(data.get("logo"))
    if why:
        return None, why
    if not data.get("agree"):
        return None, "Please tick the box so we can contact you about pricing and terms."
    return f, None


def to_event(f):
    """Their answers as a saved event, the same shape Quick Setup saves and
    the build script loads (scripts/fleet_apply.py, step 10)."""
    teas = {k: False for k in ("english_breakfast", "earl_grey", "green", "peppermint",
                               "chamomile", "lemon_ginger", "rooibos", "generic")}
    if f.get("teas"):
        for k in ("english_breakfast", "earl_grey", "green", "peppermint"):
            teas[k] = True
    name = f["event_name"]
    payload = {
        "event_name": name,
        "milks": f["milks"],
        "sizes": f["sizes"],
        "sweeteners": ["no sugar", "1 sugar", "2 sugar"],
        "drinks": f["drinks"],
        "teas": teas,
        "custom_teas": "",
        "unlimited_stock": True,
        "all_stations_same_capabilities": True,
        "always_open_schedule": True,
        "activate_all_stations": True,
        "vip_code": "",
        "started_sms_policy": "queue_only",
        "branding": {
            "eventName": name, "event_name": name, "clientName": f["organisation"],
            "logo": f.get("logo") or "", "clientLogo": f.get("logo") or "",
            "primaryColor": f["primary_colour"], "headerColor": f["header_colour"],
            "customerHeaderColor": f["header_colour"], "customerHeaderMode": "solid",
        },
    }
    return {
        "cupq_event_template": 1,
        "name": name,
        "description": f"Self-serve sign-up from {f['organisation']} ({f['starts']} to {f['ends']})",
        "payload": payload,
    }


def suggest_tier(attendees):
    """The plan a headcount fits (the website quote tool's rule)."""
    pax = int("".join(ch for ch in str(attendees or "") if ch.isdigit())[:7] or 0)
    if pax <= 0:
        return "standard"
    for tier, cap in (("lite", 150), ("standard", 400), ("pro", 1000)):
        if pax <= cap:
            return tier
    return "urn"


def quote_for(r):
    """A starting quote for a sign-up (roadmap C3-16): their plan, or the one
    their headcount fits, for each day from start to end, at the ledger's
    prices (utils/pricing). Software only: hardware and crew are extras."""
    from utils import pricing

    tier = r.get("plan") if r.get("plan") in pricing.TIERS else suggest_tier(r.get("attendees"))
    try:
        days = (date.fromisoformat(r["ends"]) - date.fromisoformat(r["starts"])).days + 1
    except (KeyError, TypeError, ValueError):
        days = 1
    days = max(1, min(days, 14))
    q = pricing.build(tier, days)
    return {
        "tier": tier,
        "tier_name": pricing.TIERS[tier]["name"],
        "suggested": r.get("plan") not in pricing.TIERS,
        "days": days,
        "lines": q["lines"],
        "subtotal": q["subtotal"],
        "gst": q["gst"],
        "total": q["total"],
        "quoted_separately": pricing.TIERS[tier]["first_day"] is None,
    }


def _notify(rid, f):
    try:
        from services.admin_alerts import send_admin_alert

        body = (f"CupQ sign-up #{rid}: {f['organisation']} - {f['event_name']}, "
                f"{f['starts']}, ~{f['attendees'] or '?'} people, {f['email']}. "
                "Runner > System > Enquiries.")
        body = body.encode("ascii", "replace").decode().replace("?", "-") if not body.isascii() else body
        return bool(send_admin_alert(f"SIGNUP_{rid}", "critical", body[:300]))
    except Exception as e:  # noqa: BLE001
        logger.warning("sign-up #%s: alert not sent: %s", rid, e)
        return False


@bp.route("/public/signup", methods=["POST", "OPTIONS"])
@cross_origin(origins=_ORIGINS, methods=["POST", "OPTIONS"], allow_headers=["Content-Type"],
              supports_credentials=False)
@limiter.limit("3 per minute; 10 per hour", key_func=_client_ip)
def create_signup():
    data = request.get_json(silent=True) or {}
    if str(data.get("website") or "").strip():  # honeypot: same reply, nothing saved
        logger.info("sign-up dropped: honeypot filled")
        return jsonify({"success": True})
    f, why = clean(data)
    if why:
        return jsonify({"success": False, "message": why}), 400
    answers = {k: f[k] for k in ("drinks", "teas", "milks", "sizes", "primary_colour", "header_colour")}
    conn = None
    try:
        conn = _db()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO signup_requests (organisation, name, email, phone, event_name, slug,
                   starts, ends, attendees, timezone, texts, plan, answers, logo, notes, ip)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (f["organisation"], f["name"], f["email"], f["phone"] or None, f["event_name"], f["slug"],
             f["starts"], f["ends"], f["attendees"] or None, f["timezone"], f["texts"], f["plan"],
             json.dumps(answers), f["logo"] or None, f["notes"] or None, _client_ip()[:64]))
        row = cur.fetchone()
        rid = row["id"] if isinstance(row, dict) else row[0]
        conn.commit()
    except Exception as e:
        logger.error(f"sign-up save failed: {e}")
        return jsonify({"success": False, "message": "Sorry, that didn't go through. Please try again in a minute."}), 500
    finally:
        if conn is not None:
            _release(conn)
    if _notify(rid, f):
        conn = None
        try:
            conn = _db()
            conn.cursor().execute("UPDATE signup_requests SET notified = TRUE WHERE id = %s", (rid,))
            conn.commit()
        except Exception:
            pass
        finally:
            if conn is not None:
                _release(conn)
    logger.info("sign-up #%s received", rid)
    return jsonify({"success": True, "address": f"https://{f['slug']}.cupq.app"})


COLUMNS = ("id", "created_at", "status", "organisation", "name", "email", "phone", "event_name", "slug",
           "starts", "ends", "attendees", "timezone", "texts", "plan", "answers", "logo", "notes",
           "notified", "decided_at", "decided_by")


def _row(r):
    v = dict(zip(COLUMNS, list(r.values()) if isinstance(r, dict) else list(r)))
    for k in ("created_at", "decided_at"):
        v[k] = (v[k].isoformat() + "Z") if v.get(k) else None
    for k in ("starts", "ends"):
        v[k] = v[k].isoformat() if v.get(k) else None
    a = v.get("answers")
    v["answers"] = json.loads(a) if isinstance(a, str) else (a or {})
    return v


def _get(rid):
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT {', '.join(COLUMNS)} FROM signup_requests WHERE id = %s", (rid,))
        r = cur.fetchone()
        return _row(r) if r else None
    finally:
        _release(conn)


@bp.route("/signups", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def list_signups():
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT {', '.join(COLUMNS)} FROM signup_requests ORDER BY id DESC LIMIT 100")
        rows = [_row(r) for r in cur.fetchall()]
    finally:
        _release(conn)
    for r in rows:
        try:
            r["quote"] = quote_for(r)
        except Exception as e:  # a quote is a convenience; never break the list
            logger.warning("sign-up #%s: quote failed: %s", r.get("id"), e)
            r["quote"] = None
        # Only the slug goes in: it's checked against SLUG_RE, so nothing a
        # stranger typed can reach the shell this gets pasted into. The event
        # name travels inside the event file.
        slug = r["slug"] if SLUG_RE.match(r.get("slug") or "") else "invalid-slug"
        r["build_command"] = (f"cd ~/expresso && python3 scripts/new_client.py {slug} --apply --region sg "
                              f"--event-file ~/Downloads/{slug}.cupq-event.json")
    return jsonify({"success": True, "signups": rows})


@bp.route("/signups/<int:rid>/event-file", methods=["GET"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def event_file(rid):
    r = _get(rid)
    if not r:
        return jsonify({"success": False, "message": "no such sign-up"}), 404
    f = {**r, **r["answers"]}
    return Response(json.dumps(to_event(f), indent=2), mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{r["slug"]}.cupq-event.json"'})


@bp.route("/signups/<int:rid>/decision", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def decide(rid):
    decision = str((request.get_json(silent=True) or {}).get("decision") or "").lower()
    if decision not in STATUSES:
        return jsonify({"success": False, "message": "decision must be approved, declined or new"}), 400
    from routes.support_request_routes import _who

    who, _role = _who()
    conn = _db()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE signup_requests SET status = %s, decided_at = CASE WHEN %s = 'new' THEN NULL "
                    "ELSE NOW() AT TIME ZONE 'UTC' END, decided_by = %s WHERE id = %s RETURNING id",
                    (decision, decision, (who or "someone") if decision != "new" else None, rid))
        found = cur.fetchone()
        conn.commit()
    finally:
        _release(conn)
    if not found:
        return jsonify({"success": False, "message": "no such sign-up"}), 404
    return jsonify({"success": True})
