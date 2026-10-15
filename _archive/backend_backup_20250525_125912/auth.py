"""
Authentication utilities for the Expresso Coffee Ordering System
"""
import logging
from flask import g, request, jsonify
from flask_jwt_extended import JWTManager, create_access_token, create_refresh_token, decode_token
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, timedelta
import hashlib
import secrets
from utils.database import get_db_connection, close_connection
from functools import wraps

# Configure logging
logger = logging.getLogger("expresso.auth")

# JWT Manager instance
jwt = None

def init_app(app):
    """Initialize JWT authentication for the app"""
    global jwt
    
    jwt = JWTManager(app)
    
    logger.info("JWT authentication initialized with configuration:")
    logger.info(f"JWT_ACCESS_TOKEN_EXPIRES: {app.config['JWT_ACCESS_TOKEN_EXPIRES']}")
    logger.info(f"JWT_REFRESH_TOKEN_EXPIRES: {app.config['JWT_REFRESH_TOKEN_EXPIRES']}")
    
    # Handle invalid token errors (including crypto padding)
    @jwt.invalid_token_loader
    def invalid_token_callback(error_message):
        """Handle invalid tokens including demo tokens"""
        logger.warning(f"Invalid token error: {error_message}")
        
        # Check if this is a demo token in the request
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer ') and auth_header.endswith('valid_signature_for_offline_demo_mode'):
            logger.info("Demo token detected in invalid token handler, allowing access")
            # For demo tokens, we can't return a valid response here
            # The before_request handler should have caught this
            pass
            
        return jsonify({
            'success': False,
            'message': 'Invalid authentication token',
            'msg': str(error_message)
        }), 422
    
    # Handle expired tokens
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_data):
        """Handle expired tokens"""
        return jsonify({
            'success': False,
            'message': 'Token has expired',
            'msg': 'The token has expired'
        }), 401
    
    # Handle missing tokens
    @jwt.unauthorized_loader
    def unauthorized_callback(error_message):
        """Handle missing tokens"""
        return jsonify({
            'success': False,
            'message': 'Authorization required',
            'msg': str(error_message)
        }), 401
    
    # Register user loader
    @jwt.user_lookup_loader
    def user_lookup_callback(_jwt_header, jwt_data):
        """Load user from database based on JWT identity"""
        identity = jwt_data["sub"]
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get user from database
            cursor.execute('SELECT id, username, email, role, full_name FROM users WHERE id = %s', (identity,))
            user = cursor.fetchone()
            
            if user:
                user_data = {
                    'id': user[0],
                    'username': user[1],
                    'email': user[2],
                    'role': user[3],
                    'full_name': user[4] if len(user) > 4 else None
                }
                
                return user_data
            
            return None
        
        except Exception as e:
            logger.error(f"Error looking up user: {str(e)}")
            return None
        finally:
            if 'cursor' in locals() and cursor:
                cursor.close()
            if 'conn' in locals() and conn:
                close_connection(conn)
    
    # Before request handler to load user from JWT
    @app.before_request
    def load_user_from_jwt():
        """Load user into Flask g object from JWT token"""
        g.user = None
        
        # Skip for OPTIONS requests (CORS preflight)
        if request.method == 'OPTIONS':
            return
        
        # Get auth header
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            # Extract token
            token = auth_header.split(' ')[1]
            
            try:
                # Check if this is a demo/offline mode token
                if token.endswith('valid_signature_for_offline_demo_mode'):
                    logger.info("Demo/offline mode token detected, using fallback authentication")
                    
                    # Parse the demo token manually (it's still a valid JWT structure without signature verification)
                    try:
                        import base64
                        import json
                        
                        # Split token parts
                        header_b64, payload_b64, _ = token.split('.')
                        
                        # Add padding if needed
                        payload_b64 += '=' * (4 - len(payload_b64) % 4)
                        
                        # Decode payload
                        payload_bytes = base64.b64decode(payload_b64)
                        payload = json.loads(payload_bytes.decode('utf-8'))
                        
                        # Set demo user in g
                        g.user = {
                            'id': payload.get('sub', 'demo_user'),
                            'username': payload.get('username', 'Demo User'),
                            'email': payload.get('email', 'demo@coffeecue.com'),
                            'role': payload.get('role', 'admin'),
                            'full_name': payload.get('full_name', 'Demo User')
                        }
                        
                        logger.info(f"Demo user authenticated: {g.user['username']}")
                        
                    except Exception as demo_error:
                        logger.error(f"Error parsing demo token: {str(demo_error)}")
                        g.user = {
                            'id': 'demo_user',
                            'username': 'Demo User',
                            'email': 'demo@coffeecue.com', 
                            'role': 'admin',
                            'full_name': 'Demo User'
                        }
                else:
                    # Decode real token
                    decoded_token = decode_token(token)
                    
                    # Get user claims
                    user_id = decoded_token['sub']
                    username = decoded_token.get('username')
                    email = decoded_token.get('email')
                    role = decoded_token.get('role')
                    full_name = decoded_token.get('full_name')
                    
                    # Set user in g
                    g.user = {
                        'id': user_id,
                        'username': username,
                        'email': email,
                        'role': role,
                        'full_name': full_name
                    }
                    
                    logger.debug(f"User {username} authenticated via JWT")
                
            except Exception as e:
                logger.warning(f"Invalid JWT token: {str(e)}")

