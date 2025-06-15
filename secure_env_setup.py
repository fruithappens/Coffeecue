#!/usr/bin/env python3
"""
Security Configuration Script
Generates secure keys and helps manage environment variables
"""
import secrets
import os
import sys
from pathlib import Path

def generate_secure_key(length=32):
    """Generate a cryptographically secure random key"""
    return secrets.token_hex(length)

def main():
    print("🔐 Expresso Security Configuration")
    print("=" * 50)
    
    # Check if .env exists
    env_path = Path(".env")
    env_backup_path = Path(".env.backup")
    
    if env_path.exists():
        print("⚠️  WARNING: .env file exists with exposed credentials!")
        print("Creating backup at .env.backup...")
        
        # Create backup
        with open(env_path, 'r') as f:
            content = f.read()
        with open(env_backup_path, 'w') as f:
            f.write(content)
        print("✅ Backup created")
    
    # Generate secure keys
    print("\n🔑 Generating secure keys...")
    secret_key = generate_secure_key(32)
    jwt_secret = generate_secure_key(32)
    
    print(f"\nSECRET_KEY={secret_key}")
    print(f"JWT_SECRET_KEY={jwt_secret}")
    
    # Create secure .env template
    secure_env_content = f"""# SECURITY: This file contains sensitive data - NEVER commit to version control!
# Add .env to .gitignore immediately

# Flask Configuration
SECRET_KEY={secret_key}
FLASK_ENV=production

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/expresso
DB_PATH=coffee_orders.db

# Twilio Configuration - USE ENVIRONMENT VARIABLES IN PRODUCTION!
# Set these as environment variables on your deployment platform:
# export TWILIO_ACCOUNT_SID="your_actual_sid"
# export TWILIO_AUTH_TOKEN="your_actual_token"
# export TWILIO_PHONE_NUMBER="your_actual_number"
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# JWT Configuration
JWT_SECRET_KEY={jwt_secret}
JWT_ACCESS_TOKEN_EXPIRES=900
JWT_REFRESH_TOKEN_EXPIRES=604800
JWT_COOKIE_SECURE=True
JWT_COOKIE_CSRF_PROTECT=True

# Security Settings
DEBUG=False
TESTING_MODE=False
PASSWORD_MIN_LENGTH=12
PASSWORD_REQUIRE_SPECIAL=True

# CORS Configuration - Update with your actual domain
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
CORS_SUPPORTS_CREDENTIALS=True

# Database Connection Pool
DB_POOL_MIN_CONNECTIONS=1
DB_POOL_MAX_CONNECTIONS=10
PG_SSL_MODE=prefer
PG_MAX_RETRIES=3

# Application Settings
PORT=5001
LOG_LEVEL=INFO

# Default Admin - CHANGE AFTER FIRST LOGIN
DEFAULT_ADMIN_USERNAME=coffeecue
DEFAULT_ADMIN_EMAIL=admin@coffeecue.com
DEFAULT_ADMIN_PASSWORD=adminpassword
"""
    
    print("\n📝 Creating secure .env template...")
    with open(".env.secure", 'w') as f:
        f.write(secure_env_content)
    
    print("✅ Created .env.secure with generated keys")
    
    # Instructions
    print("\n📋 Next Steps:")
    print("1. Copy your Twilio credentials to a secure location")
    print("2. Set them as environment variables:")
    print("   export TWILIO_ACCOUNT_SID='your_sid'")
    print("   export TWILIO_AUTH_TOKEN='your_token'")
    print("   export TWILIO_PHONE_NUMBER='your_number'")
    print("3. Replace .env with .env.secure:")
    print("   mv .env.secure .env")
    print("4. Update your deployment platform with these environment variables")
    print("5. NEVER commit .env to version control!")
    
    # Check .gitignore
    gitignore_path = Path(".gitignore")
    if gitignore_path.exists():
        with open(gitignore_path, 'r') as f:
            content = f.read()
        if '.env' not in content:
            print("\n⚠️  WARNING: .env is not in .gitignore!")
            print("Adding .env to .gitignore...")
            with open(gitignore_path, 'a') as f:
                f.write("\n# Environment variables\n.env\n.env.local\n.env.*.local\n")
            print("✅ Added .env to .gitignore")

if __name__ == "__main__":
    main()