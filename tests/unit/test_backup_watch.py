"""The backup check-in: when it texts, how often, and who may check in."""

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from flask import Flask

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import backup_watch as bw  # noqa: E402


class Cur:
    def __init__(self, at=None):
        self.value = json.dumps({"at": at.isoformat(), "kind": "nightly", "bytes": 15_000_000}) if at else None

    def execute(self, *a):
        pass

    def fetchone(self):
        return (self.value,) if self.value else None


def run(cur, now):
    sent = []
    hit = bw.check(cur, lambda code, sev, msg: sent.append((code, msg)), now=now)
    return hit, sent


def test_quiet_without_token_or_when_fresh():
    bw._last_alert["at"] = 0.0
    with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": ""}):
        assert run(Cur(None), 1000) == (None, [])
    with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": "t"}):
        fresh = datetime.now(timezone.utc) - timedelta(hours=3)
        assert run(Cur(fresh), 1000) == (None, [])


def test_stale_texts_then_waits_six_hours():
    bw._last_alert["at"] = 0.0
    old = datetime.now(timezone.utc) - timedelta(hours=30)
    with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": "t"}):
        hit, sent = run(Cur(old), 10_000)
        assert hit[0] == "BACKUP_MISSED" and "30 hours" in sent[0][1]
        assert run(Cur(old), 10_000 + 3600) == (None, [])           # an hour later: quiet
        assert run(Cur(old), 10_000 + 6 * 3600 + 1)[0] is not None  # six hours later: again
        # A good backup resets it, so the next miss texts straight away.
        run(Cur(datetime.now(timezone.utc)), 50_000)
        assert run(Cur(old), 50_001)[0] is not None


def test_never_backed_up_says_so():
    bw._last_alert["at"] = 0.0
    with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": "t"}):
        _hit, sent = run(Cur(None), 1)
    assert "ever" in sent[0][1]


def test_heartbeat_needs_the_token():
    import routes.backup_routes as br

    app = Flask(__name__)
    app.register_blueprint(br.bp)
    with patch.object(br.limiter, "limit", lambda *a, **k: (lambda f: f)):
        c = app.test_client()
        with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": ""}):
            assert c.post("/api/public/backup-heartbeat").status_code == 404
        with patch.dict(os.environ, {"BACKUP_HEARTBEAT_TOKEN": "s3cret"}):
            assert c.post("/api/public/backup-heartbeat", headers={"Authorization": "Bearer nope"}).status_code == 401
            with patch.object(bw, "record", return_value={"at": "x"}) as rec, \
                 patch("utils.database.get_db_connection", return_value=object()), \
                 patch("utils.database.close_connection"):
                r = c.post("/api/public/backup-heartbeat", headers={"Authorization": "Bearer s3cret"},
                           json={"kind": "hourly", "bytes": 123})
            assert r.status_code == 200 and rec.call_args[0][1:] == ("hourly", 123)
