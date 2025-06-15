"""
Consolidated API routes for the Expresso Coffee Ordering System.

This module provides a standardized API structure for the entire application,
consolidating endpoints from various modules into a coherent API design.
"""
import logging
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, timedelta
import json
import re
from auth import jwt_required_with_demo, role_required_with_demo

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
                       created_at, phone, order_details, queue_priority
                FROM orders
            '''
            
            if query_conditions:
                query = base_query + " WHERE " + " AND ".join(query_conditions)
                query += " ORDER BY queue_priority, created_at DESC"
                cursor.execute(query, query_params)
            else:
                query = base_query + " ORDER BY created_at DESC LIMIT 50"
                cursor.execute(query)
            
            # Process orders
            orders = []
            for order in cursor.fetchall():
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
                
                # Format order for frontend - include both snake_case and camelCase
                orders.append({
                    'id': order_number,  # Use order_number as id for consistency
                    'order_number': order_number,
                    'orderNumber': order_number,  # camelCase
                    'customer_name': order_details.get('name', 'Customer'),
                    'customerName': order_details.get('name', 'Customer'),  # camelCase
                    'coffee_type': order_details.get('type', 'Coffee'),
                    'coffeeType': order_details.get('type', 'Coffee'),  # camelCase
                    'milk_type': order_details.get('milk', 'Standard'),
                    'milkType': order_details.get('milk', 'Standard'),  # camelCase
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'size': order_details.get('size', 'Regular'),
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
                    'stationId': station_id  # camelCase
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
            
            # Generate a unique order number
            now = datetime.now()
            prefix = "W" if data.get('order_type') == 'walk-in' else "O"
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Prepare order details
            order_details = {
                'name': data.get('customer_name'),
                'type': data.get('coffee_type'),
                'milk': data.get('milk_type', 'dairy'),
                'size': data.get('size'),
                'sugar': data.get('sugar', 'No sugar'),
                'notes': data.get('special_instructions', ''),
                'payment_method': data.get('payment_method', 'cash'),
                'order_type': data.get('order_type', 'walk-in'),
                'created_by': data.get('created_by', 'barista')
            }
            
            # Determine priority (VIP orders get priority 1, regular get 5)
            priority = 1 if data.get('priority') == 'vip' else 5
            if data.get('priority') == 'urgent':
                priority = 2
            
            # Use provided station or default to station 1
            station_id = data.get('station_id', 1)
            
            # Insert order into database
            cursor = db.cursor()
            cursor.execute('''
                INSERT INTO orders (
                    order_number, phone, order_details, status, 
                    station_id, created_at, updated_at, queue_priority
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, order_number
            ''', (
                order_number,
                data.get('phone', ''),  # Phone can be empty for walk-in orders
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
    """Get all pending orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for pending orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details, queue_priority
            FROM orders 
            WHERE status = 'pending'
            ORDER BY queue_priority, created_at DESC
        ''')
        
        # Process orders
        pending_orders = []
        for order in cursor.fetchall():
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
                'customer_name': order_details.get('name', 'Customer'),
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'sugar': order_details.get('sugar', 'No sugar'),
                'status': status,
                'created_at': created_at,
                'wait_time': wait_time,
                'priority': priority == 1,  # Convert 1/0 to True/False
                'batch_group': batch_group
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
    """Get all in-progress orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for in-progress orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details, queue_priority
            FROM orders 
            WHERE status = 'in-progress'
            ORDER BY created_at
        ''')
        
        # Process orders
        in_progress_orders = []
        for order in cursor.fetchall():
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
            
            # Check for extra hot
            extra_hot = False
            if 'temp' in order_details and order_details['temp'] == 'extra hot':
                extra_hot = True
            # Also check the notes field for "extra hot" text
            elif 'notes' in order_details and order_details['notes'] and 'extra hot' in order_details['notes'].lower():
                extra_hot = True
            
            # Format order for frontend
            in_progress_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'customer_name': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'sugar': order_details.get('sugar', 'No sugar'),
                'extra_hot': extra_hot,
                'priority': priority == 1,
                'created_at': created_at,
                'wait_time': wait_time
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
    """Get all completed orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for completed orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, phone, order_details, picked_up_at
            FROM orders 
            WHERE status IN ('completed', 'picked_up')
            ORDER BY updated_at DESC
            LIMIT 10
        ''')
        
        # Process orders
        completed_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, updated_at, phone, order_details_json, picked_up_at = order
            
            # Use updated_at as completed_at time
            completed_at = updated_at or created_at
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Format order for frontend
            completed_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'customer_name': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'completed_at': completed_at,
                'picked_up_at': picked_up_at,
                'pickedUpAt': picked_up_at,  # camelCase for frontend compatibility
                'status': status,
                'ready_for_pickup': status == 'completed'
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
                'customer_name': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'sugar': order_details.get('sugar', 'No sugar'),
                'status': status,
                'station_id': station_id,
                'created_at': created_at,
                'updated_at': updated_at,
                'completed_at': completed_at,
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
    """Start an order"""
    try:
        # Log incoming request
        logger.info(f"Received request to start order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        # Update order status
        cursor.execute('''
            UPDATE orders
            SET status = 'in-progress', updated_at = %s
            WHERE order_number = %s
        ''', (datetime.now().isoformat(), clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully started order: {clean_id}")
            return jsonify({"success": True, "message": "Order started successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error starting order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

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
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
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
        
        if rows_affected > 0:
            logger.info(f"Successfully completed order: {clean_id}")
            return jsonify({"success": True, "message": "Order completed successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error completing order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

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
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        # Get current time
        pickup_at = datetime.now().isoformat()
        
        # Update order status - set picked_up_at field if it exists
        try:
            cursor.execute('''
                UPDATE orders
                SET picked_up_at = %s, updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, pickup_at, clean_id))
        except Exception as e:
            # If picked_up_at column doesn't exist, fall back to a simpler update
            logger.warning(f"picked_up_at column may not exist, using simpler update: {str(e)}")
            cursor.execute('''
                UPDATE orders
                SET updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully marked order as picked up: {clean_id}")
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
                        SET status = 'in-progress', updated_at = %s
                        WHERE order_number = %s
                    ''', (current_time, order_id))
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
        
        # Send the message using messaging service
        try:
            result = messaging_service.send_message(phone_number, message)
            logger.info(f"Message sent to {phone_number} for order {clean_id}, result: {result}")
            
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
            
            return jsonify({
                "success": True, 
                "message": "Message sent successfully",
                "message_sid": result
            })
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")
            return jsonify({"success": False, "message": f"Error sending message: {str(e)}"})
    
    except Exception as e:
        logger.error(f"Error sending message for order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

# ============================================================================
# DISPLAY ENDPOINTS (PUBLIC FACING)
# ============================================================================

@bp.route('/display/config', methods=['GET'])
def get_display_config():
    """Get display screen configuration including event details, sponsor info, and SMS details"""
    try:
        # Get config directly from app config for simplicity
        config = current_app.config.get('config', {})
        
        # Return simplified display configuration based on app config
        return jsonify({
            "success": True,
            "config": {
                "system_name": "Coffee Cue",
                "event_name": config.get('EVENT_NAME', 'Coffee Event'),
                "sms_number": config.get('TWILIO_PHONE_NUMBER', ''),
                "sponsor": {
                    "enabled": False,
                    "name": "",
                    "message": ""
                },
                "wait_time": "10-15",
                "stations": [
                    {
                        "id": 1,
                        "name": "Station #1",
                        "location": "Main Hall",
                        "status": "active",
                        "barista": "Barista 1"
                    },
                    {
                        "id": 2,
                        "name": "Station #2",
                        "location": "Main Hall",
                        "status": "active",
                        "barista": "Barista 2"
                    },
                    {
                        "id": 3,
                        "name": "Station #3",
                        "location": "Main Hall",
                        "status": "active",
                        "barista": "Barista 3"
                    }
                ],
                "app_version": config.get('APP_VERSION', '1.0.0')
            }
        })
    
    except Exception as e:
        logger.error(f"Error getting display config: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

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
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            # Format display phone (last 4 digits)
            display_phone = "****"
            if phone and len(phone) >= 4:
                display_phone = phone[-4:]
            
            # Format order for display
            in_progress_orders.append({
                'id': order_number,
                'order_number': order_number,
                'customerName': customer_name,
                'displayPhone': display_phone,
                'coffeeType': order_details.get('type', 'Coffee'),
                'status': status,
                'stationId': station_id
            })
        
        # Get completed orders that are ready for pickup (limited to most recent 10)
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, completed_at, phone, order_details
            FROM orders 
            WHERE status = 'completed' AND (picked_up_at IS NULL OR picked_up_at = '')
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
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            # Format display phone (last 4 digits)
            display_phone = "****"
            if phone and len(phone) >= 4:
                display_phone = phone[-4:]
            
            # Format order for display
            ready_orders.append({
                'id': order_number,
                'order_number': order_number,
                'customerName': customer_name,
                'displayPhone': display_phone,
                'coffeeType': order_details.get('type', 'Coffee'),
                'status': status,
                'stationId': station_id
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
        
        # Return demo data in case of error
        return jsonify({
            "success": True,
            "orders": {
                "inProgress": [
                    {
                        "id": "12345",
                        "order_number": "12345",
                        "customerName": "John D.",
                        "displayPhone": "1234",
                        "coffeeType": "Cappuccino",
                        "status": "in-progress",
                        "stationId": 1
                    },
                    {
                        "id": "12346",
                        "order_number": "12346",
                        "customerName": "Sarah M.",
                        "displayPhone": "5678",
                        "coffeeType": "Latte",
                        "status": "in-progress",
                        "stationId": 2
                    }
                ],
                "ready": [
                    {
                        "id": "12340",
                        "order_number": "12340",
                        "customerName": "Mike T.",
                        "displayPhone": "9012",
                        "coffeeType": "Espresso",
                        "status": "completed",
                        "stationId": 3
                    },
                    {
                        "id": "12341",
                        "order_number": "12341",
                        "customerName": "Emma S.",
                        "displayPhone": "3456",
                        "coffeeType": "Flat White",
                        "status": "completed",
                        "stationId": 1
                    }
                ]
            },
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
        
        # Fields that can be updated
        allowed_fields = ['name', 'category', 'current_quantity', 'unit', 
                          'station_id', 'minimum_threshold', 'status']
        
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
            
            # Update item quantity
            cursor.execute("""
                UPDATE inventory_items
                SET current_quantity = %s,
                    status = CASE
                        WHEN %s <= minimum_threshold THEN 'low_stock'
                        ELSE 'in_stock'
                    END,
                    last_updated = %s
                WHERE id = %s
                RETURNING *
            """, (new_amount, new_amount, datetime.now().isoformat(), item_id))
            
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
            (name, category, current_quantity, unit, station_id, minimum_threshold, status, created_at, last_updated)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (name, category, current_quantity, unit, station_id, minimum_threshold, 
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
@role_required_with_demo(['admin', 'staff', 'barista'])
def send_sms():
    """Send an SMS message directly"""
    try:
        data = request.json
        to_number = data.get('to')
        message = data.get('message', '')
        order_id = data.get('order_id')
        
        # Forward to the actual implementation
        from routes.sms_routes import send_sms as sms_handler
        return sms_handler()
    
    except Exception as e:
        logger.error(f"Error sending SMS: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error sending SMS: {str(e)}"
        }), 500

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
        
        # If we have no data, add some sample breaks and shifts for testing
        if len(shifts) == 0 and len(breaks) == 0 and len(rush_periods) == 0:
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