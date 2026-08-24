"""Customer broadcasts during an incident.

Two properties carry the weight. A notice must EXPIRE on its own,
because it gets set mid-incident by someone who will not remember to
clear it. And it must not reach customers whose orders are already
printed, or it creates the duplicate orders it exists to prevent.
"""

import os
import sys
from datetime import datetime, timedelta

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.broadcast import (  # noqa: E402
    DEFAULT_MESSAGE,
    DEFAULT_TTL_MINUTES,
    MAX_MESSAGE_CHARS,
    applies_to,
    build,
    clean_message,
    clean_ttl,
    is_live,
)

NOW = datetime(2026, 8, 24, 10, 0, 0)


def parse(s):
    return datetime.fromisoformat(s) if s else None


def at(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).isoformat()


class TestCleanMessage:
    def test_empty_falls_back_rather_than_showing_a_blank_bar(self):
        # An empty notice renders as a blank alert, which is more
        # alarming than the message it replaced.
        assert clean_message("") == DEFAULT_MESSAGE
        assert clean_message(None) == DEFAULT_MESSAGE
        assert clean_message("   ") == DEFAULT_MESSAGE

    def test_capped(self):
        assert len(clean_message("x" * 500)) == MAX_MESSAGE_CHARS

    def test_the_default_says_what_to_do(self):
        # "System error" tells a customer nothing they can act on.
        assert "counter" in DEFAULT_MESSAGE.lower()


class TestCleanTtl:
    def test_defaults_and_clamps(self):
        assert clean_ttl(None) == DEFAULT_TTL_MINUTES
        assert clean_ttl("nonsense") == DEFAULT_TTL_MINUTES
        assert clean_ttl(0) == 1
        assert clean_ttl(99999) == 240


class TestIsLive:
    def test_a_fresh_notice_is_live(self):
        assert is_live(build("down", 30, now_iso=at(2)), NOW, parse)

    def test_it_expires_on_its_own(self):
        # The property that matters: nobody clears these mid-incident.
        assert not is_live(build("down", 30, now_iso=at(31)), NOW, parse)

    def test_no_notice_is_not_live(self):
        assert not is_live(None, NOW, parse)
        assert not is_live({}, NOW, parse)

    def test_an_unparseable_timestamp_counts_as_EXPIRED(self):
        # A notice whose age cannot be established must not show forever.
        assert not is_live({"message": "x", "started_at": "rubbish"}, NOW, parse)
        assert not is_live({"message": "x"}, NOW, parse)

    def test_a_future_timestamp_stays_live(self):
        # Clock skew should not silently hide a real incident.
        future = (NOW + timedelta(minutes=5)).isoformat()
        assert is_live(
            {"message": "x", "started_at": future, "ttl_minutes": 30}, NOW, parse
        )


class TestAppliesTo:
    def test_unprinted_orders_are_told(self):
        n = build("x", 30, now_iso=at(1))
        assert applies_to(n, order_printed=False)

    def test_printed_orders_are_NOT_told(self):
        # Already on a label in a barista's hand -- it will be made.
        # Sending this customer to re-confirm manufactures a duplicate.
        n = build("x", 30, now_iso=at(1))
        assert not applies_to(n, order_printed=True)

    def test_scope_all_reaches_everyone(self):
        n = build("x", 30, scope="all", now_iso=at(1))
        assert applies_to(n, order_printed=True)

    def test_unknown_scope_is_treated_as_the_SAFE_one(self):
        n = build("x", 30, scope="whatever", now_iso=at(1))
        assert n["scope"] == "unprinted"
        assert not applies_to(n, order_printed=True)
