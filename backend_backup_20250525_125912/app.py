import os
import logging
import eventlet
from flask import Flask, request, jsonify, render_template, redirect, url_for, g, session, current_app
from flask_socketio import SocketIO
from flask_cors import CORS  # Added CORS import
import atexit
from datetime import datetime, timedelta

# Import configuration
import config

# Import services
from services.coffee_system import CoffeeOrderSystem
from services.messaging import MessagingService
from services.nlp import NLPService

# Import JWT authentication
from auth import init_app as init_jwt, jwt, generate_tokens

# Import models
try:
    from models.users import User, AdminUser, Settings
except ImportError:
    # Fallback for older version
    from models.users import AdminUser, Settings
    User = AdminUser

from models.orders import Order, CustomerPreference
from models.stations import Station, StationSchedule
from models.inventory import InventoryItem  # Add inventory model import

# Import utils for database connection
from utils.database import get_db_connection, close_connection

# Import routes
from routes.admin_routes import bp as admin_bp
from routes.barista_routes import bp as barista_bp  
from routes.customer_routes import bp as customer_bp
from routes.sms_routes import bp as sms_bp
from routes.inventory_routes import bp as inventory_bp  # Add inventory routes import
from routes.station_api_routes import bp as station_api_bp  # Add station API routes import

# Import display routes if it exists
try:
    from routes.display_routes import bp as display_bp
    has_display_routes = True
except ImportError:
    has_display_routes = False
    
# Import auth routes 
try:
    from routes.auth_routes import bp as auth_bp
    has_auth_routes = True
except ImportError:
    has_auth_routes = False
    
# Import staff routes
try:
    from routes.staff_routes import bp as staff_bp
    has_staff_routes = True
except ImportError:
    has_staff_routes = False

# Import API routes
try:
    from routes.api_routes import bp as api_bp
    has_api_routes = True
except ImportError:
    has_api_routes = False

# Import consolidated API routes (new standardized API)
try:
    from routes.consolidated_api_routes import bp as consolidated_api_bp
    has_consolidated_api = True
except ImportError:
    has_consolidated_api = False

# Import display API routes
try:
    from routes.display_api_routes import bp as display_api_bp
    has_display_api_routes = True
except ImportError:
    has_display_api_routes = False

# Import settings API routes
try:
    from routes.settings_api_routes import bp as settings_api_bp
    has_settings_api_routes = True
except ImportError:
    has_settings_api_routes = False
    
# Import chat API routes
try:
    from routes.chat_api_routes import bp as chat_api_bp
    has_chat_api_routes = True
