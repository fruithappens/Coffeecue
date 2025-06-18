// components/ApiNotificationBanner.js
import React, { useState, useEffect } from 'react';
import OrderDataService from '../services/OrderDataService';

/**
 * ApiNotificationBanner shows status about the API connection and automatically detects
 * authentication issues and connection problems without requiring props
 */
const ApiNotificationBanner = () => {
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState({
    useFallbackData: false,
    authErrorRefreshNeeded: false,
    connectionStatus: 'online'
  });
  
  // Check status every 5 seconds, but wait 3 seconds before first check
  useEffect(() => {
    const checkStatus = () => {
      setStatus({
        useFallbackData: localStorage.getItem('use_fallback_data') === 'true',
        authErrorRefreshNeeded: localStorage.getItem('auth_error_refresh_needed') === 'true',
        connectionStatus: localStorage.getItem('coffee_connection_status') || 'online'
      });
    };
    
    // Wait 3 seconds before first check to avoid showing banners during app startup
    const initialTimer = setTimeout(() => {
      checkStatus();
      
      // Then set up interval for ongoing checks
      const interval = setInterval(checkStatus, 5000);
      
      // Store interval ID for cleanup
      window._bannerCheckInterval = interval;
    }, 3000);
    
    // Listen for auth recovery events
    const handleAuthRecovered = () => {
      setStatus(prev => ({
        ...prev,
        authErrorRefreshNeeded: false,
        useFallbackData: false
      }));
    };
    
    // Listen for order refresh events to update status
    const handleRefreshOrders = () => {
      checkStatus();
    };
    
    window.addEventListener('app:authRecovered', handleAuthRecovered);
    window.addEventListener('app:refreshOrders', handleRefreshOrders);
    
    return () => {
      clearTimeout(initialTimer);
      if (window._bannerCheckInterval) {
        clearInterval(window._bannerCheckInterval);
        window._bannerCheckInterval = null;
      }
      window.removeEventListener('app:authRecovered', handleAuthRecovered);
      window.removeEventListener('app:refreshOrders', handleRefreshOrders);
    };
  }, []);
  
  // If not visible or no issues, don't render anything
  if (!visible || (!status.useFallbackData && !status.authErrorRefreshNeeded && status.connectionStatus !== 'offline')) {
    return null;
  }
  
  // Handle refresh/reconnect button click
  const handleRefreshOrReconnect = async () => {
    if (status.authErrorRefreshNeeded) {
      // Clear JWT error caches and reset auth error counters
      localStorage.removeItem('jwt_error_endpoints');
      localStorage.setItem('auth_error_count', '0');
      localStorage.removeItem('auth_error_refresh_needed');
      
      // Try to exit fallback mode
      localStorage.setItem('use_fallback_data', 'false');
      
      // Refresh the page to ensure clean state
      window.location.reload();
    } else {
      // Clear offline status immediately when user clicks refresh
      localStorage.setItem('coffee_connection_status', 'online');
      setStatus(prev => ({
        ...prev,
        connectionStatus: 'online'
      }));
      
      // Try to reconnect to the server via OrderDataService
      try {
        const isConnected = await OrderDataService.checkConnection();
        if (isConnected) {
          // If connection successful, refresh orders
          window.dispatchEvent(new CustomEvent('app:refreshOrders'));
          
          // If we were in fallback mode, try to exit
          if (status.useFallbackData) {
            localStorage.setItem('use_fallback_data', 'false');
            setStatus(prev => ({
              ...prev,
              useFallbackData: false
            }));
          }
        }
      } catch (error) {
        console.log('Reconnection attempt failed:', error);
        // Don't immediately set back to offline - let the retry logic handle it
      }
    }
  };
  
  // Determine banner content based on status
  let title, message, buttonText, colorScheme;
  
  if (status.authErrorRefreshNeeded) {
    title = 'Authentication Error';
    message = 'Could not connect to backend service. Using sample data instead.';
    buttonText = 'Reconnect';
    colorScheme = {
      container: 'bg-red-600 text-white',
      button: 'bg-white text-red-600 hover:bg-red-100'
    };
  } else if (status.useFallbackData) {
    title = 'Fallback Mode Active';
    message = 'Using sample data. Could not connect to backend service.';
    buttonText = 'Try Reconnect';
    colorScheme = {
      container: 'bg-yellow-500 text-white',
      button: 'bg-white text-yellow-700 hover:bg-yellow-100'
    };
  } else if (status.connectionStatus === 'offline') {
    title = 'Connection Issue';
    message = 'Connection to server lost. Using cached data.';
    buttonText = 'Refresh';
    colorScheme = {
      container: 'bg-orange-500 text-white',
      button: 'bg-white text-orange-700 hover:bg-orange-100'
    };
  }
  
  return (
    <div className={`fixed top-0 left-0 right-0 ${colorScheme.container} p-3 z-50 shadow-md`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm opacity-90">{message}</p>
        </div>
        
        <div className="flex items-center">
          <button
            onClick={handleRefreshOrReconnect}
            className={`${colorScheme.button} px-3 py-1 rounded-md text-sm font-medium mr-3 transition-colors`}
          >
            {buttonText}
          </button>
          
          <button
            onClick={() => setVisible(false)}
            className="text-white opacity-75 hover:opacity-100 transition-opacity"
            aria-label="Dismiss"
          >
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApiNotificationBanner;