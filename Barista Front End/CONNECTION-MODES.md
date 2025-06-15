# Offline Mode Guide

This document explains the current offline mode configuration in the Expresso Coffee Ordering System, which has been implemented to handle backend authentication issues (422 UNPROCESSABLE ENTITY errors).

## Current Configuration: Forced Offline Mode

The application is currently configured to operate in **Offline Mode** to prevent 422 UNPROCESSABLE ENTITY errors that were occurring due to JWT token validation issues.

### Why Offline Mode?

The backend is experiencing authentication issues specifically:
- "Subject must be a string" validation errors
- "Signature verification failed" errors

These errors occur when the JWT token validation fails on the backend, preventing normal API operations. Rather than showing constant errors to users, the application now runs in offline mode with sample data.

### How Offline Mode Works

- All API requests are intercepted (both fetch and XMLHttpRequest)
- Sample data is returned instead of making real backend calls
- A visual indicator shows `OFFLINE MODE` in the bottom-right corner
- The application functions normally with sample data

## Visual Indicators

1. **Connection Mode Indicator**:
   - Located in the bottom-right corner of the application
   - Shows `OFFLINE MODE` in red
   - Click on it to open the mode information page

2. **Information Pages**:
   - `/connection-mode-switcher.html` - Information about the current offline mode
   - `/auto-offline-notification.html` - Notification about offline mode activation

## Sample Data

The offline mode uses comprehensive sample data including:

- Pending, in-progress, and completed orders
- Coffee stations with different statuses
- Stock/inventory information
- User authentication data

This ensures all application features can be demonstrated without backend connectivity.

## Resolving the Backend Issues

To restore live functionality, the backend authentication issues need to be fixed:

1. **JWT Token Format**:
   - Ensure the JWT subject (`sub` claim) is a string value
   - Verify the token signature matches the secret key

2. **Backend Authentication Configuration**:
   - Check the authentication middleware
   - Verify the secret key used for token validation
   - Ensure proper error handling for token validation

3. **Once Fixed**:
   - The current offline mode configuration will need to be removed
   - The original authentication flow can be restored

## Technical Implementation

The offline mode is implemented through:

- `smart-api-mode.js` - Intercepts all API calls and returns sample data
- Complete interception of both fetch and XMLHttpRequest for API calls
- localStorage flags to ensure consistent offline mode behavior
- Visual indicators for user awareness

---

*Note: This offline mode configuration is a temporary solution until the backend authentication issues are resolved.*