#!/usr/bin/env python3
"""
Database Migration System for Expresso Coffee System
Fixes architectural flaw: moves all data from localStorage to PostgreSQL database
Includes automatic backup functionality
"""

import json
import logging
import os
import sys
import time
import threading
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from utils.database import get_db_connection, close_connection, execute_query

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DatabaseMigrationSystem:
    """Comprehensive system to migrate localStorage data to database and maintain backups"""
    
    def __init__(self):
        self.db = None
        self.backup_thread = None
        self.backup_running = False
        self.backup_interval = 300  # 5 minutes in seconds
        
    def connect(self):
        """Connect to database"""
        try:
            self.db = get_db_connection()
            logger.info("Connected to database successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            return False
            
    def disconnect(self):
        """Disconnect from database"""
        if self.db:
            close_connection(self.db)
            self.db = None
            
    def create_comprehensive_schema(self):
        """Create all necessary tables for data persistence"""
        logger.info("Creating comprehensive database schema...")
        
        try:
            # Event inventory table (replaces localStorage event_inventory)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS event_inventory (
                    id SERIAL PRIMARY KEY,
                    category VARCHAR(100) NOT NULL,
                    item_name VARCHAR(200) NOT NULL,
                    enabled BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_by VARCHAR(100),
                    UNIQUE(category, item_name)
                )
            """)
            
            # Event stock levels table (replaces localStorage event_stock_levels)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS event_stock_levels (
                    id SERIAL PRIMARY KEY,
                    item_name VARCHAR(200) NOT NULL UNIQUE,
                    category VARCHAR(100) NOT NULL,
                    total_quantity DECIMAL(10,2) DEFAULT 0,
                    allocated_quantity DECIMAL(10,2) DEFAULT 0,
                    available_quantity DECIMAL(10,2) DEFAULT 0,
                    unit VARCHAR(50) DEFAULT 'units',
                    low_stock_threshold DECIMAL(10,2) DEFAULT 10,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Station inventory configurations (replaces localStorage station_inventory_configs)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS station_inventory_configs (
                    id SERIAL PRIMARY KEY,
                    station_id INTEGER NOT NULL,
                    station_name VARCHAR(200),
                    config_data JSONB NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(station_id)
                )
            """)
            
            # Station inventory quantities (replaces localStorage station_inventory_quantities)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS station_inventory_quantities (
                    id SERIAL PRIMARY KEY,
                    station_id INTEGER NOT NULL,
                    item_name VARCHAR(200) NOT NULL,
                    quantity DECIMAL(10,2) DEFAULT 0,
                    allocated_from_stock DECIMAL(10,2) DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(station_id, item_name)
                )
            """)
            
            # System settings table (replaces various localStorage settings)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS system_settings (
                    id SERIAL PRIMARY KEY,
                    setting_key VARCHAR(200) NOT NULL UNIQUE,
                    setting_value JSONB NOT NULL,
                    setting_type VARCHAR(50) DEFAULT 'general',
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_by VARCHAR(100)
                )
            """)
            
            # User preferences table (replaces localStorage user preferences)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS user_preferences (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER,
                    username VARCHAR(100),
                    preferences JSONB NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id)
                )
            """)
            
            # App state table (replaces localStorage app state)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS app_state (
                    id SERIAL PRIMARY KEY,
                    state_key VARCHAR(200) NOT NULL UNIQUE,
                    state_value JSONB NOT NULL,
                    expires_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Data backups table
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS data_backups (
                    id SERIAL PRIMARY KEY,
                    backup_type VARCHAR(50) NOT NULL,
                    backup_data JSONB NOT NULL,
                    file_size_bytes INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    backup_status VARCHAR(20) DEFAULT 'completed',
                    notes TEXT
                )
            """)
            
            # Stations table (enhanced)
            execute_query(self.db, """
                CREATE TABLE IF NOT EXISTS stations (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(200) NOT NULL,
                    location VARCHAR(200),
                    active BOOLEAN DEFAULT TRUE,
                    capabilities JSONB,
                    inventory_config JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create indexes for performance
            indexes = [
                "CREATE INDEX IF NOT EXISTS idx_event_stock_item ON event_stock_levels(item_name)",
                "CREATE INDEX IF NOT EXISTS idx_station_inventory_station ON station_inventory_quantities(station_id)",
                "CREATE INDEX IF NOT EXISTS idx_station_inventory_item ON station_inventory_quantities(item_name)",
                "CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key)",
                "CREATE INDEX IF NOT EXISTS idx_app_state_key ON app_state(state_key)",
                "CREATE INDEX IF NOT EXISTS idx_data_backups_type ON data_backups(backup_type)",
                "CREATE INDEX IF NOT EXISTS idx_data_backups_created ON data_backups(created_at)"
            ]
            
            for index_sql in indexes:
                execute_query(self.db, index_sql)
                
            logger.info("✅ Database schema created successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error creating database schema: {e}")
            return False
    
    def create_data_migration_api(self):
        """Create API endpoints for data migration"""
        migration_script = """
from flask import Blueprint, request, jsonify
import logging
from database_migration_system import DatabaseMigrationSystem

# Create migration API blueprint
migration_api = Blueprint('migration_api', __name__)
logger = logging.getLogger(__name__)

@migration_api.route('/api/migration/export-localStorage', methods=['POST'])
def export_localstorage():
    \"\"\"API endpoint to receive localStorage data from frontend\"\"\"
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400
            
        # Initialize migration system
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        # Process the localStorage data
        result = migration_system.import_localstorage_data(data)
        migration_system.disconnect()
        
        if result:
            return jsonify({'success': True, 'message': 'Data migrated successfully'})
        else:
            return jsonify({'success': False, 'error': 'Migration failed'}), 500
            
    except Exception as e:
        logger.error(f"Error in localStorage export: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@migration_api.route('/api/migration/get-inventory', methods=['GET'])
def get_inventory_data():
    \"\"\"Get inventory data from database\"\"\"
    try:
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        inventory_data = migration_system.get_inventory_data()
        migration_system.disconnect()
        
        return jsonify({'success': True, 'data': inventory_data})
        
    except Exception as e:
        logger.error(f"Error getting inventory data: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@migration_api.route('/api/migration/backup-status', methods=['GET'])
def get_backup_status():
    \"\"\"Get backup system status\"\"\"
    try:
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        status = migration_system.get_backup_status()
        migration_system.disconnect()
        
        return jsonify({'success': True, 'data': status})
        
    except Exception as e:
        logger.error(f"Error getting backup status: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
"""
        
        # Write the migration API to a file
        with open('/Users/stevewf/expresso/routes/migration_api_routes.py', 'w') as f:
            f.write(migration_script)
            
        logger.info("✅ Migration API created")
    
    def import_localstorage_data(self, localStorage_data: Dict[str, Any]) -> bool:
        """Import data from localStorage export into database"""
        logger.info("Starting localStorage data import...")
        
        try:
            # Process event inventory
            if 'event_inventory' in localStorage_data:
                self._import_event_inventory(localStorage_data['event_inventory'])
                
            # Process event stock levels
            if 'event_stock_levels' in localStorage_data:
                self._import_event_stock_levels(localStorage_data['event_stock_levels'])
                
            # Process station inventory configs
            if 'station_inventory_configs' in localStorage_data:
                self._import_station_inventory_configs(localStorage_data['station_inventory_configs'])
                
            # Process station inventory quantities
            if 'station_inventory_quantities' in localStorage_data:
                self._import_station_inventory_quantities(localStorage_data['station_inventory_quantities'])
                
            # Process settings
            settings_keys = [
                'branding_settings', 'sms_settings', 'system_settings', 
                'coffee_system_token', 'coffee_connection_status'
            ]
            for key in settings_keys:
                if key in localStorage_data:
                    self._import_setting(key, localStorage_data[key])
                    
            logger.info("✅ localStorage data imported successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error importing localStorage data: {e}")
            return False
    
    def _import_event_inventory(self, inventory_data):
        """Import event inventory data"""
        if not inventory_data:
            return
            
        logger.info("Importing event inventory...")
        for category, items in inventory_data.items():
            for item_name, item_config in items.items():
                execute_query(self.db, """
                    INSERT INTO event_inventory (category, item_name, enabled, created_by)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (category, item_name) 
                    DO UPDATE SET 
                        enabled = EXCLUDED.enabled,
                        updated_at = CURRENT_TIMESTAMP
                """, (category, item_name, item_config.get('enabled', True), 'migration'))
    
    def _import_event_stock_levels(self, stock_data):
        """Import event stock levels data"""
        if not stock_data:
            return
            
        logger.info("Importing event stock levels...")
        for item_name, stock_info in stock_data.items():
            execute_query(self.db, """
                INSERT INTO event_stock_levels 
                (item_name, category, total_quantity, allocated_quantity, available_quantity, unit)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (item_name)
                DO UPDATE SET
                    total_quantity = EXCLUDED.total_quantity,
                    allocated_quantity = EXCLUDED.allocated_quantity,
                    available_quantity = EXCLUDED.available_quantity,
                    updated_at = CURRENT_TIMESTAMP
            """, (
                item_name,
                stock_info.get('category', 'unknown'),
                stock_info.get('total', 0),
                stock_info.get('allocated', 0),
                stock_info.get('available', 0),
                stock_info.get('unit', 'units')
            ))
    
    def _import_station_inventory_configs(self, config_data):
        """Import station inventory configurations"""
        if not config_data:
            return
            
        logger.info("Importing station inventory configs...")
        for station_id, config in config_data.items():
            execute_query(self.db, """
                INSERT INTO station_inventory_configs (station_id, station_name, config_data)
                VALUES (%s, %s, %s)
                ON CONFLICT (station_id)
                DO UPDATE SET
                    config_data = EXCLUDED.config_data,
                    updated_at = CURRENT_TIMESTAMP
            """, (int(station_id), config.get('name', f'Station {station_id}'), json.dumps(config)))
    
    def _import_station_inventory_quantities(self, quantity_data):
        """Import station inventory quantities"""
        if not quantity_data:
            return
            
        logger.info("Importing station inventory quantities...")
        for station_id, quantities in quantity_data.items():
            for item_name, quantity in quantities.items():
                execute_query(self.db, """
                    INSERT INTO station_inventory_quantities 
                    (station_id, item_name, quantity, allocated_from_stock)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (station_id, item_name)
                    DO UPDATE SET
                        quantity = EXCLUDED.quantity,
                        allocated_from_stock = EXCLUDED.allocated_from_stock,
                        updated_at = CURRENT_TIMESTAMP
                """, (int(station_id), item_name, quantity, 0))
    
    def _import_setting(self, key: str, value: Any):
        """Import a setting into the database"""
        execute_query(self.db, """
            INSERT INTO system_settings (setting_key, setting_value, setting_type, updated_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (setting_key)
            DO UPDATE SET
                setting_value = EXCLUDED.setting_value,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = EXCLUDED.updated_by
        """, (key, json.dumps(value), 'system', 'migration'))
    
    def get_inventory_data(self) -> Dict[str, Any]:
        """Get all inventory data from database"""
        try:
            result = {}
            
            # Get event inventory
            event_inventory = execute_query(self.db, 
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
            stock_levels = execute_query(self.db,
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
            station_configs = execute_query(self.db,
                "SELECT * FROM station_inventory_configs ORDER BY station_id",
                fetch_all=True)
            if station_configs:
                result['station_inventory_configs'] = {}
                for config in station_configs:
                    result['station_inventory_configs'][str(config['station_id'])] = config['config_data']
            
            # Get station quantities
            station_quantities = execute_query(self.db,
                "SELECT * FROM station_inventory_quantities ORDER BY station_id, item_name",
                fetch_all=True)
            if station_quantities:
                result['station_inventory_quantities'] = {}
                for qty in station_quantities:
                    station_id = str(qty['station_id'])
                    if station_id not in result['station_inventory_quantities']:
                        result['station_inventory_quantities'][station_id] = {}
                    result['station_inventory_quantities'][station_id][qty['item_name']] = float(qty['quantity'])
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting inventory data: {e}")
            return {}
    
    def start_automatic_backup(self):
        """Start automatic backup system"""
        if self.backup_running:
            logger.info("Backup system already running")
            return
            
        self.backup_running = True
        self.backup_thread = threading.Thread(target=self._backup_loop, daemon=True)
        self.backup_thread.start()
        logger.info("✅ Automatic backup system started")
    
    def stop_automatic_backup(self):
        """Stop automatic backup system"""
        self.backup_running = False
        if self.backup_thread:
            self.backup_thread.join(timeout=10)
        logger.info("Automatic backup system stopped")
    
    def _backup_loop(self):
        """Main backup loop"""
        while self.backup_running:
            try:
                self.create_backup()
                time.sleep(self.backup_interval)
            except Exception as e:
                logger.error(f"Error in backup loop: {e}")
                time.sleep(60)  # Wait 1 minute on error
    
    def create_backup(self):
        """Create a complete data backup"""
        try:
            logger.info("Creating data backup...")
            
            # Get all inventory data
            inventory_data = self.get_inventory_data()
            
            # Get all settings
            settings = execute_query(self.db,
                "SELECT setting_key, setting_value FROM system_settings",
                fetch_all=True)
            settings_data = {s['setting_key']: s['setting_value'] for s in settings} if settings else {}
            
            # Get all stations
            stations = execute_query(self.db,
                "SELECT * FROM stations ORDER BY id",
                fetch_all=True)
            stations_data = [dict(station) for station in stations] if stations else []
            
            # Get recent orders (last 7 days)
            orders = execute_query(self.db,
                "SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC",
                fetch_all=True)
            orders_data = [dict(order) for order in orders] if orders else []
            
            backup_data = {
                'timestamp': datetime.now().isoformat(),
                'inventory': inventory_data,
                'settings': settings_data,
                'stations': stations_data,
                'recent_orders': orders_data,
                'backup_version': '1.0'
            }
            
            # Calculate size
            backup_json = json.dumps(backup_data)
            file_size = len(backup_json.encode('utf-8'))
            
            # Store backup in database
            execute_query(self.db, """
                INSERT INTO data_backups (backup_type, backup_data, file_size_bytes, notes)
                VALUES (%s, %s, %s, %s)
            """, ('automatic', json.dumps(backup_data), file_size, f'Backup created at {datetime.now()}'))
            
            # Clean old backups (keep last 20)
            execute_query(self.db, """
                DELETE FROM data_backups 
                WHERE backup_type = 'automatic' 
                AND id NOT IN (
                    SELECT id FROM data_backups 
                    WHERE backup_type = 'automatic' 
                    ORDER BY created_at DESC 
                    LIMIT 20
                )
            """)
            
            logger.info(f"✅ Backup created successfully ({file_size} bytes)")
            
        except Exception as e:
            logger.error(f"❌ Error creating backup: {e}")
    
    def get_backup_status(self) -> Dict[str, Any]:
        """Get backup system status"""
        try:
            # Get latest backup
            latest_backup = execute_query(self.db,
                "SELECT * FROM data_backups ORDER BY created_at DESC LIMIT 1",
                fetch_one=True)
            
            # Get backup count
            backup_count = execute_query(self.db,
                "SELECT COUNT(*) as count FROM data_backups",
                fetch_one=True)
            
            # Get total backup size
            total_size = execute_query(self.db,
                "SELECT SUM(file_size_bytes) as total_size FROM data_backups",
                fetch_one=True)
            
            return {
                'backup_running': self.backup_running,
                'backup_interval_minutes': self.backup_interval // 60,
                'latest_backup': dict(latest_backup) if latest_backup else None,
                'total_backups': backup_count['count'] if backup_count else 0,
                'total_size_bytes': total_size['total_size'] if total_size and total_size['total_size'] else 0
            }
            
        except Exception as e:
            logger.error(f"Error getting backup status: {e}")
            return {'error': str(e)}
    
    def restore_from_backup(self, backup_id: int):
        """Restore data from a specific backup"""
        try:
            logger.info(f"Restoring from backup {backup_id}...")
            
            # Get backup data
            backup = execute_query(self.db,
                "SELECT backup_data FROM data_backups WHERE id = %s",
                (backup_id,), fetch_one=True)
            
            if not backup:
                logger.error(f"Backup {backup_id} not found")
                return False
            
            backup_data = backup['backup_data']
            
            # Clear existing data (careful!)
            tables_to_clear = [
                'event_inventory', 'event_stock_levels', 
                'station_inventory_configs', 'station_inventory_quantities'
            ]
            
            for table in tables_to_clear:
                execute_query(self.db, f"DELETE FROM {table}")
            
            # Restore inventory data
            if 'inventory' in backup_data:
                self.import_localstorage_data(backup_data['inventory'])
            
            # Restore settings
            if 'settings' in backup_data:
                for key, value in backup_data['settings'].items():
                    self._import_setting(key, value)
            
            logger.info(f"✅ Successfully restored from backup {backup_id}")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error restoring from backup {backup_id}: {e}")
            return False

def main():
    """Main function to run the migration system"""
    logger.info("🚀 Starting Database Migration System...")
    
    migration_system = DatabaseMigrationSystem()
    
    # Connect to database
    if not migration_system.connect():
        logger.error("❌ Failed to connect to database")
        sys.exit(1)
    
    # Create schema
    if not migration_system.create_comprehensive_schema():
        logger.error("❌ Failed to create database schema")
        sys.exit(1)
    
    # Create migration API
    migration_system.create_data_migration_api()
    
    # Start automatic backup system
    migration_system.start_automatic_backup()
    
    logger.info("✅ Database Migration System initialized successfully!")
    logger.info("📊 System Status:")
    logger.info("   - Database schema: Created")
    logger.info("   - Migration API: Available at /api/migration/*")
    logger.info("   - Automatic backups: Running every 5 minutes")
    logger.info("   - Next steps: Use frontend migration tool to export localStorage data")
    
    # Keep the backup system running
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        migration_system.stop_automatic_backup()
        migration_system.disconnect()

if __name__ == "__main__":
    main()