#!/usr/bin/env python
"""
Migration script to transfer data from SQLite to PostgreSQL
"""
import sqlite3
import argparse
import json
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import sys
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("migration.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("migration")

# Tables to migrate with foreign key relationships
MIGRATION_ORDER = [
    'users',
    'user_permissions',
    'settings',
    'station_stats',
    'station_schedule',
    'customer_preferences',
    'orders',
    'feedback',
    'payment_transactions',
    'loyalty_transactions',
    'conversation_states',
    'partial_orders',
    'menu_items',
    'chat_messages',
    'sms_status_logs'
]

def connect_sqlite(sqlite_path):
    """Connect to SQLite database"""
    if not os.path.exists(sqlite_path):
        logger.error(f"SQLite database not found: {sqlite_path}")
        sys.exit(1)
        
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    logger.info(f"Connected to SQLite database: {sqlite_path}")
    return conn

def connect_postgres(db_url):
    """Connect to PostgreSQL database"""
    try:
        # Parse connection parameters from URL
        # Format: postgresql://user:password@host:port/dbname
        if '://' in db_url:
            parts = db_url.split('://', 1)[1].split('@')
            credentials = parts[0].split(':')
            db_user = credentials[0]
            db_password = credentials[1] if len(credentials) > 1 else ''
            
            hostdb = parts[1].split('/')
            hostport = hostdb[0].split(':')
            host = hostport[0]
            port = int(hostport[1]) if len(hostport) > 1 else 5432
            
            dbname = hostdb[1]
        else:
            # If not a URL, assume it's just the database name
            db_user = 'postgres'
            db_password = ''
            host = 'localhost'
            port = 5432
            dbname = db_url
        
        conn = psycopg2.connect(
            user=db_user,
            password=db_password,
            host=host,
            port=port,
            dbname=dbname
        )
        
        logger.info(f"Connected to PostgreSQL database: {dbname} at {host}:{port}")
        return conn
    except Exception as e:
        logger.error(f"Error connecting to PostgreSQL: {str(e)}")
        sys.exit(1)

def create_postgres_tables(pg_conn):
    """Create necessary tables in PostgreSQL"""
    try:
        cursor = pg_conn.cursor()
        
        # Create users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) NOT NULL,
            full_name VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            reset_token TEXT,
            reset_token_expiry TIMESTAMP,
            station_id INTEGER,
            failed_login_attempts INTEGER DEFAULT 0,
            account_locked BOOLEAN DEFAULT FALSE,
            account_locked_until TIMESTAMP,
            last_password_change TIMESTAMP
        )
        """)
        
        # Create user_permissions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_permissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_name VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_name)
        )
        """)
        
        # Create settings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(50)
        )
        """)
        
        # Create station_stats table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS station_stats (
            station_id INTEGER PRIMARY KEY,
            current_load INTEGER DEFAULT 0,
            avg_completion_time INTEGER DEFAULT 180,
            total_orders INTEGER DEFAULT 0,
            status VARCHAR(20) DEFAULT 'active',
            barista_name VARCHAR(100),
            last_updated TIMESTAMP,
            specialist_drinks TEXT,
            equipment_status VARCHAR(20) DEFAULT 'operational'
        )
        """)
        
        # Create station_schedule table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS station_schedule (
            id SERIAL PRIMARY KEY,
            station_id INTEGER NOT NULL,
            day_of_week INTEGER NOT NULL,
            start_time VARCHAR(5) NOT NULL,
            end_time VARCHAR(5) NOT NULL,
            break_start VARCHAR(5),
            break_end VARCHAR(5),
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_by VARCHAR(50)
        )
        """)
        
        # Create customer_preferences table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS customer_preferences (
            phone VARCHAR(20) PRIMARY KEY,
            name VARCHAR(100),
            preferred_drink VARCHAR(50),
            preferred_milk VARCHAR(20),
            preferred_size VARCHAR(10),
            preferred_sugar VARCHAR(20),
            preferred_notes TEXT,
            last_station INTEGER,
            last_order_date TIMESTAMP,
            total_orders INTEGER DEFAULT 0,
            loyalty_points INTEGER DEFAULT 0,
            loyalty_free_drinks INTEGER DEFAULT 0,
            allergies TEXT,
            email VARCHAR(100),
            marketing_consent BOOLEAN DEFAULT FALSE,
            first_order_date TIMESTAMP,
            favorite_time_of_day VARCHAR(20),
            account_status VARCHAR(20) DEFAULT 'active'
        )
        """)
        
        # Create orders table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            order_number VARCHAR(20) UNIQUE NOT NULL,
            phone VARCHAR(20) NOT NULL,
            order_details JSONB NOT NULL,
            status VARCHAR(20) NOT NULL,
            station_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            rating INTEGER,
            queue_priority INTEGER NOT NULL DEFAULT 5,
            for_friend VARCHAR(100),
            group_order BOOLEAN DEFAULT FALSE,
            barista_notes TEXT,
            payment_status VARCHAR(20) DEFAULT 'pending',
            completion_time INTEGER,
            price DECIMAL(10,2) DEFAULT 0.0,
            payment_link TEXT,
            last_modified_by VARCHAR(50),
            edit_history JSONB,
            scheduled_for TIMESTAMP,
            qr_code_url TEXT
        )
        """)
        
        # Create feedback table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            rating INTEGER,
            comments TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create payment_transactions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS payment_transactions (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            amount DECIMAL(10,2),
            payment_method VARCHAR(50),
            transaction_id VARCHAR(100),
            status VARCHAR(20),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            payment_provider VARCHAR(50),
            customer_id VARCHAR(100),
            receipt_url TEXT
        )
        """)
        
        # Create loyalty_transactions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(20) NOT NULL,
            points INTEGER NOT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            order_id INTEGER REFERENCES orders(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
        """)
        
        # Create conversation_states table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS conversation_states (
            phone TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            temp_data JSONB,
            last_interaction TIMESTAMP,
            message_count INTEGER DEFAULT 1,
            context JSONB
        )
        """)
        
        # Create partial_orders table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS partial_orders (
            phone TEXT PRIMARY KEY,
            order_data JSONB NOT NULL,
            saved_at TIMESTAMP NOT NULL
        )
        """)
        
        # Create menu_items table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS menu_items (
            id SERIAL PRIMARY KEY,
            name VARCHAR(50) NOT NULL,
            category VARCHAR(20) NOT NULL,
            price DECIMAL(10,2) DEFAULT 0.0,
            description TEXT,
            options JSONB,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create chat_messages table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            is_urgent BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create sms_status_logs table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sms_status_logs (
            id SERIAL PRIMARY KEY,
            message_sid TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create indexes
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_station ON orders(station_id)')
        
        pg_conn.commit()
        logger.info("PostgreSQL tables created successfully")
    except Exception as e:
        pg_conn.rollback()
        logger.error(f"Error creating PostgreSQL tables: {str(e)}")
        sys.exit(1)

def get_sqlite_tables(sqlite_conn):
    """Get list of tables in SQLite database"""
    cursor = sqlite_conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    return [row[0] for row in cursor.fetchall()]

def get_table_columns(conn, table_name, is_postgres=False):
    """Get column names for a table"""
    if is_postgres:
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = '{table_name}'
            ORDER BY ordinal_position
        """)
        return [row[0] for row in cursor.fetchall()]
    else:
        cursor = conn.cursor()
        cursor.execute(f"PRAGMA table_info({table_name})")
        return [row[1] for row in cursor.fetchall()]

