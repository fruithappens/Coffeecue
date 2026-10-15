#!/usr/bin/env python3
"""
Create stations table and implement fallback system for lost orders
"""
import psycopg2
import json
from datetime import datetime
import config

def create_stations_table(conn):
    """Create a stations table as a view of station_stats for compatibility"""
    try:
        cur = conn.cursor()
        
        # Drop view if it exists
        cur.execute("DROP VIEW IF EXISTS stations")
        
        # Create stations view that maps to station_stats
        cur.execute("""
            CREATE VIEW stations AS 
            SELECT 
                station_id as id,
                station_id,
                COALESCE(barista_name, 'Station ' || station_id) as name,
                status,
                current_load,
                avg_completion_time,
                total_orders,
                last_updated,
                capabilities,
                capacity,
                CASE 
                    WHEN status = 'active' THEN true 
                    ELSE false 
                END as is_open,
                COALESCE(capabilities->>'coffee_types', '["espresso","cappuccino","latte","flat_white","americano","long_black"]') as coffee_types,
                COALESCE(capabilities->>'milk_options', '["full_cream","skim","oat","almond","soy"]') as milk_options,
                COALESCE(capabilities->>'cup_sizes', '["small","medium","large"]') as cup_sizes
            FROM station_stats
        """)
        
        conn.commit()
        print("✅ Created stations view successfully")
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error creating stations table: {e}")
        return False

def create_fallback_station(conn):
    """Create or update a fallback station for orders that can't be assigned"""
    try:
        cur = conn.cursor()
        
        # Check if fallback station (station 999) exists
        cur.execute("SELECT station_id FROM station_stats WHERE station_id = 999")
        fallback_exists = cur.fetchone()
        
        if not fallback_exists:
            # Create fallback station
            cur.execute("""
                INSERT INTO station_stats (
                    station_id, status, barista_name, current_load, 
                    avg_completion_time, total_orders, last_updated,
                    capabilities, capacity
                ) VALUES (
                    999, 'active', 'Support Fallback', 0,
                    300, 0, %s,
                    %s, 100
                )
            """, (
                datetime.now(),
                json.dumps({
                    "coffee_types": ["espresso", "cappuccino", "latte", "flat_white", "americano", "long_black", "mocha", "macchiato"],
                    "milk_options": ["full_cream", "skim", "oat", "almond", "soy", "coconut", "lactose_free"],
                    "cup_sizes": ["small", "medium", "large", "extra_large"],
                    "special_notes": "Fallback station for orders that cannot be assigned to regular stations"
                })
            ))
            print("✅ Created fallback station 999")
        else:
            # Update existing fallback station
            cur.execute("""
                UPDATE station_stats 
                SET status = 'active', 
                    barista_name = 'Support Fallback',
                    capabilities = %s,
                    last_updated = %s
                WHERE station_id = 999
            """, (
                json.dumps({
                    "coffee_types": ["espresso", "cappuccino", "latte", "flat_white", "americano", "long_black", "mocha", "macchiato"],
                    "milk_options": ["full_cream", "skim", "oat", "almond", "soy", "coconut", "lactose_free"],
                    "cup_sizes": ["small", "medium", "large", "extra_large"],
                    "special_notes": "Fallback station for orders that cannot be assigned to regular stations"
                }),
                datetime.now()
            ))
            print("✅ Updated fallback station 999")
        
        conn.commit()
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error creating fallback station: {e}")
        return False

