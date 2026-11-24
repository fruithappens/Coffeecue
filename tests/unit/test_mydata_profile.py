"""MYDATA reads like a person wrote it: a month, not a raw timestamp."""
from datetime import datetime
from types import SimpleNamespace

from services.coffee.commands import _month_year


def test_member_since_is_month_and_year():
    assert _month_year(datetime(2026, 11, 24, 13, 20, 21, 401809)) == "Nov 2026"
    assert _month_year("2026-11-24 13:20:21.401809") == "Nov 2026"
    assert _month_year("2026-11-24 13:20:21") == "Nov 2026"
    assert _month_year(None) == "Unknown"
    assert _month_year("sometime") == "sometime"


def _profile(milk):
    from services.coffee import commands

    fake = SimpleNamespace(
        system_name="CupQ",
        get_customer=lambda phone: {
            "name": "Sam",
            "preferred_drink": "latte",
            "preferred_milk": milk,
            "preferred_size": "small",
            "preferred_sugar": "no sugar",
            "total_orders": 2,
            "first_order_date": datetime(2026, 11, 24, 9, 0, 0, 5),
        },
    )
    mixin = next(
        c for c in vars(commands).values()
        if isinstance(c, type) and hasattr(c, "_handle_mydata_command")
    )
    return mixin._handle_mydata_command(fake, "+61400000000")


def test_profile_milk_reads_naturally():
    assert "Favorite: latte with full cream milk (small)" in _profile("full cream")
    assert "Favorite: latte with oat milk (small)" in _profile("oat milk")
    assert "Favorite: latte (small)" in _profile("no milk")
    assert "Member since: Nov 2026" in _profile("oat")
