#!/usr/bin/env python3
"""
Script to create initial admin user for Expresso Coffee System
"""

import os
import sys
import pathlib

# Determine the project root directory
project_root = pathlib.Path(__file__).resolve().parent.parent

# Add the project root to Python path
sys.path.insert(0, str(project_root))

# Setup Flask application context
from app import create_app
from werkzeug.security import generate_password_hash

def create_initial_admin():
    """Create the initial admin user"""
    # Create Flask app
    app = create_app()
    
    # Use application context
    with app.app_context():
        # Get coffee system from app context
        coffee_system = app.config.get('coffee_system')
        
        if not coffee_system:
            print("Error: Coffee system not found in app configuration")
            return False
        
        db = coffee_system.db
        
        # Prepare admin user data
        admin_data = {
            'username': 'admin',
            'password': generate_password_hash('@dm1n'),
            'role': 'admin',
            'email': 'admin@expresso.local'
        }
        
        try:
            # Import AdminUser model
            from models.users import AdminUser
            
            # Check if admin user already exists
            cursor = db.cursor()
            cursor.execute('SELECT * FROM admin_users WHERE username = ?', (admin_data['username'],))
            existing_user = cursor.fetchone()
            
            if existing_user:
                print("Admin user already exists. Skipping creation.")
                return False
            
            # Create the admin user
            user_id = AdminUser.create_user(db, admin_data)
            
            if user_id:
                print(f"Admin user created successfully with ID: {user_id}")
                print("Username: admin")
                print("Password: @dm1n")
                print("\n!!! IMPORTANT !!!")
                print("Please change this password immediately after first login.")
                return True
            else:
                print("Failed to create admin user")
                return False
        
        except Exception as e:
            print(f"Error creating admin user: {e}")
            return False

def main():
    """Main script execution"""
    create_initial_admin()

if __name__ == '__main__':
    main()
