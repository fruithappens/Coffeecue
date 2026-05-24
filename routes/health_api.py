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
from flask import Blueprint, jsonify, current_app
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

    # --- 2. Twilio configuration presence ---
    # We don't actually call Twilio — that costs money + adds latency.
    # Just confirm the env vars are populated.
    twilio_sid   = os.environ.get('TWILIO_ACCOUNT_SID', '').strip()
    twilio_token = os.environ.get('TWILIO_AUTH_TOKEN', '').strip()
    twilio_phone = os.environ.get('TWILIO_PHONE_NUMBER', '').strip()
    testing_mode = (os.environ.get('TESTING_MODE', 'true').lower() == 'true')
    if testing_mode:
        _set_check('twilio', 'ok', 'TESTING_MODE=true; SMS calls stubbed', {
            'testing_mode': True,
        })
    elif twilio_sid and twilio_token and twilio_phone:
        _set_check('twilio', 'ok', 'configured', {
            'testing_mode': False,
            'phone_number': twilio_phone,
        })
    else:
        missing = []
        if not twilio_sid: missing.append('TWILIO_ACCOUNT_SID')
        if not twilio_token: missing.append('TWILIO_AUTH_TOKEN')
        if not twilio_phone: missing.append('TWILIO_PHONE_NUMBER')
        _set_check('twilio', 'fail',
                   f'live mode but missing env: {", ".join(missing)}')

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
