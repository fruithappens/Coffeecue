"""Milk shapes for a one-ink printer.

The property that matters: every glyph must differ in SILHOUETTE, not in
detail. A label is read at arm's length on a cup someone is carrying,
and marks that differ only finely all read as a smudge.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.milk_glyph import (MILK_GLYPHS, enabled_for,  # noqa: E402
                              glyph_for, label_prefix, normalise,
                              stations_from)


def test_normalise_matches_what_the_database_holds():
    # It genuinely stores both spellings for the same milk.
    assert normalise("Oat Milk") == "oat"
    assert normalise("oat") == "oat"
    assert normalise("  Full Cream Milk ") == "full cream"


def test_every_milk_has_a_distinct_glyph():
    # Two milks sharing a shape is worse than neither having one.
    shapes = list(MILK_GLYPHS.values())
    assert len(shapes) == len(set(shapes))


def test_glyphs_are_ascii_only():
    # Railway has no system fonts; labels render through Pillow's
    # embedded face and a missing character prints as a box.
    for g in MILK_GLYPHS.values():
        assert g.isascii(), g


def test_no_milk_gets_nothing():
    # A symbol meaning "none" is a mark you must decode to learn there
    # is nothing to decode.
    for v in ("no milk", "none", "black", "", None):
        assert glyph_for(v) == ""


def test_an_unknown_milk_gets_nothing_rather_than_a_fallback():
    # A glyph meaning "some milk we have no symbol for" teaches the
    # barista to distrust all of them.
    assert glyph_for("unicorn") == ""
    assert glyph_for("oat beverage extra") == ""


def test_the_common_milks_are_covered():
    for m in ("full cream", "skim", "oat", "soy", "almond", "lactose free"):
        assert glyph_for(m), m


class TestLabelPrefix:
    def test_off_by_default(self):
        # A station running one milk gains nothing and loses the width.
        assert label_prefix("oat", enabled=False) == ""

    def test_on_prefixes_with_a_trailing_space(self):
        assert label_prefix("oat", enabled=True) == "[##] "

    def test_on_but_no_glyph_adds_nothing(self):
        assert label_prefix("no milk", enabled=True) == ""
        assert label_prefix("unicorn", enabled=True) == ""


# --- per-station resolution -------------------------------------------


def test_stations_from_accepts_the_usual_shapes():
    assert stations_from([1, 2]) == {1, 2}
    assert stations_from(["1", "2"]) == {1, 2}
    assert stations_from((3,)) == {3}
    assert stations_from({4}) == {4}


def test_junk_settings_mean_off_not_on():
    # A corrupted setting must not start printing marks nobody asked
    # for. Every one of these is OFF.
    for junk in (None, "", "1,2", 7, {"a": 1}, [None], ["x"], [[]]):
        assert stations_from(junk) == set()


def test_a_partly_junk_list_keeps_the_good_ids():
    assert stations_from([1, "x", None, "3"]) == {1, 3}


def test_enabled_only_for_listed_stations():
    opts = {"milk_symbol_stations": [2]}
    assert enabled_for(opts, 2) is True
    assert enabled_for(opts, "2") is True
    assert enabled_for(opts, 1) is False


def test_no_station_means_no_symbols():
    # An old queued job or a test label has no station_id; it must not
    # inherit some other station's choice.
    opts = {"milk_symbol_stations": [1, 2, 3]}
    assert enabled_for(opts, None) is False
    assert enabled_for(opts, "") is False
    assert enabled_for(opts, "left") is False


def test_missing_or_broken_options_mean_off():
    assert enabled_for(None, 1) is False
    assert enabled_for({}, 1) is False
    assert enabled_for({"milk_symbol_stations": "everything"}, 1) is False
