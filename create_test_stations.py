#!/usr/bin/env python
"""
Creates test barista stations for testing station management
"""
import sys
import os
import json

try:
    # First try to import from a package
    from models.stations import Station
    from utils.database import db_session
    MODELS_IMPORTED = True
except ImportError:
    MODELS_IMPORTED = False
    print("Could not import Station model, using direct database connection.")

# Test stations to create
TEST_STATIONS = [
    {
        "name": "Station 1",
        "location": "Main Counter",
        "capabilities": ["coffee", "espresso", "milk_steaming"],
        "status": "active"
    },
    {
        "name": "Station 2",
        "location": "Secondary Counter",
        "capabilities": ["coffee", "espresso", "milk_steaming", "blending"],
        "status": "active"
    },
    {
        "name": "Station 3",
        "location": "Express Counter",
        "capabilities": ["coffee", "espresso"],
        "status": "inactive"
    }
]

def create_stations_with_model():
    """Create stations using the Station model"""
    for station_data in TEST_STATIONS:
        # Check if station already exists
        existing_station = Station.query.filter_by(name=station_data["name"]).first()
        
        if existing_station:
            print(f"Station '{station_data['name']}' already exists")
            continue
        
        # Create new station
        capabilities_json = json.dumps(station_data["capabilities"])
        new_station = Station(
            name=station_data["name"],
            location=station_data["location"],
            capabilities=capabilities_json,
            status=station_data["status"]
        )
        
        db_session.add(new_station)
        print(f"Created station: {station_data['name']} (location: {station_data['location']})")
    
    # Commit changes
    db_session.commit()
    print("All stations created successfully")
    return True

def create_stations_with_direct_db():
    """Create stations by writing to a direct DB file (fallback method)"""
    try:
        import sqlite3
        
        # Try to connect to the SQLite database
        conn = sqlite3.connect('coffee_orders.db')
        cursor = conn.cursor()
        
        # Check if stations table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stations'")
        if not cursor.fetchone():
            # Create stations table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS stations (
                id INTEGER PRIMARY KEY,
                name TEXT UNIQUE,
                location TEXT,
                capabilities TEXT,
                status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
        
        for station_data in TEST_STATIONS:
            # Check if station already exists
            cursor.execute("SELECT id FROM stations WHERE name = ?", (station_data["name"],))
            if cursor.fetchone():
                print(f"Station '{station_data['name']}' already exists")
                continue
            
            # Convert capabilities to JSON
            capabilities_json = json.dumps(station_data["capabilities"])
            
            # Insert station
            cursor.execute('''
            INSERT INTO stations (name, location, capabilities, status)
            VALUES (?, ?, ?, ?)
            ''', (
                station_data["name"],
                station_data["location"],
                capabilities_json,
                station_data["status"]
            ))
            
            print(f"Created station: {station_data['name']} (location: {station_data['location']})")
        
        # Commit changes
        conn.commit()
        conn.close()
        print("All stations created successfully")
        return True
        
    except Exception as e:
        print(f"Error creating stations: {e}")
        return False

def main():
    """Main function"""
    print("Creating test stations...")
    
    if MODELS_IMPORTED:
        success = create_stations_with_model()
    else:
        success = create_stations_with_direct_db()
    
    if success:
        print("Test stations created successfully")
        return 0
    else:
        print("Failed to create test stations")
        return 1

if __name__ == "__main__":
    sys.exit(main())
