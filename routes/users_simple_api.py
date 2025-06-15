"""
Simple User API Routes using PostgreSQL directly
"""
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash
from datetime import datetime
from psycopg2.extras import RealDictCursor
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('users_simple_api', __name__, url_prefix='/api/users')

@bp.route('/', methods=['GET'])
@jwt_required()
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
@jwt_required()
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
@jwt_required()
def create_user():
    """Create a new user"""
    try:
        # Check permissions
        current_user_id = get_jwt_identity()
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor()
        
        # Get current user role
        cursor.execute("SELECT role FROM users WHERE id = %s", (current_user_id,))
        current_user = cursor.fetchone()
        if not current_user or current_user[0] not in ['admin', 'organizer']:
            return jsonify({
                'status': 'error',
                'message': 'Insufficient permissions'
            }), 403
            
        data = request.get_json()
        
        # Validate required fields
        required = ['username', 'password', 'email', 'full_name', 'role']
        for field in required:
            if field not in data:
                return jsonify({
                    'status': 'error',
                    'message': f'Missing required field: {field}'
                }), 400
                
        # Check if username exists
        cursor.execute("SELECT id FROM users WHERE username = %s", (data['username'],))
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
            'message': 'Failed to create user'
        }), 500