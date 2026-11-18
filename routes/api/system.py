"""Sign-in status, app version, error reports and debug.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import os
import re
from auth import jwt_required_with_demo, role_required_with_demo
from datetime import datetime
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from routes.consolidated_api_routes import (  # noqa: F401
    _build_commit,
    _kv_get,
    _kv_put,
    bp,
    logger,
)



@bp.route('/auth/status', methods=['GET'])
def auth_status():
    """Check authentication status - used by frontend for connection testing"""
    try:
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
        from utils.database import get_db_connection, close_connection
        
        # Check if JWT is present and valid
        try:
            verify_jwt_in_request()
            user_id = get_jwt_identity()
            jwt_data = get_jwt()
            
            # Convert user_id to int since it comes as string from JWT
            user_id_int = int(user_id) if isinstance(user_id, str) else user_id
            
            # Get user info from database
            conn = get_db_connection()
            cursor = conn.cursor()
            
            try:
                cursor.execute('SELECT username, email, role, full_name FROM users WHERE id = %s', (user_id_int,))
                user_record = cursor.fetchone()
                
                if user_record:
                    return jsonify({
                        'success': True,
                        'authenticated': True,
                        'user': {
                            'id': user_id,
                            'username': user_record[0],
                            'email': user_record[1], 
                            'role': user_record[2],
                            'full_name': user_record[3]
                        },
                        'token_info': {
                            'type': jwt_data.get('type'),
                            'expires_at': jwt_data.get('exp')
                        }
                    })
                else:
                    return jsonify({
                        'success': False,
                        'authenticated': False,
                        'message': 'User not found'
                    }), 401
                    
            finally:
                cursor.close()
                close_connection(conn)
                
        except Exception as jwt_error:
            # JWT verification failed
            return jsonify({
                'success': True,
                'authenticated': False,
                'message': 'Authentication required',
                'error': str(jwt_error)
            }), 401
            
    except Exception as e:
        logger.error(f"Error in auth status check: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Internal server error'
        }), 500



@bp.route('/test', methods=['GET'])
def test_api():
    """Simple API connectivity test"""
    return jsonify({
        'success': True, 
        'message': 'API is working',
        'timestamp': datetime.now().isoformat()
    })



@bp.route('/auth/verify', methods=['GET'])
@jwt_required(optional=True)
def auth_verify():
    """Verify if the user is authenticated"""
    try:
        # Get user identity from JWT
        current_user = get_jwt_identity()
        
        if current_user:
            # Get claims
            claims = get_jwt()
            
            return jsonify({
                'success': True,
                'authenticated': True,
                'user': {
                    'id': current_user,
                    'username': claims.get('username'),
                    'role': claims.get('role'),
                    'full_name': claims.get('full_name')
                }
            })
        else:
            return jsonify({
                'success': True,
                'authenticated': False
            })
    
    except Exception as e:
        logger.error(f"Error verifying authentication: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Authentication error'
        }), 500



@bp.route('/auth/me', methods=['GET'])
@jwt_required_with_demo()
def auth_me():
    """Return information about the currently-authenticated user.

    Standard JWT-introspection convenience used by the React UI to
    populate the logged-in indicator and the role-gated menu items.
    Reads from the JWT claims so no DB hit is needed.
    """
    try:
        from flask_jwt_extended import get_jwt, get_jwt_identity
        try:
            ident = get_jwt_identity()
            claims = get_jwt()
        except Exception:
            ident, claims = None, {}
        return jsonify({
            'success': True,
            'user': {
                'id': ident,
                'username': claims.get('username') or claims.get('sub'),
                'email': claims.get('email'),
                'role': claims.get('role'),
                'full_name': claims.get('full_name'),
            },
        })
    except Exception as e:
        logger.error(f"auth_me error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/auth/logout', methods=['GET', 'POST'])
def auth_logout():
    """End this login on the server, not just on the device: the access
    token (Authorization header) and the refresh token (body) are recorded
    as revoked until they would have expired (utils/sessions.py, SEC-004).
    Always answers success: the device has dropped the tokens either way."""
    from flask_jwt_extended import decode_token
    from utils.sessions import revoke
    tokens = []
    auth_header = request.headers.get('Authorization') or ''
    if auth_header.startswith('Bearer '):
        tokens.append(auth_header.split(' ', 1)[1].strip())
    body = request.get_json(silent=True) or {}
    if isinstance(body, dict) and body.get('refreshToken'):
        tokens.append(str(body['refreshToken']))
    ended = 0
    for t in tokens:
        try:
            if revoke(decode_token(t, allow_expired=True)):
                ended += 1
        except Exception:
            pass  # not a token we issued, or already unusable
    return jsonify({'success': True, 'message': 'logout acknowledged', 'ended': ended})



@bp.route('/auth/station-unlock', methods=['POST'])
def station_unlock():
    """Exchange the unlock code for a barista session.

    UNAUTHENTICATED ON PURPOSE -- the whole point is a device that has
    no session yet. Everything protecting it is below:

      * It 404s when no code is set, so a system that never turned this
        on does not advertise that the endpoint exists at all.
      * Failures are throttled per device fingerprint AND overall, so a
        script cannot walk the keyspace and cannot dodge the throttle by
        changing its fingerprint either.
      * A wrong code and a disabled feature produce the same answer
        wherever they can, so probing tells an attacker nothing.

    The session it mints is an ordinary barista token. There is no
    special privilege here and nothing else in the system needs to know
    a session arrived this way -- which is deliberate, because a second
    class of barista session would be a second thing to get wrong.
    """
    try:
        from utils.station_unlock import (ATTEMPTS_KEY, MAX_ATTEMPTS,
                                          MAX_ATTEMPTS_PER_ADDRESS,
                                          SETTING_KEY, is_enabled,
                                          lockout_remaining, record_failure,
                                          verify_code)
        cs = current_app.config.get('coffee_system')
        cfg = _kv_get(cs.db, SETTING_KEY, default={}) or {}
        if not is_enabled(cfg):
            return jsonify({'success': False,
                            'message': 'Not available.'}), 404

        data = request.get_json(silent=True) or {}
        code = data.get('code')

        log = _kv_get(cs.db, ATTEMPTS_KEY, default={}) or {}
        if not isinstance(log, dict):
            log = {}
        # Throttled PER DEVICE and deliberately not globally.
        #
        # A global lock did stop an attacker rotating their device id,
        # and it also meant five wrong guesses disabled the backup
        # station for everyone for fifteen minutes -- a switch any
        # stranger in the room could throw, on the feature that exists
        # for when things have already gone wrong. The code length
        # requirement is what makes scripted guessing hopeless; this
        # throttle only has to stop someone picking up the iPad and
        # trying the obvious ones.
        from security_middleware import _client_ip
        who = str(data.get('device') or request.remote_addr or 'unknown')[:64]
        addr = 'ip:' + str(_client_ip() or 'unknown')[:64]
        for bucket, limit in ((who, MAX_ATTEMPTS), (addr, MAX_ATTEMPTS_PER_ADDRESS)):
            wait = lockout_remaining(log.get(bucket), limit=limit)
            if wait > 0:
                return jsonify({
                    'success': False,
                    'message': (f'Too many tries. Wait about '
                                f'{max(1, wait // 60)} minute(s) and try again.'),
                    'retry_after_seconds': wait,
                }), 429

        if not verify_code(code, cfg.get('code_hash')):
            log[who] = record_failure(log.get(who))
            log[addr] = record_failure(log.get(addr))
            # The global tally is kept but never blocks -- it is there so
            # a burst of failures across many device ids shows up in the
            # log as the scripted attack it would be.
            log['*'] = record_failure(log.get('*'))
            if len(log.get('*') or []) >= MAX_ATTEMPTS:
                logger.warning(
                    "Repeated backup-barista unlock failures across devices "
                    "(latest from %s) - possible guessing attempt", who)
            _kv_put(cs.db, ATTEMPTS_KEY, log)
            return jsonify({'success': False,
                            'message': 'That code is not right.'}), 401

        # Success clears the failures for this device, so a barista who
        # fumbled it twice before getting it right is not four tries from
        # a lockout the next time something goes wrong.
        if who in log or addr in log:
            log.pop(who, None)
            log.pop(addr, None)
            _kv_put(cs.db, ATTEMPTS_KEY, log)

        from flask_jwt_extended import create_access_token, create_refresh_token
        identity = 'backup-barista'
        claims = {'role': 'barista', 'source': 'station-unlock',
                  'username': identity, 'full_name': 'Backup barista'}
        token = create_access_token(identity=identity, additional_claims=claims)
        refresh = create_refresh_token(identity=identity, additional_claims=claims)
        logger.warning("Backup barista station unlocked from %s", who)
        return jsonify({
            'success': True,
            'token': token,
            'refreshToken': refresh,
            'user': {'username': identity, 'role': 'barista',
                     'full_name': 'Backup barista'},
        })
    except Exception as e:
        logger.error(f"station_unlock error: {e}")
        return jsonify({'success': False, 'message': 'Not available.'}), 404



@bp.route('/app-version', methods=['GET'])
def app_version():
    """Which build is currently being served.

    Steve: "hope dont need to always tell baristas to force refresh,
    clear cache, etc."

    He is right that this should not be a human procedure. A tablet that
    has had the app open since setup keeps running the bundle it loaded
    then, and no amount of deploying changes that -- so a fix ships,
    everyone is told it is live, and the one screen that matters is
    still running yesterday's code. That is how he ended up looking at
    oat milk hours after it was removed.

    The bundle FILENAME is the build identity: CRA fingerprints it
    (main.b0471b61.js), so a new deploy always has a different one. The
    page compares the name it loaded against this and offers a reload.

    Public and unauthenticated on purpose: the customer-facing display
    boards go stale too, and they never log in.
    """
    try:
        idx = os.path.join(current_app.static_folder or 'static', 'index.html')
        with open(idx, 'r', encoding='utf8') as fh:
            # Only the head matters and these files are small, but cap the
            # read anyway -- this is on a polled path.
            head = fh.read(20000)
        m = re.search(r'/static/js/(main\.[A-Za-z0-9]+\.js)', head)
        # `commit` is the git commit Railway deployed (it sets
        # RAILWAY_GIT_COMMIT_SHA). The post-deploy CI check waits for it to
        # match what was merged, so a deploy Railway silently skipped shows
        # up as a red check instead of a mystery.
        return jsonify({'success': True, 'bundle': m.group(1) if m else None,
                        'commit': _build_commit()})
    except Exception as e:
        # Never 500 a version check. A page that cannot tell whether it is
        # stale should carry on quietly, not show an error to a barista.
        logger.warning(f"app_version read failed: {e}")
        return jsonify({'success': False, 'bundle': None})



@bp.route('/debug/inventory-schema', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def debug_inventory_schema():
    """Diagnostic (admin): ground truth about the inventory_items table.
    Added because the stock decrement kept failing with 'column
    current_quantity does not exist' while the schema heal appeared to run —
    this returns what the DATABASE actually says, plus a live heal attempt
    with its notes, so the Test Bench can settle it in one call."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        out = {'success': True}
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        try:
            cur.execute("SELECT current_database(), current_user, version()")
            row = cur.fetchone()
            out['database'], out['user'] = row[0], row[1]
            out['pg_version'] = (row[2] or '')[:40]
        except Exception as e:
            out['db_info_error'] = str(e)
        try:
            cur.execute("""
                SELECT table_schema, column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'inventory_items'
                ORDER BY table_schema, ordinal_position
            """)
            out['columns'] = [f"{r[0]}.{r[1]} ({r[2]})" for r in cur.fetchall()]
        except Exception as e:
            out['columns_error'] = str(e)
        try:
            cur.execute("SHOW search_path")
            out['search_path'] = cur.fetchone()[0]
        except Exception as e:
            out['search_path_error'] = str(e)
        out['heal_flag_before'] = bool(getattr(coffee_system, '_inv_qty_cols_ok', False))
        # Force a LIVE heal attempt and capture its notes. commit=True is
        # safe: we rolled back above, so the transaction is fresh.
        coffee_system._inv_qty_cols_ok = False
        coffee_system._stock_errors = []
        try:
            coffee_system._ensure_inventory_quantity_columns(cur, commit=True)
        except Exception as e:
            out['heal_exception'] = str(e)
        out['heal_notes'] = list(getattr(coffee_system, '_stock_errors', []))
        out['heal_flag_after'] = bool(getattr(coffee_system, '_inv_qty_cols_ok', False))
        import os as _os
        out['worker_pid'] = _os.getpid()
        return jsonify(out)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# DEBUGGING ENDPOINTS
