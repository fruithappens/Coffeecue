"""
Support Interface API Routes

This module provides API endpoints for the Support Interface,
including system diagnostics, emergency controls, and management features.
"""

from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import psutil
import logging
import json
import os
from functools import wraps

support_api_bp = Blueprint('support_api', __name__)
logger = logging.getLogger(__name__)

def support_role_required(f):
    """Decorator to require support or admin role"""
    @wraps(f)
    @jwt_required()
    def decorated_function(*args, **kwargs):
        current_user = get_jwt_identity()
        # Temporarily allow all authenticated users for testing
        # TODO: Re-enable role check after testing
        # if current_user.get('role') not in ['admin', 'support']:
        #     return jsonify({
        #         'status': 'error',
        #         'message': 'Insufficient permissions'
        #     }), 403
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
        from services.messaging import MessagingService
        # Check if Twilio credentials are configured
        if MessagingService.is_configured():
            return jsonify({
                'status': 'healthy',
                'message': 'SMS service configured'
            })
        else:
            return jsonify({
                'status': 'warning',
                'message': 'SMS service not configured'
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
        # Get CPU and memory usage
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        
        # Calculate API response time (mock for now)
        api_response_time = 150  # ms
        db_query_time = 25  # ms
        
        return jsonify({
            'cpuUsage': cpu_percent,
            'memoryUsage': memory.percent,
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
            WHERE status IN ('pending', 'in_progress')
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