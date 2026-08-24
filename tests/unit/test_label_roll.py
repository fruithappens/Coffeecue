"""The label-roll estimate.

The point of these is that the number errs towards warning. A barista
sent to check a roll that turns out to be half full has lost thirty
seconds. A barista who runs out mid-peak has lost the queue.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.label_roll import (  # noqa: E402
    CRITICAL_AT,
    DEFAULT_ROLL_CAPACITY,
    DEFAULT_WARN_AT,
    assess,
    roll_for,
    set_roll,
)


class TestRollFor:
    def test_an_unconfigured_printer_gets_sensible_defaults(self):
        # Not "disabled". A silent no-warning state is the failure this
        # whole module exists to prevent.
        r = roll_for({}, 1)
        assert r["capacity"] == DEFAULT_ROLL_CAPACITY
        assert r["warn_at"] == DEFAULT_WARN_AT

    def test_reads_a_configured_printer(self):
        state = {
            "3": {"capacity": 1000, "warn_at": 100, "reset_at": "2026-08-24T09:00:00"}
        }
        r = roll_for(state, 3)
        assert r == {
            "capacity": 1000,
            "warn_at": 100,
            "reset_at": "2026-08-24T09:00:00",
        }

    def test_tolerates_an_int_key(self):
        assert roll_for({3: {"capacity": 900}}, 3)["capacity"] == 900

    def test_junk_falls_back_rather_than_raising(self):
        for state in (None, "nonsense", {"1": "not a dict"}, []):
            assert roll_for(state, 1)["capacity"] == DEFAULT_ROLL_CAPACITY

    def test_a_nonsense_capacity_falls_back(self):
        assert roll_for({"1": {"capacity": 0}}, 1)["capacity"] == DEFAULT_ROLL_CAPACITY
        assert roll_for({"1": {"capacity": -5}}, 1)["capacity"] == DEFAULT_ROLL_CAPACITY
        assert (
            roll_for({"1": {"capacity": "lots"}}, 1)["capacity"]
            == DEFAULT_ROLL_CAPACITY
        )


class TestAssess:
    def test_a_fresh_roll_is_fine(self):
        a = assess(500, 0)
        assert a["level"] == "ok"
        assert a["remaining"] == 500

    def test_warns_with_enough_runway_to_act(self):
        # The warning has to arrive while there is still time to change
        # the roll during a lull.
        a = assess(500, 500 - DEFAULT_WARN_AT)
        assert a["level"] == "low"
        assert "next break" in a["message"]

    def test_gets_urgent_near_the_end(self):
        a = assess(500, 500 - CRITICAL_AT)
        assert a["level"] == "critical"
        assert "now" in a["message"]

    def test_empty(self):
        assert assess(500, 500)["level"] == "empty"
        assert assess(500, 900)["level"] == "empty"

    def test_never_reports_a_negative_count(self):
        a = assess(500, 10000)
        assert a["remaining"] == 0
        assert a["percent_left"] == 0

    def test_the_language_is_approximate_on_purpose(self):
        # A jam wastes labels the system never sees; the number prompts a
        # look at the printer, it is not an audit.
        assert "About" in assess(500, 450)["message"]

    def test_survives_rubbish(self):
        assert assess(None, None)["capacity"] == DEFAULT_ROLL_CAPACITY
        assert assess("x", "y")["remaining"] == DEFAULT_ROLL_CAPACITY

    def test_a_custom_warn_threshold_is_respected(self):
        assert assess(1000, 800, warn_at=250)["level"] == "low"
        assert assess(1000, 700, warn_at=250)["level"] == "ok"


class TestSetRoll:
    def test_updates_one_printer_without_touching_others(self):
        state = {"1": {"capacity": 500}, "2": {"capacity": 900}}
        out = set_roll(state, 1, capacity=750)
        assert out["1"]["capacity"] == 750
        assert out["2"]["capacity"] == 900

    def test_does_not_mutate_the_caller(self):
        # It gets written back into a shared settings blob; quietly
        # editing the caller's copy is how two settings screens fight.
        state = {"1": {"capacity": 500}}
        set_roll(state, 1, capacity=750)
        assert state["1"]["capacity"] == 500

    def test_records_a_reset(self):
        out = set_roll({}, 1, reset_at="2026-08-24T09:00:00")
        assert out["1"]["reset_at"] == "2026-08-24T09:00:00"

    def test_partial_updates_keep_the_rest(self):
        state = set_roll({}, 1, capacity=800, warn_at=90)
        state = set_roll(state, 1, reset_at="now")
        assert state["1"] == {"capacity": 800, "warn_at": 90, "reset_at": "now"}
