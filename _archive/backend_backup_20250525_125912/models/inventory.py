"""
Inventory management models for Expresso Coffee Ordering System
Compatible with PostgreSQL database
"""
import json
import logging
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("expresso.models.inventory")

class InventoryItem:
    """Model for inventory items and stock management"""
    
    CATEGORIES = ["milk", "coffee", "cups", "syrups", "other"]
    
    @classmethod
    def create_tables(cls, db):
        """Create necessary inventory tables if they don't exist"""
        try:
            cursor = db.cursor()
            
            # First check if the inventory_items table already exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'inventory_items'
                )
            """)
            table_exists = cursor.fetchone()[0]
            
            if not table_exists:
                # Create inventory_items table
                cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_items (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    amount DECIMAL(10,2) DEFAULT 0,
                    unit VARCHAR(20) NOT NULL,
                    capacity DECIMAL(10,2) NOT NULL,
                    minimum_threshold DECIMAL(10,2),
                    notes TEXT,
                    station_id INTEGER,
                    last_updated TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER
                )
                ''')
            else:
                # Check if station_id column exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'inventory_items' AND column_name = 'station_id'
                    )
                """)
                column_exists = cursor.fetchone()[0]
                
                # Add the station_id column if it doesn't exist
                if not column_exists:
                    cursor.execute('''
                    ALTER TABLE inventory_items 
                    ADD COLUMN station_id INTEGER
                    ''')
                    logger.info("Added station_id column to inventory_items table")
            
            # Check if the inventory_history table already exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'inventory_history'
                )
            """)
            history_table_exists = cursor.fetchone()[0]
            
            if not history_table_exists:
                # Create inventory_history table
                cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_history (
                    id SERIAL PRIMARY KEY,
                    item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
                    previous_amount DECIMAL(10,2) NOT NULL,
                    new_amount DECIMAL(10,2) NOT NULL,
                    change_reason VARCHAR(100),
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by INTEGER
                )
                ''')
            
            # Check if inventory_alerts table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'inventory_alerts'
                )
            """)
            alerts_table_exists = cursor.fetchone()[0]
            
            if not alerts_table_exists:
                # Create inventory_alerts table
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
                logger.info("Created inventory_alerts table")
            
            # Check if restock_requests table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'restock_requests'
                )
            """)
            restock_table_exists = cursor.fetchone()[0]
            
            if not restock_table_exists:
                # Create restock_requests table
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
            
            # Check if restock_request_items table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'restock_request_items'
                )
            """)
            restock_items_table_exists = cursor.fetchone()[0]
            
            if not restock_items_table_exists:
                # Create restock_request_items table
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
                logger.info("Created restock_request_items table")
            
            # Create indexes for performance (these are safe to run multiple times)
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category);')
            
            # Only create station_id index if the column exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.columns 
                    WHERE table_name = 'inventory_items' AND column_name = 'station_id'
                )
            """)
            if cursor.fetchone()[0]:
                cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_items_station ON inventory_items(station_id);')
            
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_history_item ON inventory_history(item_id);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_alerts_item_id ON inventory_alerts(item_id);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_restock_request_items_restock_id ON restock_request_items(restock_id);')
            
            db.commit()
            logger.info("Inventory tables created successfully")
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating inventory tables: {str(e)}")
            # Log the error but don't re-raise to let the app continue
    
    @classmethod
    def get_all(cls, db, category=None, station_id=None):
        """
        Get all inventory items, optionally filtered by category and station
        
        Args:
            db: Database connection
            category: Optional category filter
            station_id: Optional station filter
            
        Returns:
            List of inventory items
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            
            query = "SELECT * FROM inventory_items"
            params = []
            
            # Add filters if provided
            filters = []
            if category:
                filters.append("category = %s")
                params.append(category)
            
            if station_id:
                filters.append("(station_id = %s OR station_id IS NULL)")
                params.append(station_id)
            
            if filters:
                query += " WHERE " + " AND ".join(filters)
            
            query += " ORDER BY category, name"
            
            cursor.execute(query, params)
            items = cursor.fetchall()
            
            # Add status field based on amount vs capacity & threshold
            for item in items:
                item['status'] = cls._calculate_status(item)
            
            return items
        except Exception as e:
            logger.error(f"Error getting inventory items: {str(e)}")
            return []
    
    @classmethod
    def get_by_id(cls, db, item_id):
        """
        Get inventory item by ID
        
        Args:
            db: Database connection
            item_id: Item ID
            
        Returns:
            Inventory item or None if not found
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
            item = cursor.fetchone()
            
            if item:
                item['status'] = cls._calculate_status(item)
            
            return item
        except Exception as e:
            logger.error(f"Error getting inventory item {item_id}: {str(e)}")
            return None
    
    @classmethod
    def create(cls, db, item_data, created_by=None):
        """
        Create a new inventory item
        
        Args:
            db: Database connection
            item_data: Dictionary with item details (name, category, etc.)
            created_by: User ID who created the item
            
        Returns:
            ID of the new item if successful, None otherwise
        """
        try:
            cursor = db.cursor()
            
            # Required fields
            required_fields = ['name', 'category', 'unit', 'capacity']
            for field in required_fields:
                if field not in item_data:
                    logger.error(f"Missing required field: {field}")
                    return None
            
            # Validate category
            if item_data['category'] not in cls.CATEGORIES:
                logger.warning(f"Invalid category: {item_data['category']}. Using 'other' instead.")
                item_data['category'] = 'other'
            
            # Set defaults for optional fields
            if 'amount' not in item_data:
                item_data['amount'] = 0
            
            if 'minimum_threshold' not in item_data:
                # Default to 20% of capacity
                item_data['minimum_threshold'] = float(item_data['capacity']) * 0.2
            
            # Generate column names and values
            columns = []
            values = []
            placeholders = []
            
            for key, value in item_data.items():
                columns.append(key)
                values.append(value)
                placeholders.append('%s')
            
            # Add created_by and last_updated
            columns.append('created_by')
            values.append(created_by)
            placeholders.append('%s')
            
            columns.append('last_updated')
            values.append(datetime.now())
            placeholders.append('%s')
            
            # Create SQL query
            query = f'''
                INSERT INTO inventory_items ({', '.join(columns)})
                VALUES ({', '.join(placeholders)})
                RETURNING id
            '''
            
            # Execute query
            cursor.execute(query, values)
            item_id = cursor.fetchone()[0]
            db.commit()
            
            logger.info(f"Created inventory item {item_id}: {item_data['name']}")
            return item_id
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating inventory item: {str(e)}")
            return None
    
    @classmethod
    def update(cls, db, item_id, update_data, updated_by=None):
        """
        Update an inventory item
        
        Args:
            db: Database connection
            item_id: Item ID to update
            update_data: Dictionary with fields to update
            updated_by: User ID who updated the item
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # First get current item to track history
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT * FROM inventory_items WHERE id = %s", (item_id,))
            current_item = cursor.fetchone()
            
            if not current_item:
                logger.error(f"Item not found for update: {item_id}")
                return False
            
            # Keep track of previous amount if updating it
            if 'amount' in update_data and update_data['amount'] != current_item['amount']:
                previous_amount = current_item['amount']
                new_amount = update_data['amount']
                
                # Record in history table
                change_reason = update_data.pop('change_reason', 'manual_update')
                notes = update_data.pop('notes', None)
                
                cursor.execute('''
                    INSERT INTO inventory_history 
                    (item_id, previous_amount, new_amount, change_reason, notes, created_by, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (
                    item_id, previous_amount, new_amount, 
                    change_reason, notes, updated_by, datetime.now()
                ))
            
            # Generate SET clause
            set_clauses = []
            values = []
            
            for key, value in update_data.items():
                set_clauses.append(f"{key} = %s")
                values.append(value)
            
            # Always update last_updated
            set_clauses.append("last_updated = %s")
            values.append(datetime.now())
            
            # Add item_id for WHERE
            values.append(item_id)
            
            # Create update query
            query = f'''
                UPDATE inventory_items 
                SET {', '.join(set_clauses)}
                WHERE id = %s
            '''
            
            # Execute query
            cursor.execute(query, values)
            db.commit()
            
            logger.info(f"Updated inventory item {item_id}")
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating inventory item {item_id}: {str(e)}")
            return False
    
    @classmethod
    def delete(cls, db, item_id):
        """
        Delete an inventory item
        
        Args:
            db: Database connection
            item_id: Item ID to delete
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute("DELETE FROM inventory_items WHERE id = %s", (item_id,))
            
            if cursor.rowcount > 0:
                db.commit()
                logger.info(f"Deleted inventory item {item_id}")
                return True
            else:
                logger.warning(f"No item found to delete with id {item_id}")
                return False
        except Exception as e:
            db.rollback()
            logger.error(f"Error deleting inventory item {item_id}: {str(e)}")
            return False
    
    @classmethod
    def get_low_stock_items(cls, db, station_id=None):
        """
        Get items with stock below the minimum threshold
        
        Args:
            db: Database connection
            station_id: Optional station filter
            
        Returns:
            List of low stock items
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            
            query = '''
                SELECT * FROM inventory_items 
                WHERE amount < minimum_threshold
            '''
            
            params = []
            
            if station_id:
                query += " AND (station_id = %s OR station_id IS NULL)"
                params.append(station_id)
            
            cursor.execute(query, params)
            items = cursor.fetchall()
            
            # Add status field and percentage
            for item in items:
                item['status'] = 'danger'
                if item['capacity'] > 0:
                    item['percentage'] = (item['amount'] / item['capacity']) * 100
                else:
                    item['percentage'] = 0
            
            return items
        except Exception as e:
            logger.error(f"Error getting low stock items: {str(e)}")
            return []
    
    @classmethod
    def get_history(cls, db, item_id, limit=20):
        """
        Get history for an inventory item
        
        Args:
            db: Database connection
            item_id: Item ID
            limit: Maximum number of history entries to return
            
        Returns:
            List of history entries
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            
            cursor.execute('''
                SELECT h.*, u.username as username
                FROM inventory_history h
                LEFT JOIN users u ON h.created_by = u.id
                WHERE h.item_id = %s
                ORDER BY h.created_at DESC
                LIMIT %s
            ''', (item_id, limit))
            
            return cursor.fetchall()
        except Exception as e:
            logger.error(f"Error getting history for item {item_id}: {str(e)}")
            return []
    
    @classmethod
    def adjust_stock(cls, db, item_id, new_amount, change_reason, notes=None, created_by=None):
        """
        Adjust stock amount with history tracking
        
        Args:
            db: Database connection
            item_id: Item ID
            new_amount: New stock amount
            change_reason: Reason for change
            notes: Optional notes
            created_by: User ID who made the change
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Get current amount
            cursor = db.cursor()
            cursor.execute("SELECT amount FROM inventory_items WHERE id = %s", (item_id,))
            result = cursor.fetchone()
            
            if not result:
                logger.error(f"Item not found: {item_id}")
                return False
            
            previous_amount = result[0]
            
            # Update inventory item
            cursor.execute('''
                UPDATE inventory_items
                SET amount = %s, last_updated = %s
                WHERE id = %s
            ''', (new_amount, datetime.now(), item_id))
            
            # Add history entry
            cursor.execute('''
                INSERT INTO inventory_history
                (item_id, previous_amount, new_amount, change_reason, notes, created_by, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (
                item_id, previous_amount, new_amount, 
                change_reason, notes, created_by, datetime.now()
            ))
            
            db.commit()
            
            logger.info(f"Adjusted stock for item {item_id} from {previous_amount} to {new_amount}")
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"Error adjusting stock for item {item_id}: {str(e)}")
            return False
    
    @classmethod
    def _calculate_status(cls, item):
        """
        Calculate status based on amount vs capacity and threshold
        
        Args:
            item: Inventory item dictionary
            
        Returns:
            Status string: 'danger', 'warning', or 'good'
        """
        # Default to good
        if not item:
            return 'good'
            
        amount = float(item['amount']) if item['amount'] is not None else 0
        capacity = float(item['capacity']) if item['capacity'] is not None else 0
        threshold = float(item['minimum_threshold']) if item['minimum_threshold'] is not None else 0
        
        # Empty or very low
        if amount <= 0 or (capacity > 0 and amount / capacity <= 0.1):
            return 'danger'
        
        # Below threshold
        if threshold > 0 and amount < threshold:
            return 'warning'
        
        # Good status
        return 'good'