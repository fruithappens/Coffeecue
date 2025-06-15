"""
Configuration settings for the Expresso Coffee Ordering System
"""
import os
import hashlib
import random
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Application name and branding
EVENT_NAME = os.getenv('EVENT_NAME', 'ANZCA ASM 2025 Cairns')
APP_VERSION = '1.2.0'

# Database configuration
# PostgreSQL Database URL format: postgresql://username:password@host:port/database
DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost/expresso')

# Database connection pool settings
DB_POOL_MIN_CONNECTIONS = int(os.getenv('DB_POOL_MIN_CONNECTIONS', 1))
DB_POOL_MAX_CONNECTIONS = int(os.getenv('DB_POOL_MAX_CONNECTIONS', 10))

# PostgreSQL specific settings
PG_SCHEMA = os.getenv('PG_SCHEMA', 'public')
PG_SSL_MODE = os.getenv('PG_SSL_MODE', 'prefer')  # require, verify-ca, verify-full
PG_MAX_RETRIES = int(os.getenv('PG_MAX_RETRIES', 3))

# SMS and Twilio configuration
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')
TESTING_MODE = os.getenv('TESTING_MODE', 'False').lower() == 'true'

# Flask configuration
SECRET_KEY = os.getenv('SECRET_KEY', hashlib.sha256(os.urandom(32)).hexdigest())
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
PORT = int(os.getenv('PORT', 5001))  # Changed from default 5000 to avoid macOS AirPlay conflict

# JWT Configuration
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', SECRET_KEY)
JWT_ACCESS_TOKEN_EXPIRES = int(os.getenv('JWT_ACCESS_TOKEN_EXPIRES', 3600))  # 1 hour in seconds
JWT_REFRESH_TOKEN_EXPIRES = int(os.getenv('JWT_REFRESH_TOKEN_EXPIRES', 2592000))  # 30 days in seconds
JWT_COOKIE_SECURE = os.getenv('JWT_COOKIE_SECURE', 'False').lower() == 'true'
JWT_COOKIE_CSRF_PROTECT = os.getenv('JWT_COOKIE_CSRF_PROTECT', 'False').lower() == 'true'

# CORS Configuration
CORS_ALLOWED_ORIGINS = os.getenv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',')
CORS_SUPPORTS_CREDENTIALS = os.getenv('CORS_SUPPORTS_CREDENTIALS', 'True').lower() == 'true'

# System settings
MAX_QUEUE_SIZE = int(os.getenv('MAX_QUEUE_SIZE', 50))
RUSH_THRESHOLD = int(os.getenv('RUSH_THRESHOLD', 10))
NUM_STATIONS = int(os.getenv('NUM_STATIONS', 3))

# Loyalty program settings
LOYALTY_POINTS_PER_ORDER = int(os.getenv('LOYALTY_POINTS_PER_ORDER', 10))
LOYALTY_POINTS_FOR_FREE_COFFEE = int(os.getenv('LOYALTY_POINTS_FOR_FREE_COFFEE', 100))
LOYALTY_BONUS_FEEDBACK = int(os.getenv('LOYALTY_BONUS_FEEDBACK', 5))

# Password policy settings
PASSWORD_MIN_LENGTH = int(os.getenv('PASSWORD_MIN_LENGTH', 8))
PASSWORD_REQUIRE_SPECIAL = os.getenv('PASSWORD_REQUIRE_SPECIAL', 'True').lower() == 'true'

# Payment processing configuration
STRIPE_API_KEY = os.getenv('STRIPE_API_KEY')
STRIPE_WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET')

# Default access codes
DEFAULT_VIP_CODE = os.getenv('DEFAULT_VIP_CODE', ''.join(random.choices('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k=6)))
DEFAULT_STAFF_CODE = os.getenv('DEFAULT_STAFF_CODE', ''.join(random.choices('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k=6)))

# Default admin credentials
DEFAULT_ADMIN_USERNAME = os.getenv('DEFAULT_ADMIN_USERNAME', 'admin')
DEFAULT_ADMIN_EMAIL = os.getenv('DEFAULT_ADMIN_EMAIL', 'admin@example.com')
DEFAULT_ADMIN_PASSWORD = os.getenv('DEFAULT_ADMIN_PASSWORD', 'coffee123')  # FOR DEVELOPMENT ONLY - change in production

# Default system messages
DEFAULT_MESSAGES = {
    'station_closed': 'Sorry, our coffee stations are currently closed. We will open again at {open_time}. Text "VIP" if you have VIP access.',
    'preorder_confirmation': 'Your coffee will be ready for pickup at {time}',
    'loyalty_redemption': 'You\'ve used {points} points to redeem a free coffee!'
}

# Email configuration for password reset
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.example.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USERNAME = os.getenv('SMTP_USERNAME', '')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD', '')
FROM_EMAIL = os.getenv('FROM_EMAIL', 'noreply@example.com')
EMAIL_ENABLED = os.getenv('EMAIL_ENABLED', 'False').lower() == 'true'