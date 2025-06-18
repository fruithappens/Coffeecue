#!/usr/bin/env python3
"""
Fix corrupted station IDs in the database
"""
import os
import sys
from utils.database import get_db_connection

def fix_station_ids():
    """Fix corrupted station IDs"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        print("=== FIXING STATION IDS ===\n")
        
        # First, check current station data
        cursor.execute("SELECT station_id, status, current_load FROM station_stats ORDER BY station_id")
        stations = cursor.fetchall()
        
        print("Current stations:")
        for station in stations:
            print(f"  Station {station[0]}: {station[1]} (load: {station[2]})")
        
        # Check if we have the problematic large station IDs
        problematic_stations = [s for s in stations if s[0] > 100]
        
        if not problematic_stations:
            print("\n✅ No problematic station IDs found")
            return
            
        print(f"\n🚨 Found {len(problematic_stations)} stations with corrupted IDs:")
        for station in problematic_stations:
            print(f"  Station {station[0]} (should probably be a smaller ID)")
        
        # Automatically fix the station IDs
        print("\n🔧 Automatically fixing station IDs...")
            
        # Step 1: Update orders that reference the bad station IDs
        print("\n🔧 Fixing orders with corrupted station IDs...")
        
        # Map problematic station IDs to correct ones
        station_mapping = {}
        
        # If we have station 704916, it should be station 4
        if any(s[0] == 704916 for s in stations):
            station_mapping[704916] = 4
            
        # If we have station 953808, it should be station 5 (or next available)
        if any(s[0] == 953808 for s in stations):
            station_mapping[953808] = 5
            
        # Update orders to use correct station IDs
        for bad_id, good_id in station_mapping.items():
            cursor.execute("""
                UPDATE orders 
                SET station_id = %s 
                WHERE station_id = %s
            """, (good_id, bad_id))
            
            affected_rows = cursor.rowcount
            print(f"  ✅ Updated {affected_rows} orders from station {bad_id} to station {good_id}")
        
        # Step 2: Update station_stats table
        print("\n🔧 Fixing station_stats table...")
        
        for bad_id, good_id in station_mapping.items():
            # Get the data from the bad station
            cursor.execute("SELECT * FROM station_stats WHERE station_id = %s", (bad_id,))
            station_data = cursor.fetchone()
            
            if station_data:
                # Check if the good station ID already exists
                cursor.execute("SELECT station_id FROM station_stats WHERE station_id = %s", (good_id,))
                existing = cursor.fetchone()
                
                if existing:
                    print(f"  ⚠️  Station {good_id} already exists, removing duplicate {bad_id}")
                    cursor.execute("DELETE FROM station_stats WHERE station_id = %s", (bad_id,))
                else:
                    # Update the station ID
                    cursor.execute("""
                        UPDATE station_stats 
                        SET station_id = %s 
                        WHERE station_id = %s
                    """, (good_id, bad_id))
                    print(f"  ✅ Updated station {bad_id} to station {good_id}")
        
        # Commit all changes
        conn.commit()
        
        # Verify the fix
        print("\n🔍 Verifying fixes...")
        cursor.execute("SELECT station_id, status, current_load FROM station_stats ORDER BY station_id")
        new_stations = cursor.fetchall()
        
        print("Fixed stations:")
        for station in new_stations:
            print(f"  Station {station[0]}: {station[1]} (load: {station[2]})")
        
        # Check order assignments
        cursor.execute("""
            SELECT DISTINCT station_id, COUNT(*) as order_count
            FROM orders
            WHERE station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY station_id
        """)
        
        station_usage = cursor.fetchall()
        print("\nOrder assignments by station:")
        for station_id, count in station_usage:
            print(f"  Station {station_id}: {count} orders")
        
        print("\n✅ Station ID fixes completed!")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error fixing stations: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    fix_station_ids()