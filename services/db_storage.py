"""How full is the database, and what is in it.

Railway shows the Postgres volume as one number (196 of 500 MB on 11 Sep
2026) and nothing in the app could say what that number was made of. This
measures it from inside: the database itself, the WAL, the tables and the
settings rows that account for most of it -- so System > Health carries a
meter, not a surprise. Finding 17 in docs/FINDINGS_ROADMAP.md.

Every figure is measured. The one thing Postgres cannot see is the size of
the disk it sits on, so the volume comes from DB_VOLUME_MB (Railway's is
500). The volume also holds Postgres' own bookkeeping (pg_xact, the base
directory's catalog, temp files) which no query sums, so Railway's number
runs a little above data + WAL; the meter says so.
"""
import logging
import os

logger = logging.getLogger(__name__)

WARN_PCT = 60
ALERT_PCT = 80
DEFAULT_VOLUME_MB = 500


def volume_bytes():
    try:
        mb = float(os.environ.get('DB_VOLUME_MB') or DEFAULT_VOLUME_MB)
    except (TypeError, ValueError):
        mb = DEFAULT_VOLUME_MB
    return int(max(mb, 1) * 1024 * 1024)


def _one(cur, sql, params=None):
    cur.execute(sql, params or ())
    row = cur.fetchone()
    if row is None:
        return None
    return row[0] if not isinstance(row, dict) else list(row.values())[0]


def measure(cur):
    """A dict of measured sizes. Never raises: a probe that is not permitted
    (pg_ls_waldir needs pg_monitor) reports None for that figure only."""
    out = {
        'db_bytes': None, 'wal_bytes': None, 'volume_bytes': volume_bytes(),
        'tables': [], 'settings_keys': [], 'settings_bytes': None,
        'settings_live_bytes': None, 'settings_reclaimable_bytes': None,
        'settings_dead_rows': None,
    }
    try:
        out['db_bytes'] = int(_one(cur, "SELECT pg_database_size(current_database())") or 0)
    except Exception as e:
        logger.warning(f"db size probe failed: {e}")
    try:
        out['wal_bytes'] = int(_one(cur, "SELECT COALESCE(SUM(size), 0) FROM pg_ls_waldir()") or 0)
    except Exception as e:
        # Not permitted for this role, or not Postgres: the meter still
        # works on the database alone.
        logger.info(f"WAL size unavailable: {e}")
    try:
        cur.execute(
            "SELECT c.relname, pg_total_relation_size(c.oid) FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' "
            "ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 5")
        out['tables'] = [{'name': r[0] if not isinstance(r, dict) else r['relname'],
                          'bytes': int((r[1] if not isinstance(r, dict) else list(r.values())[1]) or 0)}
                         for r in cur.fetchall()]
    except Exception as e:
        logger.warning(f"table sizes probe failed: {e}")
    try:
        cur.execute("SELECT key, pg_column_size(value) FROM settings "
                    "ORDER BY pg_column_size(value) DESC LIMIT 5")
        out['settings_keys'] = [{'key': r[0] if not isinstance(r, dict) else r['key'],
                                 'bytes': int((r[1] if not isinstance(r, dict) else list(r.values())[1]) or 0)}
                                for r in cur.fetchall()]
        out['settings_bytes'] = int(_one(cur, "SELECT pg_total_relation_size('settings')") or 0)
        out['settings_live_bytes'] = int(_one(cur, "SELECT COALESCE(SUM(pg_column_size(value)), 0) FROM settings") or 0)
        # Dead rows in the table AND its TOAST table, where the big values
        # actually live: every rewrite of a blob leaves the old copy there
        # until a vacuum. This is what "Reclaim space" gives back.
        out['settings_dead_rows'] = int(_one(cur,
            "SELECT COALESCE(SUM(n_dead_tup), 0) FROM pg_stat_all_tables "
            "WHERE relid = 'settings'::regclass "
            "OR relid = (SELECT reltoastrelid FROM pg_class WHERE oid = 'settings'::regclass)") or 0)
        out['settings_reclaimable_bytes'] = max(0, out['settings_bytes'] - out['settings_live_bytes'])
    except Exception as e:
        logger.warning(f"settings size probe failed: {e}")
    used = (out['db_bytes'] or 0) + (out['wal_bytes'] or 0)
    out['used_bytes'] = used
    out['used_pct'] = round(100.0 * used / out['volume_bytes'], 1) if out['volume_bytes'] else None
    return out


def status_of(m):
    """ok / warn / fail by the share of the volume in use."""
    pct = m.get('used_pct')
    if pct is None or m.get('db_bytes') is None:
        return 'warn'
    if pct >= ALERT_PCT:
        return 'fail'
    if pct >= WARN_PCT:
        return 'warn'
    return 'ok'


def mb(b):
    return f"{(b or 0) / 1048576:.0f} MB"


def detail_of(m):
    if m.get('db_bytes') is None:
        return 'size unavailable'
    bits = [f"{mb(m['db_bytes'])} data"]
    if m.get('wal_bytes') is not None:
        bits.append(f"{mb(m['wal_bytes'])} WAL")
    s = ' + '.join(bits) + f" of {mb(m['volume_bytes'])}"
    if m.get('used_pct') is not None:
        s += f" ({m['used_pct']:.0f}%)"
    return s


def reclaim_settings(dsn):
    """VACUUM (FULL) the settings table on its OWN connection -- VACUUM
    cannot run inside a transaction, and the app's one shared connection
    is always inside one. Holds an exclusive lock on settings for the
    rewrite (a second or two at 40 MB): a quiet-moment action, which is
    what the confirm on the screen says. Returns before/after bytes."""
    import psycopg2
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute("SELECT pg_total_relation_size('settings')")
        before = int(cur.fetchone()[0])
        cur.execute("VACUUM (FULL, ANALYZE) settings")
        cur.execute("SELECT pg_total_relation_size('settings')")
        after = int(cur.fetchone()[0])
        return {'before_bytes': before, 'after_bytes': after, 'freed_bytes': max(0, before - after)}
    finally:
        try:
            conn.close()
        except Exception:
            pass
