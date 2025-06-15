# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## System Overview

**IMPORTANT: This is a PRODUCTION-READY coffee ordering platform, not a prototype. The goal is to deploy to cloud platforms (AWS/Azure) with pay-per-hour billing model. All development should prioritize fixing issues, not disabling features.**

Expresso is a comprehensive coffee ordering system designed for events and conferences. The system is evolving from "event coffee management" → "intelligent coffee ecosystem" → "predictive event experience platform".

### Current Production Status
- **Core Functionality**: 85% operational (order lifecycle, authentication, SMS integration)
- **Deployment Ready**: Local environment fully functional with automated startup scripts
- **Cloud Migration Target**: AWS/Azure with S3-style pay-per-hour billing
- **White-Label Ready**: Complete customization for different organizations/events

### Core Components

1. **Flask Backend** (Python 3.x)
   - RESTful API with Flask 2.3.3
   - PostgreSQL database with SQLite fallback
   - Twilio SMS integration  
   - JWT authentication with refresh tokens (15-min access, 7-day refresh)
   - WebSocket support with Flask-SocketIO for real-time updates
   - Role-based access control (Admin, Staff/Organizer, Barista, Customer)

2. **React Frontend** (React 18.2) - Four Main Interfaces:
   - **Landing Page**: Entry point for all users
   - **Barista Interface**: Order processing and station management
   - **Organiser Interface**: Event configuration and inventory management
   - **Support Interface**: System monitoring and diagnostics
   - Offline support with Service Workers and localStorage caching
   - Tailwind CSS v3 for styling

3. **Mobile Interface**
   - QR code scanning for order status
   - SMS notifications for order updates

### Architecture Principles
- **Data Flow**: Organiser → Stations → Barista
- **Inventory Management**: Configured at Event level, then filtered per Station
- **State Management**: React hooks (useOrders, useStations, useStock, useSettings)
- **Service Architecture**: Singleton patterns for core services

## Development Commands

### Quick Start
```bash
# Start the complete system with one command (macOS)
./start_expresso.sh
# This will:
# - Start PostgreSQL (via Homebrew)
# - Create database if needed
# - Launch backend on port 5001
# - Launch frontend on port 3000
# - Start ngrok for public URL access
# - Open all services in separate Terminal tabs

# Alternative startup scripts for different scenarios:
./start_expresso_fast.sh       # Skip ngrok for faster startup
./start_expresso_complete.sh   # Full system with all monitoring
./start_expresso_with_twilio.sh # Include Twilio webhook setup
./quick_start.sh               # Minimal setup for development
```

### Backend Setup
```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create database (PostgreSQL required)
python pg_init.py

# Create admin user
python create_admin.py

# Load test data
python load_test_data.py

# Run the backend server
python run_server.py
```

### Frontend Setup
```bash
# Navigate to frontend directory (note the space in the name)
cd "Barista Front End"

# Install dependencies
npm install

# Run development server (port 3000, proxies API to port 5001)
npm start

# Build for production
npm run build

# Run Jest unit tests
npm test

# Run tests without watch mode
npm test -- --watchAll=false
```

### Testing Commands

```bash
# Set up complete test environment with sample data
./prepare_test_environment.sh
# Creates test users: barista/barista123, admin/admin123, organizer/organizer123
# Creates 3 test stations with different capabilities
# Generates 30 sample orders in various states

# Run all tests
./run_all_tests.sh

# Run specific test suites
./run_all_tests.sh --api-only      # Backend API tests only
./run_all_tests.sh --frontend-only # Frontend tests only
./run_all_tests.sh --db-only       # Database tests only

# Python code quality and linting
black .                             # Format Python code
isort .                             # Sort Python imports
pytest                              # Run Python unit tests
coverage run -m pytest             # Run tests with coverage
coverage report                     # Show coverage report

# Individual test files
python test-api-endpoints.py
python test-barista-route-with-auth.py
python test-fresh-token.py
python test-walk-in-order-direct.py

# Backend test files (from _archive/backend/tests)
python test_api.py --all
python test_frontend_backend_integration.py
python test_auth_flow.py
python test_jwt_config.py
python test_cors.py
python test_inventory_endpoints.py

# Cypress E2E tests (from frontend directory)
cd "Barista Front End"
npx cypress open  # Interactive mode
npx cypress run   # Headless mode

# Live test environment (creates test orders continuously)
./live-test-environment.sh
# This monitors:
# - Frontend console logs
# - API traffic between frontend and backend  
# - Potential hardcoded data in codebase
# - Database content analysis
# Results in: /logs/live_test/
```

