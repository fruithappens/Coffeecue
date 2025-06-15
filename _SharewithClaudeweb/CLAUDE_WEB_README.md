# Expresso - Coffee Ordering System

## Project Overview

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

## Key Components in This Directory

This directory contains essential files to help Claude Web understand the project structure:

- `CLAUDE.md` - Official project documentation used by Claude Code
- `README.md` - Main project README
- `API-REFERENCE.md` - API endpoint documentation
- `OrderDataService.js` - Service for managing orders and notifications
- `MessageService.js` - Service for handling SMS communication
- `BaristaInterface.js.partial` - Partial code of the main barista interface component
- `project_structure.txt` - Overview of project files and directories

## Recent Implementation

The most recent work focused on improving the notification system:

1. Implemented a robust `sendReadyNotification` method in OrderDataService.js that:
   - Takes an order object or ID as input
   - Attempts multiple notification methods for reliability
   - Provides detailed logging for troubleshooting
   - Falls back to simpler approaches if more complex ones fail

2. Updated BaristaInterface.js to use both MessageService and OrderDataService for notifications with proper fallback mechanisms.

3. Created testing tools to help developers verify the notification system:
   - A JS utility file with test functions (`test-notification.js`)
   - A simple HTML page for interactive testing (`test-notification.html`)

## Development Commands

### Backend Setup
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scripts/database/pg_init.py
python scripts/admin/create_admin.py
python run_server.py
```

### Frontend Setup
```bash
cd "Barista Front End"
npm install
npm start
```

### Full System Start
```bash
./start_expresso.sh
```

## Key File Relationships

- `OrderDataService.js` -> Used by `BaristaInterface.js` for order management
- `MessageService.js` -> Used by both OrderDataService and BaristaInterface for notifications
- Both services communicate with the backend APIs defined in the Flask application

## Testing
The notification system can be tested using:
- `public/test-notification.html` - Browser-based interactive testing
- `public/test-notification.js` - JS functions for testing notifications