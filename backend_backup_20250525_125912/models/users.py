"""
User models for Expresso Coffee Ordering System
Compatible with PostgreSQL database
"""
import logging
import re
import hashlib
import secrets
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("expresso.models.users")

class User:
    """
    Model for user management with PostgreSQL support
    Handles all user operations including authentication
    """
    
    @classmethod
    def create_tables(cls, db):
        """Create tables if they don't exist"""
        cursor = db.cursor()
        
        # Create users table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) NOT NULL,
            full_name VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP,
            reset_token TEXT,
            reset_token_expiry TIMESTAMP,
            station_id INTEGER,
            failed_login_attempts INTEGER DEFAULT 0,
            account_locked BOOLEAN DEFAULT FALSE,
            account_locked_until TIMESTAMP,
            last_password_change TIMESTAMP
        )
        ''')
        
        # Create user_permissions table
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_permissions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission_name VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, permission_name)
        )
        ''')
        
        db.commit()
        logger.info("User tables created or already exist")
    
    @staticmethod
    def hash_password(password):
        """
        Generate a secure password hash with salt
        
        Args:
            password: Plain text password
            
        Returns:
            Hashed password string with salt
        """
        if isinstance(password, bytes):
            password = password.decode('utf-8')
            
        salt = secrets.token_hex(16)
        password_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
        return f"{salt}:{password_hash}"
    
    @staticmethod
    def verify_password(password, password_hash):
        """
        Verify a password against a hash
        
        Args:
            password: Plain text password to verify
            password_hash: Stored hashed password
            
        Returns:
            True if password matches, False otherwise
        """
        try:
            if isinstance(password, bytes):
                password = password.decode('utf-8')
                
            # Split stored hash into salt and hash
            salt, stored_hash = password_hash.split(':', 1)
            
            # Generate hash of provided password with same salt
            calculated_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
            
            # Check if hashes match
            return secrets.compare_digest(calculated_hash, stored_hash)
        except Exception as e:
            logger.error(f"Error verifying password: {str(e)}")
            return False
    
    @classmethod
    def create(cls, db, username, email, password, role='user', full_name=None):
        """
        Create a new user
        
        Args:
            db: Database connection
            username: Username
            email: Email address
            password: Plain text password
            role: User role (default: 'user')
            full_name: Full name (optional)
            
        Returns:
            User ID if successful, None otherwise
        """
        try:
            # Validate inputs
            if not username or not email or not password:
                return None
                
            # Check if username or email already exists
            cursor = db.cursor()
            cursor.execute(
                "SELECT id FROM users WHERE username = %s OR email = %s",
                (username, email)
            )
            if cursor.fetchone():
                logger.warning(f"User already exists: {username} or {email}")
                return None
                
            # Hash password
            password_hash = cls.hash_password(password)
            
            # Create user
            cursor.execute('''
                INSERT INTO users (
                    username, email, password_hash, role, full_name, created_at, last_password_change
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            ''', (
                username, email, password_hash, role, full_name, 
                datetime.now(), datetime.now()
            ))
            
            user_id = cursor.fetchone()[0]
            db.commit()
            
            logger.info(f"Created user {username} with role {role}")
            return user_id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating user: {str(e)}")
            return None
    
    @classmethod
    def get_by_id(cls, db, user_id):
        """
        Get user by ID
        
        Args:
            db: Database connection
            user_id: User ID
            
        Returns:
            User dictionary if found, None otherwise
        """
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT * FROM users WHERE id = %s", 
            (user_id,)
        )
        user = cursor.fetchone()
        return user
    
    @classmethod
    def get_by_username(cls, db, username):
        """
        Get user by username
        
        Args:
            db: Database connection
            username: Username
            
        Returns:
            User dictionary if found, None otherwise
        """
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT * FROM users WHERE username = %s", 
            (username,)
        )
        user = cursor.fetchone()
        return user
    
    @classmethod
    def get_by_email(cls, db, email):
        """
        Get user by email
        
        Args:
            db: Database connection
            email: Email address
            
        Returns:
            User dictionary if found, None otherwise
        """
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT * FROM users WHERE email = %s", 
            (email,)
        )
        user = cursor.fetchone()
        return user
    
    @classmethod
    def update(cls, db, user_id, **updates):
        """
        Update user details
        
        Args:
            db: Database connection
            user_id: User ID
            **updates: Fields to update
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Build SET clause
            set_clause = []
            values = []
            
            for key, value in updates.items():
                # Skip password - must use change_password
                if key == 'password':
                    continue
                    
                # Handle special fields
                if key == 'password_hash' and 'password' in updates:
                    continue
                    
                set_clause.append(f"{key} = %s")
                values.append(value)
            
            if not set_clause:
                logger.warning("No fields to update")
                return False
                
            # Add user_id to values
            values.append(user_id)
            
            # Update user
            cursor = db.cursor()
            cursor.execute(f'''
                UPDATE users 
                SET {', '.join(set_clause)}
                WHERE id = %s
            ''', values)
            
            db.commit()
            logger.info(f"Updated user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating user: {str(e)}")
            return False
    
    @classmethod
    def change_password(cls, db, user_id, new_password):
        """
        Change user password
        
        Args:
            db: Database connection
            user_id: User ID
            new_password: New password
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Hash new password
            password_hash = cls.hash_password(new_password)
            
            # Update password
            cursor = db.cursor()
            cursor.execute('''
                UPDATE users 
                SET password_hash = %s, last_password_change = %s
                WHERE id = %s
            ''', (password_hash, datetime.now(), user_id))
            
            db.commit()
            logger.info(f"Changed password for user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error changing password: {str(e)}")
            return False
    
    @classmethod
    def delete(cls, db, user_id):
        """
        Delete a user
        
        Args:
            db: Database connection
            user_id: User ID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute("DELETE FROM users WHERE id = %s", (user_id,))
            db.commit()
            logger.info(f"Deleted user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error deleting user: {str(e)}")
            return False
    
    @classmethod
    def generate_reset_token(cls, db, email):
        """
        Generate a password reset token
        
        Args:
            db: Database connection
            email: User email
            
        Returns:
            Reset token if user found, None otherwise
        """
        try:
            # Find user by email
            cursor = db.cursor()
            cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
            user = cursor.fetchone()
            
            if not user:
                logger.warning(f"User with email {email} not found")
                return None
                
            user_id = user[0]
            
            # Generate token
            token = secrets.token_urlsafe(32)
            expiry = datetime.now() + timedelta(hours=24)
            
            # Save token and expiry
            cursor.execute('''
                UPDATE users 
                SET reset_token = %s, reset_token_expiry = %s
                WHERE id = %s
            ''', (token, expiry, user_id))
            
            db.commit()
            logger.info(f"Generated reset token for user {user_id}")
            return token
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error generating reset token: {str(e)}")
            return None
    
    @classmethod
    def verify_reset_token(cls, db, token):
        """
        Verify a password reset token
        
        Args:
            db: Database connection
            token: Reset token
            
        Returns:
            User ID if token is valid, None otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('''
                SELECT id FROM users 
                WHERE reset_token = %s AND reset_token_expiry > %s
            ''', (token, datetime.now()))
            
            user = cursor.fetchone()
            return user[0] if user else None
            
        except Exception as e:
            logger.error(f"Error verifying reset token: {str(e)}")
            return None
    
    @classmethod
    def complete_password_reset(cls, db, token, new_password):
        """
        Complete password reset and clear token
        
        Args:
            db: Database connection
            token: Reset token
            new_password: New password
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Verify token
            user_id = cls.verify_reset_token(db, token)
            if not user_id:
                logger.warning("Invalid or expired token")
                return False
                
            # Hash new password
            password_hash = cls.hash_password(new_password)
            
            # Update password and clear token
            cursor = db.cursor()
            cursor.execute('''
                UPDATE users 
                SET password_hash = %s, reset_token = NULL, reset_token_expiry = NULL,
                    last_password_change = %s
                WHERE id = %s
            ''', (password_hash, datetime.now(), user_id))
            
            db.commit()
            logger.info(f"Reset password for user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error resetting password: {str(e)}")
            return False
    
    @classmethod
    def get_permissions(cls, db, user_id):
        """
        Get permissions for a user
        
        Args:
            db: Database connection
            user_id: User ID
            
        Returns:
            List of permission names
        """
        try:
            cursor = db.cursor()
            cursor.execute(
                "SELECT permission_name FROM user_permissions WHERE user_id = %s", 
                (user_id,)
            )
            
            permissions = [row[0] for row in cursor.fetchall()]
            return permissions
            
        except Exception as e:
            logger.error(f"Error getting permissions: {str(e)}")
            return []
    
    @classmethod
    def add_permission(cls, db, user_id, permission_name):
        """
        Add a permission to a user
        
        Args:
            db: Database connection
            user_id: User ID
            permission_name: Permission name
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('''
                INSERT INTO user_permissions (user_id, permission_name)
                VALUES (%s, %s)
                ON CONFLICT (user_id, permission_name) DO NOTHING
            ''', (user_id, permission_name))
            
            db.commit()
            logger.info(f"Added permission {permission_name} to user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error adding permission: {str(e)}")
            return False
    
    @classmethod
    def remove_permission(cls, db, user_id, permission_name):
        """
        Remove a permission from a user
        
        Args:
            db: Database connection
            user_id: User ID
            permission_name: Permission name
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('''
                DELETE FROM user_permissions 
                WHERE user_id = %s AND permission_name = %s
            ''', (user_id, permission_name))
            
            db.commit()
            logger.info(f"Removed permission {permission_name} from user {user_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error removing permission: {str(e)}")
            return False

# Add compatibility alias
AdminUser = User

# Settings model for system settings
class Settings:
    """Model for system settings"""
    
    @classmethod
    def get(cls, db, key, default=None):
        """
        Get a setting value
        
        Args:
            db: Database connection
            key: Setting key
            default: Default value if setting not found
            
        Returns:
            Setting value or default
        """
        try:
            cursor = db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            result = cursor.fetchone()
            
            if result:
                return result[0]
            else:
                return default
                
        except Exception as e:
            logger.error(f"Error getting setting {key}: {str(e)}")
            return default
    
    @classmethod
    def set(cls, db, key, value, description=None, updated_by=None):
        """
        Set a setting value
        
        Args:
            db: Database connection
            key: Setting key
            value: Setting value
            description: Optional description
            updated_by: Optional username of updater
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            
            # Check if setting exists
            cursor.execute("SELECT 1 FROM settings WHERE key = %s", (key,))
            exists = cursor.fetchone() is not None
            
            if exists:
                # Update existing setting
                if description:
                    cursor.execute('''
                        UPDATE settings 
                        SET value = %s, description = %s, updated_at = %s, updated_by = %s
                        WHERE key = %s
                    ''', (value, description, datetime.now(), updated_by, key))
                else:
                    cursor.execute('''
                        UPDATE settings 
                        SET value = %s, updated_at = %s, updated_by = %s
                        WHERE key = %s
                    ''', (value, datetime.now(), updated_by, key))
            else:
                # Insert new setting
                cursor.execute('''
                    INSERT INTO settings (key, value, description, updated_at, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (key, value, description, datetime.now(), updated_by))
            
            db.commit()
            logger.info(f"Set setting {key} = {value}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error setting {key}: {str(e)}")
            return False
    
    @classmethod
    def delete(cls, db, key):
        """
        Delete a setting
        
        Args:
            db: Database connection
            key: Setting key
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute("DELETE FROM settings WHERE key = %s", (key,))
            db.commit()
            
            logger.info(f"Deleted setting {key}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error deleting setting {key}: {str(e)}")
            return False
    
    @classmethod
    def get_all(cls, db):
        """
        Get all settings
        
        Args:
            db: Database connection
            
        Returns:
            Dictionary of settings
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT key, value, description FROM settings")
            settings = {}
            
            for row in cursor.fetchall():
                settings[row['key']] = {
                    'value': row['value'],
                    'description': row['description']
                }
            
            return settings
            
        except Exception as e:
            logger.error(f"Error getting all settings: {str(e)}")
            return {}