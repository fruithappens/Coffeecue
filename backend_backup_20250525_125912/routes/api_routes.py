# routes/api_routes.py
from flask import Blueprint, jsonify, request, current_app
from datetime import datetime, timedelta
import json
import logging
import re

# Set up logging
logger = logging.getLogger("expresso.routes.api")

# Create blueprint - Defined at the top before any routes
# Use url_prefix to ensure all routes are under /api/
bp = Blueprint('api', __name__, url_prefix='/api')

# Helper function to handle order requests from main app routes
def handle_order_request(function_name, order_id):
    """Helper function to handle order requests from main app routes"""
    logger.info(f"Handling order request: {function_name} for order {order_id}")
    try:
        if function_name == 'start_order':
            return start_order(order_id)
        elif function_name == 'complete_order':
            return complete_order(order_id)
        elif function_name == 'pickup_order':
            return pickup_order(order_id)
        elif function_name == 'send_message':
            # Need to handle body for this one
            from flask import request
            if not request.is_json:
                return jsonify({"success": False, "message": "Request must be JSON"}), 400
            data = request.json
            message = data.get('message', '')
            return send_message(order_id)
        else:
            return jsonify({"success": False, "message": f"Unknown function: {function_name}"}), 404
    except Exception as e:
        logger.error(f"Error in handle_order_request: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

# Sample test data generation (kept as fallback)
def generate_sample_orders():
    now = datetime.now()
    return [
        {
            'id': f'order_{i}',
            'order_number': f'45{280 + i}',
            'customer_name': customer,
            'coffee_type': coffee,
            'milk_type': milk,
            'sugar': sugar,
            'status': status,
            'created_at': (now - timedelta(minutes=wait_time)).isoformat(),
            'wait_time': wait_time,
            'priority': priority
        }
        for i, (customer, coffee, milk, sugar, status, wait_time, priority) in enumerate([
            ('Sarah Williams', 'Regular Flat White', 'Full cream', '2 sugars', 'pending', 5, False),
            ('James Cooper', 'Regular Latte', 'Almond milk', 'No sugar', 'pending', 7, False),
            ('Emma Davis', 'Large Latte', 'Soy milk', '1 sugar', 'pending', 8, False),
            ('Thomas Brown', 'Large Latte', 'Soy milk', '0 sugar', 'pending', 9, False),
            ('Michael Johnson', 'Large Cappuccino', 'Oat milk', '1 sugar', 'in-progress', 3, True),
        ])
    ]

def generate_sample_in_progress_orders():
    now = datetime.now()
    return [
        {
            'id': 'order_in_progress_1',
            'order_number': '45281',
            'customer_name': 'Michael Johnson',
            'phone_number': '+61 423 555 789',
            'coffee_type': 'Large Cappuccino', 
            'milk_type': 'Oat milk', 
            'sugar': '1 sugar',
            'extra_hot': True,
            'priority': True,
            'created_at': (now - timedelta(minutes=3)).isoformat(),
            'wait_time': 3
        }
    ]

def generate_sample_chat_messages():
    now = datetime.now()
    return [
        {
            'sender': 'Julia (Station #1)',
            'content': 'Running low on alternative milks over here, anyone have extra?',
            'created_at': (now - timedelta(minutes=15)).isoformat(),
            'is_urgent': False
        },
        {
            'sender': 'Alex (Station #2)',
            'content': 'I can share some oat milk',
            'created_at': (now - timedelta(minutes=5)).isoformat(),
            'is_urgent': False
        },
        {
            'sender': 'Station #2',
            'content': 'URGENT: Coffee machine is jamming at Station #2!',
            'created_at': (now - timedelta(minutes=5)).isoformat(),
            'is_urgent': True
        }
    ]

# Helper function to clean order IDs
def clean_order_id(order_id):
    """Remove prefixes like 'order_' from IDs and return the base ID"""
    if not order_id:
        return None
        
    # If it's an order_123 format, extract the numeric part
    if isinstance(order_id, str):
        match = re.match(r'^order_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_in_progress_123 format, extract the numeric part
        match = re.match(r'^order_in_progress_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_completed_123 format, extract the numeric part
        match = re.match(r'^order_completed_([0-9]+)$', order_id)
        if match:
            return match.group(1)
    
    # Return as-is if it's already clean or doesn't match patterns
    return order_id

# Add general orders endpoint for creating new orders
@bp.route('/orders', methods=['GET', 'POST'])
def orders():
    """Handle orders - GET for listing all orders, POST for creating new orders"""
    if request.method == 'GET':
        # Get all orders with optional status filter
        status_filter = request.args.get('status')
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Query database for orders
            cursor = db.cursor()
            if status_filter:
                cursor.execute('''
                    SELECT id, order_number, status, station_id, 
                           created_at, phone, order_details, queue_priority
                    FROM orders 
                    WHERE status = %s
                    ORDER BY queue_priority, created_at DESC
                ''', (status_filter,))
            else:
                cursor.execute('''
                    SELECT id, order_number, status, station_id, 
                           created_at, phone, order_details, queue_priority
                    FROM orders 
                    ORDER BY created_at DESC
                    LIMIT 50
                ''')
            
            # Process orders
            orders = []
            for order in cursor.fetchall():
                # Extract order details
                order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
                
                # Parse order details
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Format order for frontend
                orders.append({
                    'id': order_number,  # Use order_number as id for consistency
                    'order_number': order_number,
                    'customer_name': order_details.get('name', 'Customer'),
                    'coffee_type': order_details.get('type', 'Coffee'),
                    'milk_type': order_details.get('milk', 'Standard'),
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'size': order_details.get('size', 'Regular'),
                    'status': status,
                    'created_at': created_at,
                    'wait_time': wait_time,
                    'priority': priority == 1,  # Convert 1/0 to True/False
                    'special_instructions': order_details.get('notes', ''),
                    'payment_method': order_details.get('payment_method', ''),
                    'order_type': order_details.get('order_type', 'walk-in')
                })
            
            return jsonify(orders)
        
        except Exception as e:
            logger.error(f"Error fetching orders: {str(e)}")
            return jsonify({"success": False, "error": str(e)}), 500
    
    elif request.method == 'POST':
        # Create a new order
        try:
            data = request.json
            logger.info(f"Creating new order with data: {data}")
            
            # Validate required fields
            required_fields = ['customer_name', 'coffee_type', 'size']
            for field in required_fields:
                if not data.get(field):
                    return jsonify({"success": False, "error": f"Missing required field: {field}"}), 400
            
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Generate a unique order number
            now = datetime.now()
            prefix = "W" if data.get('order_type') == 'walk-in' else "O"
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Prepare order details
            order_details = {
                'name': data.get('customer_name'),
                'type': data.get('coffee_type'),
                'milk': data.get('milk_type', 'dairy'),
                'size': data.get('size'),
                'sugar': data.get('sugar', 'No sugar'),
                'notes': data.get('special_instructions', ''),
                'payment_method': data.get('payment_method', 'cash'),
                'order_type': data.get('order_type', 'walk-in'),
                'created_by': data.get('created_by', 'barista')
            }
            
            # Determine priority (VIP orders get priority 1, regular get 5)
            priority = 1 if data.get('priority') == 'vip' else 5
            if data.get('priority') == 'urgent':
                priority = 2
            
            # Use provided station or default to station 1
            station_id = data.get('station_id', 1)
            
            # Insert order into database
            cursor = db.cursor()
            cursor.execute('''
                INSERT INTO orders (
                    order_number, phone, order_details, status, 
                    station_id, created_at, updated_at, queue_priority
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                order_number,
                data.get('phone', ''),  # Phone can be empty for walk-in orders
                json.dumps(order_details),
                'pending',
                station_id,
                now.isoformat(),
                now.isoformat(),
                priority
            ))
            
            # Get the inserted order ID
            order_id = cursor.fetchone()[0]
            db.commit()
            
            logger.info(f"Successfully created order {order_number} with ID {order_id}")
            
            return jsonify({
                "success": True,
                "message": "Order created successfully",
                "order_id": order_id,
                "order_number": order_number,
                "details": order_details
            }), 201
            
        except Exception as e:
            logger.error(f"Error creating order: {str(e)}")
            return jsonify({"success": False, "error": str(e)}), 500

@bp.route('/orders/<order_id>', methods=['GET'])
def get_order(order_id):
    """Get a specific order by ID"""
    try:
        # Use the existing lookup function
        return lookup_order(order_id)
    except Exception as e:
        logger.error(f"Error getting order {order_id}: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500

@bp.route('/orders/pending', methods=['GET'])
def get_pending_orders():
    """Get all pending orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for pending orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details, queue_priority
            FROM orders 
            WHERE status = 'pending'
            ORDER BY queue_priority, created_at DESC
        ''')
        
        # Process orders
        pending_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Calculate wait time
            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
            
            # Get batch group if present in order details
            batch_group = None
            if order_details and 'type' in order_details and 'milk' in order_details:
                # Create a batch group key based on coffee type and milk type
                coffee_type = order_details.get('type', '').lower()
                milk_type = order_details.get('milk', '').lower()
                if coffee_type and milk_type:
                    batch_group = f"{coffee_type}-{milk_type}"
            
            # Format order for frontend
            pending_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'customer_name': order_details.get('name', 'Customer'),
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'sugar': order_details.get('sugar', 'No sugar'),
                'status': status,
                'created_at': created_at,
                'wait_time': wait_time,
                'priority': priority == 1,  # Convert 1/0 to True/False
                'batch_group': batch_group,
                'station_id': station_id,
                'stationId': station_id,
                'assignedStation': station_id
            })
        
        return jsonify(pending_orders)
    
    except Exception as e:
        logger.error(f"Error fetching pending orders: {str(e)}")
        # If there's an error, fall back to sample data
        pending_orders = generate_sample_orders()
        pending_orders = [order for order in pending_orders if order['status'] == 'pending']
        return jsonify(pending_orders)

@bp.route('/orders/in-progress', methods=['GET'])
def get_in_progress_orders():
    """Get all in-progress orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for in-progress orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details, queue_priority
            FROM orders 
            WHERE status = 'in-progress'
            ORDER BY created_at
        ''')
        
        # Process orders
        in_progress_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Calculate wait time
            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
            
            # Check for extra hot
            extra_hot = False
            if 'temp' in order_details and order_details['temp'] == 'extra hot':
                extra_hot = True
            # Also check the notes field for "extra hot" text
            elif 'notes' in order_details and order_details['notes'] and 'extra hot' in order_details['notes'].lower():
                extra_hot = True
            
            # Format order for frontend
            in_progress_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'customer_name': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'sugar': order_details.get('sugar', 'No sugar'),
                'extra_hot': extra_hot,
                'priority': priority == 1,
                'created_at': created_at,
                'wait_time': wait_time,
                'station_id': station_id,
                'stationId': station_id,
                'assignedStation': station_id
            })
        
        return jsonify(in_progress_orders)
    
    except Exception as e:
        logger.error(f"Error fetching in-progress orders: {str(e)}")
        # If there's an error, fall back to sample data
        return jsonify(generate_sample_in_progress_orders())

@bp.route('/orders/completed', methods=['GET'])
def get_completed_orders():
    """Get all completed orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for completed orders
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, phone, order_details
            FROM orders 
            WHERE status = 'completed'
            ORDER BY updated_at DESC
            LIMIT 10
        ''')
        
        # Process orders
        completed_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, updated_at, phone, order_details_json = order
            
            # Use updated_at as completed_at time
            completed_at = updated_at or created_at
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Format order for frontend
            completed_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'customer_name': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'coffee_type': order_details.get('type', 'Coffee'),
                'milk_type': order_details.get('milk', 'Standard'),
                'completed_at': completed_at,
                'ready_for_pickup': True
            })
        
        return jsonify(completed_orders)
    
    except Exception as e:
        logger.error(f"Error fetching completed orders: {str(e)}")
        # If there's an error, fall back to sample data
        return jsonify([
            {
                'id': '45266',  # Use order_number as id for consistency
                'order_number': '45266', 
                'customer_name': 'Emma Johnson', 
                'phone_number': '+61 423 456 789',
                'coffee_type': 'Large Flat White', 
                'milk_type': 'Almond milk', 
                'completed_at': datetime.now().isoformat(),
                'ready_for_pickup': True
            },
            {
                'id': '45270',  # Use order_number as id for consistency
                'order_number': '45270', 
                'customer_name': 'James Cooper', 
                'phone_number': '+61 432 987 654',
                'coffee_type': 'Regular Cappuccino', 
                'milk_type': 'Full cream milk', 
                'completed_at': datetime.now().isoformat(),
                'ready_for_pickup': True
            }
        ])

@bp.route('/chat/messages', methods=['GET'])
def get_chat_messages():
    """Get chat messages"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if chat_messages table exists
        cursor = db.cursor()
        cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
        table_exists = cursor.fetchone()[0]
        
        if table_exists:
            # Query database for chat messages
            cursor.execute('''
                SELECT id, sender, content, is_urgent, created_at
                FROM chat_messages
                ORDER BY created_at DESC
                LIMIT 20
            ''')
            
            messages = []
            for msg in cursor.fetchall():
                msg_id, sender, content, is_urgent, created_at = msg
                messages.append({
                    'id': msg_id,
                    'sender': sender,
                    'content': content,
                    'created_at': created_at,
                    'is_urgent': bool(is_urgent)
                })
            
            return jsonify({
                'success': True,
                'messages': messages
            })
        else:
            # If table doesn't exist, return sample data
            logger.warning("chat_messages table not found, using sample data")
            return jsonify({
                'success': True,
                'messages': generate_sample_chat_messages()
            })
    
    except Exception as e:
        logger.error(f"Error fetching chat messages: {str(e)}")
        return jsonify({
            'success': True,
            'messages': generate_sample_chat_messages()
        })

@bp.route('/test', methods=['GET'])
def test_api():
    """Simple API connectivity test"""
    return jsonify({
        'status': 'success', 
        'message': 'API is working'
    })

@bp.route('/orders/<order_id>/start', methods=['POST'])
def start_order(order_id):
    """Start an order"""
    try:
        # Log incoming request
        logger.info(f"Received request to start order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get station_id from request body
        data = request.get_json() or {}
        station_id = data.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        # Update order status and station assignment
        if station_id:
            cursor.execute('''
                UPDATE orders
                SET status = 'in-progress', station_id = %s, updated_at = %s
                WHERE order_number = %s
            ''', (station_id, datetime.now().isoformat(), clean_id))
            logger.info(f"Assigning order {clean_id} to station {station_id}")
        else:
            cursor.execute('''
                UPDATE orders
                SET status = 'in-progress', updated_at = %s
                WHERE order_number = %s
            ''', (datetime.now().isoformat(), clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully started order: {clean_id}")
            return jsonify({"success": True, "message": "Order started successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error starting order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/orders/<order_id>/complete', methods=['POST'])
def complete_order(order_id):
    """Complete an order"""
    try:
        # Log incoming request
        logger.info(f"Received request to complete order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        # Get current time
        completed_at = datetime.now().isoformat()
        
        # Update order status
        cursor.execute('''
            UPDATE orders
            SET status = 'completed', updated_at = %s, completed_at = %s
            WHERE order_number = %s
        ''', (completed_at, completed_at, clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully completed order: {clean_id}")
            return jsonify({"success": True, "message": "Order completed successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error completing order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/orders/<order_id>/pickup', methods=['POST'])
def pickup_order(order_id):
    """Mark an order as picked up"""
    try:
        # Log incoming request
        logger.info(f"Received request to mark order as picked up: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists first to provide better error handling
        cursor = db.cursor()
        cursor.execute('SELECT id FROM orders WHERE order_number = %s', (clean_id,))
        order_exists = cursor.fetchone()
        
        if not order_exists:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        # Get current time
        pickup_at = datetime.now().isoformat()
        
        # Update order status - set picked_up_at field if it exists
        try:
            cursor.execute('''
                UPDATE orders
                SET picked_up_at = %s, updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, pickup_at, clean_id))
        except Exception as e:
            # If picked_up_at column doesn't exist, fall back to a simpler update
            logger.warning(f"picked_up_at column may not exist, using simpler update: {str(e)}")
            cursor.execute('''
                UPDATE orders
                SET updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully marked order as picked up: {clean_id}")
            return jsonify({"success": True, "message": "Order marked as picked up successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error marking order as picked up {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/orders/batch', methods=['POST'])
def batch_process_orders():
    """Process a batch of orders"""
    try:
        data = request.json
        order_ids = data.get('order_ids', [])
        action = data.get('action', 'start')
        
        if not order_ids:
            return jsonify({"success": False, "message": "No order IDs provided"})
        
        logger.info(f"Processing {len(order_ids)} orders in batch, action: {action}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Clean all IDs if needed
        clean_ids = [clean_order_id(order_id) for order_id in order_ids]
        logger.info(f"Cleaned order IDs: {clean_ids}")
        
        # Update orders
        cursor = db.cursor()
        current_time = datetime.now().isoformat()
        
        success_count = 0
        for order_id in clean_ids:
            try:
                if action == 'start':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'in-progress', updated_at = %s
                        WHERE order_number = %s
                    ''', (current_time, order_id))
                elif action == 'complete':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'completed', updated_at = %s, completed_at = %s
                        WHERE order_number = %s
                    ''', (current_time, current_time, order_id))
                
                if cursor.rowcount > 0:
                    success_count += 1
                    logger.info(f"Successfully processed order {order_id} in batch")
                else:
                    logger.warning(f"Order {order_id} not found or not updated")
            except Exception as e:
                logger.error(f"Error processing order {order_id}: {str(e)}")
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "processed": success_count,
            "total": len(order_ids)
        })
    
    except Exception as e:
        logger.error(f"Error batch processing orders: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/orders/<order_id>/message', methods=['POST'])
def send_message(order_id):
    """Send a message to a customer about their order"""
    try:
        # Log incoming request
        logger.info(f"Received request to send message for order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get message content from request
        data = request.json
        message = data.get('message', '')
        
        if not message:
            logger.error("No message content provided")
            return jsonify({"success": False, "message": "No message content provided"})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            return jsonify({"success": False, "message": "Service unavailable"})
        
        # Get order details to send message
        db = coffee_system.db
        cursor = db.cursor()
        cursor.execute('SELECT phone FROM orders WHERE order_number = %s', (clean_id,))
        order = cursor.fetchone()
        
        if not order:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        phone_number = order[0]
        
        if not phone_number:
            logger.error(f"No phone number for order: {clean_id}")
            return jsonify({"success": False, "message": f"No phone number for order {clean_id}"})
            
        logger.info(f"Found phone number {phone_number} for order {clean_id}")
        
        # Create order_messages table if it doesn't exist
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS order_messages (
                    id SERIAL PRIMARY KEY,
                    order_number VARCHAR(50) NOT NULL,
                    phone VARCHAR(50) NOT NULL,
                    message TEXT NOT NULL,
                    message_sid VARCHAR(100),
                    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            db.commit()
        except Exception as e:
            logger.warning(f"Could not create order_messages table: {str(e)}")
            # Continue anyway
        
        # Send the message using messaging service
        try:
            result = messaging_service.send_message(phone_number, message)
            logger.info(f"Message sent to {phone_number} for order {clean_id}, result: {result}")
            
            # Log the message in the database
            try:
                cursor.execute("""
                    INSERT INTO order_messages 
                    (order_number, phone, message, message_sid)
                    VALUES (%s, %s, %s, %s)
                """, (clean_id, phone_number, message, result))
                db.commit()
                logger.info(f"Saved message to database for order {clean_id}")
            except Exception as db_err:
                logger.warning(f"Could not save message to database: {str(db_err)}")
                # Continue anyway
            
            return jsonify({
                "success": True, 
                "message": "Message sent successfully",
                "message_sid": result
            })
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")
            return jsonify({"success": False, "message": f"Error sending message: {str(e)}"})
    
    except Exception as e:
        logger.error(f"Error sending message for order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/settings/wait-time', methods=['POST'])
def update_wait_time():
    """Update the estimated wait time for all stations"""
    try:
        data = request.json
        wait_time = data.get('waitTime')
        
        if wait_time is None:
            logger.error("No wait time provided")
            return jsonify({"success": False, "message": "No wait time provided"})
        
        # Ensure wait time is a number
        try:
            wait_time = int(wait_time)
        except (ValueError, TypeError):
            logger.error(f"Invalid wait time format: {wait_time}")
            return jsonify({"success": False, "message": "Wait time must be a number"})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        
        if not coffee_system:
            logger.error("Coffee system not available")
            return jsonify({"success": False, "message": "Service unavailable"})
        
        # Update wait time setting in database
        db = coffee_system.db
        cursor = db.cursor()
        
        # Update all active stations with new wait time
        cursor.execute('''
            UPDATE station_stats 
            SET wait_time = %s, last_updated = %s
            WHERE status = 'active'
        ''', (wait_time, datetime.now().isoformat()))
        
        db.commit()
        
        logger.info(f"Updated wait time to {wait_time} minutes for all active stations")
        return jsonify({"success": True, "message": f"Wait time updated to {wait_time} minutes"})
    
    except Exception as e:
        logger.error(f"Error updating wait time: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})

@bp.route('/debug/database-info', methods=['GET'])
def database_info():
    """Get information about the database and its tables"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor()
        
        # Get a list of tables - PostgreSQL version
        cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = [row[0] for row in cursor.fetchall()]
        
        # Get row counts for each table
        table_counts = {}
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                table_counts[table] = count
            except:
                table_counts[table] = "Error counting rows"
        
        # Get sample data from orders if available
        sample_orders = []
        if 'orders' in tables:
            cursor.execute("SELECT * FROM orders LIMIT 3")
            columns = [column[0] for column in cursor.description]
            for row in cursor.fetchall():
                sample_orders.append(dict(zip(columns, row)))
        
        return jsonify({
            'database_type': 'PostgreSQL',
            'database_url': current_app.config.get('config', {}).get('DATABASE_URL', 'Unknown'),
            'tables': tables,
            'row_counts': table_counts,
            'sample_orders': sample_orders
        })
    
    except Exception as e:
        return jsonify({
            'error': str(e),
            'database_type': 'PostgreSQL'
        })

@bp.route('/debug/create-test-order', methods=['POST'])
def create_test_order():
    """Create a test order in the database"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get order details from request or use defaults
        data = request.json or {}
        
        # Generate a unique order number
        now = datetime.now()
        prefix = "A" if now.hour < 12 else "P"
        order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
        
        # Default order details
        order_details = {
            'name': data.get('name', 'Test Customer'),
            'type': data.get('type', 'Cappuccino'),
            'milk': data.get('milk', 'Full cream'),
            'size': data.get('size', 'Regular'),
            'sugar': data.get('sugar', 'No sugar'),
            'notes': data.get('notes', 'Created via API for testing')
        }
        
        # Use provided phone or default test phone
        phone = data.get('phone', '+61400123456')
        
        # Use provided station or default to station 1
        station_id = data.get('station_id', 1)
        
        # Insert order - PostgreSQL version with %s placeholders
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO orders (
                order_number, phone, order_details, status, 
                station_id, created_at, updated_at, queue_priority
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ''', (
            order_number,
            phone,
            json.dumps(order_details),
            'pending',
            station_id,
            now.isoformat(),
            now.isoformat(),
            data.get('priority', 5)  # 1 for VIP, 5 for regular
        ))
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "order_number": order_number,
            "details": order_details
        })
    
    except Exception as e:
        logger.error(f"Error creating test order: {str(e)}")
        return jsonify({"success": False, "error": str(e)})

