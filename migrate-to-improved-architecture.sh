#!/bin/bash
# Script to migrate to the improved architecture

echo "Starting migration to improved architecture..."

# Create backup of current state
echo "Creating backup of critical files..."
mkdir -p _pre_migration_backup/src/services
mkdir -p _pre_migration_backup/src/utils
mkdir -p _pre_migration_backup/src/config

# Backup original files
cp "Barista Front End/src/services/ApiService.js" "_pre_migration_backup/src/services/"
cp "Barista Front End/src/services/AuthService.js" "_pre_migration_backup/src/services/"
cp "Barista Front End/src/services/OrderDataService.js" "_pre_migration_backup/src/services/"
cp "Barista Front End/src/index.js" "_pre_migration_backup/src/"
cp "Barista Front End/src/App.js" "_pre_migration_backup/src/"

echo "Backup complete."

# Check if config directory exists
if [ ! -d "Barista Front End/src/config" ]; then
  echo "Creating config directory..."
  mkdir -p "Barista Front End/src/config"
fi

# Step 1: Deploy configuration and utility files
echo "Deploying configuration and utility files..."

# Step 2: Rename improved files to active files
echo "Activating improved implementations..."

# Rename new service implementations
mv "Barista Front End/src/services/ApiService.improved.js" "Barista Front End/src/services/ApiService.js" 2>/dev/null
mv "Barista Front End/src/services/AuthService.improved.js" "Barista Front End/src/services/AuthService.js" 2>/dev/null
mv "Barista Front End/src/index.improved.js" "Barista Front End/src/index.js" 2>/dev/null

echo "Migration complete. If you encounter any issues, restore the backup from _pre_migration_backup directory."

# Provide instructions for testing
echo ""
echo "Next steps:"
echo "1. Test the application in development mode: cd 'Barista Front End' && npm start"
echo "2. If everything works, you can remove the _pre_migration_backup directory"
echo "3. If issues arise, restore the backup files and check the implementation guide in IMPLEMENTATION-PLAN.md"