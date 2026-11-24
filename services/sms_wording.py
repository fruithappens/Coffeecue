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
    # Batch 2 (24 Nov 2026): account, data and friend commands.
    "delete_yes_or_no": (
        "Please reply YES to confirm deletion or NO to cancel.",
        {},
        "We asked them to confirm DELETE and got something other than YES or NO.",
    ),
    "delete_cancelled": (
        "Deletion cancelled. Your data is safe. How can we help you today?",
        {},
        "They answered NO to DELETE.",
    ),
    "data_deleted": (
        "Your data has been deleted. Thanks for using {service}.",
        {"service": "the name the text service goes by"},
        "They confirmed DELETE and their details were removed.",
    ),
    "nothing_to_delete": (
        "No data found to delete.",
        {},
        "They confirmed DELETE but we held nothing about them.",
    ),
    "delete_failed": (
        "Sorry, couldn't delete your data. Please contact support.",
        {},
        "They confirmed DELETE and something went wrong.",
    ),
    "mydata_none": (
        "No data found for your phone number. Start your first order to get personalized service!",
        {},
        "They texted MYDATA and we hold nothing about them.",
    ),
    "mydata_failed": (
        "Sorry, couldn't retrieve your data. Please try again later.",
        {},
        "They texted MYDATA and something went wrong.",
    ),
    "changename_usage": (
        "Please provide a name. Example: CHANGENAME Stephen",
        {},
        "They texted CHANGENAME without a name.",
    ),
    "name_updated": (
        "Name updated to: {name}\nYour next order will use this name.",
        {"name": "their new name"},
        "They changed their name with CHANGENAME.",
    ),
    "name_update_failed": (
        "Sorry, couldn't update your name. Please try again.",
        {},
        "CHANGENAME went wrong.",
    ),
    "prefs_none": (
        "No preferences found to reset.",
        {},
        "They texted RESET with no saved usual order.",
    ),
    "prefs_cleared": (
        "Preferences cleared!\nWe'll ask for your order details next time.\nYour name ({name}) is still saved.",
        {"name": "their first name"},
        "They texted RESET and their usual order was forgotten.",
    ),
    "prefs_reset_failed": (
        "Sorry, couldn't reset your preferences. Please try again.",
        {},
        "RESET went wrong.",
    ),
    "friend_order_first": (
        "Please start with your own order first. Text us your coffee order to begin!",
        {},
        "They texted FRIEND before we know who they are.",
    ),
    "friend_own_order_first": (
        "Hi {name}! Please place your own order first, then you can add coffees for friends.",
        {"name": "their first name"},
        "They texted FRIEND without an order in the last hour.",
    ),
    "friend_ask_name": (
        "Great! Let's add a coffee for your friend. What's their name?",
        {},
        "They texted FRIEND after ordering; we start the friend's order.",
    ),
    "friend_failed": (
        "Sorry, couldn't process your request. Please try again.",
        {},
        "FRIEND went wrong.",
    ),
    "question_passed": (
        "Thanks - passed to your barista.",
        {},
        "They sent a question for the barista; it's on the barista's screen.",
    ),
    "cancel_failed": (
        "Sorry, we couldn't cancel your order. Please try again or contact the coffee station directly.",
        {},
        "They texted CANCEL and something went wrong.",
    ),
    "vip_failed": (
        "Sorry, we couldn't process your VIP code. Please try again or contact the help desk.",
        {},
        "They sent a VIP code and something went wrong.",
    ),
    "order_error": (
        "Sorry, we encountered an error processing your order. Please try again or visit the coffee station directly.",
        {},
        "Placing their order went wrong.",
    ),
    # Batch 3 (24 Nov 2026): the ordering questions and refusals.
    "ask_milk": (
        "What milk for your {drink}? ({milks}, or 'no milk')",
        {"drink": "their drink", "milks": "the milks on today"},
        "Their drink needs a milk and they named one we can't assume.",
    ),
    "ask_size": (
        "What size {drink}? ({sizes})",
        {"drink": "their drink", "sizes": "the sizes on offer"},
        "We need the size of their drink.",
    ),
    "milk_unrecognised": (
        "I didn't recognise that milk. Please choose from: {milks}, or 'no milk'.",
        {"milks": "the milks on today"},
        "Their answer to 'what milk?' wasn't a milk.",
    ),
    "milk_none_today": (
        "Sorry, we don't have {milk} at any station today. What milk would you like? ({options})",
        {"milk": "the milk they asked for", "options": "the milks on today, or 'no milk'"},
        "They asked for a milk no open station has.",
    ),
    "milk_not_offered": (
        "Sorry, we don't have {milk}. Available options are: {available}.{off_menu} Please text MENU for full options.",
        {
            "milk": "the milk they asked for",
            "available": "the milks on the menu",
            "off_menu": "a sentence about off-menu requests, when that's turned on",
        },
        "They asked for a milk that isn't on the menu.",
    ),
    "drink_not_offered": (
        "Sorry, we don't offer {drink}. Available options are: {available}. Please text MENU for full options.",
        {"drink": "what they asked for", "available": "the drinks on the menu"},
        "Their order named a drink that isn't on the menu.",
    ),
    "sweetener_not_offered": (
        "Sorry, we don't have {sweetener}. Available options are: {available}. Please text MENU for full options.",
        {"sweetener": "the sweetener they asked for", "available": "the sweeteners on offer"},
        "They asked for a sweetener we don't have.",
    ),
    "which_tea": (
        "Which tea would you like? ({teas})",
        {"teas": "the teas on the menu"},
        "They asked for 'tea' without saying which.",
    ),
    "name_invalid": (
        "Please enter a valid name (2-50 characters).",
        {},
        "The name they sent was too short or too long.",
    ),
    "no_usual_yet": (
        "You don't have a saved usual order yet. What type of coffee would you like, {name}?",
        {"name": "their first name"},
        "They asked for their usual before ordering anything.",
    ),
    "welcome_back_ask_drink": (
        "Welcome back, {name}! What type of coffee would you like today?",
        {"name": "their first name"},
        "A returning customer with no usual order texted.",
    ),
    "welcome_back_ask_milk": (
        "Welcome back, {name}! What type of milk would you like with your {drink}?",
        {"name": "their first name", "drink": "their drink"},
        "A returning customer named a drink and we need the milk.",
    ),
    "confirm_yes_no_edit": (
        "Please reply YES to confirm your order, NO to cancel, or EDIT to change it.",
        {},
        "We asked them to confirm an order and the answer wasn't YES, NO or EDIT.",
    ),
    "usual_confirmed": (
        "Thanks, {name}! Your order has been confirmed. It will be ready for pickup at {station}.",
        {"name": "their first name", "station": "where to collect it"},
        "They confirmed their usual order.",
    ),
    # Batch 4 (24 Nov 2026): ordering for a friend (FRIEND).
    "friend_name_invalid": (
        "Please enter a valid name for your friend (2-50 characters).",
        {},
        "The friend's name they sent was too short or too long.",
    ),
    "friend_ask_drink": (
        "Thanks! What type of coffee would {friend} like?",
        {"friend": "the friend's name"},
        "We have the friend's name and need their drink.",
    ),
    "friend_unsure_drink": (
        "I'm not sure what coffee {friend} would like. Please specify a coffee type like latte, cappuccino, flat white, etc.",
        {"friend": "the friend's name"},
        "We couldn't tell which drink the friend wants.",
    ),
    "friend_got_it_ask_size": (
        "Got it - {order} for {friend}. What size? ({sizes})",
        {"order": "the friend's drink and milk", "friend": "the friend's name", "sizes": "the sizes on offer"},
        "We have the friend's drink and milk and need the size.",
    ),
    "friend_ask_size": (
        "What size {drink} would {friend} like? ({sizes})",
        {"drink": "the friend's drink", "friend": "the friend's name", "sizes": "the sizes on offer"},
        "We have the friend's milk and need the size.",
    ),
    "friend_milk_unrecognised": (
        "I didn't recognize that milk type. Please choose from: {milks}, or no milk.",
        {"milks": "the milks on today"},
        "Their answer to the friend's milk question wasn't a milk.",
    ),
    "friend_size_unrecognised": (
        "I didn't recognize that size. Please choose {sizes} for {friend}'s coffee.",
        {"sizes": "the sizes on offer", "friend": "the friend's name"},
        "Their answer to the friend's size question wasn't a size.",
    ),
    "friend_sugar_unclear": (
        "Sorry, I didn't catch how much sugar for {friend}. Reply 'none', '1', '2', '3', or 'half'.",
        {"friend": "the friend's name"},
        "Their answer to the friend's sugar question wasn't a sugar.",
    ),
    "friend_flow_confirmed": (
        "Thanks, {name}! Your order has been confirmed.\nWe'll SMS you when it's ready with the pickup location.",
        {"name": "their first name"},
        "They finished ordering for friends with just one coffee.",
    ),
    "friend_ask_another": (
        "Great! Let's add another coffee. What's your friend's name?",
        {},
        "They want to add another friend's coffee.",
    ),
    "friend_another_or_no": (
        "Please reply FRIEND to order for another friend, or NO to finish.",
        {},
        "We asked if they want another friend's coffee and the answer wasn't clear.",
    ),
    "friend_cancelled_next": (
        "Order for {friend} cancelled. What's the name of another friend you'd like to order for? (or type DONE to finish)",
        {"friend": "the friend's name"},
        "They cancelled a friend's coffee.",
    ),
    "friend_change": (
        "Let's change {friend}'s order. What type of coffee would {friend} like?",
        {"friend": "the friend's name"},
        "They asked to change a friend's coffee.",
    ),
    "friend_confirm_prompt": (
        "Please reply YES to confirm {friend}'s order, NO to cancel, EDIT to change it, or DONE to finish the group order.",
        {"friend": "the friend's name"},
        "We asked them to confirm a friend's coffee and the answer wasn't clear.",
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
