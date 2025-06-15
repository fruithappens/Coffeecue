// src/config/apiConfig.js 

// Environment-based API configuration
const getApiBaseUrl = () => {
  // In production, use relative URLs (same domain)
  if (process.env.NODE_ENV === 'production') {
    return '/api';
  }
  
  // In development, use localhost
  return 'http://localhost:5001/api';
};

const BASE_URL = getApiBaseUrl();

// Configuration
const config = {
  // Set this to false to disable the fallback mechanism
  enableFallback: false, // Disable fallback to prioritize real API data
  // Set this to true for additional debug logging
  debugMode: true,
  // Connection timeout in milliseconds
  connectionTimeout: 10000,
  // Authentication related settings
  authTokenKey: 'coffee_auth_token',
  refreshTokenKey: 'coffee_refresh_token',
  tokenExpiryKey: 'coffee_token_expiry'
};

// API endpoints - ensure all have /api prefix
const endpoints = {
  test: '/api/test', // Test endpoint
  pendingOrders: '/api/orders/pending',
  inProgressOrders: '/api/orders/in-progress',
  completedOrders: '/api/orders/completed',
  stations: '/api/stations',
  inventory: '/api/inventory',
  chat: '/api/chat/messages',
  // Authentication endpoints
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  refreshToken: '/api/auth/refresh',
  register: '/api/auth/register'
};

// Sample data for offline mode or fallback
const sampleData = {
  pendingOrders: [
    { 
      id: '45284', 
      customerName: 'Emma Davis', 
      coffeeType: 'Large Latte', 
      milkType: 'Soy milk', 
      sugar: '1 sugar',
      priority: false,
      createdAt: new Date(Date.now() - 8 * 60000),
      waitTime: 8,
      promisedTime: 15,
      batchGroup: 'latte-soy'
    },
    { 
      id: '45285', 
      customerName: 'Thomas Brown', 
      coffeeType: 'Large Latte', 
      milkType: 'Soy milk', 
      sugar: '0 sugar',
      priority: false,
      createdAt: new Date(Date.now() - 9 * 60000),
      waitTime: 9,
      promisedTime: 15,
      batchGroup: 'latte-soy'
    }
  ],
  inProgressOrders: [
    { 
      id: '45281', 
      customerName: 'Michael Johnson', 
      phoneNumber: '+61 423 555 789',
      coffeeType: 'Large Cappuccino', 
      milkType: 'Oat milk', 
      sugar: '1 sugar',
      extraHot: true,
      priority: true,
      createdAt: new Date(Date.now() - 3 * 60000),
      startedAt: new Date(),
      waitTime: 3,
      promisedTime: 15
    }
  ],
  completedOrders: [
    { 
      id: '45266', 
      customerName: 'Emma Johnson', 
      phoneNumber: '+61 423 456 789',
      coffeeType: 'Large Flat White', 
      milkType: 'Almond milk', 
      completedAt: new Date(Date.now() - 10 * 60000)
    }
  ],
  chatMessages: [
    {
      id: 1,
      sender: 'System',
      message: 'Welcome to the station chat!',
      timestamp: new Date(Date.now() - 120 * 60000),
      read: true
    },
    {
      id: 2,
      sender: 'Manager',
      message: 'Please check stock levels for almond milk',
      timestamp: new Date(Date.now() - 30 * 60000),
      read: false
    }
  ]
};

/**
 * Check if token is expired
 * @returns {boolean} True if token is expired or not present
 */
const isTokenExpired = () => {
  const expiry = localStorage.getItem(config.tokenExpiryKey);
  if (!expiry) return true;
  
  return new Date().getTime() > parseInt(expiry, 10);
};

/**
 * Get the auth token from storage
 * @returns {string|null} The auth token or null if not found
 */
const getAuthToken = () => {
  return localStorage.getItem(config.authTokenKey);
};

/**
 * Get the refresh token from storage
 * @returns {string|null} The refresh token or null if not found
 */
const getRefreshToken = () => {
  return localStorage.getItem(config.refreshTokenKey);
};

/**
 * Store authentication tokens
 * @param {Object} tokens - The tokens object containing token, refreshToken and expiresIn
 */
const storeTokens = (tokens) => {
  if (tokens.token) {
    localStorage.setItem(config.authTokenKey, tokens.token);
  }
  
  if (tokens.refreshToken) {
    localStorage.setItem(config.refreshTokenKey, tokens.refreshToken);
  }
  
  if (tokens.expiresIn) {
    const expiryTime = new Date().getTime() + tokens.expiresIn * 1000;
    localStorage.setItem(config.tokenExpiryKey, expiryTime.toString());
  }
};

/**
 * Clear all authentication tokens
 */
