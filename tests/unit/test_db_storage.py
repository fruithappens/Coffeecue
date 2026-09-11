"""The database meter: thresholds, wording, and a probe that never raises."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from services import db_storage as ds  # noqa: E402

MB = 1048576


class TestStatus:
    def test_thresholds_are_sixty_and_eighty_percent(self):
        assert ds.status_of({'db_bytes': 1, 'used_pct': 25.9}) == 'ok'
        assert ds.status_of({'db_bytes': 1, 'used_pct': 59.9}) == 'ok'
        assert ds.status_of({'db_bytes': 1, 'used_pct': 60.0}) == 'warn'
        assert ds.status_of({'db_bytes': 1, 'used_pct': 79.9}) == 'warn'
        assert ds.status_of({'db_bytes': 1, 'used_pct': 80.0}) == 'fail'

    def test_unmeasured_is_a_warning_not_a_green_light(self):
        assert ds.status_of({'db_bytes': None, 'used_pct': None}) == 'warn'


class TestDetail:
    def test_reads_like_the_railway_gauge(self):
        m = {'db_bytes': 50 * MB, 'wal_bytes': 64 * MB, 'volume_bytes': 500 * MB, 'used_pct': 22.8}
        assert ds.detail_of(m) == '50 MB data + 64 MB WAL of 500 MB (23%)'

    def test_without_wal_permission_it_still_reads(self):
        m = {'db_bytes': 50 * MB, 'wal_bytes': None, 'volume_bytes': 500 * MB, 'used_pct': 10.0}
        assert ds.detail_of(m) == '50 MB data of 500 MB (10%)'
        assert ds.detail_of({'db_bytes': None}) == 'size unavailable'


class TestVolume:
    def test_volume_comes_from_env_and_defaults_to_railways_500(self, monkeypatch):
        monkeypatch.delenv('DB_VOLUME_MB', raising=False)
        assert ds.volume_bytes() == 500 * MB
        monkeypatch.setenv('DB_VOLUME_MB', '1024')
        assert ds.volume_bytes() == 1024 * MB
        monkeypatch.setenv('DB_VOLUME_MB', 'lots')
        assert ds.volume_bytes() == 500 * MB


class _Cur:
    """A cursor that answers the size queries in order and refuses the WAL one."""
    def __init__(self):
        self.sql = None
    def execute(self, sql, params=None):
        self.sql = sql
        if 'pg_ls_waldir' in sql:
            raise PermissionError('permission denied for function pg_ls_waldir')
    def fetchone(self):
        if 'pg_database_size' in self.sql:
            return (50 * MB,)
        if "pg_total_relation_size('settings')" in self.sql:
            return (38 * MB,)
        if 'SUM(pg_column_size(value))' in self.sql:
            return (18 * MB,)
        if 'n_dead_tup' in self.sql:
            return (1892,)
        return (0,)
    def fetchall(self):
        if 'pg_class' in self.sql:
            return [('settings', 38 * MB), ('orders', 1 * MB)]
        if 'FROM settings' in self.sql:
            return [('display_bg_video', 17 * MB), ('sponsor_ticker', 700 * 1024)]
        return []


class TestMeasure:
    def test_a_refused_probe_costs_only_that_figure(self, monkeypatch):
        monkeypatch.delenv('DB_VOLUME_MB', raising=False)
        m = ds.measure(_Cur())
        assert m['db_bytes'] == 50 * MB
        assert m['wal_bytes'] is None                      # not permitted: reported as unknown
        assert m['used_bytes'] == 50 * MB                  # not counted as zero WAL
        assert m['used_pct'] == 10.0
        assert m['tables'][0] == {'name': 'settings', 'bytes': 38 * MB}
        assert m['settings_keys'][0] == {'key': 'display_bg_video', 'bytes': 17 * MB}
        assert m['settings_reclaimable_bytes'] == 20 * MB  # 38 on disk for 18 live
        assert m['settings_dead_rows'] == 1892
        assert ds.status_of(m) == 'ok'
