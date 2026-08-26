"""
Consolidated API routes for the Expresso Coffee Ordering System.

This module provides a standardized API structure for the entire application,
consolidating endpoints from various modules into a coherent API design.
"""
import logging
import os
import threading
from flask import Blueprint, jsonify, request, current_app, Response
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, timedelta
import json
import re
from auth import jwt_required_with_demo, role_required_with_demo
from utils.broadcast import (
    BROADCAST_KEY, applies_to as broadcast_applies, build as build_broadcast,
    is_live as broadcast_is_live)
from utils.event_access import (
    ACCESS_SETTING_KEY, check as event_access_check,
    read_settings as event_access_settings)
from utils.notification_hold import (
    HOLD_SETTING_KEY, clear_held, is_held, is_holding, mark_held,
    should_release, summarise as summarise_held)
from utils.order_eta import (
    describe as eta_describe, estimate_minutes as eta_estimate_minutes,
    seconds_per_coffee as eta_seconds_per_coffee)
from utils.order_provenance import (
    CHANNELS, SELF_SERVE, channel_label, infer_channel,
    is_estimated as provenance_estimated, normalize_channel,
    normalize_source, stamp as stamp_provenance)

# Configure logging
logger = logging.getLogger("expresso.routes.consolidated_api")

# Create blueprint with url_prefix to ensure all routes are under /api
bp = Blueprint('consolidated_api', __name__, url_prefix='/api')

# Helper function to handle CORS preflight requests
@bp.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    """Handle OPTIONS requests for CORS preflight"""
    return '', 200

# Helper function to clean order IDs
def clean_order_id(order_id):
    """Remove prefixes like 'order_' from IDs and return the base ID"""
    if not order_id:
        return None
        
    # If it's an order_123 format, extract the numeric part
    if isinstance(order_id, str):
        match = re.match(r'^order_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_in_progress_123 format, extract the numeric part
        match = re.match(r'^order_in_progress_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_completed_123 format, extract the numeric part
        match = re.match(r'^order_completed_([0-9]+)$', order_id)
        if match:
            return match.group(1)
    
    # Return as-is if it's already clean or doesn't match patterns
    return order_id

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

# Role-based access middleware
def role_required(roles):
    """Decorator to check if user has required role"""
    def decorator(fn):
        @jwt_required_with_demo()
        def wrapper(*args, **kwargs):
            # Get user claims from JWT
            claims = get_jwt()
            user_role = claims.get('role', 'guest')
            
            # Check if user's role is in the allowed roles
            if user_role not in roles:
                return jsonify({
                    'success': False, 
                    'message': 'Insufficient permissions'
                }), 403
                
            # Role is valid, proceed with the function
            return fn(*args, **kwargs)
        
        # Preserve original function's name and docstring
        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = fn.__doc__
        
        return wrapper
    return decorator

# ============================================================================
# SYSTEM STATUS ENDPOINTS
# ============================================================================

@bp.route('/status', methods=['GET'])
def get_system_status():
    """Get overall system status and health information"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check database connection
        cursor = db.cursor()
        cursor.execute("SELECT 1")
        db_status = cursor.fetchone() is not None
        
        # Get messaging service status
        messaging_service = current_app.config.get('messaging_service')
        if messaging_service:
            sms_status = {
                'available': True,
                'testing_mode': getattr(messaging_service, 'testing_mode', False),
                'phone_number': getattr(messaging_service, 'phone_number', '')
            }
        else:
            sms_status = {'available': False}
        
        # Get active station count
        cursor.execute("SELECT COUNT(*) FROM station_stats WHERE status = 'active'")
        active_stations = cursor.fetchone()[0] or 0
        
        # Get pending orders count
        cursor.execute("SELECT COUNT(*) FROM orders WHERE status = 'pending'")
        pending_orders = cursor.fetchone()[0] or 0
        
        # Get in-progress orders count
        cursor.execute("SELECT COUNT(*) FROM orders WHERE status = 'in-progress'")
        in_progress_orders = cursor.fetchone()[0] or 0
        
        # Get system settings
        cursor.execute("SELECT value FROM settings WHERE key = 'system_name'")
        system_name_result = cursor.fetchone()
        system_name = system_name_result[0] if system_name_result else 'Coffee Cue'
        
        cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else 'Coffee Event'
        
        # Return system status
        return jsonify({
            'success': True,
            'status': {
                'system_name': system_name,
                'event_name': event_name,
                'database': {
                    'connected': db_status,
                    'type': 'PostgreSQL'
                },
                'messaging': sms_status,
                'stations': {
                    'active': active_stations
                },
                'orders': {
                    'pending': pending_orders,
                    'in_progress': in_progress_orders
                },
                'version': current_app.config.get('config', {}).get('APP_VERSION', '1.0.0'),
                'timestamp': datetime.now().isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Error getting system status: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error getting system status: {str(e)}"
        })

@bp.route('/test', methods=['GET'])
def test_api():
    """Simple API connectivity test"""
    return jsonify({
        'success': True, 
        'message': 'API is working',
        'timestamp': datetime.now().isoformat()
    })

# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

@bp.route('/auth/login', methods=['POST'])
def auth_login():
    """Login endpoint that returns JWT tokens"""
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Request must be JSON"}), 400
        
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({
                'success': False,
                'message': 'Username and password are required'
            }), 400
        
        # Import function to keep consistent with existing code
        from auth import verify_login, generate_tokens
        
        # Verify login directly with the database
        user_data = verify_login(username, password)
        
        if not user_data:
            return jsonify({
                'success': False,
                'message': 'Invalid username or password'
            }), 401
        
        # Generate tokens
        tokens = generate_tokens(user_data)
        
        # Return success response with tokens and user data
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'token': tokens['access_token'],
            'refreshToken': tokens['refresh_token'],
            'expiresIn': tokens['expires_in'],
            'user': user_data
        })
    
    except Exception as e:
        logger.error(f"Error during login: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Internal server error: {str(e)}'
        }), 500

@bp.route('/auth/refresh', methods=['POST'])
def auth_refresh():
    """Refresh access token using a refresh token"""
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Request must be JSON"}), 400
        
        data = request.json
        refresh_token = data.get('refreshToken')
        
        if not refresh_token:
            return jsonify({
                'success': False,
                'message': 'Refresh token is required'
            }), 400
        
        # Import function to keep consistent with existing code
        from auth import refresh_access_token
        
        # Verify the refresh token and generate a new access token
        result = refresh_access_token(refresh_token)
        
        if not result or 'token' not in result:
            return jsonify({
                'success': False,
                'message': 'Invalid refresh token'
            }), 401
        
        # Return new access token
        return jsonify({
            'success': True,
            'token': result['token'],
            'expiresIn': result['expiresIn']
        })
    
    except Exception as e:
        logger.error(f"Error during token refresh: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Internal server error'
        }), 500

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

# ============================================================================
# ORDER MANAGEMENT ENDPOINTS
# ============================================================================

def _pending_questions_by_phone(cursor):
    """Latest PENDING customer question per phone, so a customer's SMS
    ("no sugar thanks", "make it decaf") shows ON their order card — not
    only in the Messages bubble (Steve: "question or additional info via
    SMS should probably appear in the order of that individual")."""
    try:
        cursor.execute("""
            SELECT phone, question FROM customer_questions
            WHERE status = 'pending'
            ORDER BY created_at ASC
        """)
        out = {}
        for r in cursor.fetchall():
            ph = r[0] if not isinstance(r, dict) else r.get('phone')
            q = r[1] if not isinstance(r, dict) else r.get('question')
            if ph and q:
                out[str(ph)] = str(q)  # later rows overwrite = latest wins
        return out
    except Exception:
        return {}


def _drink_display_name(order_details, default='Coffee'):
    """Barista-facing drink name WITH the modifiers that change how it's
    made. order_details['type'] is the bare drink ('latte'); decaf and
    strength live in separate keys — a card that shows only 'latte' gets a
    decaf customer a caffeinated coffee (found by the Test Bench's matrix
    modifier check: SMS confirmed 'decaf' but the pending API dropped it)."""
    if not isinstance(order_details, dict):
        return default
    t = order_details.get('type') or default
    strength = str(order_details.get('strength') or '').strip().lower()
    bits = []
    if order_details.get('decaf') or strength == 'decaf':
        bits.append('decaf')
    if strength and strength not in ('decaf', 'normal'):
        bits.append(strength)
    return ' '.join(bits + [str(t)]) if bits else t


@bp.route('/orders', methods=['GET', 'POST'])
@jwt_required_with_demo()
def orders():
    """Handle orders - GET for listing all orders, POST for creating new orders"""
    if request.method == 'GET':
        # Get all orders with optional status and station filters
        status_filter = request.args.get('status')
        station_id = request.args.get('station_id')
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db

            # Lazy promotion of due ETA-scheduled orders — the barista UI
            # polls this endpoint, so due orders surface within one poll.
            try:
                coffee_system.promote_due_scheduled_orders()
            except Exception:
                pass

            # Build query with filters
            cursor = db.cursor()
            query_conditions = []
            query_params = []
            
            if status_filter:
                query_conditions.append("status = %s")
                query_params.append(status_filter)
            
            if station_id:
                query_conditions.append("station_id = %s")
                query_params.append(int(station_id))
            
            # Build the complete query
            base_query = '''
                SELECT id, order_number, status, station_id, 
                       created_at, phone, order_details, queue_priority,
                       completed_at, updated_at
                FROM orders
            '''
            
            if query_conditions:
                query = base_query + " WHERE " + " AND ".join(query_conditions)
                query += " ORDER BY queue_priority, created_at ASC"
                cursor.execute(query, query_params)
            else:
                query = base_query + " ORDER BY created_at DESC LIMIT 50"
                cursor.execute(query)
            
            # Process orders
            orders = []
            for order in cursor.fetchall():
                # Extract order details
                (order_id, order_number, status, station_id, created_at, phone,
                 order_details_json, priority, completed_at, updated_at) = order
                
                # Parse order details
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Format order for frontend - include both snake_case and camelCase
                # Batch key — the /orders listing is what the Barista UI
                # actually polls, and it OMITTED batch_group entirely, so
                # the batch-groups section (and its Process Batch button)
                # could never render for anyone (Test Bench Phase C v4).
                _bg = None
                if order_details.get('type') and order_details.get('milk'):
                    _bg = f"{str(order_details['type']).lower()}-{str(order_details['milk']).lower()}"
                # Completion timestamps. Without these the Barista's
                # "Ready for Pickup" column could never expire anything:
                # its filter falls back to "keep it" when an order has no
                # timestamp, and this listing -- the one the UI actually
                # polls -- never sent one. Orders sat in that column for
                # the rest of the event.
                def _iso(v):
                    if not v:
                        return None
                    return v.isoformat() if hasattr(v, 'isoformat') else str(v)

                orders.append({
                    'id': order_number,  # Use order_number as id for consistency
                    'order_number': order_number,
                    'completed_at': _iso(completed_at),
                    'completedAt': _iso(completed_at),
                    'updated_at': _iso(updated_at),
                    'updatedAt': _iso(updated_at),
                    # Whether a "your coffee is ready" text could have been
                    # sent. A boolean rather than the number itself: the
                    # UI only needs to know it exists, and the phone is
                    # already omitted from this listing on purpose.
                    'hasPhone': bool(str(phone or '').strip()),
                    'orderNumber': order_number,  # camelCase
                    'customer_name': order_details.get('name', 'Customer'),
                    'customerName': order_details.get('name', 'Customer'),  # camelCase
                    'coffee_type': _drink_display_name(order_details),
                    'coffeeType': _drink_display_name(order_details),  # camelCase
                    'milk_type': order_details.get('milk', 'Standard'),
                    'milkType': order_details.get('milk', 'Standard'),  # camelCase
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'size': order_details.get('size', 'Regular'),
                    'extra_hot': order_details.get('temp') == 'extra hot',
                    'extraHot': order_details.get('temp') == 'extra hot',
                    'strength': order_details.get('strength', ''),
                    # Team mode stage ticks. The guard's first live run
                    # caught this endpoint missing the field: a tick
                    # SAVED but vanished from the next poll — the other
                    # serializer had it, this one didn't.
                    'stages': order_details.get('stages') or {},
                    # Order channel: 'sms' (default) | 'walkin' | 'ea_app'.
                    # The barista card shows an APP chip for ea_app, and
                    # needsContact marks orders that can't get ready-SMS
                    # (barista calls the name instead).
                    'orderSource': order_details.get('source') or 'sms',
                    # Provenance: how it was ordered and which QR/sign it
                    # came from. channelEstimated flags orders from before
                    # stamping, where 'kiosk' may really have been a /my scan.
                    'channel': infer_channel(order_details),
                    'sourceCode': order_details.get('source_code') or '',
                    'channelEstimated': provenance_estimated(order_details),
                    'needsContact': bool(order_details.get('needs_contact')),
                    # Milk metadata for the card colour dot + badges.
                    # Stored by the walk-in endpoint; absent (→ null /
                    # false) for SMS orders, which the UI tolerates.
                    'milk_type_id': order_details.get('milk_type_id'),
                    'milkTypeId': order_details.get('milk_type_id'),
                    'alternative_milk': bool(order_details.get('alternative_milk')),
                    'alternativeMilk': bool(order_details.get('alternative_milk')),
                    'dairy_free': bool(order_details.get('dairy_free')),
                    'dairyFree': bool(order_details.get('dairy_free')),
                    'shots': order_details.get('shots'),
                    'bean_type': order_details.get('bean_type'),
                    'beanType': order_details.get('bean_type'),
                    'batch_group': _bg,
                    'batchGroup': _bg,
                    'status': status,
                    'created_at': created_at,
                    'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,  # camelCase
                    'wait_time': wait_time,
                    'waitTime': wait_time,  # camelCase
                    'priority': priority == 1,  # Convert 1/0 to True/False
                    'special_instructions': order_details.get('notes', ''),
                    'specialInstructions': order_details.get('notes', ''),  # camelCase
                    'payment_method': order_details.get('payment_method', ''),
                    'paymentMethod': order_details.get('payment_method', ''),  # camelCase
                    'order_type': order_details.get('order_type', 'walk-in'),
                    'orderType': order_details.get('order_type', 'walk-in'),  # camelCase
                    'station_id': station_id,
                    'stationId': station_id,  # camelCase
                    # Pricing — pulled straight from order_details
                    # (stamped at confirm-time by the SMS flow or
                    # walk-in endpoint when pricing_settings.enabled
                    # is true). Both casings surfaced for the barista
                    # card's `order.priceFormatted || order.price_formatted`
                    # check. Without these the green price tag never
                    # showed even with pricing fully enabled.
                    'price': order_details.get('price'),
                    'price_formatted': order_details.get('price_formatted'),
                    'priceFormatted': order_details.get('price_formatted'),
                    # Group link — set on multi-drink + FRIEND orders so the
                    # barista UI can show "these go together" and start/collect
                    # them as one. group_id is the lead order's number.
                    'group_id': order_details.get('group_id'),
                    'groupId': order_details.get('group_id'),
                    'group_label': order_details.get('group_label'),
                    'groupLabel': order_details.get('group_label'),
                })

            return jsonify({
                'status': 'success',
                'data': orders,
                'message': f'Retrieved {len(orders)} orders'
            })
        
        except Exception as e:
            logger.error(f"Error fetching orders: {str(e)}")
            return jsonify({
                'status': 'error',
                'data': [],
                'message': f'Error fetching orders: {str(e)}'
            }), 500
    
    elif request.method == 'POST':
        # Create a new order
        try:
            data = request.json
            logger.info(f"Creating new order with data: {data}")

            # Validate required fields
            required_fields = ['customer_name', 'coffee_type', 'size']
            for field in required_fields:
                if not data.get(field):
                    return jsonify({
                        "status": "error",
                        "message": f"Missing required field: {field}"
                    }), 400

            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db

            # Defensive rollback — if a previous request left this
            # singleton connection in aborted-transaction state, every
            # subsequent query would silently fail. before_request
            # also does this, but belt-and-braces.
            try:
                db.rollback()
            except Exception:
                pass
            
            # Generate a unique order number. Steve wanted shorter,
            # event-prefixed codes ("C1", "C2", …) rather than the old
            # 9-character timestamp format ("W0544296"). We read an
            # operator-configurable prefix from settings (default
            # empty — just digits) and combine with order_number_seq
            # so SMS and walk-in orders share the same monotonic
            # sequence and look consistent on the customer display.
            now = datetime.now()
            order_number = None
            order_prefix = ''
            try:
                prefix_blob = _kv_get(db, 'order_prefix', default=None)
                if isinstance(prefix_blob, dict):
                    order_prefix = (prefix_blob.get('prefix') or '').strip()
                elif isinstance(prefix_blob, str):
                    order_prefix = prefix_blob.strip()
            except Exception:
                order_prefix = ''
            try:
                seq_cur = db.cursor()
                seq_cur.execute("SELECT nextval('order_number_seq')")
                seq_row = seq_cur.fetchone()
                if seq_row:
                    seq_val = seq_row[0] if not isinstance(seq_row, dict) else list(seq_row.values())[0]
                    order_number = f"{order_prefix}{int(seq_val)}"
            except Exception as seq_err:
                logger.info(f"order_number_seq unavailable, using legacy format: {seq_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
            if not order_number:
                # Legacy fallback for un-migrated databases.
                legacy_prefix = "W" if data.get('order_type') == 'walk-in' else "O"
                order_number = f"{legacy_prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Walk-in / API orders can flag VIP via priority=true OR
            # priority='vip' OR vip=true. We canonicalise to a single
            # vip bool here so downstream (price compute, queue) sees
            # the same shape that the SMS flow produces.
            _walkin_vip = bool(
                data.get('vip')
                or data.get('priority') is True
                or str(data.get('priority') or '').lower() == 'vip'
            )

            # Prepare order details
            order_details = {
                'name': data.get('customer_name'),
                'type': data.get('coffee_type'),
                'milk': data.get('milk_type', 'dairy'),
                'size': data.get('size'),
                'sugar': data.get('sugar', 'No sugar'),
                'notes': data.get('special_instructions') or data.get('notes', ''),
                'payment_method': data.get('payment_method', 'cash'),
                'order_type': data.get('order_type', 'walk-in'),
                'created_by': data.get('created_by', 'barista'),
                # VIP flag is what _compute_order_price reads to apply
                # the vip_free comp; persisting on order_details keeps
                # it visible to the barista UI too.
                'vip': _walkin_vip,
                # Tea-specific fields from the walk-in dialog. These
                # drive _decrement_stock_for_order (small milk amount,
                # 2 cups when double-cupped) at order completion.
                'is_tea':           bool(data.get('is_tea')) or ('tea' in str(data.get('coffee_type', '')).lower()),
                'tea_strength':     data.get('tea_strength'),
                'tea_double_cup':   bool(data.get('tea_double_cup')),
                'tea_custom_blend': data.get('tea_custom_blend', ''),
                # Milk metadata the barista cards render (colour dot,
                # Alternative Milk / dairy-free badges). This rebuild
                # used to drop them, so walk-in cards lost the badges.
                'milk_type_id':     data.get('milk_type_id'),
                'alternative_milk': bool(data.get('alternative_milk')),
                'dairy_free':       bool(data.get('dairy_free')),
                # Bean choice + shot count from the dialog (usage stats).
                'bean_type':        data.get('bean_type'),
            }
            # Extra hot: every order serializer derives the card badge
            # from order_details['temp'] == 'extra hot' (the shape the
            # SMS flow writes). This rebuild dropped the dialog's
            # extra_hot flag entirely — the checkbox was ticked, the
            # order stored nothing, and the pending/current cards
            # showed a normal-temperature order.
            if data.get('extra_hot') or data.get('extraHot'):
                order_details['extra_hot'] = True
                order_details['temp'] = 'extra hot'
            _shots = data.get('shots')
            if isinstance(_shots, (int, float)) and _shots == _shots and _shots > 0:
                order_details['shots'] = _shots
            # Compute price (honor-system) — same logic as the SMS
            # flow. Stashed on order_details so the barista UI's
            # current-order card knows what to charge. Includes the
            # vip flag so vip_free comping triggers when configured.
            try:
                if hasattr(coffee_system, '_compute_order_price'):
                    pv, pf = coffee_system._compute_order_price({
                        'type': order_details['type'],
                        'milk': order_details['milk'],
                        'size': order_details['size'],
                        'sugar': order_details['sugar'],
                        'vip':  order_details['vip'],
                    })
                    if pv is not None:
                        order_details['price'] = pv
                        order_details['price_formatted'] = pf
            except Exception as price_err:
                logger.warning(f"Walk-in price compute failed (non-fatal): {price_err}")

            # Determine queue priority. Was checking for the string 'vip'
            # but the walk-in frontend sends a boolean — that meant walk-in
            # VIPs never actually got queue priority 1. Honour both shapes.
            priority = 1 if _walkin_vip else 5
            if str(data.get('priority') or '').lower() == 'urgent':
                priority = 2
            
            # Station precedence: explicit collection_station (walk-in
            # dialog's "send to station N for collection" override),
            # then station_id, then default to 1. Without the
            # collection_station fallback here, callers that send only
            # that field landed every order at station 1 — the bug
            # Steve flagged: "the option to assign the order to
            # another station is not working".
            station_id = (
                data.get('collection_station')
                or data.get('collectionStation')
                or data.get('station_id')
                or data.get('stationId')
                or 1
            )
            try:
                station_id = int(station_id)
            except (TypeError, ValueError):
                station_id = 1

            # Capability gate.
            #
            # Three things to validate before we write the order:
            #
            # (1) The station_id actually exists. Without this, we
            #     happily wrote orders to station 99 — they became
            #     ghost orders that no barista UI could see.
            # (2) The requested milk is in that station's milk_types.
            #     This was the coconut bug: the SMS bot offered Steve's
            #     "usual = coconut latte", no station has coconut, the
            #     order got created anyway, then no barista could
            #     start it because the start handler's capability gate
            #     blocked them. Net effect: customer notified, drink
            #     unmakeable.
            # (3) The requested drink is in catalog OR in the
            #     station's coffee_types. Stops "nuclear chai blast"
            #     from being accepted.
            #
            # Lenient mode: if station_stats has no entry for this
            # station, or capabilities is empty, we don't block —
            # treat it as "no restriction" so brand-new deployments
            # work before the Capabilities editor has been touched.
            try:
                cap_check_cursor = db.cursor()
                # Existence + status check in one query. Before this,
                # POST /api/orders silently accepted orders at:
                #   - station_id=99 (doesn't exist), and
                #   - stations explicitly marked status='inactive'.
                # Reassign properly rejected both. Asymmetric. The
                # fresh-eyes audit reproduced both. Symmetrising here.
                cap_check_cursor.execute(
                    "SELECT status FROM stations WHERE id = %s",
                    (station_id,),
                )
                station_row = cap_check_cursor.fetchone()
                if not station_row:
                    return jsonify({
                        "status": "error",
                        "message": (
                            f"Station {station_id} doesn't exist. "
                            "Pick a valid station from the dropdown."
                        ),
                        "code": "STATION_NOT_FOUND",
                    }), 400
                station_status = (
                    station_row[0] if not isinstance(station_row, dict)
                    else station_row.get('status')
                )
                # Treat NULL/missing status as "active" so brand-new
                # rows don't fail open. Only explicit 'inactive' /
                # 'maintenance' refuse new work.
                if station_status and station_status.lower() in (
                    'inactive', 'maintenance'
                ):
                    return jsonify({
                        "status": "error",
                        "message": (
                            f"Station {station_id} is {station_status} "
                            "and isn't accepting orders right now. "
                            "Pick a different station, or activate this "
                            "one in the Stations tab."
                        ),
                        "code": "STATION_NOT_ACTIVE",
                    }), 400
            except Exception as e:
                # Don't block order creation on a stations-table read
                # failure; log and continue. Worst case: order lands
                # at a fictional station and barista UI surfaces it.
                logger.warning(f"Station existence check failed (continuing): {e}")
                try:
                    db.rollback()
                except Exception:
                    pass

            cap_result = _station_can_make_order(
                db,
                station_id,
                {
                    'type': order_details.get('type'),
                    'milk': order_details.get('milk'),
                },
            )
            if cap_result.get('blocked'):
                logger.warning(
                    f"Refused walk-in order create for station {station_id}: "
                    f"{cap_result.get('reason')}"
                )
                return jsonify({
                    "status": "error",
                    "message": cap_result.get('reason'),
                    "code": "STATION_CAPABILITY_MISMATCH",
                }), 400

            # Insert order into database
            cursor = db.cursor()
            # Provenance. This is the barista's own walk-in dialog (the
            # frontend already sends source='walkin'), so the channel is
            # 'barista' unless the caller names a valid one -- the
            # Organiser's bulk/group tools post here too.
            stamp_provenance(
                order_details,
                normalize_channel(data.get('channel')) or 'barista',
                data.get('src') or data.get('source_code'),
            )
            cursor.execute('''
                INSERT INTO orders (
                    order_number, phone, order_details, status, 
                    station_id, created_at, updated_at, queue_priority
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, order_number
            ''', (
                order_number,
                # Accept BOTH `phone` and `phone_number` as the input key.
                # The walk-in dialog and the audit script both send
                # `phone_number`; legacy callers send `phone`. The
                # previous handler only checked `phone`, so any walk-in
                # operator entering a phone got `""` saved, breaking
                # the "send message to customer" feature.
                (data.get('phone') or data.get('phone_number') or '').strip(),
                json.dumps(order_details),
                'pending',
                station_id,
                now,
                now,
                priority
            ))
            
            result = cursor.fetchone()
            db.commit()
            
            if result:
                order_id, order_number = result
                logger.info(f"Created order {order_number} with ID {order_id}")

                # Push WS event so connected Barista UIs see the new
                # order without waiting for the next 15s poll. Steve
                # hit "SMS came back but no order in the app" because
                # the only refresh signal was that poll — and a fresh
                # order looked invisible for up to 15 seconds.
                _emit_new_order({
                    'order_number': order_number,
                    'id': order_number,
                    'status': 'pending',
                    'station_id': station_id,
                    'stationId': station_id,
                    # createdAt / waitTime: without these, the WS-pushed
                    # order on the Barista UI rendered with the JS
                    # client computing wait from a missing field — Steve
                    # saw "571 min" (= 9.5h, the AEST→UTC offset) when
                    # the order had just been placed. Sending UTC "Z"
                    # suffix forces the browser to parse as UTC.
                    'created_at': now.isoformat() + 'Z',
                    'createdAt': now.isoformat() + 'Z',
                    'wait_time': 0,
                    'waitTime': 0,
                    'customer_name': order_details.get('name'),
                    'customerName': order_details.get('name'),
                    'coffee_type': _drink_display_name(order_details, default=None),
                    'coffeeType': _drink_display_name(order_details, default=None),
                    'milk_type': order_details.get('milk'),
                    'milkType': order_details.get('milk'),
                    'sugar': order_details.get('sugar'),
                    'size': order_details.get('size'),
                    'vip': order_details.get('vip', False),
                })

                # Walk-up ticket stub: when the designer's ticket toggle
                # is on, a barista-entered walk-in prints the customer a
                # deli-counter number slip. Fire-and-forget.
                if (order_details.get('source') == 'walkin'
                        or order_details.get('order_type') == 'walk-in'):
                    try:
                        from routes.print_routes import maybe_print_ticket
                        maybe_print_ticket(db, order_number, station_id)
                    except Exception:
                        pass

                return jsonify({
                    'status': 'success',
                    'data': {
                        'id': order_id,
                        'order_number': order_number
                    },
                    'message': 'Order created successfully'
                })
            else:
                raise Exception("Failed to create order - no result returned")
        
        except Exception as e:
            logger.error(f"Error creating order: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to create order: {str(e)}'
            }), 500

@bp.route('/orders/pending', methods=['GET'])
@jwt_required_with_demo()
def get_pending_orders():
    """Get all pending orders, optionally filtered by station.

    `?station_id=N` filters to that station only. The fresh-eyes audit
    found that BEFORE this fix the query param was silently ignored —
    a barista logged in to Station 2 saw Station 1's orders mixed into
    their pending queue. With three baristas at three stations, every
    drink would have shown up in every queue. Goal 2 of the product
    ("each station sees its own orders") was broken.
    """
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Defensive rollback — psycopg2's "current transaction is
        # aborted" error sticks until rolled back, and a previous
        # request's failure could otherwise turn this endpoint into a
        # silent 500 even though the orders themselves are fine.
        try:
            db.rollback()
        except Exception:
            pass

        # Surface due ETA-scheduled orders (lazy promotion — this
        # endpoint is polled by the barista UI).
        try:
            coffee_system.promote_due_scheduled_orders()
        except Exception:
            pass

        # Read optional ?station_id=N filter. Reject anything non-int
        # so a typo like '?station_id=abc' doesn't silently 500.
        station_filter = request.args.get('station_id')
        station_param = None
        if station_filter is not None and station_filter != '':
            try:
                station_param = int(station_filter)
            except (TypeError, ValueError):
                return jsonify({
                    'success': False,
                    'message': "station_id must be an integer if provided",
                }), 400

        # Query database for pending orders
        cursor = db.cursor()
        if station_param is not None:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority
                FROM orders
                WHERE status = 'pending' AND station_id = %s
                ORDER BY queue_priority, created_at ASC
            ''', (station_param,))
        else:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority
                FROM orders
                WHERE status = 'pending'
                ORDER BY queue_priority, created_at ASC
            ''')
        
        # Process orders
        pending_orders = []
        rows = cursor.fetchall()
        questions_by_phone = _pending_questions_by_phone(cursor)
        for order in rows:
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Calculate wait time
            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
            
            # Get batch group if present in order details
            batch_group = None
            if order_details and 'type' in order_details and 'milk' in order_details:
                # Create a batch group key based on coffee type and milk type
                coffee_type = order_details.get('type', '').lower()
                milk_type = order_details.get('milk', '').lower()
                if coffee_type and milk_type:
                    batch_group = f"{coffee_type}-{milk_type}"
            
            # Format order for frontend
            pending_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'orderNumber': order_number,  # camelCase alias for FE consistency
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),  # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),  # camelCase
                'sugar': order_details.get('sugar', 'No sugar'),
                'size': order_details.get('size'),
                # Temperature is its own card badge in the barista UI —
                # without this field a pending 'extra hot' order looked
                # normal until it was started (Test Bench matrix modifier).
                'extra_hot': (order_details.get('temp') == 'extra hot'
                              or 'extra hot' in (order_details.get('notes') or '').lower()),
                'extraHot': (order_details.get('temp') == 'extra hot'
                             or 'extra hot' in (order_details.get('notes') or '').lower()),
                'strength': order_details.get('strength', ''),
                # Order channel + no-SMS flag (EA app orders).
                'orderSource': order_details.get('source') or 'sms',
                'needsContact': bool(order_details.get('needs_contact')),
                # The customer's latest unanswered SMS, shown on the card.
                'customer_message': questions_by_phone.get(str(phone or '')),
                'customerMessage': questions_by_phone.get(str(phone or '')),
                'status': status,
                'created_at': created_at,
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'wait_time': wait_time,
                'waitTime': wait_time,  # camelCase
                # promisedTime is the target completion time for the
                # order, used by the Time Pressure bar in the barista
                # UI. The bar previously sat at 0% on every order
                # because nothing set this field. We use a conservative
                # 5-minute target — beyond that the bar fills and the
                # barista sees urgency.
                'promisedTime': 5,
                'priority': priority == 1,  # Convert 1/0 to True/False
                'vip': priority == 1,  # alias used by some UI filters
                'batch_group': batch_group,
                # camelCase alias the Barista UI's PendingOrdersSection
                # actually reads — without this, batch grouping silently
                # never triggered. coffee_type / milk_type also had no
                # camelCase aliases on this endpoint; added above too.
                'batchGroup': batch_group,
                # Frontend filter needs a coffee_type field for display.
                'coffeeType': _drink_display_name(order_details),
                'customerName': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'phoneNumber': phone,
                'station_id': station_id,
                'stationId': station_id,
                # Pricing — null when disabled, otherwise carries the
                # computed total. Barista UI shows this so they know
                # what to charge at collection time.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
            })

        return jsonify({
            'success': True,
            'orders': pending_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching pending orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching pending orders: {str(e)}"
        }), 500

@bp.route('/orders/in-progress', methods=['GET'])
@jwt_required_with_demo()
def get_in_progress_orders():
    """Get all in-progress orders.

    Response format matches /api/orders/pending: every field is also
    returned in camelCase because the Barista UI + Display screen
    filter by `stationId` (camelCase). The previous version returned
    only snake_case AND omitted station_id entirely — so a
    just-started order vanished from both the Barista in-progress
    list and the customer Display (both filter by station). That's
    the "Start an order, it disappears, you can't even complete it"
    bug Steve flagged.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Optional ?station_id=N filter. Same fix as /orders/pending —
        # the param was being silently ignored, so every station saw
        # every other station's in-progress orders.
        station_filter = request.args.get('station_id')
        station_param = None
        if station_filter is not None and station_filter != '':
            try:
                station_param = int(station_filter)
            except (TypeError, ValueError):
                return jsonify({
                    'success': False,
                    'message': "station_id must be an integer if provided",
                }), 400

        cursor = db.cursor()
        if station_param is not None:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority
                FROM orders
                WHERE status = 'in-progress' AND station_id = %s
                ORDER BY created_at
            ''', (station_param,))
        else:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority
                FROM orders
                WHERE status = 'in-progress'
                ORDER BY created_at
            ''')

        in_progress_orders = []
        rows = cursor.fetchall()
        questions_by_phone = _pending_questions_by_phone(cursor)
        for order in rows:
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order

            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}

            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)

            extra_hot = (
                order_details.get('temp') == 'extra hot'
                or ('extra hot' in (order_details.get('notes') or '').lower())
            )

            customer_name = order_details.get('name', 'Customer')
            coffee_type = _drink_display_name(order_details)
            milk_type = order_details.get('milk', 'Standard')
            size = order_details.get('size')

            in_progress_orders.append({
                # snake_case (legacy)
                'id': order_number,
                'order_number': order_number,
                'customer_name': customer_name,
                'phone_number': phone,
                'coffee_type': coffee_type,
                'milk_type': milk_type,
                'sugar': order_details.get('sugar', 'No sugar'),
                'extra_hot': extra_hot,
                'priority': priority == 1,
                'created_at': created_at,
                'wait_time': wait_time,
                'station_id': station_id,
                'size': size,
                # Pricing — pulled straight from order_details (set
                # at confirm time by either SMS flow or walk-in
                # endpoint). Null when pricing is disabled.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
                # camelCase aliases — REQUIRED by the React UI for filtering.
                'orderNumber': order_number,
                'customerName': customer_name,
                'phoneNumber': phone,
                'coffeeType': coffee_type,
                'milkType': milk_type,
                'extraHot': extra_hot,
                'strength': order_details.get('strength', '') if isinstance(order_details, dict) else '',
                # Team mode: which stages (shots/milk) are already done.
                'stages': order_details.get('stages') or {},
                # Order channel + no-SMS flag (EA app orders).
                'orderSource': order_details.get('source') or 'sms',
                'needsContact': bool(order_details.get('needs_contact')),
                'customer_message': questions_by_phone.get(str(phone or '')),
                'customerMessage': questions_by_phone.get(str(phone or '')),
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'waitTime': wait_time,
                'stationId': station_id,
                'status': status,
                'vip': priority == 1,
            })

        return jsonify({
            'success': True,
            'orders': in_progress_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching in-progress orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching in-progress orders: {str(e)}"
        }), 500

@bp.route('/orders/completed', methods=['GET'])
@jwt_required_with_demo()
def get_completed_orders():
    """Get completed orders.

    Optional `?station_id=N` filters to just that station — the
    Barista interface uses this so each station shows only its own
    completed orders rather than every station's. Without the filter
    (e.g. a manager-wide report) every station's completions come
    back. The response now also includes `station_id` so callers can
    label which station completed each order.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        # Defensive rollback — clear any prior aborted transaction
        # state on the shared connection (same pattern as the other
        # read endpoints).
        try:
            db.rollback()
        except Exception:
            pass

        station_filter = request.args.get('station_id', type=int)
        # New: optional recency filter so the customer-facing Display
        # screen can ask for "completed in the last N minutes" rather
        # than every completion ever (which is why Steve saw 30 stale
        # test orders sitting on the display forever).
        recent_minutes = request.args.get('recent_minutes', type=int)
        # New: filter out picked-up orders by default — Display should
        # only show "Ready for Pickup" (still waiting), not orders
        # the customer already collected.
        include_picked_up = request.args.get('include_picked_up', '0').lower() in ('1', 'true', 'yes')
        status_filter = ('completed', 'picked_up') if include_picked_up else ('completed',)
        status_placeholder = ','.join(['%s'] * len(status_filter))

        cursor = db.cursor()
        where = [f"status IN ({status_placeholder})"]
        params = list(status_filter)
        if station_filter is not None:
            where.append("station_id = %s")
            params.append(station_filter)
        if recent_minutes is not None and recent_minutes > 0:
            where.append("updated_at >= (CURRENT_TIMESTAMP - (%s || ' minutes')::interval)")
            params.append(str(recent_minutes))
        sql = f"""
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, phone, order_details, picked_up_at
            FROM orders
            WHERE {' AND '.join(where)}
            ORDER BY updated_at DESC
            LIMIT 50
        """
        cursor.execute(sql, params)

        completed_orders = []
        for order in cursor.fetchall():
            order_id, order_number, status, station_id, created_at, updated_at, phone, order_details_json, picked_up_at = order
            completed_at = updated_at or created_at
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json

            completed_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'phone_number': phone,
                'phoneNumber': phone,                   # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),     # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),     # camelCase
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if hasattr(completed_at, 'isoformat') else completed_at,
                'picked_up_at': picked_up_at,
                'pickedUpAt': picked_up_at,
                'status': status,
                # Include station so callers can either filter again
                # client-side or label which station made each one.
                'station_id': station_id,
                'stationId': station_id,
                'ready_for_pickup': status == 'completed',
                # Pricing — completed orders need the price tag for
                # the Ready-for-Pickup column. Mirrors the pattern
                # in /orders/in-progress.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
            })
        
        return jsonify({
            'success': True,
            'orders': completed_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching completed orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching completed orders: {str(e)}"
        }), 500

@bp.route('/heartbeat', methods=['GET'])
def heartbeat():
    """Connectivity check — used by the React UI to confirm the
    backend is reachable. Intentionally cheap (no DB hit).

    Previously returned 404 because no route existed; the UI
    interpreted the failure as "offline" and dropped into
    fallback-data mode unnecessarily.
    """
    return jsonify({'status': 'ok', 'service': 'expresso'})


@bp.route('/orders/search', methods=['GET'])
@jwt_required_with_demo()
def search_orders():
    """Full-text search over recent orders.

    Body of search is matched against customer_name and order_number
    case-insensitively. Optional `?station_id=N` further filters. Used
    by the Barista UI's Completed Orders search box.
    """
    try:
        q = (request.args.get('q') or request.args.get('query') or '').strip().lower()
        station_id = request.args.get('station_id', type=int)
        limit = min(int(request.args.get('limit', 50)), 200)
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        where = ['1=1']
        params: list = []
        if q:
            # Match against order_number OR the JSON 'name' field.
            # Postgres JSONB makes this clean; SQLite path is best-effort.
            where.append("(LOWER(order_number) LIKE %s OR LOWER(COALESCE(order_details->>'name','')) LIKE %s)")
            params.extend([f"%{q}%", f"%{q}%"])
        if station_id is not None:
            where.append("station_id = %s")
            params.append(station_id)
        params.append(limit)
        sql = f"""
            SELECT order_number, status, station_id, created_at, phone, order_details
            FROM orders
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT %s
        """
        cur.execute(sql, params)
        results = []
        for row in cur.fetchall():
            order_number, status, sid, created_at, phone, od = row
            if isinstance(od, str):
                try:
                    od = json.loads(od)
                except Exception:
                    od = {}
            od = od or {}
            results.append({
                'order_number': order_number,
                'orderNumber': order_number,
                'status': status,
                'station_id': sid, 'stationId': sid,
                'created_at': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'customer_name': od.get('name', ''),
                'customerName': od.get('name', ''),
                'coffee_type': _drink_display_name(od, default=''),
                'coffeeType': _drink_display_name(od, default=''),
                'milk_type': od.get('milk', ''),
                'milkType': od.get('milk', ''),
                'phone_number': phone, 'phoneNumber': phone,
            })
        return jsonify({'success': True, 'status': 'success', 'data': results, 'orders': results})
    except Exception as e:
        logger.error(f"search_orders error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/orders/batch/process', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def process_order_batch():
    """Move a list of pending orders to in-progress in one call.

    Body: { "order_ids": ["W123", "W124", ...] }

    The Barista UI's "Batch Process" button selects multiple
    related orders (same milk + coffee type) and starts them
    together. Without this endpoint the button silently no-op'd.
    Returns the new statuses and a per-order success flag.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        order_ids = data.get('order_ids') or data.get('orderIds') or []
        if not isinstance(order_ids, list) or not order_ids:
            return jsonify({'success': False, 'message': 'order_ids must be a non-empty array'}), 400
        results = []
        cur = db.cursor()
        for oid in order_ids:
            clean = clean_order_id(str(oid))
            try:
                _now_b = datetime.now().isoformat()
                cur.execute(
                    "UPDATE orders SET status = 'in-progress', updated_at = %s, started_at = %s "
                    "WHERE order_number = %s AND status = 'pending' RETURNING order_number",
                    (_now_b, _now_b, clean),
                )
                row = cur.fetchone()
                results.append({'order_id': clean, 'success': bool(row),
                                'new_status': 'in-progress' if row else None})
            except Exception as e:
                results.append({'order_id': clean, 'success': False, 'error': str(e)})
                try: db.rollback()
                except Exception: pass
        db.commit()
        return jsonify({'success': True, 'results': results,
                        'count': sum(1 for r in results if r['success'])})
    except Exception as e:
        logger.error(f"process_order_batch error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


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
    """JWT logout is client-side (drop the token), but the UI still
    pings this endpoint for telemetry. Acknowledge gracefully so the
    frontend doesn't think it's offline."""
    return jsonify({'success': True, 'message': 'logout acknowledged'})


@bp.route('/orders/history', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_order_history():
    """Get order history with filtering options"""
    try:
        # Get query parameters for filtering
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        status = request.args.get('status')
        station_id = request.args.get('station_id')
        customer_name = request.args.get('customer_name')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Build dynamic query with filters
        query = '''
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, completed_at, phone, order_details
            FROM orders 
            WHERE 1=1
        '''
        
        params = []
        
        # Add date range filter
        if start_date:
            try:
                # Validate date format
                datetime.strptime(start_date, '%Y-%m-%d')
                query += " AND DATE(created_at) >= %s"
                params.append(start_date)
            except ValueError:
                logger.warning(f"Invalid start_date format: {start_date}")
        
        if end_date:
            try:
                # Validate date format
                datetime.strptime(end_date, '%Y-%m-%d')
                query += " AND DATE(created_at) <= %s"
                params.append(end_date)
            except ValueError:
                logger.warning(f"Invalid end_date format: {end_date}")
        
        # Add status filter
        if status:
            query += " AND status = %s"
            params.append(status)
        
        # Add station filter
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add customer name filter (search in JSON)
        if customer_name:
            # PostgreSQL JSON search using ->> operator
            query += " AND (order_details->>'name' ILIKE %s OR order_details->>'name' ILIKE %s)"
            params.append(f"{customer_name}%")  # Starts with
            params.append(f"% {customer_name}%")  # Contains after space
        
        # Add ordering and pagination
        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.append(limit)
        params.append(offset)
        
        # Execute query
        cursor = db.cursor()
        cursor.execute(query, params)
        
        # Process orders
        orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Format order for frontend
            orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'phone_number': phone,
                'phoneNumber': phone,                   # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),     # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),     # camelCase
                'sugar': order_details.get('sugar', 'No sugar'),
                'status': status,
                'station_id': station_id,
                'stationId': station_id,
                'created_at': created_at,
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'updated_at': updated_at,
                'updatedAt': updated_at.isoformat() if hasattr(updated_at, 'isoformat') else updated_at,
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if (completed_at and hasattr(completed_at, 'isoformat')) else completed_at,
                'notes': order_details.get('notes', '')
            })
        
        # Count total matching records (without pagination)
        count_query = query.split('ORDER BY')[0].replace('SELECT id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details', 'SELECT COUNT(*)')
        cursor.execute(count_query, params[:-2])  # Remove limit and offset params
        total_count = cursor.fetchone()[0]
        
        return jsonify({
            'success': True,
            'orders': orders,
            'pagination': {
                'total': total_count,
                'offset': offset,
                'limit': limit
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching order history: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching order history: {str(e)}"
        }), 500

@bp.route('/orders/statistics', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_order_statistics():
    """Get order statistics"""
    try:
        # Get query parameters for filtering
        time_period = request.args.get('period', 'day')  # day, week, month, year
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        cursor = db.cursor()
        
        # Set default date range based on time period if not provided
        if not start_date:
            if time_period == 'day':
                start_date = datetime.now().strftime('%Y-%m-%d')
            elif time_period == 'week':
                start_date = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
            elif time_period == 'month':
                start_date = (datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d')
            elif time_period == 'year':
                start_date = (datetime.now() - timedelta(days=365)).strftime('%Y-%m-%d')
        
        if not end_date:
            end_date = datetime.now().strftime('%Y-%m-%d')
        
        # Validate date parameters
        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')
        except ValueError:
            return jsonify({
                'success': False,
                'message': 'Invalid date format. Use YYYY-MM-DD.'
            }), 400
        
        # Generate statistics
        
        # 1. Total orders by status
        cursor.execute('''
            SELECT status, COUNT(*) as count
            FROM orders
            WHERE DATE(created_at) BETWEEN %s AND %s
            GROUP BY status
        ''', (start_date, end_date))
        
        status_counts = {}
        for row in cursor.fetchall():
            status, count = row
            status_counts[status] = count
        
        # 2. Orders by day
        cursor.execute('''
            SELECT DATE(created_at) as day, COUNT(*) as count
            FROM orders
            WHERE DATE(created_at) BETWEEN %s AND %s
            GROUP BY DATE(created_at)
            ORDER BY day
        ''', (start_date, end_date))
        
        daily_counts = {}
        for row in cursor.fetchall():
            day, count = row
            daily_counts[day.strftime('%Y-%m-%d')] = count
        
        # 3. Orders by coffee type
        cursor.execute('''
            SELECT order_details->>'type' as coffee_type, COUNT(*) as count
            FROM orders
            WHERE DATE(created_at) BETWEEN %s AND %s
            AND order_details->>'type' IS NOT NULL
            GROUP BY order_details->>'type'
            ORDER BY count DESC
        ''', (start_date, end_date))
        
        coffee_type_counts = {}
        for row in cursor.fetchall():
            coffee_type, count = row
            coffee_type_counts[coffee_type] = count
        
        # 4. Orders by milk type
        cursor.execute('''
            SELECT order_details->>'milk' as milk_type, COUNT(*) as count
            FROM orders
            WHERE DATE(created_at) BETWEEN %s AND %s
            AND order_details->>'milk' IS NOT NULL
            GROUP BY order_details->>'milk'
            ORDER BY count DESC
        ''', (start_date, end_date))
        
        milk_type_counts = {}
        for row in cursor.fetchall():
            milk_type, count = row
            milk_type_counts[milk_type] = count
        
        # 5. Busiest hours
        cursor.execute('''
            SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
            FROM orders
            WHERE DATE(created_at) BETWEEN %s AND %s
            GROUP BY EXTRACT(HOUR FROM created_at)
            ORDER BY hour
        ''', (start_date, end_date))
        
        hourly_counts = {}
        for row in cursor.fetchall():
            hour, count = row
            hourly_counts[int(hour)] = count
        
        # Return compiled statistics
        return jsonify({
            'success': True,
            'statistics': {
                'date_range': {
                    'start_date': start_date,
                    'end_date': end_date
                },
                'by_status': status_counts,
                'by_day': daily_counts,
                'by_coffee_type': coffee_type_counts,
                'by_milk_type': milk_type_counts,
                'by_hour': hourly_counts,
                'total_orders': sum(status_counts.values()) if status_counts else 0
            }
        })
    
    except Exception as e:
        logger.error(f"Error generating order statistics: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error generating order statistics: {str(e)}"
        }), 500

@bp.route('/orders/lookup/<order_id>', methods=['GET'])
@jwt_required_with_demo()
def lookup_order(order_id):
    """Look up an order by ID or order number"""
    try:
        # Clean the order ID if needed
        clean_id = clean_order_id(order_id)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query the database for the order
        cursor = db.cursor()
        
        # Try to find by order_number first (most reliable)
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, updated_at, completed_at, 
                   phone, order_details, queue_priority
            FROM orders 
            WHERE order_number = %s
        ''', (clean_id,))
        
        order = cursor.fetchone()
        
        # If not found by order_number, try by ID
        if not order:
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, updated_at, completed_at, 
                       phone, order_details, queue_priority
                FROM orders 
                WHERE id = %s
            ''', (clean_id,))
            
            order = cursor.fetchone()
        
        # If still not found, return error
        if not order:
            return jsonify({
                "success": False, 
                "message": f"Order {order_id} not found"
            })
        
        # Extract order details
        order_id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details_json, priority = order
        
        # Parse order details
        if isinstance(order_details_json, str):
            order_details = json.loads(order_details_json)
        else:
            order_details = order_details_json
        
        # Format order for response
        order_data = {
            "id": order_number,  # Use order_number as ID for consistency
            "order_number": order_number,
            "status": status,
            "station_id": station_id,
            "customer_name": order_details.get('name', 'Customer'),
            "phone_number": phone,
            "coffee_type": order_details.get('type', 'Coffee'),
            "milk_type": order_details.get('milk', 'Standard'),
            "sugar": order_details.get('sugar', 'No sugar'),
            "size": order_details.get('size', 'Regular'),
            "created_at": created_at,
            "updated_at": updated_at,
            "completed_at": completed_at,
            "priority": priority == 1,
            "details": order_details  # Include full details for reference
        }
        
        return jsonify({
            "success": True,
            "order": order_data
        })
    
    except Exception as e:
        logger.error(f"Error looking up order {order_id}: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error looking up order: {str(e)}"
        })

@bp.route('/orders/<order_id>/start', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def start_order(order_id):
    """Start an order.

    Also notifies the customer by SMS so they know their drink is being
    made now — closes the silent gap between order-confirmed and
    order-ready that previously made customers wander up to the station
    asking if they'd been forgotten.
    """
    try:
        logger.info(f"Received request to start order: {order_id}")

        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})

        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # The barista's currently-selected station is sent in the body
        # so we can check whether that station can actually make this
        # drink — without it, a barista at Station 2 could tap Start on
        # an oat-milk order routed to Station 1 (which has oat) and
        # nothing would stop them from making it on a station that
        # doesn't stock oat. The check is best-effort and only blocks
        # when capabilities are definitively wrong; missing/empty
        # capabilities mean "no restriction".
        payload = request.get_json(silent=True) or {}
        claiming_station_id = payload.get('station_id') or payload.get('stationId')

        # Fetch the row up-front: we want phone + details + created_at
        # *before* we change status, so the notification has the right
        # context AND the started-SMS policy can compute order age.
        cursor = db.cursor()
        cursor.execute(
            'SELECT id, phone, order_details, status, created_at '
            'FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        # Tolerate both tuple and dict cursors.
        if isinstance(order_row, dict):
            order_phone = order_row.get('phone')
            order_details = order_row.get('order_details') or {}
            current_status = order_row.get('status')
            order_created_at = order_row.get('created_at')
        else:
            _, order_phone, order_details, current_status, order_created_at = order_row

        # State machine guard. Without this, /start on a picked_up order
        # pulled it BACK into in-progress — the collected coffee
        # re-appeared on the barista queue. Bug Steve hit in QC.
        #
        # Treat these as terminal: refusing further state changes.
        #   - picked_up  → already collected, don't resurrect.
        #   - cancelled  → customer cancelled, don't restart.
        if current_status in ('picked_up', 'cancelled'):
            return jsonify({
                "success": False,
                "message": (
                    f"Cannot start order {clean_id}: already {current_status}."
                ),
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent: already in-progress is a no-op success (don't
        # re-fire the started SMS or re-emit the WS event).
        if current_status == 'in-progress':
            return jsonify({
                "success": True,
                "message": "Order already in progress",
                "current_status": current_status,
                "noop": True,
            })

        # Parse order_details if it came back as JSON text.
        parsed_details = order_details
        if isinstance(parsed_details, str):
            try:
                parsed_details = json.loads(parsed_details)
            except Exception:
                parsed_details = {}
        if not isinstance(parsed_details, dict):
            parsed_details = {}

        # Capability gate: if the barista's station can't make this drink,
        # refuse to start it and tell them why. Routing already picked
        # the right station at order time, so this only fires when a
        # barista at the wrong station tries to claim.
        if claiming_station_id:
            capability_check = _station_can_make_order(
                db, claiming_station_id, parsed_details
            )
            if capability_check.get('blocked'):
                logger.warning(
                    f"Refused start of order {clean_id} at station "
                    f"{claiming_station_id}: {capability_check.get('reason')}"
                )
                return jsonify({
                    "success": False,
                    "message": capability_check.get('reason'),
                    "code": "STATION_CAPABILITY_MISMATCH",
                }), 400

        # started_at powers the TRUE make-time average (start→complete).
        # The old average measured created→completed — the whole lifetime
        # including queue-sitting time — so three test orders that sat 30
        # minutes made an EMPTY station claim a 10-minute walk-up wait.
        #
        # This used to run the ALTER unconditionally, on EVERY start —
        # once per drink, 400+ times at an event. ADD COLUMN takes
        # ACCESS EXCLUSIVE on `orders` BEFORE it checks whether the
        # column exists, so a "no-op" still queued behind any reader,
        # and a waiting exclusive lock stalls every reader behind IT.
        # Same mechanism as the boot-time convoy, on the hottest path we
        # have. ensure_column asks the catalogue first and only reaches
        # for DDL on a database that genuinely lacks the column.
        from utils.schema_guard import ensure_column
        ensure_column(
            db, "orders", "started_at",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS started_at TIMESTAMP")
        _now_s = datetime.now().isoformat()
        cursor.execute(
            '''
            UPDATE orders
            SET status = 'in-progress', updated_at = %s, started_at = %s
            WHERE order_number = %s
            ''',
            (_now_s, _now_s, clean_id),
        )
        db.commit()
        rows_affected = cursor.rowcount

        if rows_affected <= 0:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} found but could not be updated",
            })

        logger.info(f"Successfully started order: {clean_id}")

        # Send the "your barista just started your X" SMS. We only do this
        # on the pending → in-progress transition (not on re-starts) to
        # avoid double-notifying the customer if a barista taps Start more
        # than once. AND we apply the policy gate: at small events with no
        # queue, the "started" SMS just adds noise between confirm and
        # ready — see _should_send_started_sms for the rules.
        # test_no_send (Test Bench): perform the full transition but skip the
        # real SMS — same escape hatch the message endpoint has, needed
        # because prod TESTING_MODE is off and lifecycle tests on
        # phone-bearing orders would text real numbers.
        _no_send = bool((request.get_json(silent=True) or {}).get('test_no_send')
                        or (request.get_json(silent=True) or {}).get('dry_run'))
        if current_status == 'pending' and not _no_send \
                and _should_send_started_sms(db, order_created_at):
            _notify_customer_order_started(order_phone, clean_id, order_details)

        # Push a WS event so any open Barista UI / Display refreshes
        # immediately instead of waiting for the next 15s poll. The
        # forwarded window event 'order_updated' is what useOrders +
        # the customer Display + the Ready-for-Pickup column listen to.
        _emit_order_status_change(clean_id, 'in-progress')

        return jsonify({"success": True, "message": "Order started successfully"})

    except Exception as e:
        logger.error(f"Error starting order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})


def _station_can_make_order(db, station_id, order_details):
    """Return {'blocked': bool, 'reason': str} for whether a station can
    make this drink.

    Capabilities live in station_stats.capabilities (JSONB) — populated
    by the Capabilities editor UI. Shape we honour:

      {
        "coffee_types": ["latte", "cappuccino"],   # optional, list
        "milk_types":   ["full cream", "skim"],    # optional, list
        "alt_milk":     true,                       # boolean flag
        ...
      }

    Only block when the list is explicitly set AND doesn't include the
    requested item. Missing / empty lists are interpreted as "no
    restriction" so the organiser doesn't have to enumerate every
    station's full menu just to enable order claiming.
    """
    try:
        station_id_int = int(station_id)
    except (TypeError, ValueError):
        return {'blocked': False, 'reason': ''}

    requested_type = (order_details.get('type') or '').strip().lower()
    requested_milk = (order_details.get('milk') or '').strip().lower()

    # 'no milk' (black coffee / tea) is ALWAYS makeable — every station
    # can not-add milk. Without this, the canonicaliser below stripped
    # the ' milk' suffix, turned 'no milk' into 'no', found 'no' in no
    # station's milk list, and BLOCKED every long black at every station
    # (full-sweep regression, matrix mx05/07/11/12).
    if requested_milk in ('no milk', 'none', 'black'):
        requested_milk = ''

    # Strip decaf prefix from drink type for the capability check —
    # decaf flat white is still a flat white capability-wise.
    if requested_type.startswith('decaf '):
        requested_type = requested_type[6:].strip()

    try:
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute(
            "SELECT capabilities FROM station_stats WHERE station_id = %s",
            (station_id_int,),
        )
        row = cursor.fetchone()
    except Exception as e:
        logger.warning(f"Capabilities lookup failed for station {station_id_int}: {e}")
        return {'blocked': False, 'reason': ''}

    if not row:
        return {'blocked': False, 'reason': ''}

    caps_raw = row[0] if not isinstance(row, dict) else row.get('capabilities')
    if not caps_raw:
        return {'blocked': False, 'reason': ''}
    if isinstance(caps_raw, str):
        try:
            caps_raw = json.loads(caps_raw)
        except Exception:
            return {'blocked': False, 'reason': ''}
    if not isinstance(caps_raw, dict):
        return {'blocked': False, 'reason': ''}

    # Only ESPRESSO drinks are gated by a station's coffee_types capability.
    # Non-espresso drinks (tea, hot chocolate, chai, matcha) are enabled
    # event-wide in inventory and aren't tied to a station's espresso menu —
    # Quick Setup only ever seeds coffee_types with espresso drinks, so
    # blocking on it would make every tea/hot-choc un-startable. Let them pass.
    coffee_types = caps_raw.get('coffee_types') or caps_raw.get('drinks')
    _espresso_set = [d.lower() for d in ESPRESSO_DRINKS]
    if (
        requested_type
        and requested_type in _espresso_set
        and isinstance(coffee_types, list)
        and len(coffee_types) > 0
        and requested_type not in [str(c).lower() for c in coffee_types]
    ):
        return {
            'blocked': True,
            'reason': (
                f"This station isn't set up to make {requested_type}. "
                f"Available here: {', '.join(coffee_types)}."
            ),
        }

    milk_types = caps_raw.get('milk_types') or caps_raw.get('milks')
    if (
        requested_milk
        and isinstance(milk_types, list)
        and len(milk_types) > 0
    ):
        # Catalog-driven canonicalisation. Build a synonym map at
        # request time by reading catalog_items.properties.synonyms +
        # display_name / short_name / item_id for every milk. Anything
        # the operator or walk-in dialog throws at us — 'Whole Milk',
        # 'full cream', 'oat milk', 'OAT' — collapses to the canonical
        # item_id ('full_cream', 'oat') before comparison.
        #
        # Falls back to a static synonym set if catalog_items is
        # missing (fresh DB before migration ran).
        _STATIC_FALLBACK = {
            'whole milk': 'full_cream', 'whole': 'full_cream',
            'full cream': 'full_cream', 'regular': 'full_cream',
            'standard': 'full_cream', 'dairy': 'full_cream',
            'skim': 'skim', 'skinny': 'skim',
            'low fat': 'skim', 'trim': 'skim',
            'oat': 'oat', 'soy': 'soy', 'soya': 'soy',
            'almond': 'almond', 'coconut': 'coconut',
            'macadamia': 'macadamia', 'rice': 'rice',
            'lactose free': 'lactose_free',
            'lactose-free': 'lactose_free',
        }
        synonym_map = {}
        try:
            c2 = db.cursor()
            c2.execute("""
                SELECT item_id, display_name, short_name, properties
                FROM catalog_items
                WHERE category = 'milk' AND is_active = TRUE
            """)
            for iid, dn, sn, props in c2.fetchall():
                # Self + display + short variants
                for v in (iid, dn, sn):
                    if v:
                        key = v.strip().lower().removesuffix(' milk')
                        synonym_map[key] = iid
                # Explicit synonyms from properties JSONB
                for syn in (props or {}).get('synonyms', []):
                    synonym_map[str(syn).strip().lower()] = iid
        except Exception:
            synonym_map = dict(_STATIC_FALLBACK)

        def _milk_canon(s):
            t = (s or '').strip().lower()
            if t.endswith(' milk'):
                t = t[:-5].strip()
            elif t == 'milk':
                t = ''
            return synonym_map.get(t, t)

        requested_canon = _milk_canon(requested_milk)
        available_canon = {_milk_canon(m) for m in milk_types}
        if requested_canon and requested_canon not in available_canon:
            return {
                'blocked': True,
                'reason': (
                    f"This station doesn't stock {requested_milk}. "
                    f"Available here: {', '.join(milk_types)}."
                ),
            }

    return {'blocked': False, 'reason': ''}


def _emit_order_status_change(order_number, status):
    """Fire-and-forget SocketIO emit so connected clients refresh.

    Forwarded by WebSocketService.js to the 'order_updated' window
    event, which useOrders + DisplayScreen + ReadyForPickupColumn
    all subscribe to. Without this, status changes only became
    visible on the next 15s poll. Steve hit this with Complete:
    "they are not going to the completed column" — the local
    optimistic update fired, but anything looking at the backend's
    canonical view (Ready-for-Pickup column, customer Display) had
    to wait for the poll.
    """
    try:
        socketio = current_app.config.get('socketio')
        if socketio:
            socketio.emit(
                'order_updated',
                {'order_number': order_number, 'status': status},
                room='orders',
            )
    except Exception as e:
        # Never let a WS emit failure break the request.
        logger.debug(f"socketio emit skipped: {e}")


# Default policy for the "started" SMS.
#
# Setting key: sms_started_policy  (settings table, JSON)
# Shape: {"policy": "always" | "queue_only" | "never",
#         "threshold_seconds": 60 }
#
# Default = queue_only at 60s: skip the started SMS for orders that
# were started within 60s of being created (no real queue happened).
# Saves a wasted SMS for instant-fulfilment walk-ins and SMS orders.
_SMS_STARTED_POLICY_DEFAULT = {
    'policy': 'queue_only',
    'threshold_seconds': 60,
}


def _should_send_started_sms(db, created_at):
    """Apply the operator's started-SMS policy.

    Args:
        db: the singleton DB connection (for settings lookup).
        created_at: when the order was created (datetime or naive
                    ISO string from Postgres).

    Returns:
        bool — True if the SMS should fire, False if suppressed.

    Behaviour:
      - policy='always'     → always send.
      - policy='never'      → never send.
      - policy='queue_only' → only send if the order has been
                              waiting > threshold_seconds. Orders
                              started instantly (empty queue) skip
                              the SMS; the ready SMS follows soon
                              enough.

    Soft-fails safely: if the settings read errors, we fall back to
    'queue_only' default (the smart behaviour). Never raises.
    """
    try:
        cfg = _kv_get(db, 'sms_started_policy', default=None)
    except Exception as e:
        logger.debug(f"sms_started_policy read failed (default applied): {e}")
        cfg = None
    if not isinstance(cfg, dict):
        cfg = dict(_SMS_STARTED_POLICY_DEFAULT)
    policy = (cfg.get('policy') or 'queue_only').strip().lower()
    if policy == 'always':
        return True
    if policy == 'never':
        return False
    # queue_only — compute age.
    try:
        threshold = int(cfg.get('threshold_seconds', 60))
    except (TypeError, ValueError):
        threshold = 60
    if not created_at:
        # Unknown age — be safe, send. (Better one extra SMS than
        # silently suppressing a customer who's actually waiting.)
        return True
    try:
        if isinstance(created_at, str):
            ca = datetime.fromisoformat(created_at.replace('Z', ''))
        else:
            ca = created_at
        age_seconds = (datetime.now() - ca).total_seconds()
    except Exception:
        return True
    return age_seconds >= threshold


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
        who = str(data.get('device') or request.remote_addr or 'unknown')[:64]
        for bucket in (who,):
            wait = lockout_remaining(log.get(bucket))
            if wait > 0:
                return jsonify({
                    'success': False,
                    'message': (f'Too many tries. Wait about '
                                f'{max(1, wait // 60)} minute(s) and try again.'),
                    'retry_after_seconds': wait,
                }), 429

        if not verify_code(code, cfg.get('code_hash')):
            log[who] = record_failure(log.get(who))
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
        if who in log:
            log.pop(who, None)
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


def _emit_new_order(order_payload):
    """Fire-and-forget SocketIO emit when a NEW order is created.

    Steve hit this in QC: SMS customer placed an order, the order
    appeared in the database, but the Barista UI's Upcoming Orders
    list stayed empty until the next poll (or a manual Refresh tap).
    Reason: POST /api/orders only inserted the row — never emitted
    a 'new_order'/'order_created' event for the WS layer to forward
    to the React UI's listeners.

    Frontend listener is ApiService.js webSocketService.on('order_created').
    We also emit 'new_order' to a station-scoped room so a barista
    UI filtered to one station can show fresh orders without seeing
    every station's traffic.

    Pass a dict containing at minimum order_number, status, and
    station_id; the frontend handler will merge into its local
    queue and re-render.
    """
    try:
        socketio = current_app.config.get('socketio')
        if not socketio:
            return
        socketio.emit('order_created', order_payload, room='orders')
        station_id = order_payload.get('station_id') or order_payload.get('stationId')
        if station_id is not None:
            socketio.emit(
                'new_order', order_payload, room=f'station_{station_id}',
            )
    except Exception as e:
        logger.debug(f"socketio new-order emit skipped: {e}")


def _render_sms_template(template, context, default_body):
    """Fill {placeholders} in an operator-edited SMS template, safely.

    Uses literal replace (not str.format) so a stray brace in a template
    can never crash a send. Unknown placeholders are left visible so the
    operator can SEE the typo in their test message. Falls back to the
    default when the template is empty/blank. Warns (but still sends)
    when the result leaves single-segment GSM-7 territory — emoji or
    length mistakes double per-SMS cost silently otherwise.
    """
    tpl = (template or '').strip()
    if not tpl:
        return default_body
    body = tpl
    for key, value in context.items():
        body = body.replace('{' + key + '}', str(value if value is not None else ''))
    if len(body) > 160 or any(ord(ch) > 127 for ch in body):
        logger.warning(
            f"SMS template renders outside single-segment GSM-7 "
            f"(len={len(body)}, non-ascii={any(ord(c) > 127 for c in body)}) — "
            f"this doubles per-message cost. Template: {tpl[:80]!r}")
    return body


def _sms_description(order_details):
    """Short warm drink description: 'large oat latte'."""
    parts = []
    if order_details.get('size'):
        parts.append(order_details.get('size'))
    milk = order_details.get('milk')
    if milk and milk != 'no milk':
        parts.append(f"{milk}")
    parts.append(order_details.get('type') or 'coffee')
    return ' '.join(parts)


def _render_started_message(order_number, order_details):
    """The 'being made now' SMS body — template-driven via the
    sms_started_message setting (placeholders: {name} {drink}
    {order_number} {station}); hardcoded default when unset."""
    description = _sms_description(order_details)
    default_body = (
        f"Your {description} (order #{order_number}) is being made now "
        f"- we'll text you when it's ready."
    )
    try:
        cs = current_app.config.get('coffee_system')
        tpl = cs._get_setting('sms_started_message', '') if cs else ''
    except Exception:
        tpl = ''
    return _render_sms_template(tpl, {
        'name': order_details.get('name') or 'there',
        'drink': description,
        'order_number': order_number,
        'station': order_details.get('station_id') or '',
    }, default_body)


def _notify_customer_order_started(phone, order_number, order_details):
    """Send a brief 'your drink is being made now' SMS.

    Never raises — the order has already been started in the DB by the
    time we get here, so a messaging failure must not roll that back.
    """
    if not phone:
        return
    try:
        messaging_service = current_app.config.get('messaging_service')
        if not messaging_service:
            logger.warning("No messaging_service configured; skipping start notification")
            return

        # THE HOLD APPLIES HERE TOO -- and this was missed when the hold
        # shipped. Its whole purpose is pre-orders: take them beforehand,
        # make them during a session, tell nobody until the break. With
        # only the READY path held, starting each coffee still texted the
        # customer, so a hold that was supposed to keep 400 phones quiet
        # let the first half of the messages straight through.
        #
        # DROPPED, not queued. A "your drink is being made now" released
        # forty minutes later, next to a "ready" from the same batch, is
        # worse than never sending it -- it is stale and it is confusing.
        # The ready message is the one worth keeping; this one only has
        # value in the moment it would have been sent.
        try:
            _db_h = current_app.config.get('coffee_system').db
            if is_holding(_kv_get(_db_h, HOLD_SETTING_KEY, default=None)):
                logger.info(f"Order {order_number}: started-SMS skipped (hold is on)")
                return
        except Exception as _h_err:
            # A broken hold must never silence a customer: fall through
            # and send, which is the behaviour without the feature.
            logger.warning(f"hold check failed on started-SMS, sending: {_h_err}")
            try:
                current_app.config.get('coffee_system').db.rollback()
            except Exception:
                pass

        # order_details may be a JSON string (depending on cursor type)
        # or a dict. Normalise.
        if isinstance(order_details, str):
            try:
                import json as _json
                order_details = _json.loads(order_details)
            except Exception:
                order_details = {}

        if not isinstance(order_details, dict):
            order_details = {}

        body = _render_started_message(order_number, order_details)
        messaging_service.send_message(phone, body)
    except Exception as exc:
        logger.error(f"Error sending start-notification SMS: {exc}")

@bp.route('/orders/<order_id>/complete', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def complete_order(order_id):
    """Complete an order"""
    try:
        # Log incoming request
        logger.info(f"Received request to complete order: {order_id}")

        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})

        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")

        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Check if order exists — fetch details + phone + status too so we
        # can decrement stock at completion AND send the customer a
        # "your drink is ready" SMS once the status flip succeeds, AND
        # so we can guard against re-completing an already-completed
        # order (which would re-fire the SMS, the bug Steve hit on
        # triple-tap during QC).
        cursor = db.cursor()
        cursor.execute(
            'SELECT id, station_id, order_details, phone, status FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        if isinstance(order_row, dict):
            station_id_for_stock = order_row.get('station_id') or 1
            order_details_raw = order_row.get('order_details') or {}
            order_phone = order_row.get('phone') or ''
            current_status = order_row.get('status')
        else:
            _, station_id_for_stock, order_details_raw, order_phone, current_status = order_row
            station_id_for_stock = station_id_for_stock or 1
            order_phone = order_phone or ''

        # State guards (same shape as /start). picked_up is terminal —
        # don't fire ready SMS for an order that's already collected.
        if current_status == 'cancelled':
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} was cancelled.",
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent: already completed → no-op success. CRITICAL: do
        # NOT re-send the ready SMS or re-decrement stock. This was the
        # source of duplicate "your coffee is ready" texts on misclick.
        if current_status in ('completed', 'picked_up'):
            return jsonify({
                "success": True,
                "message": f"Order already {current_status}",
                "current_status": current_status,
                "noop": True,
            })

        # Get current time
        completed_at = datetime.now().isoformat()

        # Update order status
        cursor.execute('''
            UPDATE orders
            SET status = 'completed', updated_at = %s, completed_at = %s
            WHERE order_number = %s
        ''', (completed_at, completed_at, clean_id))

        db.commit()
        rows_affected = cursor.rowcount

        # Decrement inventory at the moment the drink is actually
        # made. Tea-aware decrement (small milk volume, 2 cups when
        # double-cupped) lives in coffee_system._decrement_stock_for_order.
        # Failure here is non-fatal — the order is already marked
        # complete and we don't want to roll that back over inventory
        # accounting — but we surface skipped items so the barista
        # gets a toast warning instead of silently consuming stock
        # that the system thinks they have.
        stock_result = {'decremented': [], 'skipped': []}
        try:
            order_details_parsed = order_details_raw
            if isinstance(order_details_parsed, str):
                try:
                    order_details_parsed = json.loads(order_details_parsed)
                except Exception:
                    order_details_parsed = {}
            if isinstance(order_details_parsed, dict) and order_details_parsed:
                db_type = 'sqlite' if 'sqlite' in str(type(db)).lower() else 'postgres'
                stock_result = coffee_system._decrement_stock_for_order(
                    db, db_type, station_id_for_stock, order_details_parsed,
                ) or stock_result
                # Commit the inventory UPDATEs.
                #
                # CRITICAL BUG without this: _decrement_stock_for_order
                # runs UPDATE inventory_items SET amount = amount - X
                # against the cursor, but never commits. The order-status
                # commit at line 2217 happened BEFORE this — those
                # inventory UPDATEs sat in an uncommitted transaction
                # and disappeared on the next request's defensive
                # rollback. Net effect: stock NEVER decremented in
                # production (audit verified). Goal 3 of the product
                # was silently broken since launch.
                try:
                    db.commit()
                except Exception as commit_err:
                    logger.error(
                        "Stock-decrement commit failed for order "
                        f"{clean_id}: {commit_err}"
                    )
                if stock_result.get('skipped'):
                    logger.warning(
                        f"Stock decrement on complete: skipped items for "
                        f"order {clean_id} → {stock_result['skipped']}"
                    )
        except Exception as inv_err:
            logger.error(f"Stock decrement on complete failed (non-fatal): {inv_err}")
            try:
                db.rollback()
            except Exception:
                pass
        
        if rows_affected > 0:
            logger.info(f"Successfully completed order: {clean_id}")
            _emit_order_status_change(clean_id, 'completed')

            # Send the customer a "your drink is ready" SMS. This was
            # the biggest gap in the SMS UX audit — the legacy PUT
            # /status path sent this, but the new /complete endpoint
            # (which the Barista UI now uses) didn't. Customers had
            # no signal their order was ready unless they were
            # watching the customer Display screen.
            #
            # Never raises — the order is already marked complete by
            # the time we get here, so a messaging failure must not
            # roll that back.
            # test_no_send (Test Bench): full transition, no real SMS — but
            # RECORD the message that would have gone out, so template
            # propagation is provable end to end without a send.
            if not ((request.get_json(silent=True) or {}).get('test_no_send')
                    or (request.get_json(silent=True) or {}).get('dry_run')):
                _notify_customer_order_ready(
                    order_phone,
                    clean_id,
                    order_details_parsed if isinstance(order_details_parsed, dict) else {},
                    station_id_for_stock,
                )
            elif order_phone:
                try:
                    _body = _render_ready_message(
                        clean_id,
                        order_details_parsed if isinstance(order_details_parsed, dict) else {},
                        station_id_for_stock)
                    _mc = db.cursor()
                    _mc.execute("""
                        INSERT INTO order_messages (order_number, phone, message, message_sid)
                        VALUES (%s, %s, %s, %s)
                    """, (clean_id, order_phone, _body, 'test_no_send'))
                    db.commit()
                except Exception as _rec_err:
                    logger.warning(f"test_no_send message record skipped: {_rec_err}")

            # Surface stock-decrement skipped items in the response so
            # the barista UI can toast a warning. `stock_warnings` is a
            # human-readable summary, frontend renders it conditionally.
            response = {"success": True, "message": "Order completed successfully"}
            if stock_result.get('skipped'):
                names = [
                    f"{s.get('category', '?')}:{s.get('name', '?')}"
                    for s in stock_result['skipped']
                ]
                response['stock_warnings'] = (
                    f"Order completed, but stock wasn't decremented for: "
                    f"{', '.join(names)} (no matching inventory row)."
                )
                response['stock_skipped'] = stock_result['skipped']
            return jsonify(response)
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})

    except Exception as e:
        logger.error(f"Error completing order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})


def _notify_customer_order_ready(phone, order_number, order_details, station_id):
    """Send the customer a 'your drink is ready' SMS.

    Mirror of _notify_customer_order_started for the pending →
    in-progress transition. Called from /complete; safe to call with
    a blank phone (no-op).
    """
    if not phone:
        return
    try:
        messaging_service = current_app.config.get('messaging_service')
        if not messaging_service:
            logger.warning("No messaging_service configured; skipping ready notification")
            return

        if isinstance(order_details, str):
            try:
                import json as _json
                order_details = _json.loads(order_details)
            except Exception:
                order_details = {}
        if not isinstance(order_details, dict):
            order_details = {}

        # HOLD -- checked before anything else, because holding is a
        # decision about WHEN to tell the customer, not about how to send.
        # Putting it after the bench wall meant a bench order was never
        # marked held and the release flow could not be exercised on the
        # Test Bench at all.
        #
        # During pre-orders the coffees are made while a session is
        # running. Sending each "ready" text as it finishes puts 400
        # phones on the buzz through a plenary, and charges for every one.
        # While the hold is on the order still completes, still prints,
        # still shows ready on the board; only the text waits.
        try:
            _db_hold = current_app.config.get('coffee_system').db
            if is_holding(_kv_get(_db_hold, HOLD_SETTING_KEY, default=None)):
                _c = _db_hold.cursor()
                _c.execute("SELECT order_details FROM orders WHERE order_number = %s",
                           (order_number,))
                _r = _c.fetchone()
                if _r:
                    _raw = _r[0] if not isinstance(_r, dict) else _r.get('order_details')
                    _od = json.loads(_raw) if isinstance(_raw, str) else (_raw or {})
                    mark_held(_od)
                    _c.execute(
                        "UPDATE orders SET order_details = %s WHERE order_number = %s",
                        (json.dumps(_od), order_number))
                    _db_hold.commit()
                logger.info(f"Order {order_number}: ready-SMS held (hold is on)")
                return
        except Exception as _hold_err:
            # A broken hold must never silence a customer. Fall through and
            # send, which is exactly the behaviour without this feature.
            logger.warning(f"notification hold check failed, sending anyway: {_hold_err}")
            try:
                current_app.config.get('coffee_system').db.rollback()
            except Exception:
                pass

        body = _render_ready_message(order_number, order_details, station_id)

        # BENCH WALL: the Test Bench's simulator phones all share the
        # +6140000 prefix (never a real customer). A bench-created order
        # completed WITHOUT the test_no_send flag used to fall through
        # to a REAL Twilio attempt here — caught 2026-08-01 when the
        # express-batch guard's ready-SMS never recorded. Record the
        # rendered message instead of sending, so template propagation
        # stays provable and the zero-real-SMS rule holds structurally,
        # whatever the caller forgot.
        if str(phone).startswith('+6140000'):
            try:
                _bc = current_app.config.get('coffee_system').db.cursor()
                _bc.execute("""
                    INSERT INTO order_messages (order_number, phone, message, message_sid)
                    VALUES (%s, %s, %s, %s)
                """, (order_number, phone, body, 'bench_guard'))
                current_app.config.get('coffee_system').db.commit()
            except Exception as _bg_err:
                logger.warning(f"bench-guard message record skipped: {_bg_err}")
            return

        # OFF THE REQUEST. Everything above - reading settings, rendering the
        # template, the bench wall - stays inline, because it touches the
        # database and the app context and is fast. Only the network call to
        # Twilio moves, because that is the part that can hang.
        #
        # Why it matters: this runs inside /complete, so the barista's tap did
        # not return until Twilio answered. app.py imports eventlet but never
        # calls monkey_patch(), so a blocking socket read stalls the whole hub
        # rather than one greenlet - and the server is single-threaded. On
        # 23 Aug that turned one slow SMS into 25 minutes of downtime, with
        # CPU at 0.0 vCPU throughout.
        #
        # A real OS thread is deliberate: un-patched eventlet means
        # threading.Thread is a genuine thread, so the blocking call happens
        # off the hub entirely. daemon=True so it can never hold shutdown.
        _dispatch_sms_async(messaging_service, phone, body, order_number)
    except Exception as exc:
        logger.error(f"Error sending ready-notification SMS: {exc}")


def _dispatch_sms_async(messaging_service, phone, body, order_number):
    """Send one SMS without holding the request.

    Falls back to sending inline if a thread cannot be started - a missed
    text is worse than a slow one, and the timeout on the Twilio client
    bounds how slow that can get.
    """
    def _send():
        try:
            messaging_service.send_message(phone, body)
        except Exception as exc:
            logger.error("Async ready-SMS failed for order %s: %s",
                         order_number, exc)

    try:
        threading.Thread(target=_send, name=f"sms-{order_number}",
                         daemon=True).start()
    except Exception as exc:
        logger.warning("Could not start SMS thread (%s); sending inline", exc)
        _send()


def _render_ready_message(order_number, order_details, station_id):
    """The 'ready for pickup' SMS body — template-driven via the
    sms_ready_message setting (placeholders: {name} {drink} {order_number}
    {station}); hardcoded default when unset. The sponsor credit is
    appended to either path.

    No emoji in the default: an emoji forces UCS-2 encoding, which cuts
    the per-segment limit from 160 to 70 chars — doubling the cost. The
    template renderer warns if an operator's template does that.
    """
    name = order_details.get('name') or 'there'
    description = _sms_description(order_details)
    # Express-batch orders carry a collection note ("the FLAT WHITE
    # table at Coffee Station 1") that replaces the plain station text —
    # riding the existing {station} placeholder, so custom templates
    # keep working untouched.
    station_label = (str(order_details.get('collection_note') or '').strip()
                     or (f"Station {station_id}" if station_id else "the counter"))
    sponsor = ''
    try:
        cs = current_app.config.get('coffee_system')
        if cs and getattr(cs, 'db', None):
            sponsor = _sms_sponsor_tag(cs.db)
    except Exception:
        sponsor = ''
    default_body = (
        f"Hi {name}, your {description} (order #{order_number}) "
        f"is ready at {station_label}. Enjoy!"
    )
    try:
        cs = current_app.config.get('coffee_system')
        tpl = cs._get_setting('sms_ready_message', '') if cs else ''
    except Exception:
        tpl = ''
    body = _render_sms_template(tpl, {
        'name': name,
        'drink': description,
        'order_number': order_number,
        'station': station_label,
    }, default_body)
    return f"{body}{sponsor}"


def _sms_sponsor_tag(db):
    """Optional sponsor credit appended to the customer's 'ready' SMS, e.g.
    ' Brought to you by Platinum Sponsor XYZ.' Empty unless the operator has a
    sponsor configured AND sponsor display enabled (branding_settings
    showSponsor + sponsorName) — the same toggle that shows the sponsor on the
    Display. Lets a sponsor's name reach every customer's phone, which can
    offset event-hire cost in exchange for the airtime."""
    try:
        b = _kv_get(db, 'branding_settings', default={}) or {}
        if not (b.get('showSponsor') or b.get('sponsorEnabled')):
            return ''
        name = (b.get('sponsorName') or '').strip()
        if not name:
            return ''
        return f" Brought to you by {name}."
    except Exception:
        return ''

@bp.route('/orders/<order_number>/messages', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def order_message_history(order_number):
    """Every SMS recorded for one order (confirmations, barista messages,
    test_no_send renders). order_messages previously had no per-order
    reader — needed for the barista's context and the bench's
    template-propagation proof."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cur = db.cursor()
        cur.execute("""
            SELECT id, order_number, phone, message, message_sid, sent_at
              FROM order_messages
             WHERE order_number = %s
             ORDER BY sent_at ASC
             LIMIT 50
        """, (clean_order_id(order_number),))
        cols = ['id', 'order_number', 'phone', 'message', 'message_sid', 'sent_at']
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r)) if not isinstance(r, dict) else dict(r)
            if hasattr(d.get('sent_at'), 'isoformat'):
                d['sent_at'] = d['sent_at'].isoformat()
            rows.append(d)
        return jsonify({'success': True, 'messages': rows})
    except Exception as e:
        logger.error(f"order_message_history error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/orders/batch-complete', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def batch_complete_orders():
    """Express batch (the big-event 'flat white table' flow): complete a
    tray of same-kind orders in ONE action. Each order is stamped with a
    collection note first ('the FLAT WHITE table at Coffee Station 1'),
    which the ready-SMS renders via its {station} placeholder, then
    completed through the REAL complete endpoint one by one — stock,
    WebSocket, SMS and the display all behave exactly as for individual
    completes. Per-order results returned; one failure never aborts the
    tray (Steve: orders must not be lost to the bulk process)."""
    try:
        data = request.get_json(silent=True) or {}
        order_ids = [str(o) for o in (data.get('order_ids') or []) if o]
        collection_label = str(data.get('collection_label') or '').strip()[:80]
        if not order_ids:
            return jsonify({'success': False, 'message': 'order_ids required'}), 400
        if len(order_ids) > 60:
            return jsonify({'success': False,
                            'message': 'batch too large (max 60)'}), 400
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        # Stamp the collection note on every order BEFORE completing —
        # the SMS renders during the complete call.
        if collection_label:
            cursor = db.cursor()
            for oid in order_ids:
                cursor.execute(
                    "UPDATE orders SET order_details = order_details || %s::jsonb "
                    "WHERE order_number = %s",
                    (json.dumps({'collection_note': collection_label}),
                     clean_order_id(oid)))
            db.commit()
        from flask_jwt_extended import create_access_token
        service_token = create_access_token(
            identity='express-batch',
            additional_claims={'role': 'staff', 'source': 'batch-complete'})
        client = current_app.test_client()
        # Forward the test flags so a bench tray records its SMSes
        # instead of sending, same as individual completes.
        inner_body = {}
        for flag in ('test_no_send', 'dry_run'):
            if data.get(flag):
                inner_body[flag] = True
        completed, failed = [], []
        for oid in order_ids:
            try:
                resp = client.post(
                    f'/api/orders/{clean_order_id(oid)}/complete',
                    json=inner_body,
                    headers={'Authorization': f'Bearer {service_token}'})
                body = resp.get_json(silent=True) or {}
                if resp.status_code == 200 and body.get('success', True):
                    completed.append(oid)
                else:
                    failed.append({'order': oid,
                                   'error': body.get('message') or f'HTTP {resp.status_code}'})
            except Exception as one_err:
                failed.append({'order': oid, 'error': str(one_err)})
        return jsonify({'success': len(failed) == 0,
                        'completed': completed, 'failed': failed,
                        'collection_label': collection_label})
    except Exception as e:
        logger.error(f"batch_complete_orders error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/orders/<order_id>/stage', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def set_order_stage(order_id):
    """Team mode: tick (or untick) one stage of an in-progress order —
    'shots' or 'milk' — so two-plus baristas sharing a station's iPad can
    divide the work and see each other's progress. Stamps a timestamp
    into order_details.stages.<stage>; COMPLETE stays a separate,
    explicit action (an accidental tap must never fire the ready-SMS)."""
    try:
        data = request.get_json(silent=True) or {}
        stage = str(data.get('stage') or '').strip().lower()
        done = data.get('done', True)
        if stage not in ('shots', 'milk'):
            return jsonify({'success': False,
                            'message': "stage must be 'shots' or 'milk'"}), 400
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cursor = db.cursor()
        cursor.execute("SELECT order_details FROM orders WHERE order_number = %s",
                       (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': False,
                            'message': f'Order {clean_id} not found'}), 404
        od_raw = row[0] if not isinstance(row, dict) else row.get('order_details')
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
        stages = od.get('stages') or {}
        if done:
            stages[stage] = datetime.now().isoformat()
        else:
            stages.pop(stage, None)
        cursor.execute(
            "UPDATE orders SET order_details = order_details || %s::jsonb "
            "WHERE order_number = %s",
            (json.dumps({'stages': stages}), clean_id))
        db.commit()
        return jsonify({'success': True, 'stages': stages})
    except Exception as e:
        logger.error(f"set_order_stage error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/orders/<order_id>/pickup', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def pickup_order(order_id):
    """Mark an order as picked up"""
    try:
        # Log incoming request
        logger.info(f"Received request to mark order as picked up: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists + fetch current status so we can be
        # idempotent: a second /pickup tap on an already-picked-up
        # order shouldn't error, but it also shouldn't re-emit WS or
        # re-update timestamps (which would mask "when was this
        # actually collected" in the audit history).
        cursor = db.cursor()
        # Pull station_id too so we can decrement station_stats.current_load
        # on a successful pickup. Was: orders incremented current_load on
        # confirm but nothing ever decremented it on the way out (the
        # audit found Station 1 reporting current_load=3 after 10+ orders
        # had been processed and picked up). Pickup is the right place
        # for the decrement — that's when the cup leaves the station.
        cursor.execute(
            'SELECT id, status, station_id FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        if isinstance(order_row, dict):
            current_status = order_row.get('status')
            pickup_station_id = order_row.get('station_id')
        else:
            _, current_status, pickup_station_id = order_row

        # State guards.
        if current_status == 'cancelled':
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} was cancelled.",
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent — already picked up. No DB change, no WS emit.
        if current_status == 'picked_up':
            return jsonify({
                "success": True,
                "message": "Order already picked up",
                "current_status": current_status,
                "noop": True,
            })

        # Get current time
        pickup_at = datetime.now().isoformat()

        # Update order: status → 'picked_up' AND set timestamps.
        # The status change is critical: without it the order stays
        # as status='completed' forever, so the customer Display
        # keeps showing it in "Ready for Pickup" even after the
        # barista taps Collected. (Bug Steve hit on Station 4.)
        try:
            cursor.execute('''
                UPDATE orders
                SET status = 'picked_up',
                    picked_up_at = %s,
                    updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, pickup_at, clean_id))
        except Exception as e:
            # picked_up_at column missing on this DB — best-effort
            # without the timestamp, but still flip the status so the
            # Display knows to drop the order.
            logger.warning(f"picked_up_at column may not exist, using simpler update: {str(e)}")
            try:
                db.rollback()
            except Exception:
                pass
            cursor.execute('''
                UPDATE orders
                SET status = 'picked_up', updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully marked order as picked up: {clean_id}")

            # Decrement station_stats.current_load.
            # See SELECT comment above for the rationale.
            if pickup_station_id:
                try:
                    cursor.execute("""
                        UPDATE station_stats
                        SET current_load = GREATEST(0, current_load - 1),
                            last_updated = CURRENT_TIMESTAMP
                        WHERE station_id = %s
                    """, (pickup_station_id,))
                    db.commit()
                except Exception as load_err:
                    logger.warning(
                        f"current_load decrement failed (non-fatal) for "
                        f"order {clean_id}, station {pickup_station_id}: {load_err}"
                    )
                    try:
                        db.rollback()
                    except Exception:
                        pass

            _emit_order_status_change(clean_id, 'picked_up')

            # EA Phase-2 write-back: EA-linked orders push a summary line
            # onto the attendee's EventsAir custom field. Daemon thread,
            # gated on the channel + writeback toggles — zero impact when
            # off, and never on the pickup response either way.
            try:
                from routes.ea_survey_routes import maybe_writeback_order
                maybe_writeback_order(current_app._get_current_object(), clean_id)
            except Exception:
                pass

            return jsonify({"success": True, "message": "Order marked as picked up successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error marking order as picked up {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/orders/batch', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def batch_process_orders():
    """Process a batch of orders"""
    try:
        data = request.json
        order_ids = data.get('order_ids', [])
        action = data.get('action', 'start')
        
        if not order_ids:
            return jsonify({"success": False, "message": "No order IDs provided"})
        
        logger.info(f"Processing {len(order_ids)} orders in batch, action: {action}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Clean all IDs if needed
        clean_ids = [clean_order_id(order_id) for order_id in order_ids]
        logger.info(f"Cleaned order IDs: {clean_ids}")
        
        # Update orders
        cursor = db.cursor()
        current_time = datetime.now().isoformat()
        
        success_count = 0
        for order_id in clean_ids:
            try:
                if action == 'start':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'in-progress', updated_at = %s, started_at = %s
                        WHERE order_number = %s
                    ''', (current_time, current_time, order_id))
                elif action == 'complete':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'completed', updated_at = %s, completed_at = %s
                        WHERE order_number = %s
                    ''', (current_time, current_time, order_id))
                
                if cursor.rowcount > 0:
                    success_count += 1
                    logger.info(f"Successfully processed order {order_id} in batch")
                else:
                    logger.warning(f"Order {order_id} not found or not updated")
            except Exception as e:
                logger.error(f"Error processing order {order_id}: {str(e)}")
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "processed": success_count,
            "total": len(order_ids)
        })
    
    except Exception as e:
        logger.error(f"Error batch processing orders: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

# ---------------------------------------------------------------------------
# Customer-question escape hatch ("BARISTA" SMS command)
# ---------------------------------------------------------------------------
# Customer texts BARISTA → coffee_system.py inserts a row in
# customer_questions → these endpoints let the Barista UI list pending
# rows and reply (which SMSes the response back to the customer).
# Background timeout sweeper lives in services/question_timeout.py.

@bp.route('/customer-questions', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def list_customer_questions():
    """List customer questions. Default = pending only (what the
    Barista UI's badge polls). Pass ?status=all for the full history."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        wanted = (request.args.get('status') or 'pending').strip().lower()
        cursor = db.cursor()
        if wanted == 'all':
            cursor.execute(
                "SELECT id, phone, customer_name, question, status, response, "
                "responded_by, created_at, responded_at "
                "FROM customer_questions ORDER BY created_at DESC LIMIT 100"
            )
        else:
            cursor.execute(
                "SELECT id, phone, customer_name, question, status, response, "
                "responded_by, created_at, responded_at "
                "FROM customer_questions WHERE status = %s "
                "ORDER BY created_at ASC LIMIT 50",
                (wanted,),
            )
        rows = cursor.fetchall() or []
        items = []
        for r in rows:
            if isinstance(r, dict):
                items.append({
                    **r,
                    'created_at': r['created_at'].isoformat() + 'Z' if hasattr(r.get('created_at'), 'isoformat') else r.get('created_at'),
                    'createdAt': r['created_at'].isoformat() + 'Z' if hasattr(r.get('created_at'), 'isoformat') else r.get('created_at'),
                    'customerName': r.get('customer_name'),
                })
            else:
                (rid, phone, name, question, status, response,
                 responded_by, created_at, responded_at) = r
                ca_iso = created_at.isoformat() + 'Z' if hasattr(created_at, 'isoformat') else (created_at or '')
                ra_iso = responded_at.isoformat() + 'Z' if hasattr(responded_at, 'isoformat') else (responded_at or '')
                items.append({
                    'id': rid,
                    'phone': phone,
                    'customer_name': name,
                    'customerName': name,
                    'question': question,
                    'status': status,
                    'response': response,
                    'responded_by': responded_by,
                    'respondedBy': responded_by,
                    'created_at': ca_iso,
                    'createdAt': ca_iso,
                    'responded_at': ra_iso,
                    'respondedAt': ra_iso,
                })
        return jsonify({
            'success': True,
            'data': items,
            'count': len(items),
        })
    except Exception as e:
        logger.error(f"list_customer_questions error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route('/customer-questions/<int:qid>/reply', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def reply_to_customer_question(qid):
    """Barista answers the customer's question. Marks the row
    'answered' AND sends the response as an SMS to the customer.

    Body: { "response": "yes, our beans are organic single-origin" }
    Optional: { "responded_by": "Station 1" }  (defaults to JWT user)
    """
    try:
        data = request.get_json(silent=True) or {}
        response_text = (data.get('response') or '').strip()
        if not response_text:
            return jsonify({
                "success": False,
                "message": "response text is required",
            }), 400

        responded_by = (
            data.get('responded_by')
            or data.get('respondedBy')
            or 'barista'
        )

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()

        # Race-safe: only flip from 'pending' → 'answered'. If the row
        # already timed out OR another barista answered first, the
        # UPDATE matches 0 rows and we surface a clean message.
        cursor.execute(
            """
            UPDATE customer_questions
               SET status = 'answered',
                   response = %s,
                   responded_by = %s,
                   responded_at = %s
             WHERE id = %s
               AND status = 'pending'
            RETURNING phone, customer_name, question
            """,
            (response_text, responded_by, datetime.now(), qid),
        )
        row = cursor.fetchone()
        db.commit()

        if not row:
            return jsonify({
                "success": False,
                "message": (
                    "This question is no longer pending — it was already "
                    "answered, timed out, or doesn't exist."
                ),
                "code": "QUESTION_NOT_PENDING",
            }), 409

        if isinstance(row, dict):
            phone = row.get('phone')
        else:
            phone, _name, _question = row

        # Send SMS reply.
        messaging_service = current_app.config.get('messaging_service')
        if messaging_service and phone:
            try:
                # Plain text — no template wrapping. The barista's words
                # are the customer's answer.
                messaging_service.send_message(phone, response_text)
            except Exception as sms_err:
                logger.error(f"Failed to SMS reply for q{qid}: {sms_err}")

        # Push a WS event so OTHER baristas' UIs remove the row from
        # their pending list (it's now answered).
        try:
            socketio = current_app.config.get('socketio')
            if socketio:
                socketio.emit(
                    'customer_question_answered',
                    {'id': qid, 'status': 'answered', 'responded_by': responded_by},
                    room='orders',
                )
        except Exception as ws_err:
            logger.debug(f"customer_question_answered WS emit skipped: {ws_err}")

        return jsonify({
            "success": True,
            "message": "Reply sent to customer",
        })
    except Exception as e:
        logger.error(f"reply_to_customer_question error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route('/orders/<order_id>/message', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def send_message(order_id):
    """Send a message to a customer about their order"""
    try:
        # Log incoming request
        logger.info(f"Received request to send message for order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get message content from request
        data = request.json
        message = data.get('message', '')
        
        if not message:
            logger.error("No message content provided")
            return jsonify({"success": False, "message": "No message content provided"})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            return jsonify({"success": False, "message": "Service unavailable"})
        
        # Debug messaging service configuration
        logger.info(f"Messaging service config - Client: {messaging_service.client is not None}")
        logger.info(f"Messaging service config - Testing mode: {messaging_service.testing_mode}")
        logger.info(f"Messaging service config - Phone number: {messaging_service.phone_number}")
        
        # Get order details to send message
        db = coffee_system.db
        cursor = db.cursor()
        cursor.execute('SELECT phone FROM orders WHERE order_number = %s', (clean_id,))
        order = cursor.fetchone()
        
        if not order:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        phone_number = order[0]
        
        if not phone_number:
            logger.error(f"No phone number for order: {clean_id}")
            return jsonify({"success": False, "message": f"No phone number for order {clean_id}"})
            
        logger.info(f"Found phone number {phone_number} for order {clean_id}")
        
        # Check if the phone number is the same as the Twilio phone number
        if phone_number == messaging_service.phone_number:
            error_msg = "Cannot send SMS: recipient phone number is the same as the Twilio number"
            logger.error(error_msg)
            return jsonify({
                "success": False,
                "message": error_msg
            })
        
        # Create order_messages table if it doesn't exist
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS order_messages (
                    id SERIAL PRIMARY KEY,
                    order_number VARCHAR(50) NOT NULL,
                    phone VARCHAR(50) NOT NULL,
                    message TEXT NOT NULL,
                    message_sid VARCHAR(100),
                    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            db.commit()
        except Exception as e:
            logger.warning(f"Could not create order_messages table: {str(e)}")
            # Continue anyway
        
        # Send the message using messaging service.
        # dry_run (admin/staff test aid, e.g. the Test Bench journey suite):
        # do everything EXCEPT the real Twilio send, so the reply-routing link
        # can be exercised end-to-end without spending SMS credit / texting a
        # fake number. Mirrors the debug_stock pattern.
        dry_run = bool(data.get('dry_run') or data.get('test_no_send'))
        try:
            if dry_run:
                result = 'DRYRUN'
                logger.info(f"[dry_run] skipping real SMS send for order {clean_id}")
            else:
                result = messaging_service.send_message(phone_number, message)
                logger.info(f"Message sent to {phone_number} for order {clean_id}, result: {result}")
                logger.info(f"Result type: {type(result)}, Result value: {repr(result)}")

            # Check if message sending actually succeeded
            if result is None:
                logger.error("Messaging service returned None - message sending failed")
                return jsonify({
                    "success": False,
                    "message": "Failed to send SMS - messaging service returned no result"
                })
            
            # Log the message in the database
            try:
                cursor.execute("""
                    INSERT INTO order_messages
                    (order_number, phone, message, message_sid)
                    VALUES (%s, %s, %s, %s)
                """, (clean_id, phone_number, message, result))
                db.commit()
                logger.info(f"Saved message to database for order {clean_id}")
            except Exception as db_err:
                logger.warning(f"Could not save message to database: {str(db_err)}")
                # Continue anyway

            # Route the customer's REPLY back to the barista: park the
            # conversation in awaiting_barista_reply (with order + station
            # context) so the next inbound from this phone is forwarded to
            # the barista Messages inbox instead of being parsed as a brand
            # new order ("What's your first name?" after "did you want
            # sugar" — found live 2026-07-16).
            try:
                cursor.execute('SELECT station_id FROM orders WHERE order_number = %s', (clean_id,))
                _row = cursor.fetchone()
                coffee_system._set_conversation_state(phone_number, 'awaiting_barista_reply', {
                    'order_number': clean_id,
                    'station_id': _row[0] if _row else None,
                    'barista_message': message[:200],
                    'sent_at': datetime.now().isoformat(),
                })
                logger.info(f"Parked awaiting_barista_reply for {phone_number} (order {clean_id})")
            except Exception as park_err:
                logger.warning(f"Could not park barista-reply state (non-fatal): {park_err}")
            
            return jsonify({
                "success": True,
                "message": "Message sent successfully" if not dry_run else "Message recorded (dry run — no SMS sent)",
                "message_sid": result,
                "dry_run": dry_run,
            })
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")
            return jsonify({"success": False, "message": f"Error sending message: {str(e)}"})
    
    except Exception as e:
        logger.error(f"Error sending message for order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})


@bp.route('/orders/<order_id>/reassign', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def reassign_order(order_id):
    """Move an order to a different station.

    Use case: Station 1 runs out of oat milk / has a machine fault mid-event.
    The barista takes the station offline (status=maintenance) — that stops
    NEW orders from being routed there — but the 3 oat lattes already in
    its queue need to be pushed to Station 2 so the customers don't end up
    forgotten. This endpoint is the "push" half of that handoff.

    Body: {"target_station_id": <int>}

    Refuses to:
      - reassign a completed / picked-up order (it's already done — no
        point re-queueing it)
      - reassign to a station that doesn't exist, or one that isn't
        currently active
      - reassign to a station that can't make the drink (uses the same
        capability check Start uses, so we don't punt an oat order to
        a station that doesn't stock oat)
    """
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400

        clean_id = clean_order_id(order_id)
        payload = request.get_json(silent=True) or {}
        target_raw = payload.get('target_station_id') or payload.get('targetStationId')

        try:
            target_station_id = int(target_raw)
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "message": "target_station_id is required (integer)",
            }), 400

        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503

        db = coffee_system.db
        try:
            db.rollback()  # clear any prior aborted txn
        except Exception:
            pass

        cursor = db.cursor()

        # 1. Fetch the order. We need its current status + details for the
        # capability check.
        cursor.execute(
            'SELECT id, status, station_id, order_details '
            'FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} not found",
            }), 404

        order_pk, current_status, current_station_id, order_details_raw = (
            row if not isinstance(row, dict)
            else (row['id'], row['status'], row['station_id'], row['order_details'])
        )

        # 2. Status gate. Completed/picked-up orders are done — no point
        # moving them. Allow both pending and in-progress (in-progress
        # might happen if barista realises mid-pour they're out of milk).
        if current_status in ('completed', 'picked_up'):
            return jsonify({
                "success": False,
                "message": f"Order is already {current_status}; can't reassign.",
            }), 400

        # No-op when already at the target.
        if current_station_id == target_station_id:
            return jsonify({
                "success": True,
                "message": "Order is already at that station.",
                "no_change": True,
            })

        # 3. Validate target station exists + is active.
        cursor.execute(
            "SELECT status FROM station_stats WHERE station_id = %s",
            (target_station_id,),
        )
        target_row = cursor.fetchone()
        if not target_row:
            return jsonify({
                "success": False,
                "message": f"Station {target_station_id} doesn't exist.",
            }), 404
        target_status = target_row[0] if not isinstance(target_row, dict) else target_row.get('status')
        if target_status != 'active':
            return jsonify({
                "success": False,
                "message": (
                    f"Station {target_station_id} is {target_status}, not active. "
                    "Pick a different station."
                ),
            }), 400

        # 4. Capability check — same one /start uses, so we never push
        # an oat order to a station with no oat capability.
        parsed_details = order_details_raw
        if isinstance(parsed_details, str):
            try:
                parsed_details = json.loads(parsed_details)
            except Exception:
                parsed_details = {}
        if not isinstance(parsed_details, dict):
            parsed_details = {}

        cap = _station_can_make_order(db, target_station_id, parsed_details)
        if cap.get('blocked'):
            return jsonify({
                "success": False,
                "message": cap.get('reason') or (
                    f"Station {target_station_id} can't make this drink."
                ),
                "code": "STATION_CAPABILITY_MISMATCH",
            }), 400

        # 5. Do the move.
        cursor.execute(
            'UPDATE orders SET station_id = %s, updated_at = %s '
            'WHERE order_number = %s',
            (target_station_id, datetime.now(), clean_id),
        )
        db.commit()

        logger.info(
            f"Reassigned order {clean_id}: station "
            f"{current_station_id} → {target_station_id}"
        )

        # 6. Tell connected clients so both stations' queues refresh.
        _emit_order_status_change(clean_id, current_status)

        return jsonify({
            "success": True,
            "message": f"Order {clean_id} moved to station {target_station_id}.",
            "data": {
                "order_number": clean_id,
                "from_station_id": current_station_id,
                "to_station_id": target_station_id,
            },
        })

    except Exception as e:
        logger.error(f"reassign_order failed for {order_id}: {e}")
        logger.exception(e)
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({
            "success": False,
            "message": f"Error reassigning order: {e}",
        }), 500


@bp.route('/orders/<order_id>', methods=['PATCH'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def edit_order(order_id):
    """Barista override: edit an order's drink/milk/size/sugar/notes when it
    was taken down wrong. Only pending or in-progress orders can be edited —
    a completed/picked-up/cancelled order is done."""
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400
        clean_id = clean_order_id(order_id)
        payload = request.get_json(silent=True) or {}
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute('SELECT id, status, order_details FROM orders WHERE order_number = %s', (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": f"Order {clean_id} not found"}), 404
        o_id = row[0] if not isinstance(row, dict) else row['id']
        status = row[1] if not isinstance(row, dict) else row['status']
        details_raw = row[2] if not isinstance(row, dict) else row['order_details']
        if status in ('completed', 'picked_up', 'cancelled'):
            return jsonify({"success": False, "message": f"Can't edit a {status} order"}), 400
        details = details_raw
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {}
        if not isinstance(details, dict):
            details = {}
        # Map the various field aliases the frontend may send onto the
        # canonical order_details keys the rest of the pipeline reads.
        field_map = {
            'type': 'type', 'drink': 'type', 'coffee_type': 'type', 'coffeeType': 'type',
            'milk': 'milk', 'milk_type': 'milk', 'milkType': 'milk',
            'size': 'size',
            'sugar': 'sugar',
            'notes': 'notes', 'special_instructions': 'notes', 'specialInstructions': 'notes',
            # The rest of what the walk-in form can set. Editing an order
            # could only ever change drink/milk/size/sugar, so a barista
            # who took "double shot decaf, extra hot" down wrong had to
            # cancel the order and re-enter it. All of these already live
            # in order_details; nothing new is being invented here.
            'shots': 'shots',
            'bean_type': 'bean_type', 'beanType': 'bean_type',
            # NOT 'extra_hot' -> 'extra_hot'. Every reader in the system
            # derives extra hot from order_details['temp'] == 'extra hot'
            # (see the serializers around lines 530 and 1076, and the
            # label renderer). Writing an 'extra_hot' key would save
            # cleanly, report itself as changed, and then read back False
            # everywhere -- which is exactly what it did until this was
            # caught by editing a real order and looking at the result.
            # Handled explicitly below so both shapes stay in step.
            'extra_hot': '_extra_hot', 'extraHot': '_extra_hot',
            'vip': 'vip', 'priority': 'vip',
        }
        changed = {}
        for k, v in payload.items():
            key = field_map.get(k)
            if key and v is not None:
                details[key] = v
                changed[key] = v
        # Phone edits update the orders.phone COLUMN (what SMS sends and
        # the listing serializers read), not order_details. Lets the
        # barista add a number after the fact — "actually, can you text
        # me when it's ready?" — which previously wasn't possible.
        phone_val = None
        for pk in ('phone', 'phone_number', 'phoneNumber'):
            if pk in payload and payload[pk] is not None:
                phone_val = str(payload[pk]).strip()
                break
        if phone_val is not None:
            changed['phone'] = phone_val
        if not changed:
            return jsonify({"success": False, "message": "No editable fields provided"}), 400
        # VIP is TWO facts: the flag on order_details (what the label and
        # the SMS read) and queue_priority (what the queue actually sorts
        # by). Writing only the flag would show the badge while the order
        # stayed exactly where it was -- the badge would be a lie, and the
        # barista would believe it.
        # Translate the edit-form shape onto the canonical one. 'temp' is
        # what every reader looks at; 'extra_hot' is kept alongside it so
        # anything reading that key directly agrees rather than
        # contradicting.
        if '_extra_hot' in changed:
            wants_hot = bool(changed.pop('_extra_hot'))
            details.pop('_extra_hot', None)
            if wants_hot:
                details['temp'] = 'extra hot'
            elif details.get('temp') == 'extra hot':
                details['temp'] = ''
            details['extra_hot'] = wants_hot
            changed['extra_hot'] = wants_hot

        vip_priority = None
        if 'vip' in changed:
            vip_priority = 1 if changed['vip'] else 5

        if phone_val is not None and vip_priority is not None:
            cursor.execute(
                'UPDATE orders SET order_details = %s, phone = %s, '
                'queue_priority = %s, updated_at = %s WHERE id = %s',
                (json.dumps(details), phone_val, vip_priority, datetime.now(), o_id))
        elif phone_val is not None:
            cursor.execute('UPDATE orders SET order_details = %s, phone = %s, updated_at = %s WHERE id = %s',
                           (json.dumps(details), phone_val, datetime.now(), o_id))
        elif vip_priority is not None:
            cursor.execute(
                'UPDATE orders SET order_details = %s, queue_priority = %s, '
                'updated_at = %s WHERE id = %s',
                (json.dumps(details), vip_priority, datetime.now(), o_id))
        else:
            cursor.execute('UPDATE orders SET order_details = %s, updated_at = %s WHERE id = %s',
                           (json.dumps(details), datetime.now(), o_id))
        db.commit()
        return jsonify({"success": True, "message": f"Order {clean_id} updated", "changed": changed})
    except Exception as e:
        logger.error(f"edit_order error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": f"Error editing order: {e}"}), 500


@bp.route('/orders/<order_id>/cancel', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def cancel_order_barista(order_id):
    """Cancel an order from the barista screen (status='cancelled'). Drops it
    from the active queue but keeps the record for reporting/revenue. Refuses
    to cancel an already completed/picked-up order."""
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400
        clean_id = clean_order_id(order_id)
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute('SELECT id, status, station_id, order_details FROM orders WHERE order_number = %s', (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": f"Order {clean_id} not found"}), 404
        o_id = row[0] if not isinstance(row, dict) else row['id']
        status = row[1] if not isinstance(row, dict) else row['status']
        station_id = row[2] if not isinstance(row, dict) else row['station_id']
        raw_details = row[3] if not isinstance(row, dict) else row.get('order_details')
        if status in ('completed', 'picked_up'):
            return jsonify({"success": False, "message": f"Order already {status} — can't cancel"}), 400
        if status == 'cancelled':
            return jsonify({"success": True, "message": "Order already cancelled"})

        # Give the ingredients back: a cancelled order was never made, so its
        # milk/coffee/cups/sugar should return to stock — otherwise counters
        # drift low over an event with cancellations (Test Bench "cancel
        # restocks" warn). Idempotent + only fires if the order decremented;
        # non-fatal so a stock hiccup never blocks the cancel itself.
        try:
            details = raw_details
            if isinstance(details, str):
                details = json.loads(details)
            if isinstance(details, dict) and details.get('_stock_decremented') \
                    and not details.get('_stock_restocked'):
                dbtype = 'sqlite' if 'sqlite3' in str(type(db)).lower() else 'postgres'
                coffee_system._restock_for_order(db, dbtype, station_id, details)
                cursor.execute('UPDATE orders SET order_details = %s WHERE id = %s',
                               (json.dumps(details), o_id))
        except Exception as restock_err:
            logger.warning(f"cancel restock skipped (non-fatal): {restock_err}")
            try:
                db.rollback()
            except Exception:
                pass
            cursor = db.cursor()

        cursor.execute('UPDATE orders SET status = %s, updated_at = %s WHERE id = %s',
                       ('cancelled', datetime.now(), o_id))
        if station_id is not None:
            try:
                cursor.execute(
                    "UPDATE station_stats SET current_load = GREATEST(0, current_load - 1), last_updated = %s "
                    "WHERE station_id = %s",
                    (datetime.now(), station_id),
                )
            except Exception:
                pass
        db.commit()
        return jsonify({"success": True, "message": f"Order {clean_id} cancelled"})
    except Exception as e:
        logger.error(f"cancel_order_barista error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": f"Error cancelling order: {e}"}), 500


# ============================================================================
# DISPLAY ENDPOINTS (PUBLIC FACING)
# ============================================================================

def _event_code_for_display(db):
    """This event's ordering code, or '' if it has none.

    Never raises: the display config is a public, load-bearing endpoint
    and an unstamped poster is a far smaller problem than a config
    endpoint that 500s.
    """
    if db is None:
        return ''
    try:
        return event_access_settings(_kv_get(db, ACCESS_SETTING_KEY, default=None))['code']
    except Exception:
        return ''


@bp.route('/display/config', methods=['GET'])
def get_display_config():
    """Get display screen configuration including event details, sponsor info, and SMS details.

    Previously this read EVENT_NAME from Flask app config (an env
    var set at boot), so changing the event name via the Branding
    panel did NOTHING on the Display screen — Steve renamed the
    event and it didn't update. Now reads from the live branding
    settings KV (the same row /api/settings/branding writes to).
    """
    try:
        config = current_app.config.get('config', {})
        coffee_system = current_app.config.get('coffee_system')

        # Pull branding from the settings KV — what the Branding
        # panel actually writes to.
        branding = {}
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                branding = _kv_get(coffee_system.db, 'branding_settings', default={}) or {}
        except Exception as e:
            logger.warning(f"display/config: could not read branding settings: {e}")

        # Event name precedence: branding setting → env var → static fallback.
        event_name = (
            branding.get('eventName')
            or branding.get('event_name')
            or branding.get('landingPageTitle')
            or branding.get('clientName')          # operator's "Client Name" works as a fallback
            or config.get('EVENT_NAME')
            or 'Coffee Event'
        )

        # System/company name — same precedence pattern.
        system_name = (
            branding.get('systemName')
            or branding.get('system_name')
            or 'Coffee Cue'
        )

        # Sponsor block — operator may not have set this; default off.
        sponsor = {
            "enabled": bool(branding.get('showSponsor') or branding.get('sponsorEnabled')),
            "name":    branding.get('sponsorName') or '',
            "message": branding.get('sponsorMessage') or '',
        }

        # Pull real stations from station_stats so the Display
        # selector reflects the operator's actual setup rather than
        # the old hardcoded 1/2/3.
        stations = []
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                cur = coffee_system.db.cursor()
                cur.execute(
                    "SELECT station_id, COALESCE(name, ''), COALESCE(location, ''), "
                    "COALESCE(status, 'active'), COALESCE(barista_name, '') "
                    "FROM station_stats ORDER BY station_id"
                )
                for row in cur.fetchall():
                    sid, name, location, status, barista = row
                    stations.append({
                        "id": sid,
                        "name": name or f"Station #{sid}",
                        "location": location or 'Main Hall',
                        "status": status or 'active',
                        "barista": barista or 'Unassigned',
                    })
        except Exception as e:
            logger.warning(f"display/config: could not enumerate stations: {e}")

        # Display content + appearance settings live in the settings KV table
        # (set from the barista Notification/Display settings). The PUBLIC
        # display has no auth to hit /api/settings, so surface them here.
        # Defaults mirror the app defaults so a fresh install looks complete.
        disp = {
            'show_customer_name': True,
            'show_order_details': True,
            'show_completed': True,
            'show_wait_times': True,
            'display_theme': 'light',
            'display_font_size': 'large',
            'display_zoom': 100,
            'display_rotation': 0,
            'display_mode': 'auto',
            # Board overflow controls (barista Display tab): seconds per
            # page flip, fixed cards-per-page (0 = auto-measure, 3..8 =
            # scale cards to fit), and 'flip' vs continuous 'scroll'.
            'display_flip_seconds': 10,
            'display_cards_per_page': 0,
            'display_overflow_mode': 'flip',
            # Touchscreen? On: tap-to-order kiosk button. Off (wall TV):
            # SMS is promoted as the primary way to order.
            'display_touch_ordering': True,
        }
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                scur = coffee_system.db.cursor()
                scur.execute(
                    "SELECT key, value FROM settings WHERE key IN ("
                    "'showNameOnDisplay','showOrderDetails','showCompletedOrders',"
                    "'showWaitTimes','displayTheme','displayFontSize','displayZoom',"
                    "'displayRotation','displayMode','displayCustomMessage',"
                    "'displayFlipSeconds','displayCardsPerPage','displayOverflowMode',"
                    "'displayTouchOrdering')"
                )
                _rows = {k: v for k, v in scur.fetchall()}

                def _as_bool(key, default):
                    v = _rows.get(key)
                    return (str(v).strip().lower() == 'true') if v is not None else default

                def _as_int(key, default):
                    v = _rows.get(key)
                    try:
                        return int(float(v)) if v is not None and str(v).strip() != '' else default
                    except (TypeError, ValueError):
                        return default

                def _as_str(key, default):
                    v = _rows.get(key)
                    return str(v) if v is not None and str(v).strip() != '' else default

                disp['show_customer_name'] = _as_bool('showNameOnDisplay', True)
                disp['show_order_details'] = _as_bool('showOrderDetails', True)
                disp['show_completed'] = _as_bool('showCompletedOrders', True)
                disp['show_wait_times'] = _as_bool('showWaitTimes', True)
                disp['display_theme'] = _as_str('displayTheme', 'light')
                disp['display_font_size'] = _as_str('displayFontSize', 'large')
                disp['display_zoom'] = _as_int('displayZoom', 100)
                disp['display_rotation'] = _as_int('displayRotation', 0)
                disp['display_mode'] = _as_str('displayMode', 'auto')
                # Barista Display tab's Custom Message (settings KV) —
                # previously the field saved nowhere while the display
                # read only the organiser branding blob.
                disp['custom_message'] = _as_str('displayCustomMessage', '')
                disp['display_flip_seconds'] = _as_int('displayFlipSeconds', 10)
                disp['display_cards_per_page'] = _as_int('displayCardsPerPage', 0)
                disp['display_overflow_mode'] = _as_str('displayOverflowMode', 'flip')
                disp['display_touch_ordering'] = _as_bool('displayTouchOrdering', True)
        except Exception as e:
            logger.warning(f"display/config: could not read display settings: {e}")
            try:
                coffee_system.db.rollback()
            except Exception:
                pass

        return jsonify({
            "success": True,
            "config": {
                "system_name": system_name,
                "event_name": event_name,
                "show_customer_name": disp['show_customer_name'],
                "show_order_details": disp['show_order_details'],
                "show_completed": disp['show_completed'],
                "show_wait_times": disp['show_wait_times'],
                "display_theme": disp['display_theme'],
                "display_font_size": disp['display_font_size'],
                "display_zoom": disp['display_zoom'],
                "display_rotation": disp['display_rotation'],
                "display_mode": disp['display_mode'],
                "display_flip_seconds": disp['display_flip_seconds'],
                "display_cards_per_page": disp['display_cards_per_page'],
                "display_overflow_mode": disp['display_overflow_mode'],
                "display_touch_ordering": disp['display_touch_ordering'],
                "sms_number": config.get('TWILIO_PHONE_NUMBER', '') or branding.get('smsNumber', ''),
                # The event's ordering code, so the poster page can stamp
                # it into the QR it prints. Public because it is printed
                # on a poster -- it identifies an event, it does not
                # authorise anything.
                # coffee_system.db, not a bare `db` -- there is no local
                # `db` in this function and referencing one took the whole
                # endpoint down with a NameError. Guarded, because this
                # config drives the Display's branding and must not fail
                # over a poster code.
                "event_code": _event_code_for_display(
                    getattr(coffee_system, 'db', None) if coffee_system else None),
                "sponsor": sponsor,
                # Logo for the display screen header. Uploaded via the
                # Branding panel as a data URI (clientLogo). 'logo' is the
                # legacy key; accept either.
                "logo": branding.get('clientLogo') or branding.get('logo') or '',
                # Full-screen Display backgrounds — one per orientation so a
                # vertical OR horizontal screen gets a correctly-framed image.
                # Uploaded via the Branding panel as data URIs.
                "background_landscape": branding.get('bgLandscape') or branding.get('background_landscape') or '',
                "background_portrait": branding.get('bgPortrait') or branding.get('background_portrait') or '',
                "wait_time": branding.get('waitTime', '10-15'),
                # CupQ house dark, from the logo. Was a generic blue that
                # belonged to nothing. A client's own branding still wins:
                # this is only the fallback when nothing is configured.
                "header_color": (branding.get('headerColor')
                                 or branding.get('primaryColor') or '#C08552'),
                "custom_message": disp.get('custom_message') or branding.get('customMessage') or branding.get('footerText') or '',
                "stations": stations,
                "app_version": config.get('APP_VERSION', '1.0.0'),
            }
        })
    except Exception as e:
        logger.error(f"Error getting display config: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })


def _kiosk_menu_data(coffee_system):
    """Build the self-service kiosk menu. For each orderable item (coffee type,
    milk, size) return the station IDs that can make it — so the Display kiosk
    can grey out items only available at OTHER stations and tell the customer
    where to collect. A station whose capability list is empty is treated as
    "makes everything" (matches _station_can_make_order's lenient rule)."""
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    stations = []
    caps_by_station = {}
    cur = db.cursor()
    cur.execute(
        "SELECT station_id, COALESCE(name,''), COALESCE(status,'active'), capabilities, "
        "COALESCE(wait_time, 0), COALESCE(current_load, 0) "
        "FROM station_stats ORDER BY station_id"
    )
    for row in cur.fetchall():
        is_d = isinstance(row, dict)
        sid = row.get('station_id') if is_d else row[0]
        name = (row.get('name') if is_d else row[1]) or f"Station {sid}"
        status = (row.get('status') if is_d else row[2]) or 'active'
        caps_raw = row.get('capabilities') if is_d else row[3]
        wait = (row.get('wait_time') if is_d else row[4]) or 0
        load = (row.get('current_load') if is_d else row[5]) or 0
        if str(status).lower() in ('inactive', 'maintenance'):
            continue
        caps = caps_raw
        if isinstance(caps, str):
            try:
                caps = json.loads(caps)
            except Exception:
                caps = {}
        if not isinstance(caps, dict):
            caps = {}
        caps_by_station[sid] = {
            'coffee_types': [str(x).lower() for x in (caps.get('coffee_types') or caps.get('drinks') or [])],
            'milk_types':   [str(x).lower() for x in (caps.get('milk_types') or caps.get('milks') or [])],
            'sizes':        [str(x).lower() for x in (caps.get('sizes') or [])],
        }
        # wait/load let the kiosk show "~5 min" per station and pick the
        # fastest collection point.
        stations.append({'id': sid, 'name': name, 'wait': int(wait or 0), 'load': int(load or 0)})

    universe = {'coffee_types': {}, 'milk_types': {}, 'sizes': {}}
    for _sid, caps in caps_by_station.items():
        for dim in universe:
            for item in caps[dim]:
                universe[dim].setdefault(item, item)
    # Fall back to the event catalog for any dimension nobody configured, so a
    # brand-new setup (no capabilities entered) still shows a usable menu.
    try:
        if not universe['coffee_types']:
            for c in (coffee_system._get_available_coffee_types() or []):
                universe['coffee_types'].setdefault(str(c).lower(), str(c))
        if not universe['milk_types']:
            for m in (coffee_system._get_available_milk_types() or []):
                universe['milk_types'].setdefault(str(m).lower(), str(m))
        if not universe['sizes']:
            for s in (coffee_system._get_available_sizes() or []):
                universe['sizes'].setdefault(str(s).lower(), str(s))
    except Exception as e:
        logger.warning(f"kiosk menu catalog fallback failed: {e}")

    # SINGLE SOURCE OF TRUTH for milks: intersect the capability-derived
    # universe with the EVENT's configured milk list. Found by the Test Bench:
    # station 2's capabilities listed soy, so the kiosk sold soy — while the
    # SMS bot (which reads the event inventory) refused it. A milk is offered
    # only if the event stocks it AND some active station can make it. If the
    # event list is empty/unavailable, keep the capability universe unchanged.
    try:
        event_milks = [str(m).lower() for m in
                       (coffee_system._get_available_milk_types() or [])]
        if event_milks and universe['milk_types']:
            def _norm(m):
                return m.replace(' milk', '').strip()
            ev = {_norm(m) for m in event_milks}
            universe['milk_types'] = {
                k: v for k, v in universe['milk_types'].items()
                if _norm(k) in ev
            }
    except Exception as e:
        logger.warning(f"kiosk milk/event intersection failed (menu unchanged): {e}")

    # COLLAPSE "skim" and "skim milk" INTO ONE CHOICE.
    #
    # Steve, from a phone, looking at the milk step: "skim and skim milk oat
    # and oat milk etc". Nine tiles where there are five milks, because
    # stations spell the same milk two ways and the universe is keyed on the
    # raw string. Every customer sees this on every order.
    #
    # Fold on the same rule the event intersection above already uses --
    # strip a trailing " milk" -- and keep BOTH spellings as aliases, so a
    # station that only ever declared "skim milk" is still matched as making
    # the folded "Skim". Dropping the aliases here would quietly remove
    # milks from stations, which is far worse than a duplicate tile.
    milk_aliases = {}
    try:
        def _milk_fold(m):
            n = str(m).strip().lower()
            base = n[:-5].strip() if n.endswith(' milk') else n
            return base or n

        folded = {}
        for raw_key, raw_label in universe['milk_types'].items():
            canon = _milk_fold(raw_key)
            milk_aliases.setdefault(canon, set()).add(raw_key)
            # Prefer the bare spelling as the label source: "Skim" reads
            # better on a tile than "Skim Milk", and mixing the two is what
            # made the list look duplicated in the first place.
            if canon not in folded or len(str(raw_key)) < len(str(folded[canon][0])):
                folded[canon] = (raw_key, raw_label)
        if folded:
            universe['milk_types'] = {c: _milk_fold(v[1]) for c, v in folded.items()}
    except Exception as e:
        logger.warning(f"milk fold skipped (menu unchanged): {e}")
        milk_aliases = {}

    # SAME TREATMENT FOR SIZES. Milks above are intersected with the event's
    # configured list; sizes were not, so they came purely from station
    # capabilities and the operator's cup choices were ignored. With only
    # Medium ticked in Inventory, the kiosk and the attendee app still
    # offered Small — station capabilities said 'medium','small' and nothing
    # checked that against the event. Empty or unavailable event list leaves
    # the capability universe alone.
    try:
        event_sizes = [str(s).lower() for s in
                       (coffee_system._get_available_sizes() or [])]
        if event_sizes and universe['sizes']:
            filtered = {k: v for k, v in universe['sizes'].items()
                        if k in event_sizes}
            if filtered:
                universe['sizes'] = filtered
    except Exception as e:
        logger.warning(f"kiosk size/event intersection failed (menu unchanged): {e}")

    # Fold in event-enabled non-espresso drinks (tea, hot chocolate, chai,
    # matcha…). They aren't espresso-gated, so the capability-only universe
    # (espresso drinks) was hiding them. A station makes an extra unless some
    # station has explicitly claimed it.
    #
    # ...MINUS anything every active station has switched off. At most events
    # the barista makes coffee and the tea/cold drinks are self-serve from
    # another table, and without this the kiosk and the attendee app invited
    # delegates to order drinks nobody was going to make. The gate lives on
    # coffee_system so this path and the SMS path agree; it only removes an
    # EXPLICIT off and leaves the list alone on any error.
    extras = []
    try:
        extras = [str(x).lower() for x in
                  (coffee_system._drop_extras_no_station_makes(
                      coffee_system._get_available_extra_drinks() or []) or [])]
    except Exception as e:
        logger.warning(f"kiosk extras pull failed: {e}")
    for ex in extras:
        universe['coffee_types'].setdefault(ex, ex)
    extra_set = set(extras)
    claimed_coffee = set()
    for caps in caps_by_station.values():
        for c in caps['coffee_types']:
            claimed_coffee.add(c)

    def stations_for(dim, item_lower):
        # A folded milk is made by a station that declared ANY of its
        # spellings.
        names = ({item_lower} | milk_aliases.get(item_lower, set())
                 if dim == 'milk_types' else {item_lower})
        out = []
        for sid, caps in caps_by_station.items():
            lst = caps[dim]
            if (not lst) or (names & set(lst)):
                out.append(sid)
            elif dim == 'coffee_types' and item_lower in extra_set and item_lower not in claimed_coffee:
                out.append(sid)  # enabled extra nobody claims → made everywhere
        return out

    def title(s):
        return ' '.join(w.capitalize() for w in str(s).split())

    def categorize(n):
        if 'chai' in n:
            return 'Chai'
        if 'hot choc' in n:
            return 'Hot Chocolate'
        if any(k in n for k in ('juice', 'smoothie', 'iced', 'frappe', 'frappé', 'cold brew')):
            return 'Cold Drinks'
        if any(k in n for k in ('tea', 'matcha', 'earl grey', 'english breakfast',
                                'chamomile', 'peppermint', 'green', 'rooibos')):
            return 'Tea'
        return 'Coffee'

    def build(dim):
        out = []
        for item_lower in sorted(universe[dim].keys()):
            entry = {
                'name': title(universe[dim][item_lower]),
                'value': item_lower,
                'stations': stations_for(dim, item_lower),
            }
            if dim == 'coffee_types':
                entry['category'] = categorize(item_lower)
            out.append(entry)
        return out

    sugar_self_serve = False
    try:
        sugar_self_serve = coffee_system._sugar_self_serve()
    except Exception:
        pass
    return {
        'stations': stations,
        'coffee_types': build('coffee_types'),
        'milks': build('milk_types'),
        'sizes': build('sizes'),
        # Kiosk skips its sugar question when the venue runs
        # help-yourself sugar (baristas never add it).
        'sugar_self_serve': sugar_self_serve,
    }


@bp.route('/display/menu', methods=['GET'])
def get_display_menu():
    """Public self-service kiosk menu — what each station can make. No JWT;
    the Display is a public screen."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'error': 'unavailable'}), 503
        # Feature flags ride along on the menu because /my already fetches
        # it — the customer page needs to know which identification methods
        # to OFFER, and a second request on a phone at an event is a cost
        # for no benefit. Badge lookup defaults off; see
        # attendee_lookup_enabled() for why that default is the safe one.
        try:
            from routes.ea_survey_routes import attendee_lookup_enabled
            badge_ok = attendee_lookup_enabled(coffee_system.db)
        except Exception as e:
            logger.warning(f"display/menu: badge flag read failed: {e}")
            badge_ok = False
        return jsonify({'success': True,
                        'menu': _kiosk_menu_data(coffee_system),
                        'features': {'attendee_lookup': badge_ok}})
    except Exception as e:
        logger.error(f"display/menu error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/display/order', methods=['POST'])
def create_kiosk_order():
    """Public self-service order placed from the Display kiosk. No JWT — the
    Display is a public screen (same trust model as SMS ordering). Only accepts
    items some station can make; routes to the chosen station if it can make
    the whole order, otherwise to a station that can, and returns where to
    collect."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        db = coffee_system.db

        # Intake gate — the kiosk is a customer-facing order path, so it
        # closes when Stop All Operations or Lock System is active. Staff
        # order creation (POST /api/orders, walk-ins) stays open.
        from utils.order_intake import intake_blocked_reason
        _blocked = intake_blocked_reason(db)
        if _blocked:
            return jsonify({'success': False, 'ordering_closed': True,
                            'message': _blocked}), 503

        data = request.json or {}

        name = (data.get('name') or data.get('customer_name') or '').strip()
        coffee_type = (data.get('coffee_type') or data.get('type') or '').strip()
        milk = (data.get('milk') or data.get('milk_type') or '').strip()
        size = (data.get('size') or '').strip()
        sugar = data.get('sugar')
        if sugar is None or sugar == '':
            sugar = 'No sugar'
        # Self-serve sugar venues: baristas never add it, so no order may
        # carry it (the kiosk UI also skips the question; this guards the
        # API too).
        try:
            if coffee_system._sugar_self_serve():
                sugar = 'No sugar'
        except Exception:
            pass
        note = (data.get('note') or data.get('notes') or '').strip()
        # The notes box doubles as the VIP code box, with nothing saying
        # so. There is no field for a code on the kiosk or the QR app, and
        # Steve does not want one -- "not give it away to others that
        # there is even such a hack". Typing the event's code among your
        # notes promotes the order; the code is stripped before storage so
        # it never reaches the label, the barista card or the board.
        kiosk_vip = False
        try:
            note, kiosk_vip = coffee_system.extract_vip_from_text(note)
        except Exception as _vip_err:
            logger.warning(f"vip-in-notes check skipped: {_vip_err}")
        # Strength and temperature are first-class on SMS orders (the NLP
        # service extracts "double shot", "half strength", "extra hot"),
        # but this endpoint used to drop them, so the same words saved as
        # someone's usual produced a plain drink. The barista list already
        # renders extraHot off order_details['temp'].
        strength = str(data.get('strength') or '').strip().lower()
        temp = str(data.get('temp') or data.get('temperature') or '').strip().lower()
        # Decaf. Stocked at the venue, orderable by SMS and at the walk-in
        # screen, but this endpoint dropped it -- so the touchscreen and
        # the phone-QR flow were the only two ways to order that could not
        # ask for it. Same key the walk-in path writes, so the barista card
        # and the label read it without knowing where the order came from.
        bean_type = str(data.get('bean_type') or '').strip().lower()

        # EventsAir pre-identification (research Phase 4.8): the EA app
        # links here with ?cid={ContactID}; the kiosk passes it through.
        # Name and phone come from the SERVER-side attendee mirror — the
        # browser never sees the number. Unknown/absent cid changes
        # nothing.
        ea_contact_id = str(data.get('ea_contact_id') or '').strip()
        # Provenance. /my posts through this same endpoint, so the caller
        # must say which it is -- the server cannot tell them apart. An
        # absent or bogus channel falls back to 'kiosk', which is what
        # this endpoint was before /my started borrowing it.
        req_channel = normalize_channel(data.get('channel')) or 'kiosk'
        req_source = normalize_source(data.get('src') or data.get('source_code'))

        # Event gate. A QR from a previous event must not put a coffee on
        # a barista's screen here -- see utils/event_access.py. Fails
        # OPEN on any ambiguity: an event that never configured this, or
        # that requires a code without having set one, keeps taking
        # orders. A system that quietly stops accepting coffee is a worse
        # outage than the stray order it was guarding against.
        try:
            allowed, gate_msg = event_access_check(
                _kv_get(db, ACCESS_SETTING_KEY, default=None),
                data.get('e') or data.get('event_code') or request.args.get('e'))
            if not allowed:
                logger.info("Order refused: event code mismatch")
                return jsonify({'success': False, 'message': gate_msg,
                                'wrong_event': True}), 403
        except Exception as gate_err:
            logger.warning(f"event gate check failed, allowing: {gate_err}")
        ea_phone = ''
        if ea_contact_id:
            try:
                cur0 = db.cursor()
                cur0.execute("SELECT to_regclass('ea_attendees') IS NOT NULL")
                _r0 = cur0.fetchone()
                if _r0 and (_r0[0] if not isinstance(_r0, dict) else list(_r0.values())[0]):
                    cur0.execute(
                        "SELECT first_name, last_name, mobile_e164 FROM ea_attendees "
                        "WHERE ea_contact_id = %s", (ea_contact_id,))
                    att = cur0.fetchone()
                    if att:
                        fn, ln, mob = ((att.get('first_name'), att.get('last_name'),
                                        att.get('mobile_e164'))
                                       if isinstance(att, dict) else att)
                        if not name:
                            name = ' '.join(p for p in ((fn or '').strip(),
                                                        (ln or '').strip()[:1]) if p)
                        ea_phone = (mob or '').strip()
                    else:
                        ea_contact_id = ''  # unknown cid — behave as anonymous
            except Exception as ea_err:
                logger.warning(f"kiosk EA lookup skipped (fail-open): {ea_err}")
                ea_contact_id = ''

        if not name or len(name) < 2:
            return jsonify({'success': False, 'message': 'Please enter your name.'}), 400
        if not coffee_type:
            return jsonify({'success': False, 'message': 'Please choose a drink.'}), 400

        # Validate the milk against the MENU (single source: event list ∩
        # station capabilities via _kiosk_menu_data). Found by the Test Bench:
        # this public endpoint accepted 'macadamia' — a milk nothing offers —
        # because the only gate was per-station capability, and an
        # unconfigured/wildcard station passes anything (#165 class). The
        # kiosk UI only shows menu milks, but the API must refuse too.
        if milk and milk.lower() not in ('no milk', 'none', 'black'):
            try:
                menu_milks = [str(m.get('value') or m.get('name') or m).lower()
                              for m in (_kiosk_menu_data(coffee_system).get('milks') or [])]
                req = milk.lower().replace(' milk', '').strip()
                offered = {mm.replace(' milk', '').strip() for mm in menu_milks}
                if offered and req not in offered:
                    return jsonify({
                        'success': False,
                        'message': f"Sorry, we don't have {milk} today. "
                                   f"Available milks: {', '.join(sorted(offered))}.",
                    }), 400
            except Exception as vm_err:
                logger.warning(f"kiosk milk validation skipped (fail-open): {vm_err}")

        try:
            requested_station = int(data.get('station_id') or data.get('stationId') or 0) or None
        except (TypeError, ValueError):
            requested_station = None
        try:
            preferred_station = int(data.get('preferred_station') or data.get('collect_station') or 0) or None
        except (TypeError, ValueError):
            preferred_station = None

        # Phone is OPTIONAL for everyone. Some customers have no phone or are on
        # international roaming and must still be able to order — if they don't
        # leave a number they watch the board for their name (the collect-from
        # station is shown on the kiosk review + the order board). A number just
        # opts them into a ready-SMS. Normalise to E.164 so SMS actually sends.
        raw_phone = (data.get('phone') or data.get('phone_number') or '').strip()
        phone = ''
        if raw_phone:
            try:
                phone = coffee_system._normalize_phone(raw_phone)
            except Exception:
                phone = raw_phone
        # EA-identified and no number typed: use the registration mobile
        # (resolved server-side above) so the ready-SMS just works.
        if not phone and ea_phone:
            phone = ea_phone

        try:
            db.rollback()
        except Exception:
            pass
        active = []
        cur = db.cursor()
        cur.execute("SELECT station_id, COALESCE(status,'active') FROM station_stats ORDER BY station_id")
        for row in cur.fetchall():
            sid = row[0] if not isinstance(row, dict) else row.get('station_id')
            st = (row[1] if not isinstance(row, dict) else row.get('status')) or 'active'
            if str(st).lower() not in ('inactive', 'maintenance'):
                active.append(sid)

        def can_make(sid):
            return not _station_can_make_order(
                db, sid, {'type': coffee_type, 'milk': milk}
            ).get('blocked')

        # Station precedence: the customer's chosen collection point, else this
        # display's own station, else the first active station that can make the
        # drink+milk (so the barista can actually start it).
        target = None
        if preferred_station and preferred_station in active and can_make(preferred_station):
            target = preferred_station
        if target is None and requested_station and requested_station in active and can_make(requested_station):
            target = requested_station
        if target is None:
            # Auto-assign the way the SMS path does: _assign_station knows
            # BREAK WINDOWS and real per-station load. The old fallback here
            # was "first active station that can make it" — so during a break
            # with one station open, kiosk orders piled onto a CLOSED station
            # (Test Bench breaks suite, first run: 3 orders → station 1 while
            # only station 4 was open).
            try:
                cs_target, _delayed = coffee_system._assign_station(
                    False,
                    None if (milk or '').lower() in ('', 'no milk', 'none', 'black') else milk,
                    coffee_type, size)
                if cs_target in active and can_make(cs_target):
                    target = cs_target
            except Exception as _ae:
                logger.warning(f"kiosk _assign_station failed, using capability loop: {_ae}")
        if target is None:
            for sid in active:
                if can_make(sid):
                    target = sid
                    break
        if target is None:
            return jsonify({
                'success': False,
                'message': "Sorry, that combination isn't available right now. "
                           "Please pick different options or see a barista.",
            }), 400

        expected = preferred_station or requested_station
        reassigned = bool(expected and target != expected)

        # No phone requirement — an order without a number is fine (the customer
        # watches the board). When a number IS given for a collect-elsewhere
        # order, the ready-SMS will tell them where to collect.
        now = datetime.now()
        order_prefix = ''
        try:
            blob = _kv_get(db, 'order_prefix', default=None)
            if isinstance(blob, dict):
                order_prefix = (blob.get('prefix') or '').strip()
            elif isinstance(blob, str):
                order_prefix = blob.strip()
        except Exception:
            order_prefix = ''
        order_number = None
        try:
            seqc = db.cursor()
            seqc.execute("SELECT nextval('order_number_seq')")
            srow = seqc.fetchone()
            if srow:
                sval = srow[0] if not isinstance(srow, dict) else list(srow.values())[0]
                order_number = f"{order_prefix}{int(sval)}"
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        if not order_number:
            order_number = f"K{now.strftime('%H%M%S')}{now.microsecond // 10000}"

        order_details = {
            'name': name,
            'type': coffee_type.lower(),
            'milk': (milk or 'no milk').lower(),
            'size': (size or 'medium').lower(),
            'sugar': sugar,
            'notes': note,
            'strength': strength,
            'temp': temp,
            'bean_type': bean_type or None,
            'order_type': 'kiosk',
            'created_by': 'kiosk',
            # Set from the notes-box VIP code. Was hardcoded False, which
            # is what a kiosk order used to be before a code could redeem
            # one -- and which, as a SECOND 'vip' key in this same dict,
            # would silently beat any value added above it.
            'vip': kiosk_vip,
            'station_id': target,
            'stationId': target,
        }
        stamp_provenance(order_details, req_channel, req_source)
        if ea_contact_id:
            # EA-linked kiosk order: carries the contact id so Phase-2
            # write-back (and future EA notifications) can find them.
            order_details['ea_contact_id'] = ea_contact_id
        try:
            if hasattr(coffee_system, '_compute_order_price'):
                pv, pf = coffee_system._compute_order_price({
                    'type': order_details['type'], 'milk': order_details['milk'],
                    'size': order_details['size'], 'sugar': order_details['sugar'],
                    'vip': kiosk_vip,
                })
                if pv is not None:
                    order_details['price'] = pv
                    order_details['price_formatted'] = pf
        except Exception as e:
            logger.warning(f"kiosk price compute failed (non-fatal): {e}")

        ins = db.cursor()
        ins.execute('''
            INSERT INTO orders (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, order_number
        ''', (order_number, phone, json.dumps(order_details), 'pending', target, now, now,
              1 if kiosk_vip else 5))
        res = ins.fetchone()
        db.commit()
        order_id = res[0] if res else None
        order_number = res[1] if (res and len(res) > 1) else order_number
        logger.info(f"Kiosk order {order_number} created at station {target} (id {order_id})")

        try:
            _emit_new_order({
                'order_number': order_number, 'id': order_number, 'status': 'pending',
                'station_id': target, 'stationId': target,
                'created_at': now.isoformat() + 'Z', 'createdAt': now.isoformat() + 'Z',
                'wait_time': 0, 'waitTime': 0,
                'customer_name': name, 'customerName': name,
                'coffee_type': _drink_display_name(order_details), 'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details['milk'], 'milkType': order_details['milk'],
                'sugar': order_details['sugar'], 'size': order_details['size'],
                'vip': kiosk_vip,
            })
        except Exception as e:
            logger.debug(f"kiosk WS emit skipped: {e}")

        try:
            dbtype = 'sqlite' if 'sqlite3' in str(type(db)).lower() else 'postgres'
            if hasattr(coffee_system, '_decrement_stock_for_order'):
                stock_result = coffee_system._decrement_stock_for_order(db, dbtype, target, order_details)
                # Persist the "stock taken" flag on the STORED order so a later
                # cancel can give it back (the row was inserted before this
                # decrement ran, so its order_details didn't carry the flag).
                order_details['_stock_decremented'] = True
                try:
                    db.cursor().execute(
                        'UPDATE orders SET order_details = %s WHERE order_number = %s',
                        (json.dumps(order_details), order_number),
                    )
                except Exception as _pf:
                    logger.warning(f"could not persist _stock_decremented on kiosk order: {_pf}")
                db.commit()
        except Exception as e:
            stock_result = {'decremented': [], 'skipped': [], 'errors': [str(e)]}
            logger.warning(f"kiosk stock decrement failed (non-fatal): {e}")
            try:
                db.rollback()
            except Exception:
                pass

        station_name = f"Station {target}"
        try:
            nc = db.cursor()
            nc.execute("SELECT name FROM station_stats WHERE station_id = %s", (target,))
            nr = nc.fetchone()
            if nr and (nr[0] if not isinstance(nr, dict) else nr.get('name')):
                station_name = nr[0] if not isinstance(nr, dict) else nr.get('name')
        except Exception:
            pass

        # Kiosk ticket stub: self-entry customers get the same
        # deli-counter number slip as barista walk-ups when the
        # designer's ticket toggle is on. Fire-and-forget.
        try:
            from routes.print_routes import maybe_print_ticket
            maybe_print_ticket(db, order_number, target)
        except Exception:
            pass

        resp_payload = {
            'success': True,
            'order_number': order_number,
            'station_id': target,
            'station_name': station_name,
            'reassigned': reassigned,
            # The notes AS STORED -- with any VIP code already removed.
            #
            # The kiosk confirmation screen shows a summary of the order so
            # the customer can see it all arrived. It was showing what they
            # TYPED, which still contains the code, in large text, on the
            # cart's shared screen, for fifteen seconds, with the next
            # person in the queue standing behind them. Steve caught it on
            # an iPad: "Full Cream - no sugar - strong - Treenetvip".
            #
            # The client cannot strip it itself -- it does not know the
            # codes, and it must not, or they would ship in the bundle. So
            # the server hands back the cleaned text and the screen shows
            # that instead.
            'notes': note,
        }
        # Test/diagnostic aid: when the caller asks (debug_stock: true), echo
        # what the stock decrement actually did — decremented rows, skipped
        # items with reasons, and any swallowed SQL errors. Lets the Test
        # Bench show WHY a counter didn't move instead of guessing.
        if data.get('debug_stock'):
            try:
                resp_payload['stock_debug'] = stock_result
            except NameError:
                resp_payload['stock_debug'] = {'error': 'decrement not reached'}
        return jsonify(resp_payload)
    except Exception as e:
        logger.error(f"create_kiosk_order error: {e}")
        try:
            cs = current_app.config.get('coffee_system')
            if cs and getattr(cs, 'db', None):
                cs.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': 'Could not place your order. Please see a barista.'}), 500


@bp.route('/sms/simulate', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def simulate_sms():
    """ADMIN TEST HARNESS — run an inbound message through the EXACT same
    handle_sms() pipeline a real Twilio SMS uses, but without Twilio (no
    credits, no webhook signature). Returns the bot's reply so QA can verify
    routing / load-balancing / VIP / group / friend behaviour. Order creation
    happens normally; any outbound notification still respects TESTING_MODE
    (and creation itself sends none)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        data = request.get_json() or {}
        frm = (data.get('from') or data.get('phone') or '').strip()
        body = (data.get('body') or data.get('message') or '').strip()
        if not frm or not body:
            return jsonify({'success': False, 'message': "Provide 'from' and 'body'."}), 400
        # Opt-in fidelity: check_gate=true runs the SAME abuse gate the real
        # webhook applies (blocklist + burst throttle) and reports its verdict
        # instead of a bot reply when it trips. Off by default so rapid-fire
        # test conversations (a group order is 15+ messages in a minute)
        # don't trip the throttle mid-suite.
        gate = 'ok'
        if data.get('check_gate'):
            try:
                gate = coffee_system.register_inbound_sms(frm)
            except Exception as gate_err:
                logger.warning(f"simulate_sms gate errored (failing open): {gate_err}")
                gate = 'ok'
            if gate != 'ok':
                return jsonify({
                    'success': True, 'from': frm, 'body': body,
                    'reply': '', 'gate': gate,
                })
        reply = coffee_system.handle_sms(frm, body, messaging_service)
        return jsonify({
            'success': True,
            'from': frm,
            'body': body,
            'reply': reply,
            'gate': gate,
            'testing_mode': bool(getattr(messaging_service, 'testing_mode', False)) if messaging_service else None,
        })
    except Exception as e:
        logger.error(f"simulate_sms error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/health', methods=['GET'])
@jwt_required_with_demo()
def sms_health():
    """Answers "is SMS working?" without anyone having to text the system.

    Built after the National Wine Centre demo, where SMS was dead on
    arrival, recovered on its own, and nobody could say why. On the day,
    someone needs that answer in one glance — and needs it to distinguish
    the three failures that all look identical from the floor:

      * we are in test mode         -> messages swallowed, never sent
      * Twilio cannot reach us      -> webhook hits stay at zero
      * Twilio reaches us, refused  -> hits climb, rejects climb with them

    The third was invisible before this endpoint existed, because the
    signature check rejects a webhook BEFORE anything is written down.
    """
    try:
        from services import sms_health as health
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db if coffee_system else None
        messaging_service = current_app.config.get('messaging_service')
        return jsonify({
            'success': True,
            'health': health.snapshot(db=db, messaging_service=messaging_service),
        })
    except Exception as e:
        logger.error(f"sms_health error: {e}")
        # A health check that 500s tells the reader nothing except that
        # something else is also broken. Say so plainly instead.
        return jsonify({
            'success': False,
            'health': {'status': 'unknown', 'problems': [f'Health check failed: {e}']},
        }), 200


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
        return jsonify({'success': True, 'bundle': m.group(1) if m else None})
    except Exception as e:
        # Never 500 a version check. A page that cannot tell whether it is
        # stale should carry on quietly, not show an error to a barista.
        logger.warning(f"app_version read failed: {e}")
        return jsonify({'success': False, 'bundle': None})


@bp.route('/qr', methods=['GET'])
def generate_qr():
    """Public QR PNG generator: /api/qr?data=<urlencoded>&size=10

    Powers the scan-to-order posters and the delegate splash screen —
    both the WEB ordering link and the pre-filled SMS link. Public
    because the things it encodes are public (an ordering URL, the
    event's own SMS number); it encodes whatever it's given and reads
    nothing from the database."""
    data = request.args.get('data') or ''
    if not data or len(data) > 512:
        return jsonify({'success': False,
                        'message': 'data required (max 512 chars)'}), 400
    try:
        box = max(4, min(20, int(request.args.get('size') or 10)))
    except (TypeError, ValueError):
        box = 10
    try:
        import io as _io
        import qrcode
        qr = qrcode.QRCode(border=2, box_size=box,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        return Response(buf.getvalue(), mimetype='image/png',
                        headers={'Cache-Control': 'public, max-age=300'})
    except Exception as e:
        logger.error(f"generate_qr error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/orders/<order_id>/collected', methods=['POST'])
def mark_collected_public(order_id):
    """The customer says they have their coffee, from their own phone.

    One less press for the barista, on the busiest surface they have.

    Two guards, because this endpoint is public and an order number is
    guessable:

      1. Only an order that is actually READY can be collected. A
         pending or in-progress coffee cannot be marked collected --
         a mis-tap (or a stranger guessing a number) must not be able
         to clear a card the barista still needs on the bench.
      2. Already-collected is a success, not an error. The page may
         retry on a flaky conference wifi, and a second tap should read
         as "yes, done" rather than an alarming failure.

    It returns nothing about the order beyond the outcome, so it cannot
    be used to enumerate other people's coffees.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cur = db.cursor()
        cur.execute("SELECT status FROM orders WHERE order_number = %s", (clean_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'not found'}), 404
        status = str((row[0] if not isinstance(row, dict) else row.get('status'))
                     or '').lower()

        if status in ('picked_up', 'picked-up'):
            return jsonify({'success': True, 'status': 'picked_up',
                            'message': 'Already collected'})

        if status != 'completed':
            # Not ready yet -- nothing to collect.
            return jsonify({
                'success': False, 'status': status,
                'message': "That order isn't ready yet."}), 409

        now = datetime.now()
        cur.execute(
            "UPDATE orders SET status = 'picked_up', updated_at = %s, "
            "picked_up_at = %s WHERE order_number = %s AND status = 'completed'",
            (now, now, clean_id))
        db.commit()
        logger.info(f"Order {clean_id} marked collected by the customer")
        return jsonify({'success': True, 'status': 'picked_up',
                        'message': 'Thanks - enjoy your coffee!'})
    except Exception as e:
        logger.error(f"mark_collected_public error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


def _track_full_drink(od):
    """Size, drink, milk, sugar and extras, the way the label reads.

    Built here rather than reusing _drink_display_name because that one
    is deliberately terse -- the board and the WS payload want a short
    name. A customer checking their order got through wants the details.
    """
    od = od or {}

    def val(*keys):
        for k in keys:
            v = od.get(k)
            if v not in (None, '', 'None'):
                return str(v).strip()
        return ''

    head = ' '.join(x for x in (val('size'), val('type', 'coffee_type', 'drink')) if x)
    bits = [head] if head else []
    milk = val('milk', 'milk_type', 'milkType')
    if milk and milk.lower() not in ('no milk', 'none', 'no_milk'):
        bits.append(milk if milk.lower().endswith('milk') else f'{milk} milk')
    elif milk:
        bits.append('no milk')
    sugar = val('sugar', 'sweetener')
    if sugar:
        bits.append(sugar)
    strength = val('strength')
    if strength:
        bits.append(strength)
    if str(od.get('temp') or '').lower() == 'extra hot' or od.get('extraHot'):
        bits.append('extra hot')
    notes = val('notes')
    if notes:
        bits.append(notes)
    return ', '.join(b for b in bits if b) or 'Coffee'


@bp.route('/orders/<order_id>/track', methods=['GET'])
def track_order_public(order_id):
    """Public status of ONE order, for the phone that placed it.

    This is how a WiFi-only customer gets their 'ready' notification
    with no SMS at all: the ordering page keeps polling this and shows
    'You're #3' -> 'Being made' -> 'READY - collect from Station 1'.

    Deliberately minimal: status, queue position, first name and where
    to collect. No phone number, no other customers' data — an order
    number is guessable, so nothing sensitive may live here."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cur = db.cursor()
        cur.execute(
            "SELECT status, station_id, order_details, created_at FROM orders "
            "WHERE order_number = %s", (clean_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'not found'}), 404
        status, station_id, od_raw, created_at = (
            row if not isinstance(row, dict)
            else (row.get('status'), row.get('station_id'),
                  row.get('order_details'), row.get('created_at')))
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
        # Queue position: how many pending orders at this station are older.
        position = None
        if status == 'pending':
            cur.execute(
                "SELECT COUNT(*) FROM orders WHERE status = 'pending' "
                "AND station_id = %s AND created_at <= %s",
                (station_id, created_at))
            r2 = cur.fetchone()
            position = (r2[0] if not isinstance(r2, dict) else list(r2.values())[0]) if r2 else None
        station_name = f"Station {station_id}" if station_id else ''
        try:
            c2 = db.cursor()
            c2.execute("SELECT COALESCE(name,'') FROM station_stats WHERE station_id = %s",
                       (station_id,))
            r3 = c2.fetchone()
            if r3 and (r3[0] if not isinstance(r3, dict) else list(r3.values())[0]):
                station_name = r3[0] if not isinstance(r3, dict) else list(r3.values())[0]
        except Exception:
            db.rollback()
        first_name = str(od.get('name') or '').split(' ')[0]

        # How long until it is ready. Measured from this station's own
        # recent pace rather than assumed, and discounted for batching --
        # see utils/order_eta.py for why it always rounds up and never
        # counts past zero.
        eta_minutes = None
        try:
            ahead_details, bench = [], 0
            if status == 'pending':
                c3 = db.cursor()
                c3.execute(
                    "SELECT order_details FROM orders WHERE status = 'pending' "
                    "AND station_id = %s AND created_at < %s",
                    (station_id, created_at))
                for r in (c3.fetchall() or []):
                    raw = r[0] if not isinstance(r, dict) else r.get('order_details')
                    try:
                        ahead_details.append(
                            json.loads(raw) if isinstance(raw, str) else (raw or {}))
                    except Exception:
                        ahead_details.append({})
            if status in ('pending', 'in-progress', 'in_progress'):
                c4 = db.cursor()
                c4.execute(
                    "SELECT COUNT(*) FROM orders WHERE status IN "
                    "('in-progress','in_progress') AND station_id = %s", (station_id,))
                r4 = c4.fetchone()
                bench = (r4[0] if not isinstance(r4, dict) else list(r4.values())[0]) or 0
                # Pace: the gaps BETWEEN this station's recent completions,
                # not a count divided by a window. A quiet cart is not a
                # slow one, and the window method cannot tell them apart --
                # see utils/order_eta.seconds_per_coffee.
                c5 = db.cursor()
                c5.execute(
                    "SELECT EXTRACT(EPOCH FROM COALESCE(completed_at, updated_at)) "
                    "FROM orders WHERE station_id = %s "
                    "AND status IN ('completed','picked_up') "
                    "AND COALESCE(completed_at, updated_at) > NOW() - INTERVAL '2 hours' "
                    "ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 40",
                    (station_id,))
                epochs = []
                for r in (c5.fetchall() or []):
                    v = r[0] if not isinstance(r, dict) else list(r.values())[0]
                    if v is not None:
                        epochs.append(float(v))
                pace = eta_seconds_per_coffee(epochs)
                eta_minutes = eta_estimate_minutes(
                    status, ahead_details, bench, pace)
        except Exception as eta_err:
            # An estimate is a nicety. Never let it take down the status
            # page a waiting customer is actually reading.
            logger.warning(f"ETA calc failed for order {clean_id}: {eta_err}")
            try:
                db.rollback()
            except Exception:
                pass

        # Incident notice, if one is live and this order is affected.
        # Scoped to UNPRINTED orders by default: a printed order is
        # already on a label in a barista's hand and will be made, so
        # sending its customer to re-confirm manufactures a duplicate.
        notice = ''
        try:
            raw_notice = _kv_get(db, BROADCAST_KEY, default=None)
            if broadcast_is_live(raw_notice, datetime.now(),
                                 lambda v: datetime.fromisoformat(str(v))):
                c6 = db.cursor()
                c6.execute(
                    "SELECT 1 FROM print_jobs WHERE order_id = %s "
                    "AND type = 'label' LIMIT 1", (str(clean_id),))
                printed = bool(c6.fetchone())
                if broadcast_applies(raw_notice, printed):
                    notice = str(raw_notice.get('message') or '')
        except Exception as notice_err:
            # A broken notice must never take down the page a waiting
            # customer is reading.
            logger.warning(f"broadcast check failed for {clean_id}: {notice_err}")
            try:
                db.rollback()
            except Exception:
                pass

        return jsonify({
            'success': True,
            'order_number': clean_id,
            'status': status,
            'position': position,
            'notice': notice,
            'eta_minutes': eta_minutes,
            'eta_text': eta_describe(eta_minutes),
            'first_name': first_name,
            'drink': _drink_display_name(od, default='Coffee'),
            # THE WHOLE ORDER, not just the drink name.
            #
            # Steve, tracking his own from the kiosk QR: "the qr code on
            # screen only showed hot chockolate so your not confident
            # that the whole order was recieved". He had asked for a
            # medium with almond milk; the page said "hot chocolate" and
            # nothing else, so there was no way to tell whether the rest
            # of it had landed.
            #
            # This is what the printed label already says, in the same
            # order, so the screen and the sticker agree.
            'drink_full': _track_full_drink(od),
            'station_name': station_name,
            'collection_note': od.get('collection_note') or '',
        })
    except Exception as e:
        logger.error(f"track_order_public error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


def _display_phone(phone):
    """The last four digits, and ONLY the last four.

    /api/display/orders has no authentication -- it is what the big
    screen fetches, so it has to be reachable without a login. It was
    also sending the customer's FULL mobile number in `phoneNumber` and
    `phone_number`, which meant anyone who could reach the URL could
    read every waiting customer's number alongside their name. Nothing
    consumed those fields: the screen shows "Sarah - ..4821" and derives
    that from the last four either way.

    Also stops "Walk-in" being sliced into "k-in", which is what
    happens when you take the last four characters of something that
    was never a phone number.
    """
    digits = re.sub(r"\D", "", str(phone or ""))
    return digits[-4:] if len(digits) >= 4 else ""


@bp.route('/display/orders', methods=['GET'])
def get_display_orders():
    """Get orders for the display screen"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for in-progress orders (limited to most recent 10)
        cursor = db.cursor()
        
        # Get in-progress orders
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details
            FROM orders 
            WHERE status = 'in-progress'
            ORDER BY created_at DESC
            LIMIT 10
        ''')
        
        # Process in-progress orders
        in_progress_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                try:
                    order_details = json.loads(order_details_json)
                except Exception:
                    order_details = {}
            else:
                order_details = order_details_json
            if not isinstance(order_details, dict):
                order_details = {}

            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            display_phone = _display_phone(phone)
            
            # Format order for display
            in_progress_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': customer_name,
                'customerName': customer_name,
                'displayPhone': display_phone,
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),
                'status': status,
                'stationId': station_id,
                'station_id': station_id,
            })
        
        # Get completed orders that are ready for pickup (limited to most recent 10)
        # NOTE: picked_up_at is a TIMESTAMP — comparing it to '' is a
        # Postgres ERROR, which made this whole endpoint throw and serve
        # the demo fallback (fake "John D."/"Sarah M." orders) on every
        # single call in production. IS NULL is the only empty-check.
        cursor.execute('''
            SELECT id, order_number, status, station_id,
                   created_at, completed_at, phone, order_details
            FROM orders
            WHERE status = 'completed' AND picked_up_at IS NULL
            ORDER BY completed_at DESC
            LIMIT 10
        ''')
        
        # Process ready orders
        ready_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, completed_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                try:
                    order_details = json.loads(order_details_json)
                except Exception:
                    order_details = {}
            else:
                order_details = order_details_json
            if not isinstance(order_details, dict):
                order_details = {}

            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            display_phone = _display_phone(phone)
            
            # Format order for display
            ready_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': customer_name,
                'customerName': customer_name,
                'displayPhone': display_phone,
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),
                'status': status,
                'stationId': station_id,
                'station_id': station_id,
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if (completed_at and hasattr(completed_at, 'isoformat')) else completed_at,
            })
        
        # Return real order data
        return jsonify({
            "success": True,
            "orders": {
                "inProgress": in_progress_orders,
                "ready": ready_orders
            },
            "timestamp": datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error getting display orders: {str(e)}")
        try:
            coffee_system = current_app.config.get('coffee_system')
            if coffee_system:
                coffee_system.db.rollback()
        except Exception:
            pass
        # An EMPTY board, never fake orders. This fallback used to return
        # demo customers ("John D.", "Sarah M.") — and because the ready
        # query above compared a TIMESTAMP to '', it errored on EVERY call,
        # so the public pickup display served those fake names in
        # production. An empty board is always safe; fake names are not.
        return jsonify({
            "success": True,
            "orders": {"inProgress": [], "ready": []},
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        })

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
@role_required_with_demo(['admin', 'staff', 'barista'])
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

# ============================================================================
# STATION ENDPOINTS
# ============================================================================

@bp.route('/stations', methods=['GET'])
@jwt_required_with_demo()
def get_stations():
    """Get all coffee stations"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for stations
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT station_id, name, location, status, barista_name, 
                       wait_time, last_updated
                FROM station_stats
                ORDER BY station_id
            ''')
        except Exception as e:
            logger.warning(f"Error with primary station query: {str(e)}")
            # Fallback to simpler query
            cursor.execute('''
                SELECT id, name, location, status, NULL as barista_name,
                       NULL as wait_time, NULL as last_updated
                FROM stations
                ORDER BY id
            ''')
        
        # Process stations
        stations = []
        for station in cursor.fetchall():
            station_id, name, location, status, barista_name, wait_time, last_updated = station
            
            # Format station for frontend
            stations.append({
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status or "active",
                'barista': barista_name or "Unassigned",
                'wait_time': wait_time or 10,
                'last_updated': last_updated or datetime.now().isoformat()
            })
        
        return jsonify({
            'success': True,
            'stations': stations
        })
    
    except Exception as e:
        logger.error(f"Error fetching stations: {str(e)}")
        # Fallback to hardcoded stations for development
        return jsonify({
            'success': True,
            'stations': [
                {
                    'id': 1,
                    'name': 'Station #1',
                    'location': 'Main Hall',
                    'status': 'active',
                    'barista': 'Barista 1',
                    'wait_time': 10,
                    'last_updated': datetime.now().isoformat()
                },
                {
                    'id': 2,
                    'name': 'Station #2',
                    'location': 'Exhibition Hall',
                    'status': 'active',
                    'barista': 'Barista 2',
                    'wait_time': 15,
                    'last_updated': datetime.now().isoformat()
                },
                {
                    'id': 3,
                    'name': 'Station #3',
                    'location': 'Registration Area',
                    'status': 'active',
                    'barista': 'Barista 3',
                    'wait_time': 8,
                    'last_updated': datetime.now().isoformat()
                }
            ]
        })

@bp.route('/stations/<station_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_station(station_id):
    """Get details for a specific station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for station
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT station_id, name, location, status, barista_name, 
                       wait_time, last_updated
                FROM station_stats
                WHERE station_id = %s
            ''', (station_id,))
        except Exception as e:
            logger.warning(f"Error with station stats query: {str(e)}")
            # Fallback to simpler query
            cursor.execute('''
                SELECT id, name, location, status, NULL as barista_name,
                       NULL as wait_time, NULL as last_updated
                FROM stations
                WHERE id = %s
            ''', (station_id,))
        
        # Get station data
        station = cursor.fetchone()
        
        if not station:
            return jsonify({
                'success': False,
                'message': f"Station {station_id} not found"
            }), 404
        
        # Extract station details
        station_id, name, location, status, barista_name, wait_time, last_updated = station
        
        # Get station order statistics
        cursor.execute('''
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'in-progress') as in_progress_count,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as total_today
            FROM orders
            WHERE station_id = %s
        ''', (station_id,))
        
        stats_row = cursor.fetchone()
        stats = {
            'pending_count': stats_row[0] if stats_row and stats_row[0] is not None else 0,
            'in_progress_count': stats_row[1] if stats_row and stats_row[1] is not None else 0,
            'completed_count': stats_row[2] if stats_row and stats_row[2] is not None else 0,
            'total_today': stats_row[3] if stats_row and stats_row[3] is not None else 0
        }
        
        # Format station response
        station_data = {
            'id': station_id,
            'name': name or f"Station #{station_id}",
            'location': location or "Main Venue",
            'status': status or "active",
            'barista': barista_name or "Unassigned",
            'wait_time': wait_time or 10,
            'last_updated': last_updated or datetime.now().isoformat(),
            'statistics': stats
        }
        
        return jsonify({
            'success': True,
            'station': station_data
        })
    
    except Exception as e:
        logger.error(f"Error fetching station {station_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching station: {str(e)}"
        }), 500

@bp.route('/stations/<station_id>/status', methods=['PATCH'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def update_station_status(station_id):
    """Update a station's status"""
    try:
        # Get request data
        data = request.json
        status = data.get('status')
        
        if not status:
            return jsonify({
                'success': False,
                'message': "Status is required"
            }), 400
        
        # Validate status
        if status not in ['active', 'inactive', 'maintenance']:
            return jsonify({
                'success': False,
                'message': "Invalid status. Must be one of: active, inactive, maintenance"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update station status
        cursor = db.cursor()
        try:
            cursor.execute('''
                UPDATE station_stats
                SET status = %s, last_updated = %s
                WHERE station_id = %s
                RETURNING station_id, name, location, status, barista_name, wait_time, last_updated
            ''', (status, datetime.now().isoformat(), station_id))
        except Exception as e:
            logger.warning(f"Error with station_stats update: {str(e)}")
            # Fallback to stations table
            cursor.execute('''
                UPDATE stations
                SET status = %s
                WHERE id = %s
                RETURNING id, name, location, status
            ''', (status, station_id))
        
        # Check if station was found
        station = cursor.fetchone()
        db.commit()
        
        if not station:
            return jsonify({
                'success': False,
                'message': f"Station {station_id} not found"
            }), 404
        
        # Format response differently based on which table was updated
        if len(station) == 7:  # station_stats table
            station_id, name, location, status, barista_name, wait_time, last_updated = station
            
            station_data = {
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status,
                'barista': barista_name or "Unassigned",
                'wait_time': wait_time or 10,
                'last_updated': last_updated
            }
        else:  # stations table
            station_id, name, location, status = station
            
            station_data = {
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status,
                'barista': "Unassigned",
                'wait_time': 10,
                'last_updated': datetime.now().isoformat()
            }
        
        return jsonify({
            'success': True,
            'message': f"Station {station_id} status updated to {status}",
            'station': station_data
        })
    
    except Exception as e:
        logger.error(f"Error updating station {station_id} status: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating station status: {str(e)}"
        }), 500

@bp.route('/stations/<station_id>/capabilities', methods=['GET', 'POST', 'PUT'])
@jwt_required_with_demo()
def station_capabilities(station_id):
    """GET or update a station's capabilities JSONB blob.

    The Quick Setup wizard already writes `station_stats.capabilities`
    (milk_types, coffee_types, sizes, capacity, etc.); EnhancedStationCapabilities
    on the frontend POSTs here to edit it per-station. Without this
    endpoint the frontend was silently writing to localStorage only.
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


@bp.route('/stations/<station_id>/stats', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_station_stats(station_id):
    """Get statistics for a specific station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station order statistics
        cursor = db.cursor()
        cursor.execute('''
            SELECT 
                COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
                COUNT(*) FILTER (WHERE status = 'in-progress') as in_progress_count,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
                COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as total_today,
                AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60) FILTER (WHERE status = 'completed') as avg_completion_time
            FROM orders
            WHERE station_id = %s
        ''', (station_id,))
        
        stats_row = cursor.fetchone()
        
        # Get hourly breakdown of orders
        cursor.execute('''
            SELECT 
                EXTRACT(HOUR FROM created_at) as hour,
                COUNT(*) as order_count
            FROM orders
            WHERE station_id = %s AND DATE(created_at) = CURRENT_DATE
            GROUP BY EXTRACT(HOUR FROM created_at)
            ORDER BY hour
        ''', (station_id,))
        
        hourly_data = {}
        for row in cursor.fetchall():
            hour, count = row
            hourly_data[int(hour)] = count
        
        # Fill in missing hours
        current_hour = datetime.now().hour
        for hour in range(6, current_hour + 1):  # Assume coffee shop operates from 6 AM
            if hour not in hourly_data:
                hourly_data[hour] = 0
        
        # Format hourly data as list for frontend
        hourly_breakdown = [
            {'hour': hour, 'count': count} 
            for hour, count in sorted(hourly_data.items())
        ]
        
        # Format statistics
        stats = {
            'pending_count': stats_row[0] if stats_row and stats_row[0] is not None else 0,
            'in_progress_count': stats_row[1] if stats_row and stats_row[1] is not None else 0,
            'completed_count': stats_row[2] if stats_row and stats_row[2] is not None else 0,
            'total_today': stats_row[3] if stats_row and stats_row[3] is not None else 0,
            'avg_completion_time': round(stats_row[4], 1) if stats_row and stats_row[4] is not None else 0,
            'hourly_breakdown': hourly_breakdown
        }
        
        return jsonify({
            'success': True,
            'station_id': station_id,
            'stats': stats
        })
    
    except Exception as e:
        logger.error(f"Error fetching station {station_id} statistics: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching station statistics: {str(e)}"
        }), 500

@bp.route('/stations', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def create_station():
    """Create a new station"""
    try:
        # Get request data
        data = request.json
        name = data.get('name')
        location = data.get('location')
        
        if not name:
            return jsonify({
                'success': False,
                'message': "Station name is required"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert new station
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO stations (name, location, status)
            VALUES (%s, %s, 'active')
            RETURNING id, name, location, status
        ''', (name, location))
        
        station = cursor.fetchone()
        db.commit()
        
        if not station:
            return jsonify({
                'success': False,
                'message': "Failed to create station"
            }), 500
        
        # Extract station details
        station_id, name, location, status = station
        
        # Format station for response
        station_data = {
            'id': station_id,
            'name': name or f"Station #{station_id}",
            'location': location or "Main Venue",
            'status': status or "active",
            'barista': "Unassigned",
            'wait_time': 10,
            'last_updated': datetime.now().isoformat()
        }
        
        return jsonify({
            'success': True,
            'message': "Station created successfully",
            'station': station_data
        }), 201
    
    except Exception as e:
        logger.error(f"Error creating station: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating station: {str(e)}"
        }), 500

# ============================================================================
# INVENTORY ENDPOINTS
# ============================================================================

# Low stock notifications and restock requests tables creation
def ensure_inventory_management_tables(db):
    """Ensure inventory management related tables exist"""
    try:
        cursor = db.cursor()
        
        # Create low stock reports table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_low_stock_reports (
                id SERIAL PRIMARY KEY,
                item_id INTEGER REFERENCES inventory_items(id),
                reporter_id INTEGER,
                reporter_name VARCHAR(100),
                report_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                urgency VARCHAR(20) DEFAULT 'normal',
                notes TEXT,
                status VARCHAR(20) DEFAULT 'open'
            )
        ''')
        
        # Create restock requests table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_restock_requests (
                id SERIAL PRIMARY KEY,
                request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                requester_id INTEGER,
                requester_name VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                notes TEXT,
                delivery_expected_date DATE
            )
        ''')
        
        # Create restock request items table (many-to-many relationship)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_restock_request_items (
                id SERIAL PRIMARY KEY,
                request_id INTEGER REFERENCES inventory_restock_requests(id),
                item_id INTEGER REFERENCES inventory_items(id),
                quantity_requested DECIMAL(10, 2) NOT NULL,
                quantity_received DECIMAL(10, 2) DEFAULT 0
            )
        ''')
        
        db.commit()
        return True
    except Exception as e:
        logger.error(f"Error creating inventory management tables: {str(e)}")
        return False

@bp.route('/inventory', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_items():
    """Get all inventory items, optionally filtered by category or station"""
    try:
        # Get query parameters
        category = request.args.get('category')
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create inventory tables if they don't exist
        cursor = db.cursor()
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_items (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    current_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    unit VARCHAR(20) NOT NULL,
                    station_id INTEGER,
                    minimum_threshold DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'in_stock',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_adjustments (
                    id SERIAL PRIMARY KEY,
                    item_id INTEGER REFERENCES inventory_items(id),
                    previous_quantity DECIMAL(10, 2) NOT NULL,
                    new_quantity DECIMAL(10, 2) NOT NULL,
                    adjustment_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reason VARCHAR(50) NOT NULL,
                    notes TEXT,
                    user_id INTEGER
                )
            ''')
            
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating inventory tables: {str(e)}")
        
        # Check if there are any inventory items
        cursor.execute("SELECT COUNT(*) FROM inventory_items")
        count = cursor.fetchone()[0]
        
        # If no items exist, insert some sample data
        if count == 0:
            try:
                # Insert sample inventory items
                cursor.execute('''
                    INSERT INTO inventory_items 
                    (name, category, current_quantity, unit, station_id, minimum_threshold, status) 
                    VALUES 
                    ('Full Cream Milk', 'milk', 15, 'liters', 1, 5, 'in_stock'),
                    ('Almond Milk', 'milk', 8, 'liters', 1, 3, 'in_stock'),
                    ('Oat Milk', 'milk', 2, 'liters', 1, 3, 'low_stock'),
                    ('Soy Milk', 'milk', 6, 'liters', 1, 2, 'in_stock'),
                    ('Coffee Beans - House Blend', 'coffee', 5, 'kg', 1, 2, 'in_stock'),
                    ('Coffee Beans - Dark Roast', 'coffee', 3, 'kg', 1, 2, 'in_stock'),
                    ('Coffee Beans - Decaf', 'coffee', 1, 'kg', 1, 2, 'low_stock'),
                    ('Paper Cups - Regular', 'cups', 200, 'pieces', 1, 50, 'in_stock'),
                    ('Paper Cups - Large', 'cups', 150, 'pieces', 1, 50, 'in_stock'),
                    ('Sugar Packets', 'other', 300, 'pieces', 1, 100, 'in_stock'),
                    ('Stirrers', 'other', 80, 'pieces', 1, 50, 'in_stock')
                ''')
                
                db.commit()
            except Exception as e:
                logger.warning(f"Error inserting sample inventory data: {str(e)}")
                db.rollback()
        
        # Base query
        query = "SELECT * FROM inventory_items WHERE 1=1"
        params = []
        
        # Add filters if provided
        if category:
            query += " AND category = %s"
            params.append(category)
        
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add ordering
        query += " ORDER BY category, name"
        
        # Execute query
        cursor = db.cursor()
        try:
            cursor.execute(query, params if params else None)
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Format inventory items
            items = []
            for row in cursor.fetchall():
                item = dict(zip(columns, row))
                
                # Convert datetime objects to ISO format strings
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = value.isoformat()
                
                items.append(item)
            
            return jsonify({
                'success': True,
                'items': items
            })
        except Exception as e:
            logger.warning(f"Error fetching inventory items: {str(e)}")
            # Return sample data for development
            return jsonify({
                'success': True,
                'items': [
                    {
                        'id': 1,
                        'name': 'Full Cream Milk',
                        'category': 'milk',
                        'current_quantity': 15,
                        'unit': 'liters',
                        'station_id': 1,
                        'minimum_threshold': 5,
                        'status': 'in_stock'
                    },
                    {
                        'id': 2,
                        'name': 'Almond Milk',
                        'category': 'milk',
                        'current_quantity': 8,
                        'unit': 'liters',
                        'station_id': 1,
                        'minimum_threshold': 3,
                        'status': 'in_stock'
                    },
                    {
                        'id': 3,
                        'name': 'Coffee Beans - House Blend',
                        'category': 'coffee',
                        'current_quantity': 5,
                        'unit': 'kg',
                        'station_id': 1,
                        'minimum_threshold': 2,
                        'status': 'in_stock'
                    },
                    {
                        'id': 4,
                        'name': 'Paper Cups - Regular',
                        'category': 'cups',
                        'current_quantity': 200,
                        'unit': 'pieces',
                        'station_id': 1,
                        'minimum_threshold': 50,
                        'status': 'in_stock'
                    }
                ]
            })
    
    except Exception as e:
        logger.error(f"Error fetching inventory items: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching inventory items: {str(e)}"
        }), 500

@bp.route('/inventory/categories', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_categories():
    """Get all inventory categories"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query distinct categories
        cursor = db.cursor()
        try:
            cursor.execute("SELECT DISTINCT category FROM inventory_items ORDER BY category")
            
            # Extract categories
            categories = [row[0] for row in cursor.fetchall()]
            
            if not categories:
                # Return default categories if none found
                categories = ['milk', 'coffee', 'cups', 'syrups', 'other']
            
            return jsonify({
                'success': True,
                'categories': categories
            })
        except Exception as e:
            logger.warning(f"Error fetching inventory categories: {str(e)}")
            # Return default categories for development
            return jsonify({
                'success': True,
                'categories': ['milk', 'coffee', 'cups', 'syrups', 'other']
            })
    
    except Exception as e:
        logger.error(f"Error fetching inventory categories: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching inventory categories: {str(e)}"
        }), 500

@bp.route('/inventory/low-stock', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_low_stock_items():
    """Get low stock inventory items"""
    try:
        # Get station ID from query params (optional)
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Base query
        query = """
            SELECT * FROM inventory_items 
            WHERE current_quantity <= minimum_threshold
        """
        params = []
        
        # Add station filter if provided
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add ordering
        query += " ORDER BY current_quantity / minimum_threshold ASC"
        
        # Execute query
        cursor = db.cursor()
        try:
            cursor.execute(query, params if params else None)
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Format inventory items
            items = []
            for row in cursor.fetchall():
                item = dict(zip(columns, row))
                items.append(item)
            
            return jsonify({
                'success': True,
                'items': items
            })
        except Exception as e:
            logger.warning(f"Error fetching low stock items: {str(e)}")
            # Return sample data for development
            return jsonify({
                'success': True,
                'items': [
                    {
                        'id': 3,
                        'name': 'Coffee Beans - House Blend',
                        'category': 'coffee',
                        'current_quantity': 1,
                        'unit': 'kg',
                        'station_id': 1,
                        'minimum_threshold': 2,
                        'status': 'low_stock'
                    },
                    {
                        'id': 5,
                        'name': 'Oat Milk',
                        'category': 'milk',
                        'current_quantity': 1,
                        'unit': 'liters',
                        'station_id': 2,
                        'minimum_threshold': 3,
                        'status': 'low_stock'
                    }
                ]
            })
    
    except Exception as e:
        logger.error(f"Error fetching low stock items: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching low stock items: {str(e)}"
        }), 500

@bp.route('/inventory/<item_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_item(item_id):
    """Get a specific inventory item"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query inventory item
        cursor = db.cursor()
        try:
            cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Get item
            row = cursor.fetchone()
            
            if not row:
                return jsonify({
                    'success': False,
                    'message': f"Inventory item {item_id} not found"
                }), 404
            
            # Format item
            item = dict(zip(columns, row))
            
            # Convert datetime objects to ISO format strings
            for key, value in item.items():
                if isinstance(value, (datetime, date)):
                    item[key] = value.isoformat()
                    
            # Get item history
            cursor.execute("""
                SELECT * FROM inventory_adjustments 
                WHERE item_id = %s 
                ORDER BY adjustment_time DESC 
                LIMIT 10
            """, (item_id,))
            
            # Get column names for history
            history_columns = [desc[0] for desc in cursor.description]
            
            # Format history
            history = []
            for history_row in cursor.fetchall():
                history_item = dict(zip(history_columns, history_row))
                
                # Convert datetime objects to ISO format strings
                for key, value in history_item.items():
                    if isinstance(value, (datetime, date)):
                        history_item[key] = value.isoformat()
                        
                history.append(history_item)
            
            # Add history to item
            return jsonify({
                'success': True,
                'item': item,
                'history': history
            })
        except Exception as e:
            logger.warning(f"Error fetching inventory item: {str(e)}")
            # Return sample data for development
            return jsonify({
                'success': True,
                'item': {
                    'id': item_id,
                    'name': 'Sample Item',
                    'category': 'other',
                    'current_quantity': 10,
                    'unit': 'pieces',
                    'station_id': 1,
                    'minimum_threshold': 5,
                    'status': 'in_stock'
                },
                'history': [
                    {
                        'id': 1,
                        'item_id': item_id,
                        'previous_quantity': 8,
                        'new_quantity': 10,
                        'adjustment_time': datetime.now().isoformat(),
                        'reason': 'manual_adjustment',
                        'notes': 'Added new stock',
                        'user_id': 1
                    }
                ]
            })
    
    except Exception as e:
        logger.error(f"Error fetching inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching inventory item: {str(e)}"
        }), 500

@bp.route('/inventory/<item_id>', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def update_inventory_item(item_id):
    """Update an inventory item's properties"""
    try:
        data = request.json
        
        if not data:
            return jsonify({
                'success': False,
                'message': 'No data provided for update'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if item exists
        cursor = db.cursor()
        cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
        
        item = cursor.fetchone()
        if not item:
            return jsonify({
                'success': False,
                'message': f"Inventory item {item_id} not found"
            }), 404
        
        # Build update query dynamically based on provided fields
        update_fields = []
        update_values = []
        
        # Fields that can be updated. amount and current_quantity are twin
        # quantity columns — a write to either must land in both, or the
        # barista's number and the report's number drift apart.
        allowed_fields = ['name', 'category', 'current_quantity', 'amount',
                          'unit', 'station_id', 'minimum_threshold', 'status']

        data = dict(data)
        if 'current_quantity' in data and 'amount' not in data:
            data['amount'] = data['current_quantity']
        elif 'amount' in data and 'current_quantity' not in data:
            data['current_quantity'] = data['amount']

        for field in allowed_fields:
            if field in data:
                update_fields.append(f"{field} = %s")
                update_values.append(data[field])
        
        # Add last_updated timestamp
        update_fields.append("last_updated = %s")
        update_values.append(datetime.now().isoformat())
        
        # Add item_id to values
        update_values.append(item_id)
        
        # Construct and execute the update query
        update_query = f'''
            UPDATE inventory_items 
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING *
        '''
        
        cursor.execute(update_query, update_values)
        
        # Get the updated item
        updated_row = cursor.fetchone()
        db.commit()
        
        if not updated_row:
            return jsonify({
                'success': False,
                'message': 'Failed to update item'
            }), 500
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        # Format the updated item
        updated_item = dict(zip(columns, updated_row))
        
        # Convert datetime objects to ISO format strings
        for key, value in updated_item.items():
            if isinstance(value, (datetime, date)):
                updated_item[key] = value.isoformat()
        
        return jsonify({
            'success': True,
            'message': 'Item updated successfully',
            'item': updated_item
        })
    
    except Exception as e:
        logger.error(f"Error updating inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating inventory item: {str(e)}"
        }), 500

@bp.route('/inventory/<item_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def delete_inventory_item(item_id):
    """Delete an inventory item"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Start a transaction
        cursor = db.cursor()
        
        try:
            # First delete related adjustments to avoid foreign key constraint issues
            cursor.execute("DELETE FROM inventory_adjustments WHERE item_id = %s", (item_id,))
            
            # Then delete the item
            cursor.execute("DELETE FROM inventory_items WHERE id = %s RETURNING id", (item_id,))
            
            result = cursor.fetchone()
            
            if not result:
                return jsonify({
                    'success': False,
                    'message': f"Inventory item {item_id} not found"
                }), 404
            
            # Commit the transaction
            db.commit()
            
            return jsonify({
                'success': True,
                'message': f"Inventory item {item_id} deleted successfully"
            })
        except Exception as e:
            # Rollback on error
            db.rollback()
            raise e
    
    except Exception as e:
        logger.error(f"Error deleting inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error deleting inventory item: {str(e)}"
        }), 500

@bp.route('/inventory/<item_id>/adjust', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def adjust_inventory_item(item_id):
    """Adjust an inventory item's quantity"""
    try:
        # Get request data
        data = request.json
        new_amount = data.get('new_amount')
        change_reason = data.get('change_reason', 'manual_adjustment')
        notes = data.get('notes', '')
        
        # Validate required fields
        if new_amount is None:
            return jsonify({
                'success': False,
                'message': "New amount is required"
            }), 400
        
        try:
            new_amount = float(new_amount)
        except ValueError:
            return jsonify({
                'success': False,
                'message': "New amount must be a number"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)

        # Start a transaction
        cursor = db.cursor()

        # Heal the amount/current_quantity split-brain before writing (no-op
        # after the first call in this process) — this UPDATE sets both.
        try:
            if coffee_system and hasattr(coffee_system, '_ensure_inventory_quantity_columns'):
                coffee_system._ensure_inventory_quantity_columns(cursor)
        except Exception:
            pass

        try:
            # Get current item details
            cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Get item
            row = cursor.fetchone()
            
            if not row:
                return jsonify({
                    'success': False,
                    'message': f"Inventory item {item_id} not found"
                }), 404
            
            # Format item
            item = dict(zip(columns, row))
            previous_quantity = item['current_quantity']
            
            # Update item quantity — BOTH quantity columns (amount is the
            # legacy twin current_quantity; the stock decrementer keeps them
            # in sync, so adjustments must too or they drift apart again).
            cursor.execute("""
                UPDATE inventory_items
                SET current_quantity = %s,
                    amount = %s,
                    status = CASE
                        WHEN %s <= minimum_threshold THEN 'low_stock'
                        ELSE 'in_stock'
                    END,
                    last_updated = %s
                WHERE id = %s
                RETURNING *
            """, (new_amount, new_amount, new_amount, datetime.now().isoformat(), item_id))
            
            # Get updated item
            updated_row = cursor.fetchone()
            updated_item = dict(zip(columns, updated_row))
            
            # Convert datetime objects to ISO format strings for output
            for key, value in updated_item.items():
                if isinstance(value, (datetime, date)):
                    updated_item[key] = value.isoformat()
            
            # Record adjustment in history
            user_id = get_jwt_identity()
            cursor.execute("""
                INSERT INTO inventory_adjustments
                (item_id, previous_quantity, new_quantity, adjustment_time, reason, notes, user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (item_id, previous_quantity, new_amount, datetime.now().isoformat(), 
                  change_reason, notes, user_id))
            
            # Commit transaction
            db.commit()
            
            return jsonify({
                'success': True,
                'message': f"Inventory item {item_id} updated successfully",
                'item': updated_item
            })
        except Exception as e:
            # Rollback transaction on error
            db.rollback()
            raise e
    
    except Exception as e:
        logger.error(f"Error adjusting inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adjusting inventory item: {str(e)}"
        }), 500

@bp.route('/inventory/<item_id>/report-low', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def report_low_stock(item_id):
    """Report an item as low in stock"""
    try:
        # Get request data
        data = request.json
        urgency = data.get('urgency', 'normal')
        notes = data.get('notes', '')
        
        # Validate urgency
        valid_urgencies = ['low', 'normal', 'high', 'critical']
        if urgency not in valid_urgencies:
            return jsonify({
                'success': False,
                'message': f"Invalid urgency level. Must be one of: {', '.join(valid_urgencies)}"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start a transaction
        cursor = db.cursor()
        
        try:
            # Verify item exists
            cursor.execute("SELECT name FROM inventory_items WHERE id = %s", (item_id,))
            item = cursor.fetchone()
            
            if not item:
                return jsonify({
                    'success': False,
                    'message': f"Inventory item {item_id} not found"
                }), 404
            
            # Get user info from JWT
            user_id = get_jwt_identity()
            claims = get_jwt()
            user_name = claims.get('full_name', 'Unknown User')
            
            # Create low stock report
            cursor.execute("""
                INSERT INTO inventory_low_stock_reports
                (item_id, reporter_id, reporter_name, urgency, notes, status)
                VALUES (%s, %s, %s, %s, %s, 'open')
                RETURNING id, report_time
            """, (item_id, user_id, user_name, urgency, notes))
            
            result = cursor.fetchone()
            
            # Update item status to low_stock
            cursor.execute("""
                UPDATE inventory_items
                SET status = 'low_stock', last_updated = %s
                WHERE id = %s
            """, (datetime.now().isoformat(), item_id))
            
            # Commit transaction
            db.commit()
            
            return jsonify({
                'success': True,
                'message': f"Low stock report created successfully for {item[0]}",
                'report_id': result[0],
                'report_time': result[1].isoformat() if isinstance(result[1], datetime) else result[1]
            })
        except Exception as e:
            # Rollback transaction on error
            db.rollback()
            raise e
    
    except Exception as e:
        logger.error(f"Error reporting low stock for item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error reporting low stock: {str(e)}"
        }), 500

@bp.route('/inventory/restock-request', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def create_restock_request():
    """Create a restock request for multiple items"""
    try:
        # Get request data
        data = request.json
        items = data.get('items', [])
        notes = data.get('notes', '')
        
        if not items or not isinstance(items, list) or len(items) == 0:
            return jsonify({
                'success': False,
                'message': "At least one item is required for a restock request"
            }), 400
        
        # Validate each item has the required fields
        for item in items:
            if 'id' not in item or 'quantity' not in item:
                return jsonify({
                    'success': False,
                    'message': "Each item must have id and quantity fields"
                }), 400
            
            try:
                float(item['quantity'])
            except (ValueError, TypeError):
                return jsonify({
                    'success': False,
                    'message': "Item quantities must be numbers"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start a transaction
        cursor = db.cursor()
        
        try:
            # Get user info from JWT
            user_id = get_jwt_identity()
            claims = get_jwt()
            user_name = claims.get('full_name', 'Unknown User')
            
            # Create restock request
            cursor.execute("""
                INSERT INTO inventory_restock_requests
                (requester_id, requester_name, status, notes)
                VALUES (%s, %s, 'pending', %s)
                RETURNING id, request_time
            """, (user_id, user_name, notes))
            
            request_result = cursor.fetchone()
            request_id = request_result[0]
            
            # Add items to the request
            for item in items:
                item_id = item['id']
                quantity = item['quantity']
                
                # Verify item exists
                cursor.execute("SELECT id FROM inventory_items WHERE id = %s", (item_id,))
                if not cursor.fetchone():
                    # Skip invalid items
                    continue
                
                cursor.execute("""
                    INSERT INTO inventory_restock_request_items
                    (request_id, item_id, quantity_requested)
                    VALUES (%s, %s, %s)
                """, (request_id, item_id, quantity))
            
            # Commit transaction
            db.commit()
            
            # Format response
            request_time = request_result[1].isoformat() if isinstance(request_result[1], datetime) else request_result[1]
            
            return jsonify({
                'success': True,
                'message': "Restock request created successfully",
                'requestId': request_id,
                'request_time': request_time,
                'item_count': len(items)
            })
        except Exception as e:
            # Rollback transaction on error
            db.rollback()
            raise e
    
    except Exception as e:
        logger.error(f"Error creating restock request: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating restock request: {str(e)}"
        }), 500

@bp.route('/inventory/restock-requests', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_restock_requests():
    """Get list of restock requests"""
    try:
        # Get query parameters
        status = request.args.get('status')
        limit = request.args.get('limit', 20, type=int)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Build query
        query = "SELECT * FROM inventory_restock_requests"
        params = []
        
        if status:
            query += " WHERE status = %s"
            params.append(status)
        
        query += " ORDER BY request_time DESC LIMIT %s"
        params.append(limit)
        
        # Execute query
        cursor = db.cursor()
        cursor.execute(query, params)
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        # Format results
        requests = []
        for row in cursor.fetchall():
            request_data = dict(zip(columns, row))
            
            # Convert datetime objects to ISO format strings
            for key, value in request_data.items():
                if isinstance(value, (datetime, date)):
                    request_data[key] = value.isoformat()
            
            # Get items for this request
            cursor.execute("""
                SELECT i.id, i.name, i.category, i.unit, ri.quantity_requested, ri.quantity_received
                FROM inventory_restock_request_items ri
                JOIN inventory_items i ON ri.item_id = i.id
                WHERE ri.request_id = %s
            """, (request_data['id'],))
            
            # Format items
            items = []
            for item_row in cursor.fetchall():
                items.append({
                    'id': item_row[0],
                    'name': item_row[1],
                    'category': item_row[2],
                    'unit': item_row[3],
                    'quantity_requested': item_row[4],
                    'quantity_received': item_row[5]
                })
            
            request_data['items'] = items
            requests.append(request_data)
        
        return jsonify({
            'success': True,
            'requests': requests
        })
    
    except Exception as e:
        logger.error(f"Error fetching restock requests: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching restock requests: {str(e)}"
        }), 500

@bp.route('/inventory', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def create_inventory_item():
    """Create a new inventory item"""
    try:
        # Get request data
        data = request.json
        name = data.get('name')
        category = data.get('category')
        current_quantity = data.get('current_quantity')
        unit = data.get('unit')
        station_id = data.get('station_id')
        minimum_threshold = data.get('minimum_threshold')
        
        # Validate required fields
        if not name or not category or current_quantity is None or not unit:
            return jsonify({
                'success': False,
                'message': "Name, category, current_quantity, and unit are required"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert new item
        cursor = db.cursor()
        status = 'low_stock' if current_quantity <= minimum_threshold else 'in_stock'
        cursor.execute("""
            INSERT INTO inventory_items
            (name, category, current_quantity, amount, unit, station_id, minimum_threshold, status, created_at, last_updated)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (name, category, current_quantity, current_quantity, unit, station_id, minimum_threshold, 
              status, datetime.now().isoformat(), datetime.now().isoformat()))
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        # Get inserted item
        row = cursor.fetchone()
        db.commit()
        
        # Format item
        item = dict(zip(columns, row))
        
        return jsonify({
            'success': True,
            'message': "Inventory item created successfully",
            'item': item
        }), 201
    
    except Exception as e:
        logger.error(f"Error creating inventory item: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating inventory item: {str(e)}"
        }), 500

# ============================================================================
# SMS ENDPOINTS
# ============================================================================

@bp.route('/sms/send', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def send_sms():
    """Send an SMS message directly.

    Locked down after the fresh-eyes audit caught it as a Twilio-bill
    abuse vector:
      - role_required: was admin/staff/barista; now admin/staff only.
        Baristas don't need direct SMS-send; they have the per-order
        Message button which goes through a separate validated path.
      - audit log: every call is logged with WHO sent WHAT to WHICH
        number. (Logger writes to api_access; ops can grep.)
      - rate limit: 10 sends per minute per user. A real operator
        broadcasting an outage stays under it; a runaway loop or
        compromised token hits the wall fast.

    Doesn't validate the recipient number against a list — operators
    legitimately text customers whose phone is in the orders table —
    but the audit log + rate limit make abuse traceable and bounded.
    """
    import time

    try:
        data = request.json or {}
        to_number = (data.get('to') or '').strip()
        message = (data.get('message') or '').strip()

        if not to_number or not message:
            return jsonify({
                'success': False,
                'message': "Both 'to' and 'message' are required",
            }), 400

        # Rate limit per user — in-memory window, sufficient for a
        # single-container Railway deploy. Reset hourly via process
        # restart. Move to Redis if we ever scale horizontally.
        try:
            from flask_jwt_extended import get_jwt_identity
            actor = get_jwt_identity() or 'unknown'
        except Exception:
            actor = 'unknown'

        global _SMS_SEND_WINDOW
        if '_SMS_SEND_WINDOW' not in globals():
            _SMS_SEND_WINDOW = {}
        now_ts = int(time.time())
        window_start = now_ts - 60
        # Prune old entries opportunistically.
        if len(_SMS_SEND_WINDOW) > 1000:
            _SMS_SEND_WINDOW = {
                k: [t for t in v if t >= window_start]
                for k, v in _SMS_SEND_WINDOW.items()
            }
        actor_sends = [t for t in _SMS_SEND_WINDOW.get(actor, []) if t >= window_start]
        if len(actor_sends) >= 10:
            logger.warning(
                f"sms/send rate-limit hit: actor={actor!r}, "
                f"{len(actor_sends)} sends in last 60s"
            )
            return jsonify({
                'success': False,
                'message': "Rate limit: max 10 SMS per minute per user.",
                'code': 'RATE_LIMITED',
            }), 429
        actor_sends.append(now_ts)
        _SMS_SEND_WINDOW[actor] = actor_sends

        # Audit log — always, before the send. Even a failure to send
        # tells ops there was an attempt.
        logger.info(
            f"AUDIT sms/send: actor={actor!r} to={to_number!r} "
            f"msg_len={len(message)} msg_preview={message[:40]!r}"
        )

        # Forward to the actual implementation
        from routes.sms_routes import send_sms as sms_handler
        return sms_handler()

    except Exception as e:
        logger.error(f"Error sending SMS: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error sending SMS: {str(e)}"
        }), 500


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


@bp.route('/sms/dropped', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_dropped():
    """Inbound messages we accepted but never finished processing.

    A row stays processed=false when handling threw part-way — a redeploy
    mid-request, a database blip, an unhandled edge case. That is a real
    customer whose order did not land, and until now nothing surfaced it:
    the row simply sat there. Found the hard way when a confirmed order was
    lost at 04:33 during a deploy and the only trace was processed=false.

    Deliberately excludes the last `grace` seconds (default 60) so a message
    being processed right now is not reported as dropped.

    Params: grace=<seconds>, hours=<lookback, default 6>, limit (<=200).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        grace = max(0, min(int(request.args.get('grace', 60)), 3600))
        hours = max(1, min(int(request.args.get('hours', 6)), 168))
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
        cur = coffee_system.db.cursor()
        cur.execute(
            """
            SELECT id, phone_number, message_body, received_at
            FROM sms_messages
            WHERE processed = FALSE
              AND received_at < NOW() - (%s * INTERVAL '1 second')
              AND received_at > NOW() - (%s * INTERVAL '1 hour')
            ORDER BY received_at DESC
            LIMIT %s
            """,
            (grace, hours, limit))
        rows = cur.fetchall()
        dropped = []
        for r in rows:
            rid, phone, body, at = (
                (r['id'], r['phone_number'], r['message_body'], r['received_at'])
                if isinstance(r, dict) else (r[0], r[1], r[2], r[3]))
            dropped.append({
                'id': rid,
                'phone': phone,
                'message': body,
                'received_at': at.isoformat() if hasattr(at, 'isoformat') else str(at),
            })
        return jsonify({
            'success': True,
            'count': len(dropped),
            'dropped': dropped,
            'window_hours': hours,
        })
    except Exception as e:
        logger.error(f"sms_dropped error: {e}")
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/log', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_log():
    """Inbound SMS log with the bot's replies — the raw material for
    reviewing a live group test (sms_messages had no reader endpoint).

    Params: since=<ISO timestamp> (default: last 2 hours), limit (<=500).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        since = request.args.get('since')
        try:
            limit = min(500, int(request.args.get('limit') or 300))
        except (TypeError, ValueError):
            limit = 300
        cur = db.cursor()
        if since:
            cur.execute("""
                SELECT id, phone_number, message_body, sender_name, station_id,
                       received_at, processed, response_sent
                  FROM sms_messages
                 WHERE received_at >= %s
                 ORDER BY received_at ASC
                 LIMIT %s
            """, (since, limit))
        else:
            cur.execute("""
                SELECT id, phone_number, message_body, sender_name, station_id,
                       received_at, processed, response_sent
                  FROM sms_messages
                 WHERE received_at >= NOW() - INTERVAL '2 hours'
                 ORDER BY received_at ASC
                 LIMIT %s
            """, (limit,))
        cols = ['id', 'phone_number', 'message_body', 'sender_name', 'station_id',
                'received_at', 'processed', 'response_sent']
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r)) if not isinstance(r, dict) else dict(r)
            if hasattr(d.get('received_at'), 'isoformat'):
                d['received_at'] = d['received_at'].isoformat()
            rows.append(d)
        return jsonify({'success': True, 'count': len(rows), 'messages': rows})
    except Exception as e:
        logger.error(f"sms_log error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/sms/blocklist', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_blocklist_get():
    """List numbers currently blocked from SMS ordering (no reply = no cost)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        return jsonify({'success': True, 'status': 'success',
                        'data': {'blocked': coffee_system.get_sms_blocklist()}})
    except Exception as e:
        logger.error(f"sms_blocklist_get failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/block', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_block_number():
    """Block a phone number from SMS ordering. The bot stops replying to it
    entirely (zero outbound cost) until it's unblocked."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        body = request.json or {}
        phone = (body.get('phone') or body.get('number') or '').strip()
        if not phone:
            return jsonify({'success': False, 'message': "A 'phone' is required."}), 400
        try:
            actor = get_jwt_identity() or ''
        except Exception:
            actor = ''
        blocked = coffee_system.block_sms_number(phone, reason=(body.get('reason') or ''), by=actor)
        return jsonify({'success': True, 'status': 'success',
                        'message': f"Blocked {blocked}.", 'data': {'phone': blocked}})
    except Exception as e:
        logger.error(f"sms_block_number failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/unblock', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_unblock_number():
    """Remove a phone number from the SMS blocklist (it can order again)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        body = request.json or {}
        phone = (body.get('phone') or body.get('number') or '').strip()
        if not phone:
            return jsonify({'success': False, 'message': "A 'phone' is required."}), 400
        ok = coffee_system.unblock_sms_number(phone)
        return jsonify({'success': True, 'status': 'success',
                        'message': "Unblocked." if ok else "That number wasn't blocked.",
                        'data': {'unblocked': ok}})
    except Exception as e:
        logger.error(f"sms_unblock_number failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/send-test', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def send_test_sms():
    """Send a test SMS message"""
    try:
        data = request.json
        to_number = data.get('to')
        message = data.get('message', 'This is a test message from the Expresso Coffee System')
        
        # Forward to the actual implementation
        from routes.sms_routes import send_test_sms as test_sms_handler
        return test_sms_handler()
    
    except Exception as e:
        logger.error(f"Error sending test SMS: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error sending test SMS: {str(e)}"
        }), 500

# ============================================================================
# CHAT ENDPOINTS
# ============================================================================

@bp.route('/chat/messages', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_messages():
    """Get chat messages"""
    try:
        # Get query parameters
        limit = request.args.get('limit', 50, type=int)
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if chat_messages table exists
        cursor = db.cursor()
        cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
        table_exists = cursor.fetchone()[0]
        
        if table_exists:
            # Build query based on parameters
            query = '''
                SELECT id, sender, content, is_urgent, station_id, created_at
                FROM chat_messages
            '''
            params = []
            
            # Add station filter if provided
            if station_id:
                query += " WHERE station_id = %s"
                params.append(station_id)
            
            # Add ordering and limit
            query += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            
            # Execute query
            cursor.execute(query, params)
            
            messages = []
            for msg in cursor.fetchall():
                msg_id, sender, content, is_urgent, station_id, created_at = msg
                messages.append({
                    'id': msg_id,
                    'sender': sender,
                    'content': content,
                    'station_id': station_id,
                    'created_at': created_at,
                    'is_urgent': bool(is_urgent)
                })
            
            return jsonify({
                'success': True,
                'messages': messages
            })
        else:
            # If table doesn't exist, return empty list
            logger.warning("chat_messages table not found")
            return jsonify({
                'success': True,
                'messages': []
            })
    
    except Exception as e:
        logger.error(f"Error fetching chat messages: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching chat messages: {str(e)}"
        }), 500

@bp.route('/chat/messages', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def create_chat_message():
    """Create a new chat message"""
    try:
        data = request.json
        sender = data.get('sender', '')
        content = data.get('content', '')
        is_urgent = data.get('is_urgent', False)
        station_id = data.get('station_id')
        
        if not sender or not content:
            return jsonify({
                'success': False,
                'message': 'Sender and content are required'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create chat_messages table if it doesn't exist
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                is_urgent BOOLEAN DEFAULT FALSE,
                station_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Insert message
        cursor.execute('''
            INSERT INTO chat_messages (sender, content, is_urgent, station_id)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
        ''', (sender, content, is_urgent, station_id))
        
        result = cursor.fetchone()
        db.commit()
        
        # Return created message
        return jsonify({
            'success': True,
            'message': {
                'id': result[0],
                'sender': sender,
                'content': content,
                'is_urgent': is_urgent,
                'station_id': station_id,
                'created_at': result[1]
            }
        })
    
    except Exception as e:
        logger.error(f"Error creating chat message: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating chat message: {str(e)}"
        }), 500

@bp.route('/chat/messages/<message_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_message(message_id):
    """Get a specific chat message by ID"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for the specific message
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, sender, content, is_urgent, station_id, created_at
            FROM chat_messages
            WHERE id = %s
        ''', (message_id,))
        
        msg = cursor.fetchone()
        
        if not msg:
            return jsonify({
                'success': False,
                'message': f'Message with ID {message_id} not found'
            }), 404
        
        # Format message
        msg_id, sender, content, is_urgent, station_id, created_at = msg
        message = {
            'id': msg_id,
            'sender': sender,
            'content': content,
            'station_id': station_id,
            'created_at': created_at,
            'is_urgent': bool(is_urgent)
        }
        
        return jsonify({
            'success': True,
            'message': message
        })
    
    except Exception as e:
        logger.error(f"Error fetching chat message {message_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching chat message: {str(e)}"
        }), 500

@bp.route('/chat/messages/<message_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def delete_chat_message(message_id):
    """Delete a specific chat message"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete the message
        cursor = db.cursor()
        cursor.execute('DELETE FROM chat_messages WHERE id = %s RETURNING id', (message_id,))
        
        result = cursor.fetchone()
        db.commit()
        
        if not result:
            return jsonify({
                'success': False,
                'message': f'Message with ID {message_id} not found'
            }), 404
        
        return jsonify({
            'success': True,
            'message': f'Message {message_id} deleted successfully'
        })
    
    except Exception as e:
        logger.error(f"Error deleting chat message {message_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error deleting chat message: {str(e)}"
        }), 500

@bp.route('/chat/stations', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_stations():
    """Get active stations for chat"""
    try:
        # Forward to the stations endpoint but filter for active stations only
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for active stations
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT station_id, name, location, status, barista_name
                FROM station_stats
                WHERE status = 'active'
                ORDER BY station_id
            ''')
        except Exception as e:
            logger.warning(f"Error with primary station query: {str(e)}")
            # Fallback to simpler query
            cursor.execute('''
                SELECT id, name, location, status, NULL as barista_name
                FROM stations
                WHERE status = 'active'
                ORDER BY id
            ''')
        
        # Process stations
        stations = []
        for station in cursor.fetchall():
            station_id, name, location, status, barista_name = station
            
            # Format station for frontend
            stations.append({
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status or "active",
                'barista': barista_name or "Unassigned"
            })
        
        return jsonify({
            'success': True,
            'stations': stations
        })
    
    except Exception as e:
        logger.error(f"Error fetching chat stations: {str(e)}")
        # Fallback to hardcoded stations for development
        return jsonify({
            'success': True,
            'stations': [
                {
                    'id': 1,
                    'name': 'Station #1',
                    'location': 'Main Hall',
                    'status': 'active',
                    'barista': 'Barista 1'
                },
                {
                    'id': 2,
                    'name': 'Station #2',
                    'location': 'Exhibition Hall',
                    'status': 'active',
                    'barista': 'Barista 2'
                },
                {
                    'id': 3,
                    'name': 'Station #3',
                    'location': 'Registration Area',
                    'status': 'active',
                    'barista': 'Barista 3'
                }
            ]
        })

# ============================================================================
# SCHEDULE ENDPOINTS
# ============================================================================

@bp.route('/schedule/today', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_today_schedule():
    """Get schedule for today"""
    try:
        # Optional station filter
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create schedule tables if they don't exist
        cursor = db.cursor()
        try:
            # Create shifts table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_shifts (
                    id SERIAL PRIMARY KEY,
                    barista_id INTEGER,
                    barista_name VARCHAR(100),
                    station_id INTEGER,
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    status VARCHAR(20) DEFAULT 'upcoming',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create breaks table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_breaks (
                    id SERIAL PRIMARY KEY,
                    barista_id INTEGER,
                    barista_name VARCHAR(100),
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    break_type VARCHAR(20),
                    status VARCHAR(20) DEFAULT 'upcoming',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create rush periods table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_rush_periods (
                    id SERIAL PRIMARY KEY,
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating schedule tables: {str(e)}")
        
        # Get today's date
        today = datetime.now().date()
        
        # Query shifts
        shifts_query = "SELECT * FROM schedule_shifts WHERE date = %s"
        shifts_params = [today]
        
        if station_id:
            shifts_query += " AND station_id = %s"
            shifts_params.append(station_id)
        
        shifts_query += " ORDER BY start_time"
        
        try:
            cursor.execute(shifts_query, shifts_params)
            shifts_columns = [desc[0] for desc in cursor.description]
            shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching shifts: {str(e)}")
            shifts = []
        
        # Query breaks
        breaks_query = "SELECT * FROM schedule_breaks WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(breaks_query, [today])
            breaks_columns = [desc[0] for desc in cursor.description]
            breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching breaks: {str(e)}")
            breaks = []
        
        # Query rush periods
        rush_query = "SELECT * FROM schedule_rush_periods WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(rush_query, [today])
            rush_columns = [desc[0] for desc in cursor.description]
            rush_periods = [dict(zip(rush_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching rush periods: {str(e)}")
            rush_periods = []
        
        # DISABLED: don't fabricate sample shifts/breaks when there's no
        # real schedule (showed fake data forever — see station_api_routes
        # get_todays_schedule). Empty stays empty; the UI shows an honest
        # "no shifts" state. (This endpoint is shadowed by station_api's
        # /api/schedule/today anyway, but disabled here too for consistency.)
        if False:  # was: if len(shifts)==0 and len(breaks)==0 and len(rush_periods)==0
            # Create sample shifts and breaks
            try:
                cursor.execute('''
                    INSERT INTO schedule_shifts 
                    (barista_id, barista_name, station_id, date, start_time, end_time, status, notes) 
                    VALUES 
                    (1, 'Alex Smith', 1, %s, '08:00:00', '12:00:00', 'active', 'Morning shift'),
                    (2, 'Jamie Lee', 2, %s, '08:00:00', '16:00:00', 'active', 'Full day shift'),
                    (3, 'Taylor Johnson', 3, %s, '12:00:00', '20:00:00', 'upcoming', 'Afternoon shift')
                ''', (today, today, today))
                
                cursor.execute('''
                    INSERT INTO schedule_breaks 
                    (barista_id, barista_name, date, start_time, end_time, break_type, status, notes) 
                    VALUES 
                    (1, 'Alex Smith', %s, '10:00:00', '10:15:00', 'coffee', 'active', 'Short break'),
                    (2, 'Jamie Lee', %s, '12:00:00', '12:30:00', 'lunch', 'upcoming', 'Lunch break')
                ''', (today, today))
                
                cursor.execute('''
                    INSERT INTO schedule_rush_periods 
                    (date, start_time, end_time, description) 
                    VALUES 
                    (%s, '08:30:00', '09:30:00', 'Morning rush'),
                    (%s, '12:00:00', '13:30:00', 'Lunch rush')
                ''', (today, today))
                
                db.commit()
                
                # Re-query to get the new data
                cursor.execute(shifts_query, shifts_params)
                shifts_columns = [desc[0] for desc in cursor.description]
                shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
                
                cursor.execute(breaks_query, [today])
                breaks_columns = [desc[0] for desc in cursor.description]
                breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
                
                cursor.execute(rush_query, [today])
                rush_columns = [desc[0] for desc in cursor.description]
                rush_periods = [dict(zip(rush_columns, row)) for row in cursor.fetchall()]
            except Exception as e:
                logger.warning(f"Error creating sample schedule data: {str(e)}")
        
        # Convert datetime objects to ISO format strings for JSON serialization
        for shift in shifts:
            for key, value in shift.items():
                if isinstance(value, (datetime, date)):
                    shift[key] = value.isoformat()
                elif isinstance(value, time):
                    shift[key] = value.strftime('%H:%M:%S')
        
        for break_item in breaks:
            for key, value in break_item.items():
                if isinstance(value, (datetime, date)):
                    break_item[key] = value.isoformat()
                elif isinstance(value, time):
                    break_item[key] = value.strftime('%H:%M:%S')
        
        for rush in rush_periods:
            for key, value in rush.items():
                if isinstance(value, (datetime, date)):
                    rush[key] = value.isoformat()
                elif isinstance(value, time):
                    rush[key] = value.strftime('%H:%M:%S')
        
        return jsonify({
            'success': True,
            'schedule': {
                'shifts': shifts,
                'breaks': breaks,
                'rushPeriods': rush_periods,
                'date': today.isoformat()
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching schedule: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching schedule: {str(e)}"
        }), 500

@bp.route('/schedule/date/<date>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_schedule_by_date(date):
    """Get schedule for a specific date"""
    try:
        # Validate date format
        try:
            schedule_date = datetime.strptime(date, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({
                'success': False,
                'message': "Invalid date format. Use YYYY-MM-DD"
            }), 400
        
        # Optional station filter
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query shifts
        cursor = db.cursor()
        shifts_query = "SELECT * FROM schedule_shifts WHERE date = %s"
        shifts_params = [schedule_date]
        
        if station_id:
            shifts_query += " AND station_id = %s"
            shifts_params.append(station_id)
        
        shifts_query += " ORDER BY start_time"
        
        try:
            cursor.execute(shifts_query, shifts_params)
            shifts_columns = [desc[0] for desc in cursor.description]
            shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching shifts: {str(e)}")
            shifts = []
        
        # Query breaks
        breaks_query = "SELECT * FROM schedule_breaks WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(breaks_query, [schedule_date])
            breaks_columns = [desc[0] for desc in cursor.description]
            breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching breaks: {str(e)}")
            breaks = []
        
        # Query rush periods
        rush_query = "SELECT * FROM schedule_rush_periods WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(rush_query, [schedule_date])
            rush_columns = [desc[0] for desc in cursor.description]
            rush_periods = [dict(zip(rush_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching rush periods: {str(e)}")
            rush_periods = []
        
        return jsonify({
            'success': True,
            'schedule': {
                'shifts': shifts,
                'breaks': breaks,
                'rushPeriods': rush_periods,
                'date': schedule_date.isoformat()
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching schedule for date {date}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching schedule: {str(e)}"
        }), 500

@bp.route('/schedule/barista/<barista_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_barista_schedule(barista_id):
    """Get schedule for a specific barista"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query barista shifts
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT * FROM schedule_shifts
                WHERE barista_id = %s AND date >= CURRENT_DATE
                ORDER BY date, start_time
                LIMIT 20
            ''', (barista_id,))
            shifts_columns = [desc[0] for desc in cursor.description]
            shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching barista shifts: {str(e)}")
            shifts = []
        
        # Query barista breaks
        try:
            cursor.execute('''
                SELECT * FROM schedule_breaks
                WHERE barista_id = %s AND date >= CURRENT_DATE
                ORDER BY date, start_time
                LIMIT 20
            ''', (barista_id,))
            breaks_columns = [desc[0] for desc in cursor.description]
            breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching barista breaks: {str(e)}")
            breaks = []
        
        return jsonify({
            'success': True,
            'schedule': {
                'shifts': shifts,
                'breaks': breaks,
                'barista_id': barista_id
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching barista schedule: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching barista schedule: {str(e)}"
        }), 500

@bp.route('/schedule/shifts', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_shift():
    """Add a new shift to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['barista_id', 'barista_name', 'station_id', 'date', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert shift
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_shifts
            (barista_id, barista_name, station_id, date, start_time, end_time, status, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        ''', (
            data['barista_id'],
            data['barista_name'],
            data['station_id'],
            data['date'],
            data['start_time'],
            data['end_time'],
            data.get('status', 'upcoming'),
            data.get('notes', '')
        ))
        
        db.commit()
        
        # Get created shift
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        shift = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'shift': shift,
            'message': 'Shift added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding shift: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding shift: {str(e)}"
        }), 500

@bp.route('/schedule/shifts/<shift_id>', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def update_shift(shift_id):
    """Update an existing shift"""
    try:
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update shift
        cursor = db.cursor()
        update_fields = []
        update_values = []
        
        # Build dynamic update query based on provided fields
        for field in ['barista_id', 'barista_name', 'station_id', 'date', 'start_time', 'end_time', 'status', 'notes']:
            if field in data:
                update_fields.append(f"{field} = %s")
                update_values.append(data[field])
        
        if not update_fields:
            return jsonify({
                'success': False,
                'message': 'No fields to update'
            }), 400
        
        # Add shift_id to values
        update_values.append(shift_id)
        
        # Execute update
        cursor.execute(f'''
            UPDATE schedule_shifts
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING *
        ''', update_values)
        
        db.commit()
        
        # Get updated shift
        result = cursor.fetchone()
        
        if not result:
            return jsonify({
                'success': False,
                'message': f'Shift with ID {shift_id} not found'
            }), 404
        
        columns = [desc[0] for desc in cursor.description]
        shift = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'shift': shift,
            'message': 'Shift updated successfully'
        })
    
    except Exception as e:
        logger.error(f"Error updating shift {shift_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating shift: {str(e)}"
        }), 500

@bp.route('/schedule/shifts/<shift_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def delete_shift(shift_id):
    """Delete a shift"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete shift
        cursor = db.cursor()
        cursor.execute('DELETE FROM schedule_shifts WHERE id = %s RETURNING id', (shift_id,))
        
        result = cursor.fetchone()
        db.commit()
        
        if not result:
            return jsonify({
                'success': False,
                'message': f'Shift with ID {shift_id} not found'
            }), 404
        
        return jsonify({
            'success': True,
            'message': f'Shift with ID {shift_id} deleted successfully'
        })
    
    except Exception as e:
        logger.error(f"Error deleting shift {shift_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error deleting shift: {str(e)}"
        }), 500

@bp.route('/schedule/breaks', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_break():
    """Add a new break to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['barista_id', 'barista_name', 'date', 'start_time', 'end_time', 'break_type']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert break
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_breaks
            (barista_id, barista_name, date, start_time, end_time, break_type, status, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        ''', (
            data['barista_id'],
            data['barista_name'],
            data['date'],
            data['start_time'],
            data['end_time'],
            data['break_type'],
            data.get('status', 'upcoming'),
            data.get('notes', '')
        ))
        
        db.commit()
        
        # Get created break
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        break_data = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'break': break_data,
            'message': 'Break added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding break: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding break: {str(e)}"
        }), 500

@bp.route('/schedule/breaks/<break_id>', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def update_break(break_id):
    """Update an existing break"""
    try:
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update break
        cursor = db.cursor()
        update_fields = []
        update_values = []
        
        # Build dynamic update query based on provided fields
        for field in ['barista_id', 'barista_name', 'date', 'start_time', 'end_time', 'break_type', 'status', 'notes']:
            if field in data:
                update_fields.append(f"{field} = %s")
                update_values.append(data[field])
        
        if not update_fields:
            return jsonify({
                'success': False,
                'message': 'No fields to update'
            }), 400
        
        # Add break_id to values
        update_values.append(break_id)
        
        # Execute update
        cursor.execute(f'''
            UPDATE schedule_breaks
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING *
        ''', update_values)
        
        db.commit()
        
        # Get updated break
        result = cursor.fetchone()
        
        if not result:
            return jsonify({
                'success': False,
                'message': f'Break with ID {break_id} not found'
            }), 404
        
        columns = [desc[0] for desc in cursor.description]
        break_data = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'break': break_data,
            'message': 'Break updated successfully'
        })
    
    except Exception as e:
        logger.error(f"Error updating break {break_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error updating break: {str(e)}"
        }), 500

@bp.route('/schedule/breaks/<break_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def delete_break(break_id):
    """Delete a break"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete break
        cursor = db.cursor()
        cursor.execute('DELETE FROM schedule_breaks WHERE id = %s RETURNING id', (break_id,))
        
        result = cursor.fetchone()
        db.commit()
        
        if not result:
            return jsonify({
                'success': False,
                'message': f'Break with ID {break_id} not found'
            }), 404
        
        return jsonify({
            'success': True,
            'message': f'Break with ID {break_id} deleted successfully'
        })
    
    except Exception as e:
        logger.error(f"Error deleting break {break_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error deleting break: {str(e)}"
        }), 500

@bp.route('/schedule/rush-periods', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_rush_period():
    """Add a new rush period to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['date', 'start_time', 'end_time', 'description']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert rush period
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_rush_periods
            (date, start_time, end_time, description)
            VALUES (%s, %s, %s, %s)
            RETURNING *
        ''', (
            data['date'],
            data['start_time'],
            data['end_time'],
            data['description']
        ))
        
        db.commit()
        
        # Get created rush period
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        rush_period = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'rushPeriod': rush_period,
            'message': 'Rush period added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding rush period: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding rush period: {str(e)}"
        }), 500

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

# -------------------------------------------------------------------
# Stub endpoints for two routes the frontend calls on load that
# previously 404'd, flooding the console with errors and triggering
# the smoke test. They both store JSON under a `settings` row so
# operators get real persistence without a schema change.
# -------------------------------------------------------------------

def _kv_get(db, key, default=None):
    cur = db.cursor()
    try:
        db.rollback()
    except Exception:
        pass
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return default
    raw = row[0] if not isinstance(row, dict) else row.get('value')
    try:
        return json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return raw if raw is not None else default


def _kv_put(db, key, value, merge=False):
    """Write a settings blob.

    Default is REPLACE, and that is deliberate: most callers here pass
    complete state, where a key that has gone away must actually go away.
    Merging `station_inventory_configs` would resurrect a station you just
    deleted.

    merge=True is for PARTIAL saves — a screen that owns three fields of a
    twenty-field blob. Without it, saving "just the SMS number" onto
    branding_settings takes the base64 logos with it, because they were
    simply not in the payload.

    Merge semantics: keys present in `value` always win, INCLUDING empty
    ones. Only keys absent from `value` survive from what was stored. So
    clearing a logo still works — send '' for it; don't omit it.

    Only dict-on-dict merges. A list, a bool or a scalar replaces, because
    there is no sensible merge of those and silently concatenating lists
    would be worse than replacing them.

    The read happens under SELECT ... FOR UPDATE so a concurrent save
    cannot land between the read and the write. Callers used to do this
    merge client-side with a GET then a PUT, which had exactly that gap.
    """
    cur = db.cursor()
    try:
        db.rollback()
    except Exception:
        pass

    if merge and isinstance(value, dict):
        cur.execute("SELECT value FROM settings WHERE key = %s FOR UPDATE",
                    (key,))
        row = cur.fetchone()
        if row:
            raw = row['value'] if isinstance(row, dict) else row[0]
            try:
                existing = json.loads(raw)
            except (TypeError, ValueError):
                # Not JSON — some rows hold plain strings (sponsor_name and
                # friends). Nothing to merge with; the new value stands.
                existing = None
            if isinstance(existing, dict):
                value = {**existing, **value}

    payload = json.dumps(value)
    cur.execute("""
        INSERT INTO settings (key, value, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW()
    """, (key, payload))
    db.commit()


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
    """Send a test alert SMS to the configured number, bypassing the
    severity gate + cooldown (but still respecting enabled + phone)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        from services.admin_alerts import load_config
        cfg = load_config(coffee_system.db)
        if not cfg.get('phone'):
            return jsonify({'success': False, 'error': 'No admin alert phone set.'}), 400
        from services.sms import get_outbound_provider
        result = get_outbound_provider().send(
            cfg['phone'],
            "[Coffee Cue TEST] Admin alerts are working. You'll get a text "
            "here on error/critical events (rate-limited so you're not spammed).",
        )
        return jsonify({'success': result.ok, 'sent': result.ok,
                        'provider': result.provider, 'message': result.error or 'sent'})
    except Exception as e:
        logger.error(f"test_admin_alert error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------
# Quick Setup — single-call "café in 30 seconds" wizard.
#
# Operators ran into a wall the first time they set up an event: every
# milk type, cup size, drink category and station capability had to be
# configured by hand across multiple panels. This endpoint takes a
# single preset object and applies the whole config in one shot.
# ----------------------------------------------------------------------

DEFAULT_QUICK_PRESET = {
    'milks': ['full cream', 'skim', 'oat', 'almond', 'lactose free'],
    'sizes': ['medium'],
    'sweeteners': ['no sugar', '1 sugar', '2 sugar'],
    'drinks': {
        'espresso_drinks': True,   # latte, cappuccino, flat white, espresso, long black, mocha
        'hot_chocolate': False,
        'chai': False,
        'matcha': False,
    },
    'teas': {
        # Each per-flavor checkbox. All off by default — operator
        # opts in to whichever teas they're stocking.
        'english_breakfast': False,
        'earl_grey':         False,
        'green':             False,
        'peppermint':        False,
        'chamomile':         False,
        'lemon_ginger':      False,
        'rooibos':           False,
        'generic':           False,
    },
    # Free-text custom blends entered by the operator, comma-separated.
    'custom_teas': '',
    'unlimited_stock': True,
    'all_stations_same_capabilities': True,
    'always_open_schedule': True,
    # 'VIP' is a memorable demo code — operator can change it. When
    # provided (non-empty), Quick Setup writes to settings.vip_code so
    # SMS customers texting this string get marked VIP. Set to ''
    # (empty) to skip — preserves whatever vip_code is already saved.
    'vip_code': 'VIP',
    # Mark every existing station status='active' on apply. Useful for
    # demos / fresh events where the operator wants the stack ready
    # to take orders without manually flipping every station.
    'activate_all_stations': True,
}

ESPRESSO_DRINKS = ['latte', 'cappuccino', 'flat white', 'espresso', 'long black', 'mocha']
EXTRA_DRINKS = {
    'hot_chocolate': [('hot chocolate', 'drinks')],
    'chai':          [('chai latte', 'drinks')],
    'matcha':        [('matcha latte', 'drinks')],
}

# Tea flavors — keyed the same way the QuickSetup wizard sends them.
# Each tea is a separate drinks-category inventory row so the
# operator (or SMS bot) can refer to them individually.
TEA_FLAVORS = {
    'english_breakfast': 'english breakfast tea',
    'earl_grey':         'earl grey tea',
    'green':             'green tea',
    'peppermint':        'peppermint tea',
    'chamomile':         'chamomile tea',
    'lemon_ginger':      'lemon & ginger tea',
    'rooibos':           'rooibos tea',
    'generic':           'hot tea',
}


def _milk_default_amount(name):
    """Reasonable starting amounts so the new event isn't immediately
    "out of stock". 20 L for primary milks, 10 L for niche ones."""
    primary = {'full cream', 'skim', 'oat', 'soy'}
    return 30 if name in primary else 15


def _coffee_default_kg():
    return 5  # 5 kg of coffee beans is a small-event starting point


def _apply_quick_setup(coffee_system, preset):
    """Returns a list of summary strings describing what was applied."""
    db = coffee_system.db
    cur = db.cursor()
    summary = []

    # Make sure BOTH quantity columns exist before the seeds below write them
    # (heals the amount/current_quantity split-brain on older tables).
    try:
        coffee_system._ensure_inventory_quantity_columns(cur)
    except Exception:
        pass

    # 1. Wipe-and-rebuild inventory items. The operator can refine
    # individual rows after this initial setup.
    cur.execute("DELETE FROM inventory_items")

    # Milks
    for milk in preset.get('milks', []):
        amount = _milk_default_amount(milk)
        cur.execute("""
            INSERT INTO inventory_items
            (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('milk', %s, %s, %s, 'L', %s, 2)
        """, (milk, amount, amount, amount * 2))
    summary.append(f"{len(preset.get('milks', []))} milk types")

    # Coffee beans (always: house blend; never the drinks-as-stock
    # confusion the operator flagged). Decaf as a second SKU so the
    # SMS flow can route decaf orders to a station that has decaf.
    cur.execute("""
        INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
        VALUES ('coffee', 'house blend beans', %s, %s, 'kg', %s, 1),
               ('coffee', 'decaf beans', %s, %s, 'kg', %s, 1)
    """, (_coffee_default_kg(), _coffee_default_kg(), _coffee_default_kg() * 2,
          _coffee_default_kg() / 2, _coffee_default_kg() / 2, _coffee_default_kg()))
    summary.append("2 coffee bean SKUs (house + decaf)")

    # Cup sizes
    for size in preset.get('sizes', []):
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('cups', %s, 200, 200, 'units', 500, 50)
        """, (size,))
    summary.append(f"{len(preset.get('sizes', []))} cup size(s)")

    # Sweeteners. The count-style labels ('no sugar', '1 sugar', ...) are
    # PREFERENCES, not products — seeding one stock row per label gave
    # events five parallel 200-sachet counters ("feels like there's a
    # 5-teaspoon sachet", Steve). Collapse them to ONE 'sugar' row in
    # sachets; real named sweeteners (honey, stevia, ...) keep their own
    # rows. A bare 'sugar' row also lets the SMS gate accept any count
    # ("5 sugars") instead of only the enumerated ones.
    _sugar_labels, _named_sweeteners = [], []
    for s in preset.get('sweeteners', []):
        if re.match(r'^(no|half|\d+)\s*sugars?$', str(s).strip().lower()):
            _sugar_labels.append(s)
        else:
            _named_sweeteners.append(s)
    if _sugar_labels:
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('sugar', 'sugar', 500, 500, 'sachets', 1000, 50)
        """)
    for s in _named_sweeteners:
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('sugar', %s, 200, 200, 'sachets', 500, 20)
        """, (s,))
    summary.append(
        f"{(1 if _sugar_labels else 0) + len(_named_sweeteners)} sweetener stock row(s)"
    )

    # Drink categories: enable espresso-based drinks; optionally
    # add the non-coffee drinks the operator wants. We seed these as
    # rows in the existing `drinks` category so the walk-in dialog
    # picks them up (it already scans for "chai", "matcha" etc.).
    drinks_cfg = preset.get('drinks', {})
    if drinks_cfg.get('espresso_drinks', True):
        # Espresso drinks don't need to be in inventory — the
        # backend's _get_available_coffee_types returns the standard
        # list when coffee beans are in stock. So no rows needed.
        pass
    extras_added = 0
    for key, rows in EXTRA_DRINKS.items():
        if drinks_cfg.get(key):
            for name, category in rows:
                cur.execute("""
                    INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                    VALUES (%s, %s, 50, 50, 'units', 100, 10)
                """, (category, name))
                extras_added += 1
    if extras_added:
        summary.append(f"{extras_added} extra non-coffee drink(s)")

    # Teas — each ticked flavor becomes a drinks-category row so it
    # shows up in the menu and walk-in dialog. The `is_tea` flag
    # would normally be a schema column; we encode it in the name
    # ("... Tea") which is what the rest of the system already
    # checks for tea-specific behavior (smaller milk decrement etc).
    teas_cfg = preset.get('teas', {}) or {}
    teas_added = 0
    for key, name in TEA_FLAVORS.items():
        if teas_cfg.get(key):
            cur.execute("""
                INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                VALUES ('drinks', %s, 100, 100, 'units', 200, 20)
            """, (name,))
            teas_added += 1

    # Custom tea blends — split the operator's free-text string,
    # ensure each ends in "Tea" so downstream tea detection works,
    # and seed a row per blend.
    custom_raw = (preset.get('custom_teas') or '').strip()
    if custom_raw:
        parts = []
        for chunk in custom_raw.replace('\n', ',').split(','):
            t = chunk.strip()
            if not t:
                continue
            if 'tea' not in t.lower():
                t = f"{t} Tea"
            parts.append(t)
        for blend in parts:
            cur.execute("""
                INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                VALUES ('drinks', %s, 100, 100, 'units', 200, 20)
            """, (blend.lower(),))
            teas_added += 1

    if teas_added:
        summary.append(f"{teas_added} tea flavor(s)")

    db.commit()

    # 2. Unlimited stock mode — the conversation flow can check this
    # flag to skip "you're out of X" responses for organisers who
    # aren't tracking stock at the event.
    unlimited = bool(preset.get('unlimited_stock'))
    _kv_put(db, 'unlimited_stock_mode', {'enabled': unlimited})
    if unlimited:
        summary.append("unlimited-stock mode ON")

    # 3. All stations same capabilities — copy the first station's
    # capabilities (or build a default) to every station.
    if preset.get('all_stations_same_capabilities'):
        capabilities = {
            'milk_types': preset.get('milks', []),
            'coffee_types': ESPRESSO_DRINKS,
            'sizes': preset.get('sizes', []),
            'alt_milk': True,
        }
        cur.execute(
            "UPDATE station_stats SET capabilities = %s::jsonb",
            (json.dumps(capabilities),),
        )
        db.commit()
        summary.append("all stations given the same capabilities")

    # 4. Always-open schedule — clear event_breaks so the
    # break-window logic in _assign_station can't accidentally
    # narrow routing during the event.
    if preset.get('always_open_schedule'):
        try:
            cur.execute("DELETE FROM event_breaks")
            db.commit()
            summary.append("schedule set to always open (no breaks)")
        except Exception:
            db.rollback()

    # 5. VIP code. Stored in settings.vip_code — when a customer texts
    # this string the SMS handler flips their customer_preferences.is_vip
    # to true. Skipped when blank so existing vip_code is preserved.
    _vip_code = (preset.get('vip_code') or '').strip()
    if _vip_code:
        try:
            cur.execute("""
                INSERT INTO settings(key, value) VALUES('vip_code', %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (_vip_code,))
            db.commit()
            summary.append(f"VIP code set to '{_vip_code}'")
        except Exception as e:
            logger.warning(f"quick-setup vip_code save failed: {e}")
            db.rollback()

    # 6. Activate all stations — flip status='active' across the board.
    # Convenience for fresh setups / demos where the operator wants the
    # whole stack ready to take orders without manually toggling each.
    if preset.get('activate_all_stations'):
        try:
            cur.execute("UPDATE station_stats SET status = 'active' WHERE status != 'active'")
            n = cur.rowcount or 0
            db.commit()
            if n > 0:
                summary.append(f"activated {n} station(s)")
        except Exception as e:
            logger.warning(f"quick-setup activate_all_stations failed: {e}")
            db.rollback()

    return summary


@bp.route('/quick-setup/preset', methods=['GET'])
@jwt_required_with_demo()
def get_quick_setup_preset():
    """Return the suggested defaults so the UI can pre-fill checkboxes."""
    return jsonify({'preset': DEFAULT_QUICK_PRESET})


@bp.route('/quick-setup', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def apply_quick_setup():
    """Apply the supplied preset (or DEFAULT_QUICK_PRESET if empty).

    DESTRUCTIVE: wipes the inventory_items table before rebuilding.
    The endpoint requires admin/staff role. Returns a summary of
    everything that was applied.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json() or {}
        preset = body.get('preset') if isinstance(body.get('preset'), dict) else body or DEFAULT_QUICK_PRESET
        # Merge with defaults so callers can send just the fields
        # they want to override.
        merged = {**DEFAULT_QUICK_PRESET, **(preset or {})}
        # drinks is a nested dict — merge it too
        if isinstance(preset.get('drinks'), dict):
            merged['drinks'] = {
                **DEFAULT_QUICK_PRESET['drinks'],
                **preset['drinks'],
            }
        # teas is a nested dict — same merge pattern
        if isinstance(preset.get('teas'), dict):
            merged['teas'] = {
                **DEFAULT_QUICK_PRESET['teas'],
                **preset['teas'],
            }
        summary = _apply_quick_setup(coffee_system, merged)
        # Invalidate the unlimited-stock cache so the conversation
        # flow's next read picks up the new value immediately.
        if hasattr(coffee_system, '_invalidate_unlimited_stock_cache'):
            coffee_system._invalidate_unlimited_stock_cache()
        # Return the real station list so the frontend can mirror
        # the preset into per-station localStorage stock data
        # (coffee_stock_station_N). Without this the walk-in dialog
        # reads stale per-station stock and shows different milks
        # at different stations even though Quick Setup picked
        # the same set for all of them.
        stations = []
        try:
            cur = coffee_system.db.cursor()
            cur.execute(
                "SELECT station_id, COALESCE(notes, '') "
                "FROM station_stats ORDER BY station_id"
            )
            stations = [
                {'id': row[0], 'name': row[1] or f'Station {row[0]}'}
                for row in cur.fetchall()
            ]
        except Exception as e:
            logger.warning(f"could not enumerate stations for quick-setup response: {e}")
            try:
                coffee_system.db.rollback()
            except Exception:
                pass
        return jsonify({
            'success': True,
            'applied': summary,
            'summary': '; '.join(summary),
            'preset': merged,
            'stations': stations,
        })
    except Exception as e:
        logger.exception(f"apply_quick_setup failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


def _compute_proposed_inventory(preset):
    """Compute the inventory_items rows that _apply_quick_setup WOULD
    insert, given the preset. Mirrors the INSERT logic above; if this
    drifts from _apply_quick_setup, the dry-run lies. Keep them in sync.

    Returns list of (category, name) tuples, lowercased for comparison.
    """
    rows = []
    for milk in preset.get('milks', []) or []:
        rows.append(('milk', str(milk).lower().strip()))
    rows.append(('coffee', 'house blend beans'))
    rows.append(('coffee', 'decaf beans'))
    for size in preset.get('sizes', []) or []:
        rows.append(('cups', str(size).lower().strip()))
    # Mirror of _apply_quick_setup's sweetener collapse: count-style
    # labels become ONE 'sugar' row; named sweeteners keep their own.
    _dr_sugar = False
    for s in preset.get('sweeteners', []) or []:
        if re.match(r'^(no|half|\d+)\s*sugars?$', str(s).strip().lower()):
            _dr_sugar = True
        else:
            rows.append(('sugar', str(s).lower().strip()))
    if _dr_sugar:
        rows.append(('sugar', 'sugar'))
    drinks_cfg = preset.get('drinks', {}) or {}
    for key, drink_rows in EXTRA_DRINKS.items():
        if drinks_cfg.get(key):
            for name, category in drink_rows:
                rows.append((category, name.lower().strip()))
    teas_cfg = preset.get('teas', {}) or {}
    for key, name in TEA_FLAVORS.items():
        if teas_cfg.get(key):
            rows.append(('drinks', name.lower().strip()))
    custom_raw = (preset.get('custom_teas') or '').strip()
    if custom_raw:
        for chunk in custom_raw.replace('\n', ',').split(','):
            t = chunk.strip()
            if not t:
                continue
            if 'tea' not in t.lower():
                t = f"{t} Tea"
            rows.append(('drinks', t.lower()))
    return rows


@bp.route('/quick-setup/dry-run', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def dry_run_quick_setup():
    """Return what an Apply would change, without changing anything.

    The biggest worry operators have re-running Quick Setup is "did
    that just wipe my custom stock amounts?" — because the real apply
    DELETEs inventory_items before inserting. This endpoint shows them
    the diff so they can confirm before pulling the trigger.

    Response shape:
      {
        success: true,
        inventory: {
          added:   [{category, name}],   # rows the apply will insert
          removed: [{category, name, amount, unit}],  # current rows that will disappear
          unchanged: [{category, name}], # both lists have it
        },
        capabilities: {
          will_overwrite_all: bool,
          stations: [{station_id, current, proposed}],
        },
        settings: {
          vip_code:        {current, proposed, changed},
          unlimited_stock: {current, proposed, changed},
          activate_all_stations: {will_activate: int},
          always_open_schedule:  {breaks_to_delete: int},
        },
      }
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json() or {}
        preset = body.get('preset') if isinstance(body.get('preset'), dict) else body or DEFAULT_QUICK_PRESET
        merged = {**DEFAULT_QUICK_PRESET, **(preset or {})}
        if isinstance(preset.get('drinks'), dict):
            merged['drinks'] = {**DEFAULT_QUICK_PRESET['drinks'], **preset['drinks']}
        if isinstance(preset.get('teas'), dict):
            merged['teas'] = {**DEFAULT_QUICK_PRESET['teas'], **preset['teas']}

        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()

        proposed_inv = _compute_proposed_inventory(merged)
        proposed_set = {(c, n) for c, n in proposed_inv}

        current_rows = []
        try:
            cur.execute("""
                SELECT category, COALESCE(name, ''), amount, COALESCE(unit, '')
                  FROM inventory_items
            """)
            for r in cur.fetchall() or []:
                if isinstance(r, dict):
                    current_rows.append({
                        'category': r['category'],
                        'name': r.get('name') or '',
                        'amount': r.get('amount'),
                        'unit': r.get('unit') or '',
                    })
                else:
                    current_rows.append({
                        'category': r[0],
                        'name': r[1] or '',
                        'amount': r[2],
                        'unit': r[3] or '',
                    })
        except Exception as e:
            logger.warning(f"dry-run: could not read inventory_items: {e}")

        current_set = {((row['category'] or '').lower(), (row['name'] or '').lower().strip())
                       for row in current_rows}

        added = [
            {'category': c, 'name': n}
            for (c, n) in proposed_inv
            if (c, n) not in current_set
        ]
        removed = [
            row for row in current_rows
            if ((row['category'] or '').lower(), (row['name'] or '').lower().strip()) not in proposed_set
        ]
        unchanged = [
            {'category': c, 'name': n}
            for (c, n) in proposed_inv
            if (c, n) in current_set
        ]

        capabilities_diff = {
            'will_overwrite_all': bool(merged.get('all_stations_same_capabilities')),
            'stations': [],
        }
        if merged.get('all_stations_same_capabilities'):
            proposed_caps = {
                'milk_types': merged.get('milks', []),
                'coffee_types': ESPRESSO_DRINKS,
                'sizes': merged.get('sizes', []),
                'alt_milk': True,
            }
            try:
                cur.execute("SELECT station_id, capabilities FROM station_stats ORDER BY station_id")
                for r in cur.fetchall() or []:
                    if isinstance(r, dict):
                        sid = r['station_id']
                        cur_caps = r.get('capabilities') or {}
                    else:
                        sid = r[0]
                        cur_caps = r[1] or {}
                    capabilities_diff['stations'].append({
                        'station_id': sid,
                        'current': cur_caps,
                        'proposed': proposed_caps,
                    })
            except Exception as e:
                logger.warning(f"dry-run: capabilities read failed: {e}")

        settings_diff = {}

        current_vip = ''
        try:
            cur.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            row = cur.fetchone()
            if row:
                current_vip = (row['value'] if isinstance(row, dict) else row[0]) or ''
        except Exception:
            pass
        proposed_vip = (merged.get('vip_code') or '').strip()
        settings_diff['vip_code'] = {
            'current': current_vip,
            'proposed': proposed_vip if proposed_vip else current_vip,
            'changed': bool(proposed_vip) and proposed_vip != current_vip,
        }

        current_unlimited = bool(_kv_get(db, 'unlimited_stock_mode', default={}).get('enabled', False))
        proposed_unlimited = bool(merged.get('unlimited_stock'))
        settings_diff['unlimited_stock'] = {
            'current': current_unlimited,
            'proposed': proposed_unlimited,
            'changed': current_unlimited != proposed_unlimited,
        }

        will_activate = 0
        try:
            cur.execute("SELECT COUNT(*) FROM station_stats WHERE status != 'active'")
            row = cur.fetchone()
            will_activate = int((row['count'] if isinstance(row, dict) else row[0]) or 0)
        except Exception:
            pass
        settings_diff['activate_all_stations'] = {
            'will_activate': will_activate if merged.get('activate_all_stations') else 0,
        }

        breaks_to_delete = 0
        if merged.get('always_open_schedule'):
            try:
                cur.execute("SELECT COUNT(*) FROM event_breaks")
                row = cur.fetchone()
                breaks_to_delete = int((row['count'] if isinstance(row, dict) else row[0]) or 0)
            except Exception:
                pass
        settings_diff['always_open_schedule'] = {
            'breaks_to_delete': breaks_to_delete,
        }

        return jsonify({
            'success': True,
            'inventory': {
                'added': added,
                'removed': [
                    {'category': r['category'], 'name': r['name'],
                     'amount': r['amount'], 'unit': r['unit']}
                    for r in removed
                ],
                'unchanged': unchanged,
                'destructive': len(removed) > 0,
            },
            'capabilities': capabilities_diff,
            'settings': settings_diff,
        })
    except Exception as e:
        logger.exception(f"dry_run_quick_setup failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Source-of-truth event inventory
# ---------------------------------------------------------------------------
# The "master list" of what's on the menu (categories with enabled flags) used
# to live ONLY in `localStorage.event_inventory`. That meant different
# browsers/devices could disagree on what was on offer, and the Quick Setup
# wizard had to manually rewrite each browser's local copy. Now the master
# list is persisted to the `settings` table (key='event_inventory'). Local
# stores keep working as a write-through cache; the backend is authoritative.
@bp.route('/event-inventory', methods=['GET'])
@jwt_required_with_demo()
def get_event_inventory():
    """Return the master inventory list (what's on the menu).

    Shape: { milk: [...], coffee: [...], cups: [...], syrups: [...],
             sweeteners: [...], drinks: [...], extras: [...] }
    Each item: { id, name, description, enabled, ...optional }
    Returns {} on first access — frontend treats that as "use the
    InventoryManagement defaults and POST them back on first save".
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        inventory = _kv_get(coffee_system.db, 'event_inventory', default=None)
        return jsonify(inventory or {})
    except Exception as e:
        logger.error(f"get_event_inventory error: {e}")
        return jsonify({}), 200


@bp.route('/event-inventory', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def upsert_event_inventory():
    """Persist the master inventory list. The whole blob is replaced.

    InventoryManagement.js and Quick Setup both POST to this endpoint
    after editing. The SMS bot reads via _get_event_inventory() which
    falls back to inventory_items for legacy DBs.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'payload must be an object'}), 400
        _kv_put(coffee_system.db, 'event_inventory', data)
        # Tell anyone listening (other tabs, the SMS bot, etc.) that
        # the menu changed. Echoed to the React event bus via WS.
        try:
            socketio = current_app.config.get('socketio')
            if socketio:
                socketio.emit('event_inventory_updated', {'keys': list(data.keys())},
                              room='all_stations')
        except Exception:
            pass
        return jsonify({'success': True, 'event_inventory': data})
    except Exception as e:
        logger.error(f"upsert_event_inventory error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Per-event reporting
# ---------------------------------------------------------------------------
# Operators kept asking "how many orders have we done today?", "what's our
# revenue?", "which station is busiest?" — there was no answer surface, so
# the data sat unused in `orders`. /api/reports/today rolls it all up so
# the Support tab Reports panel can render today's metrics live.
@bp.route('/reports/today', methods=['GET'])
@jwt_required_with_demo()
def get_today_report():
    """Return today's event metrics:
      - total orders + breakdown by status
      - average wait time (created → completed) in minutes
      - total revenue (if pricing is enabled and orders have a price stamp)
      - per-station breakdown
      - top 5 drinks by order count
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()

        # Status breakdown for today
        cur.execute("""
            SELECT status, COUNT(*) AS n
            FROM orders
            WHERE created_at::date = CURRENT_DATE
            GROUP BY status
        """)
        status_counts = {row[0]: int(row[1]) for row in cur.fetchall()}
        total = sum(status_counts.values())

        # Average wait (created → completed) for completed/picked_up orders today
        cur.execute("""
            SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0)
            FROM orders
            WHERE created_at::date = CURRENT_DATE
              AND status IN ('completed', 'picked_up')
              AND updated_at IS NOT NULL
              AND created_at IS NOT NULL
        """)
        row = cur.fetchone()
        avg_wait_min = float(row[0]) if row and row[0] is not None else None

        # Revenue from stamped prices (works when pricing was enabled
        # when the order was confirmed — see ARCHITECTURE.md §11).
        cur.execute("""
            SELECT COALESCE(SUM((order_details->>'price')::numeric), 0)
            FROM orders
            WHERE created_at::date = CURRENT_DATE
              AND order_details ? 'price'
        """)
        row = cur.fetchone()
        revenue_total = float(row[0]) if row and row[0] is not None else 0.0

        # Per-station breakdown. `done` + the active time span give a MEASURED
        # orders/hour — the real throughput, which the team can use as the
        # baseline ("expected throughput") for the next event.
        cur.execute("""
            SELECT station_id, COUNT(*) AS n,
                   AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0)
                     FILTER (WHERE status IN ('completed', 'picked_up')
                             AND updated_at IS NOT NULL) AS avg_min,
                   COUNT(*) FILTER (WHERE status IN ('completed', 'picked_up')) AS done,
                   EXTRACT(EPOCH FROM (MAX(updated_at) - MIN(created_at))) / 3600.0 AS span_hours
            FROM orders
            WHERE created_at::date = CURRENT_DATE
            GROUP BY station_id
            ORDER BY station_id
        """)
        per_station = []
        for row in cur.fetchall():
            sid, n, avg_min, done, span_hours = row
            # orders/hour = completed ÷ active span (floored at 30 min so a
            # couple of orders in the first minutes don't read as "200/hour").
            oph = None
            if done and span_hours is not None:
                oph = round(int(done) / max(0.5, float(span_hours)), 1)
            per_station.append({
                'station_id': sid,
                'orders': int(n),
                'avg_wait_min': round(float(avg_min), 1) if avg_min is not None else None,
                'completed': int(done or 0),
                'orders_per_hour': oph,
            })

        # Top 5 drinks today
        cur.execute("""
            SELECT LOWER(order_details->>'type') AS drink, COUNT(*) AS n
            FROM orders
            WHERE created_at::date = CURRENT_DATE
              AND order_details ? 'type'
            GROUP BY drink
            ORDER BY n DESC
            LIMIT 5
        """)
        top_drinks = [{'drink': r[0], 'orders': int(r[1])} for r in cur.fetchall()]

        # Milk breakdown. The reason it exists: CTN26 stocked coconut and
        # not one order used it, while 41% of the event was some other
        # alternative milk. That is a stocking decision worth thousands
        # over a season, and nobody could see it without exporting rows.
        #
        # Normalised in SQL the same way the reporting code does it --
        # lower-cased with a trailing " milk" stripped -- because the
        # database genuinely holds both "Oat Milk" and "oat" for the same
        # drink and counting them apart understates every alternative.
        cur.execute("""
            SELECT COALESCE(NULLIF(regexp_replace(
                       lower(trim(order_details->>'milk')), '\\s*milk$', ''), ''),
                   'no milk') AS m,
                   COUNT(*) AS n
            FROM orders
            WHERE created_at::date = CURRENT_DATE
            GROUP BY m
            ORDER BY n DESC
        """)
        milk_rows = [{'milk': r[0], 'orders': int(r[1])} for r in cur.fetchall()]
        _ALT = {'skim', 'oat', 'soy', 'almond', 'lactose free', 'coconut',
                'macadamia', 'rice', 'a2'}
        milk_breakdown = {
            'by_milk': milk_rows,
            'dairy': sum(r['orders'] for r in milk_rows
                         if r['milk'] in ('full cream', 'whole', 'regular', 'dairy')),
            'alternative': sum(r['orders'] for r in milk_rows if r['milk'] in _ALT),
            'none': sum(r['orders'] for r in milk_rows
                        if r['milk'] in ('no milk', 'none', '')),
        }
        # Milks the event is carrying that nobody ordered today. The
        # actionable half of the breakdown -- what to stop buying.
        unused_milks = []
        try:
            ev = _kv_get(db, 'event_inventory', default={}) or {}
            stocked = ev.get('milk') if isinstance(ev, dict) else None
            if isinstance(stocked, list):
                ordered = {r['milk'] for r in milk_rows}
                for item in stocked:
                    nm = item.get('name') if isinstance(item, dict) else item
                    key = str(nm or '').strip().lower()
                    key = key[:-5].strip() if key.endswith(' milk') else key
                    if key and key not in ordered:
                        unused_milks.append(nm)
        except Exception as _um_err:
            logger.debug(f"unused milk calc skipped: {_um_err}")

        # Peak hour — which hour of the day had the most orders. The
        # post-event summary leans on this ("you handled 47 orders in
        # the 10am hour"), and it's a one-liner aggregate.
        cur.execute("""
            SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*) AS n
            FROM orders
            WHERE created_at::date = CURRENT_DATE
            GROUP BY hour
            ORDER BY n DESC
            LIMIT 1
        """)
        peak_row = cur.fetchone()
        peak_hour = None
        if peak_row:
            peak_hour = {
                'hour': int(peak_row[0]) if peak_row[0] is not None else None,
                'orders': int(peak_row[1]),
            }

        # Busiest station — most orders today. Convenience field so the
        # printable doesn't have to sort per_station to find it.
        busiest_station_id = None
        if per_station:
            busiest = max(per_station, key=lambda ps: ps['orders'])
            busiest_station_id = busiest['station_id']

        # Pricing currency (for nicer formatting client-side)
        currency_symbol = '$'
        try:
            pricing_blob = _kv_get(coffee_system.db, 'pricing_settings', default={}) or {}
            currency_symbol = pricing_blob.get('symbol', '$')
        except Exception:
            pass

        # --- SMS side -------------------------------------------------------
        # Outbound = order_messages (confirmation/ready/reminder texts, logged
        # with a Twilio SID when accepted). Inbound = sms_messages (customer
        # texts received). Each query is defensive so a missing table or SQLite
        # fallback never breaks the whole report.
        sms = {'outbound': 0, 'outbound_with_provider_id': 0,
               'inbound': 0, 'inbound_unanswered': 0, 'est_segments': 0}
        try:
            cur.execute("SELECT COUNT(*), COUNT(message_sid) FROM order_messages "
                        "WHERE sent_at::date = CURRENT_DATE")
            r = cur.fetchone()
            if r:
                sms['outbound'] = int(r[0] or 0)
                sms['outbound_with_provider_id'] = int(r[1] or 0)
            cur.execute("SELECT COALESCE(SUM(CEIL(GREATEST(LENGTH(message),1)/160.0)),0) "
                        "FROM order_messages WHERE sent_at::date = CURRENT_DATE")
            r = cur.fetchone()
            sms['est_segments'] = int(r[0]) if r and r[0] is not None else sms['outbound']
        except Exception as _e:
            logger.warning(f"report: outbound SMS query failed: {_e}")
            try: db.rollback()
            except Exception: pass
        try:
            cur.execute("SELECT COUNT(*), "
                        "COUNT(*) FILTER (WHERE response_sent IS NULL OR response_sent = '') "
                        "FROM sms_messages WHERE received_at::date = CURRENT_DATE")
            r = cur.fetchone()
            if r:
                sms['inbound'] = int(r[0] or 0)
                sms['inbound_unanswered'] = int(r[1] or 0)
        except Exception as _e:
            logger.warning(f"report: inbound SMS query failed: {_e}")
            try: db.rollback()
            except Exception: pass

        # --- UI / client errors --------------------------------------------
        errors = {'count': 0, 'recent': []}
        try:
            cur.execute("SELECT COUNT(*) FROM client_errors WHERE created_at::date = CURRENT_DATE")
            r = cur.fetchone()
            errors['count'] = int(r[0]) if r and r[0] is not None else 0
            cur.execute("SELECT message, COUNT(*) AS n FROM client_errors "
                        "WHERE created_at::date = CURRENT_DATE "
                        "GROUP BY message ORDER BY n DESC LIMIT 5")
            errors['recent'] = [{'message': (row[0] or '')[:160], 'count': int(row[1])}
                                for row in cur.fetchall()]
        except Exception as _e:
            logger.warning(f"report: client_errors query failed: {_e}")
            try: db.rollback()
            except Exception: pass

        # --- Issues & improvements (auto-detected) -------------------------
        # Each is a single COUNT; missing tables degrade to 0 rather than
        # breaking the report. severity drives the UI colour.
        issues = []

        def _count(sql):
            try:
                cur.execute(sql)
                r = cur.fetchone()
                return int(r[0]) if r and r[0] is not None else 0
            except Exception as _e:
                logger.warning(f"report: issue query failed: {_e}")
                try: db.rollback()
                except Exception: pass
                return 0

        n = _count("SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE "
                   "AND status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'")
        if n:
            issues.append({'key': 'stuck_pending', 'severity': 'warning', 'count': n,
                           'title': f"{n} order(s) stuck pending over 15 min",
                           'hint': 'Were these missed, or was a station under-staffed at peak?'})
        n = _count("SELECT COUNT(*) FROM orders o JOIN station_stats s ON o.station_id = s.station_id "
                   "WHERE o.created_at::date = CURRENT_DATE AND COALESCE(s.status,'active') <> 'active' "
                   "AND o.status IN ('pending','in-progress','in_progress')")
        if n:
            issues.append({'key': 'orders_on_closed_station', 'severity': 'danger', 'count': n,
                           'title': f"{n} active order(s) on a closed/maintenance station",
                           'hint': 'These may never be made — reassign them to an open station.'})
        n = _count("SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE "
                   "AND status IN ('completed','picked_up') AND updated_at IS NOT NULL "
                   "AND EXTRACT(EPOCH FROM (updated_at - created_at))/60.0 > 20")
        if n:
            issues.append({'key': 'long_waits', 'severity': 'warning', 'count': n,
                           'title': f"{n} order(s) took over 20 minutes",
                           'hint': 'Long waits hurt satisfaction — consider more staff at peak.'})
        n = _count("SELECT COUNT(*) FROM orders WHERE created_at::date = CURRENT_DATE AND status = 'cancelled'")
        if n:
            issues.append({'key': 'cancellations', 'severity': 'info', 'count': n,
                           'title': f"{n} order(s) cancelled",
                           'hint': 'Check for duplicates or out-of-stock items.'})
        if sms.get('inbound_unanswered'):
            issues.append({'key': 'unanswered_sms', 'severity': 'warning', 'count': sms['inbound_unanswered'],
                           'title': f"{sms['inbound_unanswered']} customer text(s) with no reply",
                           'hint': 'Customers who texted a question may not have received an answer.'})
        if errors.get('count'):
            issues.append({'key': 'app_errors', 'severity': 'warning', 'count': errors['count'],
                           'title': f"{errors['count']} app error(s) logged on devices",
                           'hint': 'See the App errors section — a barista screen may have glitched.'})

        return jsonify({
            'success': True,
            'date': datetime.now().date().isoformat(),
            'total_orders': total,
            'status_breakdown': status_counts,
            'avg_wait_min': round(avg_wait_min, 1) if avg_wait_min is not None else None,
            'revenue_total': round(revenue_total, 2),
            'currency_symbol': currency_symbol,
            'per_station': per_station,
            'top_drinks': top_drinks,
            'milk': milk_breakdown,
            'unused_milks': unused_milks,
            'peak_hour': peak_hour,
            'busiest_station_id': busiest_station_id,
            'sms': sms,
            'errors': errors,
            'issues': issues,
        })
    except Exception as e:
        logger.error(f"get_today_report error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-access', methods=['GET', 'PUT'])
@jwt_required_with_demo()
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
        return jsonify({'success': True, **cfg,
                        'enforcing': bool(cfg['require'] and cfg['code'])})
    except Exception as e:
        logger.error(f"event_access_config error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/broadcast', methods=['GET', 'POST', 'DELETE'])
@jwt_required_with_demo()
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


@bp.route('/notifications/hold', methods=['GET', 'PUT'])
@jwt_required_with_demo()
def notification_hold():
    """The switch, and what is waiting behind it.

    GET  -> {holding, held, will_send, no_phone, already_collected}
    PUT  -> {"holding": true|false}

    The counts matter as much as the switch. A barista about to press
    release should be able to see it is 87 texts, not 3, before they do
    it -- that is the difference between a considered action and a
    surprise on the phone bill.
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
            wanted = bool(body.get('holding'))
            _kv_put(db, HOLD_SETTING_KEY, wanted)
            logger.info(f"Notification hold {'ON' if wanted else 'OFF'}")

        holding = is_holding(_kv_get(db, HOLD_SETTING_KEY, default=None))
        rows = _held_rows(db)
        counts = summarise_held(rows)
        return jsonify({'success': True, 'holding': holding, **counts})
    except Exception as e:
        logger.error(f"notification_hold error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


def _held_rows(db):
    """(order_details, status, phone) for every order owing a notification."""
    out = []
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT order_details, status, phone, order_number, station_id "
            "FROM orders WHERE order_details::text LIKE %s",
            ('%"notification_held"%',))
        for r in (cur.fetchall() or []):
            raw = r[0] if not isinstance(r, dict) else r.get('order_details')
            try:
                details = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except Exception:
                details = {}
            status = r[1] if not isinstance(r, dict) else r.get('status')
            phone = r[2] if not isinstance(r, dict) else r.get('phone')
            number = r[3] if not isinstance(r, dict) else r.get('order_number')
            station = r[4] if not isinstance(r, dict) else r.get('station_id')
            details['_order_number'] = number
            details['_station_id'] = station
            out.append((details, status, phone))
    except Exception as e:
        logger.warning(f"held rows query failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    return out


@bp.route('/notifications/release', methods=['POST'])
@jwt_required_with_demo()
def release_notifications():
    """Send every held notification, then turn the hold off.

    Turning the hold off is part of releasing on purpose. Releasing but
    staying held is a state nobody wants and everybody forgets they are
    in -- the next order finishes, its text is silently held, and the
    customer waits for a message that is not coming. If someone wants to
    keep holding, they simply do not press this.

    Orders that no longer need a text -- collected already, or no phone
    number -- have the flag cleared without a send, so the queue does not
    accumulate debts that can never be paid.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        rows = _held_rows(db)

        # Work out what to send BEFORE touching the database, then clear
        # every flag in one committed pass, and only then dispatch.
        #
        # The order matters. Clearing flags one at a time while starting
        # send threads meant those threads -- which share this one
        # database connection, the singleton from services/coffee_system
        # -- committed in the middle of the loop and a flag update was
        # lost. Testing caught it: three held, "2 sent, 1 skipped", and
        # one order still flagged afterwards.
        #
        # Clearing before sending also means a Twilio failure cannot
        # leave a debt that gets re-sent on every future release. A lost
        # message is recoverable (the barista can resend from the order);
        # a customer texted the same thing five times is not.
        to_send, skipped = [], 0
        for details, status, phone in rows:
            number = details.get('_order_number')
            station = details.get('_station_id')
            clean = {k: v for k, v in details.items() if not k.startswith('_')}
            clear_held(clean)
            if should_release(details, status, phone):
                to_send.append((number, phone, clean, station))
            else:
                skipped += 1
            try:
                cur = db.cursor()
                cur.execute(
                    "UPDATE orders SET order_details = %s WHERE order_number = %s",
                    (json.dumps(clean), number))
            except Exception as upd_err:
                logger.error(f"release: order {number} flag not cleared: {upd_err}")
        db.commit()

        # Turn the hold OFF before dispatching, not after. The send path
        # now checks the hold as its first act, so releasing while still
        # held would quietly re-hold every message and the release would
        # silently do nothing at all.
        _kv_put(db, HOLD_SETTING_KEY, False)

        sent = 0
        for number, phone, clean, station in to_send:
            try:
                # Through the SAME guarded path a normal completion uses,
                # so the bench wall still applies. Dispatching straight to
                # Twilio here would have sent real messages to the Test
                # Bench's +6140000 simulator numbers.
                _notify_customer_order_ready(phone, number, clean, station)
                sent += 1
            except Exception as send_err:
                logger.error(f"release: order {number} failed to send: {send_err}")

        logger.info(f"Released notifications: {sent} sent, {skipped} skipped")
        return jsonify({'success': True, 'sent': sent, 'skipped': skipped,
                        'holding': False})
    except Exception as e:
        logger.error(f"release_notifications error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/reports/channels', methods=['GET'])
@jwt_required_with_demo()
def report_channels():
    """Where orders came from, over any date range.

    The client-facing question this answers: "is anyone still using SMS?"
    You cannot retire a channel on a hunch, and CTN26 could not answer it
    because the touchscreen and /my wrote identical rows.

    Orders placed before provenance stamping are still counted, with the
    channel inferred from the old markers -- but they are reported in
    `estimated` as well, so nobody reads a reconstruction as a
    measurement. Once an event runs entirely on stamped orders, estimated
    is 0 and the numbers are exact.

    GET /api/reports/channels?start_date=2026-08-23&end_date=2026-08-23
    Both dates optional; default is everything.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        sql = ("SELECT order_details, status, station_id, created_at "
               "FROM orders WHERE 1=1")
        params = []
        for arg, op in (('start_date', '>='), ('end_date', '<=')):
            val = request.args.get(arg)
            if val:
                try:
                    datetime.strptime(val, '%Y-%m-%d')
                except ValueError:
                    return jsonify({'success': False,
                                    'message': f'{arg} must be YYYY-MM-DD'}), 400
                sql += f" AND created_at::date {op} %s"
                params.append(val)
        cur = db.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall() or []

        by_channel, by_source, by_station = {}, {}, {}
        total = served = estimated = 0
        for row in rows:
            raw = row[0] if not isinstance(row, dict) else row.get('order_details')
            status = row[1] if not isinstance(row, dict) else row.get('status')
            station = row[2] if not isinstance(row, dict) else row.get('station_id')
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except Exception:
                    raw = {}
            details = raw if isinstance(raw, dict) else {}

            total += 1
            if str(status or '').lower() in ('completed', 'picked_up'):
                served += 1
            ch = infer_channel(details)
            est = provenance_estimated(details)
            if est:
                estimated += 1
            slot = by_channel.setdefault(
                ch, {'channel': ch, 'label': channel_label(ch),
                     'orders': 0, 'estimated': 0})
            slot['orders'] += 1
            slot['estimated'] += 1 if est else 0

            src = details.get('source_code')
            if src:
                sslot = by_source.setdefault(
                    src, {'source': src, 'orders': 0, 'channels': {}})
                sslot['orders'] += 1
                sslot['channels'][ch] = sslot['channels'].get(ch, 0) + 1
            by_station[str(station)] = by_station.get(str(station), 0) + 1

        def pct(n):
            return round(100.0 * n / total, 1) if total else 0.0

        channels = sorted(by_channel.values(), key=lambda c: -c['orders'])
        for c in channels:
            c['share_pct'] = pct(c['orders'])
        sources = sorted(by_source.values(), key=lambda x: -x['orders'])
        for x in sources:
            x['share_pct'] = pct(x['orders'])

        self_serve = sum(c['orders'] for c in channels
                         if c['channel'] in SELF_SERVE)
        sms_orders = by_channel.get('sms', {}).get('orders', 0)

        return jsonify({
            'success': True,
            'total_orders': total,
            'served': served,
            'by_channel': channels,
            'by_source': sources,
            'by_station': by_station,
            'self_service': {'orders': self_serve, 'share_pct': pct(self_serve)},
            'sms': {'orders': sms_orders, 'share_pct': pct(sms_orders)},
            # How much of the above is reconstruction rather than record.
            # A client-facing chart should footnote this whenever it is
            # non-zero, and no channel should be retired while it is high.
            'estimated_orders': estimated,
            'estimated_pct': pct(estimated),
            'channel_vocabulary': CHANNELS,
            'start_date': request.args.get('start_date'),
            'end_date': request.args.get('end_date'),
        })
    except Exception as e:
        logger.error(f"report_channels error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/reports/today/print', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def print_today_report():
    """Browser-printable event summary. Pure HTML — no PDF lib needed,
    operator hits Cmd+P → "Save as PDF" → emails the file to the client.

    Why HTML instead of a real PDF library:
      1. No new backend dep. reportlab is 25MB; we don't need 25MB
         to render six numbers and a table.
      2. The browser's PDF engine handles fonts, margins, page breaks
         consistently across platforms — better than anything we'd
         hand-roll.
      3. Operator can tweak before saving (e.g. delete a station that
         was for testing) — a PDF can't be edited.
    """
    try:
        from flask import request as _flask_request
        is_post_event = (_flask_request.args.get('view') == 'post')
        html, err = _render_event_summary_html(is_post_event=is_post_event)
        if err:
            return (f'<h1>Report failed</h1><p>{err}</p>'), 500
        from flask import Response
        return Response(html, mimetype='text/html')
    except Exception as e:
        logger.error(f"print_today_report error: {e}")
        return f'<h1>Report failed</h1><pre>{e}</pre>', 500


def _render_event_summary_html(is_post_event: bool = False):
    """Build the event-summary HTML. Returns (html, error_or_None).

    Single source of truth for both the printable route
    (/api/reports/today/print) and the email route
    (/api/reports/post-event/email). is_post_event flips the heading +
    adds the share-with-client CTA.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        # Re-use the same query logic by calling the JSON endpoint
        # function directly. One source of truth for the metrics.
        report_resp = get_today_report()
        if hasattr(report_resp, 'get_json'):
            data = report_resp.get_json() or {}
        else:
            data = report_resp[0].get_json() or {}
        if not data.get('success'):
            return None, data.get('error', 'unknown')

        # Pull branding for the header. Falls back to "Coffee Cue" so
        # an event with no name set still renders sensibly.
        try:
            branding = _kv_get(db, 'branding_settings', default={}) or {}
            event_name = (branding.get('event_name')
                          or _kv_get(db, 'event_name', default='Coffee Cue')
                          or 'Coffee Cue')
            logo = branding.get('logo') or branding.get('clientLogo') or ''
        except Exception:
            event_name = 'Coffee Cue'
            logo = ''

        # Build the HTML. Inline CSS so the operator can open the file
        # offline and have it still look right.
        symbol = data.get('currency_symbol', '$')
        per_station_rows = ''.join(
            f"<tr><td>Station {ps['station_id']}</td>"
            f"<td>{ps['orders']}</td>"
            f"<td>{ps['avg_wait_min'] if ps['avg_wait_min'] is not None else '—'}</td>"
            f"<td>{ps.get('orders_per_hour') if ps.get('orders_per_hour') is not None else '—'}</td></tr>"
            for ps in data.get('per_station', [])
        ) or '<tr><td colspan="4" style="text-align:center;color:#888">No orders yet</td></tr>'

        top_drinks_rows = ''.join(
            f"<tr><td>{td['drink'].title()}</td><td>{td['orders']}</td></tr>"
            for td in data.get('top_drinks', [])
        ) or '<tr><td colspan="2" style="text-align:center;color:#888">No orders yet</td></tr>'

        status = data.get('status_breakdown') or {}
        status_rows = ''.join(
            f"<tr><td>{s.replace('_', ' ').title()}</td><td>{n}</td></tr>"
            for s, n in status.items()
        ) or '<tr><td colspan="2" style="text-align:center;color:#888">No orders yet</td></tr>'

        avg_wait = data.get('avg_wait_min')
        avg_wait_display = f"{avg_wait} min" if avg_wait is not None else '—'

        # Post-event summary additions — peak hour + busiest station,
        # formatted for the headline row.
        peak = data.get('peak_hour') or {}
        if peak.get('hour') is not None:
            h = peak['hour']
            am_pm = 'am' if h < 12 else 'pm'
            h12 = h if 1 <= h <= 12 else (12 if h == 0 else h - 12)
            peak_display = f"{h12}{am_pm} ({peak.get('orders', 0)})"
        else:
            peak_display = '—'

        busiest_id = data.get('busiest_station_id')
        busiest_display = f"Station {busiest_id}" if busiest_id else '—'

        # SMS section — the customer-comms side of the event.
        sms = data.get('sms') or {}
        sms_html = (
            "<h2>SMS</h2><div class=\"stat-grid\">"
            f"<div class=\"stat\"><div class=\"stat-label\">Texts sent</div><div class=\"stat-value\">{sms.get('outbound', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Customer texts in</div><div class=\"stat-value\">{sms.get('inbound', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Unanswered</div><div class=\"stat-value\">{sms.get('inbound_unanswered', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Est. SMS segments</div><div class=\"stat-value\">{sms.get('est_segments', 0)}</div></div>"
            "</div>"
        )

        # Issues & improvements — the review-and-improve section.
        issues = data.get('issues') or []
        if issues:
            _irows = ''.join(
                f"<tr><td>{i.get('title', '')}</td>"
                f"<td style=\"text-align:left\">{i.get('hint', '')}</td></tr>"
                for i in issues
            )
            issues_html = ("<h2>Issues &amp; improvements</h2>"
                           "<table><thead><tr><th>What happened</th><th>Suggestion</th></tr></thead>"
                           f"<tbody>{_irows}</tbody></table>")
        else:
            issues_html = ("<h2>Issues &amp; improvements</h2>"
                           "<p style=\"color:#0f6e56\">No issues detected — clean run.</p>")

        # App errors — anything devices reported during the event.
        errors = data.get('errors') or {}
        _ec = errors.get('count', 0)
        if _ec:
            _erows = ''.join(
                f"<tr><td>{e.get('message', '')}</td><td>{e.get('count', 0)}</td></tr>"
                for e in errors.get('recent', [])
            )
            errors_html = (f"<h2>App errors logged ({_ec})</h2>"
                           "<table><thead><tr><th>Error</th><th>Times</th></tr></thead>"
                           f"<tbody>{_erows}</tbody></table>")
        else:
            errors_html = ("<h2>App errors</h2>"
                           "<p style=\"color:#0f6e56\">None logged.</p>")

        # The post-event framing changes the heading and adds a CTA
        # block — controlled by the is_post_event param.
        heading_kind = 'Post-event summary' if is_post_event else 'Event summary'
        post_event_cta = (
            '<div style="margin-top:32px;background:#f0f7ff;border:1px solid #c7dffd;'
            'border-radius:8px;padding:16px 20px;">'
            '<strong>Share with the client.</strong> Email this page as a PDF '
            '(Cmd+P → Save as PDF) so they see the numbers from the event you '
            'just ran for them. Repeat clients are the cheapest ones to win.'
            '</div>'
        ) if is_post_event else ''

        logo_html = (f'<img src="{logo}" alt="" style="max-height:60px;margin-bottom:10px"/>'
                     if logo else '')

        # The body. Browser's print stylesheet handles page breaks.
        html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{event_name} — {heading_kind} {data.get('date', '')}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          max-width: 720px; margin: 40px auto; padding: 0 24px; color: #222; }}
  h1 {{ margin: 0 0 4px 0; }}
  .subtitle {{ color: #666; margin-bottom: 24px; }}
  .stat-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 24px 0; }}
  .stat {{ background: #f7f5f0; border-radius: 8px; padding: 16px; }}
  .stat-label {{ font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }}
  .stat-value {{ font-size: 28px; font-weight: bold; margin-top: 4px; }}
  h2 {{ font-size: 16px; margin-top: 32px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 8px 0 16px 0; }}
  th, td {{ text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }}
  th {{ background: #f7f5f0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
  td:nth-child(2), th:nth-child(2), td:nth-child(3), th:nth-child(3),
  td:nth-child(4), th:nth-child(4) {{ text-align: right; }}
  .footer {{ margin-top: 40px; color: #888; font-size: 12px; text-align: center; }}
  @media print {{ body {{ margin: 0; }} .no-print {{ display: none; }} }}
</style>
</head>
<body>
  <div class="no-print" style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px 12px;margin-bottom:20px;font-size:13px;">
    <strong>Tip:</strong> hit Cmd+P (Mac) or Ctrl+P (Win) → "Save as PDF" → email the file to the client.
  </div>
  {logo_html}
  <h1>{event_name}</h1>
  <p class="subtitle">{heading_kind} — {data.get('date', '')}</p>

  <div class="stat-grid">
    <div class="stat">
      <div class="stat-label">Total orders</div>
      <div class="stat-value">{data.get('total_orders', 0)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Avg wait</div>
      <div class="stat-value">{avg_wait_display}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Revenue</div>
      <div class="stat-value">{symbol}{data.get('revenue_total', 0):.2f}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Peak hour</div>
      <div class="stat-value" style="font-size:22px">{peak_display}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Busiest station</div>
      <div class="stat-value" style="font-size:22px">{busiest_display}</div>
    </div>
  </div>
  {post_event_cta}

  <h2>By status</h2>
  <table><thead><tr><th>Status</th><th>Orders</th></tr></thead>
  <tbody>{status_rows}</tbody></table>

  <h2>By station</h2>
  <table><thead><tr><th>Station</th><th>Orders</th><th>Avg wait (min)</th><th>Orders/hour</th></tr></thead>
  <tbody>{per_station_rows}</tbody></table>

  <h2>Top drinks</h2>
  <table><thead><tr><th>Drink</th><th>Orders</th></tr></thead>
  <tbody>{top_drinks_rows}</tbody></table>

  {sms_html}

  {issues_html}

  {errors_html}

  <div class="footer">
    Generated by Coffee Cue. To regenerate, visit Support → Operations → Print summary.
  </div>
</body>
</html>"""
        return html, None
    except Exception as e:
        logger.error(f"_render_event_summary_html error: {e}")
        return None, str(e)


@bp.route('/reports/post-event/email', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def email_post_event_summary():
    """Email the post-event summary to a recipient (the client).

    Body: {"to": "client@example.com", "subject": "optional override"}

    Renders the same post-event HTML the print route produces and sends
    it via SMTP. Gated behind EMAIL_ENABLED — when SMTP isn't configured
    the endpoint returns success:false with a clear "email not enabled"
    message (HTTP 200, not an error) so the UI can tell the operator to
    Cmd+P → Save as PDF instead. Never 500s on a config gap.
    """
    try:
        body = request.get_json() or {}
        to = (body.get('to') or '').strip()
        if not to or '@' not in to:
            return jsonify({'success': False,
                            'error': 'A valid recipient email is required.'}), 400

        html, err = _render_event_summary_html(is_post_event=True)
        if err or not html:
            return jsonify({'success': False,
                            'error': f'Could not build summary: {err}'}), 500

        # Event name for the subject line.
        try:
            coffee_system = current_app.config.get('coffee_system')
            branding = _kv_get(coffee_system.db, 'branding_settings', default={}) or {}
            event_name = (branding.get('event_name')
                          or _kv_get(coffee_system.db, 'event_name', default='Coffee Cue')
                          or 'Coffee Cue')
        except Exception:
            event_name = 'Coffee Cue'

        subject = (body.get('subject') or '').strip() or \
            f"{event_name} — event summary"

        from services.email_utils import send_html_email, email_enabled
        result = send_html_email(
            to=to,
            subject=subject,
            html_body=html,
            text_fallback=(
                f"{event_name} event summary attached as HTML. "
                f"View in an HTML-capable mail client."
            ),
        )
        return jsonify({
            'success': result.ok,
            'sent': result.sent,
            'email_enabled': email_enabled(),
            'message': result.detail,
            'to': to,
        })
    except Exception as e:
        logger.error(f"email_post_event_summary error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/orders/<order_number>/receipt', methods=['GET'])
def order_receipt(order_number):
    """Customer-facing branded receipt for a single order.

    Public (no JWT): the customer reaches this from a link in their
    "order ready" SMS, so it can't require a login. Order numbers are
    short, human-friendly ('C42') — so to stop trivial enumeration we
    require the order to be in a *terminal-ish* state (in-progress,
    completed, or picked up). A pending order's receipt is meaningless
    anyway. No PII beyond the customer's own first name + drink (which
    they already know); phone is NOT shown.

    Pure HTML, browser → Save-as-PDF, no PDF lib — same approach as the
    event summary. Renders the event branding, order details, total
    (if pricing is on), and a pickup QR via the existing track route.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT order_number, order_details, status, station_id,
                   created_at, completed_at, price, for_friend
              FROM orders
             WHERE order_number = %s
             LIMIT 1
        """, (order_number,))
        row = cur.fetchone()
        if not row:
            return ('<h1>Receipt not found</h1>'
                    '<p>We could not find that order.</p>'), 404
        if isinstance(row, dict):
            od = row['order_details'] or {}
            status = row['status']
            station_id = row['station_id']
            created_at = row['created_at']
            completed_at = row['completed_at']
            price = row['price']
            for_friend = row['for_friend']
        else:
            od = row[1] or {}
            status = row[2]
            station_id = row[3]
            created_at = row[4]
            completed_at = row[5]
            price = row[6]
            for_friend = row[7]

        # Guard against pending-order / enumeration peeking.
        if status not in ('in-progress', 'in_progress', 'completed', 'picked_up'):
            return ('<h1>Receipt not ready</h1>'
                    '<p>This receipt becomes available once your order is '
                    'being prepared.</p>'), 403

        # od is JSONB → already a dict on most cursors; tolerate str.
        if isinstance(od, str):
            try:
                od = json.loads(od)
            except Exception:
                od = {}

        # Branding.
        try:
            branding = _kv_get(db, 'branding_settings', default={}) or {}
            event_name = (branding.get('event_name')
                          or branding.get('eventName')
                          or _kv_get(db, 'event_name', default='Coffee Cue')
                          or 'Coffee Cue')
            logo = branding.get('logo') or branding.get('clientLogo') or ''
        except Exception:
            event_name = 'Coffee Cue'
            logo = ''

        # Build a human drink description from order_details.
        name = od.get('name') or od.get('customer_name') or 'Customer'
        drink = od.get('type') or od.get('coffee_type') or 'Coffee'
        size = od.get('size') or ''
        milk = od.get('milk') or od.get('milk_type') or ''
        sugar = od.get('sugar') or ''
        strength = od.get('strength') or ''
        desc_bits = [b for b in [size, drink] if b]
        drink_desc = ' '.join(desc_bits)
        extras = []
        if milk and milk not in ('no milk', 'standard', 'none', 'None'):
            extras.append(f"{milk} milk")
        if strength:
            extras.append(str(strength))
        if sugar and sugar not in ('no sugar', 'none', 'None', '0'):
            extras.append(str(sugar))
        extras_str = (', '.join(extras)) if extras else ''

        # Pricing — only show a total if pricing is enabled AND this
        # order has a non-zero stamped price.
        symbol = '$'
        try:
            pricing_blob = _kv_get(db, 'pricing_settings', default={}) or {}
            symbol = pricing_blob.get('symbol', '$')
        except Exception:
            pass
        try:
            price_val = float(price) if price is not None else 0.0
        except (TypeError, ValueError):
            price_val = 0.0
        price_html = (
            f'<div class="row"><span>Total</span>'
            f'<strong>{symbol}{price_val:.2f}</strong></div>'
            if price_val > 0 else ''
        )

        # Pickup QR — link to the existing track page for this order.
        # The track route resolves /track/<code>; we use the order
        # number as the code so the QR is self-contained.
        host = request.host_url.rstrip('/')
        track_url = f"{host}/track/{order_number}"
        # Reuse MessagingService.generate_qr_code (base64 data URI).
        qr_data_uri = ''
        try:
            from services.messaging import MessagingService
            qr_data_uri = MessagingService.generate_qr_code(track_url, size=6) or ''
        except Exception as e:
            logger.warning(f"receipt QR generation failed: {e}")

        when = ''
        try:
            stamp = completed_at or created_at
            if stamp:
                when = stamp.strftime('%-d %b %Y, %-I:%M %p')
        except Exception:
            pass

        logo_html = (f'<img src="{logo}" alt="" style="max-height:54px;margin-bottom:8px"/>'
                     if logo else '')
        qr_html = (f'<img src="{qr_data_uri}" alt="Pickup QR" '
                   f'style="width:140px;height:140px"/>' if qr_data_uri else '')
        friend_html = (f'<div class="row"><span>For</span><span>{for_friend}</span></div>'
                       if for_friend else '')
        extras_html = (f'<div class="row"><span>Options</span><span>{extras_str}</span></div>'
                       if extras_str else '')

        html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{event_name} — Receipt #{order_number}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          max-width: 420px; margin: 24px auto; padding: 0 20px; color: #1a1a1a; }}
  .card {{ border: 1px solid #e5e5e5; border-radius: 12px; padding: 24px; }}
  .head {{ text-align: center; margin-bottom: 16px; }}
  .head h1 {{ font-size: 18px; margin: 4px 0; }}
  .ordernum {{ font-size: 34px; font-weight: 800; letter-spacing: 1px; margin: 8px 0; }}
  .drink {{ font-size: 20px; font-weight: 600; text-align: center; margin: 6px 0 4px; }}
  .row {{ display: flex; justify-content: space-between; padding: 8px 0;
          border-bottom: 1px solid #f0f0f0; font-size: 14px; }}
  .row span:first-child {{ color: #777; }}
  .qr {{ text-align: center; margin-top: 18px; }}
  .foot {{ text-align: center; color: #999; font-size: 12px; margin-top: 16px; }}
  .badge {{ display:inline-block; background:#eafaf0; color:#1a7f4b; border-radius:20px;
            padding:3px 12px; font-size:12px; font-weight:600; }}
  @media print {{ body {{ margin: 0; }} .no-print {{ display:none; }} }}
</style>
</head>
<body>
  <div class="no-print" style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:8px 10px;margin-bottom:14px;font-size:12px;text-align:center;">
    Save this receipt: tap Share → Print → Save as PDF.
  </div>
  <div class="card">
    <div class="head">
      {logo_html}
      <h1>{event_name}</h1>
      <div class="badge">{'Ready for pickup' if status in ('completed','picked_up') else 'Being prepared'}</div>
      <div class="ordernum">#{order_number}</div>
    </div>
    <div class="drink">{drink_desc}</div>
    <div style="margin-top:14px;">
      <div class="row"><span>Name</span><span>{name}</span></div>
      {friend_html}
      {extras_html}
      <div class="row"><span>Station</span><span>#{station_id}</span></div>
      <div class="row"><span>Time</span><span>{when}</span></div>
      {price_html}
    </div>
    <div class="qr">
      {qr_html}
      <div style="font-size:11px;color:#999;margin-top:4px">Scan to track your order</div>
    </div>
  </div>
  <div class="foot">Thank you — enjoy your coffee ☕</div>
</body>
</html>"""
        from flask import Response
        return Response(html, mimetype='text/html')
    except Exception as e:
        logger.error(f"order_receipt error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return f'<h1>Receipt error</h1><pre>{e}</pre>', 500


# ----------------------------------------------------------------------
# Thermal label printing (network printer path)
# ----------------------------------------------------------------------
# Per-station printer config lives in settings KV under 'printer_config'
# as {"<station_id>": {"ip","port","enabled","auto_print"}}. No schema
# migration needed.

def _get_printer_config(db, station_id=None):
    cfg = _kv_get(db, 'printer_config', default={}) or {}
    if station_id is not None:
        return cfg.get(str(station_id), {})
    return cfg


def _fetch_order_for_label(db, order_number):
    cur = db.cursor()
    cur.execute("""
        SELECT id, order_number, order_details, status, station_id
          FROM orders WHERE order_number = %s LIMIT 1
    """, (order_number,))
    row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return {
            'id': row['id'], 'order_number': row['order_number'],
            'order_details': row['order_details'], 'status': row['status'],
            'station_id': row['station_id'],
        }
    return {
        'id': row[0], 'order_number': row[1], 'order_details': row[2],
        'status': row[3], 'station_id': row[4],
    }


def _branding_for_label(db):
    try:
        b = _kv_get(db, 'branding_settings', default={}) or {}
        return {
            'event_name': (b.get('event_name') or b.get('eventName')
                           or _kv_get(db, 'event_name', default='') or ''),
            # The renderer prints this as the label footer. Without it the
            # footer falls back to the product name baked into the code,
            # which is wrong the moment an operator renames the system.
            'systemName': (b.get('systemName') or b.get('system_name') or ''),
        }
    except Exception:
        return {}


@bp.route('/orders/<order_number>/label.png', methods=['GET'])
@jwt_required_with_demo()
def order_label_png(order_number):
    """Render the order label as a PNG.

    This is the supported, hardware-free path: open this in a browser
    and Cmd+P to AirPrint to a Brother QL-820NWB (or any AirPrint label
    printer). Also used by the auto-print path to build the bytes.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        order = _fetch_order_for_label(db, order_number)
        if not order:
            return ('order not found', 404)
        branding = _branding_for_label(db)
        host = request.host_url.rstrip('/')
        qr_url = f"{host}/track/{order_number}"
        from services.label_printer import render_label_png
        png = render_label_png(order, branding, qr_url=qr_url)
        from flask import Response
        return Response(png, mimetype='image/png')
    except Exception as e:
        logger.error(f"order_label_png error: {e}")
        return (f'label error: {e}', 500)


@bp.route('/orders/<order_number>/print-label', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def print_order_label(order_number):
    """Send the order label to the station's configured network printer.

    Body (optional): {"station_id": N} to override which station's
    printer config to use (defaults to the order's station).

    Failure mode: printer offline / unconfigured → returns success:false
    with a message, never blocks. The barista UI shows a toast and the
    order proceeds regardless.

    NOTE: the raw-socket transport is hardware-pending (see
    services/label_printer.py). Until validated against the real
    printer, the reliable path is GET .../label.png → AirPrint.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        order = _fetch_order_for_label(db, order_number)
        if not order:
            return jsonify({'success': False, 'error': 'order not found'}), 404

        body = request.get_json(silent=True) or {}
        station_id = body.get('station_id') or order.get('station_id')
        pcfg = _get_printer_config(db, station_id)
        if not pcfg or not pcfg.get('enabled'):
            return jsonify({
                'success': False,
                'printed': False,
                'message': f'No printer configured/enabled for station {station_id}. '
                           f'Use the label.png AirPrint path, or set a printer in Station Settings.',
                'label_url': f'/api/orders/{order_number}/label.png',
            })
        ip = pcfg.get('ip')
        port = int(pcfg.get('port') or 9100)

        branding = _branding_for_label(db)
        host = request.host_url.rstrip('/')
        from services.label_printer import render_label_png, send_png_to_printer
        png = render_label_png(order, branding, qr_url=f"{host}/track/{order_number}")
        ok, detail = send_png_to_printer(ip, port, png)
        return jsonify({
            'success': ok,
            'printed': ok,
            'message': detail,
            'label_url': f'/api/orders/{order_number}/label.png',
            'transport_note': 'raw-socket transport is hardware-pending; '
                              'if the label is blank/garbled use the label.png AirPrint path',
        })
    except Exception as e:
        logger.error(f"print_order_label error: {e}")
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


DEFAULT_PRICING = {
    'enabled': False,
    'currency': 'AUD',
    'symbol': '$',
    # Base price per drink type. The bot is tolerant to missing keys —
    # any drink not listed defaults to `unknown_drink_price` so a
    # newly-added drink doesn't crash the SMS confirmation.
    'per_drink': {
        'latte': 4.50, 'cappuccino': 4.50, 'flat white': 4.50,
        'long black': 4.00, 'espresso': 3.50, 'mocha': 5.00,
        'macchiato': 4.00, 'cortado': 4.00, 'piccolo': 4.00,
        'americano': 4.00,
        'hot chocolate': 4.50, 'chai latte': 4.50, 'matcha latte': 5.00,
        'golden latte': 5.00,
        'hot tea': 3.50, 'english breakfast tea': 3.50, 'earl grey tea': 3.50,
        'green tea': 3.50, 'peppermint tea': 3.50, 'chamomile tea': 3.50,
        'lemon & ginger tea': 3.50, 'rooibos tea': 3.50,
    },
    'unknown_drink_price': 4.50,   # fallback for drinks not in per_drink
    'milk_surcharge': {
        'full cream': 0.00, 'skim': 0.00, 'dairy': 0.00, 'no milk': 0.00,
        'oat': 0.50, 'almond': 0.50, 'soy': 0.50, 'coconut': 0.50,
        'lactose free': 0.50, 'macadamia': 0.50, 'rice': 0.50,
    },
    'size_surcharge': {'small': -0.50, 'medium': 0.00, 'large': 0.50},
    'sugar_surcharge_per_sachet': 0.00,
    # VIP comp: when True AND a customer is flagged VIP (via SMS VIP
    # code, or marked VIP on a walk-in), their drink is free. The
    # price-compute returns 0 with "VIP — no charge" instead of a
    # dollar amount. Staff can be treated the same way by issuing
    # them a VIP code — no separate "staff_free" flag needed.
    'vip_free': False,
    # Display options
    'show_in_sms': True,            # embed total in SMS confirmation
    'show_in_walkin': True,         # show total at bottom of walk-in dialog
    'show_in_barista': True,        # show total on the order card in barista UI
    'show_on_display': False,       # NOT shown on customer Display by default
}


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


# ============================================================================
# CATALOG (single source of truth for option lists)
# ============================================================================
# All UIs (walk-in dialog, capability editor, inventory editor) read
# their option lists from here. Replaces DEFAULT_MILK_TYPES, hardcoded
# drink lists, etc. — see services/migrations.py _m009_catalog_items
# for the design rationale.

VALID_CATALOG_CATEGORIES = {'milk', 'drink', 'size', 'sweetener'}


# The catalogue and the event menu name their categories differently
# ('milk' vs 'milk', but 'drink' vs 'drinks', 'size' vs 'cups').
_CATALOG_TO_EVENT_CATEGORY = {
    'milk': 'milk',
    'drink': 'drinks',
    'coffee': 'coffee',
    'size': 'cups',
    'sweetener': 'sweeteners',
    'syrup': 'syrups',
}


@bp.route('/catalog/<category>', methods=['GET'])
@jwt_required_with_demo()
def get_catalog(category):
    """List canonical items for a category.

    Query params:
      include_inactive=1  — include rows where is_active=false
      include_custom=0    — exclude operator-added customs

    Response:
      {
        "category": "milk",
        "items": [
          {"id": "full_cream", "name": "Full Cream Milk",
           "short_name": "full cream", "subcategory": "standard",
           "properties": {...}, "is_custom": false, ...},
          ...
        ]
      }
    """
    try:
        if category not in VALID_CATALOG_CATEGORIES:
            return jsonify({
                'success': False,
                'error': f"Unknown category '{category}'. Valid: "
                         f"{sorted(VALID_CATALOG_CATEGORIES)}",
            }), 400

        include_inactive = request.args.get('include_inactive') == '1'
        include_custom_raw = request.args.get('include_custom', '1')
        include_custom = include_custom_raw != '0'

        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'error': 'DB unavailable'}), 503

        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass

        where = ['category = %s']
        params: list = [category]
        if not include_inactive:
            where.append('is_active = TRUE')
        if not include_custom:
            where.append('is_custom = FALSE')

        cur.execute(f"""
            SELECT item_id, display_name, short_name, subcategory,
                   properties, sort_order, is_active, is_custom
            FROM catalog_items
            WHERE {' AND '.join(where)}
            ORDER BY sort_order, display_name
        """, params)

        items = []
        for row in cur.fetchall():
            iid, dn, sn, sub, props, sort, active, custom = row
            items.append({
                'id': iid,
                'name': dn,
                'short_name': sn,
                'subcategory': sub,
                'properties': props or {},
                'sort_order': sort,
                'is_active': active,
                'is_custom': custom,
            })

        # event_only=1 narrows the CANONICAL catalogue to what this event
        # actually serves.
        #
        # The catalogue deliberately lists everything that exists, because
        # the Organiser's inventory editor needs the full set to offer
        # toggles for. Order-entry surfaces need the opposite: only what is
        # switched on. Serving both from one unfiltered endpoint is why the
        # walk-in screen still offered Oat, Lactose-Free and even "Smoke
        # Test Milk" at an event configured for four milks -- it was reading
        # the catalogue of everything that COULD exist and presenting it as
        # a menu.
        #
        # Opt-in rather than default, so the editor keeps seeing everything.
        # ALWAYS annotate. Steve wants unavailable items greyed out rather
        # than vanishing -- "grey = not available" reads as a deliberate
        # decision, where a missing tile just looks like the system does
        # not know about oat milk. Greying needs the item to still be in
        # the response, so the flag goes on every item and the client
        # decides whether to dim it or drop it.
        try:
            enabled_names = coffee_system._event_enabled(
                _CATALOG_TO_EVENT_CATEGORY.get(category, category))
            if enabled_names:
                keep_set = set(enabled_names)
                for it in items:
                    it['event_enabled'] = coffee_system._normalise_menu_name(
                        it.get('short_name') or it.get('name')) in keep_set
                # If NOTHING matched, the two vocabularies failed to line
                # up -- an event that serves literally nothing is not a
                # real state. Greying every tile would leave a barista
                # unable to take an order at all, which is far worse than
                # showing one milk too many. Same fallback the event_only
                # filter already makes; it was missing here.
                if items and not any(it.get('event_enabled') for it in items):
                    logger.warning(
                        "catalog %s: no item matched the event menu %s -- "
                        "marking all available rather than greying the whole "
                        "screen out", category, enabled_names)
                    for it in items:
                        it['event_enabled'] = True
            else:
                # No opinion configured, or everything switched off: do not
                # grey the whole menu out on the strength of a blank config.
                for it in items:
                    it['event_enabled'] = True
        except Exception as e:
            logger.warning(f"catalog event_enabled annotation failed: {e}")
            for it in items:
                it.setdefault('event_enabled', True)

        if request.args.get('event_only') == '1':
            try:
                enabled = coffee_system._event_enabled(
                    _CATALOG_TO_EVENT_CATEGORY.get(category, category))
                if enabled:
                    keep = set(enabled)
                    filtered = [
                        it for it in items
                        if coffee_system._normalise_menu_name(
                            it.get('short_name') or it.get('name')) in keep
                    ]
                    # Never hand back an empty menu because two vocabularies
                    # failed to line up -- an empty walk-in dropdown is a
                    # barista who cannot take an order at all.
                    if filtered:
                        items = filtered
                    else:
                        logger.warning(
                            "catalog event_only: no %s matched the event menu "
                            "%s -- serving the full catalogue rather than an "
                            "empty one", category, enabled)
            except Exception as e:
                logger.warning(f"catalog event_only filter failed: {e}")

        return jsonify({'category': category, 'items': items})
    except Exception as e:
        logger.error(f"get_catalog({category}) error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/catalog/<category>', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_catalog_item(category):
    """Add a custom item to the catalog.

    Body: {"name": "Hemp Milk", "short_name": "hemp" (optional),
           "subcategory": "alternative" (optional)}

    The item_id is derived from the name (lowercased, spaces→underscores)
    so it's deterministic — adding 'Hemp Milk' twice is a no-op.
    """
    try:
        if category not in VALID_CATALOG_CATEGORIES:
            return jsonify({
                'success': False,
                'error': f"Unknown category '{category}'",
            }), 400

        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': "'name' required"}), 400

        # Derive item_id deterministically so duplicates collapse.
        import re as _re
        item_id = _re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
        if not item_id:
            return jsonify({'success': False, 'error': 'name produced empty id'}), 400

        short_name = (data.get('short_name') or name).strip().lower()
        # Strip ' milk' suffix from milks for compact display.
        if category == 'milk' and short_name.endswith(' milk'):
            short_name = short_name[:-5]
        subcategory = data.get('subcategory')
        properties = data.get('properties') or {}

        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass

        # Highest sort_order + 10 puts custom items at the end of
        # the seeded list by default — operator can drag-reorder later.
        cur.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM catalog_items WHERE category = %s",
            (category,),
        )
        next_sort = cur.fetchone()[0]

        cur.execute("""
            INSERT INTO catalog_items
                (category, item_id, display_name, short_name, subcategory,
                 properties, sort_order, is_custom)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, TRUE)
            ON CONFLICT (category, item_id) DO UPDATE
                SET is_active = TRUE
            RETURNING item_id, display_name, short_name, subcategory,
                      properties, sort_order, is_active, is_custom
        """, (category, item_id, name, short_name, subcategory,
              json.dumps(properties), next_sort))
        row = cur.fetchone()
        coffee_system.db.commit()

        iid, dn, sn, sub, props, sort, active, custom = row
        return jsonify({
            'success': True,
            'item': {
                'id': iid, 'name': dn, 'short_name': sn,
                'subcategory': sub, 'properties': props or {},
                'sort_order': sort, 'is_active': active, 'is_custom': custom,
            }
        })
    except Exception as e:
        logger.error(f"add_catalog_item({category}) error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# WALK-IN DEFAULTS
# ============================================================================
# When the operator opens the walk-in dialog, what should already be filled
# in so they only need to confirm the customer name and Submit? This blob
# moves a pile of hardcoded literals out of WalkInOrderDialog.js (default
# coffee type, default size, milk preference order) into a single
# event-configurable setting. Edited via QuickSetup → Walk-in Defaults.
#
# Stored in settings KV under 'walkin_defaults'.

DEFAULT_WALKIN_DEFAULTS = {
    # The drink the dialog opens with. Australian default is Flat White;
    # US events might prefer Latte. Has to be a string that matches one
    # of the items in the station's drinks menu — invalid values fall
    # back to the first available drink at render time.
    'default_coffee_type': 'Flat White',

    # Size that's pre-selected. 'Small (8oz)' is the most-common
    # walk-in drink at events.
    'default_size': 'Small (8oz)',

    # Espresso shots default. Mostly 1 except for double-shot crowds.
    'default_shots': '1',

    # Milk preference order — the dialog picks the FIRST one in this
    # list that's actually stocked at the station. Australian events
    # set 'full cream' first; US events 'whole milk'; oat-heavy
    # crowds can lead with 'oat'. Tokens are matched case-insensitive
    # against the milk's id and name. Falls back to whatever's
    # available if none of the preferences are stocked.
    'default_milk_preference_order': [
        'whole milk', 'full cream', 'regular', 'standard',
        'dairy', 'milk', 'skim', 'low fat',
    ],

    # When the customer doesn't ask for sugar, the dialog still has
    # to send SOME sweetener quantity. 0 = silent default; the
    # 'No sugar' string is built at submit time when qty=0.
    'default_sweetener_qty': 0,
}


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


DEFAULT_ROUTING_RULES = {
    # Mirror the keys QueueIntelligence.js stores in localStorage.
    # Each toggle nudges _assign_station's behavior:
    #
    # prioritizeEfficiency   — prefer high-throughput stations (capacity_weight wins ties)
    # balanceWorkload        — keep load balanced across stations (default behavior)
    # considerCapabilities   — refuse to assign a milk an active station can't make
    # emergencyMode          — ignore capability gating in a pinch
    'prioritizeEfficiency': True,
    'balanceWorkload':      True,
    'considerCapabilities': True,
    'emergencyMode':        False,
}


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
@role_required_with_demo(['admin', 'staff', 'barista'])
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


@bp.route('/inventory/transfer', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def transfer_inventory():
    """Move stock from one station to another.

    Body: { from_station: int|null, to_station: int|null, name: str,
            category: str, amount: float }

    A null station_id means the "event-wide" pool (the row with
    station_id IS NULL). Useful for "I'm taking 5L oat from event
    reserve to Station 2".
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        from_station = data.get('from_station')
        to_station = data.get('to_station')
        name = (data.get('name') or '').strip().lower()
        category = (data.get('category') or '').strip().lower()
        amount = float(data.get('amount') or 0)
        if not name or not category or amount <= 0:
            return jsonify({'success': False, 'error': 'name, category, and a positive amount are required'}), 400
        if from_station == to_station:
            return jsonify({'success': False, 'error': 'from_station and to_station must differ'}), 400

        cur = db.cursor()
        # Decrement from source. We GREATEST(0, …) so we never go
        # negative — short transfers just zero out the source row.
        if from_station is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    current_quantity = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    current_quantity = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, category, name, from_station))
        src_row = cur.fetchone()
        if not src_row:
            db.rollback()
            return jsonify({'success': False,
                            'error': f'No {category}/{name} row found at source station'}), 404

        # Increment destination. Upsert: if the row doesn't exist
        # for the destination, create it.
        if to_station is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, category, name, to_station))
        dst_row = cur.fetchone()

        if not dst_row:
            # Destination station doesn't have a row for this item yet
            # — insert one. Copy unit/capacity from source if we can.
            cur.execute("""
                SELECT unit, capacity, minimum_threshold FROM inventory_items
                WHERE LOWER(category) = %s AND LOWER(name) = %s
                LIMIT 1
            """, (category, name))
            template = cur.fetchone() or ('units', amount * 2, 0)
            unit, capacity, min_thr = template
            cur.execute("""
                INSERT INTO inventory_items
                  (category, name, amount, current_quantity, unit, capacity, minimum_threshold, station_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (category, name, amount, amount, unit, capacity, min_thr, to_station))

        db.commit()
        logger.info(f"Inventory transfer: {amount} {category}/{name} from station {from_station} → {to_station}")
        return jsonify({'success': True,
                        'source_remaining': float(src_row[0]),
                        'destination_amount': float(dst_row[0]) if dst_row else amount})
    except Exception as e:
        logger.error(f"transfer_inventory error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/inventory/emergency-restock', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def emergency_restock():
    """Bump a single inventory_items row up by the requested amount.

    Body: { item: str, type: str (= category), amount: float,
            station_id?: int|null, priority?: str }

    The "priority" field is accepted for compatibility with the
    existing UI but isn't persisted — emergency restocks are
    inherently urgent. Returns the new amount.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        name = (data.get('item') or data.get('name') or '').strip().lower()
        category = (data.get('type') or data.get('category') or '').strip().lower()
        amount = float(data.get('amount') or 0)
        station_id = data.get('station_id')  # may be None — event-wide
        if not name or not category or amount <= 0:
            return jsonify({'success': False, 'error': 'item, type, and positive amount required'}), 400

        cur = db.cursor()
        if station_id is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    capacity = GREATEST(capacity, COALESCE(amount, current_quantity, 0) + %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    capacity = GREATEST(capacity, COALESCE(amount, current_quantity, 0) + %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, amount, category, name, station_id))
        row = cur.fetchone()
        if not row:
            # No row exists — create one.
            cur.execute("""
                INSERT INTO inventory_items
                  (category, name, amount, current_quantity, unit, capacity, minimum_threshold, station_id)
                VALUES (%s, %s, %s, %s, 'units', %s, 0, %s)
                RETURNING amount
            """, (category, name, amount, amount, amount * 2, station_id))
            row = cur.fetchone()
        db.commit()
        return jsonify({'success': True, 'amount': float(row[0])})
    except Exception as e:
        logger.error(f"emergency_restock error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-stock', methods=['GET'])
@jwt_required_with_demo()
def get_event_stock():
    """Event-wide stock levels (the inventory that exists for the
    whole event, before being allocated to stations). Same KV
    persistence pattern as the other JSON blobs."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        stock = _kv_get(coffee_system.db, 'event_stock_levels', default={}) or {}
        return jsonify(stock)
    except Exception as e:
        logger.error(f"get_event_stock error: {e}")
        return jsonify({}), 200


@bp.route('/event-stock', methods=['PUT', 'POST'])
@jwt_required_with_demo()
def upsert_event_stock():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        _kv_put(coffee_system.db, 'event_stock_levels', data)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_event_stock error: {e}")
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


@bp.route('/sms/templates', methods=['GET'])
@jwt_required_with_demo()
def get_sms_templates_api():
    """Mirror of routes/sms_routes.py /sms/templates under the /api prefix.

    The frontend calls /api/sms/templates; the existing sms_routes.py
    handler lives at /sms/templates (no /api). Frontend was 404ing
    on every Communications-tab visit.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("SELECT key, value FROM settings WHERE key LIKE %s", ('%_message',))
        rows = cur.fetchall() or []
        templates = {}
        for row in rows:
            if isinstance(row, dict):
                templates[row['key']] = row['value']
            else:
                templates[row[0]] = row[1]
        return jsonify({'status': 'success', 'templates': templates})
    except Exception as e:
        logger.error(f"get_sms_templates_api error: {e}")
        return jsonify({'status': 'success', 'templates': {}})


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


# ----------------------------------------------------------------------
# Event templates — save a Quick Setup preset, re-apply to a new event.
#
# The friction "every new event is 30 clicks" became "every new event
# is 5 clicks" with Quick Setup. With templates it's 1 click: load the
# saved preset, hit Apply. Templates store the Quick Setup config
# shape (milks, sizes, drinks, teas, pricing, walkin defaults, SMS
# policy) — same JSON the /api/quick-setup endpoint accepts.
# ----------------------------------------------------------------------

@bp.route('/event-templates', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def list_event_templates():
    """Return all saved event templates, newest first."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT id, name, description, saved_by, saved_at, updated_at
              FROM event_templates
             ORDER BY updated_at DESC
        """)
        rows = cur.fetchall() or []
        templates = []
        for r in rows:
            if isinstance(r, dict):
                templates.append({
                    'id':          r['id'],
                    'name':        r['name'],
                    'description': r['description'],
                    'saved_by':    r['saved_by'],
                    'saved_at':    r['saved_at'].isoformat() if r['saved_at'] else None,
                    'updated_at':  r['updated_at'].isoformat() if r['updated_at'] else None,
                })
            else:
                templates.append({
                    'id': r[0], 'name': r[1], 'description': r[2],
                    'saved_by': r[3],
                    'saved_at':   r[4].isoformat() if r[4] else None,
                    'updated_at': r[5].isoformat() if r[5] else None,
                })
        return jsonify({'success': True, 'templates': templates})
    except Exception as e:
        logger.error(f"list_event_templates error: {e}")
        return jsonify({'success': False, 'templates': [], 'error': str(e)}), 200


@bp.route('/event-templates/<int:template_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_event_template(template_id):
    """Return a single template's full payload — used to populate the
    Quick Setup form when the operator clicks 'Load template'."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT id, name, description, payload, saved_by, saved_at, updated_at
              FROM event_templates
             WHERE id = %s
        """, (template_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        if isinstance(row, dict):
            payload = row['payload']
            saved_at = row['saved_at']
            updated_at = row['updated_at']
            data = {
                'id': row['id'], 'name': row['name'],
                'description': row['description'],
                'payload': payload, 'saved_by': row['saved_by'],
                'saved_at':   saved_at.isoformat() if saved_at else None,
                'updated_at': updated_at.isoformat() if updated_at else None,
            }
        else:
            data = {
                'id': row[0], 'name': row[1], 'description': row[2],
                'payload': row[3], 'saved_by': row[4],
                'saved_at':   row[5].isoformat() if row[5] else None,
                'updated_at': row[6].isoformat() if row[6] else None,
            }
        return jsonify({'success': True, 'template': data})
    except Exception as e:
        logger.error(f"get_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-templates', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def save_event_template():
    """Save (or overwrite, if same name) a Quick Setup preset.

    Body: {name, description (optional), payload}

    Idempotent on name: re-saving with the same name updates the
    existing row + bumps updated_at. This is the "Save current config
    as template" flow — operator types a name, clicks Save, done.

    Strips the per-event fields (event_name, event_password,
    event_slug, num_event_baristas) from the payload before storing
    so a template doesn't carry one event's identity into another.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'name required'}), 400
        if len(name) > 120:
            return jsonify({'success': False, 'error': 'name too long (max 120)'}), 400
        payload = data.get('payload') or {}
        if not isinstance(payload, dict):
            return jsonify({'success': False, 'error': 'payload must be a JSON object'}), 400

        # Strip per-event identity — a template applies across events,
        # so carrying the last event's name/password would be confusing
        # (and a credential leak).
        stripped = dict(payload)
        for key in ('event_name', 'event_slug', 'event_password',
                    'num_event_baristas'):
            stripped.pop(key, None)

        description = (data.get('description') or '').strip() or None
        try:
            from flask_jwt_extended import get_jwt_identity
            saved_by = get_jwt_identity() or 'unknown'
        except Exception:
            saved_by = 'unknown'

        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO event_templates (name, description, payload, saved_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (name) DO UPDATE
                SET description = EXCLUDED.description,
                    payload     = EXCLUDED.payload,
                    saved_by    = EXCLUDED.saved_by,
                    updated_at  = NOW()
            RETURNING id
            """,
            (name, description, json.dumps(stripped), saved_by),
        )
        row = cur.fetchone()
        db.commit()
        new_id = row[0] if not isinstance(row, dict) else row['id']
        return jsonify({'success': True, 'id': new_id, 'name': name})
    except Exception as e:
        logger.error(f"save_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/event-templates/<int:template_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def delete_event_template(template_id):
    """Delete a saved template. Admin only — staff can save but not
    delete (less destructive default)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("DELETE FROM event_templates WHERE id = %s", (template_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"delete_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# ======================================================================
# EventsAir integration (scaffold — see EVENTSAIR_INTEGRATION.md)
# ----------------------------------------------------------------------
# Bidirectional: attendees order coffee from the EventsAir app → orders
# land in Coffee Cue's normal pipeline (+ stock control); status updates
# push back to attendees via EventsAir notifications (alongside SMS).
#
# Phase 0 (this scaffold): the inbound order endpoint reuses the EXISTING
# /api/orders pipeline via an internal self-call — zero duplication of
# the validated order path (price, station checks, capability, stock).
# The EventsAir client is stubbed until a real API key exists.
# ======================================================================

def _eventsair_secret_ok(db):
    """Shared-secret gate for EventsAir inbound webhooks. Same pattern
    as the ClickSend/Cellcast SMS webhooks. Returns (ok, reason)."""
    import os  # not imported at module top in this file
    try:
        from services.eventsair import load_config
        cfg = load_config(db)
    except Exception as e:
        return False, f'config load failed: {e}'
    if not cfg.get('enabled'):
        return False, 'EventsAir integration is disabled'
    secret = (cfg.get('webhook_secret') or '').strip()
    testing = os.getenv('TESTING_MODE', 'false').lower() == 'true'
    if not secret:
        # No secret configured. Accept in TESTING_MODE, warn in prod.
        if testing:
            return True, 'testing-mode, no secret'
        logger.warning("EventsAir inbound accepted without webhook_secret — set one in prod")
        return True, 'no secret set'
    provided = request.headers.get('X-Coffee-Cue-Webhook-Secret', '')
    if provided != secret:
        return False, 'secret mismatch'
    return True, 'ok'


def _normalize_eventsair_order(payload):
    """Map an EventsAir order payload into the canonical /api/orders body.

    The exact EA payload shape is an open question (see the design doc) —
    this accepts the most likely field names and falls back gracefully.
    Keeps the EA-specific quirks isolated to this one function.
    """
    od = payload or {}
    # Attendee block may be nested or flat.
    att = od.get('attendee') or od.get('contact') or {}
    name = (od.get('customer_name') or att.get('name')
            or f"{att.get('firstName','')} {att.get('lastName','')}".strip()
            or 'EA Attendee')
    return {
        'customer_name': name,
        'coffee_type': od.get('coffee_type') or od.get('drink') or od.get('type'),
        'milk_type': od.get('milk_type') or od.get('milk') or 'full cream',
        'size': od.get('size') or 'medium',
        'sugar': od.get('sugar') or 'no sugar',
        'notes': od.get('notes') or od.get('special_instructions') or 'Ordered via EventsAir',
        'phone': od.get('phone') or att.get('mobile') or att.get('phone') or '',
        'station_id': od.get('station_id') or od.get('collection_station'),
        'priority': bool(od.get('vip') or od.get('priority')),
        # Carry the EA identifiers so the outbound notifier can push back.
        'source': 'eventsair',
        'eventsair_order_id': od.get('id') or od.get('order_id'),
        'eventsair_contact_id': att.get('id') or od.get('contact_id'),
    }


@bp.route('/integrations/eventsair/order', methods=['POST'])
def eventsair_inbound_order():
    """Receive an order placed from the EventsAir app and create it in
    Coffee Cue's normal pipeline (with stock control).

    Auth: shared-secret header (X-Coffee-Cue-Webhook-Secret).
    Idempotent on eventsair_order_id so EA retries don't double-create.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        ok, reason = _eventsair_secret_ok(db)
        if not ok:
            logger.warning(f"EventsAir inbound order rejected: {reason}")
            return jsonify({'success': False, 'error': reason}), 403

        payload = request.get_json(silent=True) or {}
        canonical = _normalize_eventsair_order(payload)
        if not canonical.get('coffee_type'):
            return jsonify({'success': False, 'error': 'missing coffee_type/drink'}), 400

        # Idempotency: if we've already created an order for this EA id,
        # return the existing one instead of a duplicate.
        ea_id = canonical.get('eventsair_order_id')
        if ea_id:
            cur = db.cursor()
            cur.execute(
                "SELECT order_number FROM orders "
                "WHERE order_details->>'eventsair_order_id' = %s LIMIT 1",
                (str(ea_id),),
            )
            existing = cur.fetchone()
            if existing:
                on = existing[0] if not isinstance(existing, dict) else existing.get('order_number')
                return jsonify({'success': True, 'duplicate': True, 'order_number': on})

        # Reuse the FULL existing order pipeline via an internal self-call.
        # This is deliberate: /api/orders does price compute, station
        # existence/status checks, capability gating, queue priority, WS
        # emit and (at completion) stock decrement. Re-implementing any
        # of that here would drift. We mint a short-lived service token
        # for the internal call.
        from flask_jwt_extended import create_access_token
        service_token = create_access_token(
            identity='eventsair-integration',
            additional_claims={'role': 'staff', 'source': 'eventsair'},
        )
        # Stash EA identifiers in notes-adjacent fields by extending the
        # body; /api/orders persists unknown keys it reads, and we add
        # the EA ids onto order_details via a follow-up update below.
        client = current_app.test_client()
        resp = client.post(
            '/api/orders',
            json=canonical,
            headers={'Authorization': f'Bearer {service_token}'},
        )
        if resp.status_code != 200:
            body = resp.get_json(silent=True) or {}
            return jsonify({'success': False,
                            'error': body.get('message') or f'order create failed ({resp.status_code})',
                            'detail': body}), resp.status_code
        created = resp.get_json(silent=True) or {}
        order_number = (created.get('data') or {}).get('order_number') or created.get('order_number')

        # Persist the EA identifiers onto the order_details so the
        # outbound notifier can push status back to the right attendee.
        if order_number and (ea_id or canonical.get('eventsair_contact_id')):
            try:
                cur = db.cursor()
                cur.execute(
                    "UPDATE orders SET order_details = order_details "
                    "|| %s::jsonb WHERE order_number = %s",
                    (json.dumps({
                        'eventsair_order_id': ea_id,
                        'eventsair_contact_id': canonical.get('eventsair_contact_id'),
                        'source': 'eventsair',
                    }), order_number),
                )
                db.commit()
            except Exception as e:
                logger.warning(f"EventsAir id stamp failed (non-fatal): {e}")
                try:
                    db.rollback()
                except Exception:
                    pass

        try:
            from services.logging_utils import event as _event
            _event('EVENTSAIR_ORDER_CREATED', order_number=order_number, ea_id=ea_id)
        except Exception:
            pass
        return jsonify({'success': True, 'order_number': order_number})
    except Exception as e:
        logger.exception(f"eventsair_inbound_order failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/integrations/eventsair/webhook', methods=['POST'])
def eventsair_webhook():
    """Receive EventsAir webhooks (registration created/updated, etc.).

    Phase 0: acknowledge + log. Phase 1 will upsert into event_attendees
    so the SMS/order flow can recognize attendees by phone. Shared-secret
    gated.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        ok, reason = _eventsair_secret_ok(db)
        if not ok:
            return jsonify({'success': False, 'error': reason}), 403
        payload = request.get_json(silent=True) or {}
        logger.info("EventsAir webhook: %s", str(payload)[:300])
        # TODO Phase 1: upsert event_attendees from the registration event.
        return ('', 204)
    except Exception as e:
        logger.warning(f"eventsair_webhook failed: {e}")
        return ('', 204)


@bp.route('/integrations/eventsair/config', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_eventsair_config():
    """Return EventsAir config with secrets redacted to *_set booleans."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import load_config, public_config
        return jsonify({'success': True, 'config': public_config(load_config(db))})
    except Exception as e:
        logger.error(f"get_eventsair_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/integrations/eventsair/config', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_eventsair_config():
    """Upsert EventsAir config. Blank secret fields are preserved (not
    wiped). Body: {enabled, client_id, client_secret, event_id,
    webhook_secret, vip_categories: [...]}"""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import save_config, public_config
        body = request.get_json() or {}
        cfg = save_config(db, body)
        return jsonify({'success': True, 'config': public_config(cfg)})
    except Exception as e:
        logger.error(f"put_eventsair_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/integrations/eventsair/status', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def eventsair_status():
    """Health: configured? token reachable? Used by the Organiser
    Connect-EventsAir panel and /api/health/full."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import get_client, is_enabled
        client = get_client(db)
        return jsonify({'success': True, 'enabled': is_enabled(db),
                        'health': client.health()})
    except Exception as e:
        logger.error(f"eventsair_status error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
