"""The text bot's wording, editable by the organiser (roadmap X7-6).

Each message the bot sends has a key, CupQ's default wording, and the
{placeholders} it fills in. The organiser can override any of them in
Runner > Messages > Text wording; an override is stored in the settings
table (key "sms_wording") and used from the next text on.

    from services.sms_wording import say
    return say("order_cancelled", order_number=order_number)

Rules that keep an edit from breaking a conversation:
  - an override may only use the placeholders its message offers; an
    unknown {placeholder} or a stray brace falls back to the default
  - a blank override means "use the default"
  - overrides are re-read at most every 30 seconds

The defaults are word for word what the bot said before this module
existed (tests/sms_scenarios/golden_transcript.py proves it).

Messages move here a batch at a time; the welcome, confirmation, started,
ready and delay texts already have their own settings (Messages > Text
blast panel) and stay where they are.
"""
import logging
import string
import time

logger = logging.getLogger("expresso.sms_wording")

KV_KEY = "sms_wording"
MAX_LEN = 480  # three segments; the editor warns long before that

# key: (default wording, {placeholder: what it is}, where it's sent)
CATALOG = {
    "ask_name_after_order": (
        "Got it! And what's your first name?",
        {},
        "They ordered before telling us their name.",
    ),
    "not_a_name": (
        "Sorry, I didn't catch your name - what's your first name?",
        {},
        "We asked for their name and got something like 'yes' or 'none'.",
    ),
    "no_name_yet": (
        "I don't have your name yet. What's your first name?",
        {},
        "We need a name before we can take the order.",
    ),
    "group_ask_name": (
        "Sounds like a few coffees! First - what's your name?",
        {},
        "Their first text orders several coffees and we don't know them yet.",
    ),
    "ask_drink": (
        "What can I get you? (e.g. flat white, latte, cappuccino - or MENU for the list)",
        {},
        "We have their name and need the drink.",
    ),
    "drink_unavailable": (
        "Sorry, we don't have {drink} today. What would you like? ({available})",
        {"drink": "what they asked for", "available": "the drinks on today's menu"},
        "They asked for a drink that isn't on the menu.",
    ),
    "unsure_coffee": (
        "I'm not sure what type of coffee you'd like, {name}. Please specify a coffee type like latte, cappuccino, flat white, etc.",
        {"name": "their first name"},
        "We couldn't tell which drink they meant.",
    ),
    "size_not_offered": (
        "Sorry, we don't offer size '{size}' for {drink}. Available sizes are: {sizes}. Please select one of these.",
        {
            "size": "the size they asked for",
            "drink": "their drink",
            "sizes": "the sizes on offer",
        },
        "They asked for a size this event doesn't pour.",
    ),
    "size_unrecognised": (
        "I didn't recognize that size. Please choose from: {sizes}.",
        {"sizes": "the sizes on offer"},
        "Their answer to 'what size?' wasn't a size.",
    ),
    "stations_closed": (
        "Sorry, coffee isn't being served right now, so I can't take an order. Text us again when the stations open.",
        {},
        "They ordered while every station is closed.",
    ),
    "no_active_orders": (
        "You don't have any active orders. Text us your coffee order to get started!",
        {},
        "They texted STATUS with nothing on order.",
    ),
    "nothing_to_cancel": (
        "You don't have any pending orders to cancel.",
        {},
        "They texted CANCEL with nothing waiting.",
    ),
    "order_cancelled": (
        "Your order #{order_number} has been cancelled. Text us when you'd like to place a new order.",
        {"order_number": "the order's number"},
        "They cancelled an order by text.",
    ),
    "ask_barista_question": (
        "Sure - type your question and I'll send it straight to your barista.",
        {},
        "They texted BARISTA to ask a question.",
    ),
    "delete_confirm": (
        "This will delete all your data including order history.\nReply YES to confirm deletion or NO to cancel.",
        {},
        "They texted DELETE.",
    ),
}

_cache = {"at": 0.0, "value": {}}
TTL_S = 30


def _overrides():
    if time.monotonic() - _cache["at"] < TTL_S:
        return _cache["value"]
    value = {}
    try:
        from utils.database import close_connection, get_db_connection

        conn = get_db_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT value FROM settings WHERE key = %s", (KV_KEY,))
            row = cur.fetchone()
            raw = (
                (row[0] if not isinstance(row, dict) else row.get("value"))
                if row
                else None
            )
            if raw:
                import json

                parsed = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(parsed, dict):
                    value = {
                        k: str(v)
                        for k, v in parsed.items()
                        if k in CATALOG and str(v or "").strip()
                    }
        finally:
            close_connection(conn)
    except Exception as e:
        logger.debug("sms wording overrides unavailable: %s", e)
    _cache.update(at=time.monotonic(), value=value)
    return value


def placeholders(text):
    """The {names} a piece of text uses; raises ValueError on stray braces."""
    return {f for _, f, _, _ in string.Formatter().parse(text) if f}


def problems(key, text):
    """Why an override can't be used, or None."""
    if key not in CATALOG:
        return "unknown message"
    if len(text) > MAX_LEN:
        return f"longer than {MAX_LEN} characters"
    try:
        extra = placeholders(text) - set(CATALOG[key][1])
    except ValueError:
        return "a { or } that isn't part of a placeholder"
    if extra:
        return "unknown placeholder: " + ", ".join("{" + e + "}" for e in sorted(extra))
    return None


def say(key, **values):
    """The message for `key`, the organiser's wording if they set one."""
    default = CATALOG[key][0]
    text = _overrides().get(key) or default
    if text is not default and problems(key, text):
        text = default
    try:
        return text.format(**{k: values.get(k, "") for k in CATALOG[key][1]})
    except (KeyError, IndexError, ValueError):
        return default.format(**{k: values.get(k, "") for k in CATALOG[key][1]})


def clear_cache():
    _cache.update(at=0.0, value={})
