#!/bin/bash
# Script to prepare the testing environment for Expresso/Coffee Cue System
# Creates necessary test data and configurations

# Set colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print a header
print_header() {
    echo
    echo -e "${BLUE}=============================================${NC}"
    echo -e "${BLUE} $1 ${NC}"
    echo -e "${BLUE}=============================================${NC}"
    echo
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if backend server is already running
check_server() {
    curl -s http://localhost:5001/api/status > /dev/null
    return $?
}

# Create test database and load sample data
setup_database() {
    print_header "SETTING UP TEST DATABASE"
    
    # Initialize or reset database
    python scripts/database/pg_init.py
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to initialize database${NC}"
        echo -e "${YELLOW}Trying alternative initialization...${NC}"
        
        # Try SQLite initialization if available
        if [ -f "load_test_data.py" ]; then
            python load_test_data.py
            
            if [ $? -ne 0 ]; then
                echo -e "${RED}Failed to load test data${NC}"
                return 1
            fi
        else
            echo -e "${RED}No database initialization scripts found${NC}"
            return 1
        fi
    fi
    
    echo -e "${GREEN}Database initialized successfully${NC}"
    
    # Create test admin user
    python scripts/admin/create_admin.py
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create admin user${NC}"
        echo -e "${YELLOW}Trying alternative script...${NC}"
        
        # Try alternative script
        if [ -f "create_admin.py" ]; then
            python create_admin.py
            
            if [ $? -ne 0 ]; then
                echo -e "${RED}Failed to create admin user${NC}"
                echo -e "${YELLOW}You may need to create admin user manually${NC}"
            fi
        fi
    else
        echo -e "${GREEN}Admin user created successfully${NC}"
    fi
    
    return 0
}

# Ensure frontend dependencies are installed
setup_frontend() {
    print_header "SETTING UP FRONTEND DEPENDENCIES"
    
    # Check if npm is installed
    if ! command_exists npm; then
        echo -e "${RED}npm is not installed. Please install Node.js and npm.${NC}"
        return 1
    fi
    
    # Enter frontend directory and install dependencies
    if [ -d "Barista Front End" ]; then
        cd "Barista Front End"
        
        # Install dependencies
        echo -e "${YELLOW}Installing frontend dependencies...${NC}"
        npm install
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}Failed to install frontend dependencies${NC}"
            cd ..
            return 1
        fi
        
        # Create Cypress directory if it doesn't exist
        if [ ! -d "cypress" ]; then
            echo -e "${YELLOW}Setting up Cypress for e2e testing...${NC}"
            npm install --save-dev cypress
            
            # Create Cypress e2e directory
            mkdir -p cypress/e2e
        fi
        
        echo -e "${GREEN}Frontend dependencies installed successfully${NC}"
        cd ..
    else
        echo -e "${RED}Frontend directory not found${NC}"
        return 1
    fi
    
    return 0
}

