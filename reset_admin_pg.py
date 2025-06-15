#!/usr/bin/env python
import sys
import hashlib
import secrets
import argparse
import psycopg2
from psycopg2.extras import RealDictCursor

def hash_password(password):
    """Hash a password with a random salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
    return f"{salt}:{password_hash}"

def reset_admin(db_url, username, password):
    """Reset an admin user's password"""
    try:
        # Connect to the database
        conn = psycopg2.connect(db_url)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Check if user exists
        cursor.execute("SELECT id, username FROM users WHERE username = %s", (username,))
        user = cursor.fetchone()
        
        if user:
            # User exists, update password
            password_hash = hash_password(password)
            cursor.execute("""
                UPDATE users 
                SET password_hash = %s, 
                    last_password_change = NOW(),
                    failed_login_attempts = 0,
                    account_locked = FALSE,
                    account_locked_until = NULL
                WHERE id = %s
            """, (password_hash, user['id']))
            
            conn.commit()
            print(f"Password reset successfully for user '{username}'.")
            print(f"Login with username: {username} and password: {password}")
            return True
        else:
            # User doesn't exist
            print(f"User '{username}' not found.")
            print("Creating new admin user...")
            
            # Create admin user
            password_hash = hash_password(password)
            
            cursor.execute("""
            INSERT INTO users (username, email, password_hash, role, full_name, created_at, last_password_change)
            VALUES (%s, %s, %s, 'admin', 'System Administrator', NOW(), NOW())
            RETURNING id
            """, (username, f"{username}@example.com", password_hash))
            
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
                ON CONFLICT (user_id, permission_name) DO NOTHING
                """, (user_id, permission))
            
            conn.commit()
            print(f"Admin user '{username}' created successfully.")
            print(f"Login with username: {username} and password: {password}")
            return True
    except Exception as e:
        if 'conn' in locals():
            conn.rollback()
        print(f"Error: {e}")
        return False
    finally:
        if 'cursor' in locals():
            cursor.close()
        if 'conn' in locals():
            conn.close()

def main():
    parser = argparse.ArgumentParser(description='Reset admin password for Expresso system')
    parser.add_argument('--db_url', help='Database URL', default='postgresql://stevewf@localhost:5432/expresso')
    parser.add_argument('--username', help='Admin username', default='admin')
    parser.add_argument('--password', help='New password', default='adminpass123')
    
    args = parser.parse_args()
    
    success = reset_admin(args.db_url, args.username, args.password)
    if not success:
        sys.exit(1)

if __name__ == "__main__":
    main()