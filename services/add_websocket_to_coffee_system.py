#!/usr/bin/env python3
"""
Add WebSocket notification to coffee_system.py after order creation
"""

import re

# Read the file
with open('coffee_system.py', 'r') as f:
    content = f.read()

# Find the section after order creation but before the return statement
# Look for the confirmation message construction
pattern = r'(confirmation_message = f"Thanks.*?\n.*?Station {station_name}.*?")'

# Add WebSocket notification code after confirmation message
websocket_code = '''
            
            # Send WebSocket notification for new order
            try:
                # Import socketio from app context
                from flask import current_app
                socketio = current_app.config.get('socketio')
                
                if socketio:
                    # Emit order created event
                    order_data = {
                        'id': order_id,
                        'order_number': order_number,
                        'customer_name': name,
                        'phone': phone,
                        'coffee_type': processed_details.get('type'),
                        'milk_type': processed_details.get('milk'),
                        'size': processed_details.get('size'),
                        'sugar': processed_details.get('sugar'),
                        'station_id': station_id,
                        'status': 'pending',
                        'priority': order_details.get('vip', False),
                        'created_at': now.isoformat(),
                        'source': 'sms'
                    }
                    
                    # Emit to all connected clients
                    socketio.emit('order_created', order_data, room='orders')
                    
                    # Emit to specific station room
                    socketio.emit('new_order', order_data, room=f'station_{station_id}')
                    
                    logger.info(f"WebSocket notification sent for order {order_number}")
                else:
                    logger.warning("SocketIO not available in app context")
                    
            except Exception as ws_error:
                logger.error(f"Error sending WebSocket notification: {str(ws_error)}")
                # Don't fail the order creation due to WebSocket error'''

# Replace in content
new_content = re.sub(pattern, r'\1' + websocket_code, content)

# Write back
with open('coffee_system.py', 'w') as f:
    f.write(new_content)

print("WebSocket notification added to coffee_system.py")