# sms_database_test.py
"""
Standalone script to test SMS database interactions
"""
import sys
import os
import json
import logging

# Add the project root to Python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("sms_database_test")

def test_sms_database_interaction():
    """
    Comprehensive test of SMS-related database interactions
    """
    try:
        # Import necessary modules
        from services.coffee_system import CoffeeOrderSystem
        from utils.database import get_db_connection

        # Get database connection
        db = get_db_connection()
        
        # Initialize coffee system
        coffee_system = CoffeeOrderSystem(db)
        
        # Test conversation states table
        cursor = db.cursor()
        
        # Ensure conversation_states table exists
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS conversation_states (
                phone VARCHAR(20) PRIMARY KEY,
                state VARCHAR(50),
                temp_data JSONB,
                last_interaction TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER DEFAULT 1,
                context JSONB
            )
        """)
        
        # Test inserting a conversation state
        test_phone = '+1234567890'
        test_state = 'test_state'
        test_data = {'test_key': 'test_value'}
        
        # Use json.dumps to properly serialize the dictionary
        cursor.execute("""
            INSERT INTO conversation_states 
            (phone, state, temp_data) 
            VALUES (%s, %s, %s)
            ON CONFLICT (phone) DO UPDATE
            SET state = EXCLUDED.state,
                temp_data = EXCLUDED.temp_data,
                last_interaction = CURRENT_TIMESTAMP
        """, (test_phone, test_state, json.dumps(test_data)))
        
        db.commit()
        
        # Verify insertion
        cursor.execute("""
            SELECT * FROM conversation_states 
            WHERE phone = %s
        """, (test_phone,))
        result = cursor.fetchone()
        
        logger.info("Conversation state test result:")
        logger.info(f"Result: {result}")
        
        # Test SMS message logging
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sms_log (
                id SERIAL PRIMARY KEY,
                phone VARCHAR(20),
                message TEXT,
                received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor.execute("""
            INSERT INTO sms_log (phone, message)
            VALUES (%s, %s)
        """, (test_phone, 'Test SMS message'))
        
        db.commit()
        
        # Verify SMS log
        cursor.execute("""
            SELECT * FROM sms_log 
            WHERE phone = %s
        """, (test_phone,))
        sms_log_result = cursor.fetchone()
        
        logger.info("SMS log test result:")
        logger.info(f"Result: {sms_log_result}")
        
        return True
    
    except Exception as e:
        logger.error(f"Database interaction test failed: {str(e)}", exc_info=True)
        return False

def main():
    """
    Main function to run the database test
    """
    print("Starting SMS Database Interaction Test...")
    
    if test_sms_database_interaction():
        print("✅ SMS Database Test Successful")
    else:
        print("❌ SMS Database Test Failed")

if __name__ == '__main__':
    main()