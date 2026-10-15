# Frontend-Backend Integration

This document explains how the frontend and backend integrate in the Expresso Coffee Ordering System.

## API Connection Strategy

The frontend connects to the backend through direct URL access. We've implemented a reliable connection strategy that ensures API calls are made consistently.

### Key Features

1. **Direct URL Approach**: All service files now use direct absolute URLs (http://localhost:5001/api/...) instead of relative paths.
2. **Token Management**: Authentication tokens are properly retrieved from localStorage and included in API requests.
3. **Error Handling**: Comprehensive error handling with detailed logging for easier debugging.
4. **Fallbacks**: When API calls fail, services can fall back to either:
   - Using alternative API endpoints
   - Using dummy/demo data when applicable

## Modified Service Files

The following service files have been updated to use the direct URL approach:

1. **OrderDataService.js** - Core service for order management
2. **StationsService.js** - Service for station management
3. **SettingsService.js** - Service for system settings
4. **MessageService.js** - Service for customer messaging
5. **ScheduleService.js** - Service for staff scheduling (with fallbacks for APIs not implemented yet)

## Connection Design

Each service now includes:

1. A consistent `directFetch` method that:
   - Handles URL construction
   - Manages authentication token inclusion
   - Provides detailed logging
   - Handles errors comprehensively

2. Direct URL construction:
   ```javascript
   const directUrl = `http://localhost:5001/api/${apiPath}`;
   ```

3. Token retrieval and usage:
   ```javascript
   this.token = localStorage.getItem('coffee_system_token') || null;
   ```

4. Header construction:
   ```javascript
   const headers = {
     'Content-Type': 'application/json',
     'Accept': 'application/json',
     ...(this.token && { 'Authorization': `Bearer ${this.token}` })
   };
   ```

## Testing

Test any API integration by:

1. Opening the browser console
2. Looking for successful API connections (marked with ✅)
3. Checking for detailed error logs if connections fail

## Handling Not Implemented APIs

For services where the backend API isn't fully implemented yet (like ScheduleService), we've implemented:

1. Attempts to call the API first, using the proper direct URLs
2. Fallback mechanisms to provide empty data structures or dummy data
3. Console logs indicating when fallbacks are being used

These changes allow the frontend to immediately start using backend APIs as they become available, without requiring additional code changes.

## Next Steps

1. As backend APIs are implemented, they'll automatically start working with the frontend
2. Check the console for any "using fallback" messages, which indicate a backend API that still needs implementation
3. Focus backend development efforts on APIs that are currently falling back to dummy data