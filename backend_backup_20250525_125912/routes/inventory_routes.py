"""
API routes for inventory management
"""
from flask import Blueprint, jsonify, request, current_app, g
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
import logging
import json
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

from models.inventory import InventoryItem
from utils.helpers import role_required
from auth import jwt_required_with_demo, role_required_with_demo

# Set up logging
logger = logging.getLogger("expresso.routes.inventory")

# Create blueprint
bp = Blueprint('inventory', __name__)

# Get current user ID helper
def get_current_user_id():
    """Get current user ID from JWT"""
    try:
        # Get JWT identity
        user_id = get_jwt_identity()
        return user_id
    except Exception:
        # Fall back to g.user if available
        if hasattr(g, 'user') and g.user and 'id' in g.user:
            return g.user['id']
        return None

# Ensure inventory management tables exist
def ensure_inventory_management_tables(db):
    """Ensure inventory management related tables exist"""
    try:
        cursor = db.cursor()
        
        # Check and create inventory_alerts table
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'inventory_alerts'
            )
        """)
        if not cursor.fetchone()[0]:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_alerts (
                id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
                alert_type VARCHAR(50) NOT NULL,
                urgency VARCHAR(20) DEFAULT 'normal',
                notes TEXT,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                resolved_at TIMESTAMP,
                resolved_by INTEGER
            )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_alerts_item_id ON inventory_alerts(item_id)')
            logger.info("Created inventory_alerts table")
        
        # Check and create restock_requests table
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'restock_requests'
            )
        """)
        if not cursor.fetchone()[0]:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS restock_requests (
                id SERIAL PRIMARY KEY,
                status VARCHAR(20) DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                completed_at TIMESTAMP,
                completed_by INTEGER
            )
            ''')
            logger.info("Created restock_requests table")
        
        # Check and create restock_request_items table
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'restock_request_items'
            )
        """)
        if not cursor.fetchone()[0]:
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS restock_request_items (
                id SERIAL PRIMARY KEY,
                restock_id INTEGER NOT NULL REFERENCES restock_requests(id) ON DELETE CASCADE,
                item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
                requested_amount DECIMAL(10,2) NOT NULL,
                received_amount DECIMAL(10,2),
                notes TEXT,
                status VARCHAR(20) DEFAULT 'pending'
            )
            ''')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_restock_request_items_restock_id ON restock_request_items(restock_id)')
            logger.info("Created restock_request_items table")
        
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"Error ensuring inventory management tables: {str(e)}")
        return False