def initialize_regular_stations(conn):
    """Initialize regular stations if they don't exist"""
    try:
        cur = conn.cursor()
        
        # Check how many regular stations exist (excluding fallback 999)
        cur.execute("SELECT COUNT(*) FROM station_stats WHERE station_id < 999")
        count = cur.fetchone()[0]
        
        if count == 0:
            print("📋 No regular stations found, creating default stations...")
            
            # Create 3 default stations
            stations_data = [
                {
                    "id": 1,
                    "name": "Espresso Station",
                    "capabilities": {
                        "coffee_types": ["espresso", "americano", "long_black"],
                        "milk_options": ["full_cream", "skim", "oat", "almond"],
                        "cup_sizes": ["small", "medium", "large"]
                    }
                },
                {
                    "id": 2, 
                    "name": "Milk Bar Station",
                    "capabilities": {
                        "coffee_types": ["cappuccino", "latte", "flat_white", "mocha"],
                        "milk_options": ["full_cream", "skim", "oat", "almond", "soy"],
                        "cup_sizes": ["small", "medium", "large"]
                    }
                },
                {
                    "id": 3,
                    "name": "Express Station", 
                    "capabilities": {
                        "coffee_types": ["espresso", "cappuccino", "latte", "flat_white", "americano"],
                        "milk_options": ["full_cream", "oat"],
                        "cup_sizes": ["small", "medium"]
                    }
                }
            ]
            
            for station_data in stations_data:
                cur.execute("""
                    INSERT INTO station_stats (
                        station_id, status, barista_name, current_load,
                        avg_completion_time, total_orders, last_updated,
                        capabilities, capacity
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    station_data["id"],
                    "active",
                    station_data["name"],
                    0, 180, 0, datetime.now(),
                    json.dumps(station_data["capabilities"]),
                    20
                ))
                print(f"✅ Created station {station_data['id']}: {station_data['name']}")
        
        conn.commit()
        return True
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error initializing stations: {e}")
        return False

def fix_orphaned_orders(conn):
    """Find and fix orders assigned to non-existent stations"""
    try:
        cur = conn.cursor()
        
        # Find orders assigned to stations that don't exist
        cur.execute("""
            SELECT o.id, o.order_number, o.phone, o.order_details, o.station_id
            FROM orders o
            LEFT JOIN station_stats s ON o.station_id = s.station_id
            WHERE o.status = 'pending' AND s.station_id IS NULL
        """)
        
        orphaned_orders = cur.fetchall()
        
        if orphaned_orders:
            print(f"🔍 Found {len(orphaned_orders)} orphaned orders...")
            
            for order in orphaned_orders:
                order_id, order_number, phone, order_details, old_station_id = order
                
                # Try to assign to an appropriate station based on order details
                assigned_station = assign_order_to_appropriate_station(cur, order_details)
                
                if not assigned_station:
                    # Fall back to fallback station
                    assigned_station = 999
                    print(f"⚠️  Order {order_number} assigned to fallback station (no suitable station found)")
                else:
                    print(f"✅ Order {order_number} reassigned from station {old_station_id} to station {assigned_station}")
                
                # Update the order
                cur.execute("""
                    UPDATE orders 
                    SET station_id = %s, updated_at = %s 
                    WHERE id = %s
                """, (assigned_station, datetime.now(), order_id))
        else:
            print("✅ No orphaned orders found")
        
        conn.commit()
        return len(orphaned_orders) if orphaned_orders else 0
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error fixing orphaned orders: {e}")
        return -1

def assign_order_to_appropriate_station(cur, order_details):
    """Find the most appropriate station for an order based on requirements"""
    try:
        if isinstance(order_details, str):
            order_details = json.loads(order_details)
        
        coffee_type = order_details.get('type', 'cappuccino')
        milk_type = order_details.get('milk', 'full_cream') 
        cup_size = order_details.get('size', 'medium')
        
        # Find stations that can handle this order
        cur.execute("""
            SELECT station_id, capabilities, current_load
            FROM station_stats 
            WHERE status = 'active' AND station_id < 999
            ORDER BY current_load ASC
        """)
        
        stations = cur.fetchall()
        suitable_stations = []
        
        for station_id, capabilities, current_load in stations:
            if not capabilities:
                # If no capabilities defined, assume it can handle anything
                suitable_stations.append((station_id, current_load))
                continue
                
            caps = capabilities if isinstance(capabilities, dict) else json.loads(capabilities)
            
            # Check if station can handle the coffee type
            coffee_types = caps.get('coffee_types', [])
            if coffee_types and coffee_type not in coffee_types:
                continue
                
            # Check if station can handle the milk type
            milk_options = caps.get('milk_options', [])
            if milk_options and milk_type not in milk_options:
                continue
                
            # Check if station can handle the cup size
            cup_sizes = caps.get('cup_sizes', [])
            if cup_sizes and cup_size not in cup_sizes:
                continue
            
            # This station can handle the order
            suitable_stations.append((station_id, current_load))
        
        if suitable_stations:
            # Return the station with the lowest load
            suitable_stations.sort(key=lambda x: x[1])
            return suitable_stations[0][0]
        
        return None
        
    except Exception as e:
        print(f"❌ Error finding appropriate station: {e}")
        return None

def main():
    """Main function to set up stations and fix orphaned orders"""
    try:
        print("🔧 Setting up stations table and fallback system...")
        
        # Connect to database
        conn = psycopg2.connect(config.DATABASE_URL)
        
        # Create stations view
        if not create_stations_table(conn):
            return False
        
        # Initialize regular stations
        if not initialize_regular_stations(conn):
            return False
            
        # Create fallback station
        if not create_fallback_station(conn):
            return False
        
        # Fix orphaned orders
        fixed_orders = fix_orphaned_orders(conn)
        if fixed_orders >= 0:
            print(f"✅ Fixed {fixed_orders} orphaned orders")
        
        conn.close()
        
        print("\n🎉 Setup complete! Station system and fallback mechanism are now ready.")
        return True
        
    except Exception as e:
        print(f"❌ Setup failed: {e}")
        return False

if __name__ == "__main__":
    main()