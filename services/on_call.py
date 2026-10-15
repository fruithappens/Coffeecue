"""Who is on call right now (roadmap U4-6).

The roster is a list of shifts in the settings table (key "on_call_roster"),
edited in Runner > People > On call:

    [{"name": "Sam", "phone": "+61400000000", "email": "",
      "day": "2026-11-03", "start": "06:30", "end": "15:00"}]

`day` is a date, or "every" for a standing shift. Times are the EVENT's
clock (event_timezone), not the server's: the server runs UTC, and a 6:30
start in Adelaide is 21:00 UTC the day before. A shift whose end is before
its start runs past midnight.

Alerts (services/admin_alerts) go to whoever is on call now AND to the
admin alert number, so the roster adds people, never removes the backstop.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime, time as dtime, timedelta

logger = logging.getLogger(__name__)

KV_KEY = "on_call_roster"
MAX_SHIFTS = 200
_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_PHONE = re.compile(r"^\+?[0-9]{8,15}$")
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$")


def _t(text):
    m = _TIME.match(str(text or "").strip())
    return dtime(int(m.group(1)), int(m.group(2))) if m else None


def clean_shift(raw):
    """(shift, problem): a tidy shift, or None and why it can't be used."""
    if not isinstance(raw, dict):
        return None, "not a shift"
    name = str(raw.get("name") or "").strip()[:60]
    phone_typed = str(raw.get("phone") or "").strip()
    phone = re.sub(r"[\s\-().]", "", phone_typed)
    email = str(raw.get("email") or "").strip()[:254]
    day = str(raw.get("day") or "").strip().lower()
    start, end = _t(raw.get("start")), _t(raw.get("end"))
    if not name:
        return None, "needs a name"
    if not (phone_typed or email):
        return None, f"{name}: needs a mobile or an email"
    if phone and not _PHONE.match(phone):
        return None, f"{name}: '{raw.get('phone')}' isn't a phone number"
    if email and not _EMAIL.match(email):
        return None, f"{name}: '{email}' isn't an email address"
    if day != "every":
        try:
            day = date.fromisoformat(day).isoformat()
        except ValueError:
            return None, f"{name}: the day must be a date or 'every day'"
    if not start or not end:
        return None, f"{name}: start and end are times like 06:30"
    if start == end:
        return None, f"{name}: the shift starts and ends at the same time"
    return {"name": name, "phone": phone, "email": email, "day": day,
            "start": start.strftime("%H:%M"), "end": end.strftime("%H:%M")}, None


def covers(shift, local_dt):
    """Is `local_dt` (the event's own clock) inside this shift?"""
    start, end = _t(shift.get("start")), _t(shift.get("end"))
    if not start or not end:
        return False
    day = shift.get("day")
    # The shift may have started today, or (past midnight) yesterday.
    for began in (local_dt.date(), local_dt.date() - timedelta(days=1)):
        if day != "every" and day != began.isoformat():
            continue
        s = datetime.combine(began, start)
        e = datetime.combine(began if end > start else began + timedelta(days=1), end)
        naive = local_dt.replace(tzinfo=None)
        if s <= naive < e:
            return True
    return False


def load(db):
    from routes.consolidated_api_routes import _kv_get

    raw = _kv_get(db, KV_KEY, default=[]) or []
    out = []
    for r in raw if isinstance(raw, list) else []:
        s, _why = clean_shift(r)
        if s:
            out.append(s)
    return out


def event_now():
    from routes.consolidated_api_routes import _event_timezone
    from utils.event_time import local_now

    return local_now(_event_timezone())


def on_call_now(db, now=None):
    """The shifts covering this moment, in roster order."""
    try:
        now = now or event_now()
        return [s for s in load(db) if covers(s, now)]
    except Exception as e:  # noqa: BLE001 - alerting must never fail on this
        logger.warning("on-call lookup failed: %s", e)
        return []


def today_has_cover(db, now=None):
    """Any shift today (the event's today), for the Readiness check."""
    now = now or event_now()
    today = now.date().isoformat()
    return [s for s in load(db) if s["day"] in ("every", today)]
