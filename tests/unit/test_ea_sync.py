"""The attendee mirror refresh, shared by the Sync button and the auto-sync loop."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))


class _Cur:
    def __init__(self): self.sql = ''
    def execute(self, sql, params=None): self.sql = sql
    def fetchone(self):
        if 'mobile_e164 IS NOT NULL' in self.sql: return (3,)
        if 'coffee_pref' in self.sql: return (1,)
        return (0,)
    rowcount = 0


class _Db:
    def __init__(self): self.cur = _Cur(); self.commits = 0
    def cursor(self): return self.cur
    def commit(self): self.commits += 1


class _Client:
    """Two pages: 200 then 5 -- the loop must ask twice and stop."""
    event_id = 'EV1'
    def __init__(self, fail_at=None): self.calls = []; self.fail_at = fail_at
    def is_stub(self): return False
    def fetch_contacts_page(self, event_id, skip=0, take=200):
        self.calls.append(skip)
        if self.fail_at is not None and skip == self.fail_at:
            return False, 'boom'
        n = 200 if skip == 0 else 5
        return True, {'event': {'contactsPaged': {'items': [{'id': f'c{skip + i}', 'firstName': 'A'} for i in range(n)]}}}


def test_sync_pages_until_a_short_page_and_counts(monkeypatch):
    from routes import ea_survey_routes as ea
    seen = []
    monkeypatch.setattr(ea, '_upsert_attendee', lambda db, contact, hint: seen.append(contact['id']))
    client = _Client()
    ok, result = ea.sync_attendees(_Db(), {'coffee_field_hint': None}, client, 'EV1')
    assert ok and result == {'synced': 205, 'purged': 0, 'with_mobile': 3, 'with_coffee_pref': 1}
    assert client.calls == [0, 200] and len(seen) == 205


def test_a_failed_page_reports_where_and_how_many(monkeypatch):
    from routes import ea_survey_routes as ea
    monkeypatch.setattr(ea, '_upsert_attendee', lambda db, contact, hint: None)
    ok, result = ea.sync_attendees(_Db(), {}, _Client(fail_at=200), 'EV1')
    assert not ok and result['synced'] == 200 and 'skip=200' in result['message']


def test_auto_sync_respects_zero(monkeypatch):
    from routes import ea_survey_routes as ea
    monkeypatch.setenv('EA_SYNC_MINUTES', '0')
    assert ea.start_attendee_auto_sync(None) is None


class TestLiveRefresh:
    """One contact refreshed from EA when the mirror copy is stale."""

    class _Cur:
        def __init__(self, age): self.age = age; self.sql = ''; self.params = None; self.writes = []
        def execute(self, sql, params=None):
            self.sql = sql; self.params = params
            if 'INSERT INTO ea_attendees' in sql: self.writes.append(params)
        def fetchone(self):
            return (self.age,) if self.age is not None else None

    class _Db:
        def __init__(self, age): self.cur = TestLiveRefresh._Cur(age); self.commits = 0
        def cursor(self): return self.cur
        def commit(self): self.commits += 1
        def rollback(self): pass

    def _client(self, contact):
        class C:
            def is_stub(self): return False
            event_id = 'EV1'
            def fetch_contact(self, cid, ea_event_id=None): return (True, {'event': {'contact': contact}}) if contact else (False, 'nope')
        return C()

    def test_fresh_copy_is_left_alone(self, monkeypatch):
        from routes import ea_survey_routes as ea
        monkeypatch.setattr(ea, '_ea_row', lambda db: {'ea_event_id': 'EV1'})
        monkeypatch.setattr(ea, '_client', lambda db: self._client({'id': 'X'}))
        db = self._Db(age=30)
        assert ea._refresh_contact_if_stale(db, 'X') is False and db.commits == 0

    def test_stale_copy_is_refreshed_with_name_and_number_only(self, monkeypatch):
        from routes import ea_survey_routes as ea
        monkeypatch.setattr(ea, '_ea_row', lambda db: {'ea_event_id': 'EV1'})
        monkeypatch.setattr(ea, '_client', lambda db: self._client({
            'id': 'X', 'internalNumber': 330, 'firstName': 'Steve', 'lastName': 'R',
            'contactPhoneNumbers': {'mobile': '0412693279', 'inCountryMobile': None}, 'primaryEmail': 's@x'}))
        db = self._Db(age=900)
        assert ea._refresh_contact_if_stale(db, 'X') is True and db.commits == 1
        sql = db.cur.sql
        assert 'COALESCE(EXCLUDED.mobile_e164' in sql and 'registration_category' not in sql
        assert db.cur.writes[0][4] == '+61412693279'

    def test_missing_copy_and_ea_failure_are_quiet(self, monkeypatch):
        from routes import ea_survey_routes as ea
        monkeypatch.setattr(ea, '_ea_row', lambda db: {'ea_event_id': 'EV1'})
        monkeypatch.setattr(ea, '_client', lambda db: self._client(None))
        db = self._Db(age=None)
        assert ea._refresh_contact_if_stale(db, 'X') is False
