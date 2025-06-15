# Frontend Improvement Plan

Based on the assessment, here's a prioritized implementation plan for improving the Expresso frontend codebase.

## 1. Standardize API Communication

Create an API client that handles endpoint patterns consistently:

```javascript
// src/services/ApiClient.js
class ApiClient {
  constructor() {
    this.baseUrl = '/api';
    this.token = null;
  }
  
  setToken(token) {
    this.token = token;
  }
  
  async request(endpoint, options = {}) {
    // Ensure consistent endpoint formatting
    const url = endpoint.startsWith('/') 
      ? `${this.baseUrl}${endpoint}` 
      : `${this.baseUrl}/${endpoint}`;
      
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
      ...(options.headers || {})
    };
    
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ 
          message: `HTTP error: ${response.status}` 
        }));
        throw new Error(error.message || `API error: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${url}`, error);
      throw error;
    }
  }
  
  // Helper methods
  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }
  
  post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data)
    });
  }
  
  put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }
  
  patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }
  
  delete(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options, 
      method: 'DELETE'
    });
  }
}

export default new ApiClient();
```

## 2. Centralized Error Handling

Implement a notification context for consistent error handling:

```javascript
// src/context/NotificationContext.js
import React, { createContext, useContext, useState } from 'react';

const NotificationContext = createContext();

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const addNotification = (notification) => {
    const id = Date.now().toString();
    setNotifications(prev => [
      ...prev,
      { id, ...notification }
    ]);
    
    // Auto-dismiss after timeout unless persistent
    if (!notification.persistent) {
      setTimeout(() => {
        dismissNotification(id);
      }, notification.duration || 5000);
    }
    
    return id;
  };

  const dismissNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Helper methods for common notifications
  const success = (message, options = {}) => {
    return addNotification({
      type: 'success',
      message,
      ...options
    });
  };

  const error = (message, options = {}) => {
    return addNotification({
      type: 'error',
      message,
      ...options
    });
  };

  const warning = (message, options = {}) => {
    return addNotification({
      type: 'warning',
      message,
      ...options
    });
  };

  const info = (message, options = {}) => {
    return addNotification({
      type: 'info',
      message,
      ...options
    });
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        addNotification,
        dismissNotification,
        success,
        error,
        warning,
        info
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
```

## 3. Notification Component

Create a component to display notifications:

```javascript
// src/components/NotificationSystem.js
import React from 'react';
import { XCircle, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useNotification } from '../context/NotificationContext';

const NotificationSystem = () => {
  const { notifications, dismissNotification } = useNotification();

  // If no notifications, don't render anything
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2 max-w-sm">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`p-4 rounded-md shadow-md flex items-start space-x-2 ${getBackgroundColor(notification.type)}`}
          role="alert"
        >
          <div className="flex-shrink-0">
            {getIcon(notification.type)}
          </div>
          <div className="flex-1 mr-2">
            <p className={`text-sm font-medium ${getTextColor(notification.type)}`}>
              {notification.message}
            </p>
          </div>
          <button
            onClick={() => dismissNotification(notification.id)}
            className={`flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 ${getRingColor(notification.type)} rounded-md`}
            aria-label="Dismiss notification"
          >
            <XCircle size={18} className={getTextColor(notification.type)} />
          </button>
        </div>
      ))}
    </div>
  );
};

// Helper functions for styling
const getBackgroundColor = (type) => {
  switch (type) {
    case 'success': return 'bg-green-50';
    case 'error': return 'bg-red-50';
    case 'warning': return 'bg-yellow-50';
    case 'info': return 'bg-blue-50';
    default: return 'bg-gray-50';
  }
};

const getTextColor = (type) => {
  switch (type) {
    case 'success': return 'text-green-800';
    case 'error': return 'text-red-800';
    case 'warning': return 'text-yellow-800';
    case 'info': return 'text-blue-800';
    default: return 'text-gray-800';
  }
};

const getRingColor = (type) => {
  switch (type) {
    case 'success': return 'focus:ring-green-500';
    case 'error': return 'focus:ring-red-500';
    case 'warning': return 'focus:ring-yellow-500';
    case 'info': return 'focus:ring-blue-500';
    default: return 'focus:ring-gray-500';
  }
};

const getIcon = (type) => {
  switch (type) {
    case 'success': return <CheckCircle size={24} className="text-green-500" />;
    case 'error': return <XCircle size={24} className="text-red-500" />;
    case 'warning': return <AlertTriangle size={24} className="text-yellow-500" />;
    case 'info': return <Info size={24} className="text-blue-500" />;
    default: return null;
  }
};

export default NotificationSystem;
```

## 4. Error Boundary for React Components

Create an error boundary to prevent UI crashes:

