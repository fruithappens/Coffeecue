"""
Group Order API Routes
Handles batch/group order processing
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
import logging

from models.orders import Order
from models.stations import Station
from utils.database import db
from services.messaging import MessagingService
from services.coffee_system import CoffeeOrderSystem

logger = logging.getLogger(__name__)

group_order_bp = Blueprint('group_order', __name__, url_prefix='/api/group-orders')

@group_order_bp.route('/', methods=['POST'])
@jwt_required()
def create_group_order():
    """Create multiple orders from a group"""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data or 'orders' not in data or 'groupName' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid group order data'}), 400
        
        group_name = data['groupName']
        group_code = data.get('groupCode', '')
        group_notes = data.get('notes', '')
        orders_data = data['orders']
        
        if not orders_data:
            return jsonify({'status': 'error', 'message': 'No orders in group'}), 400
        
        # Initialize services
        messaging_service = MessagingService()
        coffee_system = CoffeeOrderSystem(db)
        
        created_orders = []
        failed_orders = []
        
        # Process each order in the group
        for idx, order_data in enumerate(orders_data):
            try:
                # Create order
                order = Order(
                    customer_name=order_data.get('name', f'Group {group_name} #{idx+1}'),
                    phone_number=order_data.get('phone', f'Group-{group_code}'),
                    coffee_type=f"{order_data.get('size', 'Regular')} {order_data.get('coffeeType', 'Flat White')}",
                    milk_type=order_data.get('milkType', 'Full cream'),
                    sugar=order_data.get('sugar', 'No sugar'),
                    extra_hot=order_data.get('extraHot', False),
                    status='pending',
                    source='group_order',
                    batch_group=group_code,
                    notes=f"Group: {group_name} - {order_data.get('notes', '')}"
                )
                
                # Set priority if specified
                if 'priority' in data or 'vip' in group_notes.lower():
                    order.priority = True
                
                db.session.add(order)
                db.session.flush()
                
                created_orders.append({
                    'id': order.id,
                    'customer_name': order.customer_name,
                    'coffee_type': order.coffee_type,
                    'order_number': order.order_number
                })
                
                # Send confirmation if phone number is valid
                if order.phone_number and not order.phone_number.startswith('Group-'):
                    try:
                        messaging_service.send_order_confirmation(
                            order.phone_number,
                            order.id,
                            order.coffee_type,
                            5  # Default wait time
                        )
                    except Exception as e:
                        logger.warning(f"Failed to send SMS for order {order.id}: {e}")
                
            except Exception as e:
                logger.error(f"Failed to create order for {order_data.get('name', 'Unknown')}: {e}")
                failed_orders.append({
                    'name': order_data.get('name', 'Unknown'),
                    'error': str(e)
                })
        
        # Commit all successful orders
        db.session.commit()
        
        # Emit WebSocket event for new group order
        from app import socketio
        socketio.emit('group_order_created', {
            'group_name': group_name,
            'group_code': group_code,
            'order_count': len(created_orders),
            'orders': created_orders,
            'timestamp': datetime.utcnow().isoformat()
        }, room='all_stations')
        
        return jsonify({
            'status': 'success',
            'message': f'Group order created: {len(created_orders)} orders successful',
            'data': {
                'group_name': group_name,
                'group_code': group_code,
                'created_orders': created_orders,
                'failed_orders': failed_orders,
                'total_attempted': len(orders_data),
                'total_created': len(created_orders),
                'total_failed': len(failed_orders)
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating group order: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to create group order'}), 500

@group_order_bp.route('/validate-code/<code>', methods=['GET'])
@jwt_required()
def validate_group_code(code):
    """Validate a group code and return group details"""
    try:
        # Check if any orders exist with this batch group code
        existing_orders = Order.query.filter_by(batch_group=code).first()
        
        if existing_orders:
            # Get group details from orders
            group_orders = Order.query.filter_by(batch_group=code).all()
            
            group_data = {
                'code': code,
                'order_count': len(group_orders),
                'status': 'active',
                'orders': [{
                    'id': order.id,
                    'customer_name': order.customer_name,
                    'coffee_type': order.coffee_type,
                    'status': order.status
                } for order in group_orders]
            }
            
            return jsonify({
                'status': 'success',
                'data': group_data
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'message': 'Group code not found'
            }), 404
            
    except Exception as e:
        logger.error(f"Error validating group code: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to validate group code'}), 500

@group_order_bp.route('/by-code/<code>', methods=['GET'])
@jwt_required()
def get_group_orders(code):
    """Get all orders for a group code"""
    try:
        orders = Order.query.filter_by(batch_group=code).all()
        
        if not orders:
            return jsonify({
                'status': 'error',
                'message': 'No orders found for this group code'
            }), 404
        
        orders_data = [{
            'id': order.id,
            'order_number': order.order_number,
            'customer_name': order.customer_name,
            'coffee_type': order.coffee_type,
            'milk_type': order.milk_type,
            'sugar': order.sugar,
            'status': order.status,
            'station_id': order.station_id,
            'created_at': order.created_at.isoformat() if order.created_at else None,
            'completed_at': order.completed_at.isoformat() if order.completed_at else None
        } for order in orders]
        
        # Group statistics
        stats = {
            'total': len(orders),
            'pending': len([o for o in orders if o.status == 'pending']),
            'in_progress': len([o for o in orders if o.status == 'in_progress']),
            'completed': len([o for o in orders if o.status == 'completed'])
        }
        
        return jsonify({
            'status': 'success',
            'data': {
                'group_code': code,
                'orders': orders_data,
                'stats': stats
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting group orders: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get group orders'}), 500