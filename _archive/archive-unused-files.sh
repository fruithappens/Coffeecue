#!/bin/bash
# Script to archive unused files in the Expresso project

# Create main archive directory
mkdir -p _archive
mkdir -p _archive/backend
mkdir -p _archive/frontend
mkdir -p _archive/frontend/public
mkdir -p _archive/frontend/src
mkdir -p _archive/frontend/src/components
mkdir -p _archive/frontend/src/services
mkdir -p _archive/frontend/src/hooks
mkdir -p _archive/docs

# Archive backend backup files
echo "Archiving backend backup files..."
find . -maxdepth 1 -name "*.bak*" | xargs -I{} mv {} _archive/backend/
mv app.py.bak* _archive/backend/ 2>/dev/null
mv coffee_orders.db.bak* _archive/backend/ 2>/dev/null

# Archive duplicate backend files
echo "Archiving duplicate backend files..."
mv display_routes.py _archive/backend/ 2>/dev/null  # Duplicate of routes/display_routes.py
mv middleware.py _archive/backend/ 2>/dev/null      # Duplicate of services/middleware.py

# Archive backend test files
echo "Archiving test files..."
mkdir -p _archive/backend/tests
mv test_*.py _archive/backend/tests/ 2>/dev/null
mv sms_database_test.py _archive/backend/tests/ 2>/dev/null
mv mock_server.py _archive/backend/tests/ 2>/dev/null

# Archive temporary scripts and utilities
echo "Archiving utilities and fix scripts..."
mkdir -p _archive/backend/scripts
mv fix-*.sh _archive/backend/scripts/ 2>/dev/null
mv fix-*.py _archive/backend/scripts/ 2>/dev/null
mv fix_*.py _archive/backend/scripts/ 2>/dev/null
mv api-monitor.js _archive/backend/scripts/ 2>/dev/null
mv api-request-simulator.js _archive/backend/scripts/ 2>/dev/null
mv console-log-server.js _archive/backend/scripts/ 2>/dev/null
mv data-analyzer.js _archive/backend/scripts/ 2>/dev/null
mv inject-monitoring.js _archive/backend/scripts/ 2>/dev/null
mv db-data-checker.py _archive/backend/scripts/ 2>/dev/null
mv db-update-script.py _archive/backend/scripts/ 2>/dev/null
mv test-api-fixes.js _archive/backend/scripts/ 2>/dev/null

# Archive frontend duplicate components
echo "Archiving frontend duplicates..."
find "Barista Front End/src/components" -name "*.bak*" | xargs -I{} mv {} _archive/frontend/src/components/ 2>/dev/null
find "Barista Front End/src/services" -name "*.bak*" | xargs -I{} mv {} _archive/frontend/src/services/ 2>/dev/null
find "Barista Front End/src/hooks" -name "*.bak*" | xargs -I{} mv {} _archive/frontend/src/hooks/ 2>/dev/null

mv "Barista Front End/src/components/BaristaInterface.fixed.js" _archive/frontend/src/components/ 2>/dev/null
mv "Barista Front End/src/components/BaristaInterfaceExample.js" _archive/frontend/src/components/ 2>/dev/null
mv "Barista Front End/src/hooks/useOrders.fixed.js" _archive/frontend/src/hooks/ 2>/dev/null
mv "Barista Front End/src/App.improved.js" _archive/frontend/src/ 2>/dev/null
mv "Barista Front End/src/AppRouter.js" _archive/frontend/src/ 2>/dev/null  # Duplicate routing logic

# Archive public directory fix/debug scripts (being ruthless)
echo "Archiving public directory fix scripts and debug utilities..."
mkdir -p _archive/frontend/public/fix-scripts
mkdir -p _archive/frontend/public/debug
mkdir -p _archive/frontend/public/tests

# Move all fix related files
mv "Barista Front End/public/auth-fix"* _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/fix-"* _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/auth-service-fix.js" _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/auto-fix.html" _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/complete-auth-fix.html" _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/complete-auth-solution.js" _archive/frontend/public/fix-scripts/ 2>/dev/null
mv "Barista Front End/public/*fix*" _archive/frontend/public/fix-scripts/ 2>/dev/null

# Move all debug related files
mv "Barista Front End/public/debug"* _archive/frontend/public/debug/ 2>/dev/null
mv "Barista Front End/public/console-capture.js" _archive/frontend/public/debug/ 2>/dev/null
mv "Barista Front End/public/console-quiet.js" _archive/frontend/public/debug/ 2>/dev/null

# Move all test related files
mv "Barista Front End/public/api-test"* _archive/frontend/public/tests/ 2>/dev/null
mv "Barista Front End/public/api-diagnostics"* _archive/frontend/public/tests/ 2>/dev/null
mv "Barista Front End/public/test"* _archive/frontend/public/tests/ 2>/dev/null
mv "Barista Front End/public/self-test.html" _archive/frontend/public/tests/ 2>/dev/null
mv "Barista Front End/public/api-tester.js" _archive/frontend/public/tests/ 2>/dev/null

# Move minimal/demo files
mkdir -p _archive/frontend/public/demo
mv "Barista Front End/public/minimal"* _archive/frontend/public/demo/ 2>/dev/null
mv "Barista Front End/public/demo-mode"* _archive/frontend/public/demo/ 2>/dev/null
mv "Barista Front End/public/use-demo-mode.js" _archive/frontend/public/demo/ 2>/dev/null

# Documentation artifacts
echo "Archiving documentation artifacts..."
mkdir -p _archive/docs
mv "_AI Suggestions" _archive/docs/ 2>/dev/null 
mv "Barista Front End/CoffeeCueSystemDocumentation.xlsx" _archive/docs/ 2>/dev/null
mv "CoffeeCueSystemDocumentation.xlsx" _archive/docs/ 2>/dev/null

# Review directories
echo "The following files and directories have been moved to _archive:"
find _archive -type f | wc -l

echo "Archive process complete."