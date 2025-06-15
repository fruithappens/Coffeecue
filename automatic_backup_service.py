#!/usr/bin/env python3
"""
Automatic Backup Service for Expresso Coffee System
Runs every 5 minutes to create data backups and prevent data loss
"""

import json
import logging
import os
import sys
import time
import threading
import signal
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
import psycopg2
from psycopg2.extras import RealDictCursor
from utils.database import get_db_connection, close_connection, execute_query

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("backup_service.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger('BackupService')

class AutomaticBackupService:
    """Automatic backup service that runs in the background"""
    
    def __init__(self, backup_interval_minutes=5):
        self.backup_interval = backup_interval_minutes * 60  # Convert to seconds
        self.running = False
        self.backup_thread = None
        self.stats = {
            'backups_created': 0,
            'last_backup_time': None,
            'last_backup_size': 0,
            'total_backup_size': 0,
            'errors': 0,
            'started_at': None
        }
        
    def start(self):
        """Start the backup service"""
        if self.running:
            logger.info("Backup service is already running")
            return
            
        self.running = True
        self.stats['started_at'] = datetime.now()
        self.backup_thread = threading.Thread(target=self._backup_loop, daemon=True)
        self.backup_thread.start()
        
        logger.info(f"🔄 Automatic Backup Service started (interval: {self.backup_interval//60} minutes)")
        
    def stop(self):
        """Stop the backup service"""
        self.running = False
        if self.backup_thread:
            self.backup_thread.join(timeout=10)
        logger.info("Automatic Backup Service stopped")
        
    def _backup_loop(self):
        """Main backup loop"""
        logger.info("Backup loop started")
        
        while self.running:
            try:
                # Create backup
                success = self.create_backup()
                
                if success:
                    self.stats['backups_created'] += 1
                    logger.info(f"✅ Backup #{self.stats['backups_created']} completed successfully")
                else:
                    self.stats['errors'] += 1
                    logger.error(f"❌ Backup failed (total errors: {self.stats['errors']})")
                
                # Wait for next backup interval
                time.sleep(self.backup_interval)
                
            except Exception as e:
                self.stats['errors'] += 1
                logger.error(f"❌ Error in backup loop: {e}")
                time.sleep(60)  # Wait 1 minute on error before retrying
                
    def create_backup(self):
        """Create a complete data backup"""
        try:
            logger.info("Creating automatic backup...")
            
            # Connect to database
            db = get_db_connection()
            if not db:
                logger.error("Failed to connect to database")
                return False
            
            try:
                # Ensure backup tables exist
                self._ensure_backup_tables(db)
                
                # Get all inventory data
                inventory_data = self._get_inventory_data(db)
                
                # Get all settings
                settings_data = self._get_settings_data(db)
                
                # Get all stations
                stations_data = self._get_stations_data(db)
                
                # Get recent orders (last 7 days)
                orders_data = self._get_recent_orders(db)
                
                # Create backup data structure
                backup_data = {
                    'timestamp': datetime.now().isoformat(),
                    'backup_type': 'automatic',
                    'inventory': inventory_data,
                    'settings': settings_data,
                    'stations': stations_data,
                    'recent_orders': orders_data,
                    'backup_version': '1.0',
                    'stats': {
                        'inventory_items': len(inventory_data.get('event_inventory', {})),
                        'stock_items': len(inventory_data.get('event_stock_levels', {})),
                        'station_configs': len(inventory_data.get('station_inventory_configs', {})),
                        'station_quantities': len(inventory_data.get('station_inventory_quantities', {})),
                        'settings_count': len(settings_data),
                        'stations_count': len(stations_data),
                        'recent_orders_count': len(orders_data)
                    }
                }
                
                # Calculate size
                backup_json = json.dumps(backup_data, default=str)
                file_size = len(backup_json.encode('utf-8'))
                
                # Store backup in database
                backup_id = execute_query(db, """
                    INSERT INTO data_backups (backup_type, backup_data, file_size_bytes, notes)
                    VALUES (%s, %s, %s, %s)
                    RETURNING id
                """, (
                    'automatic', 
                    json.dumps(backup_data, default=str), 
                    file_size, 
                    f'Automatic backup created at {datetime.now()}'
                ), fetch_one=True)
                
                if backup_id:
                    # Update stats
                    self.stats['last_backup_time'] = datetime.now()
                    self.stats['last_backup_size'] = file_size
                    self.stats['total_backup_size'] += file_size
                    
                    # Clean old backups (keep last 50 automatic backups)
                    self._clean_old_backups(db)
                    
                    logger.info(f"✅ Backup created successfully (ID: {backup_id['id']}, Size: {self._format_bytes(file_size)})")
                    return True
                else:
                    logger.error("Failed to create backup - no ID returned")
                    return False
                    
            finally:
                close_connection(db)
                
        except Exception as e:
            logger.error(f"❌ Error creating backup: {e}")
            return False
    
    def _ensure_backup_tables(self, db):
        """Ensure backup tables exist"""
        execute_query(db, """
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
        
        execute_query(db, """
            CREATE INDEX IF NOT EXISTS idx_data_backups_type ON data_backups(backup_type)
        """)
        
        execute_query(db, """
            CREATE INDEX IF NOT EXISTS idx_data_backups_created ON data_backups(created_at)
        """)
    
    def _get_inventory_data(self, db):
        """Get all inventory data"""
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
        
        return result
    
    def _get_settings_data(self, db):
        """Get all settings data"""
        settings = execute_query(db,
            "SELECT setting_key, setting_value FROM system_settings",
            fetch_all=True)
        return {s['setting_key']: s['setting_value'] for s in settings} if settings else {}
    
    def _get_stations_data(self, db):
        """Get all stations data"""
        stations = execute_query(db,
            "SELECT * FROM stations ORDER BY id",
            fetch_all=True)
        return [dict(station) for station in stations] if stations else []
    
    def _get_recent_orders(self, db):
        """Get recent orders (last 7 days)"""
        orders = execute_query(db,
            "SELECT * FROM orders WHERE created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 1000",
            fetch_all=True)
        return [dict(order) for order in orders] if orders else []
    
    def _clean_old_backups(self, db):
        """Clean old automatic backups (keep last 50)"""
        try:
            execute_query(db, """
                DELETE FROM data_backups 
                WHERE backup_type = 'automatic' 
                AND id NOT IN (
                    SELECT id FROM data_backups 
                    WHERE backup_type = 'automatic' 
                    ORDER BY created_at DESC 
                    LIMIT 50
                )
            """)
        except Exception as e:
            logger.warning(f"Failed to clean old backups: {e}")
    
    def _format_bytes(self, bytes_value):
        """Format bytes to human readable string"""
        if bytes_value == 0:
            return "0 B"
        
        units = ['B', 'KB', 'MB', 'GB']
        i = 0
        
        while bytes_value >= 1024 and i < len(units) - 1:
            bytes_value /= 1024
            i += 1
            
        return f"{bytes_value:.2f} {units[i]}"
    
    def get_status(self):
        """Get backup service status"""
        return {
            'running': self.running,
            'backup_interval_minutes': self.backup_interval // 60,
            'stats': {
                **self.stats,
                'started_at': self.stats['started_at'].isoformat() if self.stats['started_at'] else None,
                'last_backup_time': self.stats['last_backup_time'].isoformat() if self.stats['last_backup_time'] else None,
                'last_backup_size_formatted': self._format_bytes(self.stats['last_backup_size']),
                'total_backup_size_formatted': self._format_bytes(self.stats['total_backup_size']),
                'uptime_minutes': (datetime.now() - self.stats['started_at']).total_seconds() // 60 if self.stats['started_at'] else 0
            }
        }

# Global backup service instance
backup_service = None

def start_backup_service(interval_minutes=5):
    """Start the automatic backup service"""
    global backup_service
    
    if backup_service and backup_service.running:
        logger.info("Backup service is already running")
        return backup_service
    
    backup_service = AutomaticBackupService(interval_minutes)
    backup_service.start()
    return backup_service

def stop_backup_service():
    """Stop the automatic backup service"""
    global backup_service
    
    if backup_service:
        backup_service.stop()
        backup_service = None

def get_backup_service():
    """Get the backup service instance"""
    return backup_service

def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info(f"Received signal {signum}, shutting down...")
    stop_backup_service()
    sys.exit(0)

def main():
    """Main function to run the backup service as a standalone process"""
    logger.info("🚀 Starting Automatic Backup Service...")
    
    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start backup service
    backup_service = start_backup_service(5)  # 5 minute intervals
    
    logger.info("✅ Automatic Backup Service is running")
    logger.info("📊 Service Status:")
    logger.info("   - Backup interval: 5 minutes")
    logger.info("   - Backup retention: 50 backups")
    logger.info("   - Press CTRL+C to stop")
    
    try:
        # Keep the service running
        while backup_service.running:
            time.sleep(10)
            
            # Print status every 5 minutes
            if backup_service.stats['backups_created'] > 0:
                status = backup_service.get_status()
                logger.info(f"📊 Status: {status['stats']['backups_created']} backups created, "
                           f"last: {status['stats']['last_backup_size_formatted']}, "
                           f"total: {status['stats']['total_backup_size_formatted']}")
                
    except KeyboardInterrupt:
        logger.info("Shutdown requested by user")
    finally:
        stop_backup_service()
        logger.info("Automatic Backup Service stopped")

if __name__ == "__main__":
    main()