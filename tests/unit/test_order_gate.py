from datetime import datetime

import pytest

from utils import order_gate as g


def at(h, m):
    return datetime(2026, 11, 27, h, m)


def test_unset_or_broken_means_open():
    assert g.read(None) == {"closed": False, "opens_at": ""}
    assert g.read({"closed": True, "opens_at": "half past ten"})["opens_at"] == ""
    assert g.view(g.read({"closed": True, "opens_at": "bad"}), at(10, 0)) is None


def test_closing_needs_a_time():
    with pytest.raises(ValueError):
        g.clean_for_save({"closed": True})
    assert g.clean_for_save({"closed": True, "opens_at": "9:05"}) == {"closed": True, "opens_at": "09:05"}
    # Opening keeps the last time so the barista can close again quickly.
    assert g.clean_for_save({"closed": False}, {"closed": True, "opens_at": "10:30"}) == {
        "closed": False, "opens_at": "10:30"}


def test_ready_time_counts_from_the_opening_not_from_now():
    cfg = g.read({"closed": True, "opens_at": "10:30"})
    v = g.view(cfg, at(10, 5), minutes_after_open=12)
    assert v == {"closed": True, "opens_label": "10:30am", "started": False, "ready_about": "10:42am"}


def test_past_the_opening_time_it_counts_from_now():
    cfg = g.read({"closed": True, "opens_at": "10:30"})
    v = g.view(cfg, at(10, 40), minutes_after_open=5)
    assert v["started"] is True and v["ready_about"] == "10:45am"


def test_open_gate_says_nothing():
    assert g.view(g.read({"closed": False, "opens_at": "10:30"}), at(10, 0), 5) is None


def test_minutes_are_uncapped_and_rounded_up():
    assert g.minutes_for_position(0, 150) == 3        # your own coffee
    assert g.minutes_for_position(29, 150) == 75      # the 30th pre-order
    assert g.minutes_for_position(0, 0) >= 1


def test_afternoon_clock():
    assert g.clock(at(13, 5)) == "1:05pm"
