"""Which day is it where the event is.

The server stores naive UTC and runs TZ=UTC to match Railway. Adelaide is
UTC+9:30, so a 7am start is 21:30 UTC the previous day, and anything that
groups or filters by the bare date -- DATE(created_at), created_at::date,
CURRENT_DATE -- files the whole morning under yesterday. On Treenet that put
144 of the first morning's orders on the 2nd and read the event as 463
orders instead of 577 (finding 3 in docs/FINDINGS_ROADMAP.md).

The report was fixed first, in its own module. This is the same idea made
shareable, so every "today" and every date filter in the app resolves through
one clock: the `event_timezone` setting, defaulting to Steve's own zone rather
than UTC, because a default of UTC IS the bug.

Two ways to use it, both index-friendly:

    start, end = today_bounds(tz)            # naive UTC instants, end EXCLUSIVE
    cur.execute("... WHERE created_at >= %s AND created_at < %s", (start, end))

    cur.execute(f"SELECT {local_date_sql('created_at')} AS d ... GROUP BY d",
                {'tz': tz})                  # group by the LOCAL date

Nothing here touches Flask or the database; callers pass a getter for the
setting so services and routes can share it.
"""
import logging
from datetime import date, datetime, timedelta, timezone

logger = logging.getLogger(__name__)

DEFAULT_ZONE = "Australia/Adelaide"


def resolve_zone(get_setting=None):
    """The event's IANA zone name. `get_setting(key, default)` reads the
    settings KV; None means 'no settings available'. Unknown zones fall back
    to UTC -- not to the default zone, because if the zone database is
    missing the default fails the same way."""
    tz = ""
    try:
        if get_setting is not None:
            tz = get_setting("event_timezone", "") or ""
    except Exception:
        tz = ""
    tz = (str(tz) or "").strip() or DEFAULT_ZONE
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo(tz)
        return tz
    except Exception:
        logger.warning("event_timezone %r is not a known zone; using UTC", tz)
        return "UTC"


def zone_of(tzname):
    """A tzinfo for the name; UTC itself never needs the zone database."""
    if not tzname or tzname.upper() == "UTC":
        return timezone.utc
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(tzname)
    except Exception:
        return timezone.utc


def local_now(tzname):
    return datetime.now(zone_of(tzname))


def local_today(tzname):
    """Today's date where the event is."""
    return local_now(tzname).date()


def parse_date(value):
    """YYYY-MM-DD (anything after the first 10 chars ignored) -> date, or None."""
    if value is None:
        return None
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except (ValueError, TypeError):
        return None


def local_midnight_utc(d, tzname):
    """Local midnight on `d`, as the naive UTC timestamp the DB stores."""
    return (
        datetime(d.year, d.month, d.day, tzinfo=zone_of(tzname))
        .astimezone(timezone.utc)
        .replace(tzinfo=None)
    )


def day_bounds(d, tzname):
    """(start, end) naive UTC for one local day; end is EXCLUSIVE."""
    return local_midnight_utc(d, tzname), local_midnight_utc(
        d + timedelta(days=1), tzname
    )


def range_bounds(a, b, tzname):
    """(start, end) for local days a..b inclusive (either may be None for an
    open end; both None -> (None, None)). Swapped ends are put right."""
    if a and b and b < a:
        a, b = b, a
    start = local_midnight_utc(a, tzname) if a else None
    end = local_midnight_utc(b + timedelta(days=1), tzname) if b else None
    return start, end


def today_bounds(tzname):
    return day_bounds(local_today(tzname), tzname)


def local_date_sql(column="created_at"):
    """SQL for the LOCAL date of a naive-UTC column; bind `tz` as a named
    parameter: cur.execute(sql, {'tz': tzname})."""
    return f"(({column} AT TIME ZONE 'UTC') AT TIME ZONE %(tz)s)::date"


def local_hour_sql(column="created_at"):
    return (
        f"EXTRACT(HOUR FROM (({column} AT TIME ZONE 'UTC') AT TIME ZONE %(tz)s))::int"
    )