const clearTokens = () => {
  localStorage.removeItem(config.authTokenKey);
  localStorage.removeItem(config.refreshTokenKey);
  localStorage.removeItem(config.tokenExpiryKey);
};

/**
 * Check API connectivity
 * @returns {Promise<boolean>} True if connection is successful
 */
const checkConnection = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.connectionTimeout);
    
    const response = await fetch(`${BASE_URL}/test`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (config.debugMode) {
        console.log('API connection test successful:', data);
      }
      return true;
    }
    
    if (config.debugMode) {
      console.warn('API connection test failed with status:', response.status);
    }
    return false;
  } catch (error) {
    if (config.debugMode) {
      console.error('API connection test error:', error.message);
    }
    return false;
  }
};

/**
 * Refresh the auth token
 * @returns {Promise<boolean>} True if token was refreshed successfully
 */
const refreshAuthToken = async () => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  
  try {
    console.log('Attempting to refresh token');
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken })
    });
    
    if (!response.ok) {
      console.error('Token refresh failed with status:', response.status);
      clearTokens();
      return false;
    }
    
    const tokens = await response.json();
    
    // Handle different API response formats
    storeTokens({
      token: tokens.token || tokens.access_token,
      refreshToken: tokens.refreshToken || tokens.refresh_token,
      expiresIn: tokens.expiresIn || tokens.expires_in || 3600
    });
    
    console.log('Token refresh successful');
    return true;
  } catch (error) {
    console.error('Failed to refresh token:', error);
    clearTokens();
    return false;
  }
};

/**
 * Make an authenticated API request
 * @param {string} endpoint - API endpoint to fetch from
 * @param {object} options - Fetch options (method, headers, etc)
 * @returns {Promise<object>} - API response
 */
const apiRequest = async (endpoint, options = {}) => {
  // Check if token is expired and try to refresh if needed
  if (isTokenExpired()) {
    console.log('Token is expired, attempting to refresh');
    const refreshed = await refreshAuthToken();
    if (!refreshed) {
      // Token refresh failed, redirect to login or throw error
      if (typeof window !== 'undefined') {
        // If in browser environment, can redirect
        window.location.href = '/login?session=expired';
      }
      throw new Error('Authentication expired');
    }
  }
  
  // Get the auth token
  const token = getAuthToken();
  
  // Add auth header if token exists
  const authOptions = { ...options };
  if (token) {
    authOptions.headers = {
      ...authOptions.headers,
      'Authorization': `Bearer ${token}`
    };
  }
  
  // Use the regular fetchApi but with auth headers
  return fetchApi(endpoint, authOptions);
};

/**
 * Fetch data from API with configurable fallback to sample data
 * @param {string} endpoint - API endpoint to fetch from
 * @param {object} options - Fetch options (method, headers, etc)
 * @returns {Promise<object>} - API response
 */
const fetchApi = async (endpoint, options = {}) => {
  try {
    // Construct full URL with BASE_URL
    let url;
    if (endpoint.startsWith('http')) {
      // Already a full URL
      url = endpoint;
    } else if (endpoint.startsWith('/api')) {
      // Has /api prefix, use BASE_URL
      url = `${BASE_URL}${endpoint.substring(4)}`; // Remove /api since BASE_URL already has it
    } else if (endpoint.startsWith('/')) {
      // Relative path without /api
      url = `${BASE_URL}${endpoint}`;
    } else {
      // No leading slash
      url = `${BASE_URL}/${endpoint}`;
    }
    
    if (config.debugMode) {
      console.log(`Fetching from: ${url}`);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.connectionTimeout);
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });
    
    clearTimeout(timeoutId);
    
    // For debugging
    if (config.debugMode) {
      console.log(`Response status: ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API error response: ${errorText}`);
        // Create a new response with the same status
        const errorResponse = new Response(errorText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }
    }
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API request failed:', error);
    
    // Only use fallback if enabled
    if (config.enableFallback) {
      console.log('Falling back to sample data');
      
      // Return appropriate sample data based on endpoint
      if (endpoint === endpoints.pendingOrders || endpoint === '/orders/pending') {
        return sampleData.pendingOrders;
      } else if (endpoint === endpoints.inProgressOrders || endpoint === '/orders/in-progress') {
        return sampleData.inProgressOrders;
      } else if (endpoint === endpoints.completedOrders || endpoint === '/orders/completed') {
        return sampleData.completedOrders;
      } else if (endpoint === endpoints.chat || endpoint === '/chat/messages') {
        return sampleData.chatMessages;
      }
      
      // Default fallback
      return [];
    } else {
      // If fallback is disabled, propagate the error
      throw error;
    }
  }
};

