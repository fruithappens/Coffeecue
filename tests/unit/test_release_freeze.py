"""Event freeze (S1-4): frozen by the switch or by live orders, never by default."""
from unittest.mock import MagicMock, patch

import routes.release_freeze_routes as rf


def _db(recent_order):
    db = MagicMock()
    db.cursor.return_value.fetchone.return_value = (1,) if recent_order else None
    return db


def test_quiet_and_switch_off_is_not_frozen():
    with patch.object(rf, "_switch", return_value={}):
        assert rf.freeze_state(_db(False))["frozen"] is False


def test_switch_on_freezes():
    with patch.object(rf, "_switch", return_value={"on": True}):
        st = rf.freeze_state(_db(False))
    assert st["frozen"] is True and "organiser" in st["reason"]


def test_orders_coming_in_freeze_it_by_itself():
    with patch.object(rf, "_switch", return_value={"on": False}):
        st = rf.freeze_state(_db(True))
    assert st["frozen"] is True and "30 minutes" in st["reason"]
