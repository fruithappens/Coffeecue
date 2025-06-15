"""
PostgreSQL database connection and utility functions with SQLite fallback
"""
import logging
import os
import sys
from datetime import datetime
import sqlite3
import getpass

# Try to import PostgreSQL modules, but provide SQLite fallback if not available
try:
    import psycopg2
    from psycopg2 import pool
    from psycopg2.extras import RealDictCursor
    HAS_POSTGRES = True
except ImportError:
    logging.warning("psycopg2 not installed. Falling back to SQLite (some features may be limited)")
    HAS_POSTGRES = False

# Configure logging
logger = logging.getLogger("expresso.database")

# Database connection pool
connection_pool = None

def init_db_pool(db_url=None):
    """Initialize the database connection pool"""
    global connection_pool
    
    # Get system username upfront so it's available throughout the function
    system_username = getpass.getuser()
    
    # Get database URL from environment or use default
    if not db_url:
        db_url = os.environ.get('DATABASE_URL', f'postgresql://{system_username}@localhost/expresso')
    
    logger.info(f"Initializing database with connection: {db_url}")
    
    try:
        # Parse connection parameters from URL
        # Format: postgresql://user:password@host:port/dbname
        if '://' in db_url:
            parts = db_url.split('://', 1)[1].split('@')
            
            # Handle usernames with no password
            if len(parts) == 1:
                # No @ symbol after credentials - entire string is host/dbname
                # This handles formats like "postgresql://localhost/expresso"
                credentials = ['']
                hostdb = parts[0]
            else:
                credentials = parts[0].split(':')
                hostdb = parts[1]
            
            user = credentials[0] if credentials[0] else system_username
            password = credentials[1] if len(credentials) > 1 else ''
            
            if '/' in hostdb:
                hostport, dbname = hostdb.split('/', 1)
                dbname = dbname.split('?')[0]  # Remove query parameters if any
            else:
                hostport = hostdb
                dbname = 'expresso'
                
            if ':' in hostport:
                host, port = hostport.split(':')
                port = int(port)
            else:
                host = hostport
                port = 5432
        else:
            # Default connection parameters for local development
            user = system_username
            password = ''
            host = 'localhost'
            port = 5432
            dbname = 'expresso'
        
        # Check if hostname matches the system username - common mistake in macOS
        if host == system_username:
            logger.warning(f"Replacing hostname '{host}' with 'localhost'")
            host = 'localhost'
        
        logger.info(f"Connecting to PostgreSQL as {user}@{host}:{port}/{dbname}")
        
        # Create a connection pool
        connection_pool = pool.SimpleConnectionPool(
            minconn=1,
            maxconn=10,
            user=user,
            password=password,
            host=host,
            port=port,
            dbname=dbname
        )
        
        logger.info(f"PostgreSQL connection pool initialized, connected to {host}:{port}/{dbname}")
        
        # Test connection
        conn = connection_pool.getconn()
        cursor = conn.cursor()
        cursor.execute("SELECT version();")
        version = cursor.fetchone()
        logger.info(f"PostgreSQL version: {version[0]}")
        
        # Create necessary tables
        create_tables(conn)
        
        # Return connection to pool
        connection_pool.putconn(conn)
        
        return True
    except Exception as e:
        logger.error(f"Failed to initialize PostgreSQL pool: {str(e)}")
        raise # Re-raise the exception to be handled by the caller

