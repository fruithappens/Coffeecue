"""
Health check API endpoints.

GET /api/health      — lightweight liveness probe, no auth needed.
                       Returns 200 fast so load balancers / smoke
                       tests can verify the process is up. Doesn't
                       touch the DB.
GET /api/health/full — auth-gated detailed check. Walks DB, Twilio
                       config, pending migrations, queue depth,
                       recent error counts. The Support → System
                       Health tab renders from this.
"""
from flask import Blueprint, jsonify, current_app, request
from auth import jwt_required_with_demo, role_required_with_demo
from datetime import datetime, timedelta
import logging
import os

logger = logging.getLogger(__name__)

bp = Blueprint('health_api', __name__, url_prefix='/api')


@bp.route('/health', methods=['GET'])
def health_check():
    """Lightweight liveness — process is up. Returns fast, no DB touch."""
    try:
        return jsonify({
            'status': 'success',
            'message': 'API is healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'service': 'expresso-api',
            'version': '1.0.0'
        }), 200
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Health check failed',
            'error': str(e)
        }), 500


@bp.route('/health/memory', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def health_memory():
    """Process memory: RSS/uptime/threads/live sockets, plus the top
    allocation sites while tracemalloc is on (see POST .../trace). Admin
    only -- allocation sites expose file paths and line numbers."""
    from services import memory_watch as _mw
    try:
        n = int(request.args.get('top') or 25)
    except (TypeError, ValueError):
        n = 25
    out = _mw.snapshot(current_app)
    out.update(_mw.top_allocations(n))
    return jsonify({'success': True, 'memory': out})


@bp.route('/health/memory/trace', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def health_memory_trace():
    """Switch tracemalloc on/off at runtime: {"enabled": true, "frames": 1}.
    Leave it on only while diagnosing -- it costs CPU and memory."""
    from services import memory_watch as _mw
    body = request.get_json(silent=True) or {}
    state = _mw.trace(bool(body.get('enabled')), int(body.get('frames') or 1))
    return jsonify({'success': True, 'tracing': state, 'memory': _mw.snapshot(current_app)})


@bp.route('/health/full', methods=['GET'])
def health_check_full():
    """Detailed health report. Each check returns ok / warn / fail
    with a human-readable detail. Failing one check doesn't kill the
    whole response — the Support tab needs to know what's broken,
    not just that something is."""
    checks = {}
    overall = 'ok'

    def _set_check(name, status, detail=None, extra=None):
        nonlocal overall
        entry = {'status': status}
        if detail is not None:
            entry['detail'] = detail
        if extra is not None:
            entry.update(extra)
        checks[name] = entry
        # Worst status wins for the rollup.
        rank = {'ok': 0, 'warn': 1, 'fail': 2}
        if rank.get(status, 0) > rank.get(overall, 0):
            overall = status

    # --- 0. Process: memory / uptime / threads (the Railway sawtooth) ---
    try:
        from services import memory_watch as _mw
        _p = _mw.snapshot(current_app)
        _set_check(
            'process',
            'ok' if _p['rss_mb'] < _p['alert_mb'] else 'warn',
            f"{_p['rss_mb']:.0f} MB RSS, up {_p['uptime_s'] // 60} min, "
            f"{_p['threads']} threads, {_p['socketio_clients']} live sockets",
            extra=_p,
        )
    except Exception as _pe:
        _set_check('process', 'warn', f'process metrics unavailable: {_pe}')

    # --- 1. DB reachable + recent activity ---
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            _set_check('database', 'fail', 'coffee_system or db not in app context')
        else:
            cur = coffee_system.db.cursor()
            try:
                coffee_system.db.rollback()
            except Exception:
                pass
            cur.execute("SELECT 1")
            cur.fetchone()

            # Recent order activity — useful for 'is anyone using this'
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                  COUNT(*) FILTER (WHERE status = 'in-progress') AS in_progress,
                  COUNT(*) FILTER (WHERE status = 'completed' AND picked_up_at IS NULL) AS ready_for_pickup,
                  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour') AS created_last_hour
                FROM orders
            """)
            row = cur.fetchone()
            pending, in_progress, ready, last_hour = row if row else (0, 0, 0, 0)
            queue_depth = (pending or 0) + (in_progress or 0)
            _set_check('database', 'ok', f'reachable; queue {queue_depth}', {
                'queue': {
                    'pending': pending or 0,
                    'in_progress': in_progress or 0,
                    'ready_for_pickup': ready or 0,
                    'created_last_hour': last_hour or 0,
                },
            })
    except Exception as e:
        logger.warning(f"DB health check failed: {e}")
        _set_check('database', 'fail', f'query error: {e}')

    # --- 2. SMS provider configuration presence ---
    # We don't actually call the providers — that costs money + adds
    # latency. Each provider's health() inspects its env vars. The
    # primary outbound provider (SMS_PROVIDER, defaults to twilio) gets
    # an `sms_primary` check; every registered provider gets its own
    # named check so the Support tab can show "twilio: ok, clicksend:
    # not configured, cellcast: not configured" side-by-side.
    primary_name = (os.environ.get('SMS_PROVIDER') or 'twilio').lower()
    try:
        from services.sms import all_providers, get_outbound_provider
        for p in all_providers():
            h = p.health()
            status = 'ok' if h.configured else (
                # An unconfigured non-primary provider is fine — it just
                # means Steve hasn't set those creds. The PRIMARY one
                # being unconfigured is a fail.
                'fail' if p.name == primary_name else 'warn'
            )
            _set_check(f'sms_{p.name}', status, h.detail, h.extras)
        # Roll up a single "is the primary SMS path actually wired?"
        # check that Readiness can use.
        primary = get_outbound_provider()
        ph = primary.health()
        _set_check('sms_primary',
                   'ok' if ph.configured else 'fail',
                   f'primary={primary.name} — {ph.detail}',
                   {'primary': primary.name, **ph.extras})
    except Exception as e:
        logger.warning(f"SMS provider health probe failed: {e}")
        _set_check('sms_primary', 'fail', f'probe error: {e}')

    # --- 2b. EventsAir integration (optional) ---
    # 'ok' when disabled (it's opt-in) or configured; 'warn' only when
    # enabled-but-not-fully-configured. Never 'fail' — it's an add-on.
    try:
        coffee_system = current_app.config.get('coffee_system')
        from services.eventsair import get_client, is_enabled
        if coffee_system and is_enabled(coffee_system.db):
            h = get_client(coffee_system.db).health()
            _set_check('eventsair',
                       'ok' if h.get('configured') else 'warn',
                       h.get('detail', ''),
                       {'stub': h.get('stub')})
        else:
            _set_check('eventsair', 'ok', 'disabled (opt-in)', {'enabled': False})
    except Exception as e:
        logger.warning(f"EventsAir health probe failed: {e}")
        _set_check('eventsair', 'warn', f'probe error: {e}')

    # --- 3. Pending schema migrations ---
    try:
        from services.migrations import MIGRATIONS
        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        cur.execute("""
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'schema_migrations'
        """)
        if cur.fetchone():
            cur.execute("SELECT version FROM schema_migrations")
            applied = {r[0] for r in cur.fetchall()}
            all_versions = {m.version for m in MIGRATIONS}
            pending = sorted(all_versions - applied)
            if pending:
                _set_check('migrations', 'warn',
                           f'{len(pending)} pending: {pending}', {
                               'applied_count': len(applied),
                               'pending_versions': pending,
                           })
            else:
                _set_check('migrations', 'ok',
                           f'{len(applied)} applied, none pending', {
                               'applied_count': len(applied),
                           })
        else:
            _set_check('migrations', 'warn',
                       'schema_migrations table not yet created')
    except Exception as e:
        logger.warning(f"migrations health check failed: {e}")
        _set_check('migrations', 'warn', f'check error: {e}')

    # --- 4. Catalog presence ---
    try:
        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        cur.execute("""
            SELECT category, COUNT(*) FROM catalog_items
            WHERE is_active = TRUE
            GROUP BY category
        """)
        by_cat = {row[0]: row[1] for row in cur.fetchall()}
        if not by_cat:
            _set_check('catalog', 'warn',
                       'catalog_items empty — run migration #9')
        else:
            total = sum(by_cat.values())
            _set_check('catalog', 'ok', f'{total} items across {len(by_cat)} categories', {
                'by_category': by_cat,
            })
    except Exception as e:
        _set_check('catalog', 'warn', f'check error: {e}')

    # --- 5. Stations active count ---
    try:
        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        cur.execute("""
            SELECT
              COUNT(*) FILTER (WHERE status = 'active')      AS active,
              COUNT(*) FILTER (WHERE status = 'inactive')    AS inactive,
              COUNT(*) FILTER (WHERE status = 'maintenance') AS maintenance,
              COUNT(*) AS total
            FROM station_stats
        """)
        row = cur.fetchone()
        active, inactive, maintenance, total = row if row else (0, 0, 0, 0)
        if (total or 0) == 0:
            _set_check('stations', 'warn', 'no stations configured')
        elif (active or 0) == 0:
            _set_check('stations', 'fail', 'no active stations — no orders can be routed', {
                'total': total, 'active': active, 'inactive': inactive,
                'maintenance': maintenance,
            })
        else:
            _set_check('stations', 'ok', f'{active}/{total} active', {
                'total': total, 'active': active, 'inactive': inactive,
                'maintenance': maintenance,
            })
    except Exception as e:
        _set_check('stations', 'warn', f'check error: {e}')

    return jsonify({
        'status': overall,
        'timestamp': datetime.utcnow().isoformat(),
        'service': 'expresso-api',
        'version': '1.0.0',
        'checks': checks,
    }), 200 if overall != 'fail' else 503
