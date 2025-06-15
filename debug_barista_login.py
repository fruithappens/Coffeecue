#!/usr/bin/env python3
"""
Debug barista login issue
"""
from werkzeug.security import check_password_hash, generate_password_hash
from utils.database import get_db_connection, close_connection
import hashlib

def debug_barista_login():
    """Debug why barista login is failing"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Get barista user details
        cursor.execute('SELECT id, username, password_hash, role FROM users WHERE username = %s', ('barista',))
        user = cursor.fetchone()
        
        if not user:
            print("❌ Barista user not found!")
            return
            
        user_id, username, password_hash, role = user
        print(f"✅ Found user: {username} (ID: {user_id}, Role: {role})")
        print(f"📝 Password hash: {password_hash[:50]}...")
        
        # Test password verification
        test_password = 'barista123'
        
        # Check if it's a werkzeug hash
        if password_hash and any(password_hash.startswith(prefix) for prefix in ['pbkdf2:', 'scrypt:', 'argon2:']):
            result = check_password_hash(password_hash, test_password)
            print(f"🔐 Werkzeug password check: {result}")
        elif password_hash and ':' in password_hash and len(password_hash.split(':', 1)) == 2:
            # Legacy salt:hash format
            salt, hash_value = password_hash.split(':', 1)
            computed_hash = hashlib.sha256(f"{test_password}{salt}".encode()).hexdigest()
            result = computed_hash == hash_value
            print(f"🔐 Legacy password check: {result}")
            print(f"   Expected: {hash_value}")
            print(f"   Computed: {computed_hash}")
        else:
            # Try werkzeug anyway
            try:
                result = check_password_hash(password_hash, test_password)
                print(f"🔐 Default password check: {result}")
            except Exception as e:
                print(f"❌ Password check failed: {str(e)}")
                
        # Try updating with a fresh password hash
        print("\n🔧 Generating fresh password hash...")
        new_hash = generate_password_hash(test_password)
        print(f"📝 New hash: {new_hash[:50]}...")
        
        # Test the new hash
        verify = check_password_hash(new_hash, test_password)
        print(f"🔐 New hash verification: {verify}")
        
        # Update the user with new hash
        cursor.execute('UPDATE users SET password_hash = %s WHERE id = %s', (new_hash, user_id))
        conn.commit()
        print("✅ Updated user with new password hash")
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        cursor.close()
        close_connection(conn)

if __name__ == "__main__":
    debug_barista_login()