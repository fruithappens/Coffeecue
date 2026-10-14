"""Two-step login with an authenticator app (roadmap X7-3).

GET  /api/auth/two-step               your own status
POST /api/auth/two-step/setup         start: a new secret + QR (not on yet)
POST /api/auth/two-step/enable        {code}: turn it on with a correct code
POST /api/auth/two-step/disable       {code}: turn it off (needs a code)
POST /api/auth/two-step/reset/<id>    admin: switch it off for someone who
                                      lost their phone

Once it's on, /api/auth/login needs the 6-digit code as well as the
password (login_check below). Baristas never see any of this unless they
turn it on themselves.
"""
import base64
import io
import logging

from flask import Blueprint, current_app, g, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from services import totp

logger = logging.getLogger("expresso.routes.two_step")

bp = Blueprint("two_step", __name__, url_prefix="/api/auth/two-step")

# Roles that reach the Runner: Readiness asks these to turn it on.
RUNNER_ROLES = (
    "admin",
    "staff",
    "organizer",
    "organiser",
    "event_organizer",
    "support",
)


def _db():
    return current_app.config.get("coffee_system").db


def _me():
    u = getattr(g, "user", None) or {}
    try:
        return int(u.get("id"))
    except (TypeError, ValueError):
        return None


def _row(cur, user_id):
    cur.execute(
        "SELECT username, totp_secret, totp_enabled FROM users WHERE id = %s",
        (user_id,),
    )
    r = cur.fetchone()
    if not r:
        return None
    v = list(r.values()) if isinstance(r, dict) else list(r)
    return {"username": v[0], "secret": v[1], "enabled": bool(v[2])}


def login_check(user_id, code):
    """None if this login may proceed; otherwise the message to show.

    Called by /api/auth/login after the password is right. Uses its own
    short connection so it never depends on request state."""
    try:
        from utils.database import close_connection, get_db_connection

        conn = get_db_connection()
        try:
            cur = conn.cursor()
            row = _row(cur, user_id)
        finally:
            close_connection(conn)
    except Exception as e:
        # The columns may not exist yet on a copy mid-upgrade: then nobody
        # has two-step on, and the password alone is the old behaviour.
        logger.warning("two-step check skipped: %s", e)
        return None
    if not row or not row["enabled"]:
        return None
    if not code:
        return "Enter the 6-digit code from your authenticator app."
    if not totp.verify(row["secret"], code):
        return "That code didn't match. Use the newest code in your authenticator app."
    return None


def _qr_data_uri(text):
    # Drawn here, not via /api/qr?data=..., so the secret never sits in a
    # URL (and so in an access log).
    import qrcode

    img = qrcode.make(text, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


@bp.route("", methods=["GET"])
@jwt_required_with_demo()
def status():
    uid = _me()
    if uid is None:
        return jsonify({"success": False, "message": "Not signed in"}), 401
    db = _db()
    db.rollback()
    row = _row(db.cursor(), uid)
    db.rollback()
    return jsonify({"success": True, "enabled": bool(row and row["enabled"])})


@bp.route("/setup", methods=["POST"])
@jwt_required_with_demo()
def setup():
    uid = _me()
    if uid is None:
        return jsonify({"success": False, "message": "Not signed in"}), 401
    db = _db()
    db.rollback()
    cur = db.cursor()
    row = _row(cur, uid)
    if not row:
        return jsonify({"success": False, "message": "User not found"}), 404
    if row["enabled"]:
        return (
            jsonify(
                {
                    "success": False,
                    "message": "Two-step login is already on. Turn it off first to move it to a new phone.",
                }
            ),
            409,
        )
    secret = totp.new_secret()
    cur.execute(
        "UPDATE users SET totp_secret = %s, totp_enabled = FALSE WHERE id = %s",
        (secret, uid),
    )
    db.commit()
    uri = totp.otpauth_uri(secret, row["username"])
    return jsonify({"success": True, "qr": _qr_data_uri(uri), "secret": secret})


@bp.route("/enable", methods=["POST"])
@jwt_required_with_demo()
def enable():
    uid = _me()
    code = (request.get_json(silent=True) or {}).get("code")
    db = _db()
    db.rollback()
    cur = db.cursor()
    row = _row(cur, uid) if uid is not None else None
    if not row or not row["secret"]:
        return jsonify({"success": False, "message": "Start the setup first."}), 400
    if not totp.verify(row["secret"], code):
        return (
            jsonify(
                {
                    "success": False,
                    "message": "That code didn't match. Check the phone's time is set automatically, and try the newest code.",
                }
            ),
            400,
        )
    cur.execute("UPDATE users SET totp_enabled = TRUE WHERE id = %s", (uid,))
    db.commit()
    logger.info("two-step login turned on for user %s", uid)
    return jsonify({"success": True, "enabled": True})


@bp.route("/disable", methods=["POST"])
@jwt_required_with_demo()
def disable():
    uid = _me()
    code = (request.get_json(silent=True) or {}).get("code")
    db = _db()
    db.rollback()
    cur = db.cursor()
    row = _row(cur, uid) if uid is not None else None
    if not row or not row["enabled"]:
        return jsonify({"success": True, "enabled": False})
    if not totp.verify(row["secret"], code):
        return (
            jsonify(
                {"success": False, "message": "Enter a current code to turn it off."}
            ),
            400,
        )
    cur.execute(
        "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = %s",
        (uid,),
    )
    db.commit()
    logger.info("two-step login turned off by user %s", uid)
    return jsonify({"success": True, "enabled": False})


@bp.route("/reset/<int:user_id>", methods=["POST"])
@jwt_required_with_demo()
@role_required_with_demo(["admin"])
def reset(user_id):
    if user_id == _me():
        return (
            jsonify(
                {"success": False, "message": "Use 'Turn off' for your own login."}
            ),
            400,
        )
    db = _db()
    db.rollback()
    cur = db.cursor()
    cur.execute(
        "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = %s",
        (user_id,),
    )
    db.commit()
    logger.warning("two-step login reset for user %s by admin %s", user_id, _me())
    return jsonify({"success": True})
