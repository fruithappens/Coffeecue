# services/websocket.py

from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_login import current_user
import logging

# Create SocketIO instance
socketio = SocketIO()

def init_app(app):
    """Initialize SocketIO with app"""
    socketio.init_app(app, cors_allowed_origins="*")
    
    @socketio.on('connect')
    def handle_connect():
        """Handle client connection"""
        if current_user.is_authenticated:
            logging.info(f"User {current_user.username} connected")
        else:
            logging.info("Anonymous user connected")
    
    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection"""
        if current_user.is_authenticated:
            logging.info(f"User {current_user.username} disconnected")
        else:
            logging.info("Anonymous user disconnected")
    
    @socketio.on('join')
    def handle_join(data):
        """Join a room
        
        Args:
            data: Dictionary with room key
        """
        room = data.get('room')
        if not room:
            emit('error', {'message': 'No room specified'})
            return
            
        join_room(room)
        emit('status', {'message': f'Joined room: {room}'}, room=room)
        logging.info(f"Client joined room: {room}")
    
    @socketio.on('leave')
    def handle_leave(data):
        """Leave a room
        
        Args:
            data: Dictionary with room key
        """
        room = data.get('room')
        if not room:
            emit('error', {'message': 'No room specified'})
            return
            
        leave_room(room)
        emit('status', {'message': f'Left room: {room}'}, room=room)
        logging.info(f"Client left room: {room}")
    
    return socketio

# Convenience methods to emit messages from outside the socket context

def emit_order_update(order_data, room=None):
    """Emit order update to clients
    
    Args:
        order_data: Order data dictionary
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('order_update', order_data, room=room)

def emit_order_ready(order_data, room=None):
    """Emit order ready notification
    
    Args:
        order_data: Order data dictionary
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('order_ready', order_data, room=room)

def emit_new_order(order_data, room=None):
    """Emit new order notification
    
    Args:
        order_data: Order data dictionary
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('new_order', order_data, room=room)

def emit_stock_update(stock_data, room=None):
    """Emit stock update notification
    
    Args:
        stock_data: Stock data dictionary
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('stock_update', stock_data, room=room)

def emit_help_request(help_data, room=None):
    """Emit help request notification
    
    Args:
        help_data: Help request data
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('help_request', help_data, room=room)

def emit_message(message_data, room=None):
    """Emit generic message
    
    Args:
        message_data: Message data
        room: Optional room name, if None broadcast to all
    """
    socketio.emit('message', message_data, room=room)