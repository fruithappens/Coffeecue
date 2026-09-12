"""Demand turned away becomes rows (finding 4)."""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from utils import refusals  # noqa: E402


class _Cur:
    def __init__(self, rows=None): self.calls = []; self.rows = rows or []
    def execute(self, sql, params=None): self.calls.append((sql, params))
    def fetchall(self): return self.rows


class _Db:
    def __init__(self, fail=False): self.cur = _Cur(); self.commits = 0; self.rollbacks = 0; self.fail = fail
    def cursor(self):
        if self.fail: raise RuntimeError('db down')
        return self.cur
    def commit(self): self.commits += 1
    def rollback(self): self.rollbacks += 1


class TestNote:
    def test_writes_one_row_with_no_personal_data(self):
        db = _Db()
        refusals.note_refusal(db, 'sms', 'no_milk', item='oat', drink='latte', milk='oat', message='Sorry, no oat')
        sql, params = db.cur.calls[0]
        assert 'INSERT INTO client_events' in sql
        assert params[0] == 'ORDER_REFUSED'
        payload = json.loads(params[1])
        assert payload == {'channel': 'sms', 'reason': 'no_milk', 'item': 'oat', 'drink': 'latte',
                           'milk': 'oat', 'message': 'Sorry, no oat'}
        assert 'phone' not in payload and 'name' not in payload
        assert db.commits == 1

    def test_unknown_reason_is_other_and_long_text_is_cut(self):
        db = _Db()
        refusals.note_refusal(db, 'kiosk', 'moon_phase', item='x' * 500)
        payload = json.loads(db.cur.calls[0][1][1])
        assert payload['reason'] == 'other' and len(payload['item']) == 80

    def test_never_raises_and_rolls_back(self):
        refusals.note_refusal(_Db(fail=True), 'sms', 'stock', item='medium cup')   # no exception
        db = _Db(); db.commit = lambda: (_ for _ in ()).throw(RuntimeError('commit failed'))
        refusals.note_refusal(db, 'sms', 'stock', item='medium cup')
        assert db.rollbacks == 1


class TestSummary:
    def test_groups_by_reason_and_item_across_channels(self):
        cur = _Cur(rows=[('no_milk', 'oat', 'sms', 5), ('no_milk', 'oat', 'kiosk', 2),
                         ('stock', 'chocolate powder', 'sms', 3), ('no_drink', 'chai', 'sms', 1)])
        s = refusals.summary(cur, 'd0', 'd1')
        assert s['total'] == 11
        assert s['by_channel'] == {'sms': 9, 'kiosk': 2}
        assert s['items'][0] == {'reason': 'no_milk', 'item': 'oat', 'count': 7}
        assert [i['item'] for i in s['items']] == ['oat', 'chocolate powder', 'chai']

    def test_empty_window(self):
        s = refusals.summary(_Cur(rows=[]), 'd0', 'd1')
        assert s == {'total': 0, 'items': [], 'by_channel': {}}

    def test_every_reason_has_a_label(self):
        assert set(refusals.REASONS) <= set(refusals.LABELS)


class TestCoffeeSystemHook:
    """_count_refusal on the order system: the last makeable() verdict feeds
    the row when no reason is passed, and the hook never raises."""

    def _sys(self):
        import types
        from services.coffee_system import CoffeeOrderSystem
        fake = types.SimpleNamespace(db=_Db(), _last_refusal=None)
        fake._count_refusal = types.MethodType(CoffeeOrderSystem._count_refusal, fake)
        return fake

    def test_uses_the_last_makeable_verdict(self):
        sysm = self._sys()
        sysm._last_refusal = {'reason': 'stock', 'item': 'chocolate powder'}
        sysm._count_refusal('kiosk', {'type': 'mocha', 'milk': 'full cream'}, message="Sorry, we can't make mocha")
        payload = json.loads(sysm.db.cur.calls[0][1][1])
        assert payload['reason'] == 'stock' and payload['item'] == 'chocolate powder'
        assert payload['channel'] == 'kiosk' and payload['drink'] == 'mocha'
        assert sysm._last_refusal is None          # consumed, not reused for the next order

    def test_explicit_reason_wins_and_bad_input_is_harmless(self):
        sysm = self._sys()
        sysm._count_refusal('sms', 'not a dict', reason='no_milk', item='oat')
        payload = json.loads(sysm.db.cur.calls[0][1][1])
        assert payload == {'channel': 'sms', 'reason': 'no_milk', 'item': 'oat', 'drink': '', 'milk': '', 'message': ''}
        sysm.db = _Db(fail=True)
        sysm._count_refusal('sms', {}, reason='no_milk', item='oat')   # no exception
