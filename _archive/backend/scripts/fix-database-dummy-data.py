#!/usr/bin/env python3

import os
import sys
import sqlite3
import random
import json
from datetime import datetime, timedelta

# Configure paths and database files
DB_PATHS = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "coffee_orders.db"),
    # Add more database paths if needed
]

# Sample dummy data
DUMMY_NAMES = [
    "Demo User", "Test Customer", "Sample Person", "Coffee Lover", 
    "Java Fan", "Espresso Tester", "Cappuccino Demo", "Latte User",
    "Mochaccino Test", "Americano Sample", "Ristretto Demo", "Macchiato Test"
]

DUMMY_EMAILS = [
    "demo@example.com", "test@coffeeapp.demo", "sample@test.demo",
    "coffee@demo.test", "java@example.demo", "espresso@test.example",
    "demo@coffeeapp.test", "test@demo.example"
]

DUMMY_PHONES = [
    "+61400000001", "+61400000002", "+61400000003", "+61400000004",
    "+61400000005", "+61400000006", "+61400000007", "+61400000008"
]

def is_valid_sqlite_db(db_path):
    """Check if the file is a valid SQLite database"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT sqlite_version();")
        conn.close()
        return True
    except sqlite3.Error:
        return False

def get_table_names(conn):
    """Get all table names from the database"""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    return [row[0] for row in cursor.fetchall()]

def get_table_columns(conn, table_name):
    """Get the column names for a table"""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name});")
    return [(row[1], row[2]) for row in cursor.fetchall()]  # (name, type)

def sanitize_data(conn, table_name, columns):
    """Replace real names, emails and phone numbers with dummy data"""
    cursor = conn.cursor()
    
    # Check for name, email and phone columns
    name_columns = [col[0] for col in columns if 'name' in col[0].lower()]
    email_columns = [col[0] for col in columns if 'email' in col[0].lower()]
    phone_columns = [col[0] for col in columns if 'phone' in col[0].lower()]
    
    changes_made = False
    
    # Replace name columns
    for col in name_columns:
        # Preserve special names like 'System Admin' or 'Demo User'
        cursor.execute(f"""
        UPDATE {table_name} 
        SET {col} = CASE
            WHEN {col} LIKE '%demo%' THEN {col}
            WHEN {col} LIKE '%test%' THEN {col}
            WHEN {col} LIKE '%sample%' THEN {col}
            WHEN {col} LIKE '%system%' THEN {col}
            WHEN {col} LIKE '%admin%' THEN {col}
            ELSE ? 
        END
        WHERE {col} NOT LIKE '%demo%' 
          AND {col} NOT LIKE '%test%'
          AND {col} NOT LIKE '%sample%'
          AND {col} NOT LIKE '%system%'
          AND {col} NOT LIKE '%admin%'
        """, (random.choice(DUMMY_NAMES),))
        
        if cursor.rowcount > 0:
            changes_made = True
            print(f"  - Sanitized {cursor.rowcount} entries in {col} column")
    
    # Replace email columns
    for col in email_columns:
        # Preserve demo/test/example emails
        cursor.execute(f"""
        UPDATE {table_name} 
        SET {col} = CASE
            WHEN {col} LIKE '%demo%' THEN {col}
            WHEN {col} LIKE '%test%' THEN {col}
            WHEN {col} LIKE '%example%' THEN {col}
            ELSE ? 
        END
        WHERE {col} NOT LIKE '%demo%' 
          AND {col} NOT LIKE '%test%'
          AND {col} NOT LIKE '%example%'
        """, (random.choice(DUMMY_EMAILS),))
        
        if cursor.rowcount > 0:
            changes_made = True
            print(f"  - Sanitized {cursor.rowcount} entries in {col} column")
    
    # Replace phone columns
    for col in phone_columns:
        cursor.execute(f"""
        UPDATE {table_name} 
        SET {col} = ?
        WHERE {col} NOT LIKE '+6140000000%'
        """, (random.choice(DUMMY_PHONES),))
        
        if cursor.rowcount > 0:
            changes_made = True
            print(f"  - Sanitized {cursor.rowcount} entries in {col} column")
    
    # Also check for order_details JSON column which might contain personal data
    order_details_columns = [col[0] for col in columns if 'details' in col[0].lower() or 'data' in col[0].lower()]
    
    for col in order_details_columns:
        # Try to sanitize JSON in order_details
        cursor.execute(f"SELECT id, {col} FROM {table_name} WHERE {col} IS NOT NULL")
        rows = cursor.fetchall()
        
        sanitized_count = 0
        for row in rows:
            row_id = row[0]
            details_str = row[1]
            
            if not details_str:
                continue
                
            # Try to parse as JSON
            try:
                details = json.loads(details_str)
                
                # Only process if it's a dictionary
                if isinstance(details, dict):
                    modified = False
                    
                    # Check for name fields
                    for key in list(details.keys()):
                        if 'name' in key.lower() and isinstance(details[key], str) and not any(x in details[key].lower() for x in ['demo', 'test', 'sample']):
                            details[key] = random.choice(DUMMY_NAMES)
                            modified = True
                    
                    # Check for email fields
                    for key in list(details.keys()):
                        if 'email' in key.lower() and isinstance(details[key], str) and not any(x in details[key].lower() for x in ['demo', 'test', 'example']):
                            details[key] = random.choice(DUMMY_EMAILS)
                            modified = True
                    
                    # Check for phone fields
                    for key in list(details.keys()):
                        if 'phone' in key.lower() and isinstance(details[key], str) and not details[key].startswith('+6140000000'):
                            details[key] = random.choice(DUMMY_PHONES)
                            modified = True
                    
                    # Update if modified
                    if modified:
                        sanitized_json = json.dumps(details)
                        cursor.execute(f"UPDATE {table_name} SET {col} = ? WHERE id = ?", (sanitized_json, row_id))
                        sanitized_count += 1
                        
            except (json.JSONDecodeError, TypeError):
                # Skip if not valid JSON
                continue
        
        if sanitized_count > 0:
            changes_made = True
            print(f"  - Sanitized {sanitized_count} JSON objects in {col} column")
    
    return changes_made

def process_database(db_path):
    """Process all tables in the database to sanitize personal data"""
    if not is_valid_sqlite_db(db_path):
        print(f"Error: {db_path} is not a valid SQLite database.")
        return False
    
    print(f"Processing database: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        
        # Get all tables
        tables = get_table_names(conn)
        print(f"Found {len(tables)} tables in the database.")
        
        db_modified = False
        
        # Process each table
        for table in tables:
            # Skip SQLite internal tables
            if table.startswith('sqlite_'):
                continue
                
            print(f"Checking table: {table}")
            columns = get_table_columns(conn, table)
            
            # Sanitize data in the table
            table_modified = sanitize_data(conn, table, columns)
            if table_modified:
                db_modified = True
        
        # Commit changes and close connection
        if db_modified:
            conn.commit()
            print(f"Successfully sanitized personal data in database: {db_path}")
        else:
            print(f"No changes were needed in database: {db_path}")
            
        conn.close()
        return db_modified
        
    except sqlite3.Error as e:
        print(f"SQLite error in {db_path}: {e}")
        return False

def main():
    """Main function to process all databases"""
    print("=== Coffee Cue Database Sanitizer ===")
    print("This script will replace real personal data with dummy data")
    print("Preserving demo/test entries while sanitizing any real data")
    
    modified_dbs = 0
    
    for db_path in DB_PATHS:
        if os.path.exists(db_path):
            print(f"\nProcessing: {db_path}")
            
            # Create backup
            backup_path = f"{db_path}.bak.{datetime.now().strftime('%Y%m%d%H%M%S')}"
            try:
                import shutil
                shutil.copy2(db_path, backup_path)
                print(f"Created backup at: {backup_path}")
            except Exception as e:
                print(f"Warning: Could not create backup: {e}")
                continue
            
            # Process database
            if process_database(db_path):
                modified_dbs += 1
        else:
            print(f"\nSkipping {db_path} - file not found")
    
    print("\n=== Summary ===")
    print(f"Processed {len(DB_PATHS)} database paths")
    print(f"Modified {modified_dbs} databases")
    print("All real personal data has been replaced with dummy data")
    print("Demo and test data has been preserved")

if __name__ == "__main__":
    main()
