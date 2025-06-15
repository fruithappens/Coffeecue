# Expresso Coffee System - File Structure Documentation

This document provides an overview of the file structure of the Expresso Coffee Ordering System, with annotations about each file's purpose and whether it's part of the core application or used for testing, fixes, etc.

## Root Directory

- `app.py` - **CORE** - Main Flask application factory
- `auth.py` - **CORE** - JWT authentication handling
- `config.py` - **CORE** - Configuration settings
- `middleware.py` - **CORE** - Application middleware
- `run_server.py` - **CORE** - Entry point for backend server
- `requirements.txt` - **CORE** - Python dependencies

- `start_expresso.sh` - **UTILITY** - Script to start the complete system
- `fix-cors-and-restart.sh` - **FIX** - Script to fix CORS issues and restart system
- `fix-all-api-issues.sh` - **FIX** - Script to address various API issues
- `prepare_test_environment.sh` - **TEST** - Script to set up test environment
- `run_all_tests.sh` - **TEST** - Script to run all tests
- `install_jwt.sh` - **UTILITY** - Script to install JWT dependencies
- `live-test-environment.sh` - **TEST** - Script for live testing

- `api-monitor.js` - **UTILITY** - JavaScript for API monitoring
- `api-request-simulator.js` - **TEST** - Tool to simulate API requests
- `console-log-server.js` - **DEBUG** - Server for capturing console logs
- `data-analyzer.js` - **UTILITY** - Data analysis script
- `inject-monitoring.js` - **UTILITY** - Script to inject monitoring code
- `test-api-fixes.js` - **TEST/FIX** - Script to test API fixes

- `coffee_orders.db.bak.20250518210027` - **BACKUP** - Database backup
- `reset_admin_pg.py` - **UTILITY** - Script to reset admin in PostgreSQL
- `test_api.py` - **TEST** - API testing script
- `test_auth_flow.py` - **TEST** - Authentication flow testing
- `test_cors.py` - **TEST** - CORS functionality testing
- `test_frontend_apis.py` - **TEST** - Frontend API testing
- `test_frontend_backend_integration.py` - **TEST** - Integration testing
- `test_inventory_endpoints.py` - **TEST** - Inventory API testing
- `test_inventory_endpoints_auth.py` - **TEST** - Inventory API auth testing
- `test_jwt.py` - **TEST** - JWT functionality testing
- `test_jwt_api.py` - **TEST** - JWT API testing
- `test_jwt_config.py` - **TEST** - JWT configuration testing
- `test_login.py` - **TEST** - Login functionality testing
- `test_twilio.py` - **TEST** - Twilio integration testing

- `check_backend_server.py` - **UTILITY** - Check if backend is running
- `create_admin.py` - **UTILITY** - Create admin user
- `db-data-checker.py` - **UTILITY** - Check database data
- `db-update-script.py` - **UTILITY** - Update database schema/data
- `display_routes.py` - **UTILITY** - Display available routes
- `documentation-generator.py` - **UTILITY** - Generate documentation
- `fix-database-dummy-data.py` - **FIX** - Fix database test data
- `fix_database_connection.py` - **FIX** - Fix database connection issues
- `inventory_migration.py` - **UTILITY** - Migrate inventory data
- `load_test_data.py` - **TEST** - Load test data into database
- `mock_server.py` - **TEST** - Mock server for testing
- `pg_init.py` - **UTILITY** - Initialize PostgreSQL database
- `sms_database_test.py` - **TEST** - Test SMS database functionality

## Documentation Files

