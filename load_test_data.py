#!/usr/bin/env python
"""
Script to load test data into the Expresso database.
This will create inventory items, stations, and sample orders
to make the frontend fully functional.
"""

import psycopg2
import json
import random
from datetime import datetime, timedelta
import sys
import os

# Configuration - update as needed
DATABASE_URL = "postgresql://stevewf@localhost:5432/expresso"

def create_connection():
    """Create a database connection"""
    try:
        conn = psycopg2.connect(DATABASE_URL)
        print("Successfully connected to database.")
        return conn
    except Exception as e:
        print(f"Error connecting to database: {str(e)}")
        sys.exit(1)

def create_tables(conn):
    """Create required tables if they don't exist"""
    cursor = conn.cursor()
    
    # Create tables for inventory management
    create_inventory_tables_sql = """
    -- Inventory items table
    CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        category VARCHAR(50) NOT NULL,
        amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
        capacity DECIMAL(10, 2) NOT NULL DEFAULT 0,
        unit VARCHAR(20),
        minimum_threshold DECIMAL(10, 2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Inventory alerts table (for low stock reporting)
    CREATE TABLE IF NOT EXISTS inventory_alerts (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES inventory_items(id),
        urgency VARCHAR(20) NOT NULL DEFAULT 'normal',
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP,
        created_by INTEGER
    );
    
    -- Restock requests table
    CREATE TABLE IF NOT EXISTS restock_requests (
        id SERIAL PRIMARY KEY,
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        created_by INTEGER,
        completed_by INTEGER
    );
    
    -- Restock request items
    CREATE TABLE IF NOT EXISTS restock_request_items (
        id SERIAL PRIMARY KEY,
        restock_id INTEGER REFERENCES restock_requests(id),
        item_id INTEGER REFERENCES inventory_items(id),
        requested_amount DECIMAL(10, 2) NOT NULL,
        received_amount DECIMAL(10, 2),
        notes TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Inventory transaction history
    CREATE TABLE IF NOT EXISTS inventory_transactions (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES inventory_items(id),
        amount DECIMAL(10, 2) NOT NULL,
        previous_amount DECIMAL(10, 2) NOT NULL,
        new_amount DECIMAL(10, 2) NOT NULL,
        transaction_type VARCHAR(50) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by INTEGER
    );
    """
    
    # Create station management tables
    create_station_tables_sql = """
    -- Station stats table
    CREATE TABLE IF NOT EXISTS station_stats (
        id SERIAL PRIMARY KEY,
        station_id INTEGER NOT NULL,
        name VARCHAR(100),
        location VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'inactive',
        current_load INTEGER DEFAULT 0,
        wait_time INTEGER DEFAULT 10,
        barista_name VARCHAR(100),
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Station schedule table
    CREATE TABLE IF NOT EXISTS station_schedule (
        id SERIAL PRIMARY KEY,
        station_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL, -- 0=Monday, 6=Sunday
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        break_start TIME,
        break_end TIME,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Rush periods
    CREATE TABLE IF NOT EXISTS rush_periods (
        id SERIAL PRIMARY KEY,
        day_of_week INTEGER NOT NULL, -- 0=Monday, 6=Sunday
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    
    # Create chat messages table
    create_chat_tables_sql = """
    -- Chat messages
    CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        sender VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        is_urgent BOOLEAN DEFAULT FALSE,
        station_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    
    # Create settings table
    create_settings_table_sql = """
    -- Settings
    CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP,
        updated_by VARCHAR(100)
    );
    """
    
    # Create orders tables
    create_orders_tables_sql = """
    -- Orders table
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(20) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        station_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        picked_up_at TIMESTAMP,
        phone VARCHAR(20),
        order_details JSONB,
        queue_priority INTEGER DEFAULT 5
    );
    
    -- Customer preferences
    CREATE TABLE IF NOT EXISTS customer_preferences (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(100),
        favorite_coffee VARCHAR(50),
        favorite_milk VARCHAR(50),
        favorite_sugar VARCHAR(20),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    -- Order messages
    CREATE TABLE IF NOT EXISTS order_messages (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(50) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        message_sid VARCHAR(100),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """
    
    # Create users table if it doesn't exist
    create_users_table_sql = """
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(100) UNIQUE,
        password_hash VARCHAR(200) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'barista',
        full_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        active BOOLEAN DEFAULT TRUE,
        failed_login_attempts INTEGER DEFAULT 0,
        account_locked BOOLEAN DEFAULT FALSE,
        account_locked_until TIMESTAMP
    );
    """
    
    # Execute all table creation SQL
    try:
        cursor.execute(create_inventory_tables_sql)
        cursor.execute(create_station_tables_sql)
        cursor.execute(create_chat_tables_sql)
        cursor.execute(create_settings_table_sql)
        cursor.execute(create_orders_tables_sql)
        cursor.execute(create_users_table_sql)
        conn.commit()
        print("Tables created successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error creating tables: {str(e)}")
        sys.exit(1)
    finally:
        cursor.close()

