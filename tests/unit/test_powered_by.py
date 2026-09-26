"""'powered by CupQ' follows the plan tier: Lite/Standard show it, Pro/Urn are white-label."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from utils.plan_limits import shows_powered_by  # noqa: E402


class _Cursor:
    def __init__(self, tier, broken):
        self.tier, self.broken = tier, broken

    def execute(self, sql, params=None):
        if self.broken:
            raise RuntimeError("db down")

    def fetchone(self):
        return (self.tier,) if self.tier is not None else None

    def close(self):
        pass


class _DB:
    def __init__(self, tier=None, broken=False):
        self.tier, self.broken = tier, broken

    def cursor(self):
        return _Cursor(self.tier, self.broken)


def test_no_tier_shows_it_as_today():
    assert shows_powered_by(_DB(None)) is True


def test_lite_and_standard_show_it():
    assert shows_powered_by(_DB("lite")) is True
    assert shows_powered_by(_DB("standard")) is True


def test_pro_and_rental_are_white_label():
    assert shows_powered_by(_DB("pro")) is False
    assert shows_powered_by(_DB("urn")) is False


def test_unknown_tier_or_broken_read_shows_it():
    assert shows_powered_by(_DB("mystery")) is True
    assert shows_powered_by(_DB("pro", broken=True)) is True