# ============================================================================

@bp.route('/debug/database-info', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def database_info():
    """Get information about the database and its tables"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor()
        
        # Get a list of tables - PostgreSQL version
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Get row counts for each table
        table_counts = {}
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                table_counts[table] = count
            except:
                table_counts[table] = "Error counting rows"
        
        # Get sample data from orders if available
        sample_orders = []
        if 'orders' in tables:
            cursor.execute("SELECT * FROM orders LIMIT 3")
            columns = [column[0] for column in cursor.description]
            for row in cursor.fetchall():
                sample_orders.append(dict(zip(columns, row)))
        
        return jsonify({
            'success': True,
            'database_type': 'PostgreSQL',
            'database_url': current_app.config.get('config', {}).get('DATABASE_URL', 'Unknown'),
            'tables': tables,
            'row_counts': table_counts,
            'sample_orders': sample_orders
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'database_type': 'PostgreSQL'
        })


# ----------------------------------------------------------------------
# Client-side error capture.
#
# When a React Error Boundary fires, the user sees a polite fallback
# UI — but until this endpoint existed, neither the operator nor I knew
# anything had broken. Crashes lived and died in localStorage on the
# offending iPad. The UserManagement edit-pencil crash made it to
# production for exactly this reason.
#
# Frontend posts here from ErrorBoundary.componentDidCatch. No auth —
# crashes can happen at the login screen before any token exists, and
# silently dropping them defeats the whole point. Lightly rate-limited
# in the table layer (one row per occurrence; even a thrashing loop
# adds ~10 rows/sec, manageable). Read endpoint IS auth'd so logs
# aren't world-readable.
# ----------------------------------------------------------------------

@bp.route('/client-errors', methods=['POST'])
def report_client_error():
    """Receive a React Error Boundary crash report from the frontend.

    Body shape (everything optional; we take whatever we can get):
      {
        component:       "UserManagementTab",
        message:          "Cannot read properties of undefined...",
        stack:            "TypeError: ...\\n    at startEdit (...)",
        component_stack:  "at UserManagementTab\\n    at ...",
        url:              "https://.../organiser",
        user_id:          "coffeecue",
        user_agent:       "Mozilla/5.0 ...",
        retry_count:      0
      }

    Returns 204 fast — the frontend doesn't care, we just want the
    row written. Failures are swallowed so error reporting never
    becomes the new error.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return ('', 204)
        data = request.get_json(silent=True) or {}
        # Cap each text field at 5KB so a runaway stack can't fill the
        # row to the moon. Stacks above this are almost always recursive.
        def trunc(v, n=5000):
            if v is None:
                return None
            s = str(v)
            return s[:n] if len(s) > n else s
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO client_errors (
                component, message, stack, component_stack,
                url, user_id, user_agent, retry_count
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                trunc(data.get('component'), 100),
                trunc(data.get('message')),
                trunc(data.get('stack')),
                trunc(data.get('component_stack')),
                trunc(data.get('url'), 500),
                trunc(data.get('user_id'), 100),
                trunc(data.get('user_agent'), 500),
                int(data.get('retry_count') or 0),
            ),
        )
        db.commit()
        # Also log so it shows up in the Railway tail. Operator may not
        # check the DB; tailing logs is more natural for "what just broke".
        logger.error(
            "Client error from %s in %s: %s",
            data.get('user_id') or 'anonymous',
            data.get('component') or 'unknown',
            (data.get('message') or '')[:200],
        )
        return ('', 204)
    except Exception as e:
        # Don't bubble — error reporting must never become an error.
        logger.warning(f"report_client_error failed: {e}")
        return ('', 204)