def truncate_tables(conn, confirm=True):
    """Clear existing data from tables"""
    if confirm:
        answer = input("This will delete ALL existing data. Continue? (y/n): ")
        if answer.lower() != 'y':
            print("Operation cancelled.")
            return False
    
    cursor = conn.cursor()
    
    tables = [
        "inventory_transactions", 
        "restock_request_items",
        "restock_requests", 
        "inventory_alerts", 
        "inventory_items",
        "station_schedule",
        "rush_periods",
        "station_stats", 
        "chat_messages",
        "order_messages",
        "orders",
        "customer_preferences"
    ]
    
    try:
        # Disable foreign key checks
        cursor.execute("SET session_replication_role = 'replica';")
        
        # Truncate tables
        for table in tables:
            cursor.execute(f"TRUNCATE TABLE {table} RESTART IDENTITY CASCADE;")
        
        # Re-enable foreign key checks
        cursor.execute("SET session_replication_role = 'origin';")
        
        conn.commit()
        print("Tables cleared successfully.")
        return True
    except Exception as e:
        conn.rollback()
        print(f"Error clearing tables: {str(e)}")
        return False
    finally:
        cursor.close()

def load_inventory_data(conn):
    """Load inventory test data"""
    cursor = conn.cursor()
    
    inventory_items = [
        # Coffee category
        ("Espresso Beans", "coffee", 2.5, 5.0, "kg", 1.0),
        ("Decaf Beans", "coffee", 1.0, 3.0, "kg", 0.5),
        ("Specialty Blend", "coffee", 0.8, 2.0, "kg", 0.4),
        ("Filter Coffee", "coffee", 1.5, 3.0, "kg", 0.5),
        
        # Milk category
        ("Full Cream Milk", "milk", 4.0, 10.0, "L", 2.0),
        ("Skim Milk", "milk", 3.0, 8.0, "L", 1.5),
        ("Almond Milk", "milk", 1.2, 5.0, "L", 1.0),
        ("Soy Milk", "milk", 2.0, 6.0, "L", 1.0),
        ("Oat Milk", "milk", 0.5, 4.0, "L", 1.0),
        
        # Cups category
        ("Small Cups", "cups", 45, 200, "", 30),
        ("Medium Cups", "cups", 30, 150, "", 25),
        ("Large Cups", "cups", 20, 100, "", 15),
        ("Cup Lids", "cups", 75, 300, "", 50),
        ("Cup Sleeves", "cups", 60, 200, "", 40),
        
        # Syrups category
        ("Vanilla Syrup", "syrups", 0.6, 1.0, "L", 0.3),
        ("Caramel Syrup", "syrups", 0.4, 1.0, "L", 0.3),
        ("Hazelnut Syrup", "syrups", 0.3, 1.0, "L", 0.3),
        
        # Other supplies
        ("Napkins", "other", 150, 500, "", 100),
        ("Stirrers", "other", 80, 300, "", 50),
        ("Sugar Packets", "other", 120, 500, "", 100),
        ("Sweetener Packets", "other", 70, 300, "", 50),
        ("Hot Water", "other", 8.0, 10.0, "L", 2.0)
    ]
    
    # Insert inventory items
    try:
        for item in inventory_items:
            name, category, amount, capacity, unit, min_threshold = item
            cursor.execute("""
                INSERT INTO inventory_items 
                (name, category, amount, capacity, unit, minimum_threshold, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (name, category, amount, capacity, unit, min_threshold, datetime.now(), datetime.now()))
            
            item_id = cursor.fetchone()[0]
            
            # Create some inventory transactions
            transaction_types = ["initial_stock", "usage", "restock"]
            for i in range(random.randint(2, 5)):
                transaction_type = random.choice(transaction_types)
                if transaction_type == "usage":
                    change_amount = -random.uniform(0.1, 0.5)
                else:
                    change_amount = random.uniform(0.5, 2.0)
                
                previous_amount = max(0, amount - change_amount) if change_amount > 0 else amount
                new_amount = previous_amount + change_amount
                
                cursor.execute("""
                    INSERT INTO inventory_transactions
                    (item_id, amount, previous_amount, new_amount, transaction_type, notes, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    item_id, 
                    change_amount, 
                    previous_amount, 
                    new_amount, 
                    transaction_type, 
                    f"Test {transaction_type}", 
                    datetime.now() - timedelta(days=random.randint(1, 7))
                ))
        
        # Create some low stock alerts
        low_stock_items = [3, 5, 8, 12, 15]  # Item IDs to mark as low stock
        urgency_levels = ["low", "normal", "high", "critical"]
        
        for item_id in low_stock_items:
            urgency = random.choice(urgency_levels)
            cursor.execute("""
                INSERT INTO inventory_alerts
                (item_id, urgency, notes, status, created_at)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                item_id,
                urgency,
                f"Running low on item #{item_id}",
                "active",
                datetime.now() - timedelta(hours=random.randint(1, 24))
            ))
        
        # Create a restock request
        cursor.execute("""
            INSERT INTO restock_requests
            (notes, status, created_at, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING id
        """, (
            "Weekly restock request",
            "pending",
            datetime.now() - timedelta(days=1),
            1
        ))
        
        restock_id = cursor.fetchone()[0]
        
        # Add items to the restock request
        for item_id in [1, 5, 10, 15]:
            cursor.execute("""
                INSERT INTO restock_request_items
                (restock_id, item_id, requested_amount, status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                restock_id,
                item_id,
                random.uniform(1.0, 5.0),
                "pending",
                datetime.now() - timedelta(days=1),
                datetime.now() - timedelta(days=1)
            ))
        
        conn.commit()
        print("Inventory data loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error loading inventory data: {str(e)}")
    finally:
        cursor.close()

def load_station_data(conn):
    """Load station test data"""
    cursor = conn.cursor()
    
    station_data = [
        (1, "Main Station", "Front Counter", "active", 2, 8, "Jane Smith"),
        (2, "Express Station", "Side Counter", "active", 1, 5, "John Doe"),
        (3, "Outdoor Station", "Patio", "inactive", 0, 0, None),
        (4, "Event Station", "Conference Area", "maintenance", 0, 0, None)
    ]
    
    # Insert station data
    try:
        for station in station_data:
            station_id, name, location, status, current_load, wait_time, barista_name = station
            cursor.execute("""
                INSERT INTO station_stats
                (station_id, name, location, status, current_load, wait_time, barista_name, last_updated)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                station_id, name, location, status, current_load, wait_time, 
                barista_name, datetime.now()
            ))
        
        # Create station schedules
        days_of_week = list(range(7))  # 0=Monday, 6=Sunday
        
        # Active stations get schedules
        for station_id in [1, 2]:
            # Create weekday schedules
            for day in range(0, 5):  # Monday to Friday
                cursor.execute("""
                    INSERT INTO station_schedule
                    (station_id, day_of_week, start_time, end_time, break_start, break_end, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    station_id,
                    day,
                    "08:00",
                    "16:00",
                    "12:00",
                    "12:30",
                    "Regular weekday shift"
                ))
            
            # Create weekend schedules (shorter hours)
            for day in range(5, 7):  # Saturday and Sunday
                cursor.execute("""
                    INSERT INTO station_schedule
                    (station_id, day_of_week, start_time, end_time, break_start, break_end, notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    station_id,
                    day,
                    "09:00",
                    "14:00",
                    "11:30",
                    "12:00",
                    "Weekend shift"
                ))
        
        # Create some rush periods
        rush_periods = [
            (0, "08:00", "09:30", "Monday morning rush"),
            (0, "12:00", "13:30", "Monday lunch rush"),
            (1, "08:00", "09:30", "Tuesday morning rush"),
            (1, "12:00", "13:30", "Tuesday lunch rush"),
            (2, "08:00", "09:30", "Wednesday morning rush"),
            (2, "12:00", "13:30", "Wednesday lunch rush"),
            (3, "08:00", "09:30", "Thursday morning rush"),
            (3, "12:00", "13:30", "Thursday lunch rush"),
            (4, "08:00", "09:30", "Friday morning rush"),
            (4, "12:00", "13:30", "Friday lunch rush"),
            (5, "10:00", "12:00", "Saturday morning rush")
        ]
        
        for rush in rush_periods:
            day, start_time, end_time, description = rush
            cursor.execute("""
                INSERT INTO rush_periods
                (day_of_week, start_time, end_time, description)
                VALUES (%s, %s, %s, %s)
            """, (day, start_time, end_time, description))
        
        conn.commit()
        print("Station data loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error loading station data: {str(e)}")
    finally:
        cursor.close()

def load_chat_data(conn):
    """Load chat test data"""
    cursor = conn.cursor()
    
    chat_messages = [
        ("Jane Smith (Station #1)", "Good morning everyone! Station 1 is up and running.", False, 1),
        ("John Doe (Station #2)", "Morning! We're set up at Station 2 as well.", False, 2),
        ("System", "Daily coffee delivery has arrived.", False, None),
        ("Jane Smith (Station #1)", "We're running low on almond milk at Station 1.", True, 1),
        ("John Doe (Station #2)", "I have extra, I'll bring some over.", False, 2),
        ("Jane Smith (Station #1)", "Thanks John!", False, 1),
        ("System", "Rush period starting in 15 minutes.", True, None),
        ("Manager", "Good work everyone. Remember to restock during quiet periods.", False, None)
    ]
    
    # Insert chat messages with timestamps spread over the past few hours
    try:
        for i, msg in enumerate(chat_messages):
            sender, content, is_urgent, station_id = msg
            # Set timestamps over the past few hours
            timestamp = datetime.now() - timedelta(hours=3, minutes=(len(chat_messages) - i) * 15)
            
            cursor.execute("""
                INSERT INTO chat_messages
                (sender, content, is_urgent, station_id, created_at)
                VALUES (%s, %s, %s, %s, %s)
            """, (sender, content, is_urgent, station_id, timestamp))
        
        conn.commit()
        print("Chat data loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error loading chat data: {str(e)}")
    finally:
        cursor.close()

def load_orders_data(conn):
    """Load orders test data"""
    cursor = conn.cursor()
    
    # Define test data
    phones = [
        "+61412345678",
        "+61423456789",
        "+61434567890",
        "+61445678901",
        "+61456789012",
        "+61467890123",
        "+61478901234",
        "+61489012345"
    ]
    
    names = [
        "Emma Johnson",
        "Oliver Smith",
        "Sophia Williams",
        "Noah Brown",
        "Ava Jones",
        "William Taylor",
        "Isabella Anderson",
        "James Wilson"
    ]
    
    coffee_types = [
        "Cappuccino",
        "Latte",
        "Flat White",
        "Long Black",
        "Espresso",
        "Macchiato",
        "Mocha",
        "Americano"
    ]
    
    milk_types = [
        "Full Cream",
        "Skim",
        "Almond",
        "Soy",
        "Oat",
        "Lactose Free"
    ]
    
    sugar_options = [
        "No sugar",
        "1 sugar",
        "2 sugars",
        "3 sugars",
        "Sweetener"
    ]
    
    # Create customer preferences
    try:
        for i in range(len(phones)):
            cursor.execute("""
                INSERT INTO customer_preferences
                (phone, name, favorite_coffee, favorite_milk, favorite_sugar, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                phones[i],
                names[i],
                random.choice(coffee_types),
                random.choice(milk_types),
                random.choice(sugar_options),
                "Regular customer" if random.random() > 0.5 else None
            ))
        
        # Create pending orders
        for i in range(5):
            order_number = f"A{100 + i}"
            phone = random.choice(phones)
            
            # Get customer name from preferences
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            customer_name = result[0] if result else "Customer"
            
            # Create order details
            order_details = {
                "name": customer_name,
                "type": random.choice(coffee_types),
                "milk": random.choice(milk_types),
                "size": random.choice(["Regular", "Large"]),
                "sugar": random.choice(sugar_options),
                "notes": "Extra hot" if random.random() > 0.7 else ""
            }
            
            # Determine priority
            priority = 1 if random.random() > 0.8 else 5
            
            # Random time in the past (up to 10 minutes)
            created_at = datetime.now() - timedelta(minutes=random.randint(1, 10))
            
            cursor.execute("""
                INSERT INTO orders
                (order_number, status, station_id, created_at, updated_at, phone, order_details, queue_priority)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                order_number,
                "pending",
                random.randint(1, 2),  # Station 1 or 2
                created_at,
                created_at,
                phone,
                json.dumps(order_details),
                priority
            ))
        
        # Create in-progress orders
        for i in range(3):
            order_number = f"B{100 + i}"
            phone = random.choice(phones)
            
            # Get customer name from preferences
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            customer_name = result[0] if result else "Customer"
            
            # Create order details
            order_details = {
                "name": customer_name,
                "type": random.choice(coffee_types),
                "milk": random.choice(milk_types),
                "size": random.choice(["Regular", "Large"]),
                "sugar": random.choice(sugar_options),
                "notes": "Extra hot" if random.random() > 0.7 else ""
            }
            
            # Determine priority
            priority = 1 if random.random() > 0.8 else 5
            
            # Random time in the past (5-15 minutes)
            created_at = datetime.now() - timedelta(minutes=random.randint(5, 15))
            updated_at = created_at + timedelta(minutes=random.randint(1, 3))
            
            cursor.execute("""
                INSERT INTO orders
                (order_number, status, station_id, created_at, updated_at, phone, order_details, queue_priority)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                order_number,
                "in-progress",
                random.randint(1, 2),  # Station 1 or 2
                created_at,
                updated_at,
                phone,
                json.dumps(order_details),
                priority
            ))
        
        # Create completed orders
        for i in range(8):
            order_number = f"C{100 + i}"
            phone = random.choice(phones)
            
            # Get customer name from preferences
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            customer_name = result[0] if result else "Customer"
            
            # Create order details
            order_details = {
                "name": customer_name,
                "type": random.choice(coffee_types),
                "milk": random.choice(milk_types),
                "size": random.choice(["Regular", "Large"]),
                "sugar": random.choice(sugar_options),
                "notes": "Extra hot" if random.random() > 0.7 else ""
            }
            
            # Determine priority
            priority = 1 if random.random() > 0.8 else 5
            
            # Random time in the past (15-60 minutes)
            created_at = datetime.now() - timedelta(minutes=random.randint(15, 60))
            updated_at = created_at + timedelta(minutes=random.randint(3, 8))
            completed_at = updated_at
            picked_up_at = completed_at + timedelta(minutes=random.randint(1, 5)) if random.random() > 0.5 else None
            
            cursor.execute("""
                INSERT INTO orders
                (order_number, status, station_id, created_at, updated_at, completed_at, picked_up_at, phone, order_details, queue_priority)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                order_number,
                "completed",
                random.randint(1, 2),  # Station 1 or 2
                created_at,
                updated_at,
                completed_at,
                picked_up_at,
                phone,
                json.dumps(order_details),
                priority
            ))
        
        # Create some order messages
        for i in range(5):
            order_number = f"C{100 + i}"  # Use completed orders
            phone = random.choice(phones)
            
            messages = [
                "Your coffee is ready for pickup!",
                "Your order is ready! Please collect from station 1.",
                "Thanks for ordering! Your coffee is now ready.",
                "Coffee's up! Come and get it while it's hot!",
                "Your coffee order is ready for collection."
            ]
            
            cursor.execute("""
                INSERT INTO order_messages
                (order_number, phone, message, sent_at)
                VALUES (%s, %s, %s, %s)
            """, (
                order_number,
                phone,
                random.choice(messages),
                datetime.now() - timedelta(minutes=random.randint(5, 30))
            ))
        
        conn.commit()
        print("Order data loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error loading order data: {str(e)}")
    finally:
        cursor.close()

def load_settings_data(conn):
    """Load settings test data"""
    cursor = conn.cursor()
    
    settings = [
        ("system_name", "Coffee Cue", "System display name"),
        ("event_name", "Tech Conference", "Current event name"),
        ("sponsor_display_enabled", "true", "Whether to display sponsor information"),
        ("sponsor_name", "JavaBeans Inc.", "Sponsor name"),
        ("sponsor_message", "Coffee service proudly sponsored by {sponsor}", "Sponsor message template"),
        ("default_wait_time", "10", "Default wait time in minutes"),
        ("sms_enabled", "true", "Whether SMS notifications are enabled"),
        ("sms_order_ready_message", "Your coffee order #{order_number} is ready for pickup!", "SMS template for order ready"),
        ("display_refresh_interval", "30", "Display screen refresh interval in seconds"),
        ("barista_alert_sound", "true", "Whether to play sound alerts for baristas"),
        ("max_pending_orders", "15", "Maximum number of pending orders allowed")
    ]
    
    try:
        for setting in settings:
            key, value, description = setting
            cursor.execute("""
                INSERT INTO settings 
                (key, value, description, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                description = EXCLUDED.description,
                updated_at = %s
            """, (key, value, description, datetime.now(), datetime.now()))
        
        conn.commit()
        print("Settings data loaded successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Error loading settings data: {str(e)}")
    finally:
        cursor.close()

def create_admin_user(conn):
    """Create an admin user for testing"""
    cursor = conn.cursor()
    
    # Check if admin user already exists
    cursor.execute("SELECT COUNT(*) FROM users WHERE username = 'admin'")
    count = cursor.fetchone()[0]
    
    if count > 0:
        print("Admin user already exists.")
        return
    
    try:
        # Create admin user with password: adminpassword
        from werkzeug.security import generate_password_hash
        password_hash = generate_password_hash("adminpassword")
        
        cursor.execute("""
            INSERT INTO users
            (username, email, password_hash, role, full_name, created_at, updated_at, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            "admin",
            "admin@example.com",
            password_hash,
            "admin",
            "System Administrator",
            datetime.now(),
            datetime.now(),
            True
        ))
        
        # Create barista user with password: barista123
        password_hash = generate_password_hash("barista123")
        
        cursor.execute("""
            INSERT INTO users
            (username, email, password_hash, role, full_name, created_at, updated_at, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            "barista",
            "barista@example.com",
            password_hash,
            "barista",
            "Coffee Barista",
            datetime.now(),
            datetime.now(),
            True
        ))
        
        conn.commit()
        print("Users created successfully:")
        print("  Admin: username=admin, password=adminpassword")
        print("  Barista: username=barista, password=barista123")
    except Exception as e:
        conn.rollback()
        print(f"Error creating admin user: {str(e)}")
    finally:
        cursor.close()

def main():
    """Main function to load test data"""
    print("Loading test data for Expresso Coffee Ordering System\n")
    
    # Get command line arguments
    force_clear = "--force" in sys.argv
    
    # Connect to database
    conn = create_connection()
    
    # Create tables if they don't exist
    create_tables(conn)
    
    # Clear existing data if requested
    if force_clear or truncate_tables(conn, not force_clear):
        # Load test data
        load_inventory_data(conn)
        load_station_data(conn)
        load_chat_data(conn)
        load_orders_data(conn)
        load_settings_data(conn)
        create_admin_user(conn)
        
        print("\nTest data loaded successfully!")
        print("\nYou can now access the system with these credentials:")
        print("  Admin: username=admin, password=adminpassword")
        print("  Barista: username=barista, password=barista123")
    else:
        print("\nNo data was loaded.")
    
    # Close connection
    conn.close()

if __name__ == "__main__":
    main()