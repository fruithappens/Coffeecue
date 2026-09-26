"""Quick picks: cleaning what the Runner saved, and checking it against the live menu."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from utils.quick_picks import MAX_PICKS, normalize_picks, resolve_picks  # noqa: E402

MENU = {
    "coffee_types": [
        {"name": "Cappuccino", "value": "cappuccino", "stations": [1]},
        {"name": "Flat White", "value": "flat white", "stations": [1]},
        {"name": "Latte", "value": "latte", "stations": [1]},
        {"name": "Long Black", "value": "long black", "stations": [1]},
        {"name": "Mocha", "value": "mocha", "stations": []},
    ],
    "milks": [
        {"name": "Full Cream", "value": "full cream", "stations": [1]},
        {"name": "Skim", "value": "skim", "stations": [1]},
        {"name": "Oat", "value": "oat", "stations": [], "unavailable": True},
    ],
    "sizes": [
        {"name": "Regular", "value": "regular", "stations": [1]},
        {"name": "Large", "value": "large", "stations": [1]},
    ],
}


def test_garbage_in_is_empty_list():
    assert normalize_picks(None) == []
    assert normalize_picks("flat white") == []
    assert normalize_picks([1, "x", None, {"milk": "skim"}]) == []


def test_normalize_cleans_folds_and_dedupes():
    out = normalize_picks(
        [
            {"drink": "  Flat   White ", "milk": "Full Cream Milk", "size": "Regular"},
            {"drink": "flat white", "milk": "full cream", "size": "regular"},
            {"drink": "Long Black", "milk": "none"},
        ]
    )
    assert out == [
        {"drink": "flat white", "milk": "full cream", "size": "regular", "label": ""},
        {"drink": "long black", "milk": "", "size": "", "label": ""},
    ]


def test_normalize_caps_the_list():
    raw = [{"drink": f"drink {i}"} for i in range(MAX_PICKS + 4)]
    assert len(normalize_picks(raw)) == MAX_PICKS


def test_resolve_uses_menu_values_and_builds_label():
    out = resolve_picks([{"drink": "Flat White", "milk": "Full Cream"}], MENU)
    assert out == [
        {
            "drink": "flat white",
            "drink_name": "Flat White",
            "milk": "full cream",
            "milk_name": "Full Cream",
            "size": "regular",
            "label": "Flat White · Full Cream",
        }
    ]


def test_resolve_keeps_custom_label_and_size():
    out = resolve_picks(
        [{"drink": "latte", "milk": "skim", "size": "large", "label": "The usual"}],
        MENU,
    )
    assert out[0]["label"] == "The usual"
    assert out[0]["size"] == "large"


def test_resolve_drops_what_cannot_be_made_today():
    out = resolve_picks(
        [
            {"drink": "mocha", "milk": "full cream"},  # no station makes it
            {"drink": "latte", "milk": "oat"},  # milk switched off
            {"drink": "hot chocolate"},  # not on the menu
            {"drink": "cappuccino", "milk": "almond"},  # milk not on the menu
            {"drink": "long black"},  # black: fine
        ],
        MENU,
    )
    assert [p["drink"] for p in out] == ["long black"]
    assert out[0]["milk"] == "" and out[0]["label"] == "Long Black"


def test_retired_size_falls_back_to_default_cup():
    out = resolve_picks([{"drink": "latte", "milk": "skim", "size": "small"}], MENU)
    assert out[0]["size"] == "regular"


def test_empty_menu_resolves_nothing():
    assert resolve_picks([{"drink": "latte"}], {}) == []
    assert resolve_picks([{"drink": "latte"}], None) == []
