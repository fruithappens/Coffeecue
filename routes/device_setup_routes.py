"""One QR sets up a device (roadmap H5-3).

POST /api/devices/setup-codes   manager: make a code for a barista tablet
POST /api/devices/claim         the tablet: trade the code for a sign-in

The board and the kiosk need no login, so their QR is just their address
(made on the Runner page). A barista screen does need one, and typing a
username and password on a tablet in a venue is slow and leaks the
password to whoever is watching. So a manager picks the barista account
and station, and gets a QR holding a one-time code:

  - works ONCE, expires after CODE_MINUTES
  - only for barista accounts (never an admin or organiser login)
  - only the code's hash is stored
  - claiming is rate-limited per address
"""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, g, jsonify, request

from auth import generate_tokens, jwt_required_with_demo, role_required_with_demo
from security_middleware import limiter

logger = logging.getLogger("expresso.routes.device_setup")

bp = Blueprint("device_setup", __name__, url_prefix="/api/devices")

CODE_MINUTES = 10
MANAGERS = ["admin", "staff", "organizer", "organiser", "event_organizer"]
# Letters and digits a person won't misread if they ever type it.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _db():
    return current_app.config.get("coffee_system").db


def _hash(code):
    return hashlib.sha256(code.strip().upper().encode()).hexdigest()


def _row(r):
    return list(r.values()) if isinstance(r, dict) else list(r)


@bp.route("/setup-codes", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(MANAGERS)
def make_code():
    body = request.get_json(silent=True) or {}
    try:
        station_id = int(body.get("station_id"))
        user_id = int(body.get("user_id"))
    except (TypeError, ValueError):
        return (
            jsonify(
                {"success": False, "message": "Choose a station and a barista login."}
            ),
            400,
        )
    db = _db()
    db.rollback()
    cur = db.cursor()
    cur.execute(
        "SELECT username, role, COALESCE(is_active, TRUE) FROM users WHERE id = %s",
        (user_id,),
    )
    r = cur.fetchone()
    if not r:
        return jsonify({"success": False, "message": "That login doesn't exist."}), 404
    username, role, active = _row(r)
    if str(role or "").lower() != "barista" or not active:
        # A QR that signs a tablet in as an admin would be a skeleton key
        # left lying on the counter.
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Only barista logins can be set up by QR.",
                }
            ),
            400,
        )
    code = "".join(secrets.choice(_ALPHABET) for _ in range(10))
    expires = datetime.utcnow() + timedelta(minutes=CODE_MINUTES)
    who = (getattr(g, "user", None) or {}).get("username") or ""
    cur.execute(
        "INSERT INTO device_setup_codes (code_hash, screen, station_id, user_id, created_by, expires_at) "
        "VALUES (%s, 'barista', %s, %s, %s, %s)",
        (_hash(code), station_id, user_id, who, expires),
    )
    db.commit()
    logger.info(
        "device setup code made by %s for %s at station %s", who, username, station_id
    )
    url = f"{_origin(body)}/setup/{code}"
    return jsonify(
        {
            "success": True,
            "code": code,
            "url": url,
            "qr": _qr_data_uri(url),
            "username": username,
            "station_id": station_id,
            "expires_at": expires.isoformat() + "Z",
            "minutes": CODE_MINUTES,
        }
    )


def _origin(body):
    """Where the tablet should go: the address the manager is using."""
    o = str(body.get("origin") or "").rstrip("/")
    if (
        o.startswith("https://")
        or o.startswith("http://localhost")
        or o.startswith("http://127.0.0.1")
    ):
        return o[:200]
    return request.host_url.rstrip("/")


def _qr_data_uri(text):
    # Drawn here so the one-time code never sits in a URL (or an access log).
    import base64
    import io

    import qrcode

    img = qrcode.make(text, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@bp.route("/claim", methods=["POST"])
@limiter.limit("10 per minute; 40 per hour")
def claim():
    code = str((request.get_json(silent=True) or {}).get("code") or "")
    if len(code.strip()) < 8:
        return (
            jsonify({"success": False, "message": "That setup code isn't valid."}),
            400,
        )
    db = _db()
    db.rollback()
    cur = db.cursor()
    # Claim atomically: only one tablet can ever win a code.
    cur.execute(
        "UPDATE device_setup_codes SET used_at = NOW() AT TIME ZONE 'UTC', used_ip = %s "
        "WHERE code_hash = %s AND used_at IS NULL AND expires_at > NOW() AT TIME ZONE 'UTC' "
        "RETURNING station_id, user_id",
        (
            (request.headers.get("CF-Connecting-IP") or request.remote_addr or "")[:64],
            _hash(code),
        ),
    )
    r = cur.fetchone()
    if not r:
        db.rollback()
        return (
            jsonify(
                {
                    "success": False,
                    "message": "This setup code has been used or has expired. Make a new one in Runner > Screens.",
                }
            ),
            410,
        )
    station_id, user_id = _row(r)
    cur.execute(
        "SELECT id, username, email, role, full_name, COALESCE(is_active, TRUE) FROM users WHERE id = %s",
        (user_id,),
    )
    u = cur.fetchone()
    if not u:
        db.rollback()
        return (
            jsonify({"success": False, "message": "That login no longer exists."}),
            410,
        )
    uid, username, email, role, full_name, active = _row(u)
    if str(role or "").lower() != "barista" or not active:
        db.rollback()
        return (
            jsonify({"success": False, "message": "That login can't be set up by QR."}),
            403,
        )
    db.commit()
    user = {
        "id": uid,
        "username": username,
        "email": email,
        "role": role,
        "full_name": full_name,
    }
    tokens = generate_tokens(user)
    logger.warning("device set up by QR as %s for station %s", username, station_id)
    return jsonify(
        {
            "success": True,
            "token": tokens["access_token"],
            "refreshToken": tokens["refresh_token"],
            "expiresIn": tokens["expires_in"],
            "user": user,
            "station_id": station_id,
            "redirect": f"/barista?station={station_id}",
        }
    )
