"""Provenance: the closed channel vocabulary and the QR source code.

These guard the two properties reports depend on. First, that a channel
can only ever be one of five known values -- a sixth would silently
fragment every breakdown a client sees. Second, that a source code taken
off a QR link is squashed to something safe before it is stored, since
anyone can craft the URL.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.order_provenance import (  # noqa: E402
    CHANNELS,
    channel_label,
    infer_channel,
    is_estimated,
    normalize_channel,
    normalize_source,
    stamp,
)


class TestNormalizeChannel:
    def test_known_channels_pass_through(self):
        for name in CHANNELS:
            assert normalize_channel(name) == name

    def test_legacy_spellings_map_onto_the_vocabulary(self):
        # These are the markers already written to the database before
        # stamping existed; reports must not see them as new channels.
        assert normalize_channel("walkin") == "barista"
        assert normalize_channel("walk-in") == "barista"
        assert normalize_channel("ea_app") == "app"
        assert normalize_channel("eventsair") == "app"
        assert normalize_channel("qr") == "web"
        assert normalize_channel("touchscreen") == "kiosk"

    def test_case_and_padding_are_ignored(self):
        assert normalize_channel("  KIOSK ") == "kiosk"

    def test_unknown_is_none_not_a_new_channel(self):
        for junk in ("hackerman", "", None, 123, {"a": 1}):
            assert normalize_channel(junk) is None


class TestNormalizeSource:
    def test_slugifies_a_human_label(self):
        assert normalize_source("Cart 1  iPad!!") == "cart-1-ipad"
        assert normalize_source("Foyer Poster A") == "foyer-poster-a"

    def test_capped_so_a_crafted_qr_cannot_bloat_the_row(self):
        assert len(normalize_source("x" * 500)) == 32

    def test_junk_becomes_empty_rather_than_garbage(self):
        for junk in ("", None, "!!!", "---"):
            assert normalize_source(junk) == ""


class TestStamp:
    def test_records_channel_and_source(self):
        d = stamp({}, "web", "Foyer Poster")
        assert d["channel"] == "web"
        assert d["source_code"] == "foyer-poster"

    def test_refuses_to_invent_a_sixth_channel(self):
        d = stamp({}, "hackerman", "x")
        assert "channel" not in d

    def test_absent_source_is_not_stored_as_empty(self):
        assert "source_code" not in stamp({}, "sms")

    def test_survives_a_non_dict(self):
        assert stamp(None, "sms") is None


class TestInferChannel:
    def test_a_recorded_channel_wins_over_inference(self):
        assert infer_channel({"channel": "web", "order_type": "kiosk"}) == "web"

    def test_old_kiosk_marker(self):
        assert infer_channel({"order_type": "kiosk"}) == "kiosk"
        assert infer_channel({"created_by": "kiosk"}) == "kiosk"

    def test_old_walkin_and_app_markers(self):
        assert infer_channel({"source": "walkin"}) == "barista"
        assert infer_channel({"source": "ea_app"}) == "app"

    def test_unmarked_is_sms_because_sms_never_marked_itself(self):
        assert infer_channel({}) == "sms"
        assert infer_channel(None) == "sms"


class TestIsEstimated:
    def test_stamped_orders_are_measured(self):
        assert is_estimated(stamp({}, "kiosk")) is False

    def test_historical_orders_are_flagged_as_reconstruction(self):
        # A pre-stamping 'kiosk' may in truth have been a /my scan.
        # Reports must be able to say so.
        assert is_estimated({"order_type": "kiosk"}) is True
        assert is_estimated({}) is True


def test_channel_label_is_client_facing():
    assert channel_label("sms") == "SMS"
    assert channel_label("web") == "Own phone (QR)"
    assert channel_label("kiosk") == "On-site touchscreen"
