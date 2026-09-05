"""
Event-readiness API.

GET  /api/readiness            — aggregated "is this event ready to take orders?"
POST /api/sms/test             — send a real Twilio SMS to a verified number

Why this exists separately from /api/health/full:

Health/full answers "is the system technically up?" — DB reachable,
Twilio env vars set, migrations applied. Readiness answers a different
question: "will this event work when customers SMS in?"

The two overlap (both check Twilio config, stations active) but the
operator-facing framing is different. Readiness adds checks that
matter for events but not for the platform: Quick Setup was actually
applied, event_name is set, capabilities cover every catalog drink,
no recent crashes, stock above zero or unlimited mode on, etc.

Lives at /api/readiness so the Organiser → Readiness tab can hit
one endpoint and render the whole page. The frontend doesn't need
to know how each check works — just colour the dots.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo

logger = logging.getLogger(__name__)

bp = Blueprint('readiness_api', __name__, url_prefix='/api')


# Status priority for rollup. Worst wins. Skipped doesn't count.
_STATUS_RANK = {'ok': 0, 'warn': 1, 'fail': 2, 'skipped': -1}


def _rollup(results):
    """Pick the worst non-skipped status."""
    worst = 'ok'
    for r in results:
        s = r.get('status', 'ok')
        if _STATUS_RANK.get(s, 0) > _STATUS_RANK.get(worst, 0):
            worst = s
    return worst


def _safe_check(name, label, fn):
    """Run a single check, catching anything that goes sideways.

    Returns the standard shape so a thrown exception in one check
    doesn't blank the whole readiness page.
    """
    try:
        out = fn()
        out.setdefault('name', name)
        out.setdefault('label', label)
        return out
    except Exception as e:
        logger.warning(f"readiness check {name} failed: {e}")
        return {
            'name': name,
            'label': label,
            'status': 'warn',
            'detail': f'check error: {e}',
        }


def _kv_get(db, key, default=None):
    """Minimal copy of the KV helper from consolidated_api_routes.

    Duplicated rather than imported to avoid a circular import — this
    blueprint registers before consolidated_api_routes finishes.
    """
    import json
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return default
    val = row[0] if not isinstance(row, dict) else row['value']
    try:
        return json.loads(val)
    except (TypeError, ValueError):
        return val


# ----------------------------------------------------------------------
# Individual checks. Each returns {status, detail, [extra]}.
# ----------------------------------------------------------------------

def _check_sms_config():
    """Twilio is configured AND not in TESTING_MODE (events use real SMS)."""
    testing_mode = os.environ.get('TESTING_MODE', 'true').lower() == 'true'
    sid = os.environ.get('TWILIO_ACCOUNT_SID', '').strip()
    token = os.environ.get('TWILIO_AUTH_TOKEN', '').strip()
    phone = os.environ.get('TWILIO_PHONE_NUMBER', '').strip()

    if testing_mode:
        return {
            'status': 'warn',
            'detail': 'TESTING_MODE is on — SMS calls are stubbed. '
                      'Turn off in Railway env vars before going live.',
        }
    if not (sid and token and phone):
        missing = [k for k, v in (
            ('TWILIO_ACCOUNT_SID', sid),
            ('TWILIO_AUTH_TOKEN', token),
            ('TWILIO_PHONE_NUMBER', phone),
        ) if not v]
        return {
            'status': 'fail',
            'detail': f'Missing env vars: {", ".join(missing)}',
        }
    return {
        'status': 'ok',
        'detail': f'Live mode, number {phone}',
    }


def _check_stations(db):
    """At least one active station; flag if none."""
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("""
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')   AS active,
          COUNT(*)                                    AS total
        FROM station_stats
    """)
    row = cur.fetchone()
    if isinstance(row, dict):
        active = row.get('active') or 0
        total = row.get('total') or 0
    else:
        active, total = (row or (0, 0))
    if total == 0:
        return {'status': 'fail', 'detail': 'No stations configured. '
                                            'Add at least one in Stations.'}
    if active == 0:
        return {'status': 'fail',
                'detail': f'{total} stations but none active. '
                          'Activate one in Quick Setup or Stations.'}
    return {'status': 'ok',
            'detail': f'{active} of {total} stations active'}


def _check_event_name(db):
    """Event has a human name set — drives welcome SMS + display."""
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("SELECT value FROM settings WHERE key = 'event_name'")
    row = cur.fetchone()
    name = None
    if row:
        name = row[0] if not isinstance(row, dict) else row['value']
    if not name or not str(name).strip():
        return {'status': 'warn',
                'detail': 'Event name is empty. Customers see a generic '
                          'welcome. Set in Quick Setup → Event identity.'}
    return {'status': 'ok', 'detail': f'"{name}"'}


def _check_quick_setup_recency(db):
    """Quick Setup was applied recently — fresh event, fresh data."""
    try:
        db.rollback()
    except Exception:
        pass
    # The frontend writes a quick_setup_last_applied timestamp to
    # localStorage; the backend's analogous record is the settings row
    # touched by the quick-setup endpoint. We check whether ANY of the
    # quick-setup-managed settings has been touched recently.
    cur = db.cursor()
    cur.execute("""
        SELECT MAX(updated_at) FROM settings
        WHERE key IN ('event_name', 'walkin_defaults', 'sms_started_policy',
                      'branding_settings', 'event_inventory')
    """)
    row = cur.fetchone()
    ts = row[0] if row and not isinstance(row, dict) else (row or {}).get('max')
    if not ts:
        return {'status': 'warn',
                'detail': 'No Quick Setup activity recorded. Run Quick Setup '
                          'before doors open.'}
    age_hours = (datetime.now(timezone.utc) - ts.replace(tzinfo=timezone.utc)
                 if ts.tzinfo is None else
                 datetime.now(timezone.utc) - ts).total_seconds() / 3600
    if age_hours > 168:  # 1 week
        return {'status': 'warn',
                'detail': f'Settings last touched {int(age_hours/24)} days ago. '
                          'Re-run Quick Setup to confirm everything is current.'}
    if age_hours < 1:
        return {'status': 'ok',
                'detail': f'Settings last touched {int(age_hours*60)} min ago'}
    return {'status': 'ok',
            'detail': f'Settings last touched {int(age_hours)}h ago'}


def _check_recent_crashes(db):
    """No React Error Boundary catches in the last hour."""
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    # Tolerate the table not existing yet (migration 11 not run).
    try:
        cur.execute("""
            SELECT COUNT(*) FROM client_errors
            WHERE occurred_at > NOW() - INTERVAL '1 hour'
        """)
        row = cur.fetchone()
        count = (row[0] if not isinstance(row, dict) else row.get('count')) or 0
    except Exception:
        return {'status': 'skipped',
                'detail': 'client_errors table not yet migrated'}
    if count == 0:
        return {'status': 'ok',
                'detail': 'No frontend crashes in the last hour'}
    if count > 5:
        return {'status': 'fail',
                'detail': f'{count} frontend crashes in last hour — '
                          'check Support → Diagnose.'}
    return {'status': 'warn',
            'detail': f'{count} frontend crash(es) in last hour. '
                      'Check Support → Diagnose.'}


def _check_capabilities_coverage(db):
    """Every catalog drink can be made by SOME active station."""
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    # Catalog drink list
    try:
        cur.execute("""
            SELECT short_name FROM catalog_items
            WHERE category = 'drink' AND is_active = TRUE
        """)
        drinks = {str(r[0] if not isinstance(r, dict) else r['short_name']).strip().lower()
                  for r in cur.fetchall()}
        drinks = {d for d in drinks if d}
    except Exception:
        return {'status': 'skipped',
                'detail': 'catalog_items not yet populated'}
    if not drinks:
        return {'status': 'warn', 'detail': 'No drinks in catalog'}

    # Aggregate capabilities across active stations
    cur.execute("""
        SELECT capabilities FROM station_stats
        WHERE status = 'active'
    """)
    rows = cur.fetchall() or []
    covered = set()
    for r in rows:
        caps = r[0] if not isinstance(r, dict) else r.get('capabilities')
        if isinstance(caps, dict):
            # Read the key stations ACTUALLY use. This looked only at
            # 'drinks', which no station writes - production stores
            # coffee_types - so `covered` was always empty and the check
            # reported every drink on the menu as uncovered, every time.
            #
            # A pre-doors check that always warns is worse than no check:
            # it is the one thing meant to catch a station configured with
            # no capabilities (which silently receives no orders at all),
            # and it trained the operator to ignore it.
            for key in ('coffee_types', 'drinks'):
                for d in (caps.get(key) or []):
                    if d:
                        covered.add(str(d).strip().lower())
    # Only drinks the EVENT actually offers. The catalog holds everything
    # the product knows how to make; an operator who switched the teas off
    # has not created a coverage gap, and warning about them buries the
    # real case - a drink that IS on the menu with no station able to make
    # it, so every order for it fails at routing.
    try:
        from routes.consolidated_api_routes import _kv_get
        inv = _kv_get(db, 'event_inventory', default=None) or {}
        # Stored shape varies: usually the categories sit at the top level,
        # but a PUT that wrapped them ({"inventory": {...}}) is persisted
        # verbatim, so unwrap one level before reading.
        if isinstance(inv, dict) and isinstance(inv.get('inventory'), dict):
            inv = inv['inventory']
        on_menu = set()
        for _cat, items in (inv.items() if isinstance(inv, dict) else []):
            if not isinstance(items, list):
                continue
            for it in items:
                if isinstance(it, dict) and it.get('name') and it.get('enabled'):
                    on_menu.add(str(it['name']).strip().lower())
        if on_menu:
            drinks = drinks & on_menu
    except Exception as e:
        logger.warning(f"readiness: could not read event menu, "
                       f"checking the whole catalog: {e}")

    if not drinks:
        return {'status': 'ok',
                'detail': 'No drinks enabled on the event menu yet'}

    missing = drinks - covered
    if not missing:
        return {'status': 'ok',
                'detail': f'All {len(drinks)} drinks covered by active stations'}
    sample = ', '.join(sorted(missing)[:5])
    return {'status': 'warn',
            'detail': f'{len(missing)} drinks not on any active station: {sample}'
                      f'{"…" if len(missing) > 5 else ""}'}


def _check_inventory(db):
    """Either unlimited_stock_mode is on, or stock is above zero somewhere."""
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("SELECT value FROM settings WHERE key = 'unlimited_stock_mode'")
    row = cur.fetchone()
    val = (row[0] if row and not isinstance(row, dict) else (row or {}).get('value'))
    if val and str(val).lower() in ('true', '1', 'yes'):
        return {'status': 'ok',
                'detail': 'Unlimited stock mode is on — orders never rejected'}
    # Otherwise sample event_inventory
    try:
        cur.execute("""
            SELECT category, COUNT(*) FILTER (WHERE current_qty > 0) AS pos,
                             COUNT(*) AS total
            FROM event_inventory
            GROUP BY category
        """)
        rows = cur.fetchall() or []
        if not rows:
            return {'status': 'warn',
                    'detail': 'No event_inventory rows. '
                              'Run Quick Setup or seed inventory.'}
        zero_cats = []
        for r in rows:
            if isinstance(r, dict):
                cat, pos = r.get('category'), r.get('pos') or 0
            else:
                cat, pos, _ = r
            if pos == 0:
                zero_cats.append(cat)
        if zero_cats:
            return {'status': 'warn',
                    'detail': f'No positive stock in: {", ".join(zero_cats)}'}
        return {'status': 'ok',
                'detail': f'Positive stock in all {len(rows)} categories'}
    except Exception:
        return {'status': 'skipped',
                'detail': 'event_inventory not yet seeded'}


def _check_migrations(db):
    """All schema migrations applied."""
    try:
        from services.migrations import MIGRATIONS
    except Exception as e:
        return {'status': 'skipped', 'detail': f'cannot import migrations: {e}'}
    try:
        db.rollback()
    except Exception:
        pass
    cur = db.cursor()
    cur.execute("""
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'schema_migrations'
    """)
    if not cur.fetchone():
        return {'status': 'warn',
                'detail': 'schema_migrations not yet created'}
    cur.execute("SELECT version FROM schema_migrations")
    applied = {r[0] if not isinstance(r, dict) else r['version']
               for r in cur.fetchall()}
    all_versions = {m.version for m in MIGRATIONS}
    pending = sorted(all_versions - applied)
    if pending:
        return {'status': 'fail',
                'detail': f'{len(pending)} pending: {pending}'}
    return {'status': 'ok',
            'detail': f'{len(applied)} applied, none pending'}


# ----------------------------------------------------------------------
# Public endpoint.
# ----------------------------------------------------------------------

def _check_admin_alerts():
    """The SMS-down / memory-high / restart alerts only help if they can reach
    someone. Organiser > Event Readiness sets the phone and email."""
    from services.admin_alerts import load_config
    cfg = load_config()
    if not cfg.get('enabled'):
        return {'status': 'warn', 'detail': 'Admin alerts are OFF. Turn them on and set an email or phone so outages reach you.'}
    if not (cfg.get('email') or cfg.get('phone')):
        return {'status': 'warn', 'detail': 'Admin alerts are on but have no email or phone to send to.'}
    to = ', '.join(x for x in (cfg.get('email'), cfg.get('phone')) if x)
    return {'status': 'ok', 'detail': f'Alerts go to {to}.'}


def _check_printers_polling(db):
    """A printer polling every 30 s (the TSP100IV SK's factory setting) puts
    ~30 s on every label. Measured from the polls received since boot."""
    from routes.print_routes import poll_interval_s, POLL_SLOW_AFTER_S
    cur = db.cursor()
    cur.execute("SELECT name, mac_address FROM printers WHERE enabled = TRUE")
    rows = cur.fetchall()
    if not rows:
        return {'status': 'skipped', 'detail': 'No label printers enabled.'}
    slow, unseen, fine = [], [], []
    for r in rows:
        name, mac = (r[0], r[1]) if not isinstance(r, dict) else (r.get('name'), r.get('mac_address'))
        iv = poll_interval_s(mac)
        if iv is None:
            unseen.append(str(name))
        elif iv > POLL_SLOW_AFTER_S:
            slow.append(f'{name} ({iv:.0f}s)')
        else:
            fine.append(f'{name} ({iv:.0f}s)')
    if slow:
        return {'status': 'warn', 'detail': f"Slow polling: {', '.join(slow)}. Set the printer's CloudPRNT polling time to 5 s (its web config) or every label waits that long."}
    if unseen and not fine:
        return {'status': 'warn', 'detail': f"No polls seen since the server started from: {', '.join(unseen)}. Power and network?"}
    return {'status': 'ok', 'detail': f"Polling every {', '.join(fine)}" + (f"; not yet seen: {', '.join(unseen)}" if unseen else '') + '.'}


def _check_memory_watch():
    """The watchdog that logs memory, trims the allocator and alerts above the
    line (services/memory_watch.py) -- the Treenet day-2 restarts."""
    import threading
    from services import memory_watch as mw
    alive = any(t.name == 'memory-watch' and t.is_alive() for t in threading.enumerate())
    snap = mw.snapshot(current_app)
    if not alive:
        return {'status': 'warn', 'detail': 'Memory watchdog thread is not running; memory growth would go unreported.'}
    mb = snap.get('rss_mb') or 0
    line = snap.get('alert_mb') or 700
    return {'status': 'ok' if mb < line else 'warn',
            'detail': f"Running; {mb:.0f} MB in use (alert above {line} MB), up {int((snap.get('uptime_s') or 0) // 60)} min."}


def _check_inbound_sms():
    """Outbound is proved by the test button; inbound needs a real text to
    arrive and pass the Twilio signature check (the rotated auth token).
    One text to the number proves the whole path."""
    from services import sms_health
    snap = sms_health.snapshot()
    wh = snap.get('webhook') or {}
    hits = int(wh.get('hits_since_boot') or 0)
    rej = int(wh.get('rejected_since_boot') or 0)
    if rej and not hits:
        return {'status': 'fail', 'detail': f'{rej} inbound text(s) REJECTED since start: the Twilio auth token in Railway does not match the account (signature check).'}
    if not hits:
        return {'status': 'warn', 'detail': 'No inbound text seen since the server started. Text the CupQ number once to prove the webhook and auth token.'}
    return {'status': 'ok', 'detail': f'{hits} inbound text(s) received since start' + (f', {rej} rejected' if rej else '') + '.'}


@bp.route('/readiness', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_readiness():
    """One-shot 'is this event ready to take orders' aggregator.

    Returns a list of checks (not a dict, so the frontend can render in
    a stable order without re-sorting) plus an overall status. Frontend
    displays one row per check, colour-coded.
    """
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db if coffee_system else None
    if not db:
        return jsonify({
            'status': 'fail',
            'checks': [{
                'name': 'database', 'label': 'Database',
                'status': 'fail', 'detail': 'coffee_system not available',
            }],
            'timestamp': datetime.utcnow().isoformat(),
        }), 200

    checks = [
        _safe_check('sms_config', 'SMS configuration', _check_sms_config),
        _safe_check('inbound_sms', 'Inbound texts arriving', _check_inbound_sms),
        _safe_check('admin_alerts', 'Alerts reach the organiser', _check_admin_alerts),
        _safe_check('printers_polling', 'Label printers polling fast', lambda: _check_printers_polling(db)),
        _safe_check('memory_watch', 'Server memory watchdog', _check_memory_watch),
        _safe_check('stations', 'Stations', lambda: _check_stations(db)),
        _safe_check('event_name', 'Event name', lambda: _check_event_name(db)),
        _safe_check('capabilities', 'Station capability coverage',
                    lambda: _check_capabilities_coverage(db)),
        _safe_check('inventory', 'Stock levels', lambda: _check_inventory(db)),
        _safe_check('migrations', 'Database migrations',
                    lambda: _check_migrations(db)),
        _safe_check('quick_setup', 'Quick Setup recency',
                    lambda: _check_quick_setup_recency(db)),
        _safe_check('crashes', 'Recent frontend crashes',
                    lambda: _check_recent_crashes(db)),
    ]

    return jsonify({
        'status': _rollup(checks),
        'checks': checks,
        'timestamp': datetime.utcnow().isoformat(),
    }), 200


# ----------------------------------------------------------------------
# Send-test-SMS — operator types a phone number, gets the welcome SMS.
# ----------------------------------------------------------------------

_E164 = re.compile(r'^\+\d{8,15}$')


@bp.route('/sms/test', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def send_test_sms():
    """Send a one-off test SMS to the supplied number.

    Body: {"to": "+61400000000", "message": "..." (optional)}

    Uses the live Twilio config IF TESTING_MODE is off. If on, returns
    a "would have sent" message so the operator can still verify the
    flow without spending money.

    Validates E.164 strictly — no shortcodes, no local-format slop. A
    typo'd number that happens to dial somewhere is worse than a
    refused request.
    """
    data = request.get_json() or {}
    to = (data.get('to') or '').strip()
    if not to:
        return jsonify({'success': False,
                        'error': 'Provide a "to" number in E.164 format '
                                 '(e.g. +61400000000)'}), 400
    if not _E164.match(to):
        return jsonify({'success': False,
                        'error': f'"{to}" is not valid E.164. '
                                 'Format: + then country code + number, no spaces.'}), 400
    message = (data.get('message') or '').strip()
    if not message:
        # Default to a recognisable test message that mimics the welcome
        # SMS shape — operator sees what a real customer would see.
        coffee_system = current_app.config.get('coffee_system')
        event_name = 'Coffee Cue'
        if coffee_system and coffee_system.db:
            try:
                got = _kv_get(coffee_system.db, 'event_name', default='Coffee Cue')
                event_name = got or 'Coffee Cue'
            except Exception:
                pass
        message = (f"[TEST] Welcome to {event_name}! "
                   "This is a test SMS from your Coffee Cue admin "
                   "dashboard. If you got this, Twilio is configured "
                   "correctly. Reply STOP to opt out.")

    testing_mode = os.environ.get('TESTING_MODE', 'true').lower() == 'true'
    if testing_mode:
        logger.info(f"[TESTING_MODE] Test SMS to {to}: {message[:60]}…")
        return jsonify({
            'success': True,
            'testing_mode': True,
            'detail': 'TESTING_MODE is on — message NOT sent. '
                      'Turn off to send real SMS.',
            'preview': message,
        }), 200

    # Real send
    try:
        from twilio.rest import Client
        sid = os.environ['TWILIO_ACCOUNT_SID']
        token = os.environ['TWILIO_AUTH_TOKEN']
        from_num = os.environ['TWILIO_PHONE_NUMBER']
    except KeyError as e:
        return jsonify({'success': False,
                        'error': f'Twilio not configured: missing {e}'}), 500
    except ImportError:
        return jsonify({'success': False,
                        'error': 'twilio package not installed'}), 500

    try:
        client = Client(sid, token)
        msg = client.messages.create(
            body=message,
            from_=from_num,
            to=to,
        )
        logger.info(f"Test SMS sent to {to}: sid={msg.sid}")
        return jsonify({
            'success': True,
            'testing_mode': False,
            'detail': f'Sent. Twilio sid: {msg.sid}',
            'sid': msg.sid,
        }), 200
    except Exception as e:
        logger.error(f"Test SMS to {to} failed: {e}")
        return jsonify({'success': False,
                        'error': f'Twilio rejected: {e}'}), 502