- `README.md` - **CORE** - Primary project documentation
- `CLAUDE.md` - **UTILITY** - Instructions for Claude AI
- `API-ENDPOINTS.md` - **CORE** - API endpoint documentation
- `API-IMPLEMENTATION-STATUS.md` - **CORE** - Status of API implementation
- `API-REFERENCE.md` - **CORE** - API reference documentation
- `AUTHENTICATION-FIX.md` - **FIX** - Authentication fix documentation
- `COFFEE_CUE_SYSTEM_DOCUMENTATION.txt` - **CORE** - System documentation
- `COMPONENT-HIERARCHY.md` - **CORE** - Component hierarchy documentation
- `FRONTEND-BACKEND-INTEGRATION.md` - **CORE** - Integration documentation
- `IMPLEMENTATION-ISSUES.md` - **UTILITY** - Known implementation issues
- `INVENTORY_API_GUIDE.md` - **CORE** - Guide for inventory API
- `LIVE-TESTING-GUIDE.md` - **TEST** - Guide for live testing
- `TEST-SCRIPTS.md` - **TEST** - Documentation of test scripts
- `TESTING-STRATEGY.md` - **TEST** - Testing strategy documentation
- `TESTING.md` - **TEST** - General testing documentation
- `TROUBLESHOOTING.md` - **UTILITY** - Troubleshooting guide
- `UI-API-REPORT.md` - **UTILITY** - Report on UI-API interaction

## Core Backend Structure

### Models
- `models/__init__.py` - **CORE** - Package initialization
- `models/inventory.py` - **CORE** - Inventory database models
- `models/orders.py` - **CORE** - Orders database models
- `models/settings.py` - **CORE** - Settings database models
- `models/stations.py` - **CORE** - Stations database models
- `models/users.py` - **CORE** - Users database models

### Routes
- `routes/__init__.py` - **CORE** - Package initialization
- `routes/admin_routes.py` - **CORE** - Admin interface routes
- `routes/api_routes.py` - **CORE** - API routes
- `routes/auth_routes.py` - **CORE** - Authentication routes
- `routes/barista_routes.py` - **CORE** - Barista interface routes
- `routes/chat_api_routes.py` - **CORE** - Chat API routes
- `routes/consolidated_api_routes.py` - **CORE** - Combined API routes
- `routes/customer_routes.py` - **CORE** - Customer interface routes
- `routes/display_api_routes.py` - **CORE** - Display API routes
- `routes/inventory_routes.py` - **CORE** - Inventory API routes
- `routes/settings_api_routes.py` - **CORE** - Settings API routes
- `routes/sms_routes.py` - **CORE** - SMS handling routes
- `routes/station_api_routes.py` - **CORE** - Station API routes
- `routes/track_routes.py` - **CORE** - Order tracking routes

### Services
- `services/__init__.py` - **CORE** - Package initialization
- `services/advanced_nlp.py` - **FEATURE** - Advanced NLP functionality
- `services/coffee_system.py` - **CORE** - Core coffee system logic
- `services/config.py` - **CORE** - Service configuration
- `services/loyalty.py` - **CORE** - Loyalty program functionality
- `services/messaging.py` - **CORE** - Messaging service
- `services/middleware.py` - **CORE** - Service middleware
- `services/nlp.py` - **FEATURE** - Basic NLP functionality
- `services/stock_management.py` - **CORE** - Stock management service
- `services/websocket.py` - **CORE** - WebSocket functionality

### Utils
- `utils/__init__.py` - **CORE** - Package initialization
- `utils/database.py` - **CORE** - Database utilities
- `utils/helpers.py` - **CORE** - Helper functions

### Scripts
- `scripts/check_admin_users_table.py` - **UTILITY** - Admin table verification
- `scripts/create_admin_user.py` - **UTILITY** - Create admin user
- `scripts/init_chat_messages.py` - **UTILITY** - Initialize chat messages
- `scripts/init_default_settings.py` - **UTILITY** - Initialize default settings
- `scripts/reset_admin.py` - **UTILITY** - Reset admin user
- `scripts/sqlite-to-postgres.py` - **UTILITY** - Database migration script

### Migrations
- `migrations/create_schema.py` - **CORE** - Database schema creation

### Templates
- `templates/` - **CORE** - HTML templates for server-rendered views
  - Contains various subdirectories for different interfaces (admin, auth, barista, etc.)

### Static Files
- `static/` - **CORE** - Static assets
  - `static/css/` - **CORE** - CSS stylesheets
  - `static/js/` - **CORE** - JavaScript files
  - `static/images/` - **CORE** - Image assets
  - `static/audio/` - **CORE** - Audio notifications
  - `static/_unused/` - **UNUSED** - Unused assets

