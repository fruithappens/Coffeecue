#!/usr/bin/env python
"""
Create inventory-related tables in the PostgreSQL database for the Coffee Cue system.
"""
import psycopg2
import os
import sys
import argparse
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("inventory_migration")

def create_inventory_tables(db_url):
    """Create inventory-related tables"""
    try:
        # Connect to the database
        conn = psycopg2.connect(db_url)
        conn.autocommit = False
        cursor = conn.cursor()
        
        logger.info("Creating inventory tables...")
        
        # Inventory items table
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
            last_updated TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER
        )
        ''')
        
        # Inventory history table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS inventory_history (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
            previous_amount DECIMAL(10,2) NOT NULL,
            new_amount DECIMAL(10,2) NOT NULL,
            change_reason VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by INTEGER
        )
        ''')
        
        # Inventory alerts table
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
        
        # Restock requests table
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
        
        # Restock request items table
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
        
        # Create indexes
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_history_item_id ON inventory_history(item_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_inventory_alerts_item_id ON inventory_alerts(item_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_restock_request_items_restock_id ON restock_request_items(restock_id)')
        
        # Insert default inventory items if none exist
        cursor.execute('SELECT COUNT(*) FROM inventory_items')
        if cursor.fetchone()[0] == 0:
            logger.info("Inserting default inventory items...")
            
            # Insert milk items
            milk_items = [
                ('Full Cream', 'milk', 4.0, 'L', 5.0),
                ('Skim', 'milk', 3.5, 'L', 5.0),
                ('Soy', 'milk', 2.0, 'L', 5.0),
                ('Almond', 'milk', 2.5, 'L', 5.0),
                ('Oat', 'milk', 3.0, 'L', 5.0)
            ]
            
            for name, category, amount, unit, capacity in milk_items:
                cursor.execute('''
                    INSERT INTO inventory_items 
                    (name, category, amount, unit, capacity, last_updated, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (name, category, amount, unit, capacity, datetime.now(), datetime.now()))
            
            # Insert coffee items
            coffee_items = [
                ('House Blend', 'coffee', 1.2, 'kg', 2.0),
                ('Single Origin', 'coffee', 0.8, 'kg', 2.0)
            ]
            
            for name, category, amount, unit, capacity in coffee_items:
                cursor.execute('''
                    INSERT INTO inventory_items 
                    (name, category, amount, unit, capacity, last_updated, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (name, category, amount, unit, capacity, datetime.now(), datetime.now()))
            
            # Insert cup items
            cup_items = [
                ('Small', 'cups', 45, '', 50),
                ('Regular', 'cups', 80, '', 100),
                ('Large', 'cups', 30, '', 50)
            ]
            
            for name, category, amount, unit, capacity in cup_items:
                cursor.execute('''
                    INSERT INTO inventory_items 
                    (name, category, amount, unit, capacity, last_updated, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (name, category, amount, unit, capacity, datetime.now(), datetime.now()))
        
        conn.commit()
        logger.info("Inventory tables created successfully")
        
        return True
    
    except Exception as e:
        logger.error(f"Error creating inventory tables: {str(e)}")
        if conn:
            conn.rollback()
        return False
    
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def main():
    parser = argparse.ArgumentParser(description='Create inventory tables for the Coffee Cue system')
    parser.add_argument('--db-url', help='Database URL', 
                        default=os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/expresso'))
    
    args = parser.parse_args()
    
    if create_inventory_tables(args.db_url):
        print("✅ Inventory tables created successfully!")
    else:
        print("❌ Failed to create inventory tables")
        sys.exit(1)

if __name__ == '__main__':
    main()