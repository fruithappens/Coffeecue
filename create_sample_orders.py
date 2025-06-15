#!/usr/bin/env python
"""
Creates sample orders for testing the order management system
"""
import sys
import os
import json
import random
import datetime
import uuid

try:
    # First try to import from a package
    from models.orders import Order
    from utils.database import db_session
    MODELS_IMPORTED = True
except ImportError:
    MODELS_IMPORTED = False
    print("Could not import Order model, using direct database connection.")

# Sample coffee types
COFFEE_TYPES = ["Cappuccino", "Latte", "Flat White", "Long Black", "Espresso", "Macchiato"]

# Sample milk options
MILK_OPTIONS = ["Full cream", "Skim milk", "Soy milk", "Almond milk", "Oat milk"]

# Sample sizes
SIZES = ["Small", "Regular", "Large"]

# Sample sugar options
SUGAR_OPTIONS = ["No sugar", "1 sugar", "2 sugar", "3 sugar"]

# Sample customer names
CUSTOMER_NAMES = [
    "Alice Smith", "Bob Johnson", "Charlie Brown", "Diana Prince", 
    "Edward Jones", "Fatima Ahmed", "George Wilson", "Hannah Davis",
    "Ivan Petrov", "Julia Roberts", "Kevin Hart", "Lisa Simpson",
    "Michael Scott", "Nancy Drew", "Oliver Twist", "Patricia Lee",
    "Quincy Adams", "Rachel Green", "Sam Wilson", "Tina Turner"
]

# Create a mix of orders with different statuses
def generate_orders(count=30):
    """Generate a list of sample orders"""
    orders = []
    now = datetime.datetime.now()
    
    for i in range(count):
        # Basic order data
        order_id = f"ORD{random.randint(1000, 9999)}"
        customer_name = random.choice(CUSTOMER_NAMES)
        coffee_type = random.choice(COFFEE_TYPES)
        milk = random.choice(MILK_OPTIONS)
        size = random.choice(SIZES)
        sugar = random.choice(SUGAR_OPTIONS)
        created_at = now - datetime.timedelta(minutes=random.randint(5, 120))
        
        # Determine status (weighted towards pending for testing)
        status_weights = [
            ("pending", 0.5), 
            ("in_progress", 0.3), 
            ("completed", 0.15),
            ("picked_up", 0.05)
        ]
        status = random.choices(
            [sw[0] for sw in status_weights],
            weights=[sw[1] for sw in status_weights],
            k=1
        )[0]
        
        # Additional timestamps based on status
        started_at = None
        completed_at = None
        picked_up_at = None
        
        if status == "in_progress" or status == "completed" or status == "picked_up":
            started_at = created_at + datetime.timedelta(minutes=random.randint(1, 10))
            
        if status == "completed" or status == "picked_up":
            completed_at = started_at + datetime.timedelta(minutes=random.randint(3, 15))
            
        if status == "picked_up":
            picked_up_at = completed_at + datetime.timedelta(minutes=random.randint(1, 10))
        
        # VIP flag (10% chance)
        is_vip = random.random() < 0.1
        
        # Generate estimated completion time
        if status == "pending" or status == "in_progress":
            estimated_completion = now + datetime.timedelta(minutes=random.randint(3, 15))
        else:
            estimated_completion = None
            
        # Create order object
        order = {
            "order_number": order_id,
            "name": customer_name,
            "type": coffee_type,
            "milk": milk,
            "size": size,
            "sugar": sugar,
            "notes": f"Sample order for {customer_name}",
            "status": status,
            "created_at": created_at.isoformat(),
            "started_at": started_at.isoformat() if started_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "picked_up_at": picked_up_at.isoformat() if picked_up_at else None,
            "vip": is_vip,
            "estimated_completion_time": estimated_completion.isoformat() if estimated_completion else None
        }
        
        orders.append(order)
    
    return orders

def create_orders_with_model(orders):
    """Create orders using the Order model"""
    for order_data in orders:
        # Check if order already exists
        existing_order = Order.query.filter_by(order_number=order_data["order_number"]).first()
        
        if existing_order:
            print(f"Order '{order_data['order_number']}' already exists")
            continue
        
        # Create new order (adjust as needed for your model)
        new_order = Order(
            order_number=order_data["order_number"],
            name=order_data["name"],
            type=order_data["type"],
            milk=order_data["milk"],
            size=order_data["size"],
            sugar=order_data["sugar"],
            notes=order_data["notes"],
            status=order_data["status"],
            created_at=order_data["created_at"],
            started_at=order_data["started_at"],
            completed_at=order_data["completed_at"],
            picked_up_at=order_data["picked_up_at"],
            vip=order_data["vip"],
            estimated_completion_time=order_data["estimated_completion_time"]
        )
        
        db_session.add(new_order)
        print(f"Created order: {order_data['order_number']} ({order_data['status']})")
    
    # Commit changes
    db_session.commit()
    print("All orders created successfully")
    return True

def create_orders_with_direct_db(orders):
    """Create orders by writing to a direct DB file (fallback method)"""
    try:
        import sqlite3
        
        # Try to connect to the SQLite database
        conn = sqlite3.connect('coffee_orders.db')
        cursor = conn.cursor()
        
        # Check if orders table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'")
        if not cursor.fetchone():
            # Create orders table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                order_number TEXT UNIQUE,
                name TEXT,
                type TEXT,
                milk TEXT,
                size TEXT,
                sugar TEXT,
                notes TEXT,
                status TEXT,
                created_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                picked_up_at TEXT,
                vip INTEGER,
                estimated_completion_time TEXT
            )
            ''')
        
        for order_data in orders:
            # Check if order already exists
            cursor.execute("SELECT id FROM orders WHERE order_number = ?", (order_data["order_number"],))
            if cursor.fetchone():
                print(f"Order '{order_data['order_number']}' already exists")
                continue
            
            # Insert order
            cursor.execute('''
            INSERT INTO orders (
                order_number, name, type, milk, size, sugar, notes, status,
                created_at, started_at, completed_at, picked_up_at, 
                vip, estimated_completion_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                order_data["order_number"],
                order_data["name"],
                order_data["type"],
                order_data["milk"],
                order_data["size"],
                order_data["sugar"],
                order_data["notes"],
                order_data["status"],
                order_data["created_at"],
                order_data["started_at"],
                order_data["completed_at"],
                order_data["picked_up_at"],
                1 if order_data["vip"] else 0,
                order_data["estimated_completion_time"]
            ))
            
            print(f"Created order: {order_data['order_number']} ({order_data['status']})")
        
        # Commit changes
        conn.commit()
        conn.close()
        print("All orders created successfully")
        return True
        
    except Exception as e:
        print(f"Error creating orders: {e}")
        return False

def main():
    """Main function"""
    print("Creating sample orders...")
    
    # Generate sample orders
    orders = generate_orders(30)  # Create 30 sample orders
    
    if MODELS_IMPORTED:
        success = create_orders_with_model(orders)
    else:
        success = create_orders_with_direct_db(orders)
    
    if success:
        print("Sample orders created successfully")
        return 0
    else:
        print("Failed to create sample orders")
        return 1

if __name__ == "__main__":
    sys.exit(main())