# Get all inventory items
@bp.route('/api/inventory', methods=['GET'])
@jwt_required_with_demo(optional=True)
def get_inventory():
    """Get all inventory items, optionally filtered by category"""
    try:
        # Get query parameters
        category = request.args.get('category')
        station_id = request.args.get('station_id')
        
        # Convert station_id to int if provided
        if station_id:
            try:
                station_id = int(station_id)
            except ValueError:
                station_id = None
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get inventory items with filters
        items = InventoryItem.get_all(db, category, station_id)
        
        return jsonify({
            'success': True,
            'count': len(items),
            'items': items
        })
    except Exception as e:
        logger.error(f"Error getting inventory: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get inventory item by ID
@bp.route('/api/inventory/<int:item_id>', methods=['GET'])
@jwt_required_with_demo(optional=True)
def get_inventory_item(item_id):
    """Get inventory item by ID"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get item
        item = InventoryItem.get_by_id(db, item_id)
        
        if not item:
            return jsonify({
                'success': False,
                'error': f'Item not found with ID {item_id}'
            }), 404
        
        # Get history
        history = InventoryItem.get_history(db, item_id)
        
        return jsonify({
            'success': True,
            'item': item,
            'history': history
        })
    except Exception as e:
        logger.error(f"Error getting inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Create new inventory item
@bp.route('/api/inventory', methods=['POST'])
@jwt_required_with_demo()
def create_inventory_item():
    """Create a new inventory item"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create item
        item_id = InventoryItem.create(db, data, user_id)
        
        if not item_id:
            return jsonify({
                'success': False,
                'error': 'Failed to create inventory item'
            }), 400
        
        # Get new item
        new_item = InventoryItem.get_by_id(db, item_id)
        
        return jsonify({
            'success': True,
            'message': f'Inventory item created successfully',
            'item': new_item
        }), 201
    except Exception as e:
        logger.error(f"Error creating inventory item: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update inventory item
@bp.route('/api/inventory/<int:item_id>', methods=['PUT', 'PATCH'])
@jwt_required_with_demo()
def update_inventory_item(item_id):
    """Update an inventory item"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update item
        success = InventoryItem.update(db, item_id, data, user_id)
        
        if not success:
            return jsonify({
                'success': False,
                'error': f'Failed to update inventory item {item_id}'
            }), 400
        
        # Get updated item
        updated_item = InventoryItem.get_by_id(db, item_id)
        
        return jsonify({
            'success': True,
            'message': f'Inventory item updated successfully',
            'item': updated_item
        })
    except Exception as e:
        logger.error(f"Error updating inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Delete inventory item
@bp.route('/api/inventory/<int:item_id>', methods=['DELETE'])
@jwt_required_with_demo()
def delete_inventory_item(item_id):
    """Delete an inventory item"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete item
        success = InventoryItem.delete(db, item_id)
        
        if not success:
            return jsonify({
                'success': False,
                'error': f'Failed to delete inventory item {item_id}'
            }), 400
        
        return jsonify({
            'success': True,
            'message': f'Inventory item deleted successfully'
        })
    except Exception as e:
        logger.error(f"Error deleting inventory item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get low stock items
@bp.route('/api/inventory/low-stock', methods=['GET'])
@jwt_required_with_demo(optional=True)
def get_low_stock():
    """Get items with stock below minimum threshold"""
    try:
        # Get query parameters
        station_id = request.args.get('station_id')
        
        # Convert station_id to int if provided
        if station_id:
            try:
                station_id = int(station_id)
            except ValueError:
                station_id = None
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get low stock items
        items = InventoryItem.get_low_stock_items(db, station_id)
        
        return jsonify({
            'success': True,
            'count': len(items),
            'items': items
        })
    except Exception as e:
        logger.error(f"Error getting low stock items: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
        
# Report low stock
@bp.route('/api/inventory/<int:item_id>/report-low', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def report_low_stock(item_id):
    """Report an item as low in stock"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get urgency, defaulting to normal
        urgency = data.get('urgency', 'normal')
        
        # Validate urgency
        valid_urgencies = ['low', 'normal', 'high', 'critical']
        if urgency not in valid_urgencies:
            return jsonify({
                'success': False,
                'error': f'Invalid urgency level. Must be one of: {", ".join(valid_urgencies)}'
            }), 400
        
        # Get notes
        notes = data.get('notes', '')
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Verify the item exists
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
        item = cursor.fetchone()
        
        if not item:
            return jsonify({
                'success': False,
                'error': f'Item not found with ID {item_id}'
            }), 404
        
        # Check if there's already a pending alert for this item
        cursor.execute("""
            SELECT id FROM inventory_alerts 
            WHERE item_id = %s AND status = 'pending' AND alert_type = 'low_stock'
        """, (item_id,))
        
        existing_alert = cursor.fetchone()
        
        if existing_alert:
            # Update existing alert
            cursor.execute("""
                UPDATE inventory_alerts 
                SET urgency = %s, notes = %s, created_at = %s, created_by = %s
                WHERE id = %s
            """, (urgency, notes, datetime.now(), user_id, existing_alert['id']))
            
            alert_id = existing_alert['id']
            is_new = False
        else:
            # Create new alert
            cursor.execute("""
                INSERT INTO inventory_alerts 
                (item_id, alert_type, urgency, notes, status, created_at, created_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (item_id, 'low_stock', urgency, notes, 'pending', datetime.now(), user_id))
            
            alert_id = cursor.fetchone()[0]
            is_new = True
        
        db.commit()
        
        # Get the item details for response
        item_with_status = dict(item)
        item_with_status['status'] = InventoryItem._calculate_status(item)
        
        return jsonify({
            'success': True,
            'message': 'Low stock report created successfully' if is_new else 'Low stock report updated successfully',
            'alert_id': alert_id,
            'item': item_with_status
        })
    except Exception as e:
        logger.error(f"Error reporting low stock for item {item_id}: {str(e)}")
        if 'db' in locals() and db:
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Adjust stock level
@bp.route('/api/inventory/<int:item_id>/adjust', methods=['POST'])
@jwt_required_with_demo()
def adjust_stock(item_id):
    """Adjust stock level with history tracking"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        required_fields = ['new_amount', 'change_reason']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Adjust stock
        success = InventoryItem.adjust_stock(
            db, 
            item_id, 
            data['new_amount'], 
            data['change_reason'],
            data.get('notes'),
            user_id
        )
        
        if not success:
            return jsonify({
                'success': False,
                'error': f'Failed to adjust stock for item {item_id}'
            }), 400
        
        # Get updated item
        updated_item = InventoryItem.get_by_id(db, item_id)
        
        return jsonify({
            'success': True,
            'message': f'Stock adjusted successfully',
            'item': updated_item
        })
    except Exception as e:
        logger.error(f"Error adjusting stock for item {item_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get inventory categories
@bp.route('/api/inventory/categories', methods=['GET'])
def get_categories():
    """Get available inventory categories"""
    return jsonify({
        'success': True,
        'categories': InventoryItem.CATEGORIES
    })

# Add custom stock item
@bp.route('/api/inventory/add-custom-item', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_custom_item():
    """Add a custom stock item (milk, coffee, etc.) to inventory"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        required_fields = ['name', 'category', 'amount', 'capacity', 'unit']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Validate category
        if data['category'] not in InventoryItem.CATEGORIES:
            return jsonify({
                'success': False,
                'error': f'Invalid category. Must be one of: {", ".join(InventoryItem.CATEGORIES)}'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if item already exists
        cursor = db.cursor()
        cursor.execute("""
            SELECT id FROM inventory_items 
            WHERE category = %s AND name = %s
        """, (data['category'], data['name']))
        
        existing = cursor.fetchone()
        
        if existing:
            return jsonify({
                'success': False,
                'error': f'An item with name "{data["name"]}" already exists in category "{data["category"]}"'
            }), 400
        
        # Get user ID for tracking
        user_id = get_current_user_id()
        
        # Create the item
        item_id = InventoryItem.create(db, data, user_id)
        
        if not item_id:
            return jsonify({
                'success': False,
                'error': 'Failed to create item'
            }), 500
        
        # Get created item
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
        item = cursor.fetchone()
        
        return jsonify({
            'success': True,
            'message': 'Item created successfully',
            'item': item
        })
        
    except Exception as e:
        logger.error(f"Error adding custom item: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add milk options
@bp.route('/api/inventory/add-milk-options', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_milk_options():
    """Add standard and alternative milk options to inventory"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Standard Milk Types
        standard_milks = [
            {"name": "Full Cream Milk", "category": "milk", "amount": 20, "capacity": 20, "unit": "L"},
            {"name": "Skim Milk", "category": "milk", "amount": 10, "capacity": 10, "unit": "L"},
            {"name": "Reduced Fat Milk", "category": "milk", "amount": 10, "capacity": 10, "unit": "L"},
            {"name": "Lactose-Free Milk", "category": "milk", "amount": 5, "capacity": 5, "unit": "L"}
        ]
        
        # Alternative Milk Types
        alternative_milks = [
            {"name": "Soy Milk", "category": "milk", "amount": 5, "capacity": 5, "unit": "L"},
            {"name": "Almond Milk", "category": "milk", "amount": 5, "capacity": 5, "unit": "L"},
            {"name": "Oat Milk", "category": "milk", "amount": 5, "capacity": 5, "unit": "L"},
            {"name": "Coconut Milk", "category": "milk", "amount": 3, "capacity": 3, "unit": "L"},
            {"name": "Macadamia Milk", "category": "milk", "amount": 3, "capacity": 3, "unit": "L"},
            {"name": "Rice Milk", "category": "milk", "amount": 3, "capacity": 3, "unit": "L"}
        ]
        
        # Add custom milk if provided
        if request.is_json:
            data = request.json
            if 'custom_milk' in data and data['custom_milk']:
                custom_milk = {
                    "name": data['custom_milk'],
                    "category": "milk",
                    "amount": data.get('amount', 3),
                    "capacity": data.get('capacity', 3),
                    "unit": "L"
                }
                alternative_milks.append(custom_milk)
        
        # Combine all milk types
        all_milks = standard_milks + alternative_milks
        
        # Get user ID for tracking
        user_id = get_current_user_id()
        
        # Add each milk type if it doesn't already exist
        added_milks = []
        existing_milks = []
        
        for milk in all_milks:
            # Check if this milk type already exists
            cursor = db.cursor()
            cursor.execute("""
                SELECT id FROM inventory_items 
                WHERE category = 'milk' AND name = %s
            """, (milk['name'],))
            
            existing = cursor.fetchone()
            
            if existing:
                existing_milks.append(milk['name'])
                continue
            
            # Add new milk type
            milk_id = InventoryItem.create(db, milk, user_id)
            if milk_id:
                added_milks.append(milk['name'])
        
        return jsonify({
            'success': True,
            'message': f'Added {len(added_milks)} milk types',
            'added': added_milks,
            'existing': existing_milks
        })
        
    except Exception as e:
        logger.error(f"Error adding milk options: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add coffee types
@bp.route('/api/inventory/add-coffee-types', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_coffee_types():
    """Add standard coffee types to inventory"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Standard Coffee Types
        standard_coffees = [
            {"name": "Cappuccino", "category": "coffee_type", "notes": "Classic with equal parts espresso, steamed milk and foam", "is_active": True},
            {"name": "Latte", "category": "coffee_type", "notes": "Espresso with steamed milk and a thin layer of foam", "is_active": True},
            {"name": "Flat White", "category": "coffee_type", "notes": "Espresso with steamed milk and minimal foam", "is_active": True},
            {"name": "Espresso", "category": "coffee_type", "notes": "Pure concentrated coffee shot", "is_active": True},
            {"name": "Long Black", "category": "coffee_type", "notes": "Hot water with espresso", "is_active": True},
            {"name": "Mocha", "category": "coffee_type", "notes": "Espresso with chocolate and steamed milk", "is_active": True},
            {"name": "Hot Chocolate", "category": "coffee_type", "notes": "Chocolate with steamed milk", "is_active": True},
            {"name": "Chai Latte", "category": "coffee_type", "notes": "Spiced tea with steamed milk", "is_active": True},
            {"name": "Matcha Latte", "category": "coffee_type", "notes": "Green tea powder with steamed milk", "is_active": True},
            {"name": "Piccolo", "category": "coffee_type", "notes": "Small latte in an espresso cup", "is_active": True},
            {"name": "Macchiato", "category": "coffee_type", "notes": "Espresso with a dollop of milk foam", "is_active": True},
            {"name": "Affogato", "category": "coffee_type", "notes": "Espresso poured over ice cream", "is_active": True},
            {"name": "Cold Brew", "category": "coffee_type", "notes": "Coffee steeped in cold water", "is_active": True}
        ]
        
        # Add custom coffee if provided
        if request.is_json:
            data = request.json
            if 'custom_coffee' in data and data['custom_coffee']:
                custom_coffee = {
                    "name": data['custom_coffee'],
                    "category": "coffee_type",
                    "notes": data.get('notes', ''),
                    "is_active": True
                }
                standard_coffees.append(custom_coffee)
        
        # Get user ID for tracking
        user_id = get_current_user_id()
        
        # Create the stock_items table if it doesn't exist
        cursor = db.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS stock_items (
                id SERIAL PRIMARY KEY,
                category VARCHAR(50) NOT NULL,
                name VARCHAR(100) NOT NULL,
                notes TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER
            )
        """)
        db.commit()
        
        # Add each coffee type if it doesn't already exist
        added_coffees = []
        existing_coffees = []
        
        for coffee in standard_coffees:
            # Check if this coffee type already exists
            cursor = db.cursor()
            cursor.execute("""
                SELECT id FROM stock_items 
                WHERE category = 'coffee_type' AND name = %s
            """, (coffee['name'],))
            
            existing = cursor.fetchone()
            
            if existing:
                existing_coffees.append(coffee['name'])
                continue
            
            # Add new coffee type
            cursor.execute("""
                INSERT INTO stock_items 
                (category, name, notes, is_active, created_by)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            """, (
                coffee['category'],
                coffee['name'],
                coffee.get('notes', ''),
                coffee.get('is_active', True),
                user_id
            ))
            
            coffee_id = cursor.fetchone()[0]
            db.commit()
            
            if coffee_id:
                added_coffees.append(coffee['name'])
        
        return jsonify({
            'success': True,
            'message': f'Added {len(added_coffees)} coffee types',
            'added': added_coffees,
            'existing': existing_coffees
        })
        
    except Exception as e:
        logger.error(f"Error adding coffee types: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Create a restock request
@bp.route('/api/inventory/restock-request', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def create_restock_request():
    """Create a restock request for multiple items"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        if 'items' not in data or not isinstance(data['items'], list) or len(data['items']) == 0:
            return jsonify({
                'success': False,
                'error': 'Request must include at least one item in the items array'
            }), 400
        
        # Validate each item has an id and quantity
        for i, item in enumerate(data['items']):
            if 'id' not in item:
                return jsonify({
                    'success': False,
                    'error': f'Item at position {i} is missing required field: id'
                }), 400
            if 'quantity' not in item:
                return jsonify({
                    'success': False,
                    'error': f'Item at position {i} is missing required field: quantity'
                }), 400
        
        # Get notes
        notes = data.get('notes', '')
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start transaction
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Verify all items exist
        item_ids = [item['id'] for item in data['items']]
        placeholders = ', '.join(['%s'] * len(item_ids))
        cursor.execute(f"SELECT id, name FROM inventory_items WHERE id IN ({placeholders})", item_ids)
        found_items = cursor.fetchall()
        
        found_ids = [item['id'] for item in found_items]
        missing_ids = [str(item_id) for item_id in item_ids if item_id not in found_ids]
        
        if missing_ids:
            return jsonify({
                'success': False,
                'error': f'Items not found with IDs: {", ".join(missing_ids)}'
            }), 404
        
        # Create restock request
        cursor.execute("""
            INSERT INTO restock_requests
            (status, notes, created_at, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, ('pending', notes, datetime.now(), user_id))
        
        restock_id = cursor.fetchone()['id']
        
        # Add requested items
        for item in data['items']:
            item_id = item['id']
            quantity = float(item['quantity'])
            item_notes = item.get('notes', '')
            
            cursor.execute("""
                INSERT INTO restock_request_items
                (restock_id, item_id, requested_amount, notes, status)
                VALUES (%s, %s, %s, %s, %s)
            """, (restock_id, item_id, quantity, item_notes, 'pending'))
        
        # Resolve any low stock alerts for these items
        cursor.execute(f"""
            UPDATE inventory_alerts
            SET status = 'resolved', resolved_at = %s, resolved_by = %s
            WHERE item_id IN ({placeholders}) 
            AND alert_type = 'low_stock' 
            AND status = 'pending'
        """, [datetime.now(), user_id] + item_ids)
        
        db.commit()
        
        # Get the complete restock request with items for the response
        cursor.execute("""
            SELECT r.*, u.username as created_by_name
            FROM restock_requests r
            LEFT JOIN users u ON r.created_by = u.id
            WHERE r.id = %s
        """, (restock_id,))
        restock = cursor.fetchone()
        
        cursor.execute("""
            SELECT ri.*, i.name as item_name, i.category, i.unit
            FROM restock_request_items ri
            JOIN inventory_items i ON ri.item_id = i.id
            WHERE ri.restock_id = %s
        """, (restock_id,))
        restock_items = cursor.fetchall()
        
        # Format the response
        result = dict(restock)
        result['items'] = restock_items
        result['created_at_formatted'] = result['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        if result['completed_at']:
            result['completed_at_formatted'] = result['completed_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'message': 'Restock request created successfully',
            'restock_request': result
        }), 201
    except Exception as e:
        logger.error(f"Error creating restock request: {str(e)}")
        if 'db' in locals() and db:
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get restock requests
@bp.route('/api/inventory/restock-requests', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_restock_requests():
    """Get list of restock requests"""
    try:
        # Get query parameters
        status = request.args.get('status')
        limit = request.args.get('limit', 50)
        offset = request.args.get('offset', 0)
        
        # Convert limit and offset to int
        try:
            limit = int(limit)
            offset = int(offset)
        except ValueError:
            limit = 50
            offset = 0
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start query
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Count total requests
        count_query = """
            SELECT COUNT(*) as total
            FROM restock_requests
        """
        
        count_params = []
        
        if status:
            count_query += " WHERE status = %s"
            count_params.append(status)
        
        cursor.execute(count_query, count_params)
        total = cursor.fetchone()['total']
        
        # Get restock requests with pagination
        query = """
            SELECT r.*, u1.username as created_by_name, u2.username as completed_by_name,
                (SELECT COUNT(*) FROM restock_request_items WHERE restock_id = r.id) as item_count
            FROM restock_requests r
            LEFT JOIN users u1 ON r.created_by = u1.id
            LEFT JOIN users u2 ON r.completed_by = u2.id
        """
        
        params = []
        
        if status:
            query += " WHERE r.status = %s"
            params.append(status)
        
        query += " ORDER BY r.created_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        
        cursor.execute(query, params)
        restock_requests = cursor.fetchall()
        
        # Format dates
        for req in restock_requests:
            req['created_at_formatted'] = req['created_at'].strftime('%Y-%m-%d %H:%M:%S')
            if req['completed_at']:
                req['completed_at_formatted'] = req['completed_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'count': len(restock_requests),
            'total': total,
            'restock_requests': restock_requests,
            'pagination': {
                'limit': limit,
                'offset': offset,
                'has_more': offset + len(restock_requests) < total
            }
        })
    except Exception as e:
        logger.error(f"Error getting restock requests: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get a specific restock request with details
@bp.route('/api/inventory/restock-requests/<int:restock_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_restock_request(restock_id):
    """Get details of a specific restock request"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Get restock request
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT r.*, u1.username as created_by_name, u2.username as completed_by_name
            FROM restock_requests r
            LEFT JOIN users u1 ON r.created_by = u1.id
            LEFT JOIN users u2 ON r.completed_by = u2.id
            WHERE r.id = %s
        """, (restock_id,))
        
        restock = cursor.fetchone()
        
        if not restock:
            return jsonify({
                'success': False,
                'error': f'Restock request not found with ID {restock_id}'
            }), 404
        
        # Get items for this restock request
        cursor.execute("""
            SELECT ri.*, i.name as item_name, i.category, i.unit, i.amount as current_amount
            FROM restock_request_items ri
            JOIN inventory_items i ON ri.item_id = i.id
            WHERE ri.restock_id = %s
        """, (restock_id,))
        
        items = cursor.fetchall()
        
        # Format dates
        result = dict(restock)
        result['created_at_formatted'] = result['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        if result['completed_at']:
            result['completed_at_formatted'] = result['completed_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        result['items'] = items
        
        return jsonify({
            'success': True,
            'restock_request': result
        })
    except Exception as e:
        logger.error(f"Error getting restock request {restock_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
        
# Complete a restock request
@bp.route('/api/inventory/restock-requests/<int:restock_id>/complete', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def complete_restock_request(restock_id):
    """Complete a restock request and update inventory"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate that items array exists
        if 'items' not in data or not isinstance(data['items'], list):
            return jsonify({
                'success': False,
                'error': 'Request must include items array'
            }), 400
        
        # Get notes
        notes = data.get('notes', '')
        
        # Get current user ID
        user_id = get_current_user_id()
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start transaction
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Check if request exists and is pending
        cursor.execute("""
            SELECT * FROM restock_requests
            WHERE id = %s
        """, (restock_id,))
        
        restock = cursor.fetchone()
        
        if not restock:
            return jsonify({
                'success': False,
                'error': f'Restock request not found with ID {restock_id}'
            }), 404
        
        if restock['status'] != 'pending':
            return jsonify({
                'success': False,
                'error': f'Restock request has already been {restock["status"]}'
            }), 400
        
        # Get the items in this restock request
        cursor.execute("""
            SELECT ri.*, i.name as item_name, i.amount as current_amount
            FROM restock_request_items ri
            JOIN inventory_items i ON ri.item_id = i.id
            WHERE ri.restock_id = %s
        """, (restock_id,))
        
        restock_items = cursor.fetchall()
        restock_item_dict = {item['item_id']: item for item in restock_items}
        
        # Update each item
        for item_data in data['items']:
            # Validate item data
            if 'id' not in item_data:
                return jsonify({
                    'success': False,
                    'error': 'Each item must have an id'
                }), 400
                
            if 'received_amount' not in item_data:
                return jsonify({
                    'success': False,
                    'error': 'Each item must have a received_amount'
                }), 400
            
            item_id = item_data['id']
            received_amount = float(item_data['received_amount'])
            item_notes = item_data.get('notes', '')
            item_status = item_data.get('status', 'completed')
            
            # Validate item is in the restock request
            if item_id not in restock_item_dict:
                return jsonify({
                    'success': False,
                    'error': f'Item with ID {item_id} is not part of this restock request'
                }), 400
            
            # Update restock request item
            cursor.execute("""
                UPDATE restock_request_items
                SET received_amount = %s, notes = %s, status = %s
                WHERE restock_id = %s AND item_id = %s
            """, (received_amount, item_notes, item_status, restock_id, item_id))
            
            # Update inventory amount
            if received_amount > 0:
                # Get current amount
                current_amount = restock_item_dict[item_id]['current_amount'] or 0
                new_amount = current_amount + received_amount
                
                # Update inventory item
                cursor.execute("""
                    UPDATE inventory_items
                    SET amount = %s, last_updated = %s
                    WHERE id = %s
                """, (new_amount, datetime.now(), item_id))
                
                # Add history entry
                cursor.execute("""
                    INSERT INTO inventory_history
                    (item_id, previous_amount, new_amount, change_reason, notes, created_by, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    item_id, current_amount, new_amount, 
                    'restock', f'Restock request #{restock_id}', 
                    user_id, datetime.now()
                ))
        
        # Update restock request status
        cursor.execute("""
            UPDATE restock_requests
            SET status = 'completed', notes = %s, completed_at = %s, completed_by = %s
            WHERE id = %s
        """, (notes, datetime.now(), user_id, restock_id))
        
        db.commit()
        
        # Get updated restock request
        cursor.execute("""
            SELECT r.*, u1.username as created_by_name, u2.username as completed_by_name
            FROM restock_requests r
            LEFT JOIN users u1 ON r.created_by = u1.id
            LEFT JOIN users u2 ON r.completed_by = u2.id
            WHERE r.id = %s
        """, (restock_id,))
        
        updated_restock = cursor.fetchone()
        
        # Get updated items
        cursor.execute("""
            SELECT ri.*, i.name as item_name, i.category, i.unit, i.amount as current_amount
            FROM restock_request_items ri
            JOIN inventory_items i ON ri.item_id = i.id
            WHERE ri.restock_id = %s
        """, (restock_id,))
        
        updated_items = cursor.fetchall()
        
        # Format dates
        result = dict(updated_restock)
        result['created_at_formatted'] = result['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        if result['completed_at']:
            result['completed_at_formatted'] = result['completed_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        result['items'] = updated_items
        
        return jsonify({
            'success': True,
            'message': 'Restock request completed successfully',
            'restock_request': result
        })
    except Exception as e:
        logger.error(f"Error completing restock request {restock_id}: {str(e)}")
        if 'db' in locals() and db:
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500