# Create test users if needed
create_test_users() {
    print_header "CREATING TEST USERS"
    
    # Create a Python script to insert test users
    cat > create_test_users.py << 'EOF'
#!/usr/bin/env python
"""
Creates test users for testing authentication and role-based access
"""
import sys
import os
import hashlib
import json

try:
    # First try to import from a package
    from models.users import User
    from utils.database import db_session
    MODELS_IMPORTED = True
except ImportError:
    MODELS_IMPORTED = False
    print("Could not import User model, using direct database connection.")

# Test users to create
TEST_USERS = [
    {
        "username": "barista",
        "password": "barista123",
        "role": "barista",
        "name": "Test Barista"
    },
    {
        "username": "admin",
        "password": "admin123",
        "role": "admin",
        "name": "Test Admin"
    },
    {
        "username": "organizer",
        "password": "organizer123",
        "role": "organizer",
        "name": "Test Organizer"
    }
]

def create_users_with_model():
    """Create users using the User model"""
    for user_data in TEST_USERS:
        # Check if user already exists
        existing_user = User.query.filter_by(username=user_data["username"]).first()
        
        if existing_user:
            print(f"User '{user_data['username']}' already exists")
            continue
        
        # Create new user
        new_user = User(
            username=user_data["username"],
            name=user_data["name"],
            role=user_data["role"]
        )
        new_user.set_password(user_data["password"])
        
        db_session.add(new_user)
        print(f"Created user: {user_data['username']} (role: {user_data['role']})")
    
    # Commit changes
    db_session.commit()
    print("All users created successfully")
    return True

def create_users_with_direct_db():
    """Create users by writing to a direct DB file (fallback method)"""
    try:
        import sqlite3
        
        # Try to connect to the SQLite database
        conn = sqlite3.connect('coffee_orders.db')
        cursor = conn.cursor()
        
        # Check if users table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if not cursor.fetchone():
            # Create users table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE,
                password_hash TEXT,
                name TEXT,
                role TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            ''')
        
        for user_data in TEST_USERS:
            # Check if user already exists
            cursor.execute("SELECT id FROM users WHERE username = ?", (user_data["username"],))
            if cursor.fetchone():
                print(f"User '{user_data['username']}' already exists")
                continue
            
            # Hash the password
            password_hash = hashlib.sha256(user_data["password"].encode()).hexdigest()
            
            # Insert user
            cursor.execute('''
            INSERT INTO users (username, password_hash, name, role)
            VALUES (?, ?, ?, ?)
            ''', (
                user_data["username"],
                password_hash,
                user_data["name"],
                user_data["role"]
            ))
            
            print(f"Created user: {user_data['username']} (role: {user_data['role']})")
        
        # Commit changes
        conn.commit()
        conn.close()
        print("All users created successfully")
        return True
        
    except Exception as e:
        print(f"Error creating users: {e}")
        return False

def main():
    """Main function"""
    print("Creating test users...")
    
    if MODELS_IMPORTED:
        success = create_users_with_model()
    else:
        success = create_users_with_direct_db()
    
    if success:
        print("Test users created successfully")
        return 0
    else:
        print("Failed to create test users")
        return 1

if __name__ == "__main__":
    sys.exit(main())
EOF

    # Make the script executable
    chmod +x create_test_users.py
    
    # Run the script
    python create_test_users.py
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create test users${NC}"
        return 1
    fi
    
    echo -e "${GREEN}Test users created successfully${NC}"
    return 0
}

# Create test stations for barista testing
create_test_stations() {
    print_header "CREATING TEST STATIONS"
    
    # Create a Python script to insert test stations
    cat > create_test_stations.py << 'EOF'
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
EOF

    # Make the script executable
    chmod +x create_test_stations.py
    
    # Run the script
    python create_test_stations.py
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create test stations${NC}"
        return 1
    fi
    
    echo -e "${GREEN}Test stations created successfully${NC}"
    return 0
}

# Create sample orders for testing
create_sample_orders() {
    print_header "CREATING SAMPLE ORDERS"
    
    # Create a Python script to insert sample orders
    cat > create_sample_orders.py << 'EOF'
#!/usr/bin/env python
"""
Creates sample orders for testing the order management system
"""
import sys
import os
import json
import random
import datetime
import uuid

try:
    # First try to import from a package
    from models.orders import Order
    from utils.database import db_session
    MODELS_IMPORTED = True
except ImportError:
    MODELS_IMPORTED = False
    print("Could not import Order model, using direct database connection.")

# Sample coffee types
COFFEE_TYPES = ["Cappuccino", "Latte", "Flat White", "Long Black", "Espresso", "Macchiato"]

# Sample milk options
MILK_OPTIONS = ["Full cream", "Skim milk", "Soy milk", "Almond milk", "Oat milk"]

# Sample sizes
SIZES = ["Small", "Regular", "Large"]

# Sample sugar options
SUGAR_OPTIONS = ["No sugar", "1 sugar", "2 sugar", "3 sugar"]

# Sample customer names
CUSTOMER_NAMES = [
    "Alice Smith", "Bob Johnson", "Charlie Brown", "Diana Prince", 
    "Edward Jones", "Fatima Ahmed", "George Wilson", "Hannah Davis",
    "Ivan Petrov", "Julia Roberts", "Kevin Hart", "Lisa Simpson",
    "Michael Scott", "Nancy Drew", "Oliver Twist", "Patricia Lee",
    "Quincy Adams", "Rachel Green", "Sam Wilson", "Tina Turner"
]

# Create a mix of orders with different statuses
def generate_orders(count=30):
    """Generate a list of sample orders"""
    orders = []
    now = datetime.datetime.now()
    
    for i in range(count):
        # Basic order data
        order_id = f"ORD{random.randint(1000, 9999)}"
        customer_name = random.choice(CUSTOMER_NAMES)
        coffee_type = random.choice(COFFEE_TYPES)
        milk = random.choice(MILK_OPTIONS)
        size = random.choice(SIZES)
        sugar = random.choice(SUGAR_OPTIONS)
        created_at = now - datetime.timedelta(minutes=random.randint(5, 120))
        
        # Determine status (weighted towards pending for testing)
        status_weights = [
            ("pending", 0.5), 
            ("in_progress", 0.3), 
            ("completed", 0.15),
            ("picked_up", 0.05)
        ]
        status = random.choices(
            [sw[0] for sw in status_weights],
            weights=[sw[1] for sw in status_weights],
            k=1
        )[0]
        
        # Additional timestamps based on status
        started_at = None
        completed_at = None
        picked_up_at = None
        
        if status == "in_progress" or status == "completed" or status == "picked_up":
            started_at = created_at + datetime.timedelta(minutes=random.randint(1, 10))
            
        if status == "completed" or status == "picked_up":
            completed_at = started_at + datetime.timedelta(minutes=random.randint(3, 15))
            
        if status == "picked_up":
            picked_up_at = completed_at + datetime.timedelta(minutes=random.randint(1, 10))
        
        # VIP flag (10% chance)
        is_vip = random.random() < 0.1
        
        # Generate estimated completion time
        if status == "pending" or status == "in_progress":
            estimated_completion = now + datetime.timedelta(minutes=random.randint(3, 15))
        else:
            estimated_completion = None
            
        # Create order object
        order = {
            "order_number": order_id,
            "name": customer_name,
            "type": coffee_type,
            "milk": milk,
            "size": size,
            "sugar": sugar,
            "notes": f"Sample order for {customer_name}",
            "status": status,
            "created_at": created_at.isoformat(),
            "started_at": started_at.isoformat() if started_at else None,
            "completed_at": completed_at.isoformat() if completed_at else None,
            "picked_up_at": picked_up_at.isoformat() if picked_up_at else None,
            "vip": is_vip,
            "estimated_completion_time": estimated_completion.isoformat() if estimated_completion else None
        }
        
        orders.append(order)
    
    return orders

def create_orders_with_model(orders):
    """Create orders using the Order model"""
    for order_data in orders:
        # Check if order already exists
        existing_order = Order.query.filter_by(order_number=order_data["order_number"]).first()
        
        if existing_order:
            print(f"Order '{order_data['order_number']}' already exists")
            continue
        
        # Create new order (adjust as needed for your model)
        new_order = Order(
            order_number=order_data["order_number"],
            name=order_data["name"],
            type=order_data["type"],
            milk=order_data["milk"],
            size=order_data["size"],
            sugar=order_data["sugar"],
            notes=order_data["notes"],
            status=order_data["status"],
            created_at=order_data["created_at"],
            started_at=order_data["started_at"],
            completed_at=order_data["completed_at"],
            picked_up_at=order_data["picked_up_at"],
            vip=order_data["vip"],
            estimated_completion_time=order_data["estimated_completion_time"]
        )
        
        db_session.add(new_order)
        print(f"Created order: {order_data['order_number']} ({order_data['status']})")
    
    # Commit changes
    db_session.commit()
    print("All orders created successfully")
    return True

def create_orders_with_direct_db(orders):
    """Create orders by writing to a direct DB file (fallback method)"""
    try:
        import sqlite3
        
        # Try to connect to the SQLite database
        conn = sqlite3.connect('coffee_orders.db')
        cursor = conn.cursor()
        
        # Check if orders table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'")
        if not cursor.fetchone():
            # Create orders table if it doesn't exist
            cursor.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY,
                order_number TEXT UNIQUE,
                name TEXT,
                type TEXT,
                milk TEXT,
                size TEXT,
                sugar TEXT,
                notes TEXT,
                status TEXT,
                created_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                picked_up_at TEXT,
                vip INTEGER,
                estimated_completion_time TEXT
            )
            ''')
        
        for order_data in orders:
            # Check if order already exists
            cursor.execute("SELECT id FROM orders WHERE order_number = ?", (order_data["order_number"],))
            if cursor.fetchone():
                print(f"Order '{order_data['order_number']}' already exists")
                continue
            
            # Insert order
            cursor.execute('''
            INSERT INTO orders (
                order_number, name, type, milk, size, sugar, notes, status,
                created_at, started_at, completed_at, picked_up_at, 
                vip, estimated_completion_time
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                order_data["order_number"],
                order_data["name"],
                order_data["type"],
                order_data["milk"],
                order_data["size"],
                order_data["sugar"],
                order_data["notes"],
                order_data["status"],
                order_data["created_at"],
                order_data["started_at"],
                order_data["completed_at"],
                order_data["picked_up_at"],
                1 if order_data["vip"] else 0,
                order_data["estimated_completion_time"]
            ))
            
            print(f"Created order: {order_data['order_number']} ({order_data['status']})")
        
        # Commit changes
        conn.commit()
        conn.close()
        print("All orders created successfully")
        return True
        
    except Exception as e:
        print(f"Error creating orders: {e}")
        return False

def main():
    """Main function"""
    print("Creating sample orders...")
    
    # Generate sample orders
    orders = generate_orders(30)  # Create 30 sample orders
    
    if MODELS_IMPORTED:
        success = create_orders_with_model(orders)
    else:
        success = create_orders_with_direct_db(orders)
    
    if success:
        print("Sample orders created successfully")
        return 0
    else:
        print("Failed to create sample orders")
        return 1

if __name__ == "__main__":
    sys.exit(main())
EOF

    # Make the script executable
    chmod +x create_sample_orders.py
    
    # Run the script
    python create_sample_orders.py
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create sample orders${NC}"
        return 1
    fi
    
    echo -e "${GREEN}Sample orders created successfully${NC}"
    return 0
}

# Ensure Cypress directories exist
setup_cypress() {
    print_header "SETTING UP CYPRESS"
    
    if [ -d "Barista Front End" ]; then
        cd "Barista Front End"
        
        # Check if Cypress is installed
        if [ ! -d "node_modules/cypress" ]; then
            echo -e "${YELLOW}Installing Cypress...${NC}"
            npm install --save-dev cypress
            
            if [ $? -ne 0 ]; then
                echo -e "${RED}Failed to install Cypress${NC}"
                cd ..
                return 1
            fi
        fi
        
        # Create Cypress directories if they don't exist
        mkdir -p cypress/e2e
        mkdir -p cypress/support
        mkdir -p cypress/fixtures
        
        # Create Cypress config file if it doesn't exist
        if [ ! -f "cypress.config.js" ]; then
            cat > cypress.config.js << 'EOF'
const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
})
EOF
        fi
        
        # Create support files if they don't exist
        if [ ! -f "cypress/support/e2e.js" ]; then
            cat > cypress/support/e2e.js << 'EOF'
// ***********************************************************
// This example support/e2e.js is processed and
// loaded automatically before your test files.
//
// This is a great place to put global configuration and
// behavior that modifies Cypress.
//
// You can change the location of this file or turn off
// automatically serving support files with the
// 'supportFile' configuration option.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.js using ES2015 syntax:
import './commands'
EOF
        fi
        
        if [ ! -f "cypress/support/commands.js" ]; then
            cat > cypress/support/commands.js << 'EOF'
// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

// Custom command to login to the application
Cypress.Commands.add('login', (username = 'barista', password = 'barista123') => {
  cy.visit('/login')
  cy.get('input[name="username"]').type(username)
  cy.get('input[name="password"]').type(password)
  cy.get('button[type="submit"]').click()
  
  // Verify we're logged in and redirected to the barista interface
  cy.url().should('include', '/barista')
})
EOF
        fi
        
        echo -e "${GREEN}Cypress setup complete${NC}"
        cd ..
    else
        echo -e "${RED}Frontend directory not found${NC}"
        return 1
    fi
    
    return 0
}

# Main function
main() {
    print_header "EXPRESSO/COFFEE CUE TEST ENVIRONMENT SETUP"
    
    # Check if server is already running
    if check_server; then
        echo -e "${GREEN}Backend server is already running at http://localhost:5001${NC}"
    else
        echo -e "${YELLOW}Backend server is not running${NC}"
        echo -e "${YELLOW}This script will prepare the test environment but you'll need to start the server separately${NC}"
    fi
    
    # Setup database
    setup_database
    
    # Create test users
    create_test_users
    
    # Create test stations
    create_test_stations
    
    # Create sample orders
    create_sample_orders
    
    # Setup frontend
    setup_frontend
    
    # Setup Cypress
    setup_cypress
    
    print_header "ENVIRONMENT SETUP COMPLETE"
    echo -e "${GREEN}The test environment has been prepared successfully.${NC}"
    echo -e "${YELLOW}To run the tests, start the backend server if not already running:${NC}"
    echo "    python run_server.py"
    echo -e "${YELLOW}Then run the tests:${NC}"
    echo "    ./run_all_tests.sh"
    
    return 0
}

# Run the main function
main