def generate_tokens(user_data):
    """
    Generate access and refresh tokens for a user
    
    Args:
        user_data: Dictionary with user information (id, username, email, role)
        
    Returns:
        Dictionary with tokens and expiration
    """
    try:
        # Create access token with identity and claims
        # Convert ID to string to avoid "Subject must be a string" errors
        identity = str(user_data['id'])
        
        # Add user data as claims
        claims = {
            'username': user_data.get('username', ''),
            'email': user_data.get('email', ''),
            'role': user_data.get('role', 'user'),
            'full_name': user_data.get('full_name', '')
        }
        
        # Create tokens
        access_token = create_access_token(identity=identity, additional_claims=claims)
        refresh_token = create_refresh_token(identity=identity, additional_claims=claims)
        
        # Calculate expiration time for client
        from flask import current_app
        expires_delta = current_app.config.get('JWT_ACCESS_TOKEN_EXPIRES', timedelta(hours=1))
        expires_in = int(expires_delta.total_seconds())
        
        return {
            'access_token': access_token,
            'refresh_token': refresh_token,
            'expires_in': expires_in
        }
        
    except Exception as e:
        logger.error(f"Error generating tokens: {str(e)}")
        raise

def verify_login(username, password):
    """
    Verify login credentials and return user data if valid
    
    Args:
        username: Username
        password: Password
        
    Returns:
        User data dictionary if credentials are valid, None otherwise
    """
    try:
        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get user from database
        cursor.execute('SELECT id, username, email, password_hash, role, full_name FROM users WHERE username = %s', (username,))
        user = cursor.fetchone()
        
        if not user:
            logger.warning(f"Failed login attempt for non-existent user: {username}")
            return None
            
        user_id, user_username, user_email, password_hash, user_role, user_full_name = user
        
        # Check if it's a werkzeug hash (starts with known prefixes)
        if password_hash and any(password_hash.startswith(prefix) for prefix in ['pbkdf2:', 'scrypt:', 'argon2:']):
            # Use werkzeug check_password_hash
            from werkzeug.security import check_password_hash
            password_correct = check_password_hash(password_hash, password)
        elif password_hash and ':' in password_hash and len(password_hash.split(':', 1)) == 2:
            # Legacy salt:hash format
            salt, hash_value = password_hash.split(':', 1)
            computed_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
            password_correct = computed_hash == hash_value
        else:
            # Default to werkzeug for any other format
            from werkzeug.security import check_password_hash
            password_correct = check_password_hash(password_hash, password)
            
        if not password_correct:
            logger.warning(f"Failed login attempt for user: {username}")
            return None
        
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
            'username': user_username,
            'email': user_email,
            'role': user_role,
            'full_name': user_full_name if user_full_name else ''
        }
        
        logger.info(f"User {username} login credentials verified")
        
        return user_data
        
    except Exception as e:
        logger.error(f"Error verifying login: {str(e)}")
        return None
    finally:
        if 'cursor' in locals() and cursor:
            cursor.close()
        if 'conn' in locals() and conn:
            close_connection(conn)

