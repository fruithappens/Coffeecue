"""The "Texts off" switch (Text meter): an event run on phones and the board.

On, every automatic text is held -- with or without a cap -- and the
public display config says so and hands out no number to text. Texts a
person chose to send still go, as with the cap.
"""
import json
from unittest.mock import patch

from services import sms_meter


class _Cur:
    def __init__(self, store):
        self.store = store
        self.row = None

    def execute(self, sql, params=()):
        if "FROM settings" in sql:
            raw = self.store.get(params[0])
            self.row = (raw,) if raw is not None else None
        elif "INSERT INTO settings" in sql:
            self.store[params[0]] = params[1]
        elif "SUM(segments)" in sql:
            self.row = (0,)

    def fetchone(self):
        return self.row


class _Conn:
    def __init__(self, store):
        self.store = store

    def cursor(self):
        return _Cur(self.store)

    def commit(self):
        pass

    def rollback(self):
        pass


def _patched(store):
    return (
        patch.object(sms_meter, "_conn", lambda: _Conn(store)),
        patch.object(sms_meter, "_release", lambda c: None),
        patch.object(sms_meter, "_allowance", lambda c: None),
    )


def test_off_by_default_and_nothing_held():
    store = {}
    a, b, c = _patched(store)
    with a, b, c:
        assert sms_meter.texts_off() is False
        assert sms_meter.decide("ready", "Your coffee is ready") == (True, None)


def test_switch_holds_every_automatic_text_without_a_cap():
    store = {}
    a, b, c = _patched(store)
    with a, b, c:
        sms_meter.set_texts_off(True, by="test")
        assert json.loads(store["sms_meter"])["texts_off"] is True
        assert sms_meter.texts_off() is True
        for kind in ("ready", "started", "reminder", "confirmation", "broadcast"):
            ok, why = sms_meter.decide(kind, "x")
            assert ok is False and "texts are off" in why, kind


def test_person_chosen_texts_still_go():
    store = {"sms_meter": json.dumps({"texts_off": True})}
    a, b, c = _patched(store)
    with a, b, c:
        for kind in ("manual", "reply", "question_reply", "test"):
            assert sms_meter.decide(kind, "x") == (True, None), kind


def test_switch_keeps_the_cap_and_turns_back_on():
    store = {"sms_meter": json.dumps({"cap": 50})}
    a, b, c = _patched(store)
    with a, b, c:
        sms_meter.set_texts_off(True)
        sms_meter.set_texts_off(False)
        cfg = json.loads(store["sms_meter"])
        assert cfg == {"cap": 50, "texts_off": False}
        assert sms_meter.decide("ready", "x") == (True, None)


def test_a_broken_read_means_texts_stay_on():
    class Bad:
        def cursor(self):
            raise RuntimeError("db down")

    with patch.object(sms_meter, "_conn", Bad), patch.object(
        sms_meter, "_release", lambda c: None
    ):
        assert sms_meter.texts_off() is False
