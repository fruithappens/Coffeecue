"""Where an order came from, recorded once and read everywhere.

CTN26 exposed the gap: 74% of orders were "self-service", but the
touchscreen at the cart and the /my page on a delegate's own phone both
posted through /api/display/order and landed in the database tagged
identically. There was no way, after the fact, to tell a tap on the iPad
from a scan of the poster by the door. The client question this exists to
answer -- "where are my orders actually coming from, and can I turn SMS
off?" -- was unanswerable.

Two fields, deliberately separate:

  channel  HOW the order was placed. Closed vocabulary, five values, set
           by the code path that creates the order. Never guessed.

  source   WHERE the customer entered from: which poster, which iPad,
           which sign. Open vocabulary, carried in the ?src= parameter on
           the QR link, so a new placement needs a new QR code and no
           deploy.

Keeping them apart is the point. Channel answers "is SMS still earning
its keep"; source answers "which sign is working". Merging them into one
field would make both questions harder.

Old orders predate all of this, so infer_channel() reconstructs the
channel from the shape of the order_details that were written at the
time. It is a best effort on history, not a substitute for stamping.
"""

import re

# Closed vocabulary. The label is what a client sees on a report.
CHANNELS = {
    "sms": "SMS",
    "kiosk": "On-site touchscreen",
    "web": "Own phone (QR)",
    "app": "Event app",
    "barista": "Entered by barista",
}

# Self-service channels -- the ones that need no staff time. Reported
# together when the question is "how much did we automate".
SELF_SERVE = ("kiosk", "web", "app")

_SOURCE_RE = re.compile(r"[^a-z0-9-]+")


def normalize_channel(value):
    """A known channel name, or None. Never raises."""
    try:
        v = str(value or "").strip().lower().replace("_", "-")
    except Exception:
        return None
    # Tolerate the spellings already in the wild.
    v = {
        "walkin": "barista",
        "walk-in": "barista",
        "staff": "barista",
        "ea-app": "app",
        "eventsair": "app",
        "my": "web",
        "qr": "web",
        "touchscreen": "kiosk",
        "display": "kiosk",
    }.get(v, v)
    return v if v in CHANNELS else None


def normalize_source(value):
    """A placement code safe to store, compare and print.

    Squashed to lowercase [a-z0-9-] and capped at 32 characters, because
    this arrives from a QR code that anyone can craft. "Cart 1 iPad"
    becomes "cart-1-ipad"; junk becomes ''.
    """
    try:
        v = str(value or "").strip().lower()
    except Exception:
        return ""
    v = _SOURCE_RE.sub("-", v).strip("-")
    while "--" in v:
        v = v.replace("--", "-")
    return v[:32]


def stamp(order_details, channel, source=None):
    """Record provenance on an order's details dict.

    Called at the point of INSERT, by the code path that knows how the
    order arrived. Returns the same dict for convenience. An unknown
    channel is dropped rather than stored, so a bad caller cannot invent
    a sixth channel and quietly fragment every report.
    """
    if not isinstance(order_details, dict):
        return order_details
    ch = normalize_channel(channel)
    if ch:
        order_details["channel"] = ch
    src = normalize_source(source)
    if src:
        order_details["source_code"] = src
    return order_details


def infer_channel(order_details):
    """Best-effort channel for an order written before stamping existed.

    Reads the accidental markers the old code left behind:
      order_type == 'kiosk'   the Display kiosk endpoint set this, and
                              /my posted through the same endpoint, so
                              this collapses to 'kiosk' and CANNOT be
                              split back into kiosk vs web. That loss is
                              exactly why stamp() exists.
      source == 'walkin'      the barista walk-in dialog
      source == 'ea_app'      the EventsAir survey channel
      anything else           SMS, which never marked itself
    """
    if not isinstance(order_details, dict):
        return "sms"
    explicit = normalize_channel(order_details.get("channel"))
    if explicit:
        return explicit
    src = str(order_details.get("source") or "").strip().lower()
    if src in ("walkin", "walk-in"):
        return "barista"
    if src in ("ea_app", "eventsair"):
        return "app"
    otype = str(order_details.get("order_type") or "").strip().lower()
    created = str(order_details.get("created_by") or "").strip().lower()
    if otype == "kiosk" or created == "kiosk":
        return "kiosk"
    return "sms"


def channel_label(channel):
    """Human label for a report. Unknown values pass through readable."""
    ch = normalize_channel(channel)
    return CHANNELS.get(ch) or str(channel or "Unknown")


def is_estimated(order_details):
    """True when the channel was inferred rather than recorded.

    Reports must say so: a 'kiosk' from before stamping may in truth
    have been a /my scan, and presenting that as measured would be a
    lie told with a bar chart.
    """
    if not isinstance(order_details, dict):
        return True
    return not normalize_channel(order_details.get("channel"))