@bp.route('/debug/api-health', methods=['GET'])
def api_health():
    """Check API health and connection status"""
    try:
        # Basic health check
        health = {
            'status': 'healthy',
            'timestamp': datetime.now().isoformat(),
            'version': '1.0.0',
            'endpoints': {
                'orders': {
                    'pending': '/orders/pending',
                    'in_progress': '/orders/in-progress',
                    'completed': '/orders/completed'
                },
                'actions': {
                    'start': '/orders/<order_id>/start',
                    'complete': '/orders/<order_id>/complete',
                    'pickup': '/orders/<order_id>/pickup',
                    'batch': '/orders/batch',
                    'message': '/orders/<order_id>/message'
                },
                'settings': {
                    'wait_time': '/settings/wait-time'
                }
            }
        }
        
        # Get database status
        try:
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            cursor = db.cursor()
            cursor.execute("SELECT 1")
            db_status = "connected" if cursor.fetchone() else "error"
            cursor.close()
        except Exception as e:
            db_status = f"error: {str(e)}"
        
        health['database'] = db_status
        
        # Check messaging service
        messaging_service = current_app.config.get('messaging_service')
        if messaging_service:
            health['messaging'] = {
                'status': 'available',
                'testing_mode': getattr(messaging_service, 'testing_mode', False)
            }
        else:
            health['messaging'] = {'status': 'unavailable'}
        
        return jsonify(health)
    
    except Exception as e:
        logger.error(f"Error in API health check: {str(e)}")
        return jsonify({
            'status': 'error',
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        })