```javascript
// src/components/ErrorBoundary.js
import React from 'react';
import { AlertTriangle } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
    // You could also log to an error reporting service here
  }

  render() {
    if (this.state.hasError) {
      // You can customize the fallback UI
      return (
        <div className="p-4 border border-red-300 bg-red-50 rounded-md">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="text-red-500" />
            <h2 className="text-lg font-semibold text-red-700">Something went wrong</h2>
          </div>
          <p className="mt-2 text-red-600">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button 
            className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

## 5. Order Management Hook Refactoring

Extract order completion logic to a custom hook:

```javascript
// src/hooks/useOrderCompletion.js
import { useState } from 'react';
import { useNotification } from '../context/NotificationContext';
import ApiClient from '../services/ApiClient';

export function useOrderCompletion() {
  const [isProcessing, setIsProcessing] = useState(false);
  const { success, error } = useNotification();

  const startOrder = async (orderId) => {
    if (isProcessing) return false;
    
    setIsProcessing(true);
    try {
      const result = await ApiClient.post(`/orders/${orderId}/start`);
      
      if (result.success) {
        success(`Order #${orderId} started successfully`);
        setIsProcessing(false);
        return true;
      } else {
        error(result.message || 'Failed to start order');
        setIsProcessing(false);
        return false;
      }
    } catch (err) {
      error(`Error starting order: ${err.message}`);
      setIsProcessing(false);
      return false;
    }
  };

  const completeOrder = async (orderId) => {
    if (isProcessing) return false;
    
    setIsProcessing(true);
    try {
      const result = await ApiClient.post(`/orders/${orderId}/complete`);
      
      if (result.success) {
        success(`Order #${orderId} completed successfully`);
        setIsProcessing(false);
        return true;
      } else {
        error(result.message || 'Failed to complete order');
        setIsProcessing(false);
        return false;
      }
    } catch (err) {
      error(`Error completing order: ${err.message}`);
      setIsProcessing(false);
      return false;
    }
  };

  const pickupOrder = async (orderId) => {
    if (isProcessing) return false;
    
    setIsProcessing(true);
    try {
      const result = await ApiClient.post(`/orders/${orderId}/pickup`);
      
      if (result.success) {
        success(`Order #${orderId} marked as picked up`);
        setIsProcessing(false);
        return true;
      } else {
        error(result.message || 'Failed to mark order as picked up');
        setIsProcessing(false);
        return false;
      }
    } catch (err) {
      error(`Error marking order as picked up: ${err.message}`);
      setIsProcessing(false);
      return false;
    }
  };

  const sendOrderMessage = async (orderId, message) => {
    if (isProcessing) return false;
    
    setIsProcessing(true);
    try {
      const result = await ApiClient.post(`/orders/${orderId}/message`, { message });
      
      if (result.success) {
        success(`Message sent successfully`);
        setIsProcessing(false);
        return true;
      } else {
        error(result.message || 'Failed to send message');
        setIsProcessing(false);
        return false;
      }
    } catch (err) {
      error(`Error sending message: ${err.message}`);
      setIsProcessing(false);
      return false;
    }
  };

  return {
    isProcessing,
    startOrder,
    completeOrder,
    pickupOrder,
    sendOrderMessage
  };
}
```

## 6. Order Utils for Categorization

Create utility functions for order categorization:

```javascript
// src/utils/orderUtils.js

/**
 * Categorizes orders into different groups
 * @param {Array} orders - List of orders to categorize
 * @returns {Object} Object containing categorized orders
 */
export const categorizeOrders = (orders) => {
  if (!Array.isArray(orders)) return { vipOrders: [], regularOrders: [], batchGroups: {} };
  
  // VIP orders
  const vipOrders = orders.filter(order => order.priority === true);
  
  // Batch groups
  const batchGroups = {};
  orders.forEach(order => {
    if (order.batchGroup && !order.priority) {
      if (!batchGroups[order.batchGroup]) {
        batchGroups[order.batchGroup] = [];
      }
      batchGroups[order.batchGroup].push(order);
    }
  });
  
  // Regular orders (not VIP, not in batch)
  const regularOrders = orders.filter(order => 
    !order.priority && !order.batchGroup
  );
  
  return { vipOrders, regularOrders, batchGroups };
};

/**
 * Gets the background color class for an order based on its status and wait time
 * @param {Object} order - The order to get the background color for
 * @returns {string} CSS class name
 */
export const getOrderBackgroundColor = (order) => {
  if (!order) return 'bg-gray-100';
  
  if (order.priority === true) {
    return 'bg-amber-100 border-amber-500';
  }
  
  const waitTime = order.waitTime || 0;
  
  if (waitTime > 15) {
    return 'bg-red-100 border-red-500';
  } else if (waitTime > 10) {
    return 'bg-orange-100 border-orange-500';
  } else if (waitTime > 5) {
    return 'bg-yellow-100 border-yellow-500';
  }
  
  return 'bg-green-100 border-green-500';
};