## Architecture

### Authentication Flow
- JWT tokens with refresh token support
- Role-based access control (Admin, Staff/Organizer, Barista, Customer)
- Frontend stores tokens in localStorage
- API requests use Authorization header: `Bearer <token>`
- Token refresh handled automatically by ApiService
- Access tokens expire in 15 minutes, refresh tokens in 7 days
- WebSocket authentication via JWT tokens

### API Structure
- Base URL: `/api`
- All endpoints require JWT authentication except `/api/auth/login`
- Standardized response format:
  ```json
  {
    "success": true/false,
    "status": "success|error",
    "data": {},
    "message": "Optional message"
  }
  ```
- All endpoints follow RESTful conventions
- Consistent error handling with appropriate HTTP status codes

### Frontend Service Architecture
- `ApiService.js`: Centralized API client with auth handling and token refresh
- `OrderDataService.js`: Order management with offline support
- `AuthService.js`: Authentication and token management
- `ConfigService.js`: Configuration and environment detection
- `FallbackService.js`: Offline data caching
- `WebSocketService.js`: Real-time communication (order_update, station_update, support:metric_update)
- `NotificationService.js`: Order notifications and alerts
- `InventoryIntegrationService.js`: Bridges Organiser inventory with Barista stock system

### Database Schema
PostgreSQL tables:
- `users`: Authentication with hashed passwords and roles
- `orders`: Customer orders with status tracking
- `stations`: Barista workstations with capabilities
- `inventory`: Coffee and milk stock levels
- `settings`: System configuration (branding, SMS, etc.)
- `messages`: SMS communication logs
- `chat_messages`: Station-to-station messaging

## Key Features

### Offline Support
The frontend includes comprehensive offline support:
- Automatic detection of connection status
- Cached data for offline operation
- Queue for pending API calls
- Graceful degradation of features
- Service worker for offline functionality

### Order Processing Flow
1. Customer places order (SMS/QR)
2. Order appears in pending list
3. Barista claims order at station
4. Order moves to in-progress
5. Barista completes order
6. Customer notified via SMS

### Station Management
- Stations have capabilities (coffee types, milk options)
- Load balancing across stations
- Real-time status updates
- Chat between stations
- Station-specific inventory tracking

### Organiser Interface Features
The Organiser Interface provides comprehensive event management:

#### Inventory Management (`InventoryManagement.js`)
- **Categories**: Milk & Dairy, Coffee Types, Cups & Sizes, Syrups & Flavors, Sugars & Sweeteners, Extras & Add-ons
- Add/Edit/Delete custom items
- Enable/Disable items
- Bulk operations for categories
- Pre-loaded templates for common items

#### Station Configuration (`StationSettings.js` & `StationInventoryConfig.js`)
- Add/Edit/Delete stations
- Set station name, location, capacity
- Active/Inactive/Maintenance modes
- Assign specific inventory items to each station
- Configure station capabilities

### Support Interface Features
The Support Interface provides real-time system monitoring:

#### Current Features
- Basic system health monitoring
- Real-time order tracking
- Station status overview
- Error monitoring component
- WebSocket integration for live updates

#### Planned Features
- Live Operations Dashboard with order flow visualization
- Quick Actions Panel (emergency stop, broadcast messages)
- Performance metrics (completion times, efficiency scores)
- System health details (DB status, API response times)

