"""Demo phone numbers: texts that are shown, never sent.

The Demo Room (cupq.app/demo) needs to show what a customer would receive
-- the confirmation, the "it's ready" -- without texting anybody or
spending the event's text allowance. Demo orders use the numbers

    0400 009 900 .. 0400 009 999   (+61400009900 .. +61400009999)

and services/messaging.send_message() files every text to one of them
here instead of handing it to the provider.

They sit INSIDE the bench range (+6140000xxxx, not an allocatable
Australian mobile range), on purpose: if this module ever failed to catch
one, the bench wall right behind it still refuses it. Two walls, and the
second one already existed.

Kept in memory, newest last, capped. A restart forgets them, which is fine
for a demo, and nothing here counts against the text meter.
"""
import threading
from collections import deque
from datetime import datetime, timezone

DEMO_PHONE_PREFIX = "+614000099"
FIRST_DEMO_PHONE = "+61400009900"
_MAX = 500

_lock = threading.Lock()
_texts = deque(maxlen=_MAX)
_next_id = 1


def is_demo(to):
    """True for a number in the demo range (E.164 form)."""
    s = str(to or "").strip()
    return s.startswith(DEMO_PHONE_PREFIX) and len(s) == len(FIRST_DEMO_PHONE)


def add(to, body, kind="other", direction="out"):
    """File one text: `out` = would have been sent to the demo number,
    `in` = the demo customer texting the event (the Demo Room's
    Messages box). Returns its id."""
    global _next_id
    with _lock:
        tid = _next_id
        _next_id += 1
        _texts.append(
            {
                "id": tid,
                "to": str(to),
                "body": str(body or ""),
                "kind": str(kind or "other"),
                "direction": "in" if direction == "in" else "out",
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )
        return tid


def list_texts(phone=None, after=0):
    """Texts newest last; only one number's when `phone` is given, and
    only those after id `after` so a poller can ask for what's new."""
    with _lock:
        out = list(_texts)
    if phone:
        out = [t for t in out if t["to"] == phone]
    if after:
        out = [t for t in out if t["id"] > after]
    return out


def clear():
    """Forget every demo text (the Demo Room's Wipe)."""
    with _lock:
        _texts.clear()