/**
 * Formats a time period in a readable format
 * @param {number} minutes - Minutes to format
 * @returns {string} Formatted time
 */
export const formatTimeSince = (minutes) => {
  if (minutes === undefined || minutes === null) return 'Unknown';
  
  if (minutes < 1) {
    return 'Just now';
  } else if (minutes === 1) {
    return '1 minute';
  } else if (minutes < 60) {
    return `${minutes} minutes`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes === 0) {
      return hours === 1 ? '1 hour' : `${hours} hours`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  }
};
```

## 7. Accessibility Improvements

Create a Modal component with proper accessibility:

```javascript
// src/components/Modal.js
import React, { useEffect, useRef } from 'react';
import { XCircle } from 'lucide-react';

const Modal = ({ isOpen, onClose, title, children, size = 'md' }) => {
  const modalRef = useRef(null);
  const previousFocus = useRef(null);

  // Handle keyboard events
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Close on escape
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
      
      // Trap focus inside modal
      if (e.key === 'Tab' && isOpen && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusableElements.length === 0) return;
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        
        // If shift+tab and on first element, move to last
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } 
        // If tab and on last element, move to first
        else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);
  
  // Manage focus when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      // Store current focus
      previousFocus.current = document.activeElement;
      
      // Focus the modal
      if (modalRef.current) {
        const focusable = modalRef.current.querySelector(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        if (focusable) {
          setTimeout(() => focusable.focus(), 10);
        } else {
          modalRef.current.focus();
        }
      }
      
      // Prevent scrolling on body
      document.body.style.overflow = 'hidden';
    } else {
      // Restore body scrolling
      document.body.style.overflow = '';
      
      // Restore focus
      if (previousFocus.current) {
        previousFocus.current.focus();
      }
    }
    
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);
  
  if (!isOpen) return null;
  
  // Size classes
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-4'
  };
  
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-labelledby={title ? 'modal-title' : undefined}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      ></div>
      
      {/* Modal */}
      <div className="flex min-h-screen items-center justify-center p-4">
        <div
          ref={modalRef}
          className={`bg-white rounded-lg shadow-xl overflow-hidden transform transition-all ${sizeClasses[size] || sizeClasses.md}`}
          tabIndex={-1}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 id="modal-title" className="text-lg font-semibold text-gray-900">
              {title}
            </h2>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 rounded-md"
              onClick={onClose}
              aria-label="Close"
            >
              <XCircle size={20} />
            </button>
          </div>
          
          {/* Content */}
          <div className="px-6 py-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Modal;
```

## 8. Responsive Layout Components

Create responsive layout components:

```javascript
// src/components/layout/ResponsiveContainer.js
import React from 'react';

const ResponsiveContainer = ({ children, className = '' }) => {
  return (
    <div className={`w-full px-4 sm:px-6 md:px-8 mx-auto max-w-7xl ${className}`}>
      {children}
    </div>
  );
};

export default ResponsiveContainer;
```

```javascript
// src/components/layout/ResponsiveGrid.js
import React from 'react';

const ResponsiveGrid = ({ 
  children, 
  columns = { default: 1, sm: 2, md: 3, lg: 4 },
  gap = 'gap-4',
  className = ''
}) => {
  // Build the grid columns class
  const gridColsClass = Object.entries(columns).map(([breakpoint, cols]) => {
    if (breakpoint === 'default') {
      return `grid-cols-${cols}`;
    }
    return `${breakpoint}:grid-cols-${cols}`;
  }).join(' ');
  
  return (
    <div className={`grid ${gridColsClass} ${gap} ${className}`}>
      {children}
    </div>
  );
};

export default ResponsiveGrid;
```

## 9. Implementation Plan

1. First Phase:
   - Implement ApiClient
   - Create NotificationContext
   - Add ErrorBoundary

2. Second Phase:
   - Refactor hooks with consistent error handling
   - Extract utility functions

3. Third Phase:
   - Improve accessibility in components
   - Enhance responsive design

4. Final Phase:
   - Mobile-specific optimizations
   - Performance improvements

## 10. Coding Standards

To maintain consistency:

1. Use function components with hooks
2. Implement proper prop validation
3. Extract repeated logic to custom hooks
4. Use consistent naming conventions:
   - Components: PascalCase
   - Hooks: camelCase with 'use' prefix
   - Utilities: camelCase

By implementing these improvements, we'll address the main issues while maintaining the existing functionality and minimizing disruption to the current codebase.