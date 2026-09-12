"""One clock for 'which day is it where the event is' (finding 3)."""
import os
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from utils import event_time as et  # noqa: E402

ADL = "Australia/Adelaide"


class TestZone:
    def test_defaults_to_adelaide_not_utc(self):
        assert et.resolve_zone(None) == ADL
        assert et.resolve_zone(lambda k, d: "") == ADL
        assert et.resolve_zone(lambda k, d: "  ") == ADL

    def test_reads_the_setting_and_rejects_nonsense(self):
        assert et.resolve_zone(lambda k, d: "Asia/Singapore") == "Asia/Singapore"
        assert et.resolve_zone(lambda k, d: "Mars/Olympus") == "UTC"

        def boom(k, d):
            raise RuntimeError("no db")

        assert et.resolve_zone(boom) == ADL


class TestBounds:
    def test_a_local_day_is_the_right_utc_window(self):
        # 3 Sep 2026 in Adelaide (UTC+9:30, no DST in September) runs from
        # 2 Sep 14:30 UTC to 3 Sep 14:30 UTC.
        start, end = et.day_bounds(date(2026, 9, 3), ADL)
        assert start == datetime(2026, 9, 2, 14, 30)
        assert end == datetime(2026, 9, 3, 14, 30)
        assert start.tzinfo is None and end.tzinfo is None  # naive UTC, like the column

    def test_the_treenet_morning_lands_on_the_third(self):
        # 07:12 local on the 3rd is 21:42 UTC on the 2nd: DATE(created_at)
        # said the 2nd. The window says the 3rd.
        start, end = et.day_bounds(date(2026, 9, 3), ADL)
        stored = datetime(2026, 9, 2, 21, 42)
        assert start <= stored < end

    def test_range_is_inclusive_both_ends_and_forgives_a_swap(self):
        s, e = et.range_bounds(date(2026, 9, 4), date(2026, 9, 3), ADL)
        assert s == datetime(2026, 9, 2, 14, 30) and e == datetime(2026, 9, 4, 14, 30)
        s, e = et.range_bounds(date(2026, 9, 3), None, ADL)
        assert s == datetime(2026, 9, 2, 14, 30) and e is None
        assert et.range_bounds(None, None, ADL) == (None, None)

    def test_utc_zone_is_the_identity(self):
        s, e = et.day_bounds(date(2026, 9, 3), "UTC")
        assert s == datetime(2026, 9, 3) and e == datetime(2026, 9, 4)

    def test_parse_date_is_forgiving(self):
        assert et.parse_date("2026-09-03") == date(2026, 9, 3)
        assert et.parse_date("2026-09-03T07:00:00") == date(2026, 9, 3)
        assert et.parse_date("yesterday") is None
        assert et.parse_date(None) is None


class TestSql:
    def test_local_date_sql_shifts_through_the_zone(self):
        assert (
            et.local_date_sql()
            == "((created_at AT TIME ZONE 'UTC') AT TIME ZONE %(tz)s)::date"
        )
        assert "received_at" in et.local_date_sql("received_at")
        assert et.local_hour_sql().startswith("EXTRACT(HOUR FROM")