def convert_value_for_postgres(value, is_boolean_field=False, is_json_field=False):
    """Convert SQLite value to PostgreSQL compatible value"""
    if value is None:
        return None
    
    if is_boolean_field:
        if isinstance(value, int):
            return bool(value)
        return value
    
    if is_json_field:
        if isinstance(value, str):
            try:
                # Validate that it's valid JSON
                json.loads(value)
                return value
            except:
                # If not valid JSON, convert to empty JSON object
                return '{}'
        elif isinstance(value, (dict, list)):
            return json.dumps(value)
    
    # Handle timestamps
    if isinstance(value, str) and ('T' in value or ' ' in value) and (':' in value):
        try:
            # Try to parse as ISO format
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except:
            pass
    
    return value

def migrate_table(sqlite_conn, pg_conn, table_name):
    """Migrate a table from SQLite to PostgreSQL"""
    try:
        sqlite_cursor = sqlite_conn.cursor()
        pg_cursor = pg_conn.cursor()
        
        # Skip if table doesn't exist in SQLite
        sqlite_cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table_name}'")
        if not sqlite_cursor.fetchone():
            logger.info(f"Table {table_name} does not exist in SQLite, skipping")
            return 0
        
        # Get table data
        sqlite_cursor.execute(f"SELECT * FROM {table_name}")
        rows = sqlite_cursor.fetchall()
        
        if not rows:
            logger.info(f"No data in table {table_name}")
            return 0
        
        # Get column names
        columns = [column[0] for column in sqlite_cursor.description]
        pg_columns = get_table_columns(pg_conn, table_name, is_postgres=True)
        
        # Find common columns
        common_columns = [col for col in columns if col.lower() in [c.lower() for c in pg_columns]]
        
        if not common_columns:
            logger.warning(f"No common columns found for table {table_name}")
            return 0
        
        # Determine boolean and JSON fields
        boolean_fields = []
        json_fields = []
        
        # Check PostgreSQL table for boolean and JSON fields
        pg_cursor.execute(f"""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '{table_name}'
        """)
        for col in pg_cursor.fetchall():
            if col[1].lower() == 'boolean':
                boolean_fields.append(col[0])
            elif col[1].lower() in ('json', 'jsonb'):
                json_fields.append(col[0])
        
        # Insert data
        rows_inserted = 0
        for row in rows:
            row_dict = dict(zip(columns, row))
            values = []
            for col in common_columns:
                # Convert value based on field type
                is_boolean = col in boolean_fields
                is_json = col in json_fields
                values.append(convert_value_for_postgres(row_dict[col], is_boolean, is_json))
            
            # Generate placeholders
            placeholders = ', '.join(['%s' for _ in common_columns])
            
            # Generate SQL
            sql = f"INSERT INTO {table_name} ({', '.join(common_columns)}) VALUES ({placeholders})"
            
            try:
                pg_cursor.execute(sql, values)
                rows_inserted += 1
            except Exception as e:
                logger.warning(f"Error inserting row into {table_name}: {str(e)}")
                continue
        
        # Reset serial sequence for tables with ID column
        if 'id' in common_columns:
            pg_cursor.execute(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), COALESCE((SELECT MAX(id) FROM {table_name}), 0) + 1, false)")
        
        pg_conn.commit()
        logger.info(f"Migrated {rows_inserted} rows from {table_name}")
        return rows_inserted
    except Exception as e:
        pg_conn.rollback()
        logger.error(f"Error migrating table {table_name}: {str(e)}")
        return 0

