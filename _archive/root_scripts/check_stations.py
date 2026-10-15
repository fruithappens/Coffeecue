#!/usr/bin/env python3
"""
Check station data in the database
"""
import os
import sys
from utils.database import get_db_connection
import json

def check_stations():
    """Check station data"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        print("=== CHECKING STATION DATA ===\n")
        
        # First check what columns exist in station_stats
        cursor.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'station_stats'
            ORDER BY ordinal_position
        """)
        
        columns = [row[0] for row in cursor.fetchall()]
        print(f"📋 station_stats columns: {', '.join(columns)}\n")
        
        # Check station_stats table with actual columns
        cursor.execute("""
            SELECT * FROM station_stats
            ORDER BY station_id
        """)
        
        stations = cursor.fetchall()
        
        if not stations:
            print("❌ No stations found in station_stats table")
        else:
            print(f"📊 Found {len(stations)} stations in station_stats:\n")
            
            for i, station in enumerate(stations):
                print(f"🚉 Station {i+1}: {station}")
                print()
        
        # Check if there are any other station-related tables
        print("=== CHECKING OTHER STATION TABLES ===\n")
        
        # Check stations table if it exists
        try:
            cursor.execute("""
                SELECT id, name, location, status, capabilities
                FROM stations
                ORDER BY id
            """)
            
            stations_table = cursor.fetchall()
            if stations_table:
                print(f"📋 Found {len(stations_table)} stations in 'stations' table:\n")
                for station in stations_table:
                    station_id, name, location, status, capabilities = station
                    print(f"🚉 Station {station_id}: {name}")
                    print(f"   Location: {location}")
                    print(f"   Status: {status}")
                    if capabilities:
                        try:
                            caps = json.loads(capabilities) if isinstance(capabilities, str) else capabilities
                            print(f"   Capabilities: {caps}")
                        except:
                            print(f"   Capabilities: Parse error")
                    print()
            else:
                print("📋 'stations' table exists but is empty")
                
        except Exception as e:
            print(f"📋 'stations' table does not exist or error: {str(e)}")
        
        # Check for problematic station IDs in orders
        print("=== CHECKING PROBLEMATIC STATION ASSIGNMENTS ===\n")
        
        cursor.execute("""
            SELECT DISTINCT station_id, COUNT(*) as order_count
            FROM orders
            WHERE station_id IS NOT NULL
            GROUP BY station_id
            ORDER BY station_id
        """)
        
        station_usage = cursor.fetchall()
        
        valid_stations = {s[0] for s in stations}  # Get valid station IDs from station_stats
        
        print(f"🔍 Station usage in orders:")
        for station_id, count in station_usage:
            valid_indicator = "✅" if station_id in valid_stations else "❌ INVALID"
            print(f"   Station {station_id}: {count} orders {valid_indicator}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error checking stations: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_stations()