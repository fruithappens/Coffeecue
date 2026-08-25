"""
Inventory Database API Routes for Expresso Coffee System
Provides database-backed inventory management endpoints

EVERY ROUTE HERE IS BEHIND A LOGIN. It was not: this module never
imported an auth decorator at all, so the five POST endpoints below --
which rewrite event inventory, stock levels and station configuration --
accepted writes from anyone who could reach the URL. That is not a
confidentiality problem, it is an integrity one: zeroing the stock
mid-service does not look like an attack, it looks like the system being
wrong about what is in the cupboard, and a barista would spend the
morning fighting it.

The frontend was already sending a token (DatabaseInventoryService goes
through ApiService, which attaches the Bearer header), so nothing had to
change on the client. The server simply never looked.

Writes are staff-and-above because they are event-wide. A barista
adjusting their own station's stock uses inventory_routes.py, which has
always had its own gate.
"""

from flask import Blueprint, request, jsonify
import logging
import json
from datetime import datetime

from auth import jwt_required_with_demo, role_required_with_demo
from utils.database import get_db_connection, close_connection, execute_query

# Create inventory database API blueprint
inventory_database_api = Blueprint('inventory_database_api', __name__)
logger = logging.getLogger(__name__)

def _rows_or_empty(db, sql):
    """Run a SELECT; treat a table that does not exist as no rows.

    These four tables are created by the migration system, which has
    never been run on production -- so `SELECT * FROM event_inventory`
    raises there and the whole endpoint 500s. An optional feature that
    was never set up should read as empty, not as a broken API.

    The rollback matters as much as the try. On Postgres a failed
    statement ABORTS the transaction, and every later query on that
    connection then fails with "current transaction is aborted" -- so
    without this, one missing table poisons the other three queries and
    the failure looks far worse than it is.
    """
    try:
        return execute_query(db, sql, fetch_all=True) or []
    except Exception as e:
        logger.warning("inventory query skipped (%s): %s", sql.split()[3], e)
        try:
            db.rollback()
        except Exception:
            pass
        return []


def _count_or_zero(db, table):
    """COUNT(*) for a table that may not exist yet. Same rollback rule as
    _rows_or_empty: a failed statement aborts the transaction, so without
    the rollback the FIRST missing table makes every later count fail too
    and the endpoint 500s over what should be a zero."""
    try:
        row = execute_query(db, f"SELECT COUNT(*) as count FROM {table}", fetch_one=True)
        return (row or {}).get('count', 0) or 0
    except Exception as e:
        logger.warning("inventory count skipped (%s): %s", table, e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


@inventory_database_api.route('/api/inventory/event-inventory/update', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_all_inventory():
    """Get all inventory data"""
    try:
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            result = {}
            
            # Get event inventory
            event_inventory = _rows_or_empty(db,
                "SELECT * FROM event_inventory ORDER BY category, item_name")
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
            stock_levels = _rows_or_empty(db,
                "SELECT * FROM event_stock_levels ORDER BY item_name")
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
            station_configs = _rows_or_empty(db,
                "SELECT * FROM station_inventory_configs ORDER BY station_id")
            if station_configs:
                result['station_inventory_configs'] = {}
                for config in station_configs:
                    result['station_inventory_configs'][str(config['station_id'])] = config['config_data']
            
            # Get station quantities
            station_quantities = _rows_or_empty(db,
                "SELECT * FROM station_inventory_quantities ORDER BY station_id, item_name")
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
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_stats():
    """Get inventory statistics"""
    try:
        db = get_db_connection()
        if not db:
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        try:
            stats = {}
            
            # Event inventory stats
            stats['event_inventory_items'] = _count_or_zero(db, 'event_inventory')
            
            # Stock levels stats
            stats['stock_items'] = _count_or_zero(db, 'event_stock_levels')
            
            # Station configs stats
            stats['station_configs'] = _count_or_zero(db, 'station_inventory_configs')
            
            # Station quantities stats
            stats['station_quantities'] = _count_or_zero(db, 'station_inventory_quantities')
            
            # Last update. One UNION across all four, so a single missing
            # table takes the whole query down -- which is exactly what
            # 500'd production even after the counts above were made safe.
            # Asked per table instead, so three present tables still give
            # an answer when the fourth is absent.
            latest = None
            for tbl in ('event_inventory', 'event_stock_levels',
                        'station_inventory_configs', 'station_inventory_quantities'):
                try:
                    row = execute_query(
                        db, f"SELECT MAX(updated_at) as last_update FROM {tbl}",
                        fetch_one=True)
                    value = (row or {}).get('last_update')
                    if value and (latest is None or value > latest):
                        latest = value
                except Exception as e:
                    logger.warning("inventory last_update skipped (%s): %s", tbl, e)
                    try:
                        db.rollback()
                    except Exception:
                        pass
            stats['last_update'] = latest.isoformat() if latest else None
            
            return jsonify({'success': True, 'data': stats})
            
        finally:
            close_connection(db)
        
    except Exception as e:
        logger.error(f"Error getting inventory stats: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500