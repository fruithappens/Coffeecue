"""Pre-orders: take orders now, start making them when the session ends.

Steve, at the Hobart symposium (26 Nov 2026): people should be able to
order during a session and be told "we have your order and will start
making it the moment the session finishes at 10:30 -- yours should be
ready about 10:42", and the barista "opens the gates" when the break
starts.

How it works, and the choices behind it:

  The gate is one setting: closed (with the time it opens) or open.
  Closed does NOT refuse anything. Orders go into the normal queue in
  the normal order; what changes is what the customer is told. Their
  phone shows the opening time and a ready time counted FROM the
  opening, not from now -- "ready in 4 min" during a 40-minute talk
  would be a lie.

  The barista opens it with one tap, or simply by starting the first
  coffee: once a coffee is being made, the gate is open whether anyone
  remembered the button or not. A gate that stayed "closed" while the
  queue was moving would keep telling every phone to wait.

  The opening time is the event's own clock (utils/event_time), written
  as HH:MM. A gate whose time has passed but that nobody has opened says
  "starting any minute" rather than quoting a time in the past.

Settings KV key: ORDER_GATE_KEY. Off (open) unless someone closes it.
"""

import math
import re
from datetime import timedelta

ORDER_GATE_KEY = "order_gate"

_HHMM = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")


def read(raw):
    """The gate as stored, with safe defaults: {'closed': bool, 'opens_at': 'HH:MM' or ''}.

    Anything unreadable means OPEN. A broken setting must never leave
    every phone being told to wait for a session that has finished.
    """
    raw = raw if isinstance(raw, dict) else {}
    opens = str(raw.get("opens_at") or "").strip()
    m = _HHMM.match(opens)
    if m and 0 <= int(m.group(1)) <= 23 and 0 <= int(m.group(2)) <= 59:
        opens = f"{int(m.group(1)):02d}:{m.group(2)}"
    else:
        opens = ""
    return {"closed": bool(raw.get("closed")), "opens_at": opens}


def clean_for_save(body, current=None):
    """What PUT stores. Closing needs a time; opening clears nothing else."""
    body = body if isinstance(body, dict) else {}
    cur = read(current)
    closed = bool(body.get("closed", cur["closed"]))
    opens = read({"opens_at": body.get("opens_at", cur["opens_at"])})["opens_at"]
    if closed and not opens:
        raise ValueError("Say what time coffee starts, e.g. 10:30.")
    return {"closed": closed, "opens_at": opens}


def opens_datetime(cfg, now_local):
    """Today's opening time as a datetime in the event's zone, or None."""
    m = _HHMM.match(cfg.get("opens_at") or "")
    if not m or now_local is None:
        return None
    return now_local.replace(hour=int(m.group(1)), minute=int(m.group(2)),
                             second=0, microsecond=0)


def clock(dt):
    """'10:42am' -- the same style the /my page already uses."""
    return dt.strftime("%I:%M").lstrip("0") + dt.strftime("%p").lower()


def minutes_for_position(effective_ahead, pace_seconds):
    """Minutes from the moment making starts until THIS coffee is done.

    Deliberately not capped at 20 like the live estimate: a pre-order
    queue is long by design, and "ready about 10:58" for the 30th person
    is more honest than "20+ min". Rounded up, never under a minute.
    """
    try:
        seconds = (float(effective_ahead or 0) + 1.0) * float(pace_seconds or 150)
    except (TypeError, ValueError):
        seconds = 150.0
    return max(1, int(math.ceil(seconds / 60.0)))


def view(cfg, now_local, minutes_after_open=None):
    """What a customer's phone is told, or None when the gate is open.

    {'closed': True, 'opens_label': '10:30am', 'started': bool,
     'ready_about': '10:42am' or ''}

    'started' is True once the opening time has passed without anyone
    opening the gate: the page then says "starting any minute" and the
    ready time is counted from now.
    """
    if not cfg.get("closed"):
        return None
    opens = opens_datetime(cfg, now_local)
    if opens is None:
        return None
    passed = now_local >= opens
    start = now_local if passed else opens
    out = {"closed": True, "opens_label": clock(opens), "started": passed,
           "ready_about": ""}
    if minutes_after_open:
        out["ready_about"] = clock(start + timedelta(minutes=int(minutes_after_open)))
    return out


def now_in(tzname):
    """Event-local now. Kept here so routes and tests share one clock."""
    from utils import event_time
    return event_time.local_now(tzname)

