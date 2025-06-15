#!/usr/bin/env python3
"""
Ensure admin user exists in database.
This runs on startup to make sure there's always an admin user available.
"""

import os
import sys
from create_admin import create_admin

def main():
    # Get database URL from environment
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("WARNING: No DATABASE_URL found, skipping admin user creation")
        return
    
    # Default admin credentials from environment or defaults
    username = os.getenv('DEFAULT_ADMIN_USERNAME', 'coffeecue')
    email = os.getenv('DEFAULT_ADMIN_EMAIL', 'admin@coffeecue.com')
    password = os.getenv('DEFAULT_ADMIN_PASSWORD', 'adminpassword')
    
    print(f"Ensuring admin user '{username}' exists...")
    
    try:
        # Force create to ensure user exists
        success = create_admin(db_url, username, email, password, force=True)
        if success:
            print(f"✅ Admin user '{username}' is ready")
        else:
            print(f"⚠️  Admin user '{username}' creation skipped")
    except Exception as e:
        print(f"❌ Error ensuring admin user: {e}")
        # Don't fail the startup
        pass

if __name__ == "__main__":
    main()