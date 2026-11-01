"""Cup labels print the event's local time, not the server's UTC."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from flask import Flask

from routes import print_routes


class _Settings:
    def __init__(self, zone):
        self.zone = zone

    def _get_setting(self, key, default=None):
        return self.zone if key == "event_timezone" else default


def _label_time(zone):
    app = Flask(__name__)
    app.config["coffee_system"] = _Settings(zone)
    with app.app_context():
        return datetime.fromisoformat(print_routes._label_ts())


def _close(a, b):
    return abs(a - b) < timedelta(minutes=2)


def test_label_uses_event_zone():
    want = datetime.now(ZoneInfo("Australia/Adelaide")).replace(tzinfo=None)
    assert _close(_label_time("Australia/Adelaide"), want)


def test_label_follows_another_zone():
    want = datetime.now(ZoneInfo("Australia/Perth")).replace(tzinfo=None)
    assert _close(_label_time("Australia/Perth"), want)


def test_label_without_app_still_returns_a_time():
    # Outside a request (no app context) it falls back to the default zone.
    got = datetime.fromisoformat(print_routes._label_ts())
    want = datetime.now(ZoneInfo("Australia/Adelaide")).replace(tzinfo=None)
    assert _close(got, want)


def test_label_is_not_utc_in_adelaide():
    utc = datetime.now(timezone.utc).replace(tzinfo=None)
    assert not _close(_label_time("Australia/Adelaide"), utc)