def migrate_database(sqlite_path, pg_db_url):
    """Migrate data from SQLite to PostgreSQL"""
    sqlite_conn = connect_sqlite(sqlite_path)
    pg_conn = connect_postgres(pg_db_url)
    
    try:
        # Create PostgreSQL tables
        create_postgres_tables(pg_conn)
        
        # Get available tables
        sqlite_tables = get_sqlite_tables(sqlite_conn)
        logger.info(f"Found tables in SQLite: {', '.join(sqlite_tables)}")
        
        # Migrate tables in order
        total_rows = 0
        for table in MIGRATION_ORDER:
            if table in sqlite_tables:
                rows = migrate_table(sqlite_conn, pg_conn, table)
                total_rows += rows
            else:
                logger.info(f"Table {table} not found in SQLite database")
        
        # Migrate any remaining tables not in the order
        for table in sqlite_tables:
            if table not in MIGRATION_ORDER and not table.startswith('sqlite_'):
                rows = migrate_table(sqlite_conn, pg_conn, table)
                total_rows += rows
        
        logger.info(f"Migration completed successfully. Total rows migrated: {total_rows}")
    except Exception as e:
        logger.error(f"Migration failed: {str(e)}")
    finally:
        sqlite_conn.close()
        pg_conn.close()

def main():
    parser = argparse.ArgumentParser(description='Migrate data from SQLite to PostgreSQL')
    parser.add_argument('sqlite_path', help='Path to SQLite database file')
    parser.add_argument('pg_url', help='PostgreSQL connection URL')
    
    args = parser.parse_args()
    
    migrate_database(args.sqlite_path, args.pg_url)

if __name__ == "__main__":
    main()
