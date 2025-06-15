# Expresso Service Architecture

This document describes the service architecture of the Expresso coffee ordering system frontend and how to integrate with the various services.

## Overview

The new service architecture follows a more centralized approach with dedicated services for specific concerns:

1. **ConfigService** - Manages configuration and environment variables
2. **AuthService** - Handles authentication and user management
3. **NotificationService** - Provides reliable customer notification delivery
4. **NotificationSystem** - UI component for in-app notifications to users
5. **OrderDataService** - Manages order data and operations

## Environment Configuration

The system now uses environment variables to configure different aspects of the application. This allows for easier deployment to different environments.

Example `.env` file:

```
REACT_APP_API_URL=http://localhost:5001/api
REACT_APP_VERSION=1.0.0
REACT_APP_ENV=development
```

## Service Integrations

### ConfigService

ConfigService provides centralized configuration management and environment variable access.

```javascript
import ConfigService from '../services/ConfigService';

// Get a configuration value with default
const apiUrl = ConfigService.get('apiBaseUrl', 'http://localhost:5001/api');

// Set a configuration value
ConfigService.set('notificationTimeout', 30);

// Get a properly formatted API URL
const usersEndpoint = ConfigService.getApiUrl('users');
```

### NotificationSystem

NotificationSystem provides a React context and components for showing in-app notifications to users. It replaces `alert()` with more user-friendly notifications.

```jsx
import { NotificationProvider, useNotification } from '../components/NotificationSystem';

// Wrap your app with the provider
function App() {
  return (
    <NotificationProvider>
      <YourApp />
    </NotificationProvider>
  );
}

// Use in components
function YourComponent() {
  const { showSuccess, showError, showWarning, showInfo } = useNotification();
  
  const handleSave = async () => {
    try {
      await saveData();
      showSuccess('Data saved successfully');
    } catch (error) {
      showError(`Error: ${error.message}`);
    }
  };
  
  return (
    <button onClick={handleSave}>Save</button>
  );
}
```

For non-React contexts, you can use the global notify function:

```javascript
import { notify } from '../components/NotificationSystem';

// Show a success notification
notify('success', 'Operation completed successfully');

// Show an error notification
notify('error', 'Failed to complete operation');
```

### NotificationService

NotificationService provides a robust way to send notifications to customers with multiple fallback mechanisms.

```javascript
import NotificationService from '../services/NotificationService';

// Send a notification to a customer
const result = await NotificationService.sendNotification(order);

if (result.success) {
  console.log('Notification sent successfully');
} else {
  console.error('Failed to send notification:', result.message);
}
```

### AuthService

AuthService handles user authentication and provides token management.

```javascript
import AuthService from '../services/AuthService';

// Login
const loginResult = await AuthService.login(username, password);

// Check if user is authenticated
if (AuthService.isAuthenticated()) {
  // User is logged in
}

// Get current user
const user = AuthService.getUser();

// Get auth headers for API requests
const headers = AuthService.getAuthHeaders();

// Logout
AuthService.logout();
```

## BaristaInterface Integration

The BaristaInterface component has been updated to use the new services. Here's an example of the updated `handleCompleteOrder` method:

```javascript
const handleCompleteOrder = async (orderId) => {
  try {
    // Get the notification API
    const { showSuccess, showError } = useNotification();
    
    // First find the order
    const orderToComplete = inProgressOrders.find(o => o.id === orderId);
    
    if (!orderToComplete) {
      showError('Could not find the order details. Please try again.');
      return false;
    }
    
    // Add station info
    const orderWithStation = {
      ...orderToComplete,
      stationName: stationInfo?.name || settings.stationName
    };
    
    // Complete the order in the backend
    const result = await completeOrder(orderId);
    
    if (result.success) {
      // Use NotificationService for reliable delivery
      const notificationResult = await NotificationService.sendNotification(orderWithStation);
      
      // Update UI
      setMessageStatus(prev => ({
        ...prev,
        [orderId]: { 
          status: notificationResult.success ? 'sent' : 'failed', 
          error: notificationResult.success ? null : notificationResult.message,
          timestamp: new Date() 
        }
      }));
      
      return true;
    } else {
      showError('Failed to complete the order. Please try again.');
    }
    
    return false;
  } catch (err) {
    console.error('Error completing order:', err);
    showError(err.message || 'Unknown error completing order');
    return false;
  }
};
```

## Advantages of the New Architecture

1. **Centralized Configuration** - All configuration is managed in one place, making it easier to change and maintain.
2. **Better Error Handling** - More robust error handling and user feedback through NotificationSystem.
3. **Reliable Notifications** - Multiple fallback mechanisms for customer notifications through NotificationService.
4. **Improved Auth Management** - More comprehensive token management and auth state in AuthService.
5. **Environment Flexibility** - Easy configuration for different environments through environment variables.

## Migration Guide

To migrate existing components to use the new services:

1. Import the necessary services:
   ```javascript
   import ConfigService from '../services/ConfigService';
   import NotificationService from '../services/NotificationService';
   import { useNotification } from '../components/NotificationSystem';
   import AuthService from '../services/AuthService';
   ```

2. Replace direct API URLs with ConfigService:
   ```javascript
   // Before
   const url = 'http://localhost:5001/api/orders';
   
   // After
   const url = ConfigService.getApiUrl('orders');
   ```

3. Replace alerts with NotificationSystem:
   ```javascript
   // Before
   alert('Operation completed');
   
   // After
   showSuccess('Operation completed');
   // or
   notify('success', 'Operation completed');
   ```

4. Use NotificationService for customer notifications:
   ```javascript
   // Before
   await OrderDataService.sendMessageToCustomer(orderId, message);
   
   // After
   await NotificationService.sendNotification(order);
   ```

5. Use AuthService for auth management:
   ```javascript
   // Before
   const token = localStorage.getItem('coffee_system_token');
   
   // After
   const token = AuthService.getToken();
   ```

## Conclusion

This new service architecture provides a more maintainable, reliable, and flexible foundation for the Expresso coffee ordering system. By centralizing common functionality and improving error handling, the system will be more robust and user-friendly.