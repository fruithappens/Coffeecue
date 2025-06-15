#!/usr/bin/env python3
"""
Script to check and create test users for login
"""
import psycopg2
import hashlib
import os

def hash_password(password):
    """Simple password hashing"""
    return hashlib.sha256(password.encode()).hexdigest()

def main():
    try:
        # Connect to database
        conn = psycopg2.connect(
            host='localhost',
            database='expresso',
            user='stevewf'
        )
        cursor = conn.cursor()

        print('=== Checking users table ===')
        cursor.execute('SELECT id, username, role FROM users ORDER BY id')
        users = cursor.fetchall()
        
        if users:
            print('Existing users:')
            for user in users:
                print(f'  ID: {user[0]}, Username: {user[1]}, Role: {user[2]}')
        else:
            print('No users found')

        # Create or update barista user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('barista',))
        if cursor.fetchone():
            print('\nUpdating barista user password...')
            password_hash = hash_password('barista123')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'barista')
            )
        else:
            print('\nCreating barista user...')
            password_hash = hash_password('barista123')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('barista', password_hash, 'barista')
            )

        # Create or update admin user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('admin',))
        if cursor.fetchone():
            print('Updating admin user password...')
            password_hash = hash_password('admin123')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'admin')
            )
        else:
            print('Creating admin user...')
            password_hash = hash_password('admin123')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('admin', password_hash, 'admin')
            )

        # Create or update coffeecue user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('coffeecue',))
        if cursor.fetchone():
            print('Updating coffeecue user password...')
            password_hash = hash_password('adminpassword')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'coffeecue')
            )
        else:
            print('Creating coffeecue user...')
            password_hash = hash_password('adminpassword')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('coffeecue', password_hash, 'admin')
            )

        conn.commit()
        print('\n✅ All users updated successfully!')
        
        print('\n=== Available login credentials ===')
        print('Username: barista, Password: barista123, Role: barista')
        print('Username: admin, Password: admin123, Role: admin') 
        print('Username: coffeecue, Password: adminpassword, Role: admin')

        cursor.close()
        conn.close()

    except Exception as e:
        print(f'Error: {e}')

if __name__ == '__main__':
    main()