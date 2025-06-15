import sqlite3
import uuid
import datetime
import os
import hashlib
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def update_admin_users_table(conn):
    """Update the admin_users table to support email addresses and password reset"""
    cursor = conn.cursor()
    
    # Check if the table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_users'")
    exists = cursor.fetchone()
    
    if not exists:
        # Create the table with all needed fields
        logger.info("Creating admin_users table")
        cursor.execute('''
        CREATE TABLE admin_users (
            id INTEGER PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            reset_token TEXT,
            reset_token_expiry TIMESTAMP
        )
        ''')
    else:
        # Check if email column exists
        cursor.execute("PRAGMA table_info(admin_users)")
        columns = [column[1] for column in cursor.fetchall()]
        
        # Add email column if it doesn't exist
        if 'email' not in columns:
            logger.info("Adding email column to admin_users table")
            cursor.execute("ALTER TABLE admin_users ADD COLUMN email TEXT UNIQUE")
        
        # Add password reset columns if they don't exist
        if 'reset_token' not in columns:
            logger.info("Adding reset_token column to admin_users table")
            cursor.execute("ALTER TABLE admin_users ADD COLUMN reset_token TEXT")
        
        if 'reset_token_expiry' not in columns:
            logger.info("Adding reset_token_expiry column to admin_users table")
            cursor.execute("ALTER TABLE admin_users ADD COLUMN reset_token_expiry TIMESTAMP")
    
    conn.commit()
    logger.info("Admin users table updated successfully")

def hash_password(password):
    """Create a secure password hash using SHA-256 and a salt"""
    salt = uuid.uuid4().hex
    # In a production system, use a more secure algorithm like bcrypt, Argon2, or PBKDF2
    return hashlib.sha256(salt.encode() + password.encode()).hexdigest() + ':' + salt

def create_admin_user(conn, username, email, password, role='admin'):
    """Create a new admin user"""
    cursor = conn.cursor()
    
    # Check if user already exists
    cursor.execute("SELECT id FROM admin_users WHERE username = ? OR email = ?", (username, email))
    existing_user = cursor.fetchone()
    
    if existing_user:
        logger.warning(f"User with username {username} or email {email} already exists")
        return False
    
    # Hash the password
    password_hash = hash_password(password)
    
    # Insert the new user
    cursor.execute('''
    INSERT INTO admin_users (username, email, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?)
    ''', (username, email, password_hash, role, datetime.datetime.now()))
    
    conn.commit()
    logger.info(f"Created admin user: {username} with role: {role}")
    return True

def setup_admin_users():
    """Main function to set up admin users"""
    db_path = os.getenv('DB_PATH', 'coffee_orders.db')
    logger.info(f"Setting up admin users in database: {db_path}")
    
    # Connect to the database
    conn = sqlite3.connect(db_path)
    
    try:
        # Update the schema
        update_admin_users_table(conn)
        
        # Create a default admin user if none exists
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM admin_users")
        user_count = cursor.fetchone()[0]
        
        if user_count == 0:
            # Create default admin
            create_admin_user(
                conn,
                username="admin",
                email="admin@example.com",
                password="ChangeMe123!",  # This should be changed immediately after first login
                role="admin"
            )
            logger.info("Created default admin user. Please change the password after first login.")
        else:
            logger.info(f"Found {user_count} existing admin users. No default user created.")
            
    except Exception as e:
        logger.error(f"Error setting up admin users: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    setup_admin_users()
