"""The server checks it can still serve a customer, and texts when it can't.

cupq.app's connection pool ran dry on 17 Oct 2026; /api/health (no database)
stayed green and nobody was texted for three days."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import services.service_watch as sw  # noqa: E402


def run(results):
    sw._self.update(fails=0, alerted=False)
    sent = []
    alert = lambda code, sev, msg: sent.append(code)  # noqa: E731
    hits = [sw.check_self(alert, probe=lambda r=r: r) for r in results]
    return sent, hits


def test_texts_after_three_failures_in_a_row_once():
    sent, _ = run([False, False, False, False, False])
    assert sent == ["SITE_DOWN"]


def test_a_blip_doesnt_text():
    sent, _ = run([False, False, True, False, False, True])
    assert sent == []


def test_says_when_it_is_back():
    sent, _ = run([False, False, False, True, True])
    assert sent == ["SITE_DOWN", "SITE_BACK"]


def test_fleet_watch_asks_for_a_page_that_needs_the_database():
    import services.fleet_watch as fw

    assert fw.PROBE_PATH == "/api/display/menu" and fw.TIMEOUT_S > 10
