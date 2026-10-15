#!/usr/bin/env python3
"""
Find and analyze missing order A11001259
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import json
from datetime import datetime

def get_db_connection():
    """Get database connection"""
    from config import DB_CONFIG
    return psycopg2.connect(**DB_CONFIG)

def find_order(order_number):
    """Find order by number and analyze its status"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Search for the order
        cursor.execute("""
            SELECT * FROM orders 
            WHERE order_number = %s
        """, (order_number,))
        
        order = cursor.fetchone()
        
        if order:
            print(f"✅ Found order {order_number}:")
            print(f"   ID: {order['id']}")
            print(f"   Phone: {order['phone']}")
            print(f"   Status: {order['status']}")
            print(f"   Station ID: {order['station_id']}")
            print(f"   Created: {order['created_at']}")
            print(f"   Updated: {order['updated_at']}")
            
            # Parse order details
            try:
                details = json.loads(order['order_details'])
                print(f"   Customer: {details.get('name', 'Unknown')}")
                print(f"   Drink: {details.get('type', 'Unknown')}")
                print(f"   Milk: {details.get('milk', 'Unknown')}")
                print(f"   Size: {details.get('size', 'Unknown')}")
                print(f"   Sugar: {details.get('sugar', 'Unknown')}")
            except:
                print(f"   Order details: {order['order_details']}")
            
            # Check if station exists and is active
            cursor.execute("""
                SELECT id, name, current_status, capabilities
                FROM stations
                WHERE id = %s
            """, (order['station_id'],))
            
            station = cursor.fetchone()
            if station:
                print(f"\n📍 Station {station['id']} ({station['name']}):")
                print(f"   Status: {station['current_status']}")
                print(f"   Capabilities: {station['capabilities']}")
            else:
                print(f"\n❌ Station {order['station_id']} not found!")
            
            return order
        else:
            print(f"❌ Order {order_number} not found in database!")
            
            # Search for similar orders by time
            print("\nSearching for recent orders...")
            cursor.execute("""
                SELECT order_number, phone, status, station_id, created_at
                FROM orders
                WHERE created_at > NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 10
            """)
            
            recent = cursor.fetchall()
            for r in recent:
                print(f"   {r['order_number']} - {r['phone']} - {r['status']} - Station {r['station_id']} - {r['created_at']}")
            
            return None
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return None
    finally:
        cursor.close()
        conn.close()

def check_all_stations():
    """Check status of all stations"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cursor.execute("""
            SELECT id, name, current_status, capabilities
            FROM stations
            ORDER BY id
        """)
        
        stations = cursor.fetchall()
        
        print(f"\n🏪 All Stations ({len(stations)} total):")
        for station in stations:
            print(f"   Station {station['id']}: {station['name']} - {station['current_status']}")
            
            # Check capabilities
            if station['capabilities']:
                try:
                    caps = json.loads(station['capabilities'])
                    coffee_types = caps.get('coffee_types', [])
                    milk_types = caps.get('milk_types', [])
                    print(f"      Coffee: {', '.join(coffee_types) if coffee_types else 'None'}")
                    print(f"      Milk: {', '.join(milk_types) if milk_types else 'None'}")
                except:
                    print(f"      Capabilities: {station['capabilities']}")
                    
    except Exception as e:
        print(f"❌ Error checking stations: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("🔍 Searching for missing order A11001259...")
    order = find_order("A11001259")
    
    print("\n" + "="*50)
    check_all_stations()