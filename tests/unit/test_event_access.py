"""Event codes on ordering links.

The overriding property: this must never be the reason an event cannot
take orders. Every ambiguous case fails OPEN, because a system that
quietly stops accepting coffee is a worse outage than the stray order it
was trying to prevent.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from utils.event_access import (  # noqa: E402
    WRONG_EVENT_MESSAGE,
    check,
    normalize_code,
    read_settings,
    stamp_link,
)


class TestNormalizeCode:
    def test_survives_being_typed_by_hand(self):
        assert normalize_code("  CTN26  ") == "ctn26"
        assert normalize_code("ANZCA Spring 2026") == "anzca-spring-2026"
        assert normalize_code("ctn_26") == "ctn-26"

    def test_junk_is_empty(self):
        for v in (None, "", "!!!", "---"):
            assert normalize_code(v) == ""

    def test_capped(self):
        assert len(normalize_code("x" * 200)) == 32


class TestReadSettings:
    def test_unconfigured_does_not_require_a_code(self):
        # An event that never set this up must keep taking orders.
        assert read_settings(None) == {"code": "", "require": False}
        assert read_settings({}) == {"code": "", "require": False}

    def test_reads_a_configured_event(self):
        assert read_settings({"code": "CTN26", "require": True}) == {
            "code": "ctn26",
            "require": True,
        }

    def test_junk_falls_back(self):
        assert read_settings("nonsense")["require"] is False


class TestCheck:
    def test_open_event_accepts_anything(self):
        allowed, msg = check({"code": "ctn26", "require": False}, None)
        assert allowed and msg == ""
        assert check({"code": "ctn26", "require": False}, "whatever")[0]

    def test_matching_code_is_let_through(self):
        assert check({"code": "ctn26", "require": True}, "CTN26")[0]
        assert check({"code": "ctn26", "require": True}, " ctn26 ")[0]

    def test_a_code_from_another_event_is_refused(self):
        # The whole point: a poster photographed weeks ago.
        allowed, msg = check({"code": "spring27", "require": True}, "ctn26")
        assert not allowed
        assert msg == WRONG_EVENT_MESSAGE

    def test_no_code_at_all_is_refused_when_required(self):
        allowed, msg = check({"code": "spring27", "require": True}, None)
        assert not allowed
        assert "different event" in msg

    def test_required_but_never_configured_fails_OPEN(self):
        # A misconfiguration must not take ordering down. This is the
        # single most important case in this file.
        assert check({"code": "", "require": True}, None)[0] is True
        assert check({"require": True}, "anything")[0] is True

    def test_a_broken_settings_blob_fails_open(self):
        for junk in (None, "nonsense", [], 42):
            assert check(junk, None)[0] is True

    def test_the_refusal_tells_them_what_to_do_next(self):
        # A dead end with no instruction just sends someone to the
        # counter annoyed.
        _, msg = check({"code": "a", "require": True}, "b")
        assert "scan the QR code here" in msg or "counter" in msg


class TestStampLink:
    def test_adds_the_code(self):
        assert stamp_link("https://x/order", "CTN26") == "https://x/order?e=ctn26"

    def test_keeps_an_existing_query(self):
        assert (
            stamp_link("https://x/order?station=1", "ctn26")
            == "https://x/order?station=1&e=ctn26"
        )

    def test_no_code_leaves_the_link_alone(self):
        assert stamp_link("https://x/order", "") == "https://x/order"
        assert stamp_link("https://x/order", None) == "https://x/order"
