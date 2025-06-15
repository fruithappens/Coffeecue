#!/usr/bin/env python
"""
Script to initialize default settings in the database
This ensures that the application has the necessary settings on first run
"""

import sys
import os
import logging
import json
from datetime import datetime

# Add parent directory to path so we can import from the project
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import dependencies
import config
from utils.database import get_db_connection, close_connection
from models.users import Settings

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("expresso.scripts.init_settings")

def init_settings():
    """Initialize default settings in the database"""
    try:
        # Connect to database
        logger.info("Connecting to database...")
        db = get_db_connection(config.DATABASE_URL)
        
        # Ensure settings table exists
        cursor = db.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            updated_by VARCHAR(100)
        )
        ''')
        db.commit()
        
        # Default settings
        default_settings = {
            # System settings
            "system_name": {
                "value": "Coffee Cue",
                "description": "Name of the coffee ordering system"
            },
            "event_name": {
                "value": config.EVENT_NAME,
                "description": "Name of the current event"
            },
            
            # Sponsor settings
            "sponsor_display_enabled": {
                "value": "false",
                "description": "Whether to display sponsor information"
            },
            "sponsor_name": {
                "value": "ANZCA",
                "description": "Name of the sponsor"
            },
            "sponsor_message": {
                "value": "Coffee service proudly sponsored by {sponsor}",
                "description": "Message template for sponsor"
            },
            
            # Display settings
            "display_timeout": {
                "value": "300",
                "description": "Time in seconds before display refreshes"
            },
            "display_mode": {
                "value": "standard",
                "description": "Display mode (standard, compact, expanded)"
            },
            
            # Wait time settings
            "default_wait_time": {
                "value": "8-10",
                "description": "Default wait time to display"
            },
            
            # Station settings
            "station_1_name": {
                "value": "Main Hall",
                "description": "Name of station #1"
            },
            "station_2_name": {
                "value": "Exhibition Hall",
                "description": "Name of station #2"
            },
            "station_3_name": {
                "value": "Registration Area",
                "description": "Name of station #3"
            },
            
            # Message templates
            "sms_ready_template": {
                "value": "Your coffee is ready for pickup at {station}! Order #{order}",
                "description": "Message template for ready notification"
            },
            "sms_reminder_template": {
                "value": "Reminder: Your coffee is waiting at {station}. Order #{order}",
                "description": "Message template for reminder"
            },
            
            # Venue map and location settings
            "venue_map_url": {
                "value": "",
                "description": "URL for venue map with coffee stations marked"
            },
            "venue_map_tiny_url": {
                "value": "",
                "description": "Short URL for venue map with coffee stations"
            }
        }
        
        # Insert or update settings
        for key, data in default_settings.items():
            # Check if setting exists
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            exists = cursor.fetchone() is not None
            
            if not exists:
                # Insert new setting
                logger.info(f"Creating setting: {key}")
                cursor.execute('''
                    INSERT INTO settings (key, value, description, updated_at, updated_by)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (key, data["value"], data["description"], datetime.now(), "system_init"))
            else:
                logger.info(f"Setting already exists: {key}")
        
        db.commit()
        logger.info("Default settings initialized successfully")
        
        # Create station stats table if it doesn't exist
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS station_stats (
            station_id INTEGER PRIMARY KEY,
            name VARCHAR(100),
            location VARCHAR(100),
            status VARCHAR(20) DEFAULT 'inactive',
            barista_name VARCHAR(100),
            current_load INTEGER DEFAULT 0,
            wait_time INTEGER DEFAULT 10,
            specialist_drinks TEXT,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        db.commit()
        
        # Initialize station stats with default values
        for i in range(1, 4):
            # Check if station exists
            cursor.execute("SELECT station_id FROM station_stats WHERE station_id = %s", (i,))
            exists = cursor.fetchone() is not None
            
            if not exists:
                # Get station name from settings
                cursor.execute(f"SELECT value FROM settings WHERE key = 'station_{i}_name'")
                name_result = cursor.fetchone()
                name = name_result[0] if name_result else f"Station #{i}"
                
                # Insert new station
                logger.info(f"Initializing station: {i}")
                cursor.execute('''
                    INSERT INTO station_stats (
                        station_id, name, location, status, 
                        barista_name, current_load, wait_time
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ''', (i, name, "Main Venue", "active", "Unassigned", 0, 10))
            else:
                logger.info(f"Station already exists: {i}")
        
        db.commit()
        logger.info("Station stats initialized successfully")
        
    except Exception as e:
        logger.error(f"Error initializing settings: {str(e)}")
        if 'db' in locals() and db:
            db.rollback()
    finally:
        if 'db' in locals() and db:
            close_connection(db)
            logger.info("Database connection closed")

if __name__ == "__main__":
    init_settings()
    print("Settings initialization complete.")