except ImportError:
    has_chat_api_routes = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("expresso.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("expresso")

def create_app():
    """Application factory function"""
    app = Flask(__name__)
    app.secret_key = config.SECRET_KEY
    
    # JWT configuration - use the JWT_SECRET_KEY from config
    app.config['JWT_SECRET_KEY'] = config.JWT_SECRET_KEY
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(seconds=config.JWT_ACCESS_TOKEN_EXPIRES)
    app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(seconds=config.JWT_REFRESH_TOKEN_EXPIRES)
    app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies']
    app.config['JWT_COOKIE_SECURE'] = config.JWT_COOKIE_SECURE
    app.config['JWT_COOKIE_CSRF_PROTECT'] = config.JWT_COOKIE_CSRF_PROTECT
    
    logger.info(f"JWT configured with access token expiry: {config.JWT_ACCESS_TOKEN_EXPIRES}s")
    logger.info(f"JWT configured with refresh token expiry: {config.JWT_REFRESH_TOKEN_EXPIRES}s")
    
    # Initialize JWT
    init_jwt(app)
    logger.info("JWT authentication initialized")
    
    # More permissive CORS configuration for development
    CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=True)
    logger.info("CORS initialized with permissive configuration")
    
    # Add CORS headers manually for all responses
    @app.after_request
    def after_request(response):
        # CORS headers are handled by Flask-CORS extension
    # response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        # Only log CORS headers for non-OPTIONS requests to reduce log noise
        if request.method != 'OPTIONS':
            logger.info(f"Added CORS headers to response for: {request.path}")
        return response
    
    # Handle OPTIONS requests explicitly for CORS preflight
    @app.route('/<path:path>', methods=['OPTIONS'])
    def options_handler(path):
        logger.debug(f"Handling OPTIONS request for path: {path}")
        return '', 200
    
    # Simple test endpoint to verify API connectivity
    @app.route('/api/test', methods=['GET'])
    def test_api():
        logger.info("Test API endpoint called")
        return jsonify({"status": "success", "message": "API is working"})
    
    # Initialize SocketIO with permissive CORS settings
    socketio = SocketIO(
        app, 
        cors_allowed_origins="*", 
        async_mode='eventlet'
    )
    logger.info("SocketIO initialized with permissive CORS settings")
    
    # Initialize core services
    try:
        # Get database connection from PostgreSQL
        logger.info("Attempting to connect to PostgreSQL database")
        db = get_db_connection(config.DATABASE_URL)
        
        coffee_system = CoffeeOrderSystem(db, vars(config))
        logger.info(f"Database initialized successfully using PostgreSQL")
    except Exception as e:
        logger.error(f"Error initializing database with PostgreSQL: {str(e)}")
        raise # Re-raise to fail fast - PostgreSQL is required
    
    messaging_service = MessagingService(
        account_sid=config.TWILIO_ACCOUNT_SID,
        auth_token=config.TWILIO_AUTH_TOKEN,
        phone_number=config.TWILIO_PHONE_NUMBER,
        testing_mode=config.TESTING_MODE
    )
    
    # Register route blueprints
    app.register_blueprint(admin_bp)
    app.register_blueprint(barista_bp)
    app.register_blueprint(customer_bp)
    app.register_blueprint(sms_bp)
    app.register_blueprint(inventory_bp)  # Register inventory routes
    logger.info("Inventory routes registered")
    app.register_blueprint(station_api_bp)  # Register station API routes
    logger.info("Station management API routes registered")
    
    if has_display_routes:
        app.register_blueprint(display_bp)
        logger.info("Display routes registered")
        
    if has_auth_routes:
        app.register_blueprint(auth_bp)
        logger.info("Auth routes registered")
    
    if has_staff_routes:
        app.register_blueprint(staff_bp)
        logger.info("Staff routes registered")
        
    # Register consolidated API routes (new standardized API)
    if has_consolidated_api:
        app.register_blueprint(consolidated_api_bp) 
        logger.info("Consolidated API routes registered (standardized API structure)")
        
    # Register API routes blueprint if available
    if has_api_routes:
        app.register_blueprint(api_bp)
        logger.info("API routes registered")
        
    # Register display API routes if available
    if has_display_api_routes:
        app.register_blueprint(display_api_bp)
        logger.info("Display API routes registered")
        
    # Register settings API routes if available
    if has_settings_api_routes:
        app.register_blueprint(settings_api_bp)
        logger.info("Settings API routes registered")
        
    # Register chat API routes if available
    if has_chat_api_routes:
        app.register_blueprint(chat_api_bp)
        logger.info("Chat API routes registered")
    
    # Set up shared context
    app.config.update({
        'coffee_system': coffee_system,
        'messaging_service': messaging_service,
        'config': vars(config)
    })
    
    # Initialize database and create tables if they don't exist
    with app.app_context():
        db = coffee_system.db
        # Create User tables (includes admin users)
        User.create_tables(db)
        
        # Create inventory tables
        InventoryItem.create_tables(db)
        logger.info("Inventory tables created")
        
        # Create settings table if it doesn't exist
        cursor = db.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            updated_by VARCHAR(100)
        )
        ''')
        db.commit()
        logger.info("Settings table created or already exists")
        
        # Check if we need to create a default admin user
        cursor = db.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = cursor.fetchone()[0]
        
        if admin_count == 0:
            # Create default admin user if none exists
            default_username = getattr(config, 'DEFAULT_ADMIN_USERNAME', 'admin')
            default_email = getattr(config, 'DEFAULT_ADMIN_EMAIL', 'admin@example.com')
            default_password = getattr(config, 'DEFAULT_ADMIN_PASSWORD', 'adminpassword')
            
            if default_username and default_email and default_password:
                try:
                    User.create(
                        db, default_username, default_email, default_password, 
                        'admin', 'System Administrator'
                    )
                    logger.info(f"Created default admin user: {default_username}")
                except Exception as e:
                    logger.error(f"Failed to create default admin user: {str(e)}")
                
                # Add a warning if using the default password
                if default_password == 'adminpassword':
                    logger.warning("Using default admin password - please change this immediately!")
    
    # Make context available to templates
    @app.context_processor
    def inject_context():
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get settings from database
        cursor = db.cursor()
        
        # System name (default to 'Coffee Cue')
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('system_name',))
        system_name_result = cursor.fetchone()
        system_name = system_name_result[0] if system_name_result else 'Coffee Cue'
        
        # Event name
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('event_name',))
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else config.EVENT_NAME
        
        # Check if JWT is enabled
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('jwt_enabled',))
        jwt_enabled_result = cursor.fetchone()
        jwt_enabled = jwt_enabled_result[0].lower() in ('true', 'yes', '1', 't', 'y') if jwt_enabled_result else True
        
        # Sponsor info if enabled
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_display_enabled',))
        sponsor_display_result = cursor.fetchone()
        sponsor_display_enabled = sponsor_display_result[0].lower() in ('true', 'yes', '1', 't', 'y') if sponsor_display_result else False
        
        sponsor_info = None
        if sponsor_display_enabled:
            cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_name',))
            sponsor_name_result = cursor.fetchone()
            sponsor_name = sponsor_name_result[0] if sponsor_name_result else ''
            
            cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_message',))
            sponsor_message_result = cursor.fetchone()
            sponsor_message = sponsor_message_result[0] if sponsor_message_result else 'Coffee service proudly sponsored by {sponsor}'
        
        # Format sponsor message
        if sponsor_display_enabled and sponsor_name and '{sponsor}' in sponsor_message:
            sponsor_message = sponsor_message.replace('{sponsor}', sponsor_name)
            sponsor_info = {
                'name': sponsor_name,
                'message': sponsor_message
            }
        
        # Twilio number
        twilio_number = config.TWILIO_PHONE_NUMBER
        
        # App version
        app_version = config.APP_VERSION
        
        return {
            'system_name': system_name,
            'event_name': event_name,
            'twilio_number': twilio_number,
            'app_version': app_version,
            'sponsor_info': sponsor_info,
            'jwt_enabled': jwt_enabled
        }
    
    # User loader before each request (for backward compatibility)
    @app.before_request
    def load_logged_in_user():
        # This is now handled in the auth module's load_user_from_jwt function
        # Keep it empty for backward compatibility
        pass
    
    # Authentication API endpoints
    @app.route('/api/auth/login', methods=['POST'])
    def api_auth_login():
        """Direct API endpoint for authentication"""
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400
            
            data = request.json
            username = data.get('username')
            password = data.get('password')
            
            if not username or not password:
                return jsonify({
                    'status': 'error',
                    'message': 'Username and password are required'
                }), 400
            
            # Get database connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get user from database
            cursor.execute('SELECT * FROM users WHERE username = %s', (username,))
            user = cursor.fetchone()
            
            if not user:
                logger.warning(f"Failed login attempt for non-existent user: {username}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid username or password'
                }), 401
            
            # Get password hash
            password_hash = user[3]  # Assuming the 4th column is password_hash
            
            # Check if the format is salt:hash
            if ':' in password_hash:
                # Split salt and hash
                salt, hash_value = password_hash.split(':', 1)
                
                # For debugging
                logger.debug(f"Found user {username}, checking password with salt:hash format")
                
                # This is a simple password verification example
                # In production, you would use a proper password hashing library
                import hashlib
                computed_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
                password_correct = computed_hash == hash_value
            else:
                # Assume it's a werkzeug hash
                from werkzeug.security import check_password_hash
                logger.debug(f"Found user {username}, checking password with werkzeug format")
                password_correct = check_password_hash(password_hash, password)
            
            if not password_correct:
                logger.warning(f"Failed login attempt for user: {username}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid username or password'
                }), 401
            
            # Get user ID, username, email, and role
            user_id = user[0]
            username = user[1]
            email = user[2]
            role = user[4]
            full_name = user[5] if len(user) > 5 else ""
            
            # Update last login
            cursor.execute('''
                UPDATE users 
                SET last_login = %s,
                    failed_login_attempts = 0,
                    account_locked = FALSE,
                    account_locked_until = NULL
                WHERE id = %s
            ''', (datetime.now(), user_id))
            conn.commit()
            
            # Create user data for token generation
            user_data = {
                'id': user_id,
                'username': username,
                'email': email,
                'role': role,
                'full_name': full_name
            }
            
            # Generate tokens
            tokens = generate_tokens(user_data)
            
            logger.info(f"User {username} logged in successfully via API")
            
            # Return success response with tokens and user data
            return jsonify({
                'status': 'success',
                'message': 'Login successful',
                'token': tokens['access_token'],
                'refreshToken': tokens['refresh_token'],
                'expiresIn': tokens['expires_in'],
                'user': user_data
            })
            
        except Exception as e:
            logger.error(f"API login error: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Internal server error: {str(e)}'
            }), 500
        finally:
            if 'cursor' in locals() and cursor:
                cursor.close()
            if 'conn' in locals() and conn:
                close_connection(conn)

    # Refresh endpoint is now handled by auth_routes.py blueprint
    # This avoids duplicate route registration
    
    # Orders API routes with direct database access
    @app.route('/api/orders/pending', methods=['GET'])
    def api_orders_pending():
        """Route that returns pending orders directly from database"""
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
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Format order for frontend
                pending_orders.append({
                    'id': f'order_{order_id}',  # Keep same format as original
                    'order_number': order_number,
                    'customerName': customer_name,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'status': status,
                    'createdAt': created_at,
                    'waitTime': wait_time,
                    'promisedTime': 15,  # Default to 15 minutes
                    'priority': priority == 1  # Convert 1/0 to True/False
                })
            
            return jsonify(pending_orders)
        
        except Exception as e:
            logging.error(f"Error fetching pending orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_pending_orders
                return get_pending_orders()
            return jsonify([])

    @app.route('/api/orders/in-progress', methods=['GET'])
    def api_orders_in_progress():
        """Route that returns in-progress orders directly from database"""
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
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Check for extra hot
                extra_hot = False
                if 'temp' in order_details and order_details['temp'] == 'extra hot':
                    extra_hot = True
                # Also check the notes field for "extra hot" text
                elif 'notes' in order_details and order_details['notes'] and 'extra hot' in order_details['notes'].lower():
                    extra_hot = True
                
                # Format order for frontend
                in_progress_orders.append({
                    'id': f'order_in_progress_{order_id}',
                    'order_number': order_number,
                    'customerName': customer_name,
                    'phoneNumber': phone,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'extraHot': extra_hot,
                    'priority': priority == 1,
                    'createdAt': created_at,
                    'waitTime': wait_time,
                    'promisedTime': 15  # Default to 15 minutes
                })
            
            return jsonify(in_progress_orders)
        
        except Exception as e:
            logging.error(f"Error fetching in-progress orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_in_progress_orders
                return get_in_progress_orders()
            return jsonify([])
    
    @app.route('/api/orders/completed', methods=['GET'])
    def api_orders_completed():
        """Route that returns completed orders directly from database"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Query database for completed orders
            cursor = db.cursor()
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, completed_at, picked_up_at, phone, order_details, queue_priority
                FROM orders 
                WHERE status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 20
            ''')
            
            # Process orders
            completed_orders = []
            for order in cursor.fetchall():
                # Extract order details
                order_id, order_number, status, station_id, created_at, completed_at, picked_up_at, phone, order_details_json, priority = order
                
                # Parse order details
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Format order for frontend
                completed_orders.append({
                    'id': f'order_completed_{order_id}',
                    'order_number': order_number,
                    'customerName': customer_name,
                    'phoneNumber': phone,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'completedAt': completed_at,
                    'pickedUpAt': picked_up_at,
                    'pickedUp': picked_up_at is not None
                })
            
            return jsonify(completed_orders)
        
        except Exception as e:
            logging.error(f"Error fetching completed orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_completed_orders
                return get_completed_orders()
            return jsonify([])

    @app.route('/api/chat/messages', methods=['GET'])
    def api_chat_messages():
        """Route that returns chat messages from database if available"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Check if chat_messages table exists
            cursor = db.cursor()
            cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
            table_exists = cursor.fetchone()[0]
            
            if table_exists:
                # Query database for chat messages
                cursor.execute('''
                    SELECT id, sender, content, is_urgent, created_at
                    FROM chat_messages
                    ORDER BY created_at DESC
                    LIMIT 20
                ''')
                
                messages = []
                for msg in cursor.fetchall():
                    msg_id, sender, content, is_urgent, created_at = msg
                    messages.append({
                        'id': msg_id,
                        'sender': sender,
                        'content': content,
                        'created_at': created_at,
                        'is_urgent': bool(is_urgent)
                    })
                
                return jsonify(messages)
            else:
                # If table doesn't exist, fall back to API routes if available
                if has_api_routes:
                    from routes.api_routes import get_chat_messages
                    return get_chat_messages()
                # Otherwise return sample data
                now = datetime.now()
                return jsonify([
                    {
                        'id': 1,
                        'sender': 'System',
                        'content': 'Welcome to the barista chat',
                        'timestamp': now.isoformat(),
                        'is_urgent': False
                    }
                ])
        
        except Exception as e:
            logging.error(f"Error fetching chat messages: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_chat_messages
                return get_chat_messages()
            return jsonify([])

    @app.route('/api/test', methods=['GET'])
    def api_test():
        """Simple API test endpoint"""
        return jsonify({"status": "success", "message": "API is working"})
    
    # Special handling for orders endpoints directly
    @app.route('/orders/pending', methods=['GET'])
    def orders_pending():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/pending')
    
    @app.route('/orders/in-progress', methods=['GET'])
    def orders_in_progress():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/in-progress')
    
    @app.route('/orders/completed', methods=['GET'])
    def orders_completed():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/completed')
    
    @app.route('/orders/<order_id>/start', methods=['POST'])
    def order_start(order_id):
        """Forward to API version"""
        from routes.api_routes import start_order
        return start_order(order_id)
    
    @app.route('/orders/<order_id>/complete', methods=['POST'])
    def order_complete(order_id):
        """Forward to API version"""
        from routes.api_routes import complete_order
        return complete_order(order_id)
    
    @app.route('/orders/<order_id>/pickup', methods=['POST'])
    def order_pickup(order_id):
        """Forward to API version"""
        from routes.api_routes import pickup_order
        return pickup_order(order_id)
    
    @app.route('/orders/<order_id>/message', methods=['POST'])
    def order_message(order_id):
        """Forward to API version"""
        from routes.api_routes import send_message
        return send_message(order_id)
    
    @app.route('/chat/messages', methods=['GET'])
    def chat_messages():
        """Redirect old endpoint to API version"""
        return redirect('/api/chat/messages')
    
    @app.route('/test', methods=['GET'])
    def test():
        """Redirect old endpoint to API version"""
        return redirect('/api/test')
    
    # Debug endpoint for database info
    @app.route('/api/debug/database-info', methods=['GET'])
    def database_info():
        """Get information about the database and its tables"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            cursor = db.cursor()
            
            # Get a list of tables
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
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
                'database_path': current_app.config.get('config')['DATABASE_URL'],
                'database_type': 'PostgreSQL',
                'tables': tables,
                'row_counts': table_counts,
                'sample_orders': sample_orders
            })
        
        except Exception as e:
            return jsonify({
                'error': str(e),
                'database_path': current_app.config.get('config', {}).get('DATABASE_URL', 'Unknown')
            })
    
    # Test endpoint for JWT
    @app.route('/api/auth-test')
    def auth_test():
        """Test endpoint to check JWT authentication status"""
        try:
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            
            verify_jwt_in_request(optional=True)
            current_user = get_jwt_identity()
            
            if current_user:
                claims = get_jwt()
                return jsonify({
                    'status': 'authenticated',
                    'auth_type': 'jwt',
                    'user': {
                        'id': current_user,
                        'username': claims.get('username'),
                        'role': claims.get('role'),
                        'full_name': claims.get('full_name')
                    }
                })
            elif g.user:
                # Session-based authentication
                return jsonify({
                    'status': 'authenticated',
                    'auth_type': 'session',
                    'user': {
                        'id': g.user.get('id'),
                        'username': g.user.get('username'),
                        'role': g.user.get('role'),
                        'full_name': g.user.get('full_name')
                    }
                })
            else:
                return jsonify({
                    'status': 'unauthenticated',
                    'auth_type': 'none'
                })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            })
    
    # Special catch-all route for SPA frontend to handle API requests
    @app.route('/api/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
    def api_proxy(path):
        """
        Special route handler for all API requests that aren't captured by other routes.
        This route ensures API requests still work even if the path isn't registered elsewhere.
        """
        if request.method == 'OPTIONS':
            # Handle CORS preflight requests
            resp = app.make_default_options_response()
            # CORS headers are handled by Flask-CORS extension
    # The following headers are now handled automatically:
    # resp.headers['Access-Control-Allow-Origin'] = '*'
    # resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    # resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            return resp
        
        # Check if this path matches one of our API endpoints (after removing prefix)
        # Convert both to standard forms for comparison
        normalized_path = path.rstrip('/')
        
        # Special handling for common frontend endpoints
        if normalized_path == 'stations':
            # Make sure authentication is present
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle stations API
                from routes.station_api_routes import get_stations
                return get_stations()
            except Exception as e:
                logger.error(f"Error in stations API: {str(e)}")
            
        # Similar handling for inventory
        if normalized_path == 'inventory':
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle inventory API
                from routes.inventory_routes import get_inventory
                return get_inventory()
            except Exception as e:
                logger.error(f"Error in inventory API: {str(e)}")
        
        # Similar handling for schedule
        if normalized_path == 'schedule/today':
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle schedule API
                from routes.station_api_routes import get_todays_schedule
                return get_todays_schedule()
            except Exception as e:
                logger.error(f"Error in schedule API: {str(e)}")
        
        logger.warning(f"Unhandled API route: /api/{path}")
        
        # Return a more helpful error for frontend
        resp = jsonify({
            "success": False,
            "error": "API endpoint not implemented",
            "path": path
        })
        
        # Add CORS headers
        # CORS headers are handled by Flask-CORS extension
    # The following headers are now handled automatically:
    # resp.headers['Access-Control-Allow-Origin'] = '*'
    # resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
    # resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        
        return resp, 501
    
    # Root route that returns a simple message instead of redirecting
    @app.route('/')
    def index():
        # For development, return a simple message
        # In production, this would serve the React app's index.html
        return jsonify({
            "message": "This would serve the React app in production. For development, navigate to http://localhost:3000"
        })
    
    # Catch-all route for all other paths
    @app.route('/<path:path>')
    def catch_all(path):
        # Skip API routes - those should already be handled by specific routes
        if path.startswith('api/'):
            return jsonify({"error": "API endpoint not found"}), 404
            
        # For specific backend routes that need to be handled by backend routes
        # like auth/login, let the Flask routing system handle those
        
        # For development, return a simple message
        # In production, this would serve the React app's index.html
        logger.info(f"Catch-all route handling: {path}")
        return jsonify({
            "message": "This would serve the React app in production. For development, requests should be proxied to the React dev server.",
            "path": path
        })
    
    # Clean up resources when app is shutting down
    @atexit.register
    def cleanup():
        logger.info("Application shutting down, cleaning up resources...")
        coffee_system = app.config.get('coffee_system')
        if coffee_system and hasattr(coffee_system, 'db'):
            close_connection(coffee_system.db)
            logger.info("Database connection closed")
    
    return app, socketio

# Main execution
if __name__ == '__main__':
    app, socketio = create_app()
    # Changed port to 5001 to match React proxy setting
    port = 5001
    debug = getattr(config, 'DEBUG', True)  # Set debug to True for more verbose output
    logger.info(f"Starting Coffee Cue System on port {port}")
    socketio.run(app, debug=debug, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)