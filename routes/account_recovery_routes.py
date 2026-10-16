"""Forgot password: people reset their own, by email (roadmap S1, 16 Oct 2026).

POST /api/auth/forgot-password   {login}            username or email; always the same answer
POST /api/auth/reset-password    {token, password}  the link from the email

Steve was the only way back in for anyone who forgot a password. Now the
sign-in page has "Forgot your password?": if the login has a real email
address, it gets a link that works once, for 30 minutes. Only the link's
hash is stored. The answer never says whether a login exists, and the email
goes out in the background so the timing doesn't say either.

The link always points at this server's own address, and only if that
address is one of ours (cupq.app, a *.cupq.app copy, or localhost), so a
forged Host header can't send people a link to somewhere else. Shared
barista logins made by Quick Setup (...@local) have no real email: their
organiser resets them in People, as before.
"""
import hashlib
import logging
import os
import re
import secrets
import threading
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

from security_middleware import _client_ip, limiter

logger = logging.getLogger("expresso.routes.password_reset")

bp = Blueprint("password_reset", __name__, url_prefix="/api/auth")

LINK_MINUTES = 30
MIN_PASSWORD = 8
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")
_OUR_HOST = re.compile(r"^(cupq\.app|[a-z0-9-]+\.cupq\.app|localhost|127\.0\.0\.1)(:\d+)?$")
ANSWER = ("If that login has an email address, a reset link is on its way. "
          "It works for 30 minutes. No email? Ask your event organiser to reset it.")


def real_email(email):
    """An address a reset link can actually reach (not a Quick Setup @local)."""
    e = (email or "").strip()
    return bool(EMAIL_RE.match(e)) and not e.lower().endswith(("@local", "@localhost", "@example.com"))


def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _base_url():
    host = (request.host or "").lower()
    if _OUR_HOST.match(host):
        scheme = "http" if host.startswith(("localhost", "127.0.0.1")) else "https"
        return f"{scheme}://{host}"
    configured = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    return configured or None


def _send(to, name, link, site):
    from services.email_utils import send_html_email

    html = f"""<p>Hi {name or 'there'},</p>
<p>Someone (hopefully you) asked to reset your CupQ password for <b>{site}</b>.</p>
<p><a href="{link}" style="display:inline-block;padding:10px 18px;background:#B8764A;color:#fff;
border-radius:8px;text-decoration:none;font-weight:bold">Choose a new password</a></p>
<p>The link works once, for {LINK_MINUTES} minutes. If you didn't ask, ignore this email: your
password stays the same.</p>
<p style="color:#777">CupQ - coffee ordering for events</p>"""
    text = (f"Reset your CupQ password for {site}: {link}\n"
            f"The link works once, for {LINK_MINUTES} minutes. If you didn't ask, ignore this email.")
    try:
        r = send_html_email(to, "Reset your CupQ password", html, text_fallback=text)
        logger.info("password reset email for user at %s: ok=%s sent=%s", to.split("@")[-1], r.ok, r.sent)
    except Exception as e:  # never let a mail problem surface to the caller
        logger.warning("password reset email failed: %s", e)


@bp.route("/forgot-password", methods=["POST"])
@limiter.limit("5 per hour", key_func=_client_ip)
def forgot_password():
    body = request.get_json(silent=True) or {}
    login = str(body.get("login") or "").strip()[:200]
    if not login:
        return jsonify({"success": False, "message": "Type your username or email."}), 400
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, username, email, full_name FROM users "
            "WHERE (LOWER(username) = LOWER(%s) OR LOWER(email) = LOWER(%s)) "
            "AND COALESCE(is_active, true) ORDER BY id LIMIT 1", (login, login))
        row = cur.fetchone()
        if row:
            v = list(row.values()) if isinstance(row, dict) else list(row)
            user_id, username, email, full_name = v[0], v[1], v[2], v[3]
            base = _base_url()
            if real_email(email) and base:
                token = secrets.token_urlsafe(32)
                cur.execute("UPDATE password_reset_tokens SET used_at = NOW() AT TIME ZONE 'UTC' "
                            "WHERE user_id = %s AND used_at IS NULL", (user_id,))
                cur.execute(
                    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip) "
                    "VALUES (%s, %s, %s, %s)",
                    (user_id, _hash(token), datetime.utcnow() + timedelta(minutes=LINK_MINUTES),
                     _client_ip()[:64]))
                conn.commit()
                site = base.split("://", 1)[1]
                threading.Thread(target=_send, args=(email.strip(), (full_name or username).split(" ")[0],
                                                     f"{base}/reset-password?token={token}", site),
                                 daemon=True).start()
            else:
                logger.info("password reset asked for user %s: no real email or unknown host", user_id)
    except Exception as e:
        conn.rollback()
        logger.warning("forgot-password failed: %s", e)
    finally:
        close_connection(conn)
    return jsonify({"success": True, "message": ANSWER})


@bp.route("/reset-password", methods=["POST"])
@limiter.limit("10 per hour", key_func=_client_ip)
def reset_password():
    body = request.get_json(silent=True) or {}
    token = str(body.get("token") or "").strip()
    password = str(body.get("password") or "")
    if len(password) < MIN_PASSWORD:
        return jsonify({"success": False, "message": f"Use at least {MIN_PASSWORD} characters."}), 400
    if not token or len(token) > 200:
        return jsonify({"success": False, "message": "This link isn't valid. Ask for a new one."}), 400
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = %s AND used_at IS NULL "
            "AND expires_at > NOW() AT TIME ZONE 'UTC' FOR UPDATE", (_hash(token),))
        row = cur.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"success": False,
                            "message": "This link has expired or was already used. Ask for a new one."}), 400
        v = list(row.values()) if isinstance(row, dict) else list(row)
        token_id, user_id = v[0], v[1]
        cur.execute("UPDATE users SET password_hash = %s WHERE id = %s",
                    (generate_password_hash(password), user_id))
        cur.execute("UPDATE password_reset_tokens SET used_at = NOW() AT TIME ZONE 'UTC' "
                    "WHERE user_id = %s AND used_at IS NULL", (user_id,))
        conn.commit()
        logger.info("password reset by email link for user %s (token %s)", user_id, token_id)
        return jsonify({"success": True, "message": "Password changed. Sign in with the new one."})
    except Exception as e:
        conn.rollback()
        logger.warning("reset-password failed: %s", e)
        return jsonify({"success": False, "message": "Something went wrong. Try again."}), 500
    finally:
        close_connection(conn)
