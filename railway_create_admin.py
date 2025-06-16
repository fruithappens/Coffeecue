#!/usr/bin/env python3
"""
Script to create admin user on Railway PostgreSQL database
Run this locally but it connects to Railway's database
"""

import os
import sys
import subprocess

# Get Railway database URL from environment or command line
RAILWAY_DATABASE_URL = os.getenv('RAILWAY_DATABASE_URL')

if not RAILWAY_DATABASE_URL and len(sys.argv) > 1:
    RAILWAY_DATABASE_URL = sys.argv[1]

if not RAILWAY_DATABASE_URL:
    print("ERROR: Please provide Railway DATABASE_URL")
    print("Usage: python railway_create_admin.py <RAILWAY_DATABASE_URL>")
    print("Or set RAILWAY_DATABASE_URL environment variable")
    sys.exit(1)

# Run create_admin.py with Railway database URL
cmd = [
    'python3', 'create_admin.py',
    RAILWAY_DATABASE_URL,
    'coffeecue',
    'admin@coffeecue.com',
    'adminpassword',
    '--force'
]

print("Creating admin user on Railway database...")
print(f"Database URL: {RAILWAY_DATABASE_URL.split('@')[1]}")  # Hide credentials in output

result = subprocess.run(cmd, capture_output=True, text=True)

if result.returncode == 0:
    print("\n✅ SUCCESS!")
    print(result.stdout)
else:
    print("\n❌ ERROR!")
    print(result.stderr)
    sys.exit(1)