# Add an endpoint for direct order lookup
@bp.route('/orders/lookup/<order_id>', methods=['GET'])
def lookup_order(order_id):
    """Look up an order by ID or order number"""
    try:
        # Clean the order ID if needed
        clean_id = clean_order_id(order_id)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query the database for the order
        cursor = db.cursor()
        
        # Try to find by order_number first (most reliable)
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, updated_at, completed_at, 
                   phone, order_details, queue_priority
            FROM orders 
            WHERE order_number = %s
        ''', (clean_id,))
        
        order = cursor.fetchone()
        
        # If not found by order_number, try by ID
        if not order:
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, updated_at, completed_at, 
                       phone, order_details, queue_priority
                FROM orders 
                WHERE id = %s
            ''', (clean_id,))
            
            order = cursor.fetchone()
        
        # If still not found, return error
        if not order:
            return jsonify({
                "success": False, 
                "message": f"Order {order_id} not found"
            })
        
        # Extract order details
        order_id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details_json, priority = order
        
        # Parse order details
        if isinstance(order_details_json, str):
            order_details = json.loads(order_details_json)
        else:
            order_details = order_details_json
        
        # Format order for response
        order_data = {
            "id": order_number,  # Use order_number as ID for consistency
            "order_number": order_number,
            "status": status,
            "station_id": station_id,
            "customer_name": order_details.get('name', 'Customer'),
            "phone_number": phone,
            "coffee_type": order_details.get('type', 'Coffee'),
            "milk_type": order_details.get('milk', 'Standard'),
            "sugar": order_details.get('sugar', 'No sugar'),
            "size": order_details.get('size', 'Regular'),
            "created_at": created_at,
            "updated_at": updated_at,
            "completed_at": completed_at,
            "priority": priority == 1,
            "details": order_details  # Include full details for reference
        }
        
        return jsonify({
            "success": True,
            "order": order_data
        })
    
    except Exception as e:
        logger.error(f"Error looking up order {order_id}: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error looking up order: {str(e)}"
        })