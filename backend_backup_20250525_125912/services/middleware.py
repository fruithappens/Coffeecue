# middleware.py

from functools import wraps
from flask import g, redirect, url_for, flash, request, session, current_app
import sqlite3

def get_user_permissions(user_id):
    """Get permissions for a user"""
    conn = sqlite3.connect(current_app.config['config']['DB_PATH'])
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute(
        "SELECT permission_name FROM user_permissions WHERE user_id = ?", 
        (user_id,)
    )
    
    permissions = [row['permission_name'] for row in cursor.fetchall()]
    conn.close()
    
    return permissions

def check_permission(permission):
    """Decorator to check if a user has a specific permission"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            # Check if user is logged in
            if g.user is None:
                flash("Please log in to access this page", "warning")
                return redirect(url_for('auth.login', next=request.url))
            
            # Admin always has access to everything
            if g.user['role'] == 'admin':
                return f(*args, **kwargs)
            
            # Check specific permission
            permissions = get_user_permissions(g.user['id'])
            if permission not in permissions:
                flash("You don't have permission to access this page", "error")
                
                # Redirect based on role
                if g.user['role'] == 'staff':
                    return redirect(url_for('staff.dashboard'))
                elif g.user['role'] == 'barista':
                    return redirect(url_for('barista.dashboard'))
                else:
                    return redirect(url_for('auth.login'))
            
            return f(*args, **kwargs)
        return decorated_function
    return decorator

def admin_required(f):
    """Decorator to ensure only admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if g.user is None:
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
        if g.user["role"] != "admin":
            flash("You need administrator privileges to access this page", "error")
            return redirect(url_for('auth.login'))
            
        return f(*args, **kwargs)
    return decorated_function

def staff_required(f):
    """Decorator to ensure only staff or admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if g.user is None:
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
        if g.user["role"] not in ["admin", "staff"]:
            flash("You need staff privileges to access this page", "error")
            return redirect(url_for('auth.login'))
            
        return f(*args, **kwargs)
    return decorated_function

def barista_required(f):
    """Decorator to ensure only baristas, staff, or admins can access a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if g.user is None:
            flash("Please log in to access this page", "warning")
            return redirect(url_for('auth.login', next=request.url))
            
        if g.user["role"] not in ["admin", "staff", "barista"]:
            flash("You need barista privileges to access this page", "error")
            return redirect(url_for('auth.login'))
            
        return f(*args, **kwargs)
    return decorated_function