# JWT Authentication Error Handling Improvements

This document outlines the improvements made to handle JWT authentication errors in the Barista Front End application, particularly when encountering 422 UNPROCESSABLE ENTITY responses.

## Overview of Changes

The following components were modified to improve authentication error handling:

1. **OrderDataService.js**
   - Enhanced token detection and management
   - Added error counting and threshold-based fallback mode
   - Implemented intelligent error detection for auth-related errors
   - Added auth status recovery mechanism

2. **anti-flicker.js**
   - Expanded JWT error detection
   - Enhanced request blocking for auth errors
   - Added visual reconnection UI
   - Implemented error recovery mechanism

## Detailed Implementation

### Enhanced Token Management

The application now looks for tokens in multiple storage locations:

```javascript
this.token = localStorage.getItem('coffee_system_token') || 
             localStorage.getItem('coffee_auth_token') || 
             localStorage.getItem('jwt_token') || null;
```

When setting tokens, we store in multiple locations for compatibility:

```javascript
localStorage.setItem('coffee_system_token', token);
localStorage.setItem('coffee_auth_token', token);
```

### Authentication Error Tracking

A counter tracks consecutive authentication errors:

```javascript
this.authErrors = 0; // Track consecutive auth errors
this.maxAuthErrors = 3; // Maximum allowed auth errors before forcing fallback mode
```

The counter persists across page reloads:

```javascript
const authErrorCount = parseInt(localStorage.getItem('auth_error_count') || '0');
if (authErrorCount > 0) {
  this.authErrors = authErrorCount;
}
```

### Automatic Fallback Mode

When authentication errors exceed a threshold, the application automatically switches to fallback mode:

```javascript
if (this.authErrors >= this.maxAuthErrors) {
  console.log('Auth errors exceed threshold, enabling fallback mode');
  this.useFallbackData = true;
  localStorage.setItem('use_fallback_data', 'true');
}
```

### Expanded Error Detection

The application now recognizes a broader range of authentication errors:

```javascript
if (response && (
    response.msg === 'Subject must be a string' || 
    response.msg === 'Request blocked by anti-flicker protection' ||
    response.msg === 'Signature verification failed' ||
    response.msg === 'Token has expired' ||
    response.blocked === true ||
    response.error === 'Unauthorized' ||
    response.error === 'InvalidToken')) {
  // Handle auth error
}
```

### Enhanced Request Handling

Requests are preemptively checked for authentication status:

```javascript
async fetchWithAuth(endpoint, options = {}) {
  try {
    // Check authentication status before making any request
    this.checkAuthStatus();
    
    // Preemptively check if we're in fallback mode
    if (this.useFallbackData) {
      console.log('In fallback mode, skipping API request to:', endpoint);
      throw new Error('Using fallback data');
    }
    // Continue with request...
```

### Authentication Status Recovery

A mechanism to recover from authentication errors:

```javascript
checkAuthStatus() {
  // Check if auth errors refresh is needed
  const refreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';
  const errorCount = parseInt(localStorage.getItem('auth_error_count') || '0');
  
  if (refreshNeeded) {
    // Check if we have a token now
    const token = localStorage.getItem('coffee_system_token') || 
                  localStorage.getItem('coffee_auth_token') || 
                  localStorage.getItem('jwt_token');
    
    if (token) {
      // Reset auth status and exit fallback mode
      // ...
    }
  }
  // ...
}
```

### Visual Reconnection UI

The anti-flicker script now provides a visual indicator when authentication recovery is needed:

```javascript
// Check if auth recovery is needed
const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';

// Set different appearance based on auth recovery status
if (authErrorRefreshNeeded) {
  refreshBtn.textContent = 'Reconnect to Server';
  refreshBtn.style.backgroundColor = '#e74c3c'; // Red for auth recovery
  refreshBtn.style.animation = 'pulse 2s infinite';
} else {
  refreshBtn.textContent = 'Refresh Data';
  refreshBtn.style.backgroundColor = '#0066cc'; // Blue for normal refresh
}
```

### Error Recovery Mechanism

The refresh button now provides a way to clear error states and try reconnecting:

```javascript
// If we need auth recovery, clear JWT error caches
if (authErrorRefreshNeeded) {
  console.log('Clearing JWT error caches and resetting auth error counters');
  localStorage.removeItem('jwt_error_endpoints');
  localStorage.setItem('auth_error_count', '0');
  localStorage.removeItem('auth_error_refresh_needed');
  
  // Clear error tracking map
  jwtErrorTimes.clear();
  
  // Try to exit fallback mode
  localStorage.setItem('use_fallback_data', 'false');
  
  // Refresh the page to ensure clean state
  window.location.reload();
  return;
}
```

## User Interface Notifications

### API Notification Banner

To provide clear visibility to users when authentication issues occur, we've implemented an enhanced notification banner:

