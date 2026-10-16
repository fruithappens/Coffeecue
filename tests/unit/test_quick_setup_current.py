"""Quick Setup knows what is running: "Save current as template" saved the
form's café defaults instead, and a saved Virgin lost soy, small cups, hot
chocolate and chai (demo.cupq.app, 16 Oct 2026). Also: the cup sticker logo
switches with the event."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import routes.consolidated_api_routes as c  # noqa: E402

VIRGIN_ROWS = [("milk", "full cream"), ("milk", "soy"), ("milk", "lactose-free"),
               ("coffee", "house blend beans"), ("cups", "small"), ("cups", "medium"),
               ("sugar", "sugar"), ("drinks", "hot chocolate"), ("drinks", "chai latte"),
               ("drinks", "english breakfast tea"), ("drinks", "lavender tea")]


class Cur:
    def __init__(self, rows, vip):
        self.rows, self.vip, self._last = rows, vip, []

    def execute(self, sql, params=None):
        if "inventory_items" in sql:
            self._last = list(self.rows)
        elif "vip_code" in sql:
            self._last = [(self.vip,)] if self.vip is not None else []

    def fetchall(self):
        return self._last

    def fetchone(self):
        return self._last[0] if self._last else None


class DB:
    def __init__(self, rows, vip="VELOCITY"):
        self.cur = Cur(rows, vip)

    def cursor(self):
        return self.cur

    def rollback(self):
        pass


def current(rows, saved=None, vip="VELOCITY"):
    with patch.object(c, "_kv_get", return_value=saved):
        return c._qs_current(DB(rows, vip))


def test_current_reads_the_running_menu_not_the_cafe_defaults():
    preset, recorded = current(VIRGIN_ROWS, saved={"sweeteners": ["no sugar", "1 sugar"], "started_sms_policy": "queue_only"})
    assert recorded
    assert preset["milks"] == ["full cream", "soy", "lactose-free"]
    assert preset["sizes"] == ["small", "medium"]
    assert preset["drinks"]["hot_chocolate"] and preset["drinks"]["chai"] and not preset["drinks"]["matcha"]
    assert preset["teas"]["english_breakfast"] and not preset["teas"]["green"]
    assert preset["custom_teas"] == "lavender tea"
    assert preset["vip_code"] == "VELOCITY"
    # Things the inventory can't say come from what was last applied.
    assert preset["sweeteners"] == ["no sugar", "1 sugar"] and preset["started_sms_policy"] == "queue_only"


def test_a_fresh_server_says_it_has_nothing_recorded():
    preset, recorded = current([], saved=None, vip=None)
    assert not recorded and preset["milks"] == c.DEFAULT_QUICK_PRESET["milks"]


def test_the_event_password_and_the_look_are_never_remembered():
    store = {}
    with patch.object(c, "_kv_put", side_effect=lambda db, k, v, merge=False: store.__setitem__(k, v)):
        c._qs_remember(object(), {"milks": ["oat"], "event_password": "secret", "branding": {"logo": "x"},
                                  "sponsors": {}, "_replace_look": True})
    assert store[c.QS_CURRENT_KEY] == {"milks": ["oat"]}


def test_switching_events_clears_the_last_events_sticker_logo():
    store = {}
    with patch.object(c, "_kv_put", side_effect=lambda db, k, v, merge=False: store.__setitem__(k, v)), \
         patch.object(c, "_kv_get", return_value={"labelLogo": "data:image/png;base64,OLD", "smsNumber": "0489"}):
        c._apply_event_extras(type("CS", (), {"db": object(), "_event_name_cache": None})(),
                              {"_replace_look": True, "branding": {"eventName": "Virgin Australia Lounge"}})
    look = store["branding_settings"]
    assert "labelLogo" not in look and look["smsNumber"] == "0489" and look["eventName"] == "Virgin Australia Lounge"