### Environment Configuration
Key environment variables in `.env`:
- `DATABASE_URL`: PostgreSQL connection string
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`: SMS configuration
- `JWT_SECRET_KEY`: For JWT token signing
- `TESTING_MODE`: Set to False in production
- `CORS_ALLOWED_ORIGINS`: Frontend URL(s)

## Troubleshooting

### CORS Issues
```bash
# Check current CORS configuration
grep CORS .env

# Ensure frontend URL is in CORS_ALLOWED_ORIGINS
# Default includes: http://localhost:3000,http://127.0.0.1:3000
```

### Authentication Problems
```bash
# Debug JWT configuration
python test-jwt-config.py

# Test authentication flow
python test-auth-flow.py

# Test fresh token generation
python test-fresh-token.py

# Create new admin user
python create_admin.py --force
```

### Frontend Can't Connect to Backend
- Check proxy configuration in `Barista Front End/package.json` (should proxy to http://localhost:5001)
- Ensure backend is running on port 5001
- Check `Barista Front End/src/config/apiConfig.js` for API URL
- Verify CORS settings in `.env` include frontend URL

### Database Connection Issues
```bash
# Test PostgreSQL connection
python scripts/check_admin_users_table.py

# Initialize database schema
python pg_init.py

# Reset admin user
python scripts/reset_admin.py
```

## Default Credentials
- **Primary Admin**: coffeecue/adminpassword ✅ (WORKING - Use this for login!)
- Secondary Admin: admin/coffee123 (password may be incorrect)
- Test Barista: barista/barista123
- Test Admin: admin/admin123
- Test Organizer: organizer/organizer123

**NOTE**: JWT tokens expire and need refresh. If you get 401 errors, use the working credentials above.

## API Documentation
Detailed API documentation is available in:
- `API-REFERENCE.md`: Complete API endpoint specifications
- `API-IMPLEMENTATION-STATUS.md`: Current implementation status
- `FRONTEND-BACKEND-INTEGRATION.md`: Integration details

## Code Standards
- Python: Use Black formatter, follow PEP 8
- JavaScript: Standard React conventions
- API responses: Always use standardized format
- Authentication: All API calls except login require JWT
- Error handling: Return descriptive error messages with appropriate HTTP status codes

## Performance Targets
- Dashboard load time: < 2 seconds
- WebSocket latency: < 100ms
- API response time: < 500ms for standard operations
- Order processing: < 3 seconds end-to-end

## Development Best Practices
- Always run `black .` and `isort .` after making Python code changes
- Always run `npm test -- --watchAll=false` after making frontend changes in the "Barista Front End" directory
- Use the existing service architecture patterns when adding new functionality
- Follow the standardized API response format for all new endpoints
- Maintain the singleton patterns for core services
- Test authentication flow after making auth-related changes with `python test-fresh-token.py`

## Critical Architecture Notes

### Frontend Directory Structure
- Frontend is located in `"Barista Front End"` directory (note the space in the name)
- Always use quotes when navigating: `cd "Barista Front End"`
- Main entry point: `src/index.js`
- App router and authentication in `src/App.js`
- Service architecture in `src/services/` with singleton patterns

### Service Dependencies and Load Order
1. **ConfigService** must be initialized first (environment detection)
2. **ApiService** depends on ConfigService for base URLs
3. **AuthService** manages JWT tokens and refresh logic
4. **WebSocketService** requires authentication tokens
5. **OrderDataService** orchestrates order management with offline fallback

### Database Connection Patterns
- Primary: PostgreSQL via `DATABASE_URL` environment variable
- Fallback: SQLite for development/testing
- Connection management: `utils/database.py` handles connection pooling
- Schema initialization: `pg_init.py` creates all required tables
- Migration scripts in `migrations/` directory

### Authentication Token Flow
- Access tokens: 15-minute expiry, stored in localStorage as `coffee_auth_token`
- Refresh tokens: 7-day expiry, stored as `coffee_refresh_token`
- Auto-refresh handled by `ApiService.js` with retry logic
- All API calls except `/api/auth/login` require `Authorization: Bearer <token>` header

### WebSocket Event Types
- `order_update`: Order status changes (pending → in-progress → completed)
- `station_update`: Station status and capability changes
- `support:metric_update`: Real-time system metrics for Support Interface
- `chat_message`: Inter-station communication

### Inventory-Station Data Flow
1. Organiser configures inventory categories in `InventoryManagement.js`
2. `InventoryIntegrationService.js` bridges Organiser → Station assignments
3. Stations receive filtered inventory based on capabilities
4. Real-time updates via WebSocket when inventory changes

### Error Handling Patterns
- API errors use standardized format: `{success: false, status: "error", message: "..."}`
- Frontend displays user-friendly messages via `NotificationService.js`
- Offline fallback: `FallbackService.js` caches last known good data
- Debug mode: Set `debugMode: true` in `apiConfig.js` for detailed logging

## Current Implementation Status & Critical Issues

### ✅ FULLY FUNCTIONAL (Production Ready)
- **SMS Ordering**: Complete Twilio integration with customer order processing
- **JWT Authentication**: 15-min access tokens, 7-day refresh tokens, automatic refresh
- **Order Management**: Full lifecycle (pending → in-progress → completed → picked up)
- **Four Main Interfaces**: Landing, Barista, Organiser, Support interfaces operational
- **Real-time Updates**: WebSocket infrastructure implemented and working
- **Offline Support**: localStorage caching with graceful degradation
- **Role-Based Access**: Admin, Staff/Organizer, Barista, Customer roles
- **Database Integration**: PostgreSQL primary, SQLite fallback working

### ⚠️ PARTIAL IMPLEMENTATION (Needs Backend APIs)
- **Inventory Management**: Frontend fully developed, backend persistence missing
- **Station Configuration**: UI complete, API endpoints need implementation
- **User Management**: Frontend exists, backend CRUD operations required
- **Schedule Management**: Frontend system without backend integration
- **Settings Persistence**: Currently localStorage-based, needs database storage

### 🚨 CRITICAL SECURITY ISSUES (Fix Immediately)
- **Exposed Credentials**: Twilio credentials committed in `.env` file - SECURITY RISK
- **Webhook Validation**: Missing signature verification for Twilio webhooks
- **CORS Configuration**: Needs production-ready CORS settings for cloud deployment

## Development Philosophy

### "Fix, Don't Disable" Approach
- **Always implement missing backend APIs** rather than removing frontend features
- **Prioritize security fixes** before adding new functionality
- **Complete partial implementations** to achieve production readiness
- **Maintain feature completeness** throughout development cycles

### Testing Strategy
- **Authentication**: 100% success rate with automated token refresh testing
- **Order Workflows**: Complete lifecycle testing from SMS to completion
- **API Integration**: 17/20 endpoints fully tested and functional
- **Frontend E2E**: Cypress browser automation for user workflows
- **Performance**: Load testing for high-volume order processing

### Code Quality Standards
- **Python**: Black formatter, isort imports, pytest with coverage
- **JavaScript**: ESLint, React conventions, Jest unit tests
- **API Design**: RESTful endpoints with standardized response formats
- **Security**: JWT best practices, CORS configuration, input validation

## Technical Debt & Known Limitations

### Critical Technical Debt
- **localStorage Dependency**: Many features store data locally instead of backend
- **Frontend-Backend Gaps**: UI exists but backend APIs missing
- **Authentication Edge Cases**: Token refresh only on page load, not API errors
- **Error Handling**: Inconsistent patterns across components

### Performance Considerations
- **Database Queries**: Need indexing for order and station lookups
- **WebSocket Scaling**: Requires Redis adapter for multi-instance deployment
- **Static Assets**: CDN required for production performance
- **Connection Pooling**: PostgreSQL optimization for concurrent users

### Monitoring Requirements
- **APM Integration**: New Relic/Datadog for production monitoring
- **Error Tracking**: Comprehensive logging for debugging
- **Performance Metrics**: API response times, order processing speeds
- **Business Metrics**: Orders/hour, completion rates, customer satisfaction