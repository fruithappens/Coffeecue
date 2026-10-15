#!/usr/bin/env python3
"""
Fix customer names that were overwritten by friend orders.
This script will help restore the correct customer names based on their order history.
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import json
import sys

def get_db_connection():
    """Get database connection"""
    from config import DB_CONFIG
    return psycopg2.connect(**DB_CONFIG)

def fix_customer_names():
    """Analyze orders and fix customer names"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Find customers whose names might have been overwritten
        print("Analyzing customer data...")
        
        # Get all customers
        cursor.execute("""
            SELECT phone, name, first_order_date, last_order_date, total_orders
            FROM customer_preferences
            ORDER BY phone
        """)
        customers = cursor.fetchall()
        
        for customer in customers:
            phone = customer['phone']
            current_name = customer['name']
            
            # Get all orders for this phone number
            cursor.execute("""
                SELECT order_details, created_at
                FROM orders
                WHERE phone = %s
                ORDER BY created_at
            """, (phone,))
            
            orders = cursor.fetchall()
            
            if not orders:
                continue
            
            # Analyze order names
            names_used = {}
            customer_own_orders = []
            friend_orders = []
            
            for order in orders:
                try:
                    details = json.loads(order['order_details'])
                    order_name = details.get('name', 'Unknown')
                    
                    # Count how many times each name appears
                    names_used[order_name] = names_used.get(order_name, 0) + 1
                    
                    # Check if this looks like a friend order
                    # (Simple heuristic: if name appears only once, might be a friend)
                    if order_name != current_name:
                        friend_orders.append(order_name)
                    else:
                        customer_own_orders.append(order_name)
                        
                except:
                    continue
            
            # Determine the likely real customer name
            # The name used most frequently is likely the customer's actual name
            if names_used:
                most_common_name = max(names_used.items(), key=lambda x: x[1])[0]
                
                if most_common_name != current_name and names_used[most_common_name] > 1:
                    print(f"\n⚠️  Phone {phone}:")
                    print(f"   Current name: {current_name}")
                    print(f"   Likely real name: {most_common_name} (used {names_used[most_common_name]} times)")
                    print(f"   Other names seen: {', '.join(set(friend_orders))}")
                    
                    # Ask for confirmation
                    response = input("   Fix this? (y/n): ").lower()
                    if response == 'y':
                        cursor.execute("""
                            UPDATE customer_preferences
                            SET name = %s
                            WHERE phone = %s
                        """, (most_common_name, phone))
                        print(f"   ✅ Updated to: {most_common_name}")
        
        # Commit changes
        conn.commit()
        print("\n✅ Customer name fixes completed!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def manual_fix():
    """Manually fix a specific customer"""
    phone = input("Enter phone number to fix: ").strip()
    if not phone:
        return
    
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Get current customer data
        cursor.execute("""
            SELECT * FROM customer_preferences
            WHERE phone = %s
        """, (phone,))
        
        customer = cursor.fetchone()
        if not customer:
            print(f"❌ No customer found with phone: {phone}")
            return
        
        print(f"\nCurrent data for {phone}:")
        print(f"  Name: {customer['name']}")
        print(f"  Preferred drink: {customer['preferred_drink']}")
        print(f"  Total orders: {customer['total_orders']}")
        
        new_name = input("\nEnter correct name (or press Enter to skip): ").strip()
        if new_name:
            cursor.execute("""
                UPDATE customer_preferences
                SET name = %s
                WHERE phone = %s
            """, (new_name, phone))
            conn.commit()
            print(f"✅ Updated name to: {new_name}")
    
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

def main():
    print("🔧 Customer Name Fix Utility")
    print("============================")
    print("\nThis will help fix customer names that were overwritten by friend orders.")
    print("\nOptions:")
    print("1. Analyze and fix all customers")
    print("2. Fix a specific customer")
    print("3. Exit")
    
    choice = input("\nSelect option (1-3): ").strip()
    
    if choice == '1':
        fix_customer_names()
    elif choice == '2':
        manual_fix()
    else:
        print("Exiting...")

if __name__ == "__main__":
    main()