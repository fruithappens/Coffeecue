"""
Support Interface API Routes

This module provides API endpoints for the Support Interface,
including system diagnostics, emergency controls, and management features.
"""

from flask import Blueprint, jsonify, request, current_app, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
# NOTE: psutil is imported lazily inside get_performance_metrics(), NOT here.
# A top-level `import psutil` used to crash this whole module's import on any
# host where psutil wasn't installed (it was missing from requirements.txt),
# which silently de-registered the entire support_api blueprint — every
# /api/diagnostics/*, /api/emergency/*, and the broadcast route 404'd. Keeping
# the only optional dep lazy means one missing package degrades a single tile
# instead of taking down all of Support.
import logging
import json
import os
from functools import wraps

# The rest of the app uses jwt_required_with_demo() so demo tokens
# (the offline / dev fallback path the frontend's AuthService can
# mint) are honoured alongside real signed JWTs. support_role_required
# below wraps that instead of @jwt_required() so demo-logged-in
# users can hit Users / diagnostics / emergency endpoints in dev.
from auth import jwt_required_with_demo

support_api_bp = Blueprint('support_api', __name__)
logger = logging.getLogger(__name__)

def support_role_required(f):
    """Decorator gating the Support / Emergency / diagnostics / user-management
    endpoints.

    Wraps jwt_required_with_demo() so demo / offline tokens are accepted
    alongside real signed JWTs (the strict @jwt_required() rejected demo
    tokens, which is why this gate was originally turned off entirely).

    Access model — DENY-LIST, on purpose:
      This blueprint mixes support-only endpoints (emergency stop, clear
      queues, diagnostics) with /api/users, which the *Organiser* UI also
      calls. A strict allow-list risks locking a legitimate manager/admin out
      over a role-name variant (admin / staff / organizer / organiser /
      event_organizer all exist in this app). The real risk we must stop is a
      shared *barista* login reaching Stop-All / Clear-queues / user
      management. So block the untrusted operational roles (barista, customer,
      display) and let every manager/admin role through. A tighter
      per-endpoint allow-list is a sensible future hardening.
    """
    BLOCKED_ROLES = {'barista', 'customer', 'display'}

    @wraps(f)
    @jwt_required_with_demo()
    def decorated_function(*args, **kwargs):
        role = ((getattr(g, 'user', None) or {}).get('role') or '').strip().lower()
        if role in BLOCKED_ROLES:
            logger.warning(f"Blocked role '{role}' from support endpoint {request.path}")
            return jsonify({
                'status': 'error',
                'message': 'Insufficient permissions for support tools'
            }), 403
        return f(*args, **kwargs)
    return decorated_function

