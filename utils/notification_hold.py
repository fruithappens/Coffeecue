"""Holding customer notifications, then releasing them together.

At CTN26, 68 people ordered and every "your coffee is ready" text went
out the moment the barista tapped complete. That is right for a rolling
service. It is wrong for pre-orders taken before a session, where the
coffees are made during the talk and the texts land in the middle of it
-- 400 phones buzzing through a plenary, and a text charge for each one.

Steve's own note: "might need another option finish coffees without
notifying straight away, and then at end of session or as it breaks push
the its ready for collection".

So this is a switch plus a queue. While the hold is on, orders complete
normally -- labels print, the board updates, the display shows them
ready -- but the customer's phone stays quiet and the order is marked as
owing a notification. Releasing sends them.

Two decisions worth stating, because both could have gone the other way:

  The hold NEVER blocks anything except the outbound text. An order
  still completes, still prints, still appears as ready. A held
  notification is a delayed message, not a delayed coffee.

  A held order that is collected before release is dropped from the
  queue rather than texted. Telling someone their coffee is ready when
  they are already drinking it is worse than saying nothing, and at a
  break most people simply walk up.

The flag lives on the order rather than in a side table so it survives a
restart -- which, given this system spent 25 minutes down mid-service on
23 August, is not a theoretical concern.
"""

# KV settings key holding the switch.
HOLD_SETTING_KEY = "notification_hold"

# Marker written onto order_details while a notification is owed.
HELD_FLAG = "notification_held"

# Statuses where a held notification is still worth sending. An order
# already picked up does not need telling it is ready.
RELEASABLE_STATUSES = ("completed",)


def is_holding(kv_value):
    """Is the hold currently on?

    Takes whatever came back from the settings store, which over the life
    of this system has been a bool, a string, a dict and None. Anything
    unrecognised means NOT holding: the safe default is that customers
    get told about their coffee, because silence is the failure nobody
    notices until someone complains their order never came.
    """
    if kv_value is None:
        return False
    if isinstance(kv_value, bool):
        return kv_value
    if isinstance(kv_value, dict):
        return is_holding(kv_value.get("enabled", kv_value.get("value")))
    if isinstance(kv_value, (int, float)):
        return bool(kv_value)
    if isinstance(kv_value, str):
        return kv_value.strip().lower() in ("1", "true", "yes", "on", "enabled")
    return False


def mark_held(order_details):
    """Record that this order owes its customer a notification."""
    if isinstance(order_details, dict):
        order_details[HELD_FLAG] = True
    return order_details


def clear_held(order_details):
    """Forget the debt -- sent, or no longer worth sending."""
    if isinstance(order_details, dict):
        order_details.pop(HELD_FLAG, None)
    return order_details


def is_held(order_details):
    """Does this order owe a notification?"""
    if not isinstance(order_details, dict):
        return False
    return bool(order_details.get(HELD_FLAG))


def should_release(order_details, status, phone):
    """Should this held order actually get a text when we release?

    Three ways to owe nothing:
      - it was never held
      - there is no phone to text (a kiosk order without a number; the
        barista calls the name instead)
      - it has already been collected, so the news is stale and slightly
        insulting
    """
    if not is_held(order_details):
        return False
    if not str(phone or "").strip():
        return False
    return str(status or "").strip().lower() in RELEASABLE_STATUSES


def summarise(rows):
    """What the barista sees before pressing release.

    `rows` is an iterable of (order_details, status, phone). Returns
    counts so the button can say what it is about to do -- pressing
    "release" without knowing it will send 87 texts is how an event ends
    up with an unexpected bill.
    """
    total = sendable = no_phone = already_collected = 0
    for details, status, phone in rows or []:
        if not is_held(details):
            continue
        total += 1
        if not str(phone or "").strip():
            no_phone += 1
        elif str(status or "").strip().lower() not in RELEASABLE_STATUSES:
            already_collected += 1
        else:
            sendable += 1
    return {
        "held": total,
        "will_send": sendable,
        "no_phone": no_phone,
        "already_collected": already_collected,
    }
