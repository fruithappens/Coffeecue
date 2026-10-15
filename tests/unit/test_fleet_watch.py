"""Live watching the other copies: when it texts, and the 'back' message."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import fleet_watch as fw  # noqa: E402


def run(up):
    sent = []
    raised = fw.check(None, lambda code, sev, msg: sent.append(code), probe=lambda url: up)
    return [c for c, _m in raised]


def test_two_misses_then_back():
    fw._fails.clear(); fw._alerted.clear()
    env = {"FLEET_COPIES": '[{"name": "Demo", "url": "https://demo.cupq.app"}, {"name": "Me", "url": "https://cupq.app"}]',
           "PUBLIC_BASE_URL": "https://cupq.app"}
    with patch.dict(os.environ, env):
        assert run(False) == []                                 # one miss: quiet
        assert run(False) == ["COPY_DOWN_demo.cupq.app"]        # two: text (never watches itself)
        assert run(True) == ["COPY_BACK_demo.cupq.app"]          # back: say so
        assert run(True) == []


def test_bad_addresses_are_never_probed():
    fw._fails.clear(); fw._alerted.clear()
    probed = []
    with patch.dict(os.environ, {"FLEET_COPIES": '[{"url": "https://169.254.169.254"}, {"url": "http://demo.cupq.app"}]',
                                 "PUBLIC_BASE_URL": ""}):
        fw.check(None, lambda *a: None, probe=lambda url: probed.append(url) or True)
    assert probed == []