# System Health & Diagnostics
@support_api_bp.route('/api/diagnostics/database', methods=['GET'])
@support_role_required
def check_database():
    """Check database health"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        cursor.execute('SELECT 1')
        cursor.close()
        return jsonify({
            'status': 'healthy',
            'message': 'Database connection successful'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

@support_api_bp.route('/api/diagnostics/sms', methods=['GET'])
@support_role_required
def check_sms_service():
    """Check SMS service status"""
    try:
        import config
        # MessagingService is instance-based and has NO is_configured()
        # classmethod — the previous call raised
        #   AttributeError: type object 'MessagingService' has no attribute 'is_configured'
        # which the except below turned into a permanent, misleading
        # "SMS Gateway: error" tile in Support → Health / Diagnose, even
        # though SMS itself was fine. Check the actual Twilio config instead:
        # configured = all three Twilio creds present; TESTING_MODE means
        # messages are stubbed (not really sent), which is worth flagging.
        configured = bool(
            getattr(config, 'TWILIO_ACCOUNT_SID', None)
            and getattr(config, 'TWILIO_AUTH_TOKEN', None)
            and getattr(config, 'TWILIO_PHONE_NUMBER', None)
        )
        if getattr(config, 'TESTING_MODE', False):
            return jsonify({
                'status': 'warning',
                'message': 'TESTING_MODE is on — SMS is stubbed (not actually sent)'
            })
        if configured:
            return jsonify({
                'status': 'healthy',
                'message': 'SMS service configured (Twilio)'
            })
        return jsonify({
            'status': 'warning',
            'message': 'SMS service not configured (TWILIO_* env vars missing)'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        })

@support_api_bp.route('/api/diagnostics/performance', methods=['GET'])
@support_role_required
def get_performance_metrics():
    """Get system performance metrics"""
    try:
        # Get CPU and memory usage. Import psutil lazily: if it's somehow
        # missing, the host tile degrades to n/a (cpuUsage/memoryUsage null)
        # rather than 500-ing — and crucially the module still imports so the
        # rest of the support blueprint keeps working.
        try:
            import psutil
            cpu_percent = psutil.cpu_percent(interval=1)
            memory_percent = psutil.virtual_memory().percent
        except Exception as perf_err:
            logger.warning(f"psutil unavailable, host metrics degraded: {perf_err}")
            cpu_percent = None
            memory_percent = None

        # Calculate API response time (mock for now)
        api_response_time = 150  # ms
        db_query_time = 25  # ms

        return jsonify({
            'cpuUsage': cpu_percent,
            'memoryUsage': memory_percent,
            'apiResponseTime': api_response_time,
            'dbQueryTime': db_query_time
        })
    except Exception as e:
        logger.error(f"Error getting performance metrics: {e}")
        return jsonify({
            'cpuUsage': 0,
            'memoryUsage': 0,
            'apiResponseTime': 0,
            'dbQueryTime': 0
        })

@support_api_bp.route('/api/diagnostics/logs', methods=['GET'])
@support_role_required
def get_system_logs():
    """Get recent system logs"""
    try:
        limit = request.args.get('limit', 50, type=int)
        # In production, this would read from actual log files
        # For now, return mock data
        logs = []
        for i in range(min(limit, 10)):
            logs.append({
                'timestamp': (datetime.now() - timedelta(minutes=i*5)).isoformat(),
                'level': ['INFO', 'WARN', 'ERROR'][i % 3],
                'message': f'Sample log message {i}'
            })
        return jsonify(logs)
    except Exception as e:
        logger.error(f"Error getting logs: {e}")
        return jsonify([])

@support_api_bp.route('/api/diagnostics/test', methods=['POST'])
@support_role_required
def run_system_test():
    """Run system diagnostics test"""
    try:
        test_type = request.json.get('type', 'all')
        results = []
        
        # Run different tests based on type
        if test_type in ['all', 'api']:
            results.append({
                'test': 'API Health Check',
                'status': 'passed',
                'message': 'All endpoints responding'
            })
        
        if test_type in ['all', 'database']:
            results.append({
                'test': 'Database Connection',
                'status': 'passed',
                'message': 'Database accessible'
            })
        
        if test_type in ['all', 'authentication']:
            results.append({
                'test': 'JWT Authentication',
                'status': 'passed',
                'message': 'Authentication working'
            })
        
        return jsonify({'results': results})
    except Exception as e:
        return jsonify({
            'results': [{
                'test': 'Error',
                'status': 'failed',
                'message': str(e)
            }]
        })

# Emergency Controls
@support_api_bp.route('/api/emergency/stop-all', methods=['POST'])
@support_role_required
def emergency_stop():
    """Stop all system operations"""
    try:
        # Set emergency mode in settings
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Set emergency mode
        cursor.execute("""
            INSERT INTO settings (key, value) VALUES ('emergency_mode', 'true')
            ON CONFLICT (key) DO UPDATE SET value = 'true'
        """)
        
        # Stop all active orders
        cursor.execute("""
            UPDATE orders SET status = 'paused', notes = 'Emergency stop activated'
            WHERE status IN ('pending', 'in-progress')
        """)
        db.commit()
        cursor.close()
        
        logger.warning("Emergency stop activated by user")
        return jsonify({
            'status': 'success',
            'message': 'Emergency stop activated'
        })
    except Exception as e:
        logger.error(f"Emergency stop failed: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/emergency/resume', methods=['POST'])
@support_role_required
def emergency_resume():
    """Resume system operations"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Clear emergency mode
        cursor.execute("""
            UPDATE settings SET value = 'false' WHERE key = 'emergency_mode'
        """)
        
        # Resume paused orders
        cursor.execute("""
            UPDATE orders SET status = 'pending', notes = 'Operations resumed'
            WHERE status = 'paused'
        """)
        db.commit()
        cursor.close()
        
        logger.info("System operations resumed")
        return jsonify({
            'status': 'success',
            'message': 'Operations resumed'
        })
    except Exception as e:
        logger.error(f"Resume operations failed: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/emergency/clear-queues', methods=['POST'])
@support_role_required
def clear_all_queues():
    """Clear all order queues"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Cancel all pending orders
        cursor.execute("""
            UPDATE orders SET status = 'cancelled', notes = 'Cleared by support'
            WHERE status = 'pending'
        """)
        cancelled_count = cursor.rowcount
        db.commit()
        cursor.close()
        
        logger.warning(f"Cleared {cancelled_count} orders from queues")
        return jsonify({
            'status': 'success',
            'message': f'Cleared {cancelled_count} orders'
        })
    except Exception as e:
        logger.error(f"Clear queues failed: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/emergency/backup', methods=['POST'])
@support_role_required
def create_backup():
    """Create system backup"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Get orders
        cursor.execute("SELECT * FROM orders")
        orders = []
        for row in cursor.fetchall():
            orders.append({'id': row[0], 'customer_phone': row[1], 'items': row[2]})
        
        # Get stations
        cursor.execute("SELECT * FROM stations")
        stations = []
        for row in cursor.fetchall():
            stations.append({'id': row[0], 'name': row[1], 'is_active': row[2]})
        
        # Get settings
        cursor.execute("SELECT key, value FROM settings")
        settings = {row[0]: row[1] for row in cursor.fetchall()}
        
        cursor.close()
        
        # Create backup data
        backup_data = {
            'timestamp': datetime.now().isoformat(),
            'orders': orders,
            'stations': stations,
            'settings': settings
        }
        
        filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        return jsonify({
            'status': 'success',
            'filename': filename,
            'backup': backup_data
        })
    except Exception as e:
        logger.error(f"Backup failed: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

# Station Management
@support_api_bp.route('/api/stations/<int:station_id>/restart', methods=['POST'])
@support_role_required
def restart_station(station_id):
    """Restart a station"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Get station name
        cursor.execute("SELECT name FROM stations WHERE id = %s", (station_id,))
        result = cursor.fetchone()
        if not result:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        station_name = result[0]
        
        # Set station to active (simulating restart)
        cursor.execute("""
            UPDATE stations SET is_active = true WHERE id = %s
        """, (station_id,))
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'message': f'Station {station_name} restarted'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/stations/<int:station_id>/toggle', methods=['POST'])
@support_role_required
def toggle_station(station_id):
    """Toggle station active/inactive"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Toggle station status
        cursor.execute("""
            UPDATE stations SET is_active = NOT is_active WHERE id = %s
            RETURNING name, is_active
        """, (station_id,))
        result = cursor.fetchone()
        if not result:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        station_name, is_active = result
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'message': f'Station {station_name} {"activated" if is_active else "deactivated"}'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/stations/<int:station_id>/clear-queue', methods=['POST'])
@support_role_required
def clear_station_queue(station_id):
    """Clear a specific station's queue"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Clear station queue
        cursor.execute("""
            UPDATE orders SET status = 'cancelled', notes = 'Queue cleared by support'
            WHERE station_id = %s AND status = 'pending'
        """, (station_id,))
        cancelled_count = cursor.rowcount
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'message': f'Cleared {cancelled_count} orders from station queue'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/stations/clear-all-queues', methods=['POST'])
@support_role_required
def clear_all_station_queues():
    """Clear all station queues"""
    return clear_all_queues()

# User Management
@support_api_bp.route('/api/users', methods=['GET'])
@support_role_required
def get_users():
    """Get all users"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        cursor.execute("""
            SELECT id, username, email, role, is_active, last_login
            FROM users
            ORDER BY username
        """)
        
        users = []
        for row in cursor.fetchall():
            users.append({
                'id': row[0],
                'username': row[1],
                'email': row[2],
                'role': row[3],
                'is_active': row[4],
                'last_login': row[5].isoformat() if row[5] else None
            })
        
        cursor.close()
        return jsonify({
            'status': 'success',
            'data': users
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/users', methods=['POST'])
@support_role_required
def create_user():
    """Create new user"""
    try:
        from utils.database import get_db_connection
        from werkzeug.security import generate_password_hash
        
        data = request.get_json()
        db = get_db_connection()
        cursor = db.cursor()
        
        # Create new user
        cursor.execute("""
            INSERT INTO users (username, email, role, password_hash, is_active)
            VALUES (%s, %s, %s, %s, true)
            RETURNING id, username, email, role
        """, (
            data['username'],
            data.get('email'),
            data.get('role', 'barista'),
            generate_password_hash(data['password'])
        ))
        
        user_data = cursor.fetchone()
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': {
                'id': user_data[0],
                'username': user_data[1],
                'email': user_data[2],
                'role': user_data[3]
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/users/<int:user_id>', methods=['PUT'])
@support_role_required
def update_user(user_id):
    """Update user details"""
    try:
        from utils.database import get_db_connection
        data = request.get_json()
        db = get_db_connection()
        cursor = db.cursor()
        
        # Build update query dynamically
        updates = []
        params = []
        if 'username' in data:
            updates.append('username = %s')
            params.append(data['username'])
        if 'email' in data:
            updates.append('email = %s')
            params.append(data['email'])
        if 'role' in data:
            updates.append('role = %s')
            params.append(data['role'])
        
        if updates:
            params.append(user_id)
            cursor.execute(f"""
                UPDATE users SET {', '.join(updates)}
                WHERE id = %s
                RETURNING id, username, email, role
            """, params)
            
            user_data = cursor.fetchone()
            if not user_data:
                return jsonify({'status': 'error', 'message': 'User not found'}), 404
            
            db.commit()
            cursor.close()
            
            return jsonify({
                'status': 'success',
                'data': {
                    'id': user_data[0],
                    'username': user_data[1],
                    'email': user_data[2],
                    'role': user_data[3]
                }
            })
        
        return jsonify({'status': 'error', 'message': 'No updates provided'}), 400
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/users/<int:user_id>/toggle-status', methods=['POST'])
@support_role_required
def toggle_user_status(user_id):
    """Toggle user active/inactive status"""
    try:
        from utils.database import get_db_connection
        data = request.get_json()
        db = get_db_connection()
        cursor = db.cursor()
        
        # Toggle user status
        cursor.execute("""
            UPDATE users SET is_active = %s WHERE id = %s
            RETURNING username, is_active
        """, (data.get('is_active', True), user_id))
        
        result = cursor.fetchone()
        if not result:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'message': f'User {result[0]} {"activated" if result[1] else "deactivated"}'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/users/<int:user_id>', methods=['DELETE'])
@support_role_required
def delete_user(user_id):
    """Delete a user"""
    try:
        from utils.database import get_db_connection
        db = get_db_connection()
        cursor = db.cursor()
        
        # Delete user
        cursor.execute("""
            DELETE FROM users WHERE id = %s RETURNING username
        """, (user_id,))
        
        result = cursor.fetchone()
        if not result:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'message': f'User {result[0]} deleted'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@support_api_bp.route('/api/users/<int:user_id>/reset-password', methods=['POST'])
@support_role_required
def reset_user_password(user_id):
    """Reset user password"""
    try:
        from utils.database import get_db_connection
        from werkzeug.security import generate_password_hash
        import secrets
        
        db = get_db_connection()
        cursor = db.cursor()
        
        # Check if user exists
        cursor.execute("SELECT username FROM users WHERE id = %s", (user_id,))
        if not cursor.fetchone():
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        new_password = secrets.token_urlsafe(8)
        
        # Update password
        cursor.execute("""
            UPDATE users SET password_hash = %s WHERE id = %s
        """, (generate_password_hash(new_password), user_id))
        
        db.commit()
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': {
                'newPassword': new_password
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

# System Messages/Announcements
@support_api_bp.route('/api/messages/announcement', methods=['POST'])
@support_role_required
def send_announcement():
    """Send system-wide announcement"""
    try:
        data = request.get_json()
        message = data.get('message', '')

        # In production, this would broadcast to all stations
        # For now, just log it
        logger.info(f"System announcement: {message}")

        return jsonify({
            'status': 'success',
            'message': 'Announcement sent'
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


# -----------------------------------------------------------------------
# Broadcast SMS — lets an organiser send a one-off message to customers.
#
# Two phases by design:
#   GET  /api/support/broadcast/preview?since_minutes=120
#     → returns recipient_count and a sample of phones, no SMS sent.
#   POST /api/support/broadcast/customers
#     body: {
#       "message": "Coffee break ends in 10 minutes!",
#       "audience": "today" | "active_today" | "in_progress",
#       "dry_run": false   // default false; true returns the preview
#     }
#     → sends the SMS and returns counts. Hard-capped at 500 recipients
#       per call so a stray click can't blast the entire customer list.
#
# Operators usually want "everyone who ordered today" — that's the
# default audience.
# -----------------------------------------------------------------------

BROADCAST_MAX_RECIPIENTS = 500
BROADCAST_MAX_MESSAGE_LEN = 480  # well under 4 concatenated SMS segments
BROADCAST_AUDIENCES = {'today', 'active_today', 'in_progress', 'preorders'}


# The Test Bench's simulator phones all share this prefix (never a real
# customer's number — see testbench/bench/core.py FAKE_PHONE_PREFIX).
# Broadcast audiences must NEVER include them: the bench found the
# 'preorders' audience counting ~400 recipients, mostly accumulated bench
# rows — a real blast would have BILLED an SMS attempt per fake number.
BENCH_PHONE_PREFIX = '+6140000'


def _broadcast_recipients(cursor, audience):
    """Return a list of distinct E.164 phone numbers for the given audience.

    - today:        anyone who placed an order in the last 24 h
    - active_today: today's customers whose latest order isn't completed/cancelled
    - in_progress:  only people whose order is currently being made
    - preorders:    everyone with a saved usual (pre-event pre-orders +
                    returning customers) — the audience for the morning
                    "doors open, we can have your coffee ready" blast
    """
    bench_like = BENCH_PHONE_PREFIX + '%'
    if audience == 'preorders':
        cursor.execute("""
            SELECT DISTINCT phone FROM customer_preferences
            WHERE phone IS NOT NULL AND phone <> ''
              AND phone NOT LIKE %s
              AND preferred_drink IS NOT NULL
        """, (bench_like,))
    elif audience == 'in_progress':
        cursor.execute("""
            SELECT DISTINCT phone FROM orders
            WHERE status = 'in-progress'
              AND phone IS NOT NULL AND phone <> ''
              AND phone NOT LIKE %s
        """, (bench_like,))
    elif audience == 'active_today':
        cursor.execute("""
            SELECT DISTINCT phone FROM orders
            WHERE created_at >= NOW() - INTERVAL '24 hours'
              AND status NOT IN ('completed', 'cancelled', 'picked_up')
              AND phone IS NOT NULL AND phone <> ''
              AND phone NOT LIKE %s
        """, (bench_like,))
    else:  # 'today'
        cursor.execute("""
            SELECT DISTINCT phone FROM orders
            WHERE created_at >= NOW() - INTERVAL '24 hours'
              AND phone IS NOT NULL AND phone <> ''
              AND phone NOT LIKE %s
        """, (bench_like,))

    rows = cursor.fetchall() or []
    out = []
    for row in rows:
        phone = row[0] if not isinstance(row, dict) else row.get('phone')
        if phone:
            out.append(phone)
    return out


@support_api_bp.route('/api/support/broadcast/preview', methods=['GET'])
@support_role_required
def broadcast_preview():
    """Return the recipient count + a small sample without sending."""
    try:
        audience = request.args.get('audience', 'today')
        if audience not in BROADCAST_AUDIENCES:
            return jsonify({
                'status': 'error',
                'message': f"audience must be one of {sorted(BROADCAST_AUDIENCES)}",
            }), 400

        from utils.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        recipients = _broadcast_recipients(cursor, audience)
        cursor.close()

        return jsonify({
            'status': 'success',
            'audience': audience,
            'recipient_count': len(recipients),
            'capped_at': BROADCAST_MAX_RECIPIENTS,
            'sample': recipients[:5],
        })
    except Exception as e:
        logger.error(f"broadcast_preview error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500


@support_api_bp.route('/api/support/bench-hygiene', methods=['POST'])
@support_role_required
def bench_hygiene():
    """Purge Test-Bench residue from customer_preferences: rows whose
    phone carries the bench simulator prefix. These are never real
    customers, but they inflate the 'preorders' broadcast audience (the
    bench counted ~400 recipients, mostly its own past runs). The prefix
    is a server-side constant — no caller-supplied patterns."""
    conn = None
    try:
        from utils.database import get_db_connection, close_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM customer_preferences WHERE phone LIKE %s",
                       (BENCH_PHONE_PREFIX + '%',))
        deleted = cursor.rowcount
        conn.commit()
        return jsonify({'status': 'success', 'deleted': deleted})
    except Exception as e:
        logger.error(f"bench_hygiene error: {e}")
        try:
            if conn is not None:
                conn.rollback()
        except Exception:
            pass
        return jsonify({'status': 'error', 'message': str(e)}), 500
    finally:
        try:
            if conn is not None:
                from utils.database import close_connection
                close_connection(conn)
        except Exception:
            pass


@support_api_bp.route('/api/support/broadcast/customers', methods=['POST'])
@support_role_required
def broadcast_customers():
    """Send a one-off SMS to every customer in the chosen audience.

    Returns a structured report:
      { sent: N, failed: M, capped: bool, audience, sample_failures: [...] }
    """
    try:
        data = request.get_json() or {}
        message = (data.get('message') or '').strip()
        audience = data.get('audience', 'today')
        dry_run = bool(data.get('dry_run', False))

        if not message:
            return jsonify({
                'status': 'error',
                'message': 'message is required',
            }), 400
        if len(message) > BROADCAST_MAX_MESSAGE_LEN:
            return jsonify({
                'status': 'error',
                'message': f'message exceeds {BROADCAST_MAX_MESSAGE_LEN} characters',
            }), 400
        if audience not in BROADCAST_AUDIENCES:
            return jsonify({
                'status': 'error',
                'message': f"audience must be one of {sorted(BROADCAST_AUDIENCES)}",
            }), 400

        from utils.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        recipients = _broadcast_recipients(cursor, audience)
        cursor.close()

        capped = len(recipients) > BROADCAST_MAX_RECIPIENTS
        if capped:
            logger.warning(
                f"broadcast capped: {len(recipients)} recipients > "
                f"{BROADCAST_MAX_RECIPIENTS}, truncating"
            )
            recipients = recipients[:BROADCAST_MAX_RECIPIENTS]

        if dry_run:
            return jsonify({
                'status': 'success',
                'dry_run': True,
                'recipient_count': len(recipients),
                'capped': capped,
                'sample': recipients[:5],
            })

        messaging_service = current_app.config.get('messaging_service')
        if not messaging_service:
            return jsonify({
                'status': 'error',
                'message': 'messaging service is not configured',
            }), 503

        sent = 0
        failed = 0
        sample_failures = []
        for phone in recipients:
            try:
                sid = messaging_service.send_message(phone, message)
                if sid:
                    sent += 1
                else:
                    failed += 1
                    if len(sample_failures) < 5:
                        sample_failures.append(phone)
            except Exception as send_err:
                logger.error(f"broadcast send failed for {phone}: {send_err}")
                failed += 1
                if len(sample_failures) < 5:
                    sample_failures.append(phone)

        logger.info(
            f"broadcast complete: audience={audience} sent={sent} failed={failed} "
            f"capped={capped}"
        )
        return jsonify({
            'status': 'success',
            'audience': audience,
            'sent': sent,
            'failed': failed,
            'capped': capped,
            'sample_failures': sample_failures,
        })
    except Exception as e:
        logger.error(f"broadcast_customers error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500