## Frontend (Barista Front End)

- `Barista Front End/README.md` - **CORE** - Frontend documentation
- `Barista Front End/package.json` - **CORE** - NPM package configuration
- `Barista Front End/package-lock.json` - **CORE** - NPM dependency lock file
- `Barista Front End/craco.config.js` - **CORE** - Create React App Configuration Override
- `Barista Front End/tailwind.config.js` - **CORE** - Tailwind CSS configuration
- `Barista Front End/postcss.config.js` - **CORE** - PostCSS configuration
- `Barista Front End/tsconfig.json` - **CORE** - TypeScript configuration

- `Barista Front End/public/` - **CORE** - Public static assets
  - Many files with "fix", "debug", "test" in names - **FIX/TEST** - Various debugging/testing utilities

### Source Code
- `Barista Front End/src/App.js` - **CORE** - Main React application component
- `Barista Front End/src/App.improved.js` - **VARIANT** - Improved version of App component
- `Barista Front End/src/AppContext.js` - **CORE** - Application context provider
- `Barista Front End/src/AppRouter.js` - **CORE** - Application routing
- `Barista Front End/src/index.js` - **CORE** - Application entry point
- `Barista Front End/src/index.css` - **CORE** - Global CSS styles

#### Components
- `Barista Front End/src/components/` - **CORE** - React components
  - Contains various UI components like `BaristaInterface.js`, `OrderNotificationHandler.js`, etc.
  - Files with `.fixed.js` or `.bak` extensions - **FIX/BACKUP** - Fixed versions or backups

#### Services
- `Barista Front End/src/services/` - **CORE** - API clients and services
  - `ApiService.js` - **CORE** - Core API service
  - `AuthService.js` - **CORE** - Authentication service
  - `OrderDataService.js` - **CORE** - Order data management
  - `NotificationService.js` - **CORE** - Notification handling
  - Various other services - **CORE** - Other specialized services

#### Hooks
- `Barista Front End/src/hooks/` - **CORE** - React hooks
  - Custom hooks for data management and UI functionality

#### Context
- `Barista Front End/src/context/` - **CORE** - React context
  - `AppContext.js` - **CORE** - Application state context

#### Utils
- `Barista Front End/src/utils/` - **CORE** - Utility functions
  - Various utility functions like `orderUtils.js`, `qrCodeUtils.js`, etc.

#### Configuration
- `Barista Front End/src/config/` - **CORE** - Configuration
  - `apiConfig.js` - **CORE** - API configuration

#### Styles
- `Barista Front End/src/styles/` - **CORE** - CSS styles
  - `milkColors.css` - **CORE** - CSS for milk type colors

#### Data
- `Barista Front End/src/data/` - **CORE** - Sample/default data
  - Contains sample data for development/testing

## Other Directories

- `_AI Suggestions/` - **UTILITY** - Suggestions from AI tools
- `_SharewithClaudeweb/` - **UTILITY** - Files shared with Claude web
- `CoffeeCueLauncher.app/` - **UTILITY** - Application launcher
- `debug_logs/` - **DEBUG** - Debug log files
- `logs/` - **CORE** - Application logs

## Summary

This file structure shows a comprehensive full-stack application with:

1. **Core Backend Components**:
   - Flask application (app.py)
   - Model definitions (models/)
   - Route handlers (routes/)
   - Business logic services (services/)
   - Utilities (utils/)

2. **Core Frontend Components**:
   - React application (Barista Front End/src/)
   - Components (components/)
   - Services (services/)
   - Hooks and context (hooks/, context/)

3. **Supporting Files**:
   - Documentation (.md files)
   - Configuration files
   - Scripts for setup, testing, and fixes
   - Templates for server-rendered views
   - Static assets

4. **Development/Testing Utilities**:
   - Test scripts and data
   - Debugging tools
   - Fix scripts for various issues

Many files in the public/ directory with names containing "fix", "debug", or "test" appear to be auxiliary utilities for troubleshooting rather than core application components.