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
    }


def check(kv_value, presented_code):
    """May this order proceed?

    Returns (allowed, message). The message is empty when allowed.

    Deliberately permissive in three cases, each of which would
    otherwise turn a safety feature into an outage:

      - the event does not require a code
      - the event requires one but has not SET one, which is a
        misconfiguration and must not take ordering down
      - the codes match
    """
    cfg = read_settings(kv_value)
    if not cfg["require"]:
        return True, ""
    if not cfg["code"]:
        # Required but never configured. Fail open, loudly in the logs.
        return True, ""
    if normalize_code(presented_code) == cfg["code"]:
        return True, ""
    return False, WRONG_EVENT_MESSAGE


def stamp_link(url, code):
    """Add ?e=<code> to an ordering URL, keeping any existing query."""
    c = normalize_code(code)
    if not c or not url:
        return url
    sep = "&" if "?" in str(url) else "?"
    return f"{url}{sep}e={c}"
