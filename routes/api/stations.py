"""Stations, schedule, breaks and barista profiles.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import MANAGER_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import datetime
from flask import current_app, jsonify, request
from utils import event_time as _event_time
from routes.consolidated_api_routes import (  # noqa: F401
    _event_timezone,
    _get_printer_config,
    _kv_get,
    _kv_put,
    _today_bounds,
    bp,
    logger,
)


@bp.route('/stations/<station_id>/capabilities', methods=['GET', 'PUT'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def station_capabilities(station_id):
    """GET or update a station's capabilities JSONB blob.

    The Quick Setup wizard already writes `station_stats.capabilities`
    (milk_types, coffee_types, sizes, capacity, etc.); EnhancedStationCapabilities
    on the frontend edits it per-station. POST (what the frontend sends)
    is served by routes/station_api_routes.py update_station_capabilities;
    this one answers GET and PUT.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cur = db.cursor()
        try:
            station_id_int = int(station_id)
        except (TypeError, ValueError):
            return jsonify({'success': False, 'message': 'station_id must be an integer'}), 400

        if request.method == 'GET':
            cur.execute(
                "SELECT COALESCE(capabilities, '{}'::jsonb) FROM station_stats WHERE station_id = %s",
                (station_id_int,)
            )
            row = cur.fetchone()
            if not row:
                return jsonify({'success': False, 'message': f'Station {station_id} not found'}), 404
            caps = row[0]
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps) if caps else {}
                except Exception:
                    caps = {}
            return jsonify({'success': True, 'capabilities': caps or {}})

        # POST / PUT
        data = request.get_json() or {}
        # Accept either {"capabilities": {...}} or the raw capabilities dict.
        new_caps = data.get('capabilities') if isinstance(data.get('capabilities'), dict) else data
        if not isinstance(new_caps, dict):
            return jsonify({'success': False, 'message': 'capabilities must be an object'}), 400

        # Merge with the existing row so callers can PATCH a single key
        # without wiping everything else (e.g. flipping `vip_service`
        # while leaving milk_types intact).
        cur.execute(
            "SELECT COALESCE(capabilities, '{}'::jsonb) FROM station_stats WHERE station_id = %s",
            (station_id_int,)
        )
        existing = cur.fetchone()
        if not existing:
            return jsonify({'success': False, 'message': f'Station {station_id} not found'}), 404
        existing_caps = existing[0]
        if isinstance(existing_caps, str):
            try:
                existing_caps = json.loads(existing_caps) if existing_caps else {}
            except Exception:
                existing_caps = {}
        if not isinstance(existing_caps, dict):
            existing_caps = {}
        merged = {**existing_caps, **new_caps}

        cur.execute(
            "UPDATE station_stats SET capabilities = %s::jsonb, last_updated = CURRENT_TIMESTAMP "
            "WHERE station_id = %s",
            (json.dumps(merged), station_id_int),
        )
        db.commit()
        logger.info(f"Updated capabilities for station {station_id_int}: keys={list(new_caps.keys())}")
        return jsonify({'success': True, 'station_id': station_id_int, 'capabilities': merged})
    except Exception as e:
        logger.error(f"station_capabilities error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/barista-profiles', methods=['GET'])
@jwt_required_with_demo()
def get_barista_profiles():
    """Return saved barista profiles (or {} if none have been saved yet).

    The frontend (EnhancedStationCapabilities.js) calls this on
    mount; previously the endpoint didn't exist and the 404 floods
    the console. Persists to settings under key 'barista_profiles'.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        profiles = _kv_get(coffee_system.db, 'barista_profiles', default={}) or {}
        return jsonify(profiles)
    except Exception as e:
        logger.error(f"get_barista_profiles error: {e}")
        return jsonify({}), 200  # fall back to empty so frontend uses localStorage


@bp.route('/barista-profiles/<name>', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_barista_profile(name):
    """Save/update one barista profile by name."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        profiles = _kv_get(coffee_system.db, 'barista_profiles', default={}) or {}
        profiles[name] = data
        _kv_put(coffee_system.db, 'barista_profiles', profiles)
        return jsonify({'success': True, 'name': name})
    except Exception as e:
        logger.error(f"upsert_barista_profile error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/stations/<int:station_id>/dial-in', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_station_dial_in(station_id):
    """Shared espresso dial-in card for a station (the 'recipe' the team agreed
    on: bean, grind, dose, yield, shot time, etc). Returns {} if none saved."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        card = _kv_get(coffee_system.db, f'dialin_station_{station_id}', default={}) or {}
        return jsonify({'success': True, 'dial_in': card})
    except Exception as e:
        logger.error(f"get_station_dial_in error: {e}")
        return jsonify({'success': True, 'dial_in': {}}), 200


@bp.route('/stations/<int:station_id>/dial-in', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def save_station_dial_in(station_id):
    """Save the shared dial-in card. Any barista can update it — it's a team
    note for this station. Only known fields are stored, capped in size."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'expected an object'}), 400
        allowed = ('bean', 'grind', 'grind_time', 'dose', 'yield', 'shot_time', 'temp', 'notes')
        card = {k: (str(data[k])[:200] if data[k] is not None else '') for k in allowed if k in data}
        card['updated_at'] = datetime.now().isoformat(timespec='seconds')
        card['updated_by'] = str(data.get('updated_by') or '')[:60]
        _kv_put(coffee_system.db, f'dialin_station_{station_id}', card)
        return jsonify({'success': True, 'dial_in': card})
    except Exception as e:
        logger.error(f"save_station_dial_in error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-breaks', methods=['GET', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def event_breaks():
    """List or create event breaks (the windows that gate SMS routing).

    Until now event_breaks had NO management API at all — the only writers
    were a boot-time default seed and Quick Setup's wipe, so an operator
    couldn't add or adjust a break without re-running the whole wizard
    (and the Test Bench couldn't exercise break-window routing at all).

    POST body: { title, day_of_week (0=Mon..6=Sun), start_time 'HH:MM',
                 end_time 'HH:MM', stations: [ids open during the break] }
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cur = db.cursor()
        if request.method == 'GET':
            cur.execute("""
                SELECT id, title, day_of_week, start_time, end_time, stations
                FROM event_breaks ORDER BY day_of_week, start_time
            """)
            rows = []
            for r in cur.fetchall():
                rows.append({
                    'id': r[0], 'title': r[1], 'day_of_week': r[2],
                    'start_time': str(r[3]), 'end_time': str(r[4]),
                    'stations': r[5] if isinstance(r[5], list)
                                else (json.loads(r[5]) if r[5] else []),
                })
            return jsonify({'success': True, 'breaks': rows})
        data = request.get_json() or {}
        title = (data.get('title') or 'Break').strip()
        day = data.get('day_of_week')
        start = (data.get('start_time') or '').strip()
        end = (data.get('end_time') or '').strip()
        stations = data.get('stations') or []
        if day is None or not start or not end:
            return jsonify({'success': False,
                            'error': 'day_of_week, start_time and end_time required'}), 400
        cur.execute("""
            INSERT INTO event_breaks (title, day_of_week, start_time, end_time, stations)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        """, (title, int(day), start, end, json.dumps([int(s) for s in stations])))
        new_id = cur.fetchone()[0]
        db.commit()
        return jsonify({'success': True, 'id': new_id})
    except Exception as e:
        logger.error(f"event_breaks error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-breaks/<int:break_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def delete_event_break(break_id):
    """Delete one event break by id."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cur = db.cursor()
        cur.execute("DELETE FROM event_breaks WHERE id = %s RETURNING id", (break_id,))
        row = cur.fetchone()
        db.commit()
        if not row:
            return jsonify({'success': False, 'error': 'break not found'}), 404
        return jsonify({'success': True, 'deleted': break_id})
    except Exception as e:
        logger.error(f"delete_event_break error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/stations/<int:station_id>/printer-config', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_station_printer_config(station_id):
    """Return the per-station printer config (ip/port/enabled/auto_print)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cfg = _get_printer_config(db, station_id)
        return jsonify({'success': True, 'station_id': station_id,
                        'printer': cfg or {'enabled': False, 'port': 9100, 'auto_print': False}})
    except Exception as e:
        logger.error(f"get_station_printer_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/stations/<int:station_id>/printer-config', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_station_printer_config(station_id):
    """Upsert the per-station printer config.

    Body: {"ip": "192.168.1.50", "port": 9100, "enabled": true,
           "auto_print": false}
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        body = request.get_json() or {}
        all_cfg = _get_printer_config(db)  # whole blob
        all_cfg[str(station_id)] = {
            'ip': (body.get('ip') or '').strip(),
            'port': int(body.get('port') or 9100),
            'enabled': bool(body.get('enabled')),
            'auto_print': bool(body.get('auto_print')),
        }
        _kv_put(db, 'printer_config', all_cfg)
        return jsonify({'success': True, 'station_id': station_id,
                        'printer': all_cfg[str(station_id)]})
    except Exception as e:
        logger.error(f"put_station_printer_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------
# Per-station stock persistence (backstop for the barista StockTab).
# The barista's manual stock edits used to live ONLY in localStorage
# (key coffee_stock_station_N) — invisible to the Organiser and wiped on
# reload. These endpoints give that data a durable home in the settings
# KV (key 'coffee_stock_station_<id>'); StockService write-throughs here
# on save and reads it back when localStorage is empty.
# ----------------------------------------------------------------------
@bp.route('/stations/<int:station_id>/stock', methods=['GET'])
@jwt_required_with_demo()
def get_station_stock(station_id):
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        stock = _kv_get(db, f'coffee_stock_station_{station_id}', default=None)
        return jsonify({'success': True, 'station_id': station_id, 'stock': stock or {}})
    except Exception as e:
        logger.error(f"get_station_stock error: {e}")
        return jsonify({'success': False, 'stock': {}, 'error': str(e)}), 200


@bp.route('/stations/<int:station_id>/stock', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def put_station_stock(station_id):
    """Persist a station's stock blob (the same shape StockService keeps
    in localStorage). Whole-blob replace. Best-effort backstop — the
    barista UI still works off localStorage; this just makes edits
    durable + visible to the Organiser."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        data = request.get_json(silent=True) or {}
        stock = data.get('stock') if isinstance(data.get('stock'), dict) else data
        if not isinstance(stock, dict):
            return jsonify({'success': False, 'error': 'stock must be an object'}), 400
        _kv_put(db, f'coffee_stock_station_{station_id}', stock)
        return jsonify({'success': True, 'station_id': station_id})
    except Exception as e:
        logger.error(f"put_station_stock error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/station-defaults', methods=['GET'])
@jwt_required_with_demo()
def get_station_defaults():
    """Per-station default selections (coffee type, milk, size, etc.).

    Previously stored ONLY in browser localStorage by StationDefaults.js
    — vanished on a fresh browser or different device. Now persisted to
    the settings table so it survives across operators and machines.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        defaults = _kv_get(coffee_system.db, 'station_defaults', default={}) or {}
        return jsonify(defaults)
    except Exception as e:
        logger.error(f"get_station_defaults error: {e}")
        return jsonify({}), 200


@bp.route('/station-defaults', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_station_defaults():
    """Replace the entire station-defaults blob (per-station map)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        _kv_put(coffee_system.db, 'station_defaults', data)
        return jsonify({'success': True, 'station_count': len(data)})
    except Exception as e:
        logger.error(f"upsert_station_defaults error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
