// services/ApiService.js
import serviceFactory from './ServiceFactory';
import MockDataService from './MockDataService';
import authService from './AuthService';
import webSocketService from './WebSocketService';
import { APP_MODES } from '../context/AppContext';

// Import anti-flicker protection utility
const antiFlickerProtection = {
  isActive: function() {
    // Check if anti-flicker protection is active
    return typeof window !== 'undefined' && window._originalFetch && window.fetch !== window._originalFetch;
  },
  isEndpointBlocked: function(endpoint) {
    // Check if this endpoint is currently being blocked due to JWT errors
    if (typeof window === 'undefined') return false;
    
    try {
      const blockedEndpoints = JSON.parse(localStorage.getItem('jwt_error_endpoints') || '{}');
      const now = Date.now();
      const lastErrorTime = blockedEndpoints[endpoint] || 0;
      const JWT_ERROR_DEBOUNCE_MS = 30000; // 30 seconds
      
      return (now - lastErrorTime) < JWT_ERROR_DEBOUNCE_MS;
    } catch (e) {
      console.error('Error checking blocked endpoints:', e);
      return false;
    }
  }
};

/**
 * Base API Service that handles switching between real API and mock data
 * based on the application mode.
 */
// Singleton instance storage
let webSocketInitialized = false;

class ApiService {
  constructor() {
    // Add debug logging to track instance creation
    console.trace('ApiService constructor called');
    
    // Check if we already have an instance stored on the constructor
    if (ApiService.instance) {
      console.log('ApiService: Returning existing singleton instance');
      console.log('ApiService instance count: REUSING EXISTING');
      return ApiService.instance;
    }
    
    console.log('ApiService: Creating new singleton instance');
    console.log('ApiService instance count: CREATING NEW');
    
    this.baseUrl = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5001/api';
    // Try to load token from localStorage on initialization
    this.token = localStorage.getItem('coffee_system_token') || localStorage.getItem('token') || null;
    this.debugMode = true;
    this.enableFallback = false; // Keep fallback disabled to enforce real API usage
    this.connectionTimeout = 10000; // 10 second timeout
    
    // Initialize connection status as online to prevent early false positives
    if (!localStorage.getItem('coffee_connection_status')) {
      localStorage.setItem('coffee_connection_status', 'online');
    }
    
    // Monitor for app mode changes
    serviceFactory.addModeChangeListener(this._handleModeChange.bind(this));
    
    // WebSocket DISABLED to prevent infinite connection loops
    console.log('ApiService: WebSocket disabled to prevent browser crashes');
    
    // Store this instance as the singleton
    ApiService.instance = this;
  }

  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
    if (this.debugMode) {
      console.log(token ? 'Token set successfully' : 'Token cleared');
    }
  }

  /**
   * Check if we're running in demo mode
   * @returns {boolean} - True if in demo mode
   */
  isDemoMode() {
    return serviceFactory.getMode() === APP_MODES.DEMO;
  }

  /**
   * Check if token is expiring soon
   * @returns {boolean} - True if token is expiring within 5 minutes
   */
  isTokenExpiringSoon() {
    if (!this.token) return false;
    
    try {
      // Get token payload
      const payload = JSON.parse(atob(this.token.split('.')[1]));
      
      // Check if token expires in less than 5 minutes
      const expirationTime = payload.exp * 1000; // Convert to milliseconds
      const fiveMinutesInMs = 5 * 60 * 1000;
      return (expirationTime - Date.now()) < fiveMinutesInMs;
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  }
  
  /**
   * Refresh token if needed before making a request
   * @returns {Promise<boolean>} - True if token is valid
   */
  async refreshTokenIfNeeded() {
    const tokenKey = 'coffee_system_token';
    const refreshKey = 'coffee_system_refresh_token';
    
    if (!this.token) {
      // Try to get token from localStorage
      const storedToken = localStorage.getItem(tokenKey);
      if (storedToken) {
        this.token = storedToken;
      } else {
        return false;
      }
    }
    
    // Check if token is expiring soon
    if (this.isTokenExpiringSoon()) {
      // Only log if we haven't recently attempted refresh
      if (!this.lastRefreshAttempt || Date.now() - this.lastRefreshAttempt > 60000) {
        console.log('Token is expiring soon, attempting to refresh');
        this.lastRefreshAttempt = Date.now();
      }
      
      try {
        const refreshToken = localStorage.getItem(refreshKey);
        if (!refreshToken) {
          // No refresh token, just continue with existing token
          return true;
        }
        
        // Use proper URL for refresh endpoint
        const refreshUrl = this.baseUrl ? `${this.baseUrl}/auth/refresh` : '/api/auth/refresh';
        
        // Call refresh token endpoint
        const response = await fetch(refreshUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          mode: 'cors'
        });
        
        if (!response.ok) {
          // Don't throw error, just continue
          return true;
        }
        
        const data = await response.json();
        
        if (data.token) {
          // Save new token
          this.token = data.token;
          localStorage.setItem(tokenKey, data.token);
          
          // Save token expiry time if provided
          if (data.expiresIn) {
            localStorage.setItem('tokenExpiry', Date.now() + (data.expiresIn * 1000));
          }
          
          console.log('Token refreshed successfully');
          return true;
        }
        
        return true; // Continue even without new token
      } catch (error) {
        // Don't log as error, just continue
        if (!this.lastRefreshError || Date.now() - this.lastRefreshError > 300000) {
          console.warn('Token refresh attempt failed, continuing:', error.message);
          this.lastRefreshError = Date.now();
        }
        return true; // Continue with existing token
      }
    }
    
    // Token is still valid
    return true;
  }
  
  /**
   * Make API request with appropriate service based on mode
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async request(endpoint, options = {}) {
    try {
      // Refresh token if needed before making request
      await this.refreshTokenIfNeeded();
      
      if (this.isDemoMode()) {
        // Use MockDataService in demo mode
        if (this.debugMode) {
          console.log(`[DEMO MODE] ${options.method || 'GET'} ${endpoint}`);
        }
        
        // Normalize method name to lowercase
        const method = (options.method || 'GET').toLowerCase();
        
        // Extract body if present
        const body = options.body ? JSON.parse(options.body) : undefined;
        
        // Mark as online in demo mode
        localStorage.setItem('coffee_connection_status', 'online');
        
        // Call appropriate method on MockDataService
        switch (method) {
          case 'get':
            return await MockDataService.get(endpoint);
          case 'post':
            return await MockDataService.post(endpoint, body);
          case 'put':
            return await MockDataService.put(endpoint, body);
          case 'patch':
            return await MockDataService.patch(endpoint, body);
          case 'delete':
            return await MockDataService.delete(endpoint);
          default:
            throw new Error(`Unsupported method: ${method}`);
        }
      } else {
        // Use real API in production mode
        return await this.fetchWithAuth(endpoint, options);
      }
    } catch (error) {
      if (this.enableFallback && !this.isDemoMode()) {
        console.warn(`API error, falling back to demo data: ${error.message}`);
        
        // Temporarily switch to demo mode for this request
        const tempMethod = (options.method || 'GET').toLowerCase();
        const tempBody = options.body ? JSON.parse(options.body) : undefined;
        
        switch (tempMethod) {
          case 'get':
            return await MockDataService.get(endpoint);
          case 'post':
            return await MockDataService.post(endpoint, tempBody);
          case 'put':
            return await MockDataService.put(endpoint, tempBody);
          case 'patch':
            return await MockDataService.patch(endpoint, tempBody);
          case 'delete':
            return await MockDataService.delete(endpoint);
          default:
            throw error; // Re-throw if method not supported
        }
      }
      
      throw error;
    }
  }

  /**
   * Make real API request with authentication
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   * @private
   */
  async fetchWithAuth(endpoint, options = {}) {
    try {
      // When using proxy in development, use relative URLs
      let url;
      
      // Normalize endpoint
      let normalizedEndpoint = endpoint;
      if (normalizedEndpoint.startsWith('/')) {
        normalizedEndpoint = normalizedEndpoint.substring(1);
      }
      
      // In development, use relative URLs so the proxy works
      // In production, use full URLs
      if (process.env.NODE_ENV === 'development') {
        // Clean up the endpoint for development proxy
        let cleanEndpoint = normalizedEndpoint;
        if (cleanEndpoint.startsWith('api/')) {
          cleanEndpoint = cleanEndpoint.substring(4);
        } else if (cleanEndpoint.includes('/api/')) {
          const apiIndex = cleanEndpoint.indexOf('/api/');
          cleanEndpoint = cleanEndpoint.substring(apiIndex + 5); // +5 to skip '/api/'
        }
        
        // Always construct as /api/endpoint for proxy
        url = `/api/${cleanEndpoint}`;
      } else {
        // In production, use full URL
        const baseUrlNoTrailingSlash = this.baseUrl.endsWith('/') 
          ? this.baseUrl.slice(0, -1) 
          : this.baseUrl;
        
        // Clean up the endpoint
        let cleanEndpoint = normalizedEndpoint;
        if (cleanEndpoint.startsWith('api/')) {
          cleanEndpoint = cleanEndpoint.substring(4);
        }
        
        url = `${baseUrlNoTrailingSlash}/${cleanEndpoint}`;
      }
      
      if (this.debugMode) {
        console.log(`Normalized URL: ${url} (from original: ${endpoint})`);
        console.log(`Environment: ${process.env.NODE_ENV}`);
      }
      
      const headers = {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers || {})
      };

      if (this.debugMode) {
        console.log(`Fetching from: ${url} with method: ${options.method || 'GET'}`);
      }

      // Add timeout control
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.connectionTimeout);

      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        // Explicitly add CORS mode but skip credentials to avoid CORS issues
        mode: 'cors'
        // Don't include credentials to avoid CORS issues with wildcard origin
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to get error details from response
        let errorDetails = {};
        try {
          errorDetails = await response.json();
        } catch (e) {
          try {
            errorDetails = { message: await response.text() };
          } catch (e2) {
            errorDetails = { message: `HTTP error: ${response.status} ${response.statusText}` };
          }
        }
        
        console.error(`API error: ${response.status}`, errorDetails);
        throw new Error(errorDetails.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      if (this.debugMode) {
        console.log(`Response from ${endpoint}:`, data);
      }
      
      // Mark connection as online
      localStorage.setItem('coffee_connection_status', 'online');
      
      return data;
    } catch (error) {
      // Handle abort errors silently - these are expected when components unmount
      if (error.name === 'AbortError') {
        if (this.debugMode) {
          console.log(`Request aborted for ${endpoint} (this is normal during component cleanup)`);
        }
        throw error; // Re-throw to maintain error handling flow
      }
      
      // Log other errors (but not too verbosely)
      if (this.debugMode) {
        console.error(`Error fetching from ${endpoint}:`, error);
      }
      
      // Only mark as offline for genuine network errors, not auth or server errors
      if (error.message.includes('Failed to fetch') || 
          error.message.includes('NetworkError') ||
          error.message.includes('ERR_NETWORK') ||
          error.message.includes('ERR_INTERNET_DISCONNECTED')) {
        
        // Don't set offline status immediately - wait a moment and retry
        this.checkConnectionWithRetry(endpoint);
      }
      
      throw error;
    }
  }

  /**
   * Check connection with retry logic to avoid false offline detection
   * @param {string} originalEndpoint - Original endpoint that failed
   * @private
   */
  async checkConnectionWithRetry(originalEndpoint) {
    // Prevent multiple concurrent checks
    if (this._connectionCheckInProgress) {
      return;
    }
    
    this._connectionCheckInProgress = true;
    
    try {
      // Wait a moment before retrying to avoid immediate false positives
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try a simple health check endpoint
      const response = await fetch('/api/health', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
        mode: 'cors'
      });
      
      if (response.ok) {
        // Connection is actually working
        localStorage.setItem('coffee_connection_status', 'online');
        console.log('Connection retry successful - API is reachable');
      } else {
        // Server error, but connection exists
        localStorage.setItem('coffee_connection_status', 'online');
        console.log('Server responding but with error status - keeping online status');
      }
    } catch (retryError) {
      // Only now mark as offline if retry also fails
      if (retryError.name !== 'AbortError') {
        console.log('Connection retry failed - marking as offline');
        localStorage.setItem('coffee_connection_status', 'offline');
        
        // Auto-recover: try again in 30 seconds
        setTimeout(() => {
          this.checkConnectionWithRetry(originalEndpoint);
        }, 30000);
      }
    } finally {
      this._connectionCheckInProgress = false;
    }
  }

  /**
   * Handle mode changes
   * @param {string} newMode - New app mode
   * @private
   */
  _handleModeChange(newMode) {
    if (this.debugMode) {
      console.log(`[ApiService] App mode changed to: ${newMode}`);
    }
  }

  // Helper methods for common HTTP methods

  /**
   * Make GET request
   * @param {string} endpoint - API endpoint
   * @param {object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'GET'
    });
  }

  /**
   * Make POST request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Data to send
   * @param {object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make PUT request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Data to send
   * @param {object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make PATCH request
   * @param {string} endpoint - API endpoint
   * @param {object} data - Data to send
   * @param {object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make DELETE request
   * @param {string} endpoint - API endpoint
   * @param {object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'DELETE'
    });
  }

  /**
   * Custom fetch with authentication using direct URL approach and improved token handling
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async directFetch(endpoint, options = {}) {
    try {
      // Extract the endpoint path regardless of format
      let apiPath;
      
      // Check if it's a complete URL
      if (endpoint.startsWith('http')) {
        // Extract path from URL
        const url = new URL(endpoint);
        apiPath = url.pathname;
        
        // Further extract after /api/ if present
        if (apiPath.includes('/api/')) {
          apiPath = apiPath.substring(apiPath.indexOf('/api/') + 4);
        }
      } else {
        // Handle relative paths
        if (endpoint.includes('/api/')) {
          // Extract everything after /api/
          apiPath = endpoint.substring(endpoint.indexOf('/api/') + 4);
        } else {
          // Remove leading slash if present
          apiPath = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        }
      }
      
      // Construct direct URL - this ensures we use the absolute backend URL
      const directUrl = `${this.baseUrl}/${apiPath}`;
      
      if (this.debugMode) {
        console.log(`Using direct URL strategy: ${directUrl}`);
      }
      
      // Set headers with auth from centralized auth service
      const headers = await authService.addAuthorizationHeader({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {})
      });
      
      if (this.debugMode) {
        const token = authService.getToken();
        console.log(`Authorization header ${token ? 'set' : 'NOT set'} for request to ${directUrl}`);
        if (token) {
          console.log(`Token length: ${token.length}, Token prefix: ${token.substring(0, 10)}...`);
        }
        
        console.log(`Fetching from: ${directUrl} with method: ${options.method || 'GET'}`);
        if (options.body) {
          console.log(`Request body: ${options.body}`);
        }
      }
      
      // Make the request - avoid CORS issues by not using credentials
      const response = await fetch(directUrl, {
        ...options,
        headers,
        mode: 'cors'
      });
      
      // Handle 401/403 errors with token refresh
      if (response.status === 401 || response.status === 403 || response.status === 422) {
        try {
          // Try to refresh the token
          const refreshed = await authService.refreshToken();
          
          if (refreshed) {
            // Retry the request with the new token
            const updatedHeaders = await authService.addAuthorizationHeader({
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              ...(options.headers || {})
            });
            
            const retryResponse = await fetch(directUrl, {
              ...options,
              headers: updatedHeaders,
              mode: 'cors'
            });
            
            if (!retryResponse.ok) {
              throw new Error(`API error after token refresh: ${retryResponse.status}`);
            }
            
            return await retryResponse.json();
          } else {
            throw new Error('Token refresh failed');
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          throw new Error(`Authentication error: ${response.status}`);
        }
      }
      
      if (!response.ok) {
        // Try to get error details from response
        let errorDetails = {};
        try {
          errorDetails = await response.json();
        } catch (e) {
          try {
            errorDetails = { message: await response.text() };
          } catch (e2) {
            errorDetails = { message: `HTTP error: ${response.status} ${response.statusText}` };
          }
        }
        
        console.error(`API error: ${response.status}`, errorDetails);
        throw new Error(errorDetails.message || `API error: ${response.status}`);
      }
      
      const data = await response.json();
      if (this.debugMode) {
        console.log(`Response from ${directUrl}:`, data);
      }
      return data;
    } catch (error) {
      console.error(`Error fetching from ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket connection
   */
  async initializeWebSocket() {
    try {
      console.log('ApiService: Starting WebSocket initialization...');
      
      // Initialize WebSocket through dedicated service
      const connected = await webSocketService.initialize();
      
      if (!connected) {
        console.log('ApiService: WebSocket connection failed, continuing without real-time updates');
        return;
      }
      
      // DON'T authenticate here - let the WebSocket handle its own auth
      // This prevents the authentication loop that was causing reconnections
      console.log('ApiService: WebSocket connected, skipping manual authentication to prevent loops');

      // Subscribe to connection events (only once)
      webSocketService.on('connected', () => {
        console.log('ApiService: WebSocket connected event received');
        // DON'T call authenticate here either - this was the source of the loop
      });

      webSocketService.on('authenticated', () => {
        console.log('ApiService: WebSocket authenticated');
        // Join relevant rooms
        this.joinStationRoom();
      });

      // Setup common event handlers
      this.setupCommonEventHandlers();
      
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      console.log('WebSocket support will be disabled');
    }
  }

  /**
   * Setup common WebSocket event handlers
   */
  setupCommonEventHandlers() {
    // Order events
    webSocketService.on('order_created', (data) => {
      window.dispatchEvent(new CustomEvent('order_created', { detail: data }));
    });

    webSocketService.on('order_updated', (data) => {
      window.dispatchEvent(new CustomEvent('order_updated', { detail: data }));
    });

    webSocketService.on('order_completed', (data) => {
      window.dispatchEvent(new CustomEvent('order_completed', { detail: data }));
    });

    // Station events
    webSocketService.on('station_updated', (data) => {
      window.dispatchEvent(new CustomEvent('station_updated', { detail: data }));
    });

    // Inventory events
    webSocketService.on('inventory_updated', (data) => {
      window.dispatchEvent(new CustomEvent('inventory_updated', { detail: data }));
    });

    // Message events
    webSocketService.on('new_message', (data) => {
      window.dispatchEvent(new CustomEvent('new_message', { detail: data }));
    });
  }

  /**
   * Join station-specific room
   * @param {number} stationId - Station ID to join
   */
  joinStationRoom(stationId) {
    // Leave previous station room if any
    const currentStation = localStorage.getItem('currentStationId');
    if (currentStation) {
      webSocketService.send('leave_station', { station_id: currentStation });
    }

    // Join new station room
    if (stationId) {
      webSocketService.send('join_station', { station_id: stationId });
      localStorage.setItem('currentStationId', stationId.toString());
    }
  }

  /**
   * Subscribe to WebSocket events
   * @param {string} event - Event name
   * @param {function} handler - Event handler
   */
  on(event, handler) {
    // Subscribe through WebSocketService
    webSocketService.on(event, handler);
  }

  /**
   * Unsubscribe from WebSocket events
   * @param {string} event - Event name
   * @param {function} handler - Event handler
   */
  off(event, handler) {
    // Unsubscribe through WebSocketService
    webSocketService.off(event, handler);
  }

  /**
   * Send WebSocket message
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  sendMessage(event, data) {
    try {
      return webSocketService.send(event, data);
    } catch (error) {
      console.log('WebSocket send failed (non-critical):', error);
      return false;
    }
  }

  /**
   * Update auth token for WebSocket
   * @param {string} token - New auth token
   */
  updateSocketAuth(token) {
    // Only update token if WebSocket is connected and not already authenticating
    if (webSocketService.connected) {
      console.log('ApiService: Updating WebSocket auth token (non-disruptive)');
      webSocketService.authenticate(token);
    } else {
      console.log('ApiService: WebSocket not connected, skipping auth update');
    }
  }

  /**
   * Disconnect WebSocket
   */
  disconnectSocket() {
    webSocketService.disconnect();
  }
}

export default ApiService;