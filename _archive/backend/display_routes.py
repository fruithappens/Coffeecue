"""
Display routes for public order status screens
"""

import logging
from flask import Blueprint, render_template, request, jsonify, current_app

# Create blueprint
bp = Blueprint('display', __name__, url_prefix='/display')

# Set up logging
logger = logging.getLogger("expresso.routes.display")

@bp.route('/')
def display_index():
    """Display order status screen main page"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get active stations
        cursor = db.cursor()
        cursor.execute('''
            SELECT station_id, status, barista_name, current_load
            FROM station_stats
            WHERE status = 'active'
            ORDER BY station_id
        ''')
        stations = cursor.fetchall()
        
        # Get pending and in-progress orders
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   strftime('%H:%M', created_at) as created_time,
                   phone, order_details
            FROM orders 
            WHERE status IN ('pending', 'in-progress', 'completed')
            ORDER BY 
                CASE 
                    WHEN status = 'completed' THEN 3
                    WHEN status = 'in-progress' THEN 2
                    WHEN status = 'pending' THEN 1
                END,
                created_at DESC
            LIMIT 20
        ''')
        orders = []
        for order in cursor.fetchall():
            # Format order for display
            order_id, order_number, status, station_id, created_time, phone, order_details = order
            
            # Format phone number for display (show last 4 digits)
            if phone and len(phone) > 4:
                display_phone = f"xxx-xxx-{phone[-4:]}"
            else:
                display_phone = "unknown"
            
            # Format order details
            if order_details:
                try:
                    if isinstance(order_details, str):
                        import json
                        details = json.loads(order_details)
                    else:
                        details = order_details
                    
                    # Get basic info
                    size = details.get('size', '')
                    drink_type = details.get('type', '')
                    milk = details.get('milk', '')
                    
                    # Format order description
                    if size and drink_type:
                        order_desc = f"{size} {drink_type}"
                        if milk and milk != "standard":
                            order_desc += f" w/ {milk}"
                    else:
                        order_desc = "Coffee order"
                except:
                    order_desc = "Coffee order"
            else:
                order_desc = "Coffee order"
            
            orders.append({
                'order_number': order_number,
                'status': status,
                'station_id': station_id,
                'created_time': created_time,
                'display_phone': display_phone,
                'description': order_desc
            })
        
        # Group orders by station
        orders_by_station = {}
        for station in stations:
            station_id = station[0]
            orders_by_station[station_id] = {
                'pending': [],
                'in-progress': [],
                'completed': []
            }
        
        for order in orders:
            station_id = order['station_id']
            status = order['status']
            if station_id in orders_by_station:
                if status in orders_by_station[station_id]:
                    orders_by_station[station_id][status].append(order)
        
        # Get settings for display
        cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else 'Coffee Service'
        
        cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_display_enabled'")
        sponsor_display_result = cursor.fetchone()
        sponsor_display_enabled = sponsor_display_result[0].lower() in ('true', 'yes', '1', 't', 'y') if sponsor_display_result else False
        
        cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_name'")
        sponsor_name_result = cursor.fetchone()
        sponsor_name = sponsor_name_result[0] if sponsor_name_result and sponsor_display_enabled else ''
        
        cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_message'")
        sponsor_message_result = cursor.fetchone()
        sponsor_message = sponsor_message_result[0] if sponsor_message_result and sponsor_display_enabled else ''
        
        if sponsor_name and '{sponsor}' in sponsor_message:
            sponsor_message = sponsor_message.replace('{sponsor}', sponsor_name)
        
        return render_template(
            'display.html',
            stations=stations,
            orders=orders,
            orders_by_station=orders_by_station,
            event_name=event_name,
            sponsor_display=sponsor_display_enabled,
            sponsor_name=sponsor_name,
            sponsor_message=sponsor_message
        )
    except Exception as e:
        logger.error(f"Error generating display: {str(e)}")
        return render_template('display_error.html', error=str(e))

@bp.route('/api/orders')
def api_orders():
    """API endpoint to get order data for displays"""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get orders for display
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   strftime('%H:%M', created_at) as created_time,
                   phone, order_details
            FROM orders 
            WHERE status IN ('pending', 'in-progress', 'completed')
            AND created_at > datetime('now', '-2 hours')
            ORDER BY 
                CASE 
                    WHEN status = 'completed' THEN 3
                    WHEN status = 'in-progress' THEN 2
                    WHEN status = 'pending' THEN 1
                END,
                created_at DESC
            LIMIT 20
        ''')
        
        orders = []
        for order in cursor.fetchall():
            # Format order for display
            order_id, order_number, status, station_id, created_time, phone, order_details = order
            
            # Format phone number for display (show last 4 digits)
            if phone and len(phone) > 4:
                display_phone = f"xxx-xxx-{phone[-4:]}"
            else:
                display_phone = "unknown"
            
            # Format order details
            order_desc = coffee_system.format_order_summary_short(order_details)
            
            orders.append({
                'order_number': order_number,
                'status': status,
                'station_id': station_id,
                'created_time': created_time,
                'display_phone': display_phone,
                'description': order_desc
            })
        
        # Get station statuses
        cursor.execute('''
            SELECT station_id, status, barista_name, current_load
            FROM station_stats
            ORDER BY station_id
        ''')
        
        stations = []
        for station in cursor.fetchall():
            station_id, status, barista_name, current_load = station
            stations.append({
                'id': station_id,
                'status': status,
                'barista': barista_name or 'Unassigned',
                'load': current_load or 0
            })
        
        return jsonify({
            'success': True,
            'orders': orders,
            'stations': stations,
            'timestamp': coffee_system.current_time_formatted()
        })
        
    except Exception as e:
        logger.error(f"Error in API: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

@bp.route('/station/<int:station_id>')
def station_display(station_id):
    """Display specific to a single station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station info
        cursor = db.cursor()
        cursor.execute('''
            SELECT station_id, status, barista_name, current_load, specialist_drinks
            FROM station_stats
            WHERE station_id = ?
        ''', (station_id,))
        
        station = cursor.fetchone()
        
        if not station:
            return "Station not found", 404
        
        # Get station's orders
        cursor.execute('''
            SELECT id, order_number, status, 
                   strftime('%H:%M', created_at) as created_time,
                   phone, order_details,
                   queue_priority
            FROM orders 
            WHERE station_id = ? AND status IN ('pending', 'in-progress', 'completed')
            ORDER BY 
                queue_priority DESC,
                CASE 
                    WHEN status = 'completed' THEN 3
                    WHEN status = 'in-progress' THEN 2
                    WHEN status = 'pending' THEN 1
                END,
                created_at
            LIMIT 15
        ''', (station_id,))
        
        orders = []
        for order in cursor.fetchall():
            # Format order for display
            order_id, order_number, status, created_time, phone, order_details, priority = order
            
            # Format phone number for display (show last 4 digits)
            if phone and len(phone) > 4:
                display_phone = f"xxx-xxx-{phone[-4:]}"
            else:
                display_phone = "unknown"
            
            # Format order details
            order_desc = coffee_system.format_order_summary_short(order_details)
            
            orders.append({
                'order_number': order_number,
                'status': status,
                'created_time': created_time,
                'display_phone': display_phone,
                'description': order_desc,
                'priority': priority
            })
        
        # Get settings for display
        cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else 'Coffee Service'
        
        # Group orders by status
        orders_by_status = {
            'pending': [],
            'in-progress': [],
            'completed': []
        }
        
        for order in orders:
            status = order['status']
            if status in orders_by_status:
                orders_by_status[status].append(order)
        
        return render_template(
            'station_display.html',
            station=station,
            orders=orders,
            orders_by_status=orders_by_status,
            event_name=event_name,
            station_id=station_id
        )
        
    except Exception as e:
        logger.error(f"Error generating station display: {str(e)}")
        return render_template('display_error.html', error=str(e))
