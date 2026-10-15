"""A saved event carries its sponsor wall: loading it puts them back, and loading
an event without sponsors clears the previous event's."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.consolidated_api_routes as c  # noqa: E402

PNG = "data:image/png;base64,iVBORw0KGgo="


class CS:
    db = object()
    _event_name_cache = None


def run(preset):
    store = {}
    with patch.object(c, "_kv_put", side_effect=lambda db, k, v, merge=False: store.__setitem__(k, v)), \
         patch.object(c, "_kv_get", return_value={}):
        c._apply_event_extras(CS(), preset)
    return store


def test_saved_event_puts_its_sponsors_back():
    s = run({"_replace_look": True, "sponsors": {"enabled": True, "sponsors": [
        {"name": "CupQ", "image": PNG}, {"name": "No logo"}]}})
    wall = s["sponsor_ticker"]
    assert wall["enabled"] is True and [x["name"] for x in wall["sponsors"]] == ["CupQ"]


def test_loading_an_event_without_sponsors_clears_them():
    s = run({"_replace_look": True, "branding": {"event_name": "Virgin Australia Lounge"}})
    assert s["sponsor_ticker"]["sponsors"] == [] and s["sponsor_ticker"]["enabled"] is False


def test_quick_setup_by_hand_leaves_sponsors_alone():
    s = run({"branding": {"primaryColor": "#000000"}})
    assert "sponsor_ticker" not in s
