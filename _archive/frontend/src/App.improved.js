// App.improved.js
import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import BaristaInterface from './components/BaristaInterface';
import Organiser from './components/Organiser';
import DisplayScreen from './components/DisplayScreen';
import DisplaySelector from './components/DisplaySelector';
import SupportInterface from './components/SupportInterface';
import LoginPage from './components/auth/LoginPage';
import AuthService from './services/AuthService';
import { AppProvider } from './context/AppContext';
import AuthGuard from './components/auth/AuthGuard';
import UnauthorizedPage from './components/auth/UnauthorizedPage';
import OfflineDataHelper from './utils/offlineDataHelper';
import ApiNotificationBanner from './components/ApiNotificationBanner';

function App() {
  const [initialized, setInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [apiStatus, setApiStatus] = useState({
    isConnected: true,
    message: null,
    fallbackEnabled: false
  });

  // Initialize app with fallback data if needed
  useEffect(() => {
    // Check for fallback mode
    const useFallback = localStorage.getItem('use_fallback_data') === 'true';
    
    // Initialize app
    if (useFallback || !AuthService.isLoggedIn()) {
      // Prepare fallback data if needed
      OfflineDataHelper.prepareOfflineData();
      
      // Update API status if in fallback mode
      if (useFallback) {
        setApiStatus({
          isConnected: false,
          fallbackEnabled: true,
          message: 'Operating in offline mode with fallback data'
        });
      }
    }
    
    // Set initialized flag
    setInitialized(true);
    
    // Listen for fallback mode toggle
    window.addEventListener('fallback_mode_enabled', handleFallbackEnabled);
    window.addEventListener('fallback_mode_disabled', handleFallbackDisabled);
    
    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('fallback_mode_enabled', handleFallbackEnabled);
      window.removeEventListener('fallback_mode_disabled', handleFallbackDisabled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleFallbackEnabled, handleFallbackDisabled]);
  
  // Handle fallback mode enabled event
  const handleFallbackEnabled = useCallback(() => {
    // Prepare fallback data when switching to fallback mode
    OfflineDataHelper.prepareOfflineData();
    setApiStatus(prev => ({
      ...prev,
      isConnected: false,
      fallbackEnabled: true,
      message: 'Operating in offline mode with fallback data'
    }));
  }, []);
  
  // Handle fallback mode disabled event
  const handleFallbackDisabled = useCallback(() => {
    // Any cleanup needed when leaving fallback mode
    console.log('Fallback mode disabled, returning to online mode');
    setApiStatus(prev => ({
      ...prev,
      isConnected: true,
      fallbackEnabled: false,
      message: 'Reconnected to online services'
    }));
  }, []);
  
  // Handle browser going online
  const handleOnline = useCallback(async () => {
    console.log('Browser reports online status');
    // Check if we can actually reach the API
    try {
      const response = await fetch('/api/heartbeat', { 
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000) // Timeout after 5 seconds
      });
      
      if (response.ok) {
        setApiStatus(prev => ({
          ...prev,
          isConnected: true,
          message: 'Connection to API restored'
        }));
        
        // If we were in fallback mode, ask user if they want to exit it
        if (OfflineDataHelper.isFallbackModeEnabled()) {
          const confirm = window.confirm(
            'Connection to the API server has been restored. Would you like to exit fallback mode?'
          );
          if (confirm) {
            OfflineDataHelper.disableFallbackMode();
          }
        }
      }
    } catch (error) {
      console.error('API check failed despite browser being online:', error);
      // We're "online" according to the browser but can't reach the API
      setApiStatus(prev => ({
        ...prev,
        isConnected: false,
        message: 'Browser is online but API is unreachable'
      }));
    }
  }, []);
  
  // Handle browser going offline
  const handleOffline = useCallback(() => {
    console.log('Browser reports offline status');
    setApiStatus(prev => ({
      ...prev,
      isConnected: false,
      message: 'Network connection lost'
    }));
    
    // If not already in fallback mode, ask user if they want to enable it
    if (!OfflineDataHelper.isFallbackModeEnabled()) {
      const confirm = window.confirm(
        'Network connection has been lost. Would you like to enable fallback mode?'
      );
      if (confirm) {
        OfflineDataHelper.enableFallbackMode();
      }
    }
  }, []);

  // Test API connection specifically for authentication
  const testApiForAuth = useCallback(async () => {
    if (apiStatus.fallbackEnabled) {
      console.log('In fallback mode, skipping API test');
      return false;
    }
    
    try {
      const response = await fetch('/api/auth/status', { 
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          'Authorization': `Bearer ${AuthService.getToken()}`
        },
        signal: AbortSignal.timeout(5000) // Timeout after 5 seconds
      });
      
      if (response.ok) {
        setApiStatus(prev => ({
          ...prev,
          isConnected: true,
          message: null // Clear any error messages
        }));
        return true;
      } else {
        // API is reachable but returned an error
        console.warn('API auth check failed with status:', response.status);
        setApiStatus(prev => ({
          ...prev,
          isConnected: true, // We can connect, but there may be auth issues
          message: response.status === 401 ? 'Authentication required' : 'API error'
        }));
        return false;
      }
    } catch (error) {
      console.error('API auth check failed:', error);
      setApiStatus(prev => ({
        ...prev,
        isConnected: false,
        message: 'Cannot connect to API server'
      }));
      return false;
    }
  }, [apiStatus.fallbackEnabled]);

  // Check authentication status on app load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // First check if API is reachable
        const apiReachable = await testApiForAuth();
        
        if (!apiReachable && !OfflineDataHelper.isFallbackModeEnabled()) {
          // API unreachable and not in fallback mode, offer to enable fallback
          const confirm = window.confirm(
            'Cannot connect to the API server. Would you like to enable fallback mode?'
          );
          
          if (confirm) {
            OfflineDataHelper.enableFallbackMode();
          }
        }
        
        // Continue with auth check regardless of API status
        const authenticated = await AuthService.handleAuthentication();
        setIsAuthenticated(authenticated);
      } catch (error) {
        console.error('Auth check failed:', error);
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };
    
    checkAuth();
    
    // Register event listener for storage changes (for multi-tab support)
    const handleStorageChange = (e) => {
      // Handle authentication token changes
      if (e.key === 'coffee_system_token') {
        if (!e.newValue) {
          // Token was removed in another tab, log out here too
          setIsAuthenticated(false);
        } else if (!localStorage.getItem('coffee_system_token') && e.newValue) {
          // Token was added in another tab, log in here too
          setIsAuthenticated(true);
        }
      }
      
      // Handle fallback mode changes
      if (e.key === 'use_fallback_data') {
        if (e.newValue === 'true') {
          // Fallback mode was enabled in another tab
          setApiStatus(prev => ({
            ...prev,
            isConnected: false,
            fallbackEnabled: true,
            message: 'Fallback mode enabled in another tab'
          }));
        } else if (e.newValue === 'false') {
          // Fallback mode was disabled in another tab
          setApiStatus(prev => ({
            ...prev,
            isConnected: true,
            fallbackEnabled: false,
            message: 'Fallback mode disabled in another tab'
          }));
          
          // Check API connection after brief delay
          setTimeout(() => testApiForAuth(), 1000);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [testApiForAuth]);

  // Show loading state while initializing or checking authentication
  if (!initialized || isCheckingAuth) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-600"></div>
        <p className="ml-3 text-lg text-amber-800">Loading Expresso...</p>
      </div>
    );
  }

  return (
    <AppProvider>
      <Router>
        {/* API Status Notification Banner */}
        {apiStatus.message && (
          <ApiNotificationBanner 
            isConnected={apiStatus.isConnected}
            message={apiStatus.message}
            fallbackEnabled={apiStatus.fallbackEnabled}
            onEnableFallback={() => OfflineDataHelper.enableFallbackMode()}
            onDisableFallback={() => OfflineDataHelper.disableFallbackMode()}
          />
        )}
        
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          
          {/* Login routes - handle both paths */}
          <Route path="/login" element={<LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />} />
          <Route path="/auth/login" element={<LoginPage onLoginSuccess={() => setIsAuthenticated(true)} />} />
          
          {/* Display routes - publicly accessible */}
          <Route path="/display" element={<DisplayScreen />} />
          <Route path="/displays" element={<DisplaySelector />} />
          
          {/* Protected routes with role-based access control */}
          <Route 
            path="/barista" 
            element={
              <AuthGuard requiredRoles={['barista', 'admin', 'staff']}>
                <BaristaInterface />
              </AuthGuard>
            } 
          />

          <Route 
            path="/organiser" 
            element={
              <AuthGuard requiredRoles={['staff', 'admin', 'event_organizer']}>
                <Organiser />
              </AuthGuard>
            } 
          />

          <Route 
            path="/support" 
            element={
              <AuthGuard requiredRoles={['support', 'admin']}>
                <SupportInterface />
              </AuthGuard>
            } 
          />
          
          {/* Unauthorized access page */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          
          {/* API test route */}
          <Route path="/api-test" element={<ApiTestComponent 
            apiStatus={apiStatus}
            onFallbackToggle={apiStatus.fallbackEnabled 
              ? () => OfflineDataHelper.disableFallbackMode()
              : () => OfflineDataHelper.enableFallbackMode()
            }
          />} />
          
          {/* Fallback - catch all unmatched routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AppProvider>
  );
}

// Simple API Test Component - kept for testing connectivity
const ApiTestComponent = ({ apiStatus, onFallbackToggle }) => {
  const [testResults, setTestResults] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [connectionStatus, setConnectionStatus] = React.useState(
    apiStatus?.isConnected ? 'connected' : apiStatus?.fallbackEnabled ? 'fallback' : 'unknown'
  );

  const testApiConnection = async () => {
    setIsLoading(true);
    setConnectionStatus('checking');
    
    try {
      const response = await fetch('/api/test');
      if (response.ok) {
        const data = await response.json();
        setTestResults(data);
        setConnectionStatus('connected');
      } else {
        setTestResults({ error: `Failed with status: ${response.status}` });
        setConnectionStatus('disconnected');
      }
    } catch (error) {
      setTestResults({ error: error.message });
      setConnectionStatus('disconnected');
      
      // Enable fallback mode on connection failure if not already enabled
      if (!OfflineDataHelper.isFallbackModeEnabled()) {
        const confirm = window.confirm(
          'Connection to the API server failed. Would you like to enable fallback mode?'
        );
        if (confirm) {
          OfflineDataHelper.enableFallbackMode();
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Test pending orders endpoint
  const testPendingOrders = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/orders/pending');
      if (response.ok) {
        const data = await response.json();
        setTestResults({ pendingOrders: data });
      } else {
        setTestResults({ error: `Failed with status: ${response.status}` });
      }
    } catch (error) {
      setTestResults({ error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">API Test Page</h1>
      
      <div className="bg-white rounded shadow-md p-4 mb-6">
        <h2 className="text-lg font-semibold mb-3">Connection Status</h2>
        <div className="flex items-center mb-4">
          <div 
            className={`w-3 h-3 rounded-full mr-2 ${
              connectionStatus === 'connected' ? 'bg-green-500' : 
              connectionStatus === 'disconnected' ? 'bg-red-500' : 
              'bg-gray-500'
            }`}
          ></div>
          <span>
            {connectionStatus === 'connected' ? 'Connected to API' : 
             connectionStatus === 'disconnected' ? 'Disconnected from API' : 
             'Status unknown'}
          </span>
        </div>
        
        <div className="flex space-x-3">
          <button 
            onClick={testApiConnection}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isLoading ? 'Testing...' : 'Test API Connection'}
          </button>
          
          <button 
            onClick={testPendingOrders}
            disabled={isLoading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Test Pending Orders
          </button>
          
          <button 
            onClick={onFallbackToggle}
            className={`px-4 py-2 ${apiStatus?.fallbackEnabled ? 'bg-green-600 hover:bg-green-700' : 'bg-amber-600 hover:bg-amber-700'} text-white rounded`}
          >
            {apiStatus?.fallbackEnabled ? 'Disable Fallback Mode' : 'Enable Fallback Mode'}
          </button>
        </div>
      </div>
      
      {testResults && (
        <div className="bg-white rounded shadow-md p-4">
          <h2 className="text-lg font-semibold mb-3">Test Results</h2>
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto">
            {JSON.stringify(testResults, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default App;