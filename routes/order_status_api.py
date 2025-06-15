"""
Order Status Update API Routes
"""
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
from psycopg2.extras import RealDictCursor
import logging
import json

logger = logging.getLogger(__name__)

bp = Blueprint('order_status_api', __name__, url_prefix='/api/orders')

@bp.route('/<order_id>/status', methods=['PUT'])
@jwt_required()
def update_order_status(order_id):
    """Update the status of an order"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Get request data
        data = request.get_json()
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No data provided'
            }), 400
            
        new_status = data.get('status')
        if not new_status:
            return jsonify({
                'status': 'error',
                'message': 'Status is required'
            }), 400
            
        # Validate status
        valid_statuses = ['pending', 'in_progress', 'completed', 'cancelled', 'ready', 'picked_up']
        if new_status not in valid_statuses:
            return jsonify({
                'status': 'error',
                'message': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'
            }), 400
            
        # Get current user
        current_user_id = get_jwt_identity()
        
        # Get the order - check if order_id is numeric or alphanumeric
        if order_id.isdigit():
            cursor.execute("""
                SELECT id, order_number, status, order_details, station_id 
                FROM orders 
                WHERE id = %s OR order_number = %s
            """, (int(order_id), order_id))
        else:
            # order_id is actually an order_number (alphanumeric)
            cursor.execute("""
                SELECT id, order_number, status, order_details, station_id 
                FROM orders 
                WHERE order_number = %s
            """, (order_id,))
        
        order = cursor.fetchone()
        if not order:
            return jsonify({
                'status': 'error',
                'message': 'Order not found'
            }), 404
            
        # Parse order details - RealDictCursor already converts JSONB to dict
        if isinstance(order['order_details'], str):
            order_details = json.loads(order['order_details']) if order['order_details'] else {}
        else:
            order_details = order['order_details'] if order['order_details'] else {}
        
        # Update order based on status
        update_data = {
            'status': new_status,
            'updated_at': datetime.utcnow()
        }
        
        # Add status-specific fields
        if new_status == 'in_progress':
            # Update station if provided
            if 'station_id' in data:
                update_data['station_id'] = data['station_id']
                
        elif new_status == 'completed':
            # Set completed_at if the column exists
            update_data['completed_at'] = data.get('completed_at', datetime.utcnow())
                
        elif new_status == 'cancelled':
            # Add cancellation fields if needed
            pass
            
        elif new_status == 'picked_up':
            # Set picked up timestamp
            update_data['picked_up_at'] = data.get('picked_up_at', datetime.utcnow())
            
        # Build update query
        update_fields = []
        update_values = []
        for field, value in update_data.items():
            update_fields.append(f"{field} = %s")
            update_values.append(value)
            
        update_values.append(order['id'])
        
        cursor.execute(f"""
            UPDATE orders 
            SET {', '.join(update_fields)}
            WHERE id = %s
            RETURNING *
        """, update_values)
        
        updated_order = cursor.fetchone()
        db.commit()
        
        # Send WebSocket notification
        try:
            socketio = current_app.config.get('socketio')
            if socketio:
                # Prepare order data for WebSocket
                ws_data = {
                    'id': updated_order['id'],
                    'order_number': updated_order['order_number'],
                    'status': updated_order['status'],
                    'station_id': updated_order['station_id'],
                    'updated_at': updated_order['updated_at'].isoformat() if updated_order['updated_at'] else None,
                    'barista_id': updated_order.get('barista_id'),
                    **order_details
                }
                
                # Emit to all connected clients
                socketio.emit('order_updated', ws_data, room='orders')
                
                # Emit to specific station room
                if updated_order['station_id']:
                    socketio.emit('order_status_changed', ws_data, room=f"station_{updated_order['station_id']}")
                    
                logger.info(f"WebSocket notification sent for order {updated_order['order_number']} status change to {new_status}")
                
        except Exception as ws_error:
            logger.error(f"Error sending WebSocket notification: {ws_error}")
            
        # Send SMS notification for completed orders
        if new_status == 'completed' and order_details.get('phone'):
            try:
                messaging_service = current_app.config.get('messaging_service')
                if messaging_service:
                    customer_name = order_details.get('name', 'there')
                    station_name = f"Station {updated_order['station_id']}" if updated_order['station_id'] else "the counter"
                    
                    message = f"Hi {customer_name}! Your order #{updated_order['order_number']} is ready for pickup at {station_name}. Enjoy your coffee!"
                    
                    messaging_service.send_message(order_details['phone'], message)
                    logger.info(f"SMS notification sent for completed order {updated_order['order_number']}")
                    
            except Exception as sms_error:
                logger.error(f"Error sending SMS notification: {sms_error}")
                
        # Format response
        response_data = dict(updated_order)
        response_data['updated_at'] = response_data['updated_at'].isoformat() if response_data['updated_at'] else None
        response_data['created_at'] = response_data['created_at'].isoformat() if response_data['created_at'] else None
        response_data['started_at'] = response_data['started_at'].isoformat() if response_data.get('started_at') else None
        response_data['completed_at'] = response_data['completed_at'].isoformat() if response_data.get('completed_at') else None
        
        return jsonify({
            'status': 'success',
            'message': f'Order status updated to {new_status}',
            'data': response_data
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating order status: {e}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'status': 'error',
            'message': 'Failed to update order status'
        }), 500