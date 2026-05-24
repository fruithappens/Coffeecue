# Expresso Coffee Ordering System Troubleshooting Guide

This document provides solutions for common issues in the Expresso Coffee Ordering System.

## Frontend-Backend Communication Issues

### API "Not Implemented" Messages

If you see "API not implemented" messages in the UI, this indicates connectivity issues between the frontend and backend.

#### Solution 1: Check Backend Server

First, verify the backend server is running:

```bash
python check_backend_server.py
```

This should show "Server is running!" and successfully test several API endpoints.

#### Solution 2: Direct URL Pattern

The frontend now uses a direct URL approach to communicate with the backend. The pattern used is:

```
http://localhost:5001/api/{endpoint}
```

The key services have been updated to use this pattern:
- OrderDataService
- StationsService
- SettingsService
- MessageService 
- ScheduleService

#### Solution 3: Check Authentication

Authentication is required for most API endpoints. Verify a valid token exists:

1. Open the browser console and check for authentication errors
2. Navigate to http://localhost:3000/check-token.js to verify token
3. If token is missing or expired, try:
   - Refreshing the page (auth-fix.js should auto-login)
   - Manually logging in with admin/adminpassword

#### Solution 4: Test Direct API Access

To test direct API connections:

1. Navigate to http://localhost:3000/api-test.html
2. Click "Run API Tests" to test all endpoints directly
3. Check console output for success/errors

### URL Pattern Errors

If API calls fail due to URL formatting issues (double slashes, incorrect paths), check:

1. The fetchWithAuth method in each service
2. URL construction patterns for API endpoints
3. Console logs for the actual URLs being used
4. Network panel in browser dev tools

## Order Management Issues

### Orders Not Starting/Completing

If you can't start or complete orders:

1. Check the console for specific errors
2. Verify the URL format being used in OrderDataService.js:
   - Avoid double slashes in paths `/api//orders/`
   - Try both patterns: `/api/orders/{id}/start` and `/orders/{id}/start`
   - Ensure authorization header is included

### SMS Messages Not Sending

If SMS confirmation messages aren't sending:

1. Check console logs for messaging errors
2. Verify Twilio configuration in backend .env file
3. Try direct test: http://localhost:5001/sms/test

## Database Connectivity

If database errors occur:

1. Check DATABASE_URL in .env file
2. Verify correct username is used (not 'postgres')
3. Run fix_database_connection.py to repair connection string

## When All Else Fails

If persistent issues remain:

1. Clear browser cache and localStorage
2. Restart both frontend and backend servers
3. Verify all required tables exist in the database
4. Check for CORS restrictions in network panel