"""
Script to add missing conversation_states table to the database
"""
import psycopg2
import logging
import os

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("database_fix")

# Connect to the database
db_url = os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost/expresso')

try:
    # Parse connection parameters from URL
    # Format: postgresql://user:password@host:port/dbname
    if '://' in db_url:
        parts = db_url.split('://', 1)[1].split('@')
        credentials = parts[0].split(':')
        user = credentials[0]
        password = credentials[1] if len(credentials) > 1 else ''
        
        hostdb = parts[1].split('/')
        hostport = hostdb[0].split(':')
        host = hostport[0]
        port = int(hostport[1]) if len(hostport) > 1 else 5432
        
        dbname = hostdb[1].split('?')[0]  # Remove query parameters if any
    else:
        # Default connection parameters
        user = 'postgres'
        password = 'postgres'
        host = 'localhost'
        port = 5432
        dbname = 'expresso'
    
    # Connect to PostgreSQL
    conn = psycopg2.connect(
        user=user,
        password=password,
        host=host,
        port=port,
        dbname=dbname
    )
    
    cursor = conn.cursor()

    # Create the missing conversation_states table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS conversation_states (
            phone TEXT PRIMARY KEY,
            state TEXT NOT NULL,
            temp_data JSONB,
            last_interaction TIMESTAMP,
            message_count INTEGER DEFAULT 1,
            context JSONB
        )
    ''')
    conn.commit()
    logger.info("Successfully created conversation_states table")
except Exception as e:
    logger.error(f"Error creating table: {str(e)}")
finally:
    if 'conn' in locals():
        conn.close()
