"""Whether a staff login token still stands (audit finding SEC-004).

A JWT is valid until it expires, whatever happens to the account. So a
demoted barista kept organiser access, a deleted login kept working, a
password reset left the old sessions open, and "log out" did nothing on the
server. Two checks close that:

1. The account stamp. Every token for a real staff login (numeric `sub`)
   carries `st`, an HMAC of the account's password hash, role, active flag
   and token_version. A password reset, role change or deactivation changes
   the stamp wherever it was made, so older tokens stop matching; a deleted
   account has nothing to match. The role used for permissions is the
   account's role now, not the one in the token. Tokens from before this
   change carry no stamp and age out (8 h access, refresh as configured).

2. Revoked tokens. Logout records the token's jti until it would have
   expired anyway. Service and demo tokens (non-numeric `sub`, e.g.
   'try-demo-barista', 'backup-barista') get this check only.

One process (CLAUDE.md), so the revoked set and a short per-account cache
live in memory, backed by the database across restarts.
"""

import hashlib
import hmac
import logging
import threading
import time
from datetime import datetime, timezone

from flask import current_app

logger = logging.getLogger("expresso.sessions")

_CACHE_SECONDS = 15
_account_cache = {}  # user_id -> (fetched_monotonic, row dict or None)
_revoked = None  # set of jti, loaded on first use
_lock = threading.Lock()


def _db_rows(sql, params):
    from utils.database import close_connection, get_db_connection

    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.commit()
        return rows
    finally:
        close_connection(conn)


def _account(user_id):
    now = time.monotonic()
    hit = _account_cache.get(user_id)
    if hit and now - hit[0] < _CACHE_SECONDS:
        return hit[1]
    rows = _db_rows(
        "SELECT role, COALESCE(is_active, TRUE), COALESCE(token_version, 0), "
        "COALESCE(password_hash, '') FROM users WHERE id = %s",
        (int(user_id),),
    )
    row = None
    if rows:
        r = rows[0]
        vals = list(r.values()) if isinstance(r, dict) else list(r)
        row = {"role": vals[0], "active": bool(vals[1]), "tv": int(vals[2]), "pw": vals[3]}
    _account_cache[user_id] = (now, row)
    return row


def forget_account(user_id):
    """Drop the cached account so a change takes effect at once."""
    _account_cache.pop(str(user_id), None)


def _stamp(row):
    secret = (current_app.config.get("JWT_SECRET_KEY") or "").encode()
    msg = f"{row['pw']}|{row['role']}|{row['active']}|{row['tv']}".encode()
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()[:24]


def stamp_claims(user_id):
    """Extra claims for a new token for this staff login ({} if none)."""
    if not str(user_id).isdigit():
        return {}
    try:
        forget_account(str(user_id))
        row = _account(str(user_id))
        return {"st": _stamp(row)} if row else {}
    except Exception as e:
        logger.warning("session stamp unavailable for %s: %s", user_id, e)
        return {}


def _revoked_set():
    global _revoked
    if _revoked is None:
        with _lock:
            if _revoked is None:
                rows = _db_rows(
                    "SELECT jti FROM revoked_tokens WHERE expires_at > (NOW() AT TIME ZONE 'UTC')",
                    (),
                )
                _revoked = {(r["jti"] if isinstance(r, dict) else r[0]) for r in rows}
    return _revoked


def revoke(decoded):
    """End this token now (logout). Kept until it would have expired."""
    jti = decoded.get("jti")
    if not jti:
        return False
    exp = datetime.fromtimestamp(int(decoded.get("exp") or time.time() + 86400), timezone.utc)
    _db_rows(
        "INSERT INTO revoked_tokens (jti, user_id, expires_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (jti) DO NOTHING RETURNING jti",
        (jti, str(decoded.get("sub") or ""), exp.replace(tzinfo=None)),
    )
    _revoked_set().add(jti)
    return True


def check(decoded):
    """(ok, role) for a decoded token. role is the account's current role
    for a staff login, else the token's own claim."""
    try:
        if decoded.get("jti") in _revoked_set():
            return False, None
        sub = str(decoded.get("sub") or "")
        if not sub.isdigit():
            return True, decoded.get("role")
        row = _account(sub)
        if row is None or not row["active"]:
            return False, None
        st = decoded.get("st")
        if st is not None and not hmac.compare_digest(str(st), _stamp(row)):
            return False, None
        return True, row["role"]
    except Exception as e:
        # The database is unreachable: so is the rest of the app. Don't add a
        # mass logout on top; let the request fail (or not) on its own.
        logger.warning("session check skipped (%s)", e)
        return True, decoded.get("role")
