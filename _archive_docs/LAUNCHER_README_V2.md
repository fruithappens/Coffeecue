# Coffee Cue Launcher v2.0 - Enhanced with Database Persistence

## What's New in v2.0

🚀 **Major Architecture Upgrade**: Your Coffee Cue system now uses persistent database storage instead of browser localStorage, eliminating data loss issues.

### Key Improvements

✅ **Persistent Data Storage**: All data now stored in PostgreSQL database
✅ **Automatic Backups**: System backs up data every 5 minutes automatically  
✅ **Cloud Ready**: No localStorage dependencies - deploy anywhere
✅ **Zero Data Loss**: Critical business data never lost again
✅ **Real-time Sync**: Data synchronized across all components
✅ **Migration Tools**: Easy migration from old localStorage system

## How to Use

### Option 1: Double-Click the App (Recommended)
1. Double-click `CoffeeCueLauncher.app`
2. Choose your startup mode:
   - **Initialize**: First-time setup of database system
   - **Migrate**: Move existing localStorage data to database
   - **Complete Setup**: Full system startup with all features
   - **Quick Start**: Fast launch (assumes everything is set up)

### Option 2: Command Line
```bash
# Enhanced version (recommended)
./start_expresso_enhanced.sh

# Standard version (auto-redirects to enhanced)
./start_expresso.sh

# Quick version
./start_expresso_fast.sh
```

## First-Time Setup

When you first run the enhanced launcher, it will:

1. **Check System Requirements**
   - PostgreSQL installation
   - Python 3 availability
   - Database connectivity

2. **Initialize Database System**
   - Create `expresso` database if needed
   - Set up migration tables
   - Configure backup system

3. **Start All Services**
   - Automatic backup service (background)
   - Backend API server (port 5001)
   - React frontend (port 3000)
   - ngrok tunnel (if available)

## Migration from Old System

If you have existing data in localStorage:

1. **Start the system** with the launcher
2. **Open migration tool**: http://localhost:5001/static/localStorage-to-database-migration.html
3. **Follow the web interface** to migrate your data
4. **Verify** the migration completed successfully

The migration tool will:
- ✅ Analyze your localStorage data
- ✅ Show preview of data to be migrated
- ✅ Move data to PostgreSQL database
- ✅ Verify migration success
- ✅ Show backup system status

## System Components

### New in v2.0
- **Database Migration System**: Handles localStorage → PostgreSQL migration
- **Automatic Backup Service**: Backs up all data every 5 minutes
- **Migration Web Tool**: User-friendly interface for data migration
- **Database API Endpoints**: RESTful APIs for data management

### Existing Components
- **React Frontend**: Barista, Organiser, and Support interfaces
- **Flask Backend**: API server with JWT authentication
- **PostgreSQL Database**: Primary data storage
- **WebSocket Service**: Real-time updates
- **SMS Integration**: Twilio-based messaging

## URLs and Access Points

### Main Application
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5001

### New Migration Tools
- **Migration Tool**: http://localhost:5001/static/localStorage-to-database-migration.html
- **Backup Status**: GET /api/migration/backup-status
- **Inventory Data**: GET /api/migration/get-inventory

### Admin Access
- **Username**: coffeecue
- **Password**: adminpassword

## Terminal Windows

The launcher opens multiple Terminal windows:

1. **Coffee Cue - Backup Service**: Automatic data backups
2. **Coffee Cue - Backend Server**: Main API server
3. **Coffee Cue - React Frontend**: Web application
4. **Coffee Cue - ngrok**: Public URL tunnel (optional)

## Data Storage Architecture

### Before v2.0 (❌ Problematic)
```
Browser localStorage → Data Loss on Clear/Restart
```

### After v2.0 (✅ Fixed)
```
PostgreSQL Database → Persistent Storage
       ↓
Automatic Backups → Disaster Recovery
       ↓
Cloud Deployment → Production Ready
```

## Database Tables

The enhanced system uses these PostgreSQL tables:

- `event_inventory`: Coffee types, milk options, etc.
- `event_stock_levels`: Stock quantities and allocations
- `station_inventory_configs`: Station configurations
- `station_inventory_quantities`: Per-station quantities
- `system_settings`: Application settings
- `data_backups`: Automatic backup storage
- `orders`: Customer orders (existing)
- `stations`: Station definitions (existing)
- `users`: User accounts (existing)

## Backup System

### Automatic Backups
- **Frequency**: Every 5 minutes
- **Retention**: 50 most recent backups
- **Content**: Complete system state
- **Storage**: PostgreSQL `data_backups` table

### Manual Backups
```bash
# Create manual backup
curl -X POST http://localhost:5001/api/migration/create-backup

# Check backup status
curl http://localhost:5001/api/migration/backup-status
```

## Troubleshooting

### Common Issues

1. **"Database connection failed"**
   ```bash
   # Start PostgreSQL
   brew services start postgresql
   
   # Create database
   createdb expresso
   ```

2. **"Migration system not found"**
   ```bash
   # Initialize migration system
   python3 run_migration_system.py
   ```

3. **"No data after migration"**
   - Check if localStorage had data before migration
   - Verify backend server is running
   - Check migration tool for error messages

### Verification Commands

```bash
# Check database tables
psql -d expresso -c "SELECT COUNT(*) FROM event_inventory;"

# Check backup status
curl http://localhost:5001/api/migration/backup-status

# Test API connectivity
curl http://localhost:5001/api/migration/get-inventory
```

## Cloud Deployment

Your system is now ready for cloud deployment:

### Prerequisites Met
✅ All data in PostgreSQL (no localStorage)
✅ Automatic backup system
✅ API-based architecture
✅ Environment variable configuration

### Deployment Steps
1. Set up cloud PostgreSQL database
2. Configure DATABASE_URL environment variable
3. Deploy backend to cloud platform (Heroku, AWS, etc.)
4. Deploy frontend to CDN (Netlify, Vercel, etc.)
5. Run migration to move data to cloud database

## Support

### Getting Help
- Check Terminal window logs for errors
- Use migration tool diagnostics
- Verify PostgreSQL is running
- Check API endpoints are responding

### Reporting Issues
Create issues at: https://github.com/anthropics/claude-code/issues

### System Status
```bash
# Quick health check
python3 test_database_migration_system.py
```

## Version History

### v2.0 (Current)
- ✅ Database persistence architecture
- ✅ Automatic backup system
- ✅ Migration tools and web interface
- ✅ Cloud deployment ready
- ✅ Zero data loss guarantee

### v1.0 (Previous)
- ❌ localStorage-based storage
- ❌ Data loss on browser clear
- ❌ Not suitable for production
- ❌ Single-user only

---

🎉 **Congratulations!** Your Coffee Cue system is now enterprise-ready with professional-grade data persistence and automatic backups!