@bp.route('/client-errors/summary', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def client_errors_summary():
    """Crashes grouped: each distinct problem once, with how many times,
    first and last seen, and whether it was the server or a tablet.
    ?hours=N (default 24, max 720). Runner > System > Diagnostics (U4-7)."""
    try:
        hours = max(1, min(int(request.args.get('hours', 24)), 720))
    except ValueError:
        hours = 24
    try:
        db = current_app.config.get('coffee_system').db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(
            """
            SELECT CASE WHEN component = 'server' THEN 'server' ELSE 'tablet' END AS source,
                   LEFT(message, 300) AS msg,
                   CASE WHEN component = 'server' THEN url ELSE component END AS place,
                   COUNT(*), MIN(occurred_at), MAX(occurred_at)
              FROM client_errors
             WHERE occurred_at > NOW() - (%s || ' hours')::interval
             GROUP BY 1, 2, 3
             ORDER BY COUNT(*) DESC, MAX(occurred_at) DESC
             LIMIT 100
            """, (str(hours),))
        rows = cur.fetchall() or []
        db.rollback()
        groups = []
        for r in rows:
            v = list(r.values()) if isinstance(r, dict) else list(r)
            groups.append({'source': v[0], 'message': v[1], 'where': v[2], 'count': int(v[3]),
                           'first': v[4].isoformat() if v[4] else None,
                           'last': v[5].isoformat() if v[5] else None})
        return jsonify({'success': True, 'hours': hours, 'groups': groups,
                        'total': sum(g['count'] for g in groups)})
    except Exception as e:
        logger.error(f"client_errors_summary error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/client-errors', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def list_client_errors():
    """Most recent client crashes, newest first.

    Default 50 rows; ?limit=N up to 500. Used by the Support tab and
    by Claude when answering "what's been crashing?" in a future session.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        limit = min(int(request.args.get('limit', 50)), 500)
        cur = db.cursor()
        cur.execute(
            """
            SELECT id, occurred_at, component, message, url,
                   user_id, retry_count
              FROM client_errors
             ORDER BY occurred_at DESC
             LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall() or []
        errors = []
        for r in rows:
            # Tolerate both DictCursor and tuple cursor shapes — the
            # rest of the codebase isn't consistent about it.
            if isinstance(r, dict):
                errors.append({
                    'id': r['id'],
                    'occurred_at': r['occurred_at'].isoformat() if r['occurred_at'] else None,
                    'component': r['component'],
                    'message': r['message'],
                    'url': r['url'],
                    'user_id': r['user_id'],
                    'retry_count': r['retry_count'],
                })
            else:
                errors.append({
                    'id': r[0],
                    'occurred_at': r[1].isoformat() if r[1] else None,
                    'component': r[2],
                    'message': r[3],
                    'url': r[4],
                    'user_id': r[5],
                    'retry_count': r[6],
                })
        return jsonify({'success': True, 'errors': errors})
    except Exception as e:
        logger.error(f"list_client_errors error: {e}")
        return jsonify({'success': False, 'errors': [], 'error': str(e)}), 200


# ----------------------------------------------------------------------
# Frontend structured events — sibling of /client-errors. Used for
# non-crash signals (feature usage, recoverable failures, slow timings).
# See services/logging_utils.py for the backend-side equivalent.
# ----------------------------------------------------------------------
@bp.route('/client-events', methods=['POST'])
def report_client_event():
    """Sink for sendBeacon()/fetch() POSTs from services/logging.js.

    Wide-open auth (no JWT decorator) so unauthenticated screens (login
    page, landing page) can report events too — same pattern as
    /client-errors. Body shape:
      {code: 'SOME_CODE', payload: {...}, url: '...', user_id: '...'}
    Returns 204 fast — fire-and-forget for the caller.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return ('', 204)
        data = request.get_json(silent=True) or {}
        code = (data.get('code') or '').strip()[:100]
        if not code:
            return ('', 204)
        import json as _json
        payload = data.get('payload') or {}
        if not isinstance(payload, dict):
            payload = {'value': payload}
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO client_events (code, payload, url, user_id, user_agent)
            VALUES (%s, %s::jsonb, %s, %s, %s)
            """,
            (
                code,
                _json.dumps(payload),
                (data.get('url') or '')[:500],
                (data.get('user_id') or '')[:100],
                (data.get('user_agent') or '')[:500],
            ),
        )
        db.commit()
        return ('', 204)
    except Exception as e:
        # Logging must never become an error itself.
        logger.warning(f"report_client_event failed: {e}")
        return ('', 204)



@bp.route('/client-events', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def list_client_events():
    """Recent client events, newest first. Optional ?code=X filter
    for hunting one event type."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        limit = min(int(request.args.get('limit', 50)), 500)
        code_filter = (request.args.get('code') or '').strip()[:100]
        cur = db.cursor()
        if code_filter:
            cur.execute(
                """
                SELECT id, occurred_at, code, payload, url, user_id
                  FROM client_events
                 WHERE code = %s
                 ORDER BY occurred_at DESC
                 LIMIT %s
                """,
                (code_filter, limit),
            )
        else:
            cur.execute(
                """
                SELECT id, occurred_at, code, payload, url, user_id
                  FROM client_events
                 ORDER BY occurred_at DESC
                 LIMIT %s
                """,
                (limit,),
            )
        rows = cur.fetchall() or []
        events = []
        for r in rows:
            if isinstance(r, dict):
                events.append({
                    'id': r['id'],
                    'occurred_at': r['occurred_at'].isoformat() if r['occurred_at'] else None,
                    'code': r['code'],
                    'payload': r['payload'],
                    'url': r['url'],
                    'user_id': r['user_id'],
                })
            else:
                events.append({
                    'id': r[0],
                    'occurred_at': r[1].isoformat() if r[1] else None,
                    'code': r[2],
                    'payload': r[3],
                    'url': r[4],
                    'user_id': r[5],
                })
        return jsonify({'success': True, 'events': events})
    except Exception as e:
        logger.error(f"list_client_events error: {e}")
        return jsonify({'success': False, 'events': [], 'error': str(e)}), 200
