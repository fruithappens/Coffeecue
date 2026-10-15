"""A failed optional lookup in the parser must not break the rest of a text (15 Oct 2026)."""
from unittest.mock import MagicMock

from services import nlp


def test_missing_table_rolls_back_to_the_savepoint_and_is_remembered():
    nlp._MISSING_TABLES.clear()
    db = MagicMock()
    cur = db.cursor.return_value
    calls = []

    def execute(sql, *a):
        calls.append(sql.strip().split()[0:3])
        if "stock_items" in sql:
            raise Exception('relation "stock_items" does not exist')

    cur.execute.side_effect = execute
    assert nlp._optional_query(db, "SELECT name FROM stock_items") is None
    assert ["ROLLBACK", "TO", "SAVEPOINT"] in calls
    # Never asked again on this copy.
    calls.clear()
    assert nlp._optional_query(db, "SELECT name FROM stock_items") is None
    assert calls == []
    nlp._MISSING_TABLES.clear()


def test_rows_come_back_when_the_table_exists():
    nlp._MISSING_TABLES.clear()
    db = MagicMock()
    db.cursor.return_value.fetchall.return_value = [("latte",)]
    assert nlp._optional_query(db, "SELECT name FROM stock_items") == [("latte",)]