/**
 * Post data to API with configurable fallback for offline mode
 * @param {string} endpoint - API endpoint to post to
 * @param {object} data - Data to send
 * @param {object} options - Additional fetch options
 * @returns {Promise<object>} - API response
 */
const postApi = async (endpoint, data, options = {}) => {
  try {
    // Construct full URL with BASE_URL
    let url;
    if (endpoint.startsWith('http')) {
      // Already a full URL
      url = endpoint;
    } else if (endpoint.startsWith('/api')) {
      // Has /api prefix, use BASE_URL
      url = `${BASE_URL}${endpoint.substring(4)}`; // Remove /api since BASE_URL already has it
    } else if (endpoint.startsWith('/')) {
      // Relative path without /api
      url = `${BASE_URL}${endpoint}`;
    } else {
      // No leading slash
      url = `${BASE_URL}/${endpoint}`;
    }
    
    if (config.debugMode) {
      console.log(`Posting to: ${url}`, data);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.connectionTimeout);
    
    const response = await fetch(url, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(data),
      ...options
    });
    
    clearTimeout(timeoutId);
    
    // For debugging
    if (config.debugMode) {
      console.log(`Response status: ${response.status}`);
      if (!response.ok) {
        try {
          const errorData = await response.json();
          console.error('API post error data:', errorData);
        } catch (e) {
          const errorText = await response.text();
          console.error('API post error text:', errorText);
        }
      }
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API post failed:', error);
    
    // Only use fallback if enabled
    if (config.enableFallback) {
      console.log('Simulating successful operation in offline mode');
      
      // Return a simulated successful response for offline mode
      return { 
        success: true, 
        message: 'Offline mode: Action simulated', 
        timestamp: new Date().toISOString()
      };
    } else {
      // If fallback is disabled, propagate the error
      throw error;
    }
  }
};

/**
 * Toggle the fallback mechanism on/off
 * @param {boolean} enabled - Whether to enable fallback
 */
const setFallbackEnabled = (enabled) => {
  config.enableFallback = enabled;
  console.log(`Fallback mechanism ${enabled ? 'enabled' : 'disabled'}`);
};

/**
 * Set debug mode on/off
 * @param {boolean} enabled - Whether to enable debug mode
 */
const setDebugMode = (enabled) => {
  config.debugMode = enabled;
  console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
};

/**
 * Check if user is authenticated
 * @returns {boolean} True if user is authenticated
 */
const isAuthenticated = () => {
  const token = getAuthToken();
  return !!token && !isTokenExpired();
};

// AuthClient module for authentication-related functionality
const AuthClient = {
  /**
   * Login user
   * @param {string} username - Username or email
   * @param {string} password - Password
   * @returns {Promise<Object>} User data
   */
  login: async (username, password) => {
    try {
      console.log('AuthClient: Attempting login for', username);
      
      const response = await postApi(endpoints.login, { username, password });
      console.log('AuthClient: Login response', response);
      
      // Handle different API response formats
      if (response.token || response.access_token) {
        storeTokens({
          token: response.token || response.access_token,
          refreshToken: response.refreshToken || response.refresh_token,
          expiresIn: response.expiresIn || response.expires_in || 3600
        });
        return response.user || { username };
      }
      
      throw new Error('Login failed: Invalid response');
    } catch (error) {
      console.error('AuthClient: Login error', error);
      clearTokens();
      throw error;
    }
  },
  
  /**
   * Register new user
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} User data
   */
  register: async (userData) => {
    const response = await postApi(endpoints.register, userData);
    
    if (response.token) {
      storeTokens(response);
      return response.user;
    }
    
    return response;
  },
  
  /**
   * Logout user
   * @returns {Promise<boolean>} True if logout was successful
   */
  logout: async () => {
    try {
      // Get the refresh token for server-side invalidation
      const refreshToken = getRefreshToken();
      
      if (refreshToken) {
        await postApi(endpoints.logout, { refreshToken });
      }
      
      return true;
    } catch (error) {
      console.error('Logout error:', error);
      return false;
    } finally {
      // Always clear tokens locally regardless of server response
      clearTokens();
    }
  },
  
  /**
   * Check if user is authenticated
   * @returns {boolean} True if user is authenticated
   */
  isAuthenticated,
  
  /**
   * Make an authenticated API request
   * Wrapper around apiRequest that handles auth
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   */
  apiRequest
};

// Export as a unified object
export const apiConfig = {
  baseUrl: BASE_URL,
  endpoints,
  fetchApi,
  postApi,
  checkConnection,
  setFallbackEnabled,
  setDebugMode,
  getConfig: () => ({ ...config }), // Return a copy of the current config
  sampleData,
  // Export auth functionality
  AuthClient,
  isAuthenticated
};