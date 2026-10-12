"""Scheduled erase: off by default, every step dated, the counts kept."""

import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import retention  # noqa: E402


def test_off_by_default_does_nothing():
    conn = MagicMock()
    cur = conn.cursor.return_value
    cur.fetchone.return_value = None  # no setting row
    assert retention.run(conn) == []
    executed = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "UPDATE" not in executed and "DELETE" not in executed


def test_every_step_is_limited_by_the_cutoff():
    for what, sql in retention.STEPS:
        assert "%(cutoff)s" in sql, what


def test_counts_are_kept():
    sql = " ".join(s for _, s in retention.STEPS)
    assert "DELETE FROM orders" not in sql
    assert "DELETE FROM feedback" not in sql
    assert "DELETE FROM sms_outbound_log" not in sql
    assert "phone = NULL" not in sql  # NOT NULL columns are blanked
