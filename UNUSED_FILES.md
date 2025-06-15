# Expresso Codebase - Unused/Legacy Files Analysis

This document lists files in the Expresso project that appear to be unused, duplicated, or legacy code that could be safely removed during cleanup.

## Backend Files

### Root Directory

1. **app.py.bak.cors.1747577993** - Backup file with CORS configuration
2. **app.py.bak.cors.20250518235126** - Another backup file with CORS configuration
3. **display_routes.py** - Duplicate of routes/display_routes.py
4. **middleware.py** - Duplicate of services/middleware.py
5. **coffee_orders.db.bak.20250518210027** - Database backup file
6. **mock_server.py** - Test/development server, not used in production

### Test Files (Likely Used Only for Development/Testing)

1. **test_api.py** 
2. **test_auth_flow.py**
3. **test_cors.py**
4. **test_frontend_apis.py**
5. **test_frontend_backend_integration.py**
6. **test_inventory_endpoints.py**
7. **test_inventory_endpoints_auth.py**
8. **test_jwt.py**
9. **test_jwt_api.py**
10. **test_jwt_config.py**
11. **test_login.py**
12. **test_twilio.py**

### Temporary Scripts and Utilities

1. **fix-all-api-issues.sh**
2. **fix-cors-and-restart.sh**
3. **fix-database-dummy-data.py**
4. **fix_database_connection.py**
5. **api-monitor.js**
6. **api-request-simulator.js**
7. **console-log-server.js**
8. **data-analyzer.js**
9. **inject-monitoring.js**
10. **db-data-checker.py**
11. **db-update-script.py**

## Frontend Files

### Duplicate Components

1. **Barista Front End/src/components/BaristaInterface.fixed.js** 
2. **Barista Front End/src/components/BaristaInterface.js.bak.20250518210027**
3. **Barista Front End/src/components/BaristaInterfaceExample.js**
4. **Barista Front End/src/components/Organiser.js.bak**
5. **Barista Front End/src/services/OrderDataService.js.bak**
6. **Barista Front End/src/services/OrderDataService.js.bak.20250518210027**
7. **Barista Front End/src/hooks/useOrders.fixed.js**

### Unused React Components

1. **Barista Front End/src/AppRouter.js** - Duplicate routing logic, App.js has the actual routes
2. **Barista Front End/src/App.improved.js** - Alternative version of App.js not in use

### Public Directory Fix/Debug Scripts

Many files in the public directory appear to be debugging utilities or temporary fixes:

1. **Barista Front End/public/auth-fix.js**
2. **Barista Front End/public/auth-fix.html**
3. **Barista Front End/public/auth-fix-index.html**
4. **Barista Front End/public/auth-service-fix.js**
5. **Barista Front End/public/auth-service-stub.js**
6. **Barista Front End/public/auto-fix.html**
7. **Barista Front End/public/clean-reset.html**
8. **Barista Front End/public/complete-auth-fix.html**
9. **Barista Front End/public/complete-auth-solution.js**
10. **Barista Front End/public/fix-422-errors.html**
11. **Barista Front End/public/fix-auth.js**
12. **Barista Front End/public/fix-authentication.html**
13. **Barista Front End/public/fix-auto-refresh.html**
14. **Barista Front End/public/fix-connection.html**
15. **Barista Front End/public/fix-cors-and-restart.sh**
16. **Barista Front End/public/fix-cors-properly.html**
17. **Barista Front End/public/fix-cors-properly.py**
18. **Barista Front End/public/fix-cors.html**
19. **Barista Front End/public/fix-demo-mode.html**
20. **Barista Front End/public/fix-jwt-errors.html**

... and many more fix/debug files in the public directory (over 60 total)

### API Testing and Diagnostics

1. **Barista Front End/public/api-diagnostics.html**
2. **Barista Front End/public/api-diagnostics.js**
3. **Barista Front End/public/api-test.html**
4. **Barista Front End/public/api-test.js**
5. **Barista Front End/public/api-tester.js**

### Documentation Artifacts

1. **Barista Front End/CoffeeCueSystemDocumentation.xlsx** - Likely an export used elsewhere
2. **Barista Front End/coffee-cue-documentation-guide.md** - Documentation about documentation

## Documentation Files

Some documentation files appear to have overlapping content or may be outdated:

1. **API-ENDPOINTS.md** vs **API-REFERENCE.md** - Likely duplicate content
2. **TESTING.md** vs **TESTING-STRATEGY.md** vs **TEST-SCRIPTS.md** - Overlapping content

## Other Directories

The **_AI Suggestions/** directory contains HTML and other artifacts that appear to be exported output from AI tools and likely aren't needed in the codebase.

## Recommendation

These files should be carefully examined and if confirmed unused, they should be removed to simplify the codebase. A suggested approach:

1. Create a backup of all files identified as potentially unused
2. Move them to a temporary directory outside the codebase
3. Verify that the application still works correctly without them
4. If issues arise, restore only the necessary files
5. After a sufficient testing period, permanently delete the identified unused files

This cleanup would significantly reduce the codebase size and improve maintainability by eliminating confusion about which files are actively used in the system.