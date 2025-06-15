#!/usr/bin/env python3
"""
Find and analyze missing order A11001259
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import json
from datetime import datetime
import os

def get_db_connection():
    """Get database connection using DATABASE_URL"""
    database_url = os.getenv('DATABASE_URL', 'postgresql://localhost/expresso')
    return psycopg2.connect(database_url)

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
                SELECT station_id, name, status, capabilities
                FROM stations
                WHERE station_id = %s
            """, (order['station_id'],))
            
            station = cursor.fetchone()
            if station:
                print(f"\n📍 Station {station['station_id']} ({station['name']}):")
                print(f"   Status: {station['status']}")
                
                # Check capabilities
                if station['capabilities']:
                    try:
                        caps = json.loads(station['capabilities'])
                        coffee_types = caps.get('coffee_types', [])
                        milk_types = caps.get('milk_types', [])
                        print(f"   Coffee types: {', '.join(coffee_types) if coffee_types else 'None'}")
                        print(f"   Milk types: {', '.join(milk_types) if milk_types else 'None'}")
                        
                        # Check if station can make this order
                        drink = details.get('type', '').lower()
                        milk = details.get('milk', '').lower()
                        
                        can_make_coffee = any(drink in ct.lower() for ct in coffee_types) if coffee_types else False
                        can_make_milk = any(milk in mt.lower() for mt in milk_types) if milk_types else False
                        
                        print(f"   Can make '{drink}': {'✅' if can_make_coffee else '❌'}")
                        print(f"   Has '{milk}' milk: {'✅' if can_make_milk else '❌'}")
                        
                    except Exception as e:
                        print(f"   Capabilities: {station['capabilities']}")
            else:
                print(f"\n❌ Station {order['station_id']} not found!")
            
            return order
        else:
            print(f"❌ Order {order_number} not found in database!")
            return None
            
    except Exception as e:
        print(f"❌ Database error: {e}")
        return None
    finally:
        cursor.close()
        conn.close()

def check_recent_orders():
    """Check recent orders for patterns"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        print(f"\n📋 Recent orders (last hour):")
        cursor.execute("""
            SELECT order_number, phone, status, station_id, created_at, order_details
            FROM orders
            WHERE created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC
            LIMIT 10
        """)
        
        recent = cursor.fetchall()
        
        if not recent:
            print("   No recent orders found")
            return
            
        for r in recent:
            try:
                details = json.loads(r['order_details'])
                name = details.get('name', 'Unknown')
            except:
                name = 'Unknown'
                
            print(f"   {r['order_number']} - {name} - {r['status']} - Station {r['station_id']} - {r['created_at']}")
            
    except Exception as e:
        print(f"❌ Error checking recent orders: {e}")
    finally:
        cursor.close()
        conn.close()

def check_all_stations():
    """Check status of all stations"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        cursor.execute("""
            SELECT station_id, name, status, capabilities
            FROM stations
            ORDER BY station_id
        """)
        
        stations = cursor.fetchall()
        
        print(f"\n🏪 All Stations ({len(stations)} total):")
        active_count = 0
        
        for station in stations:
            status_icon = "✅" if station['status'] == 'active' else "❌"
            print(f"   {status_icon} Station {station['station_id']}: {station['name']} - {station['status']}")
            
            if station['status'] == 'active':
                active_count += 1
                
            # Check capabilities
            if station['capabilities']:
                try:
                    caps = json.loads(station['capabilities'])
                    coffee_types = caps.get('coffee_types', [])
                    milk_types = caps.get('milk_types', [])
                    if coffee_types or milk_types:
                        print(f"      Coffee: {', '.join(coffee_types[:3]) if coffee_types else 'None'}")
                        print(f"      Milk: {', '.join(milk_types[:3]) if milk_types else 'None'}")
                except:
                    print(f"      Capabilities: Limited")
        
        print(f"\n📊 Summary: {active_count}/{len(stations)} stations active")
                    
    except Exception as e:
        print(f"❌ Error checking stations: {e}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    print("🔍 Investigating missing order A11001259...")
    print("="*60)
    
    order = find_order("A11001259")
    
    check_recent_orders()
    
    print("\n" + "="*60)
    check_all_stations()