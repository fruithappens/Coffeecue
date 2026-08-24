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

from utils.milk_glyph import (  # noqa: E402
    MILK_GLYPHS,
    glyph_for,
    label_prefix,
    normalise,
)


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
