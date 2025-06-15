"""
Inventory Database API Routes for Expresso Coffee System
Provides database-backed inventory management endpoints
"""

from flask import Blueprint, request, jsonify
import logging
import json
from datetime import datetime
from utils.database import get_db_connection, close_connection, execute_query

# Create inventory database API blueprint
inventory_database_api = Blueprint('inventory_database_api', __name__)
logger = logging.getLogger(__name__)

@inventory_database_api.route('/api/inventory/event-inventory/update', methods=['POST'])
def update_event_inventory():
    """Update event inventory item"""
    try:
        data = request.get_json()
        if not data or 'category' not in data or 'item_name' not in data:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
            
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            execute_query(db, """
                INSERT INTO event_inventory (category, item_name, enabled, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (category, item_name) 
                DO UPDATE SET 
                    enabled = EXCLUDED.enabled,
                    updated_at = EXCLUDED.updated_at
            """, (
                data['category'], 
                data['item_name'], 
                data.get('enabled', True),
                datetime.now()
            ))
            
            return jsonify({'success': True, 'message': 'Event inventory updated'})
            
        finally:
            close_connection(db)
            
    except Exception as e:
        logger.error(f"Error updating event inventory: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/event-stock/update', methods=['POST'])
def update_event_stock():
    """Update event stock level"""
    try:
        data = request.get_json()
        if not data or 'item_name' not in data:
            return jsonify({'success': False, 'error': 'Missing item_name'}), 400
            
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            execute_query(db, """
                INSERT INTO event_stock_levels 
                (item_name, category, total_quantity, allocated_quantity, available_quantity, unit, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (item_name)
                DO UPDATE SET
                    category = EXCLUDED.category,
                    total_quantity = EXCLUDED.total_quantity,
                    allocated_quantity = EXCLUDED.allocated_quantity,
                    available_quantity = EXCLUDED.available_quantity,
                    unit = EXCLUDED.unit,
                    updated_at = EXCLUDED.updated_at
            """, (
                data['item_name'],
                data.get('category', 'unknown'),
                data.get('total_quantity', 0),
                data.get('allocated_quantity', 0),
                data.get('available_quantity', 0),
                data.get('unit', 'units'),
                datetime.now()
            ))
            
            return jsonify({'success': True, 'message': 'Stock level updated'})
            
        finally:
            close_connection(db)
            
    except Exception as e:
        logger.error(f"Error updating stock level: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/station-config/update', methods=['POST'])
def update_station_config():
    """Update station inventory configuration"""
    try:
        data = request.get_json()
        if not data or 'station_id' not in data or 'config_data' not in data:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
            
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            execute_query(db, """
                INSERT INTO station_inventory_configs (station_id, config_data, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (station_id)
                DO UPDATE SET
                    config_data = EXCLUDED.config_data,
                    updated_at = EXCLUDED.updated_at
            """, (
                data['station_id'],
                json.dumps(data['config_data']),
                datetime.now()
            ))
            
            return jsonify({'success': True, 'message': 'Station config updated'})
            
        finally:
            close_connection(db)
            
    except Exception as e:
        logger.error(f"Error updating station config: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/station-quantity/update', methods=['POST'])
def update_station_quantity():
    """Update station inventory quantity"""
    try:
        data = request.get_json()
        if not data or 'station_id' not in data or 'item_name' not in data:
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
            
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            execute_query(db, """
                INSERT INTO station_inventory_quantities 
                (station_id, item_name, quantity, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (station_id, item_name)
                DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    updated_at = EXCLUDED.updated_at
            """, (
                data['station_id'],
                data['item_name'],
                data.get('quantity', 0),
                datetime.now()
            ))
            
            return jsonify({'success': True, 'message': 'Station quantity updated'})
            
        finally:
            close_connection(db)
            
    except Exception as e:
        logger.error(f"Error updating station quantity: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/batch-update', methods=['POST'])
def batch_update():
    """Perform batch updates to inventory"""
    try:
        data = request.get_json()
        if not data or 'updates' not in data:
            return jsonify({'success': False, 'error': 'Missing updates data'}), 400
            
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            # Process each update in the batch
            for update in data['updates']:
                update_type = update.get('type')
                update_data = update.get('data')
                
                if update_type == 'event_inventory':
                    execute_query(db, """
                        INSERT INTO event_inventory (category, item_name, enabled, updated_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (category, item_name) 
                        DO UPDATE SET 
                            enabled = EXCLUDED.enabled,
                            updated_at = EXCLUDED.updated_at
                    """, (
                        update_data['category'], 
                        update_data['item_name'], 
                        update_data.get('enabled', True),
                        datetime.now()
                    ))
                    
                elif update_type == 'event_stock':
                    execute_query(db, """
                        INSERT INTO event_stock_levels 
                        (item_name, category, total_quantity, allocated_quantity, available_quantity, unit, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (item_name)
                        DO UPDATE SET
                            category = EXCLUDED.category,
                            total_quantity = EXCLUDED.total_quantity,
                            allocated_quantity = EXCLUDED.allocated_quantity,
                            available_quantity = EXCLUDED.available_quantity,
                            unit = EXCLUDED.unit,
                            updated_at = EXCLUDED.updated_at
                    """, (
                        update_data['item_name'],
                        update_data.get('category', 'unknown'),
                        update_data.get('total_quantity', 0),
                        update_data.get('allocated_quantity', 0),
                        update_data.get('available_quantity', 0),
                        update_data.get('unit', 'units'),
                        datetime.now()
                    ))
                    
                elif update_type == 'station_config':
                    execute_query(db, """
                        INSERT INTO station_inventory_configs (station_id, config_data, updated_at)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (station_id)
                        DO UPDATE SET
                            config_data = EXCLUDED.config_data,
                            updated_at = EXCLUDED.updated_at
                    """, (
                        update_data['station_id'],
                        json.dumps(update_data['config_data']),
                        datetime.now()
                    ))
                    
                elif update_type == 'station_quantity':
                    execute_query(db, """
                        INSERT INTO station_inventory_quantities 
                        (station_id, item_name, quantity, updated_at)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (station_id, item_name)
                        DO UPDATE SET
                            quantity = EXCLUDED.quantity,
                            updated_at = EXCLUDED.updated_at
                    """, (
                        update_data['station_id'],
                        update_data['item_name'],
                        update_data.get('quantity', 0),
                        datetime.now()
                    ))
            
            return jsonify({'success': True, 'message': f'Batch update completed ({len(data["updates"])} updates)'})
            
        finally:
            close_connection(db)
            
    except Exception as e:
        logger.error(f"Error in batch update: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/get-all', methods=['GET'])
def get_all_inventory():
    """Get all inventory data"""
    try:
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            result = {}
            
            # Get event inventory
            event_inventory = execute_query(db, 
                "SELECT * FROM event_inventory ORDER BY category, item_name", 
                fetch_all=True)
            if event_inventory:
                result['event_inventory'] = {}
                for item in event_inventory:
                    category = item['category']
                    if category not in result['event_inventory']:
                        result['event_inventory'][category] = {}
                    result['event_inventory'][category][item['item_name']] = {
                        'enabled': item['enabled']
                    }
            
            # Get event stock levels
            stock_levels = execute_query(db,
                "SELECT * FROM event_stock_levels ORDER BY item_name",
                fetch_all=True)
            if stock_levels:
                result['event_stock_levels'] = {}
                for stock in stock_levels:
                    result['event_stock_levels'][stock['item_name']] = {
                        'category': stock['category'],
                        'total': float(stock['total_quantity']),
                        'allocated': float(stock['allocated_quantity']),
                        'available': float(stock['available_quantity']),
                        'unit': stock['unit']
                    }
            
            # Get station configs
            station_configs = execute_query(db,
                "SELECT * FROM station_inventory_configs ORDER BY station_id",
                fetch_all=True)
            if station_configs:
                result['station_inventory_configs'] = {}
                for config in station_configs:
                    result['station_inventory_configs'][str(config['station_id'])] = config['config_data']
            
            # Get station quantities
            station_quantities = execute_query(db,
                "SELECT * FROM station_inventory_quantities ORDER BY station_id, item_name",
                fetch_all=True)
            if station_quantities:
                result['station_inventory_quantities'] = {}
                for qty in station_quantities:
                    station_id = str(qty['station_id'])
                    if station_id not in result['station_inventory_quantities']:
                        result['station_inventory_quantities'][station_id] = {}
                    result['station_inventory_quantities'][station_id][qty['item_name']] = float(qty['quantity'])
            
            return jsonify({'success': True, 'data': result})
            
        finally:
            close_connection(db)
        
    except Exception as e:
        logger.error(f"Error getting all inventory: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@inventory_database_api.route('/api/inventory/stats', methods=['GET'])
def get_inventory_stats():
    """Get inventory statistics"""
    try:
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            stats = {}
            
            # Event inventory stats
            event_inventory_count = execute_query(db,
                "SELECT COUNT(*) as count FROM event_inventory",
                fetch_one=True)
            stats['event_inventory_items'] = event_inventory_count['count'] if event_inventory_count else 0
            
            # Stock levels stats
            stock_count = execute_query(db,
                "SELECT COUNT(*) as count FROM event_stock_levels",
                fetch_one=True)
            stats['stock_items'] = stock_count['count'] if stock_count else 0
            
            # Station configs stats
            config_count = execute_query(db,
                "SELECT COUNT(*) as count FROM station_inventory_configs",
                fetch_one=True)
            stats['station_configs'] = config_count['count'] if config_count else 0
            
            # Station quantities stats
            quantity_count = execute_query(db,
                "SELECT COUNT(*) as count FROM station_inventory_quantities",
                fetch_one=True)
            stats['station_quantities'] = quantity_count['count'] if quantity_count else 0
            
            # Last update
            last_update = execute_query(db,
                """SELECT MAX(updated_at) as last_update FROM (
                    SELECT updated_at FROM event_inventory
                    UNION ALL
                    SELECT updated_at FROM event_stock_levels
                    UNION ALL
                    SELECT updated_at FROM station_inventory_configs
                    UNION ALL
                    SELECT updated_at FROM station_inventory_quantities
                ) as all_updates""",
                fetch_one=True)
            stats['last_update'] = last_update['last_update'].isoformat() if last_update and last_update['last_update'] else None
            
            return jsonify({'success': True, 'data': stats})
            
        finally:
            close_connection(db)
        
    except Exception as e:
        logger.error(f"Error getting inventory stats: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500