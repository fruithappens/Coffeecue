# middleware.py

from functools import wraps
from flask import g, redirect, url_for, flash, request, session, current_app, jsonify
from psycopg2.extras import RealDictCursor

def get_user_permissions(user_id):
    """Get permissions for a user"""
    from utils.database import get_db_connection, close_connection
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    cursor.execute(
        "SELECT permission_name FROM user_permissions WHERE user_id = %s", 
        (user_id,)
    )
    
    permissions = [row['permission_name'] for row in cursor.fetchall()]
    cursor.close()
    close_connection(conn)
    
    return permissions

def check_permission(permission):
    """Decorator to check if a user has a specific permission"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            try:
                # Verify JWT token
                from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
                
                verify_jwt_in_request()
                claims = get_jwt()
                current_user = get_jwt_identity()
                
                # Admin always has access to everything
                if claims.get('role') == 'admin':
                    return f(*args, **kwargs)
                
                # Check specific permission
                permissions = get_user_permissions(current_user)
                if permission not in permissions:
                    if request.is_json or request.path.startswith('/api/'):
                        return jsonify({
                            'status': 'error',
                            'message': 'Insufficient permissions'
                        }), 403
                    
                    flash("You don't have permission to access this page", "error")
                    
                    # Redirect based on role
                    if claims.get('role') == 'event_organizer':
                        return redirect(url_for('staff.dashboard'))
                    elif claims.get('role') == 'barista':
                        return redirect(url_for('barista.dashboard'))
                    else:
                        return redirect(url_for('auth.login'))
                
                return f(*args, **kwargs)
            
            except Exception as e:
                # JWT validation error - user is not authenticated
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({
                        'status': 'error',
                        'message': 'Authentication required'
                    }), 401
                
                flash("Please log in to access this page", "warning")
                return redirect(url_for('auth.login', next=request.url))
        
        return decorated_function
    return decorator

def admin_required(f):
    """Decorator to ensure only admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            # Verify JWT token
            from flask_jwt_extended import verify_jwt_in_request, get_jwt
            
            verify_jwt_in_request()
            claims = get_jwt()
            
            if claims.get('role') != "admin":
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({
                        'status': 'error',
                        'message': 'Admin privileges required'
                    }), 403
                
                flash("You need administrator privileges to access this page", "error")
                return redirect(url_for('auth.login'))
                
            return f(*args, **kwargs)
        
        except Exception as e:
            # JWT validation error - user is not authenticated
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({
                    'status': 'error',
                    'message': 'Authentication required'
                }), 401
            
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
    return decorated_function

def staff_required(f):
    """Decorator to ensure only staff or admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            # Verify JWT token
            from flask_jwt_extended import verify_jwt_in_request, get_jwt
            
            verify_jwt_in_request()
            claims = get_jwt()
            
            if claims.get('role') not in ["admin", "event_organizer", "staff"]:
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({
                        'status': 'error',
                        'message': 'Staff privileges required'
                    }), 403
                
                flash("You need staff privileges to access this page", "error")
                return redirect(url_for('auth.login'))
                
            return f(*args, **kwargs)
        
        except Exception as e:
            # JWT validation error - user is not authenticated
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({
                    'status': 'error',
                    'message': 'Authentication required'
                }), 401
            
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
    return decorated_function

def barista_required(f):
    """Decorator to ensure only baristas, staff, or admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            # Verify JWT token
            from flask_jwt_extended import verify_jwt_in_request, get_jwt
            
            verify_jwt_in_request()
            claims = get_jwt()
            
            if claims.get('role') not in ["admin", "event_organizer", "staff", "barista"]:
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({
                        'status': 'error',
                        'message': 'Barista privileges required'
                    }), 403
                
                flash("You need barista privileges to access this page", "error")
                return redirect(url_for('auth.login'))
                
            return f(*args, **kwargs)
        
        except Exception as e:
            # JWT validation error - user is not authenticated
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({
                    'status': 'error',
                    'message': 'Authentication required'
                }), 401
            
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
    return decorated_function

def support_required(f):
    """Decorator to ensure only support staff, staff, or admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            # Verify JWT token
            from flask_jwt_extended import verify_jwt_in_request, get_jwt
            
            verify_jwt_in_request()
            claims = get_jwt()
            
            if claims.get('role') not in ["admin", "event_organizer", "staff", "support"]:
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({
                        'status': 'error',
                        'message': 'Support privileges required'
                    }), 403
                
                flash("You need support staff privileges to access this page", "error")
                return redirect(url_for('auth.login'))
                
            return f(*args, **kwargs)
        
        except Exception as e:
            # JWT validation error - user is not authenticated
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({
                    'status': 'error',
                    'message': 'Authentication required'
                }), 401
            
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
    return decorated_function

def optional_jwt_required(f):
    """Decorator to handle optional JWT authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            from flask_jwt_extended import verify_jwt_in_request
            verify_jwt_in_request(optional=True)
        except Exception:
            # JWT validation failed, but that's okay since it's optional
            pass
        return f(*args, **kwargs)
    return decorated_function

def get_current_user_id():
    """Get the current user's ID from JWT or session"""
    try:
        # Try JWT first
        from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
        
        verify_jwt_in_request(optional=True)
        current_user = get_jwt_identity()
        if current_user:
            return current_user
            
        # Fall back to session if needed (for backward compatibility)
        if hasattr(g, 'user') and g.user and g.user.get('id'):
            return g.user.get('id')
            
        # No authenticated user
        return None
    except Exception:
        # JWT validation failed, fall back to session
        if hasattr(g, 'user') and g.user and g.user.get('id'):
            return g.user.get('id')
        return None