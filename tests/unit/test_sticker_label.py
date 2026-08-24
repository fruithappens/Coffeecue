"""Branded stickers for plain house cups.

The properties that matter are about WASTE, not looks: a batch is paper
you cannot get back, so a sticker must never come out blank, must never
be silently longer than it needs, and a count must never be able to eat
a roll because someone typed an extra zero.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from services.label_printer import render_sticker  # noqa: E402

BRANDED = {
    "show_event_name": True,
    "event_name": "CTN26",
    "footer_text": "CupQ - cupq.com.au",
    "instructions_text": "Scan the code on the table to order",
    "min_height_dots": 380,
}


def _size(png):
    import io

    from PIL import Image

    return Image.open(io.BytesIO(png)).size


def test_a_branded_sticker_renders():
    w, h = _size(render_sticker({}, 440, BRANDED))
    assert w == 440
    assert h >= 380


def test_it_never_prints_a_blank_sticker():
    # No branding configured at all. Feeding out blank stock is the one
    # outcome worse than an ugly sticker.
    png = render_sticker({}, 440, {})
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(png)).convert("L")
    assert img.getextrema()[0] == 0, "sticker has no ink on it"


def test_the_headline_overrides_the_event_name():
    a = render_sticker({"headline": "STAFF CUP"}, 440, BRANDED)
    b = render_sticker({}, 440, BRANDED)
    assert a != b


def test_a_long_headline_cannot_run_off_the_sticker():
    w, _ = _size(render_sticker({"headline": "X" * 300}, 440, BRANDED))
    assert w == 440


def test_the_cutter_floor_is_respected():
    # Below the floor the cutter is unreliable, so a nearly-empty
    # sticker still comes out at full length rather than a stub.
    _, h = _size(render_sticker({}, 440, {"min_height_dots": 380}))
    assert h >= 380


def test_content_is_centred_when_the_sticker_is_padded():
    # Top-aligned content on a padded sticker reads as a printing fault
    # across a batch of three hundred. Check there is ink in the middle
    # band and clear stock at both ends.
    import io

    from PIL import Image

    img = Image.open(io.BytesIO(render_sticker({}, 440, BRANDED))).convert("L")
    h = img.height
    top = img.crop((0, 0, img.width, 12))
    bottom = img.crop((0, h - 12, img.width, h))
    middle = img.crop((0, h // 3, img.width, 2 * h // 3))
    assert top.getextrema()[0] == 255, "ink at the very top edge"
    assert bottom.getextrema()[0] == 255, "ink at the very bottom edge"
    assert middle.getextrema()[0] == 0, "nothing in the middle band"


def test_junk_options_do_not_raise():
    for junk in (None, {}, {"min_height_dots": "wide"}, {"event_name": None}):
        assert render_sticker({}, 440, junk)


def test_junk_payload_does_not_raise():
    for junk in (None, {}, {"headline": None}, {"headline": 7}):
        assert render_sticker(junk, 440, BRANDED)
