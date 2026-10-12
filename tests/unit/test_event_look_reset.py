"""Loading a saved event replaces the look; running Quick Setup by hand keeps it.

Before: a saved event was merged over the current branding, so one saved
without a look (a menu-only event) left the previous event's logo, colours,
backgrounds and quick picks on every screen.
"""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.consolidated_api_routes as r  # noqa: E402

VIRGIN = {
    "logo": "data:image/svg+xml;base64,AAA", "eventName": "Virgin Australia Lounge",
    "event_name": "Virgin Australia Lounge", "headerColor": "#E10A0A",
    "background_portrait": "data:image/png;base64,BBB", "customMessage": "Welcome",
    # Not part of the look: must survive any load.
    "smsNumber": "+61489263333", "systemName": "CupQ",
}


def _run(preset, store):
    """_apply_event_extras against an in-memory settings store."""
    def kv_get(db, key, default=None):
        return store.get(key, default)

    def kv_put(db, key, value, merge=False):
        if merge and isinstance(store.get(key), dict):
            store[key] = {**store[key], **value}
        else:
            store[key] = value

    cs = MagicMock()
    with patch.object(r, "_kv_get", kv_get), patch.object(r, "_kv_put", kv_put):
        r._apply_event_extras(cs, preset)
    return store


def test_menu_only_saved_event_resets_the_look():
    store = {"branding_settings": dict(VIRGIN), "display_bg_video": {"portrait": "x.mp4"},
             "quick_picks": [{"drink": "latte"}]}
    _run({"_replace_look": True}, store)
    b = store["branding_settings"]
    for k in ("logo", "eventName", "event_name", "headerColor", "background_portrait", "customMessage"):
        assert k not in b, k
    assert b["smsNumber"] == "+61489263333"
    assert b["systemName"] == "CupQ"
    assert store["display_bg_video"] == {}
    assert store["quick_picks"] == []


def test_saved_event_with_a_look_replaces_not_merges():
    store = {"branding_settings": dict(VIRGIN)}
    cafe = {"event_name": "Hills Cafe", "headerColor": "#123456"}
    _run({"_replace_look": True, "branding": cafe,
          "quick_picks": [{"drink": "flat white", "milk": "oat", "size": "medium", "label": "Oat FW"}]}, store)
    b = store["branding_settings"]
    assert b["event_name"] == "Hills Cafe"
    assert b["headerColor"] == "#123456"
    assert "logo" not in b and "background_portrait" not in b  # Virgin's, gone
    assert b["smsNumber"] == "+61489263333"
    assert [p["drink"] for p in store["quick_picks"]] == ["flat white"]


def test_quick_setup_by_hand_keeps_the_look():
    # No _replace_look: adding a milk mid-event must not wipe the branding.
    store = {"branding_settings": dict(VIRGIN), "quick_picks": [{"drink": "latte"}]}
    _run({}, store)
    assert store["branding_settings"] == VIRGIN
    assert store["quick_picks"] == [{"drink": "latte"}]
