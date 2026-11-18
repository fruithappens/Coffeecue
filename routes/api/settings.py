"""Event settings: pricing, access, notices, sponsors and the rest.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
from auth import MANAGER_ROLES, STAFF_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import datetime
from flask import current_app, jsonify, request
from utils.broadcast import BROADCAST_KEY, build as build_broadcast, is_live as broadcast_is_live
from utils.event_access import ACCESS_SETTING_KEY, password_required as event_password_required, read_settings as event_access_settings
from routes.consolidated_api_routes import (  # noqa: F401
    DEFAULT_PRICING,
    DEFAULT_ROUTING_RULES,
    DEFAULT_WALKIN_DEFAULTS,
    NOTICE_LEVELS,
    NOTICE_MAX_LEN,
    _DEFAULT_TIERS,
    _NOTICE_COLS,
    _SMS_STARTED_POLICY_DEFAULT,
    _kv_get,
    _kv_put,
    _norm_wall,
    _notice_actor,
    _notice_broadcast,
    _notice_db,
    _notice_row_to_dict,
    _notice_send_sms,
    _revalidating_json,
    _sponsor_ticker_clean,
    _sponsor_ticker_read,
    bp,
    logger,
)



@bp.route('/settings/station-unlock', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_station_unlock():
    """Whether the backup-barista unlock is available, never the code.

    The code is write-only by design. Settings blobs get exported,
    backed up and pasted into support threads; a secret that can be read
    back out of one is a secret that travels.
    """
    try:
        from utils.station_unlock import SETTING_KEY, is_enabled
        cs = current_app.config.get('coffee_system')
        cfg = _kv_get(cs.db, SETTING_KEY, default={}) or {}
        return jsonify({'success': True, 'data': {
            'enabled': is_enabled(cfg),
            'configured': bool(cfg.get('code_hash')),
            'updated_at': cfg.get('updated_at'),
        }})
    except Exception as e:
        logger.error(f"get_station_unlock error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/settings/station-unlock', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_station_unlock():
    """Set or clear the code that turns an ordering iPad into a barista
    station.

    Body: {"code": "...", "enabled": bool}. Sending enabled=false leaves
    the stored code alone so it can be switched back on for the next
    event without retyping it; sending code="" clears it outright.
    """
    try:
        from utils.station_unlock import (SETTING_KEY, hash_code, is_enabled,
                                          validate_new_code)
        data = request.get_json(silent=True) or {}
        cs = current_app.config.get('coffee_system')
        cfg = _kv_get(cs.db, SETTING_KEY, default={}) or {}
        if not isinstance(cfg, dict):
            cfg = {}

        if 'code' in data:
            raw = str(data.get('code') or '')
            if raw.strip() == '':
                # Explicitly clearing it. Turn the feature off in the
                # same breath -- an enabled setting with no code would be
                # an unlock endpoint that accepts nothing, and a switch
                # that looks on while doing nothing is worse than off.
                cfg.pop('code_hash', None)
                cfg['enabled'] = False
            else:
                ok, message = validate_new_code(raw)
                if not ok:
                    return jsonify({'success': False, 'message': message}), 400
                cfg['code_hash'] = hash_code(raw)
        if 'enabled' in data:
            cfg['enabled'] = bool(data['enabled'])
        if cfg.get('enabled') and not cfg.get('code_hash'):
            return jsonify({'success': False,
                            'message': 'Set a code before turning this on.'}), 400
        cfg['updated_at'] = datetime.now().isoformat()
        _kv_put(cs.db, SETTING_KEY, cfg)
        return jsonify({'success': True, 'data': {
            'enabled': is_enabled(cfg),
            'configured': bool(cfg.get('code_hash')),
            'updated_at': cfg.get('updated_at'),
        }})
    except Exception as e:
        logger.error(f"put_station_unlock error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/settings/sms-policy', methods=['GET'])
@jwt_required_with_demo()
def get_sms_policy():
    """Return current SMS notification policy (defaults to queue_only/60s).

    Lets the Quick Setup / Settings UI render the right radio button
    selection and threshold input.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        cfg = _kv_get(coffee_system.db, 'sms_started_policy', default=None)
        if not isinstance(cfg, dict):
            cfg = dict(_SMS_STARTED_POLICY_DEFAULT)
        return jsonify({'success': True, 'data': cfg})
    except Exception as e:
        logger.error(f"get_sms_policy error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/settings/sms-policy', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_sms_policy():
    """Persist the SMS notification policy.

    Body: {"policy": "always" | "queue_only" | "never",
           "threshold_seconds": int}
    """
    try:
        data = request.get_json(silent=True) or {}
        policy = (data.get('policy') or 'queue_only').strip().lower()
        if policy not in ('always', 'queue_only', 'never'):
            return jsonify({
                'success': False,
                'message': "policy must be 'always', 'queue_only', or 'never'",
            }), 400
        try:
            threshold = int(data.get('threshold_seconds', 60))
            threshold = max(0, min(threshold, 600))  # clamp 0-10 min
        except (TypeError, ValueError):
            threshold = 60

        coffee_system = current_app.config.get('coffee_system')
        _kv_put(coffee_system.db, 'sms_started_policy', {
            'policy': policy,
            'threshold_seconds': threshold,
        })
        return jsonify({
            'success': True,
            'data': {'policy': policy, 'threshold_seconds': threshold},
        })
    except Exception as e:
        logger.error(f"put_sms_policy error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/quick-picks', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_quick_picks():
    """The saved quick picks, as the Runner wrote them (not filtered by
    today's menu -- the editor must show a pick even while its milk is
    86'd, or saving would silently delete it)."""
    try:
        from utils.quick_picks import normalize_picks
        db = current_app.config.get('coffee_system').db
        return jsonify({'success': True,
                        'quick_picks': normalize_picks(_kv_get(db, 'quick_picks', default=None))})
    except Exception as e:
        logger.error(f"quick-picks read error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/quick-picks', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_quick_picks():
    """Replace the quick picks. Body: {"quick_picks": [{drink, milk, size, label}]}."""
    try:
        from utils.quick_picks import normalize_picks
        body = request.get_json(silent=True) or {}
        if not isinstance(body.get('quick_picks'), list):
            return jsonify({'success': False,
                            'message': 'quick_picks must be a list'}), 400
        picks = normalize_picks(body['quick_picks'])
        db = current_app.config.get('coffee_system').db
        _kv_put(db, 'quick_picks', picks)
        return jsonify({'success': True, 'quick_picks': picks})
    except Exception as e:
        logger.error(f"quick-picks write error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# SETTINGS ENDPOINTS
# ============================================================================

@bp.route('/settings', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_settings():
    """Get all system settings"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for settings
        cursor = db.cursor()
        
        # Create settings table if it doesn't exist
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating settings table: {str(e)}")
        
        # Try to fetch all settings
        try:
            cursor.execute("SELECT key, value FROM settings")
            saved_settings = {row[0]: row[1] for row in cursor.fetchall()}
        except Exception as e:
            logger.warning(f"Error fetching settings: {str(e)}")
            saved_settings = {}
        
        # Default settings
        default_settings = {
            'displayMode': 'landscape',
            'soundEnabled': 'true',
            'autoPrintLabels': 'false',
            'batchSuggestions': 'true',
            'waitTimeWarning': '10',  # minutes
            'displayTimeout': '5',  # minutes
            'autoSendSmsOnComplete': 'true',
            'remindAfterDelay': 'true',
            'reminderDelay': '30',  # seconds
            'showNameOnDisplay': 'true',
            'defaultWaitTime': '10'  # minutes
        }
        
        # Merge saved settings with defaults
        settings = {}
        for key, default_value in default_settings.items():
            if key in saved_settings:
                # Convert string values to appropriate types
                value = saved_settings[key]
                if value.lower() in ('true', 'false'):
                    settings[key] = value.lower() == 'true'
                elif value.isdigit():
                    settings[key] = int(value)
                else:
                    settings[key] = value
            else:
                # Convert default string values to appropriate types
                if default_value.lower() in ('true', 'false'):
                    settings[key] = default_value.lower() == 'true'
                elif default_value.isdigit():
                    settings[key] = int(default_value)
                else:
                    settings[key] = default_value
        
        return jsonify({
            'success': True,
            'settings': settings
        })
    
    except Exception as e:
        logger.error(f"Error fetching settings: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching settings: {str(e)}"
        }), 500



@bp.route('/settings', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def update_all_settings():
    """Update multiple settings at once"""
    try:
        data = request.json
        
        if not isinstance(data, dict):
            return jsonify({
                'success': False,
                'message': 'Request body must be a JSON object with settings'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create settings table if it doesn't exist
        cursor = db.cursor()
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS settings (
                    key VARCHAR(100) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating settings table: {str(e)}")
        
        # Update settings
        updated_settings = {}
        now = datetime.now().isoformat()
        
        for key, value in data.items():
            # Convert value to string for storage
            str_value = str(value).lower() if isinstance(value, bool) else str(value)
            
            try:
                # Use upsert pattern for PostgreSQL
                cursor.execute('''
                    INSERT INTO settings (key, value, updated_at) 
                    VALUES (%s, %s, %s)
                    ON CONFLICT (key) 
                    DO UPDATE SET value = %s, updated_at = %s
                ''', (key, str_value, now, str_value, now))
                
                updated_settings[key] = value
            except Exception as e:
                logger.error(f"Error updating setting {key}: {str(e)}")

        db.commit()

        # Invalidate the in-process settings cache for every written key —
        # _get_setting caches forever, so without this an edited setting
        # (e.g. an SMS template) silently kept its OLD value until the next
        # server restart.
        try:
            cache = getattr(coffee_system, 'settings_cache', None)
            if isinstance(cache, dict):
                for key in updated_settings:
                    cache.pop(key, None)
        except Exception:
            pass

        # Return updated settings
        return jsonify({
            'success': True,
            'settings': updated_settings,
            'message': 'Settings updated successfully'
        })
    
    except Exception as e:
        logger.error(f"Error updating settings: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating settings: {str(e)}"
        }), 500



@bp.route('/settings', methods=['PATCH'])
@jwt_required_with_demo()
# Managers only, like PUT: any key in `settings` can be written here
# (plan tier, PINs, event access), and barista logins are shared.
@role_required_with_demo(['admin', 'staff'])
def update_setting():
    """Update a single setting"""
    try:
        data = request.json
        
        if not isinstance(data, dict) or len(data) != 1:
            return jsonify({
                'success': False,
                'message': 'Request body must be a JSON object with exactly one setting'
            }), 400
        
        # Get the single key-value pair
        key = list(data.keys())[0]
        value = data[key]
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Convert value to string for storage
        str_value = str(value).lower() if isinstance(value, bool) else str(value)
        
        # Update setting
        cursor = db.cursor()
        now = datetime.now().isoformat()
        
        # Use upsert pattern for PostgreSQL
        cursor.execute('''
            INSERT INTO settings (key, value, updated_at) 
            VALUES (%s, %s, %s)
            ON CONFLICT (key) 
            DO UPDATE SET value = %s, updated_at = %s
        ''', (key, str_value, now, str_value, now))
        
        db.commit()
        
        # Return updated setting
        return jsonify({
            'success': True,
            'settings': {key: value},
            'message': f'Setting {key} updated successfully'
        })
    
    except Exception as e:
        logger.error(f"Error updating setting: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating setting: {str(e)}"
        }), 500



@bp.route('/settings/reset', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def reset_settings():
    """Reset settings to default values"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete all settings
        cursor = db.cursor()
        cursor.execute("DELETE FROM settings")
        db.commit()
        
        # Default settings
        default_settings = {
            'displayMode': 'landscape',
            'soundEnabled': True,
            'autoPrintLabels': False,
            'batchSuggestions': True,
            'waitTimeWarning': 10,  # minutes
            'displayTimeout': 5,  # minutes
            'autoSendSmsOnComplete': True,
            'remindAfterDelay': True,
            'reminderDelay': 30,  # seconds
            'showNameOnDisplay': True,
            'defaultWaitTime': 10  # minutes
        }
        
        return jsonify({
            'success': True,
            'settings': default_settings,
            'message': 'Settings reset to defaults'
        })
    
    except Exception as e:
        logger.error(f"Error resetting settings: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error resetting settings: {str(e)}"
        }), 500



@bp.route('/settings/wait-time', methods=['POST', 'PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def update_wait_time():
    """Update the estimated wait time for all stations"""
    try:
        data = request.json
        wait_time = data.get('waitTime')
        
        if wait_time is None:
            logger.error("No wait time provided")
            return jsonify({"success": False, "message": "No wait time provided"})
        
        # Ensure wait time is a number
        try:
            wait_time = int(wait_time)
        except (ValueError, TypeError):
            logger.error(f"Invalid wait time format: {wait_time}")
            return jsonify({"success": False, "message": "Wait time must be a number"})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        
        if not coffee_system:
            logger.error("Coffee system not available")
            return jsonify({"success": False, "message": "Service unavailable"})
        
        # Update wait time setting in database
        db = coffee_system.db
        cursor = db.cursor()
        
        # Update all active stations with new wait time
        cursor.execute('''
            UPDATE station_stats 
            SET wait_time = %s, last_updated = %s
            WHERE status = 'active'
        ''', (wait_time, datetime.now().isoformat()))
        
        # Also update the default wait time in settings
        now = datetime.now().isoformat()
        cursor.execute('''
            INSERT INTO settings (key, value, updated_at) 
            VALUES ('defaultWaitTime', %s, %s)
            ON CONFLICT (key) 
            DO UPDATE SET value = %s, updated_at = %s
        ''', (str(wait_time), now, str(wait_time), now))
        
        db.commit()
        
        logger.info(f"Updated wait time to {wait_time} minutes for all active stations")
        return jsonify({"success": True, "message": f"Wait time updated to {wait_time} minutes"})
    
    except Exception as e:
        logger.error(f"Error updating wait time: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/settings/station-inventory-configs', methods=['GET'])
@jwt_required_with_demo()
def get_station_inventory_configs():
    """Per-station inventory enable/disable + quantity config.

    Previously this lived only in localStorage (StationInventoryConfig.js
    keys 'station_inventory_configs' and 'station_inventory_quantities'),
    so an organiser who set up oat-only-at-station-2 on their laptop
    saw none of it after closing the browser and reopening on a tablet.
    Now backed by the settings KV table so it follows the rest of the
    org config across devices.

    Returns:
      {
        'configs':     { <station_id>: { <category>: { <itemId>: bool } } },
        'quantities':  { <station_id>: { <category>: { <itemId>: number } } }
      }
    Either half can be empty if it's never been saved.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        configs = _kv_get(coffee_system.db, 'station_inventory_configs', default={}) or {}
        quantities = _kv_get(coffee_system.db, 'station_inventory_quantities', default={}) or {}
        return jsonify({
            'success': True,
            'configs': configs,
            'quantities': quantities,
        })
    except Exception as e:
        logger.error(f"get_station_inventory_configs error: {e}")
        return jsonify({
            'success': False,
            'configs': {},
            'quantities': {},
            'error': str(e),
        }), 200



@bp.route('/settings/event-sessions', methods=['GET'])
@jwt_required_with_demo()
def get_event_sessions():
    """Multi-day event session config consumed by
    EnhancedScheduleManagement.js — what conference sessions are
    happening when, station-by-station lock map, and a per-session
    status (upcoming / in_progress / done).

    Previously this all lived in localStorage so a coordinator
    running the schedule on one device saw a different picture than
    a coordinator on another. Now backed by the settings KV.

    Returns:
      {
        sessions:   [...],   # full session objects (event_sessions)
        statuses:   {...}    # { <session_id>: 'upcoming'|'in_progress'|'done' }
      }
    Either half can be empty.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        sessions = _kv_get(coffee_system.db, 'event_sessions', default=[]) or []
        statuses = _kv_get(coffee_system.db, 'session_statuses', default={}) or {}
        return jsonify({
            'success': True,
            'sessions': sessions,
            'statuses': statuses,
        })
    except Exception as e:
        logger.error(f"get_event_sessions error: {e}")
        return jsonify({
            'success': False,
            'sessions': [],
            'statuses': {},
            'error': str(e),
        }), 200



@bp.route('/settings/event-sessions', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_event_sessions():
    """Save event sessions / per-session status. Accepts either
    field independently so e.g. flipping one session to 'in_progress'
    doesn't require resending all the session definitions."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        if 'sessions' in data and isinstance(data['sessions'], list):
            _kv_put(coffee_system.db, 'event_sessions', data['sessions'])
        if 'statuses' in data and isinstance(data['statuses'], dict):
            _kv_put(coffee_system.db, 'session_statuses', data['statuses'])
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_event_sessions error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/station-inventory-configs', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_station_inventory_configs():
    """Save per-station inventory config. Accepts:
      { 'configs': {...} }         — enable/disable map
      { 'quantities': {...} }      — quantity map
      { 'configs': {...}, 'quantities': {...} }  — both at once
    Either field can be omitted; the missing key isn't touched.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        if 'configs' in data and isinstance(data['configs'], dict):
            _kv_put(coffee_system.db, 'station_inventory_configs', data['configs'])
        if 'quantities' in data and isinstance(data['quantities'], dict):
            _kv_put(coffee_system.db, 'station_inventory_quantities', data['quantities'])
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_station_inventory_configs error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/unlimited-stock', methods=['GET', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def unlimited_stock_setting():
    """Read or set unlimited-stock mode directly (outside Quick Setup).

    Quick Setup was the ONLY writer of this setting, and the generic bulk
    settings PUT writes the wrong value shape AND leaves the per-process
    cache stale — so an operator (or the Test Bench) had no way to toggle
    the mode and see it take effect without re-running the whole wizard.
    POST {enabled: bool} writes the canonical shape and invalidates the
    cache; returns the previous value so callers can restore it exactly.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        previous = bool((_kv_get(db, 'unlimited_stock_mode', default={}) or {}).get('enabled', False))
        if request.method == 'GET':
            return jsonify({'success': True, 'enabled': previous})
        data = request.get_json() or {}
        enabled = bool(data.get('enabled'))
        _kv_put(db, 'unlimited_stock_mode', {'enabled': enabled})
        if hasattr(coffee_system, '_invalidate_unlimited_stock_cache'):
            coffee_system._invalidate_unlimited_stock_cache()
        return jsonify({'success': True, 'enabled': enabled, 'previous': previous})
    except Exception as e:
        logger.error(f"unlimited_stock_setting error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/branding', methods=['GET'])
@jwt_required_with_demo()
def get_branding_settings():
    """Branding (logo, company name, colours, taglines, etc.).

    Frontend's BrandingSettings.js hits PUT /api/settings/branding to
    save; previously the endpoint didn't exist, the PUT 404'd, and
    the save handler caught the error silently — so the client name
    and other branding fields appeared not to save. Persists via the
    same settings-table KV pattern as the other JSON blobs.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        branding = _kv_get(coffee_system.db, 'branding_settings', default={}) or {}
        return jsonify({'success': True, 'settings': branding})
    except Exception as e:
        logger.error(f"get_branding_settings error: {e}")
        return jsonify({'success': False, 'settings': {}, 'error': str(e)}), 200



@bp.route('/settings/branding', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_branding_settings():
    """Save branding settings. Accepts either `{settings: {...}}` (the
    frontend's current format — sends nested under a `settings` key) or
    a bare object."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        # Frontend wraps as {settings: {...}}; tolerate either form.
        payload = data.get('settings') if isinstance(data.get('settings'), dict) else data
        # merge=True: this endpoint is reached by screens that own only
        # part of the blob. Quick Setup sends an event name; the Branding
        # tab sends colours and base64 images. Replacing meant whichever
        # saved last erased the other's work — the images being the
        # expensive half. Clearing an image still works: the Branding tab
        # sends the field as '' rather than dropping it.
        _kv_put(coffee_system.db, 'branding_settings', payload, merge=True)

        # Sponsor lives in TWO places: the display reads it from this
        # branding blob (showSponsor/sponsorName/sponsorMessage), but the
        # SMS path reads separate top-level settings keys
        # (sponsor_display_enabled/sponsor_name/sponsor_message) via
        # coffee_system.get_sponsor_info(). Mirror the branding sponsor
        # fields to those keys so ONE save drives both channels, then
        # refresh the cached sponsor_info (it's loaded once at init).
        if isinstance(payload, dict) and (
            'sponsorName' in payload or 'showSponsor' in payload or 'sponsorMessage' in payload
        ):
            try:
                cur = coffee_system.db.cursor()
                for k, v in (
                    ('sponsor_display_enabled', 'true' if payload.get('showSponsor') else 'false'),
                    ('sponsor_name', payload.get('sponsorName') or ''),
                    ('sponsor_message', payload.get('sponsorMessage') or ''),
                ):
                    cur.execute("""
                        INSERT INTO settings(key, value) VALUES(%s, %s)
                        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                    """, (k, v))
                coffee_system.db.commit()
                # Refresh the in-memory sponsor cache so SMS picks it up
                # without a restart.
                if hasattr(coffee_system, '_load_sponsor_info'):
                    coffee_system._load_sponsor_info()
            except Exception as se:
                logger.warning(f"sponsor mirror to top-level keys failed: {se}")
                try:
                    coffee_system.db.rollback()
                except Exception:
                    pass
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_branding_settings error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/sponsors', methods=['GET'])
def get_sponsor_ticker():
    """Sponsor logo ticker for the display. PUBLIC — the /tv1, /pickup1
    and /kiosk1 screens read this with no login. Logos are public
    marketing images (no PII), so an open read is fine."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        return _revalidating_json({'success': True, **_sponsor_ticker_read(coffee_system.db)})
    except Exception as e:
        logger.error(f"get_sponsor_ticker error: {e}")
        # Fail OPEN to "no ticker" so the display never breaks over this.
        return jsonify({'success': True, 'enabled': False, 'position': 'bottom', 'size': 'small',
                        'tiers': [dict(t) for t in _DEFAULT_TIERS], 'wall': _norm_wall({}),
                        'sponsors': []}), 200



@bp.route('/sponsors', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_sponsor_ticker():
    """Save the sponsor ticker (Organiser Sponsors panel). Replaces the
    whole blob — the panel owns all of it and always sends the full list.
    Caps the list and the per-logo size so one save can't bloat the KV."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        payload = data.get('settings') if isinstance(data.get('settings'), dict) else data
        out = _sponsor_ticker_clean(payload)
        _kv_put(coffee_system.db, 'sponsor_ticker', out, merge=False)
        return jsonify({'success': True, 'settings': out})
    except Exception as e:
        logger.error(f"upsert_sponsor_ticker error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------
# Pre-event pre-orders (client request via Steve): before the event
# opens, SMS orders are SAVED as customer preferences instead of being
# made; the reply template is operator-editable live ({name} {order}
# {event} {sponsor} placeholders — plus any free text: date, opening
# time, spiel). Config in settings KV 'pre_event_settings'.
# ----------------------------------------------------------------------
@bp.route('/settings/pre-event', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_pre_event_settings():
    try:
        coffee_system = current_app.config.get('coffee_system')
        cfg = _kv_get(coffee_system.db, 'pre_event_settings', default={}) or {}
        # Uptake counter so the organiser can see how many pre-orders are in.
        count = 0
        try:
            cur = coffee_system.db.cursor()
            cur.execute(
                "SELECT COUNT(*) FROM customer_preferences WHERE preferred_drink IS NOT NULL")
            row = cur.fetchone()
            count = (row[0] if not isinstance(row, dict) else list(row.values())[0]) or 0
        except Exception:
            try:
                coffee_system.db.rollback()
            except Exception:
                pass
        return jsonify({
            'success': True,
            'settings': {
                'enabled': bool(cfg.get('enabled')),
                'message': cfg.get('message') or '',
            },
            'default_message': coffee_system.PRE_EVENT_DEFAULT_MESSAGE
                if hasattr(coffee_system, 'PRE_EVENT_DEFAULT_MESSAGE') else '',
            'saved_preorders': count,
        })
    except Exception as e:
        logger.error(f"get_pre_event_settings error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/pre-event', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_pre_event_settings():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json(silent=True) or {}
        payload = data.get('settings') if isinstance(data.get('settings'), dict) else data
        cfg = {
            'enabled': bool(payload.get('enabled')),
            'message': str(payload.get('message') or '')[:1600],
        }
        _kv_put(coffee_system.db, 'pre_event_settings', cfg)
        return jsonify({'success': True, 'settings': cfg})
    except Exception as e:
        logger.error(f"upsert_pre_event_settings error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------
# Admin SMS alerts — text a nominated number on error/critical events.
# See services/admin_alerts.py. Config in settings KV 'admin_alerts'.
# ----------------------------------------------------------------------
@bp.route('/settings/admin-alerts', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_admin_alerts():
    try:
        coffee_system = current_app.config.get('coffee_system')
        from services.admin_alerts import load_config
        return jsonify({'success': True, 'config': load_config(coffee_system.db)})
    except Exception as e:
        logger.error(f"get_admin_alerts error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/admin-alerts', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_admin_alerts():
    """Body: {enabled, phone, min_severity('error'|'critical'),
    cooldown_minutes}."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json() or {}
        cfg = {
            'enabled': bool(body.get('enabled')),
            'phone': (body.get('phone') or '').strip(),
            'email': (body.get('email') or '').strip(),
            'min_severity': (body.get('min_severity') or 'critical').lower(),
            'cooldown_minutes': int(body.get('cooldown_minutes') or 15),
        }
        if cfg['min_severity'] not in ('error', 'critical'):
            cfg['min_severity'] = 'critical'
        from services.admin_alerts import CONFIG_KEY
        _kv_put(coffee_system.db, CONFIG_KEY, cfg)
        return jsonify({'success': True, 'config': cfg})
    except Exception as e:
        logger.error(f"put_admin_alerts error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/admin-alerts/test', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def test_admin_alert():
    """Send a test alert to the configured channel(s) — SMS and/or email —
    bypassing the severity gate + cooldown (but still respecting what's set)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        from services.admin_alerts import load_config
        cfg = load_config(coffee_system.db)
        phone = (cfg.get('phone') or '').strip()
        email = (cfg.get('email') or '').strip()
        if not phone and not email:
            return jsonify({'success': False,
                            'error': 'No admin alert phone or email set.'}), 400
        results = {}
        if phone:
            try:
                from services.sms import get_outbound_provider
                r = get_outbound_provider().send(
                    phone,
                    "[Coffee Cue TEST] Admin alerts are working. You'll get a "
                    "message here on error/critical events (rate-limited).",
                )
                results['sms'] = 'sent' if r.ok else (r.error or 'failed')
            except Exception as se:
                results['sms'] = f'error: {se}'
        if email:
            try:
                from services.email_utils import send_html_email, email_enabled
                send_html_email(
                    email, "[Coffee Cue TEST] Admin alerts are working",
                    "<p>This is a test of Coffee Cue admin email alerts. "
                    "You'll get an email here on error/critical events "
                    "(e.g. outbound SMS failing), rate-limited so you're not "
                    "spammed.</p>",
                )
                results['email'] = 'sent' if email_enabled() else (
                    'dry-run — set EMAIL_ENABLED=true + SMTP_* in Railway to '
                    'actually send')
            except Exception as ee:
                results['email'] = f'error: {ee}'
        ok = any(v == 'sent' for v in results.values())
        return jsonify({'success': ok, 'sent': ok, 'results': results})
    except Exception as e:
        logger.error(f"test_admin_alert error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/settings/vip-code', methods=['GET', 'PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def vip_code_setting():
    """Read/write ONLY the VIP code (settings.vip_code), no side effects.

    Quick Setup can also set it, but that path rebuilds the whole event —
    a destructive, alarming flow for a one-field change (Steve: 'all I was
    trying to do was add a VIP code and this looks scary and dangerous').
    This is the safe, standalone editor: it touches nothing but this key.
    """
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    if request.method == 'PUT':
        body = request.get_json(silent=True) or {}
        code = str(body.get('vip_code') or body.get('code') or '').strip()[:64]
        try:
            cur = db.cursor()
            if code:
                cur.execute(
                    "INSERT INTO settings(key, value) VALUES('vip_code', %s) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (code,))
            else:
                cur.execute("DELETE FROM settings WHERE key = 'vip_code'")
            db.commit()
            return jsonify({'success': True, 'vip_code': code})
        except Exception as e:
            try:
                db.rollback()
            except Exception:
                pass
            return jsonify({'success': False, 'message': str(e)}), 500
    try:
        cur = db.cursor()
        cur.execute("SELECT value FROM settings WHERE key = 'vip_code'")
        r = cur.fetchone()
        val = (r[0] if not isinstance(r, dict) else r.get('value')) if r else ''
        return jsonify({'success': True, 'vip_code': val or ''})
    except Exception:
        return jsonify({'success': True, 'vip_code': ''})



@bp.route('/event-access/verify', methods=['POST'])
def event_access_verify():
    """Check an entered event password WITHOUT placing an order, so the
    ordering page can gate up front instead of at checkout. Public."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        raw = _kv_get(db, ACCESS_SETTING_KEY, default=None)
        if not event_password_required(raw):
            return jsonify({'success': True, 'ok': True})  # no gate
        body = request.get_json(silent=True) or {}
        cfg = event_access_settings(raw)
        ok = str(body.get('password') or '').strip() == cfg['password']
        return jsonify({'success': True, 'ok': bool(ok)})
    except Exception as e:
        logger.warning(f"event_access_verify failed (fail-open): {e}")
        return jsonify({'success': True, 'ok': True})



@bp.route('/event-access/public', methods=['GET'])
def event_access_public():
    """What a PUBLIC ordering page needs to know -- never the secret.

    Tells the order flow whether a password gate is in force so it can
    prompt for one. The password value itself is never returned here.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        raw = _kv_get(db, ACCESS_SETTING_KEY, default=None)
        cfg = event_access_settings(raw)
        return jsonify({
            'success': True,
            'password_required': bool(event_password_required(raw)),
            'code': cfg['code'],
            'require': bool(cfg['require']),
        })
    except Exception as e:
        logger.warning(f"event_access_public failed (fail-open): {e}")
        return jsonify({'success': True, 'password_required': False})



@bp.route('/event-access', methods=['GET', 'PUT'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def event_access_config():
    """The event's ordering code, and whether it is enforced.

    GET  -> {code, require}
    PUT  -> {"code": "ctn26", "require": true}

    Turning `require` on immediately invalidates every QR printed
    without this code, which is right before an event and wrong in the
    middle of one -- so it is opt-in and never defaults on.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        if request.method == 'PUT':
            body = request.get_json(silent=True) or {}
            current = event_access_settings(_kv_get(db, ACCESS_SETTING_KEY, default=None))
            merged = {
                'code': body.get('code', current['code']),
                'require': bool(body.get('require', current['require'])),
                'password': body.get('password', current.get('password', '')),
            }
            cfg = event_access_settings(merged)
            _kv_put(db, ACCESS_SETTING_KEY, cfg)
            if cfg['require'] and not cfg['code']:
                logger.warning(
                    "event_access: require is ON but no code is set - "
                    "ordering stays OPEN until a code is configured")
            logger.info(f"event_access: code={cfg['code']!r} require={cfg['require']}")
            return jsonify({'success': True, **cfg})

        cfg = event_access_settings(_kv_get(db, ACCESS_SETTING_KEY, default=None))
        # The admin card may edit the password, so it needs the value; it
        # is behind auth here (the PUBLIC endpoint below never returns it).
        return jsonify({'success': True, **cfg,
                        'enforcing': bool(cfg['require'] and cfg['code']),
                        'password_set': bool(cfg.get('password'))})
    except Exception as e:
        logger.error(f"event_access_config error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/broadcast', methods=['GET', 'POST', 'DELETE'])
@jwt_required_with_demo()
@writes_need(STAFF_ROLES)
def customer_broadcast():
    """Tell everyone watching their phone that something has gone wrong.

    CTN26 had a 25-minute outage mid-service with no way to say anything
    to the people waiting. This is that channel.

    GET     -> the live notice, or empty
    POST    -> {message?, ttl_minutes?, scope?}  scope: unprinted | all
    DELETE  -> clear it

    Defaults to UNPRINTED orders only. A printed order is already on a
    label and will be made; telling that customer to re-confirm creates
    the duplicate this is meant to prevent. `scope: all` exists for a
    genuine everyone-stop, and has to be asked for.

    The notice expires on its own (30 min default). Whoever sets this is
    mid-incident and will not remember to clear it.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        if request.method == 'DELETE':
            _kv_put(db, BROADCAST_KEY, {})
            logger.info("Customer broadcast cleared")
            return jsonify({'success': True, 'live': False})

        if request.method == 'POST':
            body = request.get_json(silent=True) or {}
            notice = build_broadcast(
                message=body.get('message'),
                ttl_minutes=body.get('ttl_minutes'),
                scope=body.get('scope'),
                now_iso=datetime.now().isoformat())
            _kv_put(db, BROADCAST_KEY, notice)
            logger.warning(
                f"CUSTOMER BROADCAST set (scope={notice['scope']}, "
                f"{notice['ttl_minutes']}m): {notice['message'][:80]}")
            return jsonify({'success': True, 'live': True, **notice})

        raw = _kv_get(db, BROADCAST_KEY, default=None)
        live = broadcast_is_live(raw, datetime.now(),
                                 lambda v: datetime.fromisoformat(str(v)))
        return jsonify({'success': True, 'live': bool(live),
                        **(raw if isinstance(raw, dict) and live else {})})
    except Exception as e:
        logger.error(f"customer_broadcast error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/pricing-settings', methods=['GET'])
@jwt_required_with_demo()
def get_pricing_settings():
    """Per-event pricing for the honor-system payment flow.

    When `enabled` is true, the SMS confirmation message embeds the
    computed total and asks the customer to pay at the counter.
    Defaults to disabled — free events keep their current behavior.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        saved = _kv_get(coffee_system.db, 'pricing_settings', default=None) or {}
        # Deep-merge with defaults so new fields appear without
        # forcing the operator to re-edit existing pricing.
        merged = {**DEFAULT_PRICING, **saved}
        for k in ('per_drink', 'milk_surcharge', 'size_surcharge'):
            if isinstance(saved.get(k), dict):
                merged[k] = {**DEFAULT_PRICING[k], **saved[k]}
        return jsonify(merged)
    except Exception as e:
        logger.error(f"get_pricing_settings error: {e}")
        return jsonify(DEFAULT_PRICING), 200



@bp.route('/pricing-settings', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_pricing_settings():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        # Deep-merge inbound on top of defaults so callers can PATCH
        # individual fields (e.g. just toggle `enabled`).
        merged = {**DEFAULT_PRICING, **data}
        for k in ('per_drink', 'milk_surcharge', 'size_surcharge'):
            if isinstance(data.get(k), dict):
                merged[k] = {**DEFAULT_PRICING[k], **data[k]}
        _kv_put(coffee_system.db, 'pricing_settings', merged)
        # Invalidate the in-process cache so the next SMS confirmation
        # picks up the new pricing without a server restart.
        if hasattr(coffee_system, '_invalidate_pricing_cache'):
            coffee_system._invalidate_pricing_cache()
        return jsonify({'success': True, 'pricing': merged})
    except Exception as e:
        logger.error(f"upsert_pricing_settings error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/walkin-defaults', methods=['GET'])
@jwt_required_with_demo()
def get_walkin_defaults():
    """Get the per-event walk-in dialog defaults.

    Deep-merges saved values on top of the defaults so adding a new
    field here doesn't force the operator to re-save their existing
    config.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        saved = _kv_get(coffee_system.db, 'walkin_defaults', default=None) or {}
        merged = {**DEFAULT_WALKIN_DEFAULTS, **saved}
        # Lists shouldn't be deep-merged — saved value replaces default.
        if isinstance(saved.get('default_milk_preference_order'), list):
            merged['default_milk_preference_order'] = saved['default_milk_preference_order']
        return jsonify(merged)
    except Exception as e:
        logger.error(f"get_walkin_defaults error: {e}")
        return jsonify(DEFAULT_WALKIN_DEFAULTS), 200



@bp.route('/walkin-defaults', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_walkin_defaults():
    """Save the walk-in dialog defaults. Accepts a partial blob —
    fields not included keep their current saved value (or fall back
    to DEFAULT_WALKIN_DEFAULTS if never saved).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        # Merge with current saved (not just defaults), so PUT with one
        # field doesn't blow away the other fields.
        current = _kv_get(coffee_system.db, 'walkin_defaults', default=None) or {}
        merged = {**DEFAULT_WALKIN_DEFAULTS, **current, **data}
        _kv_put(coffee_system.db, 'walkin_defaults', merged)
        return jsonify({'success': True, 'walkin_defaults': merged})
    except Exception as e:
        logger.error(f"upsert_walkin_defaults error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/order-prefix', methods=['GET'])
@jwt_required_with_demo()
def get_order_prefix():
    """Event prefix prepended to every order number.

    Customers see this on the display: "C12" for "Cairns event,
    order 12". Operator sets it once at the start of the event;
    defaults to empty (just digits).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        blob = _kv_get(coffee_system.db, 'order_prefix', default=None)
        prefix = ''
        if isinstance(blob, dict):
            prefix = (blob.get('prefix') or '').strip()
        elif isinstance(blob, str):
            prefix = blob.strip()
        return jsonify({'prefix': prefix})
    except Exception as e:
        logger.error(f"get_order_prefix error: {e}")
        return jsonify({'prefix': ''}), 200



@bp.route('/order-prefix', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_order_prefix():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        prefix = (data.get('prefix') or '').strip()
        # Keep it short and reasonable — single letter to 6 chars,
        # alphanumeric only. Falls back to whatever the operator sent
        # if it's valid; otherwise rejects.
        if prefix and not (len(prefix) <= 6 and prefix.replace(' ', '').isalnum()):
            return jsonify({'success': False,
                            'error': 'prefix must be alphanumeric, max 6 chars'}), 400
        _kv_put(coffee_system.db, 'order_prefix', {'prefix': prefix})
        return jsonify({'success': True, 'prefix': prefix})
    except Exception as e:
        logger.error(f"upsert_order_prefix error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/routing-rules', methods=['GET'])
@jwt_required_with_demo()
def get_routing_rules():
    """Load-balancing preferences read by _assign_station.

    The Barista → Queue AI tab edits these in a localStorage-only
    blob today; persisting them server-side means the toggles
    actually influence backend routing (and they survive a barista
    logging in on a different machine).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        rules = _kv_get(coffee_system.db, 'routing_rules', default=None)
        merged = {**DEFAULT_ROUTING_RULES, **(rules or {})}
        return jsonify(merged)
    except Exception as e:
        logger.error(f"get_routing_rules error: {e}")
        return jsonify(DEFAULT_ROUTING_RULES), 200



@bp.route('/routing-rules', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(MANAGER_ROLES)
def upsert_routing_rules():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        merged = {**DEFAULT_ROUTING_RULES, **data}
        _kv_put(coffee_system.db, 'routing_rules', merged)
        # Invalidate any cache in coffee_system so the change applies
        # to the very next order, not 60s later.
        if hasattr(coffee_system, '_invalidate_routing_rules_cache'):
            coffee_system._invalidate_routing_rules_cache()
        return jsonify({'success': True, 'rules': merged})
    except Exception as e:
        logger.error(f"upsert_routing_rules error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/notices/active', methods=['GET'])
def notices_active_public():
    """What is on right now. Public on purpose -- the board has no login and
    neither does the phone in a customer's hand.

    ?surface=screen|phone filters to the surfaces the notice was actually
    aimed at, so "just tell the baristas' screens" doesn't end up on a
    stranger's beacon. ?station_id= adds that cart's own notices to the
    event-wide ones.
    """
    try:
        surface = (request.args.get('surface') or '').strip().lower()
        station_id = request.args.get('station_id')
        conn = _notice_db()
        cur = conn.cursor()
        where = ["cleared_at IS NULL",
                 "(expires_at IS NULL OR expires_at > (NOW() AT TIME ZONE 'UTC'))"]
        params = []
        if surface == 'screen':
            where.append("on_screens = TRUE")
        elif surface == 'phone':
            where.append("on_phones = TRUE")
        if station_id and str(station_id).isdigit():
            where.append("(station_id IS NULL OR station_id = %s)")
            params.append(int(station_id))
        cur.execute(
            f"SELECT {_NOTICE_COLS} FROM event_notices WHERE "
            + " AND ".join(where) + " ORDER BY created_at DESC LIMIT 5",
            tuple(params))
        rows = [_notice_row_to_dict(r) for r in cur.fetchall()]
        cur.close()
        return jsonify({'status': 'success', 'notices': rows})
    except Exception as e:
        logger.error(f"notices_active_public error: {e}")
        # A board that can't read notices must still show coffee.
        return jsonify({'status': 'success', 'notices': []})



@bp.route('/notices', methods=['GET'])
@role_required_with_demo(['admin', 'staff', 'barista'])
def notices_list():
    """Recent notices, live ones first, so the runner can see what is already
    up before adding another one."""
    try:
        conn = _notice_db()
        cur = conn.cursor()
        cur.execute(
            f"SELECT {_NOTICE_COLS} FROM event_notices "
            "ORDER BY created_at DESC LIMIT 25")
        rows = [_notice_row_to_dict(r) for r in cur.fetchall()]
        cur.close()
        now = datetime.utcnow()
        for r in rows:
            expired = bool(r['expiresAt']) and r['expiresAt'] < now.isoformat()
            r['live'] = not r['clearedAt'] and not expired
        return jsonify({'status': 'success', 'notices': rows})
    except Exception as e:
        logger.error(f"notices_list error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500



@bp.route('/notices', methods=['POST'])
@role_required_with_demo(['admin', 'staff', 'barista'])
def notices_create():
    """Put up a notice.

    Body: message, level (info|warning), minutes (0 = until taken down),
          onScreens, onPhones, bySms, audience (for the SMS leg), stationId.

    The SMS leg reuses the existing broadcast machinery rather than growing a
    second way to send a text -- same audience rules, same cap, same log.
    """
    try:
        data = request.get_json() or {}
        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({'status': 'error',
                            'message': 'Type the message first'}), 400
        if len(message) > NOTICE_MAX_LEN:
            return jsonify({'status': 'error',
                            'message': f'Keep it under {NOTICE_MAX_LEN} characters'}), 400
        level = (data.get('level') or 'info').lower()
        if level not in NOTICE_LEVELS:
            level = 'info'
        on_screens = bool(data.get('onScreens', True))
        on_phones = bool(data.get('onPhones', True))
        by_sms = bool(data.get('bySms', False))
        if not (on_screens or on_phones or by_sms):
            return jsonify({'status': 'error',
                            'message': 'Choose at least one place to show it'}), 400
        try:
            minutes = int(data.get('minutes') or 0)
        except (TypeError, ValueError):
            minutes = 0
        minutes = max(0, min(minutes, 480))
        station_id = data.get('stationId')
        station_id = int(station_id) if str(station_id or '').isdigit() else None

        sms_sent = 0
        sms_error = None
        if by_sms:
            sms_sent, sms_error = _notice_send_sms(
                message, data.get('audience') or 'today')

        conn = _notice_db()
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO event_notices
               (message, level, on_screens, on_phones, by_sms, sms_sent,
                station_id, created_by, expires_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,
                       CASE WHEN %s > 0
                            THEN (NOW() AT TIME ZONE 'UTC') + (%s * INTERVAL '1 minute')
                            ELSE NULL END)
               RETURNING """ + _NOTICE_COLS,
            (message, level, on_screens, on_phones, by_sms, sms_sent,
             station_id, _notice_actor(), minutes, minutes))
        row = _notice_row_to_dict(cur.fetchone())
        conn.commit()
        cur.close()
        _notice_broadcast(row)
        return jsonify({'status': 'success', 'notice': row,
                        'smsSent': sms_sent, 'smsError': sms_error})
    except Exception as e:
        logger.error(f"notices_create error: {e}")
        try:
            _notice_db()
        except Exception:
            pass
        return jsonify({'status': 'error', 'message': str(e)}), 500



@bp.route('/notices/<int:notice_id>/clear', methods=['POST'])
@role_required_with_demo(['admin', 'staff', 'barista'])
def notices_clear(notice_id):
    """Take it down. Everything that showed it stops showing it."""
    try:
        conn = _notice_db()
        cur = conn.cursor()
        cur.execute(
            "UPDATE event_notices SET cleared_at = (NOW() AT TIME ZONE 'UTC') "
            "WHERE id = %s AND cleared_at IS NULL RETURNING " + _NOTICE_COLS,
            (notice_id,))
        row = cur.fetchone()
        conn.commit()
        cur.close()
        if not row:
            return jsonify({'status': 'success', 'cleared': False})
        _notice_broadcast(_notice_row_to_dict(row), cleared=True)
        return jsonify({'status': 'success', 'cleared': True})
    except Exception as e:
        logger.error(f"notices_clear error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
