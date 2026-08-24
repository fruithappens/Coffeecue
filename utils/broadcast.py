"""Telling everyone watching their phone that something has gone wrong.

CTN26 had a 25-minute outage mid-service. Orders were in the system,
customers were watching the status page, and there was no way to tell
any of them anything -- they simply waited, and the only signal was a
queue that stopped moving. Steve: "we have a error, please some and
confirm your order at a counter".

The rule that makes this safe is his, and it is a good one: only orders
that have NOT been printed. Once a label is out, the barista has a
physical record and the order will be made regardless of what the
software is doing. Telling those customers to re-confirm would create
the double-orders it is trying to prevent.

So a broadcast is scoped, never global: it reaches the people whose
orders are genuinely at risk and nobody else.
"""

# KV settings key holding the current notice.
BROADCAST_KEY = "customer_broadcast"

# A notice is a live incident, not a permanent banner. If someone forgets
# to clear it -- likely, mid-incident -- it expires on its own rather
# than greeting customers at the next event.
DEFAULT_TTL_MINUTES = 30
MAX_TTL_MINUTES = 240

# What a customer sees if no wording is supplied. Says what to DO, not
# what broke: "system error" tells them nothing they can act on.
DEFAULT_MESSAGE = (
    "Sorry - we've had a problem with our system. Please come to the "
    "counter and confirm your order."
)

MAX_MESSAGE_CHARS = 200


def clean_message(value):
    """Trim and cap. Never empty: an empty notice would render as a blank
    alert bar, which is more alarming than the message it replaced."""
    text = str(value or "").strip()
    if not text:
        return DEFAULT_MESSAGE
    return text[:MAX_MESSAGE_CHARS]


def clean_ttl(value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_TTL_MINUTES
    return max(1, min(MAX_TTL_MINUTES, n))


def build(message=None, ttl_minutes=None, scope="unprinted", now_iso=None):
    """The stored notice."""
    return {
        "message": clean_message(message),
        "scope": "all" if scope == "all" else "unprinted",
        "ttl_minutes": clean_ttl(ttl_minutes),
        "started_at": now_iso,
    }


def is_live(notice, now_dt, parse):
    """Is this notice still within its window?

    `parse` turns the stored ISO string into a datetime; injected so this
    stays free of any particular date library and testable without one.

    Anything unparseable counts as EXPIRED. A notice whose age cannot be
    established is not one to keep showing customers -- the failure
    should be a missing warning, not a permanent one.
    """
    if not isinstance(notice, dict):
        return False
    if not str(notice.get("message") or "").strip():
        return False
    started = notice.get("started_at")
    if not started:
        return False
    try:
        began = parse(started)
        if began is None:
            return False
        age_min = (now_dt - began).total_seconds() / 60.0
    except Exception:
        return False
    if age_min < 0:
        # Clock skew between the server and whatever wrote this. Treat a
        # notice from the "future" as live rather than silently hiding a
        # real incident.
        return True
    return age_min <= clean_ttl(notice.get("ttl_minutes"))


def applies_to(notice, order_printed):
    """Should THIS order's watcher see the notice?

    The unprinted rule: a printed order is already on a cup label in a
    barista's hand and will be made. Sending its customer to re-confirm
    manufactures a duplicate.
    """
    if not isinstance(notice, dict):
        return False
    if notice.get("scope") == "all":
        return True
    return not order_printed
