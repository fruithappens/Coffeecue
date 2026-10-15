#!/usr/bin/env python3
"""
Create or update barista user with password barista123
"""
from werkzeug.security import generate_password_hash
from utils.database import get_db_connection, close_connection
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_or_update_barista():
    """Create or update barista user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if user exists
        cursor.execute('SELECT id FROM users WHERE username = %s', ('barista',))
        existing = cursor.fetchone()
        
        # Generate password hash
        password_hash = generate_password_hash('barista123')
        
        if existing:
            # Update existing user
            cursor.execute('''
                UPDATE users 
                SET password_hash = %s,
                    full_name = %s,
                    email = %s,
                    role = %s,
                    failed_login_attempts = 0,
                    account_locked = FALSE
                WHERE username = %s
            ''', (password_hash, 'Barista User', 'barista@example.com', 'barista', 'barista'))
            logger.info(f"Updated barista user (ID: {existing[0]})")
        else:
            # Create new user
            cursor.execute('''
                INSERT INTO users (username, password_hash, full_name, email, role)
                VALUES (%s, %s, %s, %s, %s)
            ''', ('barista', password_hash, 'Barista User', 'barista@example.com', 'barista'))
            logger.info("Created new barista user")
        
        conn.commit()
        logger.info("✅ Barista user ready with password: barista123")
        
    except Exception as e:
        logger.error(f"Error creating/updating barista user: {str(e)}")
        conn.rollback()
        raise
    finally:
        cursor.close()
        close_connection(conn)

if __name__ == "__main__":
    create_or_update_barista()