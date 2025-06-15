#!/usr/bin/env python3
"""
Customer Data Management Tool
Allows managing customer preferences, including:
- Viewing customer data
- Correcting names/preferences
- Deleting individual customers
- Bulk operations for events
- Privacy compliance (GDPR/data protection)
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import json
import sys
from datetime import datetime, timedelta
from tabulate import tabulate

def get_db_connection():
    """Get database connection"""
    from config import DB_CONFIG
    return psycopg2.connect(**DB_CONFIG)

class CustomerDataManager:
    def __init__(self):
        self.conn = get_db_connection()
        self.cursor = self.conn.cursor(cursor_factory=RealDictCursor)
    
    def search_customer(self, search_term):
        """Search for customers by phone or name"""
        self.cursor.execute("""
            SELECT phone, name, preferred_drink, preferred_milk, 
                   last_order_date, total_orders
            FROM customer_preferences
            WHERE phone LIKE %s OR LOWER(name) LIKE LOWER(%s)
            ORDER BY last_order_date DESC
            LIMIT 10
        """, (f'%{search_term}%', f'%{search_term}%'))
        
        return self.cursor.fetchall()
    
    def view_customer(self, phone):
        """View detailed customer information"""
        # Get customer preferences
        self.cursor.execute("""
            SELECT * FROM customer_preferences
            WHERE phone = %s
        """, (phone,))
        
        customer = self.cursor.fetchone()
        if not customer:
            return None
        
        # Get recent orders
        self.cursor.execute("""
            SELECT order_number, order_details, created_at, status
            FROM orders
            WHERE phone = %s
            ORDER BY created_at DESC
            LIMIT 10
        """, (phone,))
        
        orders = self.cursor.fetchall()
        
        return {
            'preferences': customer,
            'recent_orders': orders
        }
    
    def update_customer_name(self, phone, new_name):
        """Update a customer's name"""
        self.cursor.execute("""
            UPDATE customer_preferences
            SET name = %s
            WHERE phone = %s
        """, (new_name, phone))
        
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def delete_customer(self, phone):
        """Delete a customer and their preferences (keeps order history)"""
        self.cursor.execute("""
            DELETE FROM customer_preferences
            WHERE phone = %s
        """, (phone,))
        
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def reset_preferences(self, phone):
        """Reset customer preferences but keep name and contact"""
        self.cursor.execute("""
            UPDATE customer_preferences
            SET preferred_drink = NULL,
                preferred_milk = NULL,
                preferred_size = NULL,
                preferred_sugar = NULL
            WHERE phone = %s
        """, (phone,))
        
        self.conn.commit()
        return self.cursor.rowcount > 0
    
    def bulk_delete_old_customers(self, days_inactive=90):
        """Delete customers who haven't ordered in X days"""
        cutoff_date = datetime.now() - timedelta(days=days_inactive)
        
        # First, show what will be deleted
        self.cursor.execute("""
            SELECT COUNT(*) as count
            FROM customer_preferences
            WHERE last_order_date < %s
        """, (cutoff_date,))
        
        count = self.cursor.fetchone()['count']
        
        if count == 0:
            return 0
        
        print(f"\nThis will delete {count} customers who haven't ordered since {cutoff_date.date()}")
        confirm = input("Are you sure? (yes/no): ").lower()
        
        if confirm == 'yes':
            self.cursor.execute("""
                DELETE FROM customer_preferences
                WHERE last_order_date < %s
            """, (cutoff_date,))
            
            self.conn.commit()
            return self.cursor.rowcount
        
        return 0
    
    def export_customer_data(self, phone):
        """Export all data for a customer (GDPR compliance)"""
        data = self.view_customer(phone)
        if not data:
            return None
        
        # Get ALL orders (not just recent)
        self.cursor.execute("""
            SELECT * FROM orders
            WHERE phone = %s
            ORDER BY created_at DESC
        """, (phone,))
        
        all_orders = self.cursor.fetchall()
        
        # Convert datetime objects to strings
        for order in all_orders:
            order['created_at'] = str(order['created_at'])
            order['updated_at'] = str(order['updated_at'])
        
        export_data = {
            'customer_preferences': dict(data['preferences']),
            'order_history': [dict(order) for order in all_orders],
            'export_date': str(datetime.now()),
            'phone': phone
        }
        
        # Convert dates to strings
        if export_data['customer_preferences'].get('first_order_date'):
            export_data['customer_preferences']['first_order_date'] = str(
                export_data['customer_preferences']['first_order_date']
            )
        if export_data['customer_preferences'].get('last_order_date'):
            export_data['customer_preferences']['last_order_date'] = str(
                export_data['customer_preferences']['last_order_date']
            )
        
        return export_data
    
    def anonymize_old_data(self, days_old=365):
        """Anonymize old customer data for privacy"""
        cutoff_date = datetime.now() - timedelta(days=days_old)
        
        # Show what will be anonymized
        self.cursor.execute("""
            SELECT COUNT(*) as count
            FROM customer_preferences
            WHERE last_order_date < %s
        """, (cutoff_date,))
        
        count = self.cursor.fetchone()['count']
        
        if count == 0:
            return 0
        
        print(f"\nThis will anonymize {count} customers who haven't ordered since {cutoff_date.date()}")
        print("Their names will be replaced with 'Anonymous' but order history will remain.")
        confirm = input("Are you sure? (yes/no): ").lower()
        
        if confirm == 'yes':
            self.cursor.execute("""
                UPDATE customer_preferences
                SET name = 'Anonymous',
                    phone = CONCAT('ANON_', SUBSTRING(MD5(phone::text), 1, 8))
                WHERE last_order_date < %s
            """, (cutoff_date,))
            
            self.conn.commit()
            return self.cursor.rowcount
        
        return 0
    
    def close(self):
        """Close database connection"""
        self.cursor.close()
        self.conn.close()