# Role-based access decorators
def admin_required(fn):
    """Decorator to check if user has admin role"""
    @wraps(fn)
    @jwt_required()
    def wrapper(*args, **kwargs):
        # Get current user identity and claims
        claims = get_jwt()
        user_role = claims.get('role', '')
        
        # Check if user has admin role
        if user_role != 'admin':
            return jsonify({
                'success': False,
                'message': 'Admin privilege required'
            }), 403
        
        return fn(*args, **kwargs)
    return wrapper

def role_required(roles):
    """Decorator to check if user has one of required roles"""
    def decorator(fn):
        @wraps(fn)
        @jwt_required()
        def wrapper(*args, **kwargs):
            # Get current user identity and claims
            claims = get_jwt()
            user_role = claims.get('role', '')
            
            # Check if user's role is in the list of allowed roles
            if user_role not in roles:
                return jsonify({
                    'success': False,
                    'message': 'Insufficient permissions'
                }), 403
            
            return fn(*args, **kwargs)
        return wrapper
    return decorator

def refresh_access_token(refresh_token):
    """
    Refresh access token using a refresh token
    
    Args:
        refresh_token: The refresh token
        
    Returns:
        Dictionary with new access token or None if invalid
    """
    try:
        from flask import current_app
        from flask_jwt_extended import decode_token
        
        # Decode the refresh token to get user identity
        decoded_token = decode_token(refresh_token)
        user_id = decoded_token['sub']
        
        # Get database connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get user from database
        cursor.execute('SELECT id, username, email, role, full_name FROM users WHERE id = %s', (user_id,))
        user = cursor.fetchone()
        
        if not user:
            logger.warning(f"Refresh token for non-existent user: {user_id}")
            return None
        
        # Create user data for token generation
        user_data = {
            'id': user[0],
            'username': user[1],
            'email': user[2],
            'role': user[3],
            'full_name': user[4] if len(user) > 4 else ""
        }
        
        # Generate new access token
        identity = user_data['id']
        
        # Add user data as claims
        claims = {
            'username': user_data.get('username', ''),
            'email': user_data.get('email', ''),
            'role': user_data.get('role', 'user'),
            'full_name': user_data.get('full_name', '')
        }
        
        # Create new access token
        access_token = create_access_token(identity=identity, additional_claims=claims)
        
        # Calculate expiration time for client
        expires_delta = current_app.config.get('JWT_ACCESS_TOKEN_EXPIRES', timedelta(hours=1))
        expires_in = int(expires_delta.total_seconds())
        
        logger.info(f"Refreshed access token for user {user_data['username']}")
        
        return {
            'token': access_token,
            'expiresIn': expires_in
        }
        
    except Exception as e:
        logger.error(f"Error refreshing token: {str(e)}")
        return None
    finally:
        if 'cursor' in locals() and cursor:
            cursor.close()
        if 'conn' in locals() and conn:
            close_connection(conn)

def jwt_required_with_demo(optional=False):
    """
    Custom JWT decorator that handles both real JWT tokens and demo tokens
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            # Check if user is already authenticated via before_request (demo mode)
            if hasattr(g, 'user') and g.user:
                return fn(*args, **kwargs)
            
            # Fall back to regular JWT required
            try:
                from flask_jwt_extended import verify_jwt_in_request
                verify_jwt_in_request(optional=optional)
                return fn(*args, **kwargs)
            except Exception as e:
                if optional:
                    # For optional auth, continue without user
                    g.user = None
                    return fn(*args, **kwargs)
                else:
                    logger.warning(f"JWT verification failed: {str(e)}")
                    return jsonify({
                        'success': False,
                        'message': 'Authentication required',
                        'msg': str(e)
                    }), 401
        
        return wrapper
    return decorator

def role_required_with_demo(roles):
    """
    Custom role decorator that handles both real JWT tokens and demo tokens
    """
    def decorator(fn):
        @wraps(fn)
        @jwt_required_with_demo()
        def wrapper(*args, **kwargs):
            # Get user role from g.user (demo mode) or JWT claims
            user_role = None
            
            if hasattr(g, 'user') and g.user:
                user_role = g.user.get('role', '')
            else:
                # Get from JWT claims
                try:
                    claims = get_jwt()
                    user_role = claims.get('role', '')
                except Exception:
                    user_role = ''
            
            # Check if user's role is in the list of allowed roles
            if user_role not in roles:
                return jsonify({
                    'success': False,
                    'message': 'Insufficient permissions'
                }), 403
            
            return fn(*args, **kwargs)
        return wrapper
    return decorator