1. **Self-detecting API Status**: The banner automatically detects:
   - Authentication errors (`auth_error_refresh_needed`)
   - Fallback mode status (`use_fallback_data`)
   - Connection status (`coffee_connection_status`)

2. **Color-coded Notifications**:
   - Red for authentication errors
   - Yellow for fallback mode
   - Orange for connection issues

3. **Clear Recovery Actions**:
   - "Reconnect" button for authentication errors that clears error state and refreshes
   - "Try Reconnect" for fallback mode that attempts to restore API connection
   - "Refresh" for general connection issues

Example implementation:

```jsx
// Determine banner content based on status
if (status.authErrorRefreshNeeded) {
  title = 'Authentication Error';
  message = 'Could not connect to backend service. Using sample data instead.';
  buttonText = 'Reconnect';
  colorScheme = {
    container: 'bg-red-600 text-white',
    button: 'bg-white text-red-600 hover:bg-red-100'
  };
}
```

## Benefits

1. **Improved Resilience**: The application can now gracefully handle various authentication errors.

2. **Enhanced User Experience**: Users are given visual feedback and a clear way to recover from authentication issues.

3. **Automatic Fallback**: The system automatically switches to fallback mode when persistent authentication errors occur.

4. **Error Recovery**: A clear mechanism is provided to recover from error states.

5. **Reduced Flicker**: By smartly handling authentication errors, the UI avoids flickering between loaded and error states.

6. **Clear Notifications**: Users are now clearly informed when authentication issues occur with "Could not connect to backend service. Using sample data instead." message.

## Fallback Data Loading

When in fallback mode, the application uses sample data stored in localStorage. We've improved how this data is loaded to ensure a smooth user experience:

### Immediate Fallback Data Creation

We've added a `_ensureFallbackDataLoaded()` method in OrderDataService that creates sample data if none exists:

```javascript
_ensureFallbackDataLoaded() {
  try {
    // Check if fallback data is available
    const fallbackDataAvailable = localStorage.getItem('fallback_data_available') === 'true';
    
    if (!fallbackDataAvailable) {
      console.log('Fallback data not available, loading sample data');
      
      // Create sample fallback data
      const samplePendingOrders = [
        {
          id: 'sample_1',
          orderNumber: 'SP001',
          customerName: 'John Smith',
          coffeeType: 'Large Flat White',
          // ...more fields
        },
        // ...more orders
      ];
      
      // Store the fallback data
      localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
      localStorage.setItem('fallback_in_progress_orders', JSON.stringify(sampleInProgressOrders));
      localStorage.setItem('fallback_completed_orders', JSON.stringify(sampleCompletedOrders));
      
      // Mark that fallback data is now available
      localStorage.setItem('fallback_data_available', 'true');
    }
  } catch (error) {
    console.error('Error ensuring fallback data is available:', error);
  }
}
```

### Direct Loading in useOrders Hook

We've improved the `fetchOrdersData` function in useOrders.js to immediately load fallback data when authentication errors occur:

```javascript
// Check if we're in fallback or auth error mode first
const useFallbackData = localStorage.getItem('use_fallback_data') === 'true';
const authErrorRefreshNeeded = localStorage.getItem('auth_error_refresh_needed') === 'true';

if (authErrorRefreshNeeded || useFallbackData) {
  console.log('In fallback/auth error mode - loading fallback data directly');
  
  // Load fallback data immediately
  try {
    // Get fallback data from localStorage
    const fallbackPendingOrders = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
    const fallbackInProgressOrders = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
    const fallbackCompletedOrders = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
    
    // Set fallback data directly
    setTimeout(() => {
      // Update all state directly with fallback data
      setPendingOrders(fallbackPendingOrders);
      setInProgressOrders(fallbackInProgressOrders);
      setCompletedOrders(fallbackCompletedOrders);
      
      // Make sure loading is set to false
      setLoading(false);
      setIsRefreshing(false);
      setError(null);
      
      // Set online status to false
      setOnline(false);
    }, 0);
    
    return;  // Skip regular data fetching
  } catch (fallbackError) {
    console.error('Error loading fallback data:', fallbackError);
  }
}
```

### Ensuring Loading State is Disabled

We've added additional checks to ensure loading state is disabled when in fallback mode:

```javascript
// If we're using fallback data, make sure loading is disabled
if (localStorage.getItem('use_fallback_data') === 'true' || 
    localStorage.getItem('auth_error_refresh_needed') === 'true') {
  console.log('Using fallback data, ensuring loading state is disabled');
  setLoading(false);
  setError(null);
}
```

These improvements ensure that:

1. Sample data is always created when needed
2. The loading spinner is immediately replaced with fallback data
3. Users don't see spinning loaders when authentication fails
4. The application remains usable even without a backend connection