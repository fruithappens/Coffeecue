#!/usr/bin/env python3
"""
Fix orders that reference non-existent station IDs
"""
import os
import sys
from utils.database import get_db_connection

def fix_orphaned_orders():
    """Fix orders with invalid station IDs"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        print("=== FIXING ORPHANED ORDERS ===\n")
        
        # Get all valid station IDs
        cursor.execute("SELECT station_id FROM station_stats ORDER BY station_id")
        valid_stations = {row[0] for row in cursor.fetchall()}
        print(f"✅ Valid stations: {sorted(valid_stations)}")
        
        # Find orders with invalid station IDs
        cursor.execute("""
            SELECT DISTINCT station_id, COUNT(*) as order_count
            FROM orders
            WHERE station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY station_id
        """)
        
        order_stations = cursor.fetchall()
        orphaned_stations = []
        
        print(f"\n📋 Orders by station:")
        for station_id, count in order_stations:
            if station_id not in valid_stations:
                orphaned_stations.append((station_id, count))
                print(f"  Station {station_id}: {count} orders ❌ INVALID")
            else:
                print(f"  Station {station_id}: {count} orders ✅")
        
        if not orphaned_stations:
            print("\n✅ No orphaned orders found")
            return
            
        print(f"\n🚨 Found orders referencing {len(orphaned_stations)} invalid stations")
        
        # Fix orphaned orders by reassigning them to Station 1
        for station_id, count in orphaned_stations:
            print(f"\n🔧 Reassigning {count} orders from invalid Station {station_id} to Station 1...")
            
            cursor.execute("""
                UPDATE orders 
                SET station_id = 1 
                WHERE station_id = %s
            """, (station_id,))
            
            affected_rows = cursor.rowcount
            print(f"  ✅ Updated {affected_rows} orders")
        
        # Commit changes
        conn.commit()
        
        # Verify the fix
        print("\n🔍 Verifying fixes...")
        cursor.execute("""
            SELECT DISTINCT station_id, COUNT(*) as order_count
            FROM orders
            WHERE station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY station_id
        """)
        
        final_stations = cursor.fetchall()
        print("Final order assignments:")
        for station_id, count in final_stations:
            valid_indicator = "✅" if station_id in valid_stations else "❌"
            print(f"  Station {station_id}: {count} orders {valid_indicator}")
        
        print("\n✅ Orphaned order fixes completed!")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error fixing orphaned orders: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    fix_orphaned_orders()