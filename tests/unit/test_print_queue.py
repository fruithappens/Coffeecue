"""Not printing yesterday's labels.

The failure being prevented is specific: a printer that was swapped out
or that never came back is plugged in later and prints a stack of labels
for coffees that were drunk days ago.

These take AGES IN SECONDS, not timestamps, and that is the point. The
first version compared created_at (a naive local-clock column) against
UTC. It passed its tests -- because the tests supplied both timestamps --
and did nothing at all on a non-UTC host. Ages come from SQL now, where
one clock answers both halves of the question.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.print_queue import (  # noqa: E402
    DEFAULT_STALE_SECONDS,
    is_stale,
    supersedes,
)

MIN = 60
HOUR = 60 * MIN


def test_a_fresh_job_is_never_stale():
    assert is_stale(30, 5) is False


def test_a_briefly_absent_printer_keeps_its_queue():
    # Venue wifi drops for five minutes. Those labels are still wanted.
    assert is_stale(40 * MIN, 5 * MIN) is False


def test_a_printer_that_never_came_back_loses_its_queue():
    # Steve's station 1: enabled, and last checked in two days ago.
    assert is_stale(3 * HOUR, 2 * 24 * HOUR) is True


def test_a_printer_that_has_never_polled_at_all():
    assert is_stale(3 * HOUR, None) is True


def test_a_new_job_for_a_never_polled_printer_is_still_given_a_chance():
    # A printer being set up for the first time should not have its first
    # label thrown away before it finishes connecting.
    assert is_stale(20, None) is False


def test_a_busy_printer_with_a_long_queue_is_not_stale():
    assert is_stale(2 * HOUR, 2) is False


def test_unreadable_ages_keep_the_label():
    # Throwing a barista's label away over a parse failure would be a
    # worse bug than the one this prevents.
    for junk in (None, "", "not a number", [], {}):
        assert is_stale(junk, 2 * 24 * HOUR) is False
    assert is_stale(3 * HOUR, "nonsense") is False


def test_decimals_from_sql_are_fine():
    # EXTRACT(EPOCH ...) comes back as a Decimal, not an int.
    from decimal import Decimal

    assert is_stale(Decimal("10800.5"), Decimal("172800.25")) is True


def test_the_window_is_generous_enough_to_be_safe():
    assert DEFAULT_STALE_SECONDS >= 15 * MIN


# --- superseding ------------------------------------------------------


def test_a_different_printer_supersedes():
    # The swap case: the station moved to a new printer, so the old job
    # is for a machine nobody is standing at.
    assert supersedes(7, 6) is True
    assert supersedes("7", 6) is True


def test_the_same_printer_does_NOT_supersede():
    # Pressing print twice on the same printer is asking for a second
    # copy, which is a real thing to want.
    assert supersedes(6, 6) is False
    assert supersedes("6", "6") is False


def test_missing_ids_never_supersede():
    assert supersedes(None, 6) is False
    assert supersedes(6, None) is False
