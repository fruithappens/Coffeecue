"""One name per milk in the SMS bot's milk list (MENU, refusals, the stock gate).

inventory_items holds a row per station plus the event-level row, each with
its own spelling. The list used to be those spellings as-is -- "almond,
almond milk, almond milk, coconut milk, full cream, full cream milk" -- and
the stock gate compared the event menu's "oat" against a stock row called
"oat milk", so a stocked-out milk was still offered.
"""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services.coffee_system import (  # noqa: E402
    CoffeeOrderSystem,
    _milk_key,
    _unique_milk_keys,
)


def test_milk_key():
    assert _milk_key("Oat Milk") == "oat"
    assert _milk_key("oat") == "oat"
    assert _milk_key("Full Cream Milk") == "full cream"
    assert _milk_key("  full   cream  ") == "full cream"
    assert _milk_key("Lactose-Free Milk") == "lactose-free"
    assert _milk_key("coconut milk") == "coconut"
    # Never a phantom milk called "no".
    assert _milk_key("no milk") == ""
    assert _milk_key("None") == ""
    assert _milk_key("") == ""
    assert _milk_key(None) == ""


def test_unique_keeps_first_order_and_drops_blanks():
    names = ["almond", "Almond Milk", "almond milk", "Coconut Milk",
             "full cream", "Full Cream Milk", "no milk", "Oat Milk", "oat"]
    assert _unique_milk_keys(names) == ["almond", "coconut", "full cream", "oat"]


def _system(stock_rows, event_milks, tracked):
    cs = object.__new__(CoffeeOrderSystem)
    cur = MagicMock()
    cur.fetchall.return_value = [(n,) for n in stock_rows]
    cs.db = MagicMock(closed=0)
    cs.db.cursor.return_value = cur
    cs._is_unlimited_stock_mode = lambda: False
    cs._ensure_inventory_quantity_columns = lambda *a, **k: None
    cs._event_enabled = lambda cat: event_milks
    cs._all_tracked_milk_names = lambda: tracked
    cs._milk_is_makeable = lambda m: True
    return cs


@patch("services.recipes.get_overrides", return_value={})
def test_inventory_spellings_collapse(_ov):
    # No event menu: the list is the stock table, one entry per milk.
    cs = _system(
        ["almond", "Almond Milk", "almond milk", "Coconut Milk", "full cream", "Full Cream Milk"],
        event_milks=None, tracked=[])
    assert cs._get_available_milk_types() == ["almond", "coconut", "full cream"]


@patch("services.recipes.get_overrides", return_value={})
def test_stocked_out_menu_milk_is_hidden_across_spellings(_ov):
    # The event menu says oat and almond. Oat's only stock rows ("Oat Milk")
    # are at zero, so the stock query returned just almond's rows. Oat is
    # tracked (it has rows), so it must be hidden -- before, "oat" never
    # matched "oat milk" and slipped through as "untracked".
    cs = _system(["Almond Milk"], event_milks=["oat", "almond"],
                 tracked=["oat milk", "almond milk"])
    assert cs._get_available_milk_types() == ["almond"]


@patch("services.recipes.get_overrides", return_value={})
def test_untracked_menu_milk_still_passes(_ov):
    # A menu milk with no stock row at all constrains nothing (unchanged rule).
    cs = _system(["Almond Milk"], event_milks=["almond", "macadamia"],
                 tracked=["almond milk"])
    assert cs._get_available_milk_types() == ["almond", "macadamia"]


@patch("services.recipes.get_overrides", return_value={("milk", "Oat Milk"): "86"})
def test_86d_milk_is_hidden_whatever_its_spelling(_ov):
    cs = _system(["Oat Milk", "oat", "Skim Milk"], event_milks=None, tracked=[])
    assert cs._get_available_milk_types() == ["skim"]
