"""
Simple User API Routes using PostgreSQL directly.

Registered at /api/users (with trailing slash). Flask 308-redirects
/api/users → /api/users/ so the frontend hits this regardless of
whether it included the trailing slash.

This file replaced an earlier version that used the strict
@jwt_required_with_demo() decorator and rejected demo / offline tokens. The
Organiser's User Management 'Add User' button was failing with
'Authorization required' for any demo-logged-in operator because
of that. Now uses jwt_required_with_demo + g.user (set by
load_user_from_jwt in auth.py) so demo and real tokens both work.

Field-name compat: the frontend posts `fullName` (camelCase) but
the DB column is full_name. Accept either form.
"""
from flask import Blueprint, request, jsonify, current_app, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash
from datetime import datetime
from psycopg2.extras import RealDictCursor
import logging

from auth import jwt_required_with_demo

logger = logging.getLogger(__name__)

bp = Blueprint('users_simple_api', __name__, url_prefix='/api/users')

@bp.route('/', methods=['GET'])
@jwt_required_with_demo()
def get_users():
    """Get all users"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Get query parameters
        role = request.args.get('role')
        
        # Build query
        query = "SELECT id, username, email, full_name, role, created_at, last_login FROM users WHERE 1=1"
        params = []
        
        if role:
            query += " AND role = %s"
            params.append(role)
            
        query += " ORDER BY created_at DESC"
        
        cursor.execute(query, params)
        users = cursor.fetchall()
        
        # Format users data
        users_data = []
        for user in users:
            user_dict = dict(user)
            # Convert datetime objects to ISO format
            if user_dict.get('created_at'):
                user_dict['created_at'] = user_dict['created_at'].isoformat()
            if user_dict.get('last_login'):
                user_dict['last_login'] = user_dict['last_login'].isoformat()
            users_data.append(user_dict)
        
        return jsonify({
            'status': 'success',
            'data': users_data,
            'count': len(users_data)
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting users: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Failed to get users'
        }), 500

@bp.route('/<int:user_id>', methods=['GET'])
@jwt_required_with_demo()
def get_user(user_id):
    """Get a specific user"""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute(
            "SELECT id, username, email, full_name, role, created_at, last_login FROM users WHERE id = %s",
            (user_id,)
        )
        user = cursor.fetchone()
        
        if not user:
            return jsonify({
                'status': 'error',
                'message': 'User not found'
            }), 404
            
        user_dict = dict(user)
        if user_dict.get('created_at'):
            user_dict['created_at'] = user_dict['created_at'].isoformat()
        if user_dict.get('last_login'):
            user_dict['last_login'] = user_dict['last_login'].isoformat()
            
        return jsonify({
            'status': 'success',
            'data': user_dict
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting user: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Failed to get user'
        }), 500

@bp.route('/', methods=['POST'])
@jwt_required_with_demo()
def create_user():
    """Create a new user.

    Role check: look at the role on g.user (set by
    load_user_from_jwt — works for both demo and real tokens). Was
    looking up the user via current_user_id and DB query, which
    failed for demo users (their id is a string like 'demo_user' not
    a real users.id). Now anyone with admin/organizer/staff role —
    real or demo — can create.

    Field-name compat: frontend sends `fullName` (camelCase from
    UserManagementTab). Older clients sent `full_name`. Accept
    either form.
    """
    try:
        # Role check via g.user (works for demo + real).
        user = getattr(g, 'user', None) or {}
        role = (user.get('role') or '').lower()
        if role not in ('admin', 'organizer', 'staff'):
            return jsonify({
                'status': 'error',
                'message': 'Insufficient permissions (need admin/organizer/staff role)'
            }), 403

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor()

        data = request.get_json() or {}

        # Normalize fullName <-> full_name so either case works.
        full_name = data.get('full_name') or data.get('fullName') or ''
        if full_name and 'full_name' not in data:
            data['full_name'] = full_name

        # Validate required fields (after the camelCase normalisation).
        required = ['username', 'password', 'email', 'full_name', 'role']
        for field in required:
            if not data.get(field):
                return jsonify({
                    'status': 'error',
                    'message': f'Missing required field: {field}'
                }), 400

        # Check if username exists (case-insensitive — login matches on
        # LOWER(username), so we must block "Treenet1" when "treenet1" exists,
        # otherwise two accounts would collide at login time).
        cursor.execute("SELECT id FROM users WHERE LOWER(username) = LOWER(%s)", (data['username'],))
        if cursor.fetchone():
            return jsonify({
                'status': 'error',
                'message': 'Username already exists'
            }), 400

        # Create user
        password_hash = generate_password_hash(data['password'])
        cursor.execute("""
            INSERT INTO users (username, email, password_hash, role, full_name, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            data['username'],
            data['email'],
            password_hash,
            data['role'],
            data['full_name'],
            datetime.utcnow()
        ))

        user_id = cursor.fetchone()[0]
        db.commit()

        return jsonify({
            'status': 'success',
            'message': 'User created successfully',
            'data': {
                'id': user_id,
                'username': data['username']
            }
        }), 201

    except Exception as e:
        logger.error(f"Error creating user: {e}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'status': 'error',
            'message': f'Failed to create user: {e}'
        }), 500