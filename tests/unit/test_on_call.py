"""The on-call roster: which shifts it accepts, who it says is on, who alerts reach."""

import os
import sys
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import admin_alerts, on_call  # noqa: E402

ADL = ZoneInfo("Australia/Adelaide")


def shift(**kw):
    base = {"name": "Sam", "phone": "+61 400 000 001", "day": "2026-11-03", "start": "06:30", "end": "15:00"}
    base.update(kw)
    s, why = on_call.clean_shift(base)
    assert s, why
    return s


def test_clean_shift_tidies_and_refuses():
    s = shift()
    assert s["phone"] == "+61400000001" and s["start"] == "06:30"
    for bad, word in (({"name": ""}, "name"), ({"phone": "", "email": ""}, "mobile"),
                      ({"phone": "call me"}, "phone"), ({"email": "nope", "phone": ""}, "email"),
                      ({"day": "Tuesday"}, "date"), ({"start": "25:00"}, "times"),
                      ({"end": "06:30"}, "same time")):
        raw = {"name": "Sam", "phone": "+61400000001", "day": "2026-11-03", "start": "06:30", "end": "15:00", **bad}
        s, why = on_call.clean_shift(raw)
        assert s is None and word in why, (bad, why)
    assert on_call.clean_shift({"name": "Ana", "email": "ana@example.com", "day": "every",
                                "start": "7:00", "end": "17:00"})[0]["start"] == "07:00"


def test_covers_uses_the_event_clock_and_runs_past_midnight():
    s = shift()
    assert on_call.covers(s, datetime(2026, 11, 3, 6, 30, tzinfo=ADL))
    assert not on_call.covers(s, datetime(2026, 11, 3, 15, 0, tzinfo=ADL))  # end is exclusive
    assert not on_call.covers(s, datetime(2026, 11, 4, 7, 0, tzinfo=ADL))   # other day
    night = shift(start="22:00", end="02:00")
    assert on_call.covers(night, datetime(2026, 11, 3, 23, 0, tzinfo=ADL))
    assert on_call.covers(night, datetime(2026, 11, 4, 1, 59, tzinfo=ADL))  # began on the 3rd
    assert not on_call.covers(night, datetime(2026, 11, 3, 1, 0, tzinfo=ADL))  # that's the 2nd's shift
    every = shift(day="every")
    assert on_call.covers(every, datetime(2027, 1, 1, 9, 0, tzinfo=ADL))
    # 6:45 in Adelaide is 20:15 UTC the day before: the event's clock decides.
    utc = datetime(2026, 11, 2, 20, 15, tzinfo=ZoneInfo("UTC"))
    assert on_call.covers(s, utc.astimezone(ADL))


def test_alerts_go_to_on_call_and_admin_once_each():
    on_now = [shift(), shift(name="Ana", phone="", email="ANA@example.com"),
              shift(name="Dup", phone="0400 000 001")]  # same mobile as Sam, local format
    cfg = {"phone": "+61412000000", "email": "ana@example.com"}
    with patch.object(on_call, "on_call_now", return_value=on_now):
        phones, emails = admin_alerts.recipients(cfg, db=object())
    assert phones == ["+61400000001", "+61412000000"]
    assert emails == ["ANA@example.com"]


def test_no_roster_still_reaches_admin():
    with patch.object(on_call, "on_call_now", return_value=[]):
        assert admin_alerts.recipients({"phone": "+61412000000"}, db=object()) == (["+61412000000"], [])
