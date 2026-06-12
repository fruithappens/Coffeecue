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
import DeploymentService from './services/DeploymentService';
import SoundNotificationService from './services/SoundNotificationService';
import { AppProvider } from './context/AppContext';
import AuthGuard from './components/auth/AuthGuard';
import UnauthorizedPage from './components/auth/UnauthorizedPage';
import OfflineDataHelper from './utils/offlineDataHelper';
import ApiNotificationBanner from './components/ApiNotificationBanner';
import ErrorBoundary from './components/ErrorBoundary';
import BasicBaristaInterface from './components/fallbacks/BasicBaristaInterface';

// Simple API Test Component
const ApiTestComponent = ({ apiStatus, onFallbackToggle }) => {
  const [testResults, setTestResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(
    apiStatus?.isConnected ? 'connected' : apiStatus?.fallbackEnabled ? 'fallback' : 'unknown'
  );

  // Test API connection
  const testApiConnection = async () => {
    setIsLoading(true);
    setConnectionStatus('checking');
    
    try {
      const response = await fetch('/api/test');
      if (response.ok) {
        const data = await response.json();
        setTestResults(data);
        setConnectionStatus('connected');
      } else if (response.status === 422) {
        // Likely a JWT signature verification failure
        setTestResults({ 
          error: `Failed with status: ${response.status}`,
          details: 'Token signature verification failed',
          suggestion: 'Try enabling fallback mode or clearing your authentication token'
        });
        setConnectionStatus('auth_error');
      } else {
        setTestResults({ error: `Failed with status: ${response.status}` });
        setConnectionStatus('disconnected');
      }
    } catch (error) {
      setTestResults({ error: error.message });
      setConnectionStatus('disconnected');
      
      // Connection failed — do NOT auto-prompt to enable sample-data
      // mode (see note on the auth-init path). Just record the status.
      console.warn('API connection test failed; not auto-enabling fallback.');
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
      } else if (response.status === 422) {
        // Likely a JWT signature verification failure
        setTestResults({ 
          error: `Failed with status: ${response.status}`,
          details: 'Token signature verification failed',
          suggestion: 'Try enabling fallback mode or clearing your authentication token'
        });
      } else {
        setTestResults({ error: `Failed with status: ${response.status}` });
      }
    } catch (error) {
      setTestResults({ 
        error: error.message,
        suggestion: 'Try enabling fallback mode to use sample data'
      });
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
              connectionStatus === 'fallback' ? 'bg-amber-500' :
              connectionStatus === 'auth_error' ? 'bg-yellow-500' :
              connectionStatus === 'disconnected' ? 'bg-red-500' : 
              'bg-gray-500'
            }`}
          ></div>
          <span>
            {connectionStatus === 'connected' ? 'Connected to API' : 
             connectionStatus === 'fallback' ? 'Using fallback data' :
             connectionStatus === 'auth_error' ? 'Authentication error' :
             connectionStatus === 'disconnected' ? 'Disconnected from API' : 
             'Status unknown'}
          </span>
          
          {apiStatus && (
            <span className="ml-3 text-sm text-gray-600">
              {apiStatus.fallbackEnabled ? '(Fallback mode active)' : ''}
            </span>
          )}
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
          {testResults.suggestion && (
            <div className="bg-amber-100 text-amber-800 p-3 rounded mb-3">
              <p className="font-bold">Suggestion:</p>
              <p>{testResults.suggestion}</p>
            </div>
          )}
          <pre className="bg-gray-100 p-4 rounded overflow-x-auto">
            {JSON.stringify(testResults, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

// One-time sound system bootstrap. Installs window.coffeeSounds and
// hooks the app:newOrder / order_updated events. Runs once at module
// load (the service has its own idempotency guard).
SoundNotificationService.init();

function App() {
  const [initialized, setInitialized] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [apiStatus, setApiStatus] = useState({
    isConnected: true,
    message: null,
    fallbackEnabled: false
  });

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
  const handleOffline = useCallback(() => {
    console.log('Browser reports offline status');
    setApiStatus(prev => ({
      ...prev,
      isConnected: false,
      message: 'Network connection lost'
    }));
    
    // Network lost — the reconnect banner handles retry. We don't pop a
    // confirm to switch to sample data (would show fake orders as real).
    console.warn('Network connection lost; showing reconnect status, not enabling sample data.');
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
  
  // Initialize app with fallback data if needed
  useEffect(() => {
    // Initialize deployment service for automatic update detection
    console.log('Initializing deployment service for version:', DeploymentService.getCurrentVersion());
    
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
    
    // Check for JWT token signature issues in localStorage
    try {
      const token = localStorage.getItem('coffee_system_token');
      if (token) {
        // Simple validation of token format
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
          console.warn('Invalid token format detected during initialization — '
            + 'clearing it so the user re-logs in (not switching to sample data).');
          // A malformed token means "log in again", not "show fake data".
          // Clearing it routes the user to the login screen via AuthGuard.
          try { AuthService.logout && AuthService.logout(); } catch (_) { /* logout best-effort */ }
        }
      }
    } catch (e) {
      console.error('Error checking token during initialization:', e);
    }
    
    // Set initialized flag
    setInitialized(true);
    
    // Listen for fallback mode toggle
    window.addEventListener('fallback_mode_enabled', handleFallbackEnabled);
    window.addEventListener('fallback_mode_disabled', handleFallbackDisabled);
    
    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // FORCE PURGE HARDCODED SCHEDULE DATA ON APP START
    // Function to purge any hardcoded schedule data
    const purgeHardcodedData = () => {
      console.log('Purging hardcoded schedule data on app start');
      
      // Clear any schedule-related data in localStorage
      localStorage.removeItem('coffee_cue_schedule');
      
      // Remove any demo data that might contain hardcoded names
      Object.keys(localStorage).forEach(key => {
        if (key.includes('schedule') || key.includes('demo_')) {
          localStorage.removeItem(key);
        }
      });
      
      // Set empty schedule data
      const emptySchedule = {
        shifts: [],
        breaks: [],
        rushPeriods: []
      };
      
      localStorage.setItem('coffee_cue_schedule', JSON.stringify(emptySchedule));
      
      console.log('All schedule data reset to empty state');
    };
    
    // Execute immediately
    purgeHardcodedData();
    
    return () => {
      window.removeEventListener('fallback_mode_enabled', handleFallbackEnabled);
      window.removeEventListener('fallback_mode_disabled', handleFallbackDisabled);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleFallbackEnabled, handleFallbackDisabled, handleOnline, handleOffline]);

  // Page title sync. Operators commonly run 2-3 events in parallel
  // browser windows; the default "React App" / static "Coffee Cue"
  // title made it impossible to tell which window is which. Fetch
  // the live event_name from the public /display/config endpoint
  // (no auth required) and set the tab title accordingly. Re-fetched
  // when branding changes via the existing branding_updated event.
  useEffect(() => {
    let cancelled = false;
    const refreshTitle = async () => {
      try {
        const resp = await fetch('/api/display/config', {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        const evt = (data?.config?.event_name || '').trim();
        const sys = (data?.config?.system_name || 'Coffee Cue').trim();
        document.title = evt && evt !== sys ? `${evt} — ${sys}` : sys;
      } catch (_) {
        // Endpoint unreachable / aborted — leave the title as-is.
      }
    };
    refreshTitle();
    const onBrandingUpdated = () => refreshTitle();
    window.addEventListener('branding_updated', onBrandingUpdated);
    // Poll periodically. Cheap; covers the case where a different
    // tab edits branding and our window doesn't get the event.
    const id = setInterval(refreshTitle, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener('branding_updated', onBrandingUpdated);
      clearInterval(id);
    };
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
      
      // Check if we got a response to parse
      let responseData = null;
      try {
        responseData = await response.json();
      } catch (e) {
        // Unable to parse JSON, continue with normal flow
      }
      
      if (response.ok) {
        setApiStatus(prev => ({
          ...prev,
          isConnected: true,
          message: null // Clear any error messages
        }));
        return true;
      } else if (response.status === 422) {
        // Signature verification failed - token is invalid
        console.warn('Token signature verification failed');
        
        // Check message from response if available
        const errorMsg = responseData?.message || 'Invalid token signature';
        const containsSignatureError = errorMsg.toLowerCase().includes('signature') || 
                                      errorMsg.toLowerCase().includes('invalid token');
        
        // If this is definitely a signature error, offer to switch to fallback mode
        if (containsSignatureError) {
          setApiStatus(prev => ({
            ...prev,
            isConnected: false,
            message: `Authentication error: ${errorMsg}`
          }));
          
          // A signature/auth error means re-authenticate, NOT switch to
          // sample data. Surface the status; AuthGuard handles re-login.
          console.warn('Auth signature error — prompting re-login via status, not sample data.');
        } else {
          setApiStatus(prev => ({
            ...prev,
            isConnected: false,
            message: `Authentication error: ${errorMsg}`
          }));
        }
        return false;
      } else {
        // API is reachable but returned an error
        console.warn('API auth check failed with status:', response.status);
        const errorMsg = responseData?.message || 
                        (response.status === 401 ? 'Authentication required' : 'API error');
        
        setApiStatus(prev => ({
          ...prev,
          isConnected: true, // We can connect, but there may be auth issues
          message: errorMsg
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

  useEffect(() => {
    // Check authentication status on app load
    const checkAuth = async () => {
      try {
        // If we already have a token, check if it's still valid by testing the API
        if (AuthService.getToken()) {
          try {
            // Try to validate the token format before even checking with API
            const token = AuthService.getToken();
            const tokenParts = token.split('.');
            
            // JWT tokens should have 3 parts: header, payload, signature
            if (tokenParts.length !== 3) {
              throw new Error('Invalid token format');
            }
            
            // Verify the token payload can be decoded
            try {
              const payload = JSON.parse(atob(tokenParts[1]));
              // Check for token expiration
              if (payload.exp && payload.exp * 1000 < Date.now()) {
                console.warn('Token is expired');
              }
            } catch (e) {
              console.error('Invalid token payload', e);
              throw new Error('Invalid token payload');
            }
            
            // Token format looks good, now test API connection
            const apiReachable = await testApiForAuth();
            
            // API unreachable: surface a non-blocking status and let the
            // reconnect banner retry. We deliberately do NOT pop a
            // window.confirm offering "fallback mode" — saying yes there
            // switches the whole app to SAMPLE data (fake orders shown as
            // real), which is the root of the demo-breaking sample-data
            // problem. Sample/fallback mode stays available as an explicit
            // opt-in, never an auto-prompt on a transient blip.
            if (!apiReachable && !OfflineDataHelper.isFallbackModeEnabled()) {
              setApiStatus(prev => ({
                ...prev,
                isConnected: false,
                message: 'Reconnecting to the server…',
              }));
            }
          } catch (tokenError) {
            // Token format is invalid, offer fallback immediately
            console.error('Token validation error:', tokenError);
            
            // Update API status to show token error
            setApiStatus(prev => ({
              ...prev,
              isConnected: false,
              message: `Authentication error: ${tokenError.message}`
            }));
            
            // Don't auto-prompt to enable sample-data mode on a token
            // problem — surface the status; the user can re-login.
            console.warn('Auth token problem:', tokenError.message);
          }
        }
        
        // Continue with auth check regardless of API status
        const authenticated = await AuthService.handleAuthentication();
        setIsAuthenticated(authenticated);
      } catch (error) {
        console.error('Auth check failed:', error);
        setIsAuthenticated(false);
        
        // Auth check failed — surface it; AuthGuard routes to login.
        // No auto-prompt to switch to sample data.
        console.warn('Auth check failed; routing to login rather than sample data.');
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

  // Check if the current path needs redirection to login
  useEffect(() => {
    if (initialized && !isCheckingAuth) {
      const currentPath = window.location.pathname;
      // List of paths that require authentication
      const protectedPaths = [
        '/barista',
        '/organiser',
        '/admin',
        '/support'
      ];
      
      // If on a protected path and not authenticated, redirect to login
      if (protectedPaths.includes(currentPath) && !isAuthenticated) {
        console.log('Not authenticated, redirecting to login page');
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      }
    }
  }, [initialized, isCheckingAuth, isAuthenticated]);
  
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
    // Top-level Error Boundary — last line of defence. The Barista,
    // Organiser, and Support routes already have their own per-route
    // ErrorBoundary so a crash in one role's UI doesn't kill the
    // others. But Landing / Login / Display / unmatched routes
    // weren't wrapped, so a render crash there would blank the
    // entire page with no recovery. This outer boundary catches
    // anything the inner ones miss (incl. AppProvider /
    // ApiNotificationBanner / Router init failures) and shows a
    // reload-to-recover screen instead of a white page of death.
    <ErrorBoundary
      componentName="App"
      showErrorDetails={process.env.NODE_ENV !== 'production'}
    >
      <AppProvider>
        <Router>
          {/* API Status Notification Banner - Now self-detecting authentication and connection issues */}
          <ApiNotificationBanner />

          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
          
          {/* Direct login route for clear access */}
          <Route path="/direct-login" element={<Navigate to="/login" replace />} />
          
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
                <ErrorBoundary 
                  componentName="Barista Interface"
                  fallbackComponent={BasicBaristaInterface}
                  showErrorDetails={true}
                >
                  <BaristaInterface />
                </ErrorBoundary>
              </AuthGuard>
            } 
          />

          <Route 
            path="/organiser" 
            element={
              <AuthGuard requiredRoles={['staff', 'admin', 'event_organizer']}>
                <ErrorBoundary 
                  componentName="Organiser Interface"
                  showErrorDetails={true}
                >
                  <Organiser />
                </ErrorBoundary>
              </AuthGuard>
            } 
          />

          <Route 
            path="/support" 
            element={
              <AuthGuard requiredRoles={['support', 'admin']}>
                <ErrorBoundary 
                  componentName="Support Interface"
                  showErrorDetails={true}
                >
                  <SupportInterface />
                </ErrorBoundary>
              </AuthGuard>
            } 
          />
          
          {/* Unauthorized access page */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          
          {/* API test route */}
          <Route path="/api-test" element={
            <ApiTestComponent 
              apiStatus={apiStatus}
              onFallbackToggle={apiStatus.fallbackEnabled 
                ? () => OfflineDataHelper.disableFallbackMode()
                : () => OfflineDataHelper.enableFallbackMode()
              }
            />} 
          />
          
          {/* Fallback - catch all unmatched routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AppProvider>
    </ErrorBoundary>
  );
}

export default App;