// components/NotificationSystem.js
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { X, AlertCircle, Check, Info, AlertTriangle } from 'lucide-react';

// Create context for the notification system
const NotificationContext = createContext();

// Define notification types and their colors
const NOTIFICATION_TYPES = {
  SUCCESS: {
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-500',
    icon: <Check className="text-green-500" size={20} />
  },
  ERROR: {
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-500',
    icon: <AlertCircle className="text-red-500" size={20} />
  },
  WARNING: {
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-800',
    borderColor: 'border-yellow-500',
    icon: <AlertTriangle className="text-yellow-500" size={20} />
  },
  INFO: {
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-500',
    icon: <Info className="text-blue-500" size={20} />
  }
};

// Default notification duration
const DEFAULT_DURATION = 5000; // 5 seconds

/**
 * Notification Provider component to wrap the app
 */
export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  // Add a new notification
  const addNotification = useCallback((type, message, duration = DEFAULT_DURATION) => {
    const id = Date.now().toString();
    const newNotification = {
      id,
      type,
      message,
      duration
    };

    setNotifications(prevNotifications => [...prevNotifications, newNotification]);

    // Automatically remove notification after duration
    if (duration > 0) {
      setTimeout(() => removeNotification(id), duration);
    }

    return id;
  }, []);

  // Remove a notification by ID
  const removeNotification = useCallback((id) => {
    setNotifications(prevNotifications => 
      prevNotifications.filter(notification => notification.id !== id)
    );
  }, []);

  // Shorthand functions for different notification types
  const success = useCallback((message, duration) => 
    addNotification('SUCCESS', message, duration), [addNotification]);
  
  const error = useCallback((message, duration) => 
    addNotification('ERROR', message, duration), [addNotification]);
  
  const warning = useCallback((message, duration) => 
    addNotification('WARNING', message, duration), [addNotification]);
  
  const info = useCallback((message, duration) => 
    addNotification('INFO', message, duration), [addNotification]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Context value
  const value = {
    notifications,
    addNotification,
    removeNotification,
    success,
    error,
    warning,
    info,
    clearAll
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationContainer notifications={notifications} removeNotification={removeNotification} />
    </NotificationContext.Provider>
  );
};

/**
 * The container that displays all active notifications
 */
const NotificationContainer = ({ notifications, removeNotification }) => {
  if (notifications.length === 0) return null;

  return (
    <div className="fixed right-0 top-0 z-50 p-4 space-y-3 max-h-screen overflow-y-auto max-w-md">
      {notifications.map(notification => (
        <Notification 
          key={notification.id}
          notification={notification}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
};

/**
 * Individual notification component
 */
const Notification = ({ notification, onClose }) => {
  const { type, message, id } = notification;
  const { bgColor, textColor, borderColor, icon } = NOTIFICATION_TYPES[type];
  
  // Fade in and slide animation with useEffect
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    // Small delay to allow for CSS transition
    const timeout = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div 
      className={`${bgColor} ${textColor} p-4 rounded-lg border-l-4 ${borderColor} shadow-md flex items-start
                  transition-all duration-300 ease-in-out transform ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
      role="alert"
    >
      <div className="flex-shrink-0 mr-3">
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium mb-1">{message}</div>
      </div>
      <button 
        onClick={onClose}
        className="ml-3 text-gray-400 hover:text-gray-800 focus:outline-none"
        aria-label="Close notification"
      >
        <X size={16} />
      </button>
    </div>
  );
};

/**
 * Custom hook to use the notification system
 */
export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export default NotificationProvider;
