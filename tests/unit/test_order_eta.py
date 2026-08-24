"""The waiting-time estimate shown on a customer's own phone.

These guard the properties that make the number safe to show. An
estimate that is optimistic, that counts below zero, or that claims
minute-level precision on a twenty-minute queue does more damage than
showing nothing at all.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.order_eta import (  # noqa: E402
    DEFAULT_SECONDS_PER_COFFEE,
    MAX_ETA_MINUTES,
    MIN_ETA_MINUTES,
    batch_key,
    describe,
    effective_coffee_count,
    estimate_minutes,
    seconds_per_coffee,
)


def latte(milk="full cream"):
    return {"type": "latte", "milk": milk}


class TestBatchKey:
    def test_milk_is_part_of_the_batch(self):
        # A chai brewed into oat cannot share a jug with one brewed into
        # full cream. The barista board groups on both, so this must too.
        assert batch_key({"type": "chai", "milk": "oat"}) != batch_key(
            {"type": "chai", "milk": "full cream"}
        )

    def test_same_drink_same_milk_batches(self):
        assert batch_key(latte()) == batch_key(latte())

    def test_survives_rubbish(self):
        assert batch_key(None) == ("", "")


class TestEffectiveCoffeeCount:
    def test_all_different_drinks_cost_full_price(self):
        four = [
            {"type": "latte", "milk": "oat"},
            {"type": "flat white", "milk": "full cream"},
            {"type": "mocha", "milk": "skim"},
            {"type": "long black", "milk": "no milk"},
        ]
        assert effective_coffee_count(four) == 4

    def test_identical_drinks_are_discounted(self):
        # Eight flat whites in one jug are not eight times one flat white.
        assert effective_coffee_count([latte()] * 4) < 4
        assert effective_coffee_count([latte()] * 4) > 1

    def test_empty_queue_is_zero(self):
        assert effective_coffee_count([]) == 0
        assert effective_coffee_count(None) == 0


class TestSecondsPerCoffee:
    def test_thin_sample_falls_back_to_the_default(self):
        assert seconds_per_coffee([1000, 1090]) == DEFAULT_SECONDS_PER_COFFEE
        assert seconds_per_coffee([]) == DEFAULT_SECONDS_PER_COFFEE

    def test_measures_a_real_working_pace(self):
        # Completions 90 seconds apart.
        assert seconds_per_coffee([0, 90, 180, 270, 360]) == 90

    def test_a_quiet_station_is_not_a_slow_one(self):
        # THE BUG THIS FUNCTION EXISTS TO AVOID. Three coffees across a
        # quiet half hour: two made back to back, then a long idle gap,
        # then one more. Dividing the window by the count gives 600s a
        # coffee and quotes the next customer 20+ minutes for a queue
        # that will clear in nine. Measuring the WORKING gaps gives 90.
        quiet = [0, 90, 1800, 1890]
        assert seconds_per_coffee(quiet) == 90

    def test_one_long_gap_does_not_drag_a_busy_stretch_out(self):
        # Median, not mean: the 500s gap is ignored in favour of the
        # typical one.
        assert seconds_per_coffee([0, 60, 120, 620, 680, 740]) <= 120

    def test_a_batch_marked_off_together_cannot_promise_instant_coffee(self):
        # Six completions in the same second would imply no pace at all.
        assert seconds_per_coffee([100, 100, 100, 100, 100, 100]) >= 45

    def test_survives_rubbish(self):
        assert seconds_per_coffee(None) == DEFAULT_SECONDS_PER_COFFEE
        assert seconds_per_coffee(["x", "y", "z"]) == DEFAULT_SECONDS_PER_COFFEE


class TestEstimateMinutes:
    def test_nothing_to_promise_once_it_is_made(self):
        for state in ("ready", "completed", "picked_up", "picked-up", "cancelled"):
            assert estimate_minutes(state) is None

    def test_on_the_bench_is_about_one_coffee_away(self):
        assert estimate_minutes("in-progress") == 3

    def test_a_longer_queue_means_a_longer_wait(self):
        short = estimate_minutes("pending", [latte()], 0)
        long_ = estimate_minutes(
            "pending", [latte("oat"), latte("skim"), latte("soy"), latte("almond")], 2
        )
        assert long_ > short

    def test_batching_shortens_the_estimate(self):
        # Same number of drinks ahead: four identical vs four different.
        same = estimate_minutes("pending", [latte()] * 4, 2)
        diff = estimate_minutes(
            "pending", [latte("oat"), latte("skim"), latte("soy"), latte("almond")], 2
        )
        assert same < diff

    def test_never_promises_less_than_a_minute(self):
        assert estimate_minutes("pending", [], 0) >= MIN_ETA_MINUTES

    def test_stops_at_the_ceiling_rather_than_quoting_47_minutes(self):
        assert (
            estimate_minutes("pending", [latte(str(i)) for i in range(60)], 20)
            == MAX_ETA_MINUTES
        )

    def test_rounds_up_because_early_is_better_than_late(self):
        # One coffee at 150s is 2.5 minutes, which must present as 3.
        assert estimate_minutes("in-progress", pace_seconds=150) == 3

    def test_survives_rubbish(self):
        assert estimate_minutes("pending", None, None) >= MIN_ETA_MINUTES
        assert estimate_minutes(None, [], 0) >= MIN_ETA_MINUTES


class TestDescribe:
    def test_nothing_to_say_when_there_is_no_estimate(self):
        assert describe(None) == ""

    def test_a_minute_reads_as_words_not_a_number(self):
        assert describe(1) == "about a minute"

    def test_normal_range(self):
        assert describe(7) == "about 7 min"

    def test_the_ceiling_stops_pretending_to_be_precise(self):
        assert describe(MAX_ETA_MINUTES) == f"{MAX_ETA_MINUTES}+ min"

    def test_never_negative(self):
        # The countdown must not run past zero; a negative would read as
        # broken and poison every other number on the page.
        assert "-" not in describe(0)
        assert describe(0) == "about a minute"
