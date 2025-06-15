# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Overview

Expresso is a comprehensive coffee ordering system designed for events and conferences, consisting of:

1. **Flask Backend**
   - RESTful API for all operations
   - PostgreSQL database
   - Twilio SMS integration
   - JWT authentication and role-based access control

2. **React Frontend**
   - Barista interface for order processing
   - Organizer interface for event management
   - Admin interface for configuration
   - Display screens for order status

3. **Mobile Interface**
   - QR code scanning for order status
   - SMS notifications for order updates

## Key Components

### Backend Components
- `app.py`: Main Flask application factory
- `run_server.py`: Entry point for backend server
- `routes/`: API and view routes
- `models/`: Database models (Orders, Users, Stations, Inventory)
- `services/`: Business logic (CoffeeSystem, Messaging, etc.)
- `utils/`: Utility functions
- `auth.py`: JWT authentication

### Frontend Components
- `Barista Front End/src/`: React application source
- `Barista Front End/src/components/`: UI components
- `Barista Front End/src/services/`: API clients and services
- `Barista Front End/src/hooks/`: React hooks for data management
- `Barista Front End/src/context/`: React context for state management

## Development Commands

### Backend Setup
```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create database (PostgreSQL required)
python scripts/database/pg_init.py

# Create admin user
python scripts/admin/create_admin.py

# Load test data
python scripts/database/load_test_data.py

# Run the backend server
python run_server.py
```

### Frontend Setup
```bash
# Navigate to frontend directory
cd "Barista Front End"

# Install dependencies
npm install

# Run development server
npm start

# Build for production
npm run build

# Run tests
npm test
```

### Full System Start
```bash
# Start the complete system with one command
./start_expresso.sh
```

### API Testing
```bash
# Test API connectivity
python test_api.py

# Test authentication
python test_auth_flow.py

# Test frontend-backend integration
python test_frontend_backend_integration.py

# Test JWT configuration
python test_jwt_config.py

# Run all tests
./run_all_tests.sh
```

### Test Environment Setup
```bash
# Set up a complete test environment with sample data
./prepare_test_environment.sh

# Run tests for specific components
./run_all_tests.sh --api-only   # Only test API
./run_all_tests.sh --frontend-only  # Only test frontend
```

### CORS and Authentication Fixes
```bash
# Fix CORS issues
python scripts/fix_cors.py
./fix-cors-and-restart.sh

# Fix authentication issues
python scripts/auth_diagnostic.py
```

## Testing Infrastructure

The system includes a comprehensive testing infrastructure:

1. **Backend Tests**:
   - API endpoint tests (`test_api.py`)
   - Authentication flow tests (`test_auth_flow.py`)
   - Integration tests (`test_frontend_backend_integration.py`)
   - JWT configuration tests (`test_jwt_config.py`)

2. **Frontend Tests**:
   - React component tests (Jest, e.g., `InProgressOrder.test.js`)
   - Service tests (e.g., `OrderDataService.test.js`)
   - End-to-end tests (Cypress, e.g., `barista_workflow.cy.js`)

3. **Test Scripts**:
   - `run_all_tests.sh`: Main test runner script
   - `prepare_test_environment.sh`: Sets up test data and environment

Refer to `TESTING.md` for detailed information about the testing architecture and best practices.

## API Structure

- All API endpoints are prefixed with `/api`
- JWT authentication is required for protected endpoints
- API follows a standardized response format
- Key endpoints:
  - `/api/orders`: Order management
  - `/api/stations`: Station management
  - `/api/inventory`: Inventory management
  - `/api/settings`: System settings
  - `/api/auth`: Authentication

## Database Schema

The system uses PostgreSQL with the following main tables:
- `users`: Authentication and user data
- `orders`: Customer orders
- `stations`: Barista stations
- `inventory`: Coffee and milk stock
- `settings`: System configuration
- `messages`: SMS communication

## User Roles

- **Admin**: Full system access and configuration
- **Staff/Organizer**: Event management and reporting
- **Barista**: Order processing and station management
- **Customer**: Order placement and tracking

## Common Development Tasks

When working with this codebase:

1. Always check both frontend and backend when implementing features
2. Use the JWT authentication system for new API endpoints
3. Follow the existing patterns for route organization
4. Use the services layer for business logic
5. Test API endpoints with the provided test scripts
6. Address CORS issues using the fix-cors-and-restart.sh script
7. Run tests after making changes to verify functionality
8. Add new tests for new features or bug fixes