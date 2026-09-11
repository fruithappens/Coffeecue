"""What an EventsAir badge QR might hold, reduced to lookups."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from routes.ea_survey_routes import badge_identifier_candidates as cands  # noqa: E402


def test_bare_contact_id():
    assert cands("6f1c2a9e-1234-4bcd-9e0f-abcdef012345") == ["6f1c2a9e-1234-4bcd-9e0f-abcdef012345"]


def test_bare_badge_number():
    assert cands("  10432 ") == ["10432"]


def test_url_with_cid_query():
    out = cands("https://cupq.app/my?cid=abc-123&e=treenet26")
    assert out[0] == "abc-123"
    assert "https://cupq.app/my?cid=abc-123&e=treenet26" in out


def test_url_with_contact_id_and_path_segment():
    out = cands("https://app.eventsair.com/badge/10432?contactId=xyz")
    assert out[:2] == ["xyz", "10432"]


def test_prefixed_forms():
    assert cands("CID: 998877")[:2] == ["CID: 998877", "998877"]
    assert cands("id=abc")[:2] == ["id=abc", "abc"]


def test_empty_and_oversized_yield_nothing():
    assert cands("") == []
    assert cands("x" * 600) == []


def test_never_raises_on_garbage():
    assert isinstance(cands(None), list)
    assert isinstance(cands(12345), list)
