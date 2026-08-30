"""Stopping a QR code from one event ordering coffee at the next.

The failure this prevents is specific and entirely plausible: someone
photographs a poster at CTN26, opens it three weeks later at home out of
curiosity, and a coffee appears on a barista's screen at a completely
different event. Steve raised it himself -- "so the QR code won't work
incase a client loads up a page a few weeks from now and anciently or
deliberately orders a coffee and it goes to another even and barista".

It also does the useful half of "remember returning delegates". If every
QR is stamped with the event it belongs to, a saved usual can follow a
person between events without any list of people ever being loaded into
the new one -- and a list that does not exist cannot be accidentally
texted.

How it works: an event has a short code. Order links carry it as ?e=.
When the event is set to REQUIRE the code, an order arriving without a
matching one is refused with a plain sentence rather than an error.

The switch is opt-in for a reason. Turning it on immediately invalidates
every code printed before it, which is right before an event and wrong
in the middle of one. Codes are also checked case-insensitively and with
surrounding whitespace ignored, because these get typed by hand and
retyped into poster software.
"""

import re

# KV settings key.
ACCESS_SETTING_KEY = "event_access"

# What a customer sees when their code is from another event. Says what
# to do next -- a dead end with no instruction just sends them to the
# counter annoyed.
WRONG_EVENT_MESSAGE = (
    "That code is from a different event. Please scan the QR code here, "
    "or order at the counter."
)

_CODE_RE = re.compile(r"[^a-z0-9-]+")


def normalize_code(value):
    """Codes survive being typed by hand, pasted, and re-typed."""
    try:
        v = str(value or "").strip().lower()
    except Exception:
        return ""
    v = _CODE_RE.sub("-", v).strip("-")
    while "--" in v:
        v = v.replace("--", "-")
    return v[:32]


def read_settings(kv_value):
    """The event's access config, with safe defaults.

    Defaults to NOT requiring a code. An event that has never configured
    this must keep taking orders -- a system that silently stops
    accepting them because a setting is missing is a far worse outage
    than the problem it was guarding against.
    """
    raw = kv_value if isinstance(kv_value, dict) else {}
    return {
        "code": normalize_code(raw.get("code")),
        "require": bool(raw.get("require")),
        # Optional shared secret a customer must enter to order. The code
        # routes to the event (and is public, in the QR/URL); the password
        # is the "were you actually invited" gate. Empty = no password.
        "password": str(raw.get("password") or "").strip()[:64],
    }


WRONG_PASSWORD_MESSAGE = (
    "That event password isn't right. Please check with the event staff.")


def check(kv_value, presented_code, presented_password=None):
    """May this order proceed?

    Returns (allowed, message). The message is empty when allowed.

    The CODE binds the order to the event (blocks last event's QR). The
    optional PASSWORD is a second gate: when set AND required, the order
    must carry the right password too. Both fail OPEN when unconfigured,
    so a missing setting never takes ordering down.
    """
    cfg = read_settings(kv_value)
    if not cfg["require"]:
        return True, ""
    # Code gate (only when a code is actually set).
    if cfg["code"] and normalize_code(presented_code) != cfg["code"]:
        return False, WRONG_EVENT_MESSAGE
    # Password gate (only when a password is actually set).
    if cfg["password"] and str(presented_password or "").strip() != cfg["password"]:
        return False, WRONG_PASSWORD_MESSAGE
    return True, ""


def password_required(kv_value):
    """True when ordering needs a password (set AND enforced)."""
    cfg = read_settings(kv_value)
    return bool(cfg["require"] and cfg["password"])


def stamp_link(url, code):
    """Add ?e=<code> to an ordering URL, keeping any existing query."""
    c = normalize_code(code)
    if not c or not url:
        return url
    sep = "&" if "?" in str(url) else "?"
    return f"{url}{sep}e={c}"
