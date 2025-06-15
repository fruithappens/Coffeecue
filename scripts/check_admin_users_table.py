#!/usr/bin/env python3
"""
Script to check the structure of admin_users table
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

def check_admin_users_table():
    """Check the structure of admin_users table"""
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
        
        # Check table info
        cursor = db.cursor()
        cursor.execute("PRAGMA table_info(admin_users)")
        columns = cursor.fetchall()
        
        print("Admin Users Table Structure:")
        print("----------------------------")
        print("Column ID | Name | Type | Not Null | Default Value | Primary Key")
        print("----------------------------")
        for column in columns:
            print(f"{column[0]} | {column[1]} | {column[2]} | {column[3]} | {column[4]} | {column[5]}")
        
        print("\n\nFull Column Names (in order):")
        print([column[1] for column in columns])

def main():
    """Main script execution"""
    check_admin_users_table()

if __name__ == '__main__':
    main()
