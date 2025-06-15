#!/usr/bin/env python
import sqlite3
import hashlib
import secrets
import sys
import os

def hash_password(password):
    """Hash a password with a random salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
    return f"{salt}:{password_hash}"

def create_admin(db_path, username, email, password):
    """Create a new admin user"""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if user exists
    cursor.execute("SELECT id FROM users WHERE username = ? OR email = ?", (username, email))
    existing_user = cursor.fetchone()
    
    if existing_user:
        print(f"User with username '{username}' or email '{email}' already exists.")
        delete = input("Do you want to delete this user and create a new one? (y/n): ")
        if delete.lower() == 'y':
            cursor.execute("DELETE FROM users WHERE id = ?", (existing_user[0],))
            print(f"Deleted existing user.")
        else:
            print("Operation cancelled.")
            conn.close()
            return False
    
    # Create admin user
    password_hash = hash_password(password)
    try:
        cursor.execute("""
        INSERT INTO users (username, email, password_hash, role, full_name)
        VALUES (?, ?, ?, 'admin', 'System Administrator')
        """, (username, email, password_hash))
        
        conn.commit()
        print(f"Admin user '{username}' created successfully!")
        return True
    except Exception as e:
        print(f"Error creating admin user: {e}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) != 5:
        print("Usage: python create_admin.py <db_path> <username> <email> <password>")
        sys.exit(1)
    
    db_path = sys.argv[1]
    username = sys.argv[2]
    email = sys.argv[3]
    password = sys.argv[4]
    
    if not os.path.exists(db_path):
        print(f"Database file {db_path} not found.")
        sys.exit(1)
    
    success = create_admin(db_path, username, email, password)
    if success:
        print(f"Login credentials:")
        print(f"Username: {username}")
        print(f"Password: {password}")
        print(f"URL: http://127.0.0.1:5001/auth/login")
    else:
        print("Failed to create admin user.")
