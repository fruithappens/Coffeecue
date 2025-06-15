import sqlite3
import hashlib
from datetime import datetime

DB_PATH = "coffee_orders.db"

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def reset_admin():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Insert or replace an admin user
    admin_username = "admin"
    admin_password = "admin123"  # Change this after login
    hashed_password = hash_password(admin_password)

    # Get the current timestamp for created_at and last_password_change
    current_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    cursor.execute('''
        INSERT OR REPLACE INTO admin_users (id, username, password_hash, role, created_at, last_password_change)
        VALUES (1, ?, ?, 'admin', ?, ?)
    ''', (admin_username, hashed_password, current_time, current_time))

    conn.commit()
    conn.close()
    print("Admin reset successful. Login with username: admin and password: admin123")

if __name__ == "__main__":
    reset_admin()