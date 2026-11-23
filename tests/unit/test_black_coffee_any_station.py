"""A black coffee needs no milk, so any station can make it.

Milk names are compared shortened ("oat milk" -> "oat"), and "no milk"
shortened is "no". The per-station check used to treat that "no" as a milk
the station must list, so a long black ordered from a station's own QR
code was moved to another station unless its menu listed "No milk".
"""
import json

from services.coffee_system import CoffeeOrderSystem  # noqa: F401  (loads the mixins in order)
from services.coffee.menu import MenuMixin
from utils.milk import BLACK_MILKS


class _Cur:
    def __init__(self, caps):
        self.caps = caps

    def execute(self, *a):
        pass

    def fetchone(self):
        return (json.dumps(self.caps),)


class _Db:
    def __init__(self, caps):
        self.caps = caps

    def cursor(self):
        return _Cur(self.caps)

    def rollback(self):
        pass


class _Sys(MenuMixin):
    def __init__(self, caps):
        self.db = _Db(caps)


FULL_CREAM_ONLY = {"milk_types": ["full cream", "skim"], "sizes": ["small", "large"]}


def test_black_is_makeable_at_a_station_without_no_milk_listed():
    s = _Sys(FULL_CREAM_ONLY)
    for milk in ("no milk", "No Milk", "none", "black", "", None):
        assert s._station_can_make(1, milk, "small"), milk


def test_a_real_milk_is_still_checked():
    s = _Sys(FULL_CREAM_ONLY)
    assert s._station_can_make(1, "full cream milk", "small")
    assert not s._station_can_make(1, "oat milk", "small")
    assert not s._station_can_make(1, "no milk", "huge")  # size still checked


def test_shortened_no_milk_is_black():
    assert "no milk".replace(" milk", "") in BLACK_MILKS
