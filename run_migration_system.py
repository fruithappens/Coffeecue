#!/usr/bin/env python3
"""
Run Migration System - Initialize and start the complete database migration system
This script fixes the architectural flaw and sets up proper data persistence
"""

import os
import sys
import logging
import time
from database_migration_system import DatabaseMigrationSystem
from automatic_backup_service import start_backup_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def main():
    """Initialize and start the migration system"""
    logger.info("🚀 Initializing Database Migration System...")
    logger.info("=" * 60)
    
    try:
        # Step 1: Initialize migration system
        logger.info("📊 Step 1: Initializing Migration System")
        migration_system = DatabaseMigrationSystem()
        
        if not migration_system.connect():
            logger.error("❌ Failed to connect to database")
            logger.error("💡 Make sure PostgreSQL is running and the database exists")
            sys.exit(1)
        
        # Step 2: Create database schema
        logger.info("📊 Step 2: Creating Database Schema")
        if not migration_system.create_comprehensive_schema():
            logger.error("❌ Failed to create database schema")
            sys.exit(1)
        
        # Step 3: Create API endpoints
        logger.info("📊 Step 3: Creating Migration API")
        migration_system.create_data_migration_api()
        
        # Step 4: Start automatic backup system
        logger.info("📊 Step 4: Starting Automatic Backup System")
        backup_service = start_backup_service(5)  # 5 minute intervals
        
        # Success message
        logger.info("")
        logger.info("✅ Database Migration System Initialized Successfully!")
        logger.info("=" * 60)
        logger.info("📋 System Status:")
        logger.info("   ✅ Database schema: Created")
        logger.info("   ✅ Migration API: Available at /api/migration/*")
        logger.info("   ✅ Inventory API: Available at /api/inventory/*")
        logger.info("   ✅ Automatic backups: Running every 5 minutes")
        logger.info("")
        logger.info("🔧 Next Steps:")
        logger.info("   1. Start the Flask backend server:")
        logger.info("      python run_server.py")
        logger.info("")
        logger.info("   2. Open the migration tool in your browser:")
        logger.info("      http://localhost:5001/static/localStorage-to-database-migration.html")
        logger.info("")
        logger.info("   3. Run the migration to move your localStorage data to the database")
        logger.info("")
        logger.info("   4. Update your React app to use DatabaseInventoryService instead of localStorage")
        logger.info("")
        logger.info("   5. Your system is now ready for production deployment! 🎉")
        logger.info("")
        logger.info("🔍 Architecture Changes:")
        logger.info("   ❌ OLD: Critical data stored in browser localStorage (lost on clear/crash)")
        logger.info("   ✅ NEW: All data stored in PostgreSQL database (persistent, reliable)")
        logger.info("   ✅ NEW: Automatic backups every 5 minutes")
        logger.info("   ✅ NEW: Cloud deployment ready")
        logger.info("")
        logger.info("📊 To check status at any time:")
        logger.info("   • Migration status: GET /api/migration/backup-status")
        logger.info("   • Inventory data: GET /api/migration/get-inventory")
        logger.info("   • Manual backup: POST /api/migration/create-backup")
        
        # Keep backup service running
        logger.info("")
        logger.info("⏳ Keeping automatic backup service running...")
        logger.info("   Press CTRL+C to stop")
        
        try:
            while backup_service.running:
                time.sleep(60)
                
                # Print status every 10 minutes
                status = backup_service.get_status()
                if status['stats']['backups_created'] > 0:
                    logger.info(f"📊 Backup Status: {status['stats']['backups_created']} backups created, "
                               f"latest: {status['stats']['last_backup_size_formatted']}")
        except KeyboardInterrupt:
            logger.info("🛑 Shutdown requested...")
        
        # Clean shutdown
        backup_service.stop()
        migration_system.disconnect()
        logger.info("✅ Migration system stopped gracefully")
        
    except Exception as e:
        logger.error(f"❌ Failed to initialize migration system: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()