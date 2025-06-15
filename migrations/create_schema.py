# create_schema.py
from database import db

def create_tables():
    # These are PostgreSQL versions of your table definitions
    db.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL,
        full_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
    )
    """)
    
    db.execute("""
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_number VARCHAR(20) UNIQUE NOT NULL,
        phone VARCHAR(20) NOT NULL,
        order_details JSONB NOT NULL,
        status VARCHAR(20) NOT NULL,
        station_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completion_time INTEGER,
        queue_priority INTEGER DEFAULT 5,
        for_friend VARCHAR(255),
        group_order BOOLEAN DEFAULT FALSE,
        payment_status VARCHAR(20) DEFAULT 'sponsored',
        barista_notes TEXT,
        last_modified_by VARCHAR(100)
    )
    """)
    
    # Add more tables here...
    
    # Create indexes for better performance
    db.execute("CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)")
    db.execute("CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)")

if __name__ == "__main__":
    create_tables()
    print("Schema created successfully!")