"""
Display API routes for public order status screens
This module provides API endpoints specifically for the React display screen
"""

import logging
from flask import Blueprint, jsonify, request, current_app
from datetime import datetime
import json

# Create blueprint
bp = Blueprint('display_api', __name__, url_prefix='/api/display')

# Set up logging
logger = logging.getLogger("expresso.routes.display_api")

@bp.route('/config', methods=['GET'])
def get_display_config():
    """Get display screen configuration including event details, sponsor info, and SMS details"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get settings from database
        cursor = db.cursor()
        
        # System name (default to 'Coffee Cue')
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('system_name',))
        system_name_result = cursor.fetchone()
        system_name = system_name_result[0] if system_name_result else 'Coffee Cue'
        
        # Event name
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('event_name',))
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else current_app.config.get('config', {}).get('EVENT_NAME', 'Coffee Event')
        
        # Sponsor info
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_display_enabled',))
        sponsor_display_result = cursor.fetchone()
        sponsor_display_enabled = sponsor_display_result[0].lower() in ('true', 'yes', '1', 't', 'y') if sponsor_display_result else False
        
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_name',))
        sponsor_name_result = cursor.fetchone()
        sponsor_name = sponsor_name_result[0] if sponsor_name_result and sponsor_display_enabled else ''
        
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_message',))
        sponsor_message_result = cursor.fetchone()
        sponsor_message = sponsor_message_result[0] if sponsor_message_result and sponsor_display_enabled else 'Coffee service proudly sponsored by {sponsor}'
        
        # Format sponsor message
        if sponsor_display_enabled and sponsor_name and '{sponsor}' in sponsor_message:
            sponsor_message = sponsor_message.replace('{sponsor}', sponsor_name)
        
        # SMS configuration
        twilio_number = current_app.config.get('config', {}).get('TWILIO_PHONE_NUMBER', '')
        
        # Wait time
        cursor.execute("""
            SELECT wait_time FROM station_stats 
            WHERE status = 'active' 
            ORDER BY station_id LIMIT 1
        """)
        wait_time_result = cursor.fetchone()
        wait_time = wait_time_result[0] if wait_time_result else "8-10"
        
        # Get active stations
        cursor.execute("""
            SELECT station_id, name, location, status, barista_name 
            FROM station_stats 
            WHERE status = 'active'
            ORDER BY station_id
        """)
        
        stations = []
        try:
            station_rows = cursor.fetchall()
            for row in station_rows:
                station_id, name, location, status, barista_name = row
                station_name = name or f"Station #{station_id}"
                station_location = location or "Main Venue"
                
                stations.append({
                    "id": station_id,
                    "name": station_name,
                    "location": station_location,
                    "status": status,
                    "barista": barista_name or "Unassigned"
                })
        except Exception as e:
            logger.error(f"Error processing station data: {str(e)}")
            # Fallback station if there's an error
            stations = [{
                "id": 1,
                "name": "Station #1",
                "location": "Main Hall",
                "status": "active",
                "barista": "Unassigned"
            }]
            
        # Return display configuration
        return jsonify({
            "success": True,
            "config": {
                "system_name": system_name,
                "event_name": event_name,
                "sms_number": twilio_number,
                "sponsor": {
                    "enabled": sponsor_display_enabled,
                    "name": sponsor_name,
                    "message": sponsor_message
                },
                "wait_time": wait_time,
                "stations": stations,
                "app_version": current_app.config.get('config', {}).get('APP_VERSION', '1.0.0')
            }
        })
    
    except Exception as e:
        logger.error(f"Error getting display config: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/orders', methods=['GET'])
def get_display_orders():
    """Get orders for the display screen"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station ID from query params (optional)
        station_id = request.args.get('station_id')
        
        # Base query for orders
        query = """
            SELECT id, order_number, status, station_id, 
                   created_at, completed_at, phone, order_details
            FROM orders 
            WHERE status IN ('in-progress', 'completed')
            AND completed_at > (NOW() - INTERVAL '2 hours')
        """
        
        params = []
        
        # Filter by station if specified
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add order clause
        query += """
            ORDER BY 
                CASE 
                    WHEN status = 'completed' THEN 2
                    WHEN status = 'in-progress' THEN 1
                END,
                created_at DESC
            LIMIT 20
        """
        
        # Execute query
        cursor = db.cursor()
        cursor.execute(query, params if params else None)
        
        # Process orders
        in_progress_orders = []
        completed_orders = []
        
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, order_station_id, created_at, completed_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
            
            # Format phone number for display (show only last 4 digits)
            display_phone = "xxxx"
            if phone and len(phone) >= 4:
                display_phone = phone[-4:]
            
            # Get customer name from preferences or order details
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            customer_result = cursor.fetchone()
            customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
            
            # Format order
            formatted_order = {
                "id": order_id,
                "order_number": order_number,
                "customerName": customer_name,
                "displayPhone": display_phone,
                "coffeeType": order_details.get('type', 'Coffee'),
                "status": status,
                "stationId": order_station_id
            }
            
            if status == 'in-progress':
                in_progress_orders.append(formatted_order)
            elif status == 'completed':
                completed_orders.append(formatted_order)
        
        return jsonify({
            "success": True,
            "orders": {
                "inProgress": in_progress_orders,
                "ready": completed_orders
            },
            "timestamp": datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error getting display orders: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })