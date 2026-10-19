"""Service watch: alert on a silent printer or failing texts, only during service."""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest  # noqa: E402

import services.service_watch as sw  # noqa: E402


@pytest.fixture(autouse=True)
def _no_printers_remembered():
    sw._offline_alerted.clear()
    yield
    sw._offline_alerted.clear()


def _conn(in_service, printers):
    conn = MagicMock()
    cur = conn.cursor.return_value
    # in_service() -> fetchone; silent_printers() -> fetchall
    cur.fetchone.return_value = (1,) if in_service else None
    cur.fetchall.return_value = printers
    return conn


def _run(conn, ms=None, snap=None):
    sent = []
    app = MagicMock()
    app.config.get.return_value = ms
    with patch.object(sw, "_connect", return_value=conn), \
         patch.object(sw, "site_answers", return_value=True), \
         patch("services.sms_health.snapshot", return_value=snap or {}):
        sw.check_once(app, alert=lambda code, sev, msg: sent.append((code, sev, msg)))
    return sent


def test_silent_printer_during_service_alerts_once_per_printer():
    sent = _run(_conn(True, [(3, "Station 1 printer", 420)]))
    assert [(c, s) for c, s, _ in sent] == [("PRINTER_OFFLINE_3", "critical")]
    assert "Station 1 printer" in sent[0][2] and "7 min" in sent[0][2]


def test_nothing_overnight():
    # No order in the last 30 minutes: a printer switched off at night is fine.
    assert _run(_conn(False, [(3, "Station 1 printer", 40000)])) == []


def test_texts_down_alerts_when_live():
    ms = MagicMock(testing_mode=False)
    sent = _run(_conn(False, []), ms=ms, snap={"outbound_down": True, "problems": ["Twilio rejected 5 sends."]})
    assert sent and sent[0][0] == "SMS_OUTBOUND_DOWN" and "Twilio rejected" in sent[0][2]


def test_texts_ignored_in_testing_mode():
    ms = MagicMock(testing_mode=True)
    assert _run(_conn(False, []), ms=ms, snap={"outbound_down": True}) == []


def test_printer_back_after_an_outage_says_so_once():
    sw._offline_alerted.clear()
    _run(_conn(True, [(3, "Station 1 printer", 420)]))
    assert sw._offline_alerted == {3: "Station 1 printer"}
    # Next pass: no longer silent, and it has checked in recently.
    conn = MagicMock()
    cur = conn.cursor.return_value
    cur.fetchone.return_value = (1,)
    cur.fetchall.side_effect = [[], [(3,)]]  # silent_printers, back_online
    sent = _run(conn)
    assert [(c, s) for c, s, _ in sent] == [("PRINTER_BACK_3", "critical")]
    assert "back" in sent[0][2] and sw._offline_alerted == {}
