#!/usr/bin/env python3
"""
Fix for SMS user identification issue where friend orders overwrite customer preferences.

The issue: When a customer orders for a friend, the system saves the friend's name 
and preferences under the customer's phone number.

This script patches the coffee_system.py to ensure customer preferences are only 
updated when ordering for themselves, not when ordering for friends.
"""

import os
import sys
import shutil
from datetime import datetime

def backup_file(filepath):
    """Create a backup of the original file"""
    backup_path = f"{filepath}.backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    shutil.copy2(filepath, backup_path)
    print(f"✅ Created backup: {backup_path}")
    return backup_path

def patch_coffee_system():
    """Apply the fix to coffee_system.py"""
    filepath = "services/coffee_system.py"
    
    if not os.path.exists(filepath):
        print(f"❌ Error: {filepath} not found!")
        return False
    
    # Create backup
    backup_file(filepath)
    
    # Read the file
    with open(filepath, 'r') as f:
        content = f.read()
    
    # Define the patches
    patches = [
        {
            'description': 'Fix _confirm_order to not update customer preferences for friend orders',
            'find': """            # Step 3: Save customer preferences for this exact order configuration
            try:
                # Check if customer exists
                if db_type == "sqlite":
                    cursor.execute("SELECT phone FROM customer_preferences WHERE phone = ?", (phone,))
                else:
                    cursor.execute("SELECT phone FROM customer_preferences WHERE phone = %s", (phone,))
                    
                result = cursor.fetchone()
                
                if result:
                    # Update existing customer
                    if db_type == "sqlite":
                        cursor.execute(""\"
                            UPDATE customer_preferences
                            SET name = ?,
                                preferred_drink = ?,
                                preferred_milk = ?,
                                preferred_size = ?,
                                preferred_sugar = ?,
                                last_order_date = ?,
                                total_orders = total_orders + 1
                            WHERE phone = ?
                        ""\", (
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            phone
                        ))
                    else:
                        cursor.execute(""\"
                            UPDATE customer_preferences
                            SET name = %s,
                                preferred_drink = %s,
                                preferred_milk = %s,
                                preferred_size = %s,
                                preferred_sugar = %s,
                                last_order_date = %s,
                                total_orders = total_orders + 1
                            WHERE phone = %s
                        ""\", (
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            phone
                        ))
                else:
                    # Create new customer
                    if db_type == "sqlite":
                        cursor.execute(""\"
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                             first_order_date, last_order_date, total_orders)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ""\", (
                            phone,
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            now,
                            1
                        ))
                    else:
                        cursor.execute(""\"
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                             first_order_date, last_order_date, total_orders)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ""\", (
                            phone,
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            now,
                            1
                        ))""",
            'replace': """            # Step 3: Save customer preferences ONLY if this is the customer's own order
            # Check if this is a friend order by looking at the order details
            is_friend_order = processed_details.get('is_friend_order', False)
            
            if not is_friend_order:
                try:
                    # Get the customer's actual name from the database
                    if db_type == "sqlite":
                        cursor.execute("SELECT name FROM customer_preferences WHERE phone = ?", (phone,))
                    else:
                        cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                        
                    existing_customer = cursor.fetchone()
                    customer_name = existing_customer[0] if existing_customer else name
                    
                    # Only update preferences if this order is for the customer themselves
                    # Don't overwrite with friend's details
                    if existing_customer:
                        # Update existing customer with their own order details only
                        if db_type == "sqlite":
                            cursor.execute(""\"
                                UPDATE customer_preferences
                                SET preferred_drink = ?,
                                    preferred_milk = ?,
                                    preferred_size = ?,
                                    preferred_sugar = ?,
                                    last_order_date = ?,
                                    total_orders = total_orders + 1
                                WHERE phone = ?
                            ""\", (
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                phone
                            ))
                        else:
                            cursor.execute(""\"
                                UPDATE customer_preferences
                                SET preferred_drink = %s,
                                    preferred_milk = %s,
                                    preferred_size = %s,
                                    preferred_sugar = %s,
                                    last_order_date = %s,
                                    total_orders = total_orders + 1
                                WHERE phone = %s
                            ""\", (
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                phone
                            ))
                    else:
                        # Create new customer record with the actual customer's name
                        if db_type == "sqlite":
                            cursor.execute(""\"
                                INSERT INTO customer_preferences
                                (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                                 first_order_date, last_order_date, total_orders)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ""\", (
                                phone,
                                customer_name,
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                now,
                                1
                            ))
                        else:
                            cursor.execute(""\"
                                INSERT INTO customer_preferences
                                (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                                 first_order_date, last_order_date, total_orders)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            ""\", (
                                phone,
                                customer_name,
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                now,
                                1
                            ))"""
        },
        {
            'description': 'Mark friend orders in _handle_awaiting_friend_confirmation',
            'find': """            # Confirm the order for the friend
            order_response = self._confirm_order(phone, friend_order, friend_name)""",
            'replace': """            # Confirm the order for the friend (mark it as a friend order)
            friend_order['is_friend_order'] = True
            order_response = self._confirm_order(phone, friend_order, friend_name)"""
        }
    ]
    
    # Apply patches
    modified = False
    for patch in patches:
        if patch['find'] in content:
            content = content.replace(patch['find'], patch['replace'])
            print(f"✅ Applied patch: {patch['description']}")
            modified = True
        else:
            print(f"⚠️  Could not find pattern for: {patch['description']}")
    
    if modified:
        # Write the patched content
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"\n✅ Successfully patched {filepath}")
        return True
    else:
        print(f"\n❌ No patches were applied to {filepath}")
        return False

def main():
    print("🔧 SMS User Identification Fix")
    print("==============================")
    print("\nThis will fix the issue where friend orders overwrite customer preferences.")
    
    # Check if we're in the right directory
    if not os.path.exists("services/coffee_system.py"):
        print("\n❌ Error: Must be run from the expresso directory!")
        print("   Current directory:", os.getcwd())
        sys.exit(1)
    
    # Apply the patch
    if patch_coffee_system():
        print("\n✨ Fix applied successfully!")
        print("\nNext steps:")
        print("1. Restart the backend server")
        print("2. Test SMS ordering to verify the fix")
        print("\nThe system will now:")
        print("- Keep customer preferences separate from friend orders")
        print("- Remember YOUR name and preferences when you order")
        print("- Not overwrite your details when you order for friends")
    else:
        print("\n❌ Fix failed. Please check the error messages above.")
        sys.exit(1)

if __name__ == "__main__":
    main()