def interactive_menu():
    """Interactive menu for customer data management"""
    manager = CustomerDataManager()
    
    while True:
        print("\n" + "="*50)
        print("Customer Data Management")
        print("="*50)
        print("1. Search customer")
        print("2. View customer details")
        print("3. Update customer name")
        print("4. Reset customer preferences")
        print("5. Delete customer")
        print("6. Export customer data (GDPR)")
        print("7. Bulk delete inactive customers")
        print("8. Anonymize old data")
        print("9. Exit")
        
        choice = input("\nSelect option (1-9): ").strip()
        
        try:
            if choice == '1':
                search = input("Enter phone number or name to search: ").strip()
                customers = manager.search_customer(search)
                
                if customers:
                    headers = ['Phone', 'Name', 'Favorite Drink', 'Milk', 'Last Order', 'Total Orders']
                    rows = [[c['phone'], c['name'], c['preferred_drink'], 
                            c['preferred_milk'], c['last_order_date'], c['total_orders']] 
                           for c in customers]
                    print("\n" + tabulate(rows, headers=headers, tablefmt='grid'))
                else:
                    print("No customers found.")
            
            elif choice == '2':
                phone = input("Enter phone number: ").strip()
                data = manager.view_customer(phone)
                
                if data:
                    prefs = data['preferences']
                    print(f"\nCustomer: {prefs['name']} ({phone})")
                    print(f"Preferred: {prefs['preferred_drink']} with {prefs['preferred_milk']} milk")
                    print(f"Size: {prefs['preferred_size']}, Sugar: {prefs['preferred_sugar']}")
                    print(f"Total orders: {prefs['total_orders']}")
                    print(f"Customer since: {prefs['first_order_date']}")
                    
                    if data['recent_orders']:
                        print("\nRecent orders:")
                        for order in data['recent_orders'][:5]:
                            details = json.loads(order['order_details'])
                            print(f"  {order['order_number']} - {details.get('type')} - {order['status']}")
                else:
                    print("Customer not found.")
            
            elif choice == '3':
                phone = input("Enter phone number: ").strip()
                new_name = input("Enter new name: ").strip()
                
                if manager.update_customer_name(phone, new_name):
                    print(f"✅ Updated name to: {new_name}")
                else:
                    print("❌ Customer not found.")
            
            elif choice == '4':
                phone = input("Enter phone number to reset preferences: ").strip()
                
                if manager.reset_preferences(phone):
                    print("✅ Preferences reset. Customer will be asked for preferences on next order.")
                else:
                    print("❌ Customer not found.")
            
            elif choice == '5':
                phone = input("Enter phone number to delete: ").strip()
                confirm = input(f"Are you sure you want to delete customer {phone}? (yes/no): ").lower()
                
                if confirm == 'yes':
                    if manager.delete_customer(phone):
                        print("✅ Customer deleted.")
                    else:
                        print("❌ Customer not found.")
            
            elif choice == '6':
                phone = input("Enter phone number to export data: ").strip()
                data = manager.export_customer_data(phone)
                
                if data:
                    filename = f"customer_export_{phone}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                    with open(filename, 'w') as f:
                        json.dump(data, f, indent=2)
                    print(f"✅ Data exported to: {filename}")
                else:
                    print("❌ Customer not found.")
            
            elif choice == '7':
                days = int(input("Delete customers inactive for how many days? (default 90): ") or "90")
                deleted = manager.bulk_delete_old_customers(days)
                if deleted > 0:
                    print(f"✅ Deleted {deleted} inactive customers.")
            
            elif choice == '8':
                days = int(input("Anonymize data older than how many days? (default 365): ") or "365")
                anonymized = manager.anonymize_old_data(days)
                if anonymized > 0:
                    print(f"✅ Anonymized {anonymized} old customer records.")
            
            elif choice == '9':
                break
                
        except Exception as e:
            print(f"❌ Error: {e}")
    
    manager.close()

def main():
    print("🔐 Customer Data Management Tool")
    print("================================")
    print("\nThis tool helps manage customer data for:")
    print("- Privacy compliance (GDPR)")
    print("- Correcting mistakes")
    print("- Event-based data cleanup")
    print("- Customer requests\n")
    
    if len(sys.argv) > 1:
        # Command line mode
        if sys.argv[1] == '--delete-all-inactive':
            manager = CustomerDataManager()
            days = int(sys.argv[2]) if len(sys.argv) > 2 else 90
            deleted = manager.bulk_delete_old_customers(days)
            print(f"Deleted {deleted} inactive customers.")
            manager.close()
        elif sys.argv[1] == '--help':
            print("Usage:")
            print("  python customer_data_manager.py                    # Interactive mode")
            print("  python customer_data_manager.py --delete-all-inactive [days]  # Bulk delete")
            print("  python customer_data_manager.py --help            # Show this help")
    else:
        # Interactive mode
        interactive_menu()

if __name__ == "__main__":
    main()