"""Holding and releasing customer notifications.

The property that matters most: the hold must never accidentally be ON.
A stuck hold means customers are never told their coffee is ready and
nobody finds out until someone complains, which is a far worse failure
than a text arriving at an awkward moment.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.notification_hold import (  # noqa: E402
    HELD_FLAG,
    clear_held,
    is_held,
    is_holding,
    mark_held,
    should_release,
    summarise,
)


class TestIsHolding:
    def test_the_obvious_truths(self):
        for v in (True, 1, "true", "TRUE", "yes", "on", "1", "enabled"):
            assert is_holding(v) is True, v

    def test_the_obvious_falsehoods(self):
        for v in (False, 0, "false", "no", "off", ""):
            assert is_holding(v) is False, v

    def test_unset_means_customers_get_told(self):
        # The safe default. Silence is the failure nobody notices.
        assert is_holding(None) is False

    def test_junk_means_customers_get_told(self):
        # A corrupted setting must fail towards sending, not towards
        # silence -- an unrecognised value is not a reason to stop
        # telling people their coffee is ready.
        for v in ("nonsense", [], object(), "maybe"):
            assert is_holding(v) is False

    def test_the_dict_shape_the_kv_store_sometimes_returns(self):
        assert is_holding({"enabled": True}) is True
        assert is_holding({"value": "on"}) is True
        assert is_holding({"enabled": False}) is False
        assert is_holding({}) is False


class TestMarking:
    def test_mark_and_clear(self):
        d = mark_held({"name": "Ana"})
        assert d[HELD_FLAG] is True
        assert is_held(d)
        clear_held(d)
        assert not is_held(d)
        assert "name" in d

    def test_clearing_something_never_held_is_harmless(self):
        assert clear_held({"name": "Bo"}) == {"name": "Bo"}

    def test_survives_a_non_dict(self):
        assert mark_held(None) is None
        assert is_held(None) is False
        assert clear_held(None) is None


class TestShouldRelease:
    def test_a_held_completed_order_with_a_phone_gets_its_text(self):
        assert should_release({HELD_FLAG: True}, "completed", "+61400000001")

    def test_an_order_that_was_never_held_is_not_texted(self):
        assert not should_release({}, "completed", "+61400000001")

    def test_no_phone_means_nothing_to_send(self):
        # A kiosk order without a number: the barista calls the name.
        assert not should_release({HELD_FLAG: True}, "completed", "")
        assert not should_release({HELD_FLAG: True}, "completed", "   ")
        assert not should_release({HELD_FLAG: True}, "completed", None)

    def test_already_collected_is_not_told_their_coffee_is_ready(self):
        # Stale, and slightly insulting. At a break most people simply
        # walk up before the release happens.
        assert not should_release({HELD_FLAG: True}, "picked_up", "+61400000001")

    def test_not_yet_finished_is_not_told_either(self):
        for status in ("pending", "in-progress", "cancelled"):
            assert not should_release({HELD_FLAG: True}, status, "+61400000001")


class TestSummarise:
    def test_counts_what_the_button_is_about_to_do(self):
        # Pressing release without knowing it will send 87 texts is how
        # an event gets an unexpected bill.
        rows = [
            ({HELD_FLAG: True}, "completed", "+61400000001"),
            ({HELD_FLAG: True}, "completed", "+61400000002"),
            ({HELD_FLAG: True}, "completed", ""),
            ({HELD_FLAG: True}, "picked_up", "+61400000003"),
            ({}, "completed", "+61400000004"),
        ]
        assert summarise(rows) == {
            "held": 4,
            "will_send": 2,
            "no_phone": 1,
            "already_collected": 1,
        }

    def test_nothing_held_is_all_zeroes(self):
        assert summarise([])["held"] == 0
        assert summarise(None)["will_send"] == 0
