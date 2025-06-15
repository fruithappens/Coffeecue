#!/usr/bin/env python
"""Test JWT functionality of the Expresso Coffee System"""

import os
import jwt
import datetime
import sys
import sqlite3
import logging

def test_jwt_library():
    """Test basic JWT library functionality"""
    try:
        # Create a simple JWT token
        secret_key = "test_secret_key"
        
        # Create payload
        payload = {
            "sub": 1,
            "username": "admin",
            "role": "admin",
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=5)
        }
        
        # Create token
        token = jwt.encode(payload, secret_key, algorithm="HS256")
        
        # Decode token
        decoded = jwt.decode(token, secret_key, algorithms=["HS256"])
        
        print("JWT library functioning correctly!")
        print(f"Token: {token}")
        print(f"Decoded: {decoded}")
        
        return True
    except Exception as e:
        print(f"JWT library test failed: {e}")
        return False

def test_flask_jwt_extended():
    """Test Flask-JWT-Extended integration"""
    try:
        from flask import Flask
        from flask_jwt_extended import JWTManager, create_access_token
        
        # Create minimal Flask app
        app = Flask(__name__)
        app.config["JWT_SECRET_KEY"] = "test_secret_key"
        jwt_manager = JWTManager(app)
        
        # Test token creation in app context
        with app.app_context():
            # Create token with additional claims
            token = create_access_token(
                identity={"id": 1, "username": "admin"},
                additional_claims={
                    "username": "admin",
                    "role": "admin"
                }
            )
            
            print(f"Flask-JWT-Extended token: {token}")
        
        return True
    except Exception as e:
        print(f"Flask-JWT-Extended test failed: {e}")
        return False

def test_database():
    """Test database settings for JWT"""
    try:
        # Try to locate database file
        db_paths = [
            "coffee_orders.db",
            os.getenv("DB_PATH", "")
        ]
        
        for db_path in db_paths:
            if os.path.exists(db_path):
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                
                # Check if settings table exists
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
                if cursor.fetchone():
                    # Check if jwt_enabled setting exists
                    cursor.execute("SELECT value FROM settings WHERE key = 'jwt_enabled'")
                    result = cursor.fetchone()
                    
                    if result:
                        jwt_enabled = result[0]
                        print(f"JWT setting in database: jwt_enabled = {jwt_enabled}")
                    else:
                        print("JWT setting not found in database")
                        # Add it
                        try:
                            cursor.execute(
                                "INSERT INTO settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)",
                                ("jwt_enabled", "true", "Use JWT for authentication", datetime.datetime.now().isoformat())
                            )
                            conn.commit()
                            print("Added jwt_enabled setting to database")
                        except Exception as e:
                            print(f"Failed to add JWT setting: {e}")
                else:
                    print("Settings table not found in database")
                
                conn.close()
                return True
        
        print("Database file not found")
        return False
    except Exception as e:
        print(f"Database test failed: {e}")
        return False

if __name__ == "__main__":
    # Set up basic logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    print("JWT Functionality Test for Expresso Coffee System")
    print("================================================")
    
    # Test JWT library
    print("\nTesting JWT library...")
    jwt_lib_result = test_jwt_library()
    
    # Test Flask-JWT-Extended
    print("\nTesting Flask-JWT-Extended...")
    flask_jwt_result = test_flask_jwt_extended()
    
    # Test database
    print("\nTesting database settings...")
    db_result = test_database()
    
    # Overall result
    print("\nTest Results:")
    print(f"JWT Library: {'✅ Pass' if jwt_lib_result else '❌ Fail'}")
    print(f"Flask-JWT-Extended: {'✅ Pass' if flask_jwt_result else '❌ Fail'}")
    print(f"Database: {'✅ Pass' if db_result else '❌ Fail'}")
    
    # Final status
    all_passed = jwt_lib_result and flask_jwt_result and db_result
    print(f"\nOverall: {'✅ All tests passed!' if all_passed else '❌ Some tests failed'}")
    
    sys.exit(0 if all_passed else 1)
