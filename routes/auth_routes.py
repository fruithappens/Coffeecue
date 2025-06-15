"""
Simple Authentication routes for the Expresso Coffee Ordering System
Only API endpoints, no templates
"""
from flask import Blueprint, request, jsonify
from werkzeug.security import check_password_hash
import logging
from datetime import datetime
import hashlib

from utils.database import get_db_connection, close_connection
from auth import generate_tokens, verify_login

# Create a blueprint
bp = Blueprint('auth', __name__)

# Configure logging
logger = logging.getLogger("expresso.routes.auth")

@bp.route('/api/auth/login', methods=['POST'])
def api_login():
    """API endpoint for login"""
    if not request.is_json:
        return jsonify({
            'status': 'error',
            'message': 'JSON data required'
        }), 400
    
    # Handle API login and return JSON response
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    # Validate input
    if not username or not password:
        return jsonify({
            'status': 'error',
            'message': 'Missing username or password'
        }), 400
    
    # Use verify_login from auth module
    user_data = verify_login(username, password)
    
    if not user_data:
        logger.warning(f"Failed login attempt for user: {username}")
        return jsonify({
            'status': 'error',
            'message': 'Invalid username or password'
        }), 401
    
    logger.info(f"User {username} logged in successfully via API")
    
    # Generate tokens
    try:
        tokens = generate_tokens(user_data)
        
        # Return success response with tokens and user data
        return jsonify({
            'status': 'success',
            'message': 'Login successful',
            'token': tokens['access_token'],
            'refreshToken': tokens['refresh_token'],
            'expiresIn': tokens['expires_in'],
            'user': user_data
        })
    except Exception as token_err:
        logger.error(f"Error generating tokens: {str(token_err)}")
        return jsonify({
            'status': 'error',
            'message': 'Authentication error'
        }), 500

@bp.route('/api/auth/refresh', methods=['POST'])
def refresh_token():
    """Refresh an access token using a refresh token"""
    try:
        from flask_jwt_extended import decode_token, create_access_token
        
        # Get refresh token from request
        data = request.json
        
        if not data or 'refreshToken' not in data:
            return jsonify({
                'status': 'error',
                'message': 'Refresh token is required'
            }), 400
        
        refresh_token = data['refreshToken']
        
        try:
            # Decode the refresh token to get user identity
            logger.debug(f"Attempting to decode refresh token: {refresh_token[:50]}...")
            decoded_token = decode_token(refresh_token)
            
            # Check token type
            if decoded_token.get('type') != 'refresh':
                logger.warning(f"Token type mismatch: expected 'refresh', got '{decoded_token.get('type')}'")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid token type'
                }), 401
                
            user_id = decoded_token['sub']
            # Convert user_id to int since it comes as string from JWT
            user_id_int = int(user_id) if isinstance(user_id, str) else user_id
            logger.debug(f"Successfully decoded refresh token for user ID: {user_id_int}")
            
            # Get database connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get user from database
            cursor.execute('SELECT id, username, email, role, full_name FROM users WHERE id = %s', (user_id_int,))
            user_record = cursor.fetchone()
            
            if not user_record:
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid refresh token'
                }), 401
            
            # Create user data for token generation
            user_data = {
                'id': user_record[0],
                'username': user_record[1],
                'email': user_record[2],
                'role': user_record[3],
                'full_name': user_record[4] if len(user_record) > 4 else ""
            }
            
            # Generate new access token
            tokens = generate_tokens(user_data)
            
            # Return new access token in the format the React app expects
            return jsonify({
                'success': True,
                'status': 'success',
                'token': tokens['access_token'],
                'expiresIn': tokens['expires_in']
            })
            
        except Exception as e:
            logger.error(f"Error refreshing token: {str(e)}")
            logger.error(f"Refresh token that failed: {refresh_token[:50]}...")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            return jsonify({
                'success': False,
                'status': 'error',
                'message': f'Invalid refresh token: {str(e)}'
            }), 401
            
    except Exception as e:
        logger.error(f"Error during token refresh: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': 'Internal server error'
        }), 500