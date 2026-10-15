#!/usr/bin/env python3
"""
Script to create users with proper werkzeug password hashes
"""
import psycopg2
from werkzeug.security import generate_password_hash

def main():
    try:
        # Connect to database
        conn = psycopg2.connect(
            host='localhost',
            database='expresso',
            user='stevewf'
        )
        cursor = conn.cursor()

        print('=== Creating users with proper werkzeug password hashes ===')

        # Create or update barista user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('barista',))
        if cursor.fetchone():
            print('Updating barista user password...')
            password_hash = generate_password_hash('barista123')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'barista')
            )
        else:
            print('Creating barista user...')
            password_hash = generate_password_hash('barista123')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('barista', password_hash, 'barista')
            )

        # Create or update admin user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('admin',))
        if cursor.fetchone():
            print('Updating admin user password...')
            password_hash = generate_password_hash('admin123')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'admin')
            )
        else:
            print('Creating admin user...')
            password_hash = generate_password_hash('admin123')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('admin', password_hash, 'admin')
            )

        # Create or update coffeecue user
        cursor.execute('SELECT id FROM users WHERE username = %s', ('coffeecue',))
        if cursor.fetchone():
            print('Updating coffeecue user password...')
            password_hash = generate_password_hash('adminpassword')
            cursor.execute(
                'UPDATE users SET password_hash = %s WHERE username = %s',
                (password_hash, 'coffeecue')
            )
        else:
            print('Creating coffeecue user...')
            password_hash = generate_password_hash('adminpassword')
            cursor.execute(
                'INSERT INTO users (username, password_hash, role) VALUES (%s, %s, %s)',
                ('coffeecue', password_hash, 'admin')
            )

        conn.commit()
        print('\n✅ All users updated with proper werkzeug password hashes!')
        
        print('\n=== Available login credentials ===')
        print('Username: barista, Password: barista123, Role: barista')
        print('Username: admin, Password: admin123, Role: admin') 
        print('Username: coffeecue, Password: adminpassword, Role: admin')

        # Test one hash to make sure it works
        test_hash = generate_password_hash('barista123')
        print(f'\nExample hash format: {test_hash[:50]}...')

        cursor.close()
        conn.close()

    except Exception as e:
        print(f'Error: {e}')
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()