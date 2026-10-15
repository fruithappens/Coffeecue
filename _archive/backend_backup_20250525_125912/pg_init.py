#!/usr/bin/env python
"""
Initialize PostgreSQL database and create admin user
"""
import psycopg2
import os
import sys
import argparse
import logging
import hashlib
import secrets
from datetime import datetime
from urllib.parse import urlparse, parse_qs

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("init_postgres")

def hash_password(password):
    """Hash a password with a random salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
    return f"{salt}:{password_hash}"

def parse_postgres_url(db_url):
    """
    Parse PostgreSQL connection URL with robust error handling
    
    Args:
        db_url: PostgreSQL connection URL
        
    Returns:
        Dictionary with connection parameters
    """
    # Default connection parameters
    params = {
        'user': os.getenv('USER', 'postgres'),
        'password': '',
        'host': 'localhost',
        'port': 5432,
        'dbname': 'expresso'
    }
    
    try:
        # If URL doesn't start with postgresql://, prepend it
        if not db_url.startswith('postgresql://'):
            db_url = f'postgresql://{db_url}'
        
        # Use urlparse to parse the connection string
        parsed = urlparse(db_url)
        
        # Extract username and password
        if parsed.username:
            params['user'] = parsed.username
        if parsed.password:
            params['password'] = parsed.password
        
        # Extract host and port
        if parsed.hostname:
            params['host'] = parsed.hostname
        if parsed.port:
            params['port'] = parsed.port
        
        # Extract database name
        if parsed.path and parsed.path.strip('/'):
            params['dbname'] = parsed.path.strip('/')
        
        # Handle query parameters
        query_params = parse_qs(parsed.query)
        if 'dbname' in query_params:
            params['dbname'] = query_params['dbname'][0]
        
        return params
    
    except Exception as e:
        logger.error(f"Error parsing database URL: {str(e)}")
        return params

def init_db(db_url, admin_username=None, admin_email=None, admin_password=None):
    """Initialize the database and create admin user"""
    try:
        # Parse connection parameters
        conn_params = parse_postgres_url(db_url)
        
        logger.info(f"Connecting to PostgreSQL database: {conn_params['host']}:{conn_params['port']}/{conn_params['dbname']}")
        
        # Try to connect to the default postgres database to create the new database
        try:
            conn_admin = psycopg2.connect(
                user=conn_params['user'],
                password=conn_params['password'],
                host=conn_params['host'],
                port=conn_params['port'],
                dbname='postgres'  # Connect to default postgres database
            )
            conn_admin.autocommit = True
            cursor_admin = conn_admin.cursor()
            
            # Check if the database exists
            cursor_admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (conn_params['dbname'],))
            if cursor_admin.fetchone() is None:
                # Create database if it doesn't exist
                logger.info(f"Database '{conn_params['dbname']}' doesn't exist, creating it...")
                cursor_admin.execute(f'CREATE DATABASE "{conn_params["dbname"]}"')
                logger.info(f"Database '{conn_params['dbname']}' created successfully")
            else:
                logger.info(f"Database '{conn_params['dbname']}' already exists")
            
            # Close admin connection
            cursor_admin.close()
            conn_admin.close()
        except Exception as admin_conn_err:
            logger.warning(f"Could not connect to postgres database: {str(admin_conn_err)}")
            # Continue with connection attempt to target database
        
        # Connect to the application database
        conn = psycopg2.connect(
            user=conn_params['user'],
            password=conn_params['password'],
            host=conn_params['host'],
            port=conn_params['port'],
            dbname=conn_params['dbname']
        )
        conn.autocommit = False
        
        # Create the tables
        create_tables(conn)
        logger.info("Database tables created successfully")
        
        # Create default admin user if credentials provided
        if admin_username and admin_email and admin_password:
            create_admin_user(conn, admin_username, admin_email, admin_password)
        
        # Add basic settings
        initialize_settings(conn)
        logger.info("Default settings initialized")
        
        # Initialize stations
        initialize_stations(conn)
        logger.info("Stations initialized")
        
        # Close the connection
        conn.close()
        
        logger.info("Database initialization complete")
        return True
    except Exception as e:
        logger.error(f"Error initializing database: {str(e)}")
        return False

def create_tables(conn):
    """Create all necessary tables"""
    with conn.cursor() as cursor:
        # Users table
        cursor.execute('''
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
        ''')
        
        # User permissions table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_permissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_name VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_name)
        )
        ''')
        
        # Settings table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_by VARCHAR(50)
        )
        ''')
        
        # Orders table
        cursor.execute('''
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
        ''')
        
        # Feedback table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS feedback (
            id SERIAL PRIMARY KEY,
            order_id INTEGER NOT NULL REFERENCES orders(id),
            rating INTEGER,
            comments TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Payment transactions table
        cursor.execute('''
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
        ''')
        
        # Loyalty transactions table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(20) NOT NULL,
            points INTEGER NOT NULL,
            transaction_type VARCHAR(20) NOT NULL,
            order_id INTEGER REFERENCES orders(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            notes TEXT
        )
        ''')
        
        # Customer preferences table
        cursor.execute('''
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
        ''')
        
        # Station stats table
        cursor.execute('''
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
        ''')
        
        # Station schedule table
        cursor.execute('''
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
        ''')
        
        # Chat messages table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            is_urgent BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Conversation states table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS conversation_states (
            phone VARCHAR(20) PRIMARY KEY,
            state VARCHAR(50),
            temp_data JSONB,
            last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            message_count INTEGER DEFAULT 1,
            context JSONB
        )
        ''')
        
        # Partial orders table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS partial_orders (
            phone VARCHAR(20) PRIMARY KEY,
            order_data JSONB NOT NULL,
            saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        # Create indexes for improved performance
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_station ON orders(station_id);')
        
        conn.commit()

def create_admin_user(conn, username, email, password):
    """Create an admin user"""
    logger.info(f"Creating admin user: {username}")
    
    with conn.cursor() as cursor:
        # Check if user already exists
        cursor.execute("SELECT id FROM users WHERE username = %s OR email = %s", (username, email))
        if cursor.fetchone():
            logger.warning(f"Admin user {username} already exists, skipping creation")
            return
        
        # Hash the password
        password_hash = hash_password(password)
        
        # Insert admin user
        cursor.execute('''
            INSERT INTO users 
            (username, email, password_hash, role, full_name, created_at, last_password_change)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        ''', (username, email, password_hash, 'admin', 'System Administrator', datetime.now(), datetime.now()))
        
        user_id = cursor.fetchone()[0]
        
        # Add admin permissions
        permissions = [
            'admin_access', 'manage_users', 'manage_system', 
            'view_reports', 'manage_orders', 'manage_stations'
        ]
        
        for permission in permissions:
            cursor.execute('''
                INSERT INTO user_permissions (user_id, permission_name)
                VALUES (%s, %s)
            ''', (user_id, permission))
        
        conn.commit()
        logger.info(f"Admin user '{username}' created successfully with ID {user_id}")

def initialize_settings(conn):
    """Initialize default system settings"""
    settings = [
        ('system_name', 'Expresso Coffee System', 'Name of the system'),
        ('event_name', 'ANZCA ASM 2025 Cairns', 'Name of the event'),
        ('vip_code', ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6)), 'Access code for VIP orders'),
        ('staff_code', ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6)), 'Access code for staff'),
        ('sponsor_name', '', 'Name of the coffee sponsor'),
        ('sponsor_message', 'Coffee service proudly sponsored by {sponsor}', 'Message template for sponsor acknowledgment'),
        ('sponsor_display_enabled', 'true', 'Show sponsor message in confirmations'),
        ('payment_enabled', 'false', 'Enable payment for coffee orders'),
        ('jwt_enabled', 'true', 'Use JWT for authentication')
    ]
    
    with conn.cursor() as cursor:
        for key, value, description in settings:
            cursor.execute('''
                INSERT INTO settings (key, value, description, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (key) DO UPDATE 
                SET value = EXCLUDED.value, 
                    description = EXCLUDED.description,
                    updated_at = EXCLUDED.updated_at
            ''', (key, value, description, datetime.now()))
    
    conn.commit()

def initialize_stations(conn, num_stations=3):
    """Initialize station records"""
    with conn.cursor() as cursor:
        # Get existing stations
        cursor.execute("SELECT station_id FROM station_stats")
        existing_stations = [row[0] for row in cursor.fetchall()]
        
        # Create any missing stations
        for station_id in range(1, num_stations + 1):
            if station_id not in existing_stations:
                cursor.execute('''
                    INSERT INTO station_stats 
                    (station_id, status, last_updated)
                    VALUES (%s, %s, %s)
                ''', (station_id, 'active', datetime.now()))
        
        conn.commit()
        logger.info(f"Initialized {num_stations} stations")

def main():
    """Main function to initialize the database"""
    parser = argparse.ArgumentParser(description='Initialize PostgreSQL database for Expresso')
    
    # Add database URL argument with default from environment variable or fallback
    default_db_url = os.getenv('DATABASE_URL', 'postgresql://localhost/expresso')
    parser.add_argument('--db-url', help='Database URL (postgresql://user:pass@host:port/dbname)', 
                       default=default_db_url)
    
    # Admin user details with environment variable fallbacks
    parser.add_argument('--admin-username', help='Admin username', 
                       default=os.getenv('DEFAULT_ADMIN_USERNAME', 'coffeecue'))
    parser.add_argument('--admin-email', help='Admin email', 
                       default=os.getenv('DEFAULT_ADMIN_EMAIL', 'admin@example.com'))
    parser.add_argument('--admin-password', help='Admin password', 
                       default=os.getenv('DEFAULT_ADMIN_PASSWORD', 'adminpassword'))
    
    # Number of stations to create
    parser.add_argument('--num-stations', type=int, help='Number of stations to create',
                       default=int(os.getenv('NUM_STATIONS', 3)))
    
    args = parser.parse_args()
    
    # Initialize the database
    success = init_db(
        args.db_url, 
        args.admin_username, 
        args.admin_email, 
        args.admin_password
    )
    
    if success:
        print("\nDatabase initialization complete!")
        print(f"\nLogin credentials:")
        print(f"Username: {args.admin_username}")
        print(f"Email: {args.admin_email}")
        print(f"URL: http://localhost:5001/auth/login")
        
        # Print VIP and staff codes
        try:
            conn = psycopg2.connect(args.db_url)
            cursor = conn.cursor()
            
            # Fetch VIP and staff codes
            cursor.execute("SELECT key, value FROM settings WHERE key IN ('vip_code', 'staff_code')")
            codes = dict(cursor.fetchall())
            
            print("\nAccess Codes:")
            print(f"VIP Code: {codes.get('vip_code', 'N/A')}")
            print(f"Staff Code: {codes.get('staff_code', 'N/A')}")
            
            conn.close()
        except Exception as e:
            print(f"Could not retrieve access codes: {e}")
    else:
        print("\nDatabase initialization failed.")
        sys.exit(1)

if __name__ == "__main__":
    main()