"""
Authentication routes for the Expresso Coffee Ordering System
"""
from flask import Blueprint, request, jsonify, render_template, redirect, url_for, flash, current_app
from werkzeug.security import check_password_hash, generate_password_hash
import logging
from datetime import datetime, timedelta
import secrets
import string
import hashlib

from utils.database import get_db_connection, close_connection
from auth import generate_tokens

# Create a blueprint
bp = Blueprint('auth', __name__, url_prefix='/auth')

# Configure logging
logger = logging.getLogger("expresso.routes.auth")

@bp.route('/login', methods=['GET', 'POST'])
def login():
    """Handle user login - both page render and form submission"""
    if request.method == 'POST':
        # API request - check for JSON
        if request.is_json:
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
            
            # Get database connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            try:
                # Get user from database
                cursor.execute('SELECT id, username, email, password_hash, role, full_name FROM users WHERE username = %s', (username,))
                user_record = cursor.fetchone()
                
                if not user_record:
                    logger.warning(f"Failed login attempt for non-existent user: {username}")
                    return jsonify({
                        'status': 'error',
                        'message': 'Invalid username or password'
                    }), 401
                
                # Extract user data from the record tuple
                user_id = user_record[0]
                user_username = user_record[1]
                user_email = user_record[2]
                password_hash = user_record[3]
                user_role = user_record[4]
                user_full_name = user_record[5] if len(user_record) > 5 else ""
                
                # Check if the format is salt:hash
                if password_hash and ':' in password_hash:
                    # Split salt and hash
                    salt, hash_value = password_hash.split(':', 1)
                    
                    # For debugging
                    logger.debug(f"Found user {username}, checking password with salt:hash format")
                    
                    # This is a simple password verification
                    computed_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
                    password_correct = computed_hash == hash_value
                else:
                    # Assume it's a werkzeug hash
                    logger.debug(f"Found user {username}, checking password with werkzeug format")
                    password_correct = check_password_hash(password_hash, password)
                
                if not password_correct:
                    logger.warning(f"Failed login attempt for user: {username}")
                    return jsonify({
                        'status': 'error',
                        'message': 'Invalid username or password'
                    }), 401
                
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
                    'full_name': user_full_name
                }
                
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
                
            except Exception as e:
                logger.error(f"Error during login: {str(e)}")
                return jsonify({
                    'status': 'error',
                    'message': 'Internal server error'
                }), 500
            finally:
                cursor.close()
                close_connection(conn)
                
        else:
            # Form submission
            username = request.form.get('username')
            password = request.form.get('password')
            
            if not username or not password:
                flash('Username and password are required', 'error')
                return render_template('auth/login.html')
            
            # Get database connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            try:
                # Get user from database
                cursor.execute('SELECT id, username, email, password_hash, role, full_name FROM users WHERE username = %s', (username,))
                user_record = cursor.fetchone()
                
                if not user_record:
                    flash('Invalid username or password', 'error')
                    return render_template('auth/login.html')
                
                # Extract user data
                user_id = user_record[0]
                user_role = user_record[4]
                password_hash = user_record[3]
                
                # Check if the format is salt:hash
                if password_hash and ':' in password_hash:
                    # Split salt and hash
                    salt, hash_value = password_hash.split(':', 1)
                    
                    # Simple password verification
                    computed_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
                    password_correct = computed_hash == hash_value
                else:
                    # Assume it's a werkzeug hash
                    password_correct = check_password_hash(password_hash, password)
                
                if not password_correct:
                    flash('Invalid username or password', 'error')
                    return render_template('auth/login.html')
                
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
                
                # Redirect based on role
                if user_role == 'admin':
                    return redirect(url_for('admin.dashboard'))
                elif user_role == 'staff' or user_role == 'event_organizer':
                    return redirect(url_for('staff.dashboard'))
                elif user_role == 'barista':
                    return redirect(url_for('barista.dashboard'))
                else:
                    return redirect(url_for('customer.dashboard'))
                
            except Exception as e:
                logger.error(f"Error during login form submission: {str(e)}")
                flash('An error occurred during login. Please try again later.', 'error')
                return render_template('auth/login.html')
            finally:
                cursor.close()
                close_connection(conn)
    
    # GET request - render login form
    return render_template('auth/login.html')

@bp.route('/api/auth/login', methods=['POST'])
def api_login():
    """API endpoint for login"""
    return login()

@bp.route('/logout')
def logout():
    """Handle user logout"""
    # For API logout, handle in a separate function
    # This is for web-based logout
    from flask import session
    session.clear()
    flash('You have been logged out', 'info')
    return redirect(url_for('auth.login'))

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

