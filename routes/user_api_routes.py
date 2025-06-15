"""
User Management API Routes
Handles user profiles, skills, and performance tracking
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import logging

from models.users import User
from models.orders import Order
from utils.database import db

logger = logging.getLogger(__name__)

user_api_bp = Blueprint('user_api', __name__, url_prefix='/api/users')

@user_api_bp.route('/', methods=['GET'])
@jwt_required()
def get_users():
    """Get all users with optional filtering"""
    try:
        # Get query parameters
        role = request.args.get('role')
        active_only = request.args.get('active', 'true').lower() == 'true'
        
        # Build query
        query = User.query
        if role:
            query = query.filter_by(role=role)
        if active_only:
            query = query.filter_by(active=True)
        
        users = query.all()
        
        # Format response
        users_data = []
        for user in users:
            # Calculate stats
            total_orders = Order.query.filter_by(barista_id=user.id, status='completed').count()
            
            # Calculate average prep time
            completed_orders = Order.query.filter_by(
                barista_id=user.id, 
                status='completed'
            ).filter(
                Order.started_at.isnot(None),
                Order.completed_at.isnot(None)
            ).all()
            
            avg_prep_time = 0
            if completed_orders:
                total_time = sum(
                    (order.completed_at - order.started_at).total_seconds() / 60
                    for order in completed_orders
                )
                avg_prep_time = round(total_time / len(completed_orders), 1)
            
            user_data = {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'full_name': user.full_name,
                'role': user.role,
                'phone': user.phone,
                'active': user.active,
                'experience': getattr(user, 'experience', 'beginner'),
                'skills': getattr(user, 'skills', {}),
                'preferred_station': getattr(user, 'preferred_station', None),
                'created_at': user.created_at.isoformat() if user.created_at else None,
                'stats': {
                    'total_orders': total_orders,
                    'avg_prep_time': avg_prep_time,
                    'rating': getattr(user, 'rating', 0)
                }
            }
            users_data.append(user_data)
        
        return jsonify({
            'status': 'success',
            'data': {
                'users': users_data,
                'total': len(users_data)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting users: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get users'}), 500

@user_api_bp.route('/', methods=['POST'])
@jwt_required()
def create_user():
    """Create a new user"""
    try:
        # Check if current user is admin or organizer
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        if not current_user or current_user.role not in ['admin', 'organizer']:
            return jsonify({'status': 'error', 'message': 'Insufficient permissions'}), 403
        
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['username', 'password', 'full_name', 'role']
        for field in required_fields:
            if field not in data:
                return jsonify({'status': 'error', 'message': f'Missing required field: {field}'}), 400
        
        # Check if username exists
        if User.query.filter_by(username=data['username']).first():
            return jsonify({'status': 'error', 'message': 'Username already exists'}), 400
        
        # Create user
        user = User(
            username=data['username'],
            password_hash=generate_password_hash(data['password']),
            email=data.get('email', ''),
            full_name=data['full_name'],
            role=data['role'],
            phone=data.get('phone', ''),
            active=data.get('active', True)
        )
        
        # Add additional fields if provided
        if 'experience' in data:
            user.experience = data['experience']
        if 'skills' in data:
            user.skills = data['skills']
        if 'preferred_station' in data:
            user.preferred_station = data['preferred_station']
        if 'notes' in data:
            user.notes = data['notes']
        
        db.session.add(user)
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('user_created', {
            'user_id': user.id,
            'username': user.username,
            'full_name': user.full_name,
            'role': user.role
        }, room='user_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'User created successfully',
            'data': {
                'user_id': user.id,
                'username': user.username
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to create user'}), 500

@user_api_bp.route('/<int:user_id>', methods=['GET'])
@jwt_required()
def get_user(user_id):
    """Get a specific user's details"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        # Get detailed stats
        total_orders = Order.query.filter_by(barista_id=user.id, status='completed').count()
        today_orders = Order.query.filter_by(
            barista_id=user.id, 
            status='completed'
        ).filter(
            Order.completed_at >= datetime.utcnow().date()
        ).count()
        
        # Get recent orders
        recent_orders = Order.query.filter_by(
            barista_id=user.id
        ).order_by(Order.created_at.desc()).limit(10).all()
        
        recent_orders_data = [{
            'id': order.id,
            'customer_name': order.customer_name,
            'coffee_type': order.coffee_type,
            'status': order.status,
            'created_at': order.created_at.isoformat()
        } for order in recent_orders]
        
        user_data = {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'full_name': user.full_name,
            'role': user.role,
            'phone': user.phone,
            'active': user.active,
            'experience': getattr(user, 'experience', 'beginner'),
            'skills': getattr(user, 'skills', {}),
            'preferred_station': getattr(user, 'preferred_station', None),
            'notes': getattr(user, 'notes', ''),
            'created_at': user.created_at.isoformat() if user.created_at else None,
            'stats': {
                'total_orders': total_orders,
                'today_orders': today_orders,
                'rating': getattr(user, 'rating', 0)
            },
            'recent_orders': recent_orders_data
        }
        
        return jsonify({
            'status': 'success',
            'data': user_data
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting user: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get user'}), 500

@user_api_bp.route('/<int:user_id>', methods=['PUT'])
@jwt_required()
def update_user(user_id):
    """Update a user's information"""
    try:
        # Check permissions
        current_user_id = get_jwt_identity()
        current_user = User.query.get(current_user_id)
        
        # Users can update their own profile, admins/organizers can update anyone
        if current_user_id != user_id and current_user.role not in ['admin', 'organizer']:
            return jsonify({'status': 'error', 'message': 'Insufficient permissions'}), 403
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        data = request.get_json()
        
        # Update fields if provided
        if 'email' in data:
            user.email = data['email']
        if 'full_name' in data:
            user.full_name = data['full_name']
        if 'phone' in data:
            user.phone = data['phone']
        if 'active' in data and current_user.role in ['admin', 'organizer']:
            user.active = data['active']
        if 'role' in data and current_user.role == 'admin':
            user.role = data['role']
        if 'experience' in data:
            user.experience = data['experience']
        if 'skills' in data:
            user.skills = data['skills']
        if 'preferred_station' in data:
            user.preferred_station = data['preferred_station']
        if 'notes' in data:
            user.notes = data['notes']
        if 'password' in data:
            user.password_hash = generate_password_hash(data['password'])
        
        user.updated_at = datetime.utcnow()
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('user_updated', {
            'user_id': user.id,
            'updated_fields': list(data.keys())
        }, room='user_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'User updated successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating user: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update user'}), 500

@user_api_bp.route('/<int:user_id>/stats', methods=['GET'])
@jwt_required()
def get_user_stats(user_id):
    """Get detailed statistics for a user"""
    try:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404
        
        # Get order statistics
        total_orders = Order.query.filter_by(barista_id=user.id, status='completed').count()
        
        # Orders by time period
        today = datetime.utcnow().date()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)
        
        today_orders = Order.query.filter_by(
            barista_id=user.id, 
            status='completed'
        ).filter(Order.completed_at >= today).count()
        
        week_orders = Order.query.filter_by(
            barista_id=user.id, 
            status='completed'
        ).filter(Order.completed_at >= week_ago).count()
        
        month_orders = Order.query.filter_by(
            barista_id=user.id, 
            status='completed'
        ).filter(Order.completed_at >= month_ago).count()
        
        # Performance metrics
        completed_orders = Order.query.filter_by(
            barista_id=user.id, 
            status='completed'
        ).filter(
            Order.started_at.isnot(None),
            Order.completed_at.isnot(None)
        ).all()
        
        prep_times = []
        for order in completed_orders:
            prep_time = (order.completed_at - order.started_at).total_seconds() / 60
            prep_times.append(prep_time)
        
        avg_prep_time = round(sum(prep_times) / len(prep_times), 1) if prep_times else 0
        min_prep_time = round(min(prep_times), 1) if prep_times else 0
        max_prep_time = round(max(prep_times), 1) if prep_times else 0
        
        # Coffee type distribution
        coffee_types = db.session.query(
            Order.coffee_type, 
            db.func.count(Order.id)
        ).filter_by(
            barista_id=user.id, 
            status='completed'
        ).group_by(Order.coffee_type).all()
        
        coffee_distribution = {coffee: count for coffee, count in coffee_types}
        
        stats = {
            'user_id': user.id,
            'full_name': user.full_name,
            'orders': {
                'total': total_orders,
                'today': today_orders,
                'this_week': week_orders,
                'this_month': month_orders
            },
            'performance': {
                'avg_prep_time': avg_prep_time,
                'min_prep_time': min_prep_time,
                'max_prep_time': max_prep_time,
                'total_prep_times': len(prep_times)
            },
            'coffee_distribution': coffee_distribution,
            'rating': getattr(user, 'rating', 0),
            'experience': getattr(user, 'experience', 'beginner')
        }
        
        return jsonify({
            'status': 'success',
            'data': stats
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting user stats: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get user statistics'}), 500