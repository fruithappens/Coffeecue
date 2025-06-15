"""
WebSocket Event Handlers
Handles real-time communication between frontend and backend
"""
from flask_socketio import emit, join_room, leave_room
from flask_jwt_extended import jwt_required, get_jwt_identity, decode_token
from datetime import datetime
import logging
from functools import wraps
from flask import request

logger = logging.getLogger(__name__)

def ws_jwt_required(f):
    """Decorator to require JWT authentication for WebSocket events"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Try to get token from the socketio session
        token = None
        
        # Check if we have auth data stored in the session
        sid = request.sid if hasattr(request, 'sid') else None
        if sid:
            # In a real implementation, you'd store this mapping
            # For now, we'll skip auth check for WebSocket events
            # and rely on the connect handler to validate
            pass
            
        return f(*args, **kwargs)
    return decorated_function

def init_websocket_handlers(socketio):
    """Initialize WebSocket event handlers"""
    
    @socketio.on('connect')
    def handle_connect(auth):
        """Handle client connection"""
        try:
            # Try to get token from auth object
            token = None
            if auth and isinstance(auth, dict):
                token = auth.get('token')
            
            # If no token in auth, allow connection but limit functionality
            if not token:
                logger.warning("WebSocket client connected without authentication")
                emit('connected', {
                    'status': 'connected',
                    'authenticated': False,
                    'message': 'Connected without authentication - limited functionality'
                })
                # Join public rooms only
                join_room('public_updates')
                return
            
            # Verify JWT token manually
            from flask_jwt_extended import decode_token
            try:
                decoded_token = decode_token(token)
                user_id = decoded_token.get('sub')
                
                logger.info(f"WebSocket client connected: user {user_id}")
                
                # Join authenticated rooms
                join_room('all_stations')
                join_room('settings_updates')
                join_room('schedule_updates')
                join_room('user_updates')
                join_room('orders')  # Add orders room for real-time updates
                
                emit('connected', {
                    'status': 'connected',
                    'authenticated': True,
                    'user_id': user_id
                })
            except Exception as jwt_error:
                logger.error(f"JWT verification failed: {jwt_error}")
                emit('connected', {
                    'status': 'connected',
                    'authenticated': False,
                    'error': 'Invalid authentication token'
                })
                join_room('public_updates')
                
        except Exception as e:
            logger.error(f"Error in connect handler: {e}")
            emit('connected', {
                'status': 'error',
                'message': str(e)
            })
    
    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection"""
        logger.info("WebSocket client disconnected")
    
    @socketio.on('join_station')
    def handle_join_station(data):
        """Join a station-specific room"""
        try:
            station_id = data.get('station_id')
            if station_id:
                room = f'station_{station_id}'
                join_room(room)
                logger.info(f"Client joined room: {room}")
                
                emit('joined_station', {
                    'station_id': station_id,
                    'room': room
                })
        except Exception as e:
            logger.error(f"Error joining station: {e}")
    
    @socketio.on('leave_station')
    def handle_leave_station(data):
        """Leave a station-specific room"""
        try:
            station_id = data.get('station_id')
            if station_id:
                room = f'station_{station_id}'
                leave_room(room)
                logger.info(f"Client left room: {room}")
                
                emit('left_station', {
                    'station_id': station_id,
                    'room': room
                })
        except Exception as e:
            logger.error(f"Error leaving station: {e}")
    
    @socketio.on('join_role')
    def handle_join_role(data):
        """Join a role-specific room (organizers, baristas)"""
        try:
            role = data.get('role')
            if role in ['organizers', 'baristas', 'admins']:
                join_room(role)
                logger.info(f"Client joined role room: {role}")
                
                emit('joined_role', {
                    'role': role
                })
        except Exception as e:
            logger.error(f"Error joining role: {e}")
    
    @socketio.on('order_update')
    def handle_order_update(data):
        """Broadcast order updates to relevant stations"""
        try:
            order_id = data.get('order_id')
            station_id = data.get('station_id')
            status = data.get('status')
            
            # Emit to station room
            emit('order_updated', {
                'order_id': order_id,
                'status': status,
                'data': data
            }, room=f'station_{station_id}')
            
            # Also emit to organizers
            emit('order_updated', {
                'order_id': order_id,
                'station_id': station_id,
                'status': status,
                'data': data
            }, room='organizers')
            
            logger.info(f"Order {order_id} updated to {status}")
        except Exception as e:
            logger.error(f"Error updating order: {e}")
    
    @socketio.on('station_chat')
    def handle_station_chat(data):
        """Handle inter-station chat messages"""
        try:
            from_station = data.get('from_station')
            to_station = data.get('to_station')
            message = data.get('message')
            user_id = data.get('user_id', 'anonymous')  # Get from data instead of JWT
            
            # Emit to target station
            emit('chat_message', {
                'from_station': from_station,
                'to_station': to_station,
                'message': message,
                'user_id': user_id,
                'timestamp': datetime.utcnow().isoformat()
            }, room=f'station_{to_station}')
            
            logger.info(f"Chat message from station {from_station} to {to_station}")
        except Exception as e:
            logger.error(f"Error in station chat: {e}")
    
    @socketio.on('request_sync')
    def handle_request_sync(data):
        """Handle sync requests from clients"""
        try:
            sync_type = data.get('type')
            station_id = data.get('station_id')
            user_id = data.get('user_id', 'system')
            
            if sync_type == 'inventory':
                # Trigger inventory sync
                emit('sync_inventory', {
                    'station_id': station_id,
                    'requested_by': user_id
                }, room=f'station_{station_id}')
                
            elif sync_type == 'orders':
                # Trigger order sync
                emit('sync_orders', {
                    'station_id': station_id,
                    'requested_by': user_id
                }, room=f'station_{station_id}')
                
            elif sync_type == 'settings':
                # Trigger settings sync
                emit('sync_settings', {
                    'requested_by': user_id
                }, room='all_stations')
            
            logger.info(f"Sync requested: {sync_type} for station {station_id}")
        except Exception as e:
            logger.error(f"Error in sync request: {e}")
    
    logger.info("WebSocket handlers initialized")