"""Unlock PINs: one per person, plus the old shared event PIN.

The barista padlock and the display kiosk's hidden admin panel both ask for
a PIN (POST /api/kiosk/verify-pin). There used to be exactly one -- the
event PIN in settings.kiosk_pin, default 1234 -- so nobody could tell who
had unlocked a tablet. Now each staff member can have their own, and every
attempt is written to pin_unlocks with who, where and when.

How a PIN is stored. users.pin_hash = HMAC-SHA256(server secret, pin). A
4-8 digit PIN has at most 10^8 possibilities, so a deliberately slow password
hash would not protect it from anyone holding the database; what protects it
is the secret, which lives in the environment, not the database. A keyed hash
also makes the PIN directly searchable, which is what lets the padlock answer
"that was Sam" in one indexed lookup and lets two people never share a PIN.
Rotating the secret (PIN_PEPPER, else JWT_SECRET_KEY) invalidates every
personal PIN -- people set new ones; the event PIN is unaffected.

The event PIN keeps working unless an organiser switches it off
(settings.event_pin_disabled = 'true'), so nothing changes at the next event
for a team that has not set personal PINs yet.
"""
import hashlib
import hmac
import logging
import os
import re

logger = logging.getLogger("expresso.pins")

DEFAULT_EVENT_PIN = "1234"
EVENT_PIN_LABEL = "Event PIN"
_PIN_RE = re.compile(r"^\d{4,8}$")


def _secret():
    s = os.environ.get("PIN_PEPPER") or os.environ.get("JWT_SECRET_KEY")
    if not s:
        try:
            from flask import current_app

            s = current_app.config.get("JWT_SECRET_KEY") or current_app.config.get(
                "SECRET_KEY"
            )
        except Exception:
            s = None
    return (s or "cupq-pin").encode()


def pin_hash(pin):
    return hmac.new(_secret(), str(pin).encode(), hashlib.sha256).hexdigest()


def pin_problem(pin):
    """Why `pin` can't be used, in plain words, or None if it's fine."""
    pin = str(pin or "").strip()
    if not _PIN_RE.match(pin):
        return "A PIN is 4 to 8 digits."
    if len(set(pin)) == 1:
        return "Pick something less guessable than the same digit repeated."
    if pin in "0123456789" or pin in "9876543210":
        return "Pick something less guessable than a run of digits."
    return None


def _setting(cur, key):
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return None
    return row["value"] if isinstance(row, dict) else row[0]


def event_pin_state(cur):
    stored = str(_setting(cur, "kiosk_pin") or "").strip()
    disabled = str(_setting(cur, "event_pin_disabled") or "").strip().lower() == "true"
    return {
        "pin": stored or DEFAULT_EVENT_PIN,
        "is_default": not stored,
        "enabled": not disabled,
    }


def _name(row):
    if isinstance(row, dict):
        return (row.get("full_name") or "").strip() or row.get("username")
    return (row[2] or "").strip() or row[1]


def verify(db, attempt, surface=None, ip=None):
    """Check a PIN. Returns {ok, who, user_id, default_pin}; never raises.

    A personal PIN is tried first, so if someone's own PIN happens to equal
    the event PIN the unlock is still credited to them.
    """
    attempt = str(attempt or "").strip()
    result = {"ok": False, "who": None, "user_id": None, "default_pin": False}
    cur = None
    try:
        cur = db.cursor()
        if attempt:
            cur.execute(
                "SELECT id, username, full_name FROM users "
                "WHERE pin_hash = %s AND COALESCE(is_active, TRUE) "
                "AND NOT COALESCE(account_locked, FALSE) LIMIT 1",
                (pin_hash(attempt),),
            )
            row = cur.fetchone()
            if row:
                result.update(
                    ok=True,
                    who=_name(row),
                    user_id=row["id"] if isinstance(row, dict) else row[0],
                )
            else:
                ev = event_pin_state(cur)
                if ev["enabled"] and hmac.compare_digest(attempt, ev["pin"]):
                    result.update(
                        ok=True, who=EVENT_PIN_LABEL, default_pin=ev["is_default"]
                    )
        _log(db, cur, result, surface, ip)
    except Exception as e:
        logger.error("PIN check failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        if cur is not None:
            try:
                cur.close()
            except Exception:
                pass
    return result


def _log(db, cur, result, surface, ip):
    try:
        cur.execute(
            "INSERT INTO pin_unlocks (ok, user_id, who, surface, ip) "
            "VALUES (%s, %s, %s, %s, %s)",
            (
                result["ok"],
                result["user_id"],
                result["who"],
                (surface or "unknown")[:40],
                (ip or "")[:64],
            ),
        )
        db.commit()
    except Exception as e:
        # The log must never be why a barista can't get in.
        logger.warning("pin_unlocks write skipped: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
