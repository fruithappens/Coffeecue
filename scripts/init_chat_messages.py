#!/usr/bin/env python
"""
Script to initialize sample chat messages in the database
Creates the chat_messages table if it doesn't exist and populates it with sample messages
"""

import sys
import os
import logging
from datetime import datetime, timedelta
import json
import random

# Add parent directory to path so we can import from the project
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import dependencies
import config
from utils.database import get_db_connection, close_connection

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("expresso.scripts.init_chat_messages")

# Sample data for chat messages
SAMPLE_MESSAGES = [
    {
        "sender": "Julia (Station #1)",
        "content": "Running low on alternative milks over here, anyone have extra?",
        "is_urgent": False,
        "station_id": 1,
        "time_ago": 15  # minutes ago
    },
    {
        "sender": "Barista (Station #3)",
        "content": "I can share some oat milk, will send it over.",
        "is_urgent": False,
        "station_id": 3,
        "time_ago": 14  # minutes ago
    },
    {
        "sender": "Alex (Station #2)",
        "content": "URGENT: Coffee machine is jamming at Station #2!",
        "is_urgent": True,
        "station_id": 2,
        "time_ago": 5  # minutes ago
    },
    {
        "sender": "Manager",
        "content": "Heading into morning rush hour soon. All stations please prepare extra cups and lids.",
        "is_urgent": False,
        "station_id": None,
        "time_ago": 30  # minutes ago
    },
    {
        "sender": "System",
        "content": "Daily reminder: Please clean your machines thoroughly at end of shift.",
        "is_urgent": False,
        "station_id": None,
        "time_ago": 60  # minutes ago
    },
    {
        "sender": "Michael (Station #1)",
        "content": "We've received a large group order for the conference room. 15 coffees needed by 10:30am.",
        "is_urgent": True,
        "station_id": 1,
        "time_ago": 45  # minutes ago
    },
    {
        "sender": "Sarah (Station #3)",
        "content": "Anyone know where the extra receipt paper is stored?",
        "is_urgent": False,
        "station_id": 3,
        "time_ago": 20  # minutes ago
    },
    {
        "sender": "David (Station #2)",
        "content": "Receipt paper is in the supply cabinet next to the break room.",
        "is_urgent": False,
        "station_id": 2,
        "time_ago": 18  # minutes ago
    }
]

def init_chat_messages():
    """Initialize chat messages table and add sample data"""
    try:
        # Connect to database
        logger.info("Connecting to database...")
        db = get_db_connection(config.DATABASE_URL)
        
        # Create chat_messages table if it doesn't exist
        cursor = db.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            is_urgent BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        db.commit()
        logger.info("Chat messages table created or already exists")
        
        # Check if station_id column exists, add it if needed
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='chat_messages' AND column_name='station_id'
        """)
        has_station_id = cursor.fetchone() is not None
        
        if not has_station_id:
            cursor.execute("""
                ALTER TABLE chat_messages 
                ADD COLUMN station_id INTEGER
            """)
            db.commit()
            logger.info("Added station_id column to chat_messages table")
        
        # Check if table already has data
        cursor.execute("SELECT COUNT(*) FROM chat_messages")
        count = cursor.fetchone()[0]
        
        if count > 0:
            logger.info(f"Chat messages table already has {count} messages")
            user_input = input("Chat messages already exist. Clear and repopulate? (y/n): ")
            if user_input.lower() != 'y':
                logger.info("Operation cancelled")
                return
            
            # Clear existing messages
            cursor.execute("DELETE FROM chat_messages")
            db.commit()
            logger.info("Existing chat messages cleared")
        
        # Insert sample messages
        now = datetime.now()
        for i, message in enumerate(SAMPLE_MESSAGES):
            created_at = now - timedelta(minutes=message["time_ago"])
            
            cursor.execute('''
                INSERT INTO chat_messages (
                    sender, content, is_urgent, station_id, created_at
                ) VALUES (%s, %s, %s, %s, %s)
            ''', (
                message["sender"],
                message["content"],
                message["is_urgent"],
                message["station_id"],
                created_at
            ))
            logger.info(f"Inserted message from {message['sender']}")
        
        # Create some random historical messages
        logger.info("Adding some historical messages...")
        historical_senders = [
            "Julia (Station #1)", "Alex (Station #2)", "Barista (Station #3)",
            "Michael (Station #1)", "Sarah (Station #3)", "David (Station #2)",
            "Manager", "System"
        ]
        
        historical_contents = [
            "Good morning everyone!",
            "We're out of oat milk at Station 2.",
            "Received a large order for 10 lattes.",
            "The new seasonal drinks menu is now active.",
            "Remember to check expiration dates on all milks.",
            "Can someone help restock cups at Station 1?",
            "System maintenance scheduled tonight at 9pm.",
            "Who's closing today?",
            "Morning rush handled well today, great job team!",
            "New coffee beans arrived, they smell amazing!",
            "Order #45678 was picked up by wrong customer - be careful!",
            "Can someone please bring more napkins to Station 3?",
            "Manager is doing quality checks today - keep your stations clean!",
            "WiFi password has been updated - check your email.",
            "Meeting after close today to discuss new procedures."
        ]
        
        # Add some random historical messages from past days
        for i in range(20):
            days_ago = random.randint(1, 7)
            hours_ago = random.randint(0, 23)
            minutes_ago = random.randint(0, 59)
            
            created_at = now - timedelta(days=days_ago, hours=hours_ago, minutes=minutes_ago)
            
            sender = random.choice(historical_senders)
            content = random.choice(historical_contents)
            is_urgent = random.random() < 0.2  # 20% chance of being urgent
            station_id = None
            
            if "Station #1" in sender:
                station_id = 1
            elif "Station #2" in sender:
                station_id = 2
            elif "Station #3" in sender:
                station_id = 3
            
            cursor.execute('''
                INSERT INTO chat_messages (
                    sender, content, is_urgent, station_id, created_at
                ) VALUES (%s, %s, %s, %s, %s)
            ''', (
                sender,
                content,
                is_urgent,
                station_id,
                created_at
            ))
        
        db.commit()
        logger.info("Successfully initialized chat messages with sample data")
        
    except Exception as e:
        logger.error(f"Error initializing chat messages: {str(e)}")
        if 'db' in locals() and db:
            db.rollback()
    finally:
        if 'db' in locals() and db:
            close_connection(db)
            logger.info("Database connection closed")

if __name__ == "__main__":
    init_chat_messages()
    print("Chat messages initialization complete.")