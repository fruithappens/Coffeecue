"""
Barista interface routes for Expresso Coffee Ordering System
"""
import os
import json
from datetime import datetime
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, session, current_app, g
import logging

from models.orders import Order
from models.stations import Station
try:
    from services.middleware import barista_required
    has_middleware = True
except ImportError:
    has_middleware = False
    def barista_required(f):
        return f

# Create blueprint
bp = Blueprint('barista', __name__, url_prefix='/barista')

# Set up logging
logger = logging.getLogger("expresso.routes.barista")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

@bp.route('/', methods=['GET'])
@barista_required
def barista_view():
    """Display the barista interface for managing orders"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station ID from query params or session
        station_id = request.args.get('station', session.get('station_id', '1'))
        session['station_id'] = station_id  # Save for future requests
        
        # Get barista ID and name
        barista_id = session.get('barista_id', g.user['id'] if hasattr(g, 'user') and g.user else 'default_barista')
        barista_name = session.get('barista_name', g.user['full_name'] if hasattr(g, 'user') and g.user else 'Default Barista')
        
        # Save barista info for future requests
        session['barista_id'] = barista_id
        session['barista_name'] = barista_name
        
        # Get active stations
        stations = Station.get_all(db)
        
        # Get pending orders grouped by station
        orders_by_station = {}
        
        for station in stations:
            station_id = station['station_id']
            orders = Order.get_active_by_station(db, station_id)
            
            # Process orders for display
            processed_orders = []
            for order in orders:
                # Format created time
                created_time = datetime.fromisoformat(order['created_at'])
                wait_minutes = int((datetime.now() - created_time).total_seconds() / 60)
                
                # Parse order details
                order_details = order['order_details']
                formatted_details = coffee_system.format_order_summary(order_details)
                
                processed_orders.append({
                    'id': order['id'],
                    'order_number': order['order_number'],
                    'phone': order['phone'],
                    'formatted_details': formatted_details,
                    'status': order['status'],
                    'wait_time': wait_minutes,
                    'priority': order['queue_priority'],
                    'for_friend': order['for_friend'],
                    'group_order': order['group_order'],
                    'customer_name': order.get('customer_name', 'Customer'),
                    'is_vip': order['queue_priority'] == 1,
                    'price': order.get('price', 0),
                    'payment_status': order.get('payment_status', 'pending'),
                    'qr_code_url': order.get('qr_code_url')
                })
            
            orders_by_station[station_id] = processed_orders
        
        # Get completed orders for today
        today = datetime.now().strftime('%Y-%m-%d')
        cursor = db.cursor()
        cursor.execute('''
            SELECT COUNT(*) FROM orders 
            WHERE status = 'completed' 
            AND date(created_at) = ?
        ''', (today,))
        
        completed_count = cursor.fetchone()[0]
        
        # Get current time for display
        current_time = datetime.now().strftime('%H:%M')
        
        return render_template(
            'barista/dashboard.html', 
            stations=stations,
            orders_by_station=orders_by_station,
            completed_count=completed_count,
            station_id=station_id,
            barista_id=barista_id,
            barista_name=barista_name,
            current_time=current_time
        )
    except Exception as e:
        logger.error(f"Error in barista view: {str(e)}")
        return "An error occurred", 500

@bp.route('/dashboard', methods=['GET'])
@barista_required
def dashboard():
    """Alias for barista_view to support both naming conventions"""
    return barista_view()

@bp.route('/update_status/<int:order_id>/<status>', methods=['POST'])
@barista_required
def update_status(order_id, status):
    """Update the status of an order"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        db = coffee_system.db
        
        # Get current order details
        cursor = db.cursor()
        cursor.execute('SELECT station_id, status, payment_status, phone, order_number, for_friend FROM orders WHERE id = ?', (order_id,))
        result = cursor.fetchone()
        
        if not result:
            return jsonify({'success': False, 'error': 'Order not found'})
        
        station_id, current_status, payment_status, phone, order_number, for_friend = result
        
        # Check if payment is required but not completed
        if status == 'completed' and payment_status == 'pending':
            return jsonify({
                'success': False, 
                'error': 'This order requires payment before completion. Mark as paid or update payment status.'
            })
        
        # Update order status
        success = Order.update_status(db, order_id, status, session.get('username', 'barista'))
        
        if not success:
            return jsonify({'success': False, 'error': 'Error updating order status'})
        
        # If the order is completed, update station stats and send notification
        if status == 'completed':
            # Calculate completion time (handled by Order.update_status)
            
            # Update station load
            Station.update_load(db, station_id, increment=False)
            
            # Send notification to customer
            if phone and messaging_service:
                messaging_service.send_order_ready_notification(phone, order_number, station_id, for_friend)
        
        # If the order is cancelled, decrement station load
        elif status == 'cancelled':
            Station.update_load(db, station_id, increment=False)
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Error updating order status: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@bp.route('/mark_payment/<int:order_id>', methods=['POST'])
@barista_required
def mark_payment(order_id):
    """Mark an order as paid"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update payment status
        success = Order.update_payment_status(db, order_id, 'paid', 'manual_payment')
        
        if not success:
            return jsonify({'success': False, 'error': 'Error updating payment status'})
        
        # Get order details for loyalty points
        cursor = db.cursor()
        cursor.execute('SELECT phone FROM orders WHERE id = ?', (order_id,))
        result = cursor.fetchone()
        
        if result:
            # Add loyalty points for paid orders
            phone = result[0]
            coffee_system.add_loyalty_points(phone, coffee_system.config.get('LOYALTY_POINTS_PER_ORDER', 10), order_id)
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Error marking payment: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@bp.route('/edit_order/<int:order_id>', methods=['GET', 'POST'])
@barista_required
def edit_order(order_id):
    """Edit an existing order"""
    # Get coffee system from app context
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    
    if request.method == 'POST':
        # Process form submission
        try:
            new_size = request.form.get('size')
            new_type = request.form.get('type')
            new_milk = request.form.get('milk')
            new_sugar = request.form.get('sugar')
            new_strength = request.form.get('strength')
            new_temp = request.form.get('temp')
            new_notes = request.form.get('notes')
            
            # Prepare new details
            new_details = {}
            if new_size:
                new_details['size'] = new_size
            if new_type:
                new_details['type'] = new_type
            if new_milk:
                new_details['milk'] = new_milk
            if new_sugar:
                new_details['sugar'] = new_sugar
            if new_strength:
                new_details['strength'] = new_strength
            if new_temp:
                new_details['temp'] = new_temp
            if new_notes:
                new_details['notes'] = new_notes
            
            # Apply edits
            if coffee_system.edit_order(order_id, new_details, session.get('username', 'barista')):
                flash("Order updated successfully")
            else:
                flash("Error updating order")
            
            return redirect(url_for('barista.barista_view'))
        
        except Exception as e:
            logger.error(f"Error editing order: {str(e)}")
            flash(f"Error: {str(e)}")
            return redirect(url_for('barista.barista_view'))
    
    # GET request - show edit form
    try:
        # Get order details
        order = Order.get_by_id(db, order_id)
        
        if not order:
            flash("Order not found")
            return redirect(url_for('barista.barista_view'))
        
        # Get customer details
        cursor = db.cursor()
        cursor.execute('SELECT name FROM customer_preferences WHERE phone = ?', (order['phone'],))
        result = cursor.fetchone()
        customer_name = result[0] if result else None
        
        # Get menu items for dropdown options
        cursor.execute('SELECT name FROM menu_items WHERE active = 1 ORDER BY name')
        coffee_types = [row[0] for row in cursor.fetchall()]
        
        return render_template(
            'barista/edit_order.html',
            order_id=order_id,
            order_number=order['order_number'],
            order_details=order['order_details'],
            status=order['status'],
            payment_status=order['payment_status'],
            price=order['price'],
            customer_name=customer_name,
            phone=order['phone'],
            coffee_types=coffee_types
        )
    
    except Exception as e:
        logger.error(f"Error loading order edit form: {str(e)}")
        flash(f"Error: {str(e)}")
        return redirect(url_for('barista.barista_view'))

@bp.route('/scan', methods=['GET', 'POST'])
@barista_required
def scan_code():
    """QR code scanning interface for baristas"""
    if request.method == 'POST':
        # Handle manual entry
        order_code = request.form.get('order_code')
        if order_code:
            # Strip any URL prefix
            order_number = order_code.split('/')[-1]
            if order_number.startswith('ORDER:'):
                order_number = order_number[6:]
            
            return redirect(url_for('barista.order_details', order_number=order_number))
    
    return render_template('barista/barista_scan.html')

@bp.route('/order/<order_number>', methods=['GET'])
@barista_required
def order_details(order_number):
    """View order details by order number"""
    # Get coffee system from app context
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    
    # Get order details
    order = Order.get_by_number(db, order_number)
    
    if not order:
        flash("Order not found")
        return redirect(url_for('barista.barista_view'))
    
    # Get customer details
    customer = coffee_system.get_customer(order['phone'])
    
    # Format order details
    formatted_details = coffee_system.format_order_summary(order['order_details'])
    
    return render_template(
        'barista/order_details.html',
        order=order,
        customer=customer,
        formatted_details=formatted_details
    )

@bp.route('/save_notes/<int:order_id>', methods=['POST'])
@barista_required
def save_notes(order_id):
    """Save barista notes for an order"""
    try:
        data = request.json
        notes = data.get('notes', '')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update order notes
        cursor = db.cursor()
        cursor.execute('''
            UPDATE orders 
            SET barista_notes = ?, 
                updated_at = ?, 
                last_modified_by = ? 
            WHERE id = ?
        ''', (notes, datetime.now().isoformat(), session.get('username', 'barista'), order_id))
        db.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        logger.error(f"Error saving notes: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@bp.route('/chat/messages')
@barista_required
def chat_messages():
    """Retrieve chat messages for the station"""
    try:
        # Placeholder implementation
        messages = [
            {
                'sender': 'System',
                'content': 'Welcome to the barista interface',
                'created_at': datetime.now().isoformat(),
                'is_urgent': False
            }
        ]
        return jsonify({
            'success': True,
            'messages': messages
        })
    except Exception as e:
        logger.error(f"Error retrieving chat messages: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@bp.route('/preparation/recommendations')
@barista_required
def preparation_recommendations():
    """Provide smart preparation recommendations"""
    try:
        # Placeholder implementation
        recommendations = [
            {
                'type': 'batch',
                'id': 'batch_1',
                'description': 'Batch similar orders',
                'details': 'Multiple similar coffee orders detected',
                'priority': 'medium'
            }
        ]
        return jsonify({
            'success': True,
            'recommendations': recommendations
        })
    except Exception as e:
        logger.error(f"Error retrieving preparation recommendations: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@bp.route('/stations/<int:station_id>/wait-time', methods=['POST'])
@barista_required
def update_station_wait_time(station_id):
    """Update the estimated wait time for a station"""
    try:
        data = request.json
        wait_time = data.get('wait_time', 10)  # Default to 10 minutes
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update station wait time in database
        cursor = db.cursor()
        cursor.execute("""
            UPDATE station_stats 
            SET wait_time = ?, 
                last_updated = CURRENT_TIMESTAMP 
            WHERE station_id = ?
        """, (wait_time, station_id))
        db.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating wait time: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})
