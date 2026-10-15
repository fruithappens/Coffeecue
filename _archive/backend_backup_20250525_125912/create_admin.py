#!/usr/bin/env python
import sys
import os
import hashlib
import secrets
import argparse
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

def hash_password(password):
    """Hash a password with a random salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
    return f"{salt}:{password_hash}"

def create_admin(db_url, username, email, password, force=False):
    """Create a new admin user with option to force creation"""
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
    
    # Create a connection pool
    connection_pool = pool.SimpleConnectionPool(
        minconn=1,
        maxconn=1,
        user=db_user,
        password=db_password,
        host=host,
        port=port,
        dbname=dbname
    )
    
    conn = connection_pool.getconn()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Check if user exists
        cursor.execute("SELECT id FROM users WHERE username = %s OR email = %s", (username, email))
        existing_user = cursor.fetchone()
        
        if existing_user:
            print(f"User with username '{username}' or email '{email}' already exists.")
            if force:
                delete = 'y'
                print("Force flag set, automatically deleting existing user.")
            else:
                delete = input("Do you want to delete this user and create a new one? (y/n): ")
            
            if delete.lower() == 'y':
                cursor.execute("DELETE FROM users WHERE id = %s", (existing_user['id'],))
                print(f"Deleted existing user.")
            else:
                print("Operation cancelled.")
                return False
        
        # Create admin user
        password_hash = hash_password(password)
        
        # Ensure the users table exists
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
        
        # Ensure the user_permissions table exists
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_permissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_name VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_name)
        )
        """)
        
        cursor.execute("""
        INSERT INTO users (username, email, password_hash, role, full_name, created_at, last_password_change)
        VALUES (%s, %s, %s, 'admin', 'System Administrator', NOW(), NOW())
        RETURNING id
        """, (username, email, password_hash))
        
        user_id = cursor.fetchone()['id']
        
        # Add admin permissions
        admin_permissions = [
            'admin_access', 'manage_users', 'manage_system', 
            'view_reports', 'manage_orders', 'manage_stations'
        ]
        
        for permission in admin_permissions:
            cursor.execute("""
            INSERT INTO user_permissions (user_id, permission_name)
            VALUES (%s, %s)
            """, (user_id, permission))
        
        conn.commit()
        print(f"Admin user '{username}' created successfully!")
        return True
    except Exception as e:
        conn.rollback()
        print(f"Error creating admin user: {e}")
        return False
    finally:
        cursor.close()
        connection_pool.putconn(conn)

def main():
    parser = argparse.ArgumentParser(description='Create admin user for Expresso Coffee Ordering System')
    parser.add_argument('db_url', help='Database URL (postgresql://user:pass@host:port/dbname)')
    parser.add_argument('username', help='Admin username')
    parser.add_argument('email', help='Admin email')
    parser.add_argument('password', help='Admin password')
    parser.add_argument('--server_url', help='Server URL for login', default='http://127.0.0.1:5001')
    parser.add_argument('--force', action='store_true', help='Force creation, replacing existing user if needed')
    
    args = parser.parse_args()
    
    success = create_admin(args.db_url, args.username, args.email, args.password, args.force)
    if success:
        print(f"Login credentials:")
        print(f"Username: {args.username}")
        print(f"Password: {args.password}")
        print(f"URL: {args.server_url}/auth/login")
    else:
        print("Failed to create admin user.")
        sys.exit(1)

if __name__ == "__main__":
    main()