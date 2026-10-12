"""The go-live checklist: fresh copy red, set-up copy green, every red line has a fix link."""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.readiness_api as r  # noqa: E402


def _kv(store):
    return lambda db, key, default=None: store.get(key, default)


def test_fresh_copy_is_red_or_amber():
    store = {}
    with patch.object(r, "_kv_get", _kv(store)):
        assert r._check_branding(None)["status"] == "fail"
        assert r._check_quick_picks(None)["status"] == "warn"
        assert r._check_plan_tier(None)["status"] == "warn"


def test_set_up_copy_is_green():
    store = {
        "branding_settings": {"logo": "data:image/png;base64,AA", "headerColor": "#E10A0A"},
        "quick_picks": [{"drink": "latte"}],
        "plan_tier": "standard",
    }
    with patch.object(r, "_kv_get", _kv(store)):
        assert r._check_branding(None)["status"] == "ok"
        assert r._check_quick_picks(None)["status"] == "ok"
        assert r._check_plan_tier(None)["detail"] == "Plan: Flat White."


def test_half_branded_is_amber():
    with patch.object(r, "_kv_get", _kv({"branding_settings": {"logo": "x"}})):
        out = r._check_branding(None)
    assert out["status"] == "warn" and "header colour" in out["detail"]


def test_default_pin_is_red():
    with patch("utils.pins.event_pin_state",
               return_value={"pin": "1234", "is_default": True, "enabled": True}):
        assert r._check_device_pin(MagicMock())["status"] == "fail"
    with patch("utils.pins.event_pin_state",
               return_value={"pin": "4821", "is_default": False, "enabled": True}):
        assert r._check_device_pin(MagicMock())["status"] == "ok"
    with patch("utils.pins.event_pin_state",
               return_value={"pin": "1234", "is_default": True, "enabled": False}):
        assert r._check_device_pin(MagicMock())["status"] == "ok"


def test_test_order_reads_the_last_12_hours():
    db = MagicMock()
    db.cursor.return_value.fetchone.return_value = (0,)
    assert r._check_test_order(db)["status"] == "fail"
    db.cursor.return_value.fetchone.return_value = (3,)
    assert r._check_test_order(db)["status"] == "ok"


def test_fix_link_only_on_lines_that_need_fixing():
    red = r._with_fix({"name": "branding", "status": "fail"})
    assert red["fix"] == {"label": "Logo & look", "href": "/run#branding/logo"}
    green = r._with_fix({"name": "branding", "status": "ok"})
    assert "fix" not in green
    unknown = r._with_fix({"name": "migrations", "status": "fail"})
    assert "fix" not in unknown
