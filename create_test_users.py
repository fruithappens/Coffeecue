#!/usr/bin/env python
"""
Creates test users for testing authentication and role-based access
"""
import sys
import os
import hashlib
import json

try:
    # First try to import from a package
    from models.users import User
    from utils.database import db_session
    MODELS_IMPORTED = True
except ImportError:
    MODELS_IMPORTED = False
    print("Could not import User model, using direct database connection.")

# Test users to create
TEST_USERS = [
    {
        "username": "barista",
        "password": "barista123",
        "role": "barista",
        "name": "Test Barista"
    },
    {
        "username": "admin",
        "password": "admin123",
        "role": "admin",
        "name": "Test Admin"
    },
    {
        "username": "organizer",
        "password": "organizer123",
        "role": "organizer",
        "name": "Test Organizer"
    }
]

def create_users_with_model():
    """Create users using the User model"""
    for user_data in TEST_USERS:
        # Check if user already exists
        existing_user = User.query.filter_by(username=user_data["username"]).first()
        
        if existing_user:
            print(f"User '{user_data['username']}' already exists")
            continue
        
        # Create new user
        new_user = User(
            username=user_data["username"],
            name=user_data["name"],
            role=user_data["role"]
        )
        new_user.set_password(user_data["password"])
        
        db_session.add(new_user)
        print(f"Created user: {user_data['username']} (role: {user_data['role']})")
    
    # Commit changes
    db_session.commit()
    print("All users created successfully")
    return True

def create_users_with_direct_db():
    """Create users by writing to a direct DB file (fallback method)"""
    try:
        import sqlite3
        
        # Try to connect to the SQLite database
        conn = sqlite3.connect('coffee_orders.db')
        cursor = conn.cursor()
        
        # Check if users table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if not cursor.fetchone():
            # Create users table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                password_hash TEXT,
                name TEXT,
                role TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
        
        for user_data in TEST_USERS:
            # Check if user already exists
            cursor.execute("SELECT id FROM users WHERE username = ?", (user_data["username"],))
            if cursor.fetchone():
                print(f"User '{user_data['username']}' already exists")
                continue
            
            # Hash the password
            password_hash = hashlib.sha256(user_data["password"].encode()).hexdigest()
            
            # Insert user
            cursor.execute('''
            INSERT INTO users (username, password_hash, name, role)
            VALUES (?, ?, ?, ?)
            ''', (
                user_data["username"],
                password_hash,
                user_data["name"],
                user_data["role"]
            ))
            
            print(f"Created user: {user_data['username']} (role: {user_data['role']})")
        
        # Commit changes
        conn.commit()
        conn.close()
        print("All users created successfully")
        return True
        
    except Exception as e:
        print(f"Error creating users: {e}")
        return False

def main():
    """Main function"""
    print("Creating test users...")
    
    if MODELS_IMPORTED:
        success = create_users_with_model()
    else:
        success = create_users_with_direct_db()
    
    if success:
        print("Test users created successfully")
        return 0
    else:
        print("Failed to create test users")
        return 1

if __name__ == "__main__":
    sys.exit(main())