@bp.route('/register', methods=['GET', 'POST'])
def register():
    """Handle user registration if enabled"""
    # Check if registration is enabled
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT value FROM settings WHERE key = 'enable_registration'")
        result = cursor.fetchone()
        registration_enabled = result and result[0].lower() in ('true', 'yes', '1', 't')
        
        if not registration_enabled:
            flash('Registration is currently disabled', 'error')
            return redirect(url_for('auth.login'))
        
        if request.method == 'POST':
            # Process registration form
            username = request.form.get('username')
            email = request.form.get('email')
            password = request.form.get('password')
            confirm_password = request.form.get('confirm_password')
            
            # Validate input
            if not username or not email or not password:
                flash('All fields are required', 'error')
                return render_template('auth/register.html')
            
            if password != confirm_password:
                flash('Passwords do not match', 'error')
                return render_template('auth/register.html')
            
            # Check if username or email already exists
            cursor.execute('SELECT id FROM users WHERE username = %s OR email = %s', (username, email))
            if cursor.fetchone():
                flash('Username or email already exists', 'error')
                return render_template('auth/register.html')
            
            # Generate password hash
            password_hash = generate_password_hash(password)
            
            # Insert new user
            cursor.execute('''
                INSERT INTO users 
                (username, email, password_hash, role, created_at, last_password_change)
                VALUES (%s, %s, %s, %s, %s, %s)
            ''', (username, email, password_hash, 'customer', datetime.now(), datetime.now()))
            conn.commit()
            
            flash('Registration successful! You can now log in.', 'success')
            return redirect(url_for('auth.login'))
        
        # GET request - render registration form
        return render_template('auth/register.html')
    
    except Exception as e:
        logger.error(f"Error during registration: {str(e)}")
        flash('An error occurred during registration', 'error')
        return render_template('auth/register.html')
    
    finally:
        cursor.close()
        close_connection(conn)

@bp.route('/reset-password', methods=['GET', 'POST'])
def reset_password():
    """Handle password reset using a token"""
    token = request.args.get('token')
    
    if not token:
        flash('Invalid password reset link', 'error')
        return redirect(url_for('auth.forgot_password'))
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Find user by reset token
        cursor.execute('''
            SELECT id, reset_token_expiry FROM users 
            WHERE reset_token = %s
        ''', (token,))
        
        user = cursor.fetchone()
        
        if not user:
            flash('Invalid password reset link', 'error')
            return redirect(url_for('auth.forgot_password'))
        
        # Check if token is expired
        user_id, token_expiry = user
        
        if not token_expiry or token_expiry < datetime.now():
            flash('Password reset link has expired', 'error')
            return redirect(url_for('auth.forgot_password'))
        
        if request.method == 'POST':
            # Process password reset form
            password = request.form.get('password')
            confirm_password = request.form.get('confirm_password')
            
            if not password:
                flash('Password is required', 'error')
                return render_template('auth/reset_password.html', token=token)
            
            if password != confirm_password:
                flash('Passwords do not match', 'error')
                return render_template('auth/reset_password.html', token=token)
            
            # Generate new password hash
            password_hash = generate_password_hash(password)
            
            # Update user password and clear reset token
            cursor.execute('''
                UPDATE users 
                SET password_hash = %s,
                    reset_token = NULL,
                    reset_token_expiry = NULL,
                    last_password_change = %s
                WHERE id = %s
            ''', (password_hash, datetime.now(), user_id))
            conn.commit()
            
            flash('Password has been reset successfully. You can now log in with your new password.', 'success')
            return redirect(url_for('auth.login'))
        
        # GET request - render password reset form
        return render_template('auth/reset_password.html', token=token)
    
    except Exception as e:
        logger.error(f"Error during password reset: {str(e)}")
        flash('An error occurred during password reset', 'error')
        return redirect(url_for('auth.login'))
    
    finally:
        cursor.close()
        close_connection(conn)

@bp.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    """Handle forgot password request"""
    if request.method == 'POST':
        email = request.form.get('email')
        
        if not email:
            flash('Email is required', 'error')
            return render_template('auth/forgot_password.html')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Find user by email
            cursor.execute('SELECT id, username FROM users WHERE email = %s', (email,))
            user = cursor.fetchone()
            
            if user:
                user_id, username = user
                
                # Generate reset token
                reset_token = ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(32))
                token_expiry = datetime.now() + timedelta(hours=24)
                
                # Save token to database
                cursor.execute('''
                    UPDATE users 
                    SET reset_token = %s,
                        reset_token_expiry = %s
                    WHERE id = %s
                ''', (reset_token, token_expiry, user_id))
                conn.commit()
                
                # Build reset link
                reset_link = url_for('auth.reset_password', token=reset_token, _external=True)
                
                # Check if email sending is enabled
                cursor.execute("SELECT value FROM settings WHERE key = 'email_enabled'")
                result = cursor.fetchone()
                email_enabled = result and result[0].lower() in ('true', 'yes', '1', 't')
                
                if email_enabled:
                    # Get email service from app context
                    email_service = current_app.config.get('email_service')
                    
                    if email_service:
                        # Send reset email
                        email_service.send_password_reset(email, username, reset_link)
                        
                        flash('Password reset instructions have been sent to your email', 'success')
                        return redirect(url_for('auth.login'))
                
                # If email sending is disabled or no email service, show the link directly
                flash(f'Password reset link: {reset_link}', 'info')
                return render_template('auth/forgot_password.html', reset_link=reset_link)
            
            # Always show a success message even if email not found (security best practice)
            flash('If your email is in our system, you will receive password reset instructions shortly', 'info')
            return redirect(url_for('auth.login'))
        
        except Exception as e:
            logger.error(f"Error during forgot password: {str(e)}")
            flash('An error occurred processing your request', 'error')
            return render_template('auth/forgot_password.html')
        
        finally:
            cursor.close()
            close_connection(conn)
    
    # GET request - render forgot password form
    return render_template('auth/forgot_password.html')

# Auth status endpoint moved to consolidated_api_routes.py