def get_db_connection(db_url=None):
    """Get a connection from the pool
    
    Args:
        db_url: Database URL (for PostgreSQL)
        
    Returns:
        Database connection
    """
    global connection_pool
    
    # If PostgreSQL is not available, fall back to SQLite
    if not HAS_POSTGRES:
        logger.info("Using SQLite database (fallback mode)")
        # Create a SQLite connection to a file
        sqlite_db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'coffee_orders.db')
        logger.info(f"SQLite database path: {sqlite_db_path}")
        
        # Create a SQLite connection
        conn = sqlite3.connect(sqlite_db_path)
        
        # Configure SQLite connection to return dictionaries
        conn.row_factory = sqlite3.Row
        
        # Create basic tables if they don't exist
        create_sqlite_tables(conn)
        
        return conn
    
    # Initialize the pool if it doesn't exist
    if connection_pool is None:
        init_db_pool(db_url)
    
    try:
        conn = connection_pool.getconn()
        return conn
    except Exception as e:
        logger.error(f"Error getting database connection: {str(e)}")
        
        # If connection to PostgreSQL fails, fall back to SQLite
        logger.info("Falling back to SQLite after PostgreSQL connection failure")
        sqlite_db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'coffee_orders.db')
        logger.info(f"SQLite fallback database path: {sqlite_db_path}")
        
        # Create a SQLite connection
        conn = sqlite3.connect(sqlite_db_path)
        
        # Configure SQLite connection to return dictionaries
        conn.row_factory = sqlite3.Row
        
        # Create basic tables if they don't exist
        create_sqlite_tables(conn)
        
        return conn

def close_connection(conn):
    """Return a connection to the pool or close SQLite connection"""
    global connection_pool
    
    if not conn:
        return
        
    try:
        # Check if it's an SQLite connection
        if isinstance(conn, sqlite3.Connection):
            # Commit any pending changes
            try:
                conn.commit()
            except:
                pass
            # Close the connection
            conn.close()
        elif connection_pool:
            # Return PostgreSQL connection to the pool
            connection_pool.putconn(conn)
    except Exception as e:
        logger.error(f"Error closing connection: {str(e)}")

def execute_query(conn, query, params=None, fetch_all=False, fetch_one=False):
    """
    Execute a query with parameters and optionally fetch results
    
    Args:
        conn: Database connection
        query: SQL query
        params: Query parameters
        fetch_all: Whether to fetch all results
        fetch_one: Whether to fetch one result
        
    Returns:
        Query results if fetch_all or fetch_one is True, otherwise None
    """
    cursor = None
    try:
        # Clear any failed transaction state first
        try:
            conn.rollback()
        except Exception:
            pass
        
        # Use RealDictCursor to get dictionary-like results
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Execute query with parameters if provided
        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)
        
        # Fetch results if requested
        if fetch_all:
            results = cursor.fetchall()
            return results
        elif fetch_one:
            result = cursor.fetchone()
            return result
        else:
            # Commit changes for INSERT/UPDATE/DELETE
            conn.commit()
            
            # Try to get the last inserted ID for INSERT statements
            if query.strip().upper().startswith('INSERT'):
                try:
                    # Get the ID of the last inserted row if available
                    return cursor.fetchone()[0] if cursor.rowcount > 0 else None
                except:
                    return None
            
            return True
    except Exception as e:
        # Rollback in case of error
        try:
            if conn:
                conn.rollback()
        except Exception:
            pass
        logger.error(f"Database error: {str(e)}")
        logger.error(f"Query: {query}")
        logger.error(f"Params: {params}")
        raise
    finally:
        # Close cursor but not connection (connection returns to pool)
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass

def execute_transaction(conn, queries_and_params):
    """
    Execute multiple queries in a transaction
    
    Args:
        conn: Database connection
        queries_and_params: List of (query, params) tuples
        
    Returns:
        True if successful, False otherwise
    """
    cursor = None
    try:
        cursor = conn.cursor()
        
        for query, params in queries_and_params:
            if params:
                cursor.execute(query, params)
            else:
                cursor.execute(query)
        
        conn.commit()
        return True
    except Exception as e:
        if conn:
            conn.rollback()
        logger.error(f"Transaction error: {str(e)}")
        for query, params in queries_and_params:
            logger.error(f"Query: {query}")
            logger.error(f"Params: {params}")
        return False
    finally:
        if cursor:
            cursor.close()

def create_tables(conn):
    """Create necessary tables if they don't exist"""
    cursor = conn.cursor()
    
    # Create tables here
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
        qr_code_url TEXT,
        completed_at TIMESTAMP,
        picked_up_at TIMESTAMP
    )
    ''')
    
    # Create feedback table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        rating INTEGER,
        comments TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Create payment_transactions table
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
    
    # Create loyalty_transactions table
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
    
    # Create customer_preferences table
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
    
    # Create station_stats table
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
        equipment_status VARCHAR(20) DEFAULT 'operational',
        wait_time INTEGER DEFAULT 15
    )
    ''')
    
    # Create station_schedule table
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
    
    # Create chat_messages table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        is_urgent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Create conversation_states table for NLP service
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
    
    # Create partial_orders table for abandoned conversations
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS partial_orders (
        phone VARCHAR(20) PRIMARY KEY,
        order_data JSONB NOT NULL,
        saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    
    # Create indexes for commonly queried fields
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_station ON orders(station_id);')
    
    # Check if completed_at column exists, add it if not
    try:
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'completed_at'")
        if not cursor.fetchone():
            logger.info("Adding missing completed_at column to orders table")
            cursor.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP")
    except Exception as e:
        logger.error(f"Error checking for completed_at column: {str(e)}")
        
    # Check if picked_up_at column exists, add it if not
    try:
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'picked_up_at'")
        if not cursor.fetchone():
            logger.info("Adding missing picked_up_at column to orders table")
            cursor.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP")
    except Exception as e:
        logger.error(f"Error checking for picked_up_at column: {str(e)}")
        
    # Check if wait_time column exists in station_stats
    try:
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_name = 'station_stats' AND column_name = 'wait_time'")
        if not cursor.fetchone():
            logger.info("Adding missing wait_time column to station_stats table")
            cursor.execute("ALTER TABLE station_stats ADD COLUMN IF NOT EXISTS wait_time INTEGER DEFAULT 15")
    except Exception as e:
        logger.error(f"Error checking for wait_time column: {str(e)}")
    
    conn.commit()
    logger.info("Database tables and indexes created successfully")
    
def create_sqlite_tables(conn):
    """Create necessary tables for SQLite"""
    cursor = conn.cursor()
    
    # Create orders table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        order_details TEXT NOT NULL,
        status TEXT NOT NULL,
        station_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        rating INTEGER,
        queue_priority INTEGER NOT NULL DEFAULT 5,
        for_friend TEXT,
        group_order INTEGER DEFAULT 0,
        barista_notes TEXT,
        payment_status TEXT DEFAULT 'pending',
        completion_time INTEGER,
        price REAL DEFAULT 0.0,
        payment_link TEXT,
        last_modified_by TEXT,
        edit_history TEXT,
        scheduled_for TIMESTAMP,
        qr_code_url TEXT,
        completed_at TIMESTAMP,
        picked_up_at TIMESTAMP
    )
    ''')
    
    # Create customer_preferences table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS customer_preferences (
        phone TEXT PRIMARY KEY,
        name TEXT,
        preferred_drink TEXT,
        preferred_milk TEXT,
        preferred_size TEXT,
        preferred_sugar TEXT,
        preferred_notes TEXT,
        last_station INTEGER,
        last_order_date TIMESTAMP,
        total_orders INTEGER DEFAULT 0,
        loyalty_points INTEGER DEFAULT 0,
        loyalty_free_drinks INTEGER DEFAULT 0,
        allergies TEXT,
        email TEXT,
        marketing_consent INTEGER DEFAULT 0,
        first_order_date TIMESTAMP,
        favorite_time_of_day TEXT,
        account_status TEXT DEFAULT 'active'
    )
    ''')
    
    # Create conversation_states table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS conversation_states (
        phone TEXT PRIMARY KEY,
        state TEXT,
        temp_data TEXT,
        last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        message_count INTEGER DEFAULT 1,
        context TEXT
    )
    ''')
    
    # Create indexes for common queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_orders_station ON orders(station_id)')
    
    conn.commit()
    logger.info("SQLite tables and indexes created successfully")

# Function to update a completed order status with accurate completion time
def update_order_status_with_time(conn, order_id, status, editor=None):
    """
    Update order status and record accurate completion time for analytics
    
    Args:
        conn: Database connection
        order_id: Order ID
        status: New status (pending, in-progress, completed, cancelled)
        editor: Who made the change
        
    Returns:
        Dictionary with updated order info
    """
    cursor = None
    try:
        # Calculate completion time if changing to completed status
        completion_time = None
        station_id = None
        
        cursor = conn.cursor()
        
        # Get current order info
        cursor.execute('''
            SELECT 
                created_at, station_id, status, order_number, phone
            FROM orders 
            WHERE id = %s
        ''', (order_id,))
        
        result = cursor.fetchone()
        if not result:
            return {'success': False, 'error': 'Order not found'}
        
        created_at, station_id, current_status, order_number, phone = result
        
        # Calculate accurate completion time when transitioning to completed
        if status == 'completed' and current_status != 'completed':
            current_time = datetime.now()
            completion_time = int((current_time - created_at).total_seconds())
            
            # Update order with completion time
            try:
                cursor.execute('''
                    UPDATE orders 
                    SET 
                        status = %s, 
                        last_modified_by = %s,
                        completion_time = %s,
                        completed_at = %s,
                        updated_at = %s
                    WHERE id = %s
                    RETURNING completion_time
                ''', (
                    status, 
                    editor or 'system', 
                    completion_time,
                    current_time,
                    current_time, 
                    order_id
                ))
            except Exception as e:
                logger.error(f"Error updating order with completed_at column: {str(e)}")
                # Fallback in case completed_at column doesn't exist
                cursor.execute('''
                    UPDATE orders 
                    SET 
                        status = %s, 
                        last_modified_by = %s,
                        completion_time = %s,
                        updated_at = %s
                    WHERE id = %s
                    RETURNING completion_time
                ''', (
                    status, 
                    editor or 'system', 
                    completion_time,
                    current_time, 
                    order_id
                ))
        else:
            # Update without completion time for other status changes
            cursor.execute('''
                UPDATE orders 
                SET 
                    status = %s, 
                    last_modified_by = %s,
                    updated_at = %s
                WHERE id = %s
            ''', (
                status, 
                editor or 'system', 
                datetime.now(), 
                order_id
            ))
        
        # Update station load if order is completed or cancelled
        if station_id and (status == 'completed' or status == 'cancelled'):
            # Decrement station load (with floor of 0)
            cursor.execute('''
                UPDATE station_stats 
                SET 
                    current_load = GREATEST(0, current_load - 1),
                    last_updated = %s
                WHERE station_id = %s
            ''', (datetime.now(), station_id))
            
            # For completed orders, update statistics
            if status == 'completed':
                # Increment total completed orders for station
                cursor.execute('''
                    UPDATE station_stats 
                    SET 
                        total_orders = total_orders + 1
                    WHERE station_id = %s
                ''', (station_id,))
                
                # If completion time is available, update station average
                if completion_time:
                    # Get current station statistics
                    cursor.execute('''
                        SELECT 
                            avg_completion_time, 
                            total_orders
                        FROM station_stats 
                        WHERE station_id = %s
                    ''', (station_id,))
                    
                    stats_result = cursor.fetchone()
                    if stats_result:
                        current_avg, total_completed = stats_result
                        
                        # Calculate new weighted average
                        # Give more weight to recent data (70% new, 30% historical)
                        if total_completed <= 1:
                            new_avg = completion_time
                        else:
                            new_avg = (current_avg * 0.3) + (completion_time * 0.7)
                        
                        # Update station's average completion time
                        cursor.execute('''
                            UPDATE station_stats 
                            SET 
                                avg_completion_time = %s
                            WHERE station_id = %s
                        ''', (int(new_avg), station_id))
        
        conn.commit()
        
        return {
            'success': True,
            'order_id': order_id,
            'order_number': order_number,
            'status': status,
            'station_id': station_id,
            'completion_time': completion_time,
            'phone': phone
        }
    
    except Exception as e:
        if conn:
            conn.rollback()
        
        logger.error(f"Error updating order status: {str(e)}")
        
        return {
            'success': False,
            'error': str(e)
        }
    
    finally:
        if cursor:
            cursor.close()

# Function to get station performance statistics for wait time calculations
def get_station_performance(conn, station_id):
    """
    Get station performance statistics for better wait time estimation
    
    Args:
        conn: Database connection
        station_id: Station ID
        
    Returns:
        Dictionary with performance metrics
    """
    cursor = None
    try:
        cursor = conn.cursor()
        
        # Get station current load
        cursor.execute('''
            SELECT 
                current_load, 
                avg_completion_time,
                wait_time
            FROM station_stats
            WHERE station_id = %s
        ''', (station_id,))
        
        stats_result = cursor.fetchone()
        if not stats_result:
            return {
                'current_load': 0,
                'avg_time_seconds': 180,
                'avg_time_minutes': 3,
                'recent_avg_minutes': 3,
                'recent_count': 0,
                'reliability': 'low',
                'wait_time': 15
            }
        
        if len(stats_result) >= 3:  # If wait_time column exists
            current_load, avg_completion_time, wait_time = stats_result
        else:
            current_load, avg_completion_time = stats_result
            wait_time = 15  # Default if wait_time column doesn't exist
        
        # Get recent performance (last 2 hours)
        cursor.execute('''
            SELECT 
                AVG(completion_time) as avg_time,
                COUNT(*) as count,
                STDDEV(completion_time) as std_dev
            FROM orders
            WHERE 
                station_id = %s AND 
                status = 'completed' AND
                completion_time IS NOT NULL AND
                completion_time > 0 AND
                created_at > NOW() - INTERVAL '2 hours'
        ''', (station_id,))
        
        recent_result = cursor.fetchone()
        recent_avg_seconds = recent_result[0] if recent_result and recent_result[0] else None
        recent_count = recent_result[1] if recent_result else 0
        std_dev = recent_result[2] if recent_result and recent_result[2] else None
        
        # Calculate statistics
        if recent_avg_seconds:
            recent_avg_minutes = round(recent_avg_seconds / 60, 1)
            # Calculate coefficient of variation (normalized measure of dispersion)
            cv = (std_dev / recent_avg_seconds) if std_dev and recent_avg_seconds > 0 else 1.0
            
            # Determine reliability based on sample size and consistency
            if recent_count >= 10 and cv < 0.3:
                reliability = 'high'
            elif recent_count >= 5 and cv < 0.5:
                reliability = 'medium'
            else:
                reliability = 'low'
        else:
            recent_avg_minutes = round(avg_completion_time / 60, 1) if avg_completion_time else 3
            reliability = 'low'
        
        return {
            'current_load': current_load or 0,
            'avg_time_seconds': avg_completion_time or 180,
            'avg_time_minutes': round((avg_completion_time or 180) / 60, 1),
            'recent_avg_minutes': recent_avg_minutes,
            'recent_count': recent_count,
            'reliability': reliability,
            'wait_time': wait_time or 15
        }
    
    except Exception as e:
        logger.error(f"Error getting station performance: {str(e)}")
        
        return {
            'current_load': 0,
            'avg_time_seconds': 180,
            'avg_time_minutes': 3,
            'recent_avg_minutes': 3,
            'recent_count': 0,
            'reliability': 'low',
            'wait_time': 15,
            'error': str(e)
        }
    
    finally:
        if cursor:
            cursor.close()