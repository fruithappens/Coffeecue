// services/ApiService.improved.js
import authService from './AuthService.improved';
import errorHandler, { ERROR_TYPES } from '../utils/errorHandler';
import ConfigService from './ConfigService';

/**
 * Improved API Service for handling API requests with better error handling
 * and authentication integration.
 */
class ApiService {
  constructor() {
    this.debug = process.env.NODE_ENV === 'development';
    this.baseUrl = ConfigService.getApiUrl();
    this.token = null;
    this.connectionTimeout = 15000; // 15 second timeout
    
    // Flag to track if fallback mode is active
    this.fallbackModeActive = localStorage.getItem('use_fallback_data') === 'true';
    
    this.log('ApiService initialized');
    
    // Listen for fallback mode changes
    window.addEventListener('fallback-mode-enabled', this._handleFallbackModeEnabled.bind(this));
    window.addEventListener('fallback-mode-disabled', this._handleFallbackModeDisabled.bind(this));
  }
  
  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
    this.log(token ? 'Token set successfully' : 'Token cleared');
  }
  
  /**
   * Make API request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async request(endpoint, options = {}) {
    try {
      // If fallback mode is active, delegate to fallback handler
      if (this.fallbackModeActive) {
        return this._getFallbackResponse(endpoint, options);
      }
      
      // Build URL from endpoint
      const url = this._buildUrl(endpoint);
      
      // Set up authorization headers with token refresh if needed
      const headers = await authService.addAuthorizationHeader({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {})
      });
      
      // Add timeout control
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.connectionTimeout);
      
      this.log(`Fetching from: ${url} with method: ${options.method || 'GET'}`);
      
      // Make the request
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      // Handle response
      return await this._handleResponse(response, endpoint, options);
    } catch (error) {
      return this._handleRequestError(error, endpoint, options);
    }
  }
  
  /**
   * Build a proper URL from an endpoint
   * @param {string} endpoint - API endpoint
   * @returns {string} - Full API URL
   * @private
   */
  _buildUrl(endpoint) {
    // Remove leading slash if present
    let normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    
    // Handle API prefix properly to avoid double slashes
    if (normalizedEndpoint.startsWith('api/')) {
      // If endpoint already has api/ at the start, use it directly
      return `/${normalizedEndpoint}`;
    } else {
      // Otherwise, construct with baseUrl ensuring no double slashes
      const baseUrlNoTrailingSlash = this.baseUrl.endsWith('/') 
        ? this.baseUrl.slice(0, -1) 
        : this.baseUrl;
      return `${baseUrlNoTrailingSlash}/${normalizedEndpoint}`;
    }
  }
  
  /**
   * Handle API response
   * @param {Response} response - Fetch response object
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Processed API response
   * @private
   */
  async _handleResponse(response, endpoint, options) {
    try {
      if (response.ok) {
        const data = await response.json();
        this.log(`Success response from ${endpoint}:`, data);
        return data;
      }
      
      // Handle error response
      const statusCode = response.status;
      
      // Special handling for authentication errors (401)
      if (statusCode === 401) {
        return this._handleAuthError(response, endpoint, options);
      }
      
      // Special handling for authorization errors (403)
      if (statusCode === 403) {
        return this._handleForbiddenError(response, endpoint, options);
      }
      
      // Handle validation errors (400, 422)
      if (statusCode === 400 || statusCode === 422) {
        return this._handleValidationError(response, endpoint, options);
      }
      
      // Get error details from response
      let errorDetails = {};
      try {
        errorDetails = await response.json();
      } catch (e) {
        try {
          errorDetails = { message: await response.text() };
        } catch (e2) {
          errorDetails = { message: `HTTP error: ${statusCode} ${response.statusText}` };
        }
      }
      
      // Create an error with proper details
      const error = new Error(errorDetails.message || `API error: ${statusCode}`);
      error.status = statusCode;
      error.endpoint = endpoint;
      error.details = errorDetails;
      
      // Log error details
      this.log(`Error response from ${endpoint}:`, error);
      
      // Handle with error handler
      errorHandler.handleError(error, `ApiService.request(${endpoint})`, {
        notifyUser: true,
        rethrow: true
      });
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * Handle request error
   * @param {Error} error - Original error
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Fallback response or throws error
   * @private
   */
  async _handleRequestError(error, endpoint, options) {
    // Check if it's an abort error (timeout)
    if (error.name === 'AbortError') {
      error.message = `Request to ${endpoint} timed out after ${this.connectionTimeout}ms`;
      error.code = 'TIMEOUT';
      
      // Log timeout error
      this.log(`Timeout error for ${endpoint}:`, error);
      
      // Return fallback response for timeouts
      if (!this.fallbackModeActive) {
        this.log(`Switching to fallback response for ${endpoint} due to timeout`);
        return this._getFallbackResponse(endpoint, options);
      }
    }
    
    // Handle with error handler
    const processedError = errorHandler.handleError(error, `ApiService.request(${endpoint})`, {
      notifyUser: true
    });
    
    // Check if it's a network error and fallback if appropriate
    if (processedError.type === ERROR_TYPES.NETWORK && !this.fallbackModeActive) {
      this.log(`Network error for ${endpoint}, using fallback response`);
      return this._getFallbackResponse(endpoint, options);
    }
    
    // Otherwise rethrow the error
    throw error;
  }
  
  /**
   * Handle authentication error (401)
   * @param {Response} response - Original response
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Result of retry or fallback response
   * @private
   */
  async _handleAuthError(response, endpoint, options) {
    this.log(`Auth error (401) for ${endpoint}, attempting token refresh`);
    
    // Try to refresh token
    const refreshed = await authService.refreshToken();
    
    if (refreshed) {
      this.log('Token refreshed successfully, retrying request');
      
      // Retry the request with updated auth headers
      const updatedHeaders = await authService.addAuthorizationHeader({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {})
      });
      
      // Retry the request
      try {
        const retryResponse = await fetch(this._buildUrl(endpoint), {
          ...options,
          headers: updatedHeaders,
          mode: 'cors'
        });
        
        if (retryResponse.ok) {
          return await retryResponse.json();
        }
        
        // If retry also fails, handle normally
        return this._handleResponse(retryResponse, endpoint, options);
      } catch (retryError) {
        return this._handleRequestError(retryError, endpoint, options);
      }
    }
    
    // If token refresh failed, return fallback response
    this.log('Token refresh failed, using fallback response');
    return this._getFallbackResponse(endpoint, options);
  }
  
  /**
   * Handle forbidden error (403)
   * @param {Response} response - Original response
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Error or fallback
   * @private
   */
  async _handleForbiddenError(response, endpoint, options) {
    // Get error details from response
    let errorDetails = {};
    try {
      errorDetails = await response.json();
    } catch (e) {
      errorDetails = { message: 'Forbidden: You don\'t have permission to access this resource' };
    }
    
    // Create error with details
    const error = new Error(errorDetails.message || 'Forbidden');
    error.status = 403;
    error.endpoint = endpoint;
    error.details = errorDetails;
    
    // Log error
    this.log(`Forbidden error (403) for ${endpoint}:`, error);
    
    // Handle with error handler
    errorHandler.handleError(error, `ApiService.request(${endpoint})`, {
      notifyUser: true,
      rethrow: true
    });
  }
  
  /**
   * Handle validation error (400, 422)
   * @param {Response} response - Original response
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Error details
   * @private
   */
  async _handleValidationError(response, endpoint, options) {
    // Get validation error details
    let errorDetails = {};
    try {
      errorDetails = await response.json();
    } catch (e) {
      errorDetails = { message: 'Invalid request data' };
    }
    
    // Create error with validation details
    const error = new Error(errorDetails.message || 'Validation error');
    error.status = response.status;
    error.endpoint = endpoint;
    error.details = errorDetails;
    error.validationErrors = errorDetails.errors || [];
    
    // Log validation error
    this.log(`Validation error (${response.status}) for ${endpoint}:`, error);
    
    // Handle with error handler
    errorHandler.handleError(error, `ApiService.request(${endpoint})`, {
      notifyUser: true,
      rethrow: true
    });
  }
  
  /**
   * Get fallback response for an endpoint
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - Fallback response
   * @private
   */
  _getFallbackResponse(endpoint, options = {}) {
    this.log(`Generating fallback response for ${endpoint}`);
    
    // Basic fallback response
    const response = {
      success: true,
      message: 'Fallback data provided while offline',
      timestamp: new Date().toISOString(),
      fallback: true
    };
    
    // Add data based on endpoint type
    if (endpoint.includes('orders')) {
      response.data = this._getFallbackOrders(endpoint, options);
    } else if (endpoint.includes('stations')) {
      response.data = this._getFallbackStations(endpoint, options);
    } else if (endpoint.includes('inventory')) {
      response.data = this._getFallbackInventory(endpoint, options);
    } else if (endpoint.includes('settings')) {
      response.data = this._getFallbackSettings(endpoint, options);
    } else if (endpoint.includes('users') || endpoint.includes('auth')) {
      response.data = this._getFallbackUserData(endpoint, options);
    } else {
      response.data = {};
    }
    
    return Promise.resolve(response);
  }
  
  /**
   * Get fallback orders data
   * @param {string} endpoint - Orders endpoint
   * @param {Object} options - Request options
   * @returns {Array|Object} - Fallback orders data
   * @private
   */
  _getFallbackOrders(endpoint, options) {
    // Default empty array
    const defaultOrders = [];
    
    // Check if we're requesting a specific order
    const orderIdMatch = endpoint.match(/orders\/(\d+)/);
    if (orderIdMatch) {
      const orderId = orderIdMatch[1];
      return {
        id: parseInt(orderId),
        status: 'pending',
        customerName: 'Demo Customer',
        items: [
          { id: 1, name: 'Cappuccino', size: 'Medium', milk: 'Oat' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    
    // Generate a few sample orders for list endpoints
    return [
      {
        id: 1,
        status: 'pending',
        customerName: 'Demo Customer 1',
        items: [
          { id: 1, name: 'Cappuccino', size: 'Medium', milk: 'Oat' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 2,
        status: 'in_progress',
        customerName: 'Demo Customer 2',
        items: [
          { id: 2, name: 'Latte', size: 'Large', milk: 'Almond' }
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 3,
        status: 'completed',
        customerName: 'Demo Customer 3',
        items: [
          { id: 3, name: 'Espresso', size: 'Small', milk: 'None' }
        ],
        createdAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
        updatedAt: new Date(Date.now() - 1800000).toISOString()  // 30 minutes ago
      }
    ];
  }
  
  /**
   * Get fallback stations data
   * @param {string} endpoint - Stations endpoint
   * @param {Object} options - Request options
   * @returns {Array|Object} - Fallback stations data
   * @private
   */
  _getFallbackStations(endpoint, options) {
    // Check if we're requesting a specific station
    const stationIdMatch = endpoint.match(/stations\/(\d+)/);
    if (stationIdMatch) {
      const stationId = stationIdMatch[1];
      return {
        id: parseInt(stationId),
        name: `Station ${stationId}`,
        status: 'active',
        assignedBarista: 'Demo Barista',
        currentLoad: 2
      };
    }
    
    // Generate sample stations list
    return [
      { id: 1, name: 'Station 1', status: 'active', assignedBarista: 'Demo Barista 1', currentLoad: 2 },
      { id: 2, name: 'Station 2', status: 'active', assignedBarista: 'Demo Barista 2', currentLoad: 1 },
      { id: 3, name: 'Station 3', status: 'inactive', assignedBarista: null, currentLoad: 0 }
    ];
  }
  
  /**
   * Get fallback inventory data
   * @param {string} endpoint - Inventory endpoint
   * @param {Object} options - Request options
   * @returns {Array|Object} - Fallback inventory data
   * @private
   */
  _getFallbackInventory(endpoint, options) {
    // Return sample inventory list
    return {
      coffee: [
        { id: 1, name: 'House Blend', stock: 75, unit: 'kg' },
        { id: 2, name: 'Dark Roast', stock: 50, unit: 'kg' },
        { id: 3, name: 'Decaf', stock: 30, unit: 'kg' }
      ],
      milk: [
        { id: 1, name: 'Whole Milk', stock: 85, unit: 'liters' },
        { id: 2, name: 'Oat Milk', stock: 65, unit: 'liters' },
        { id: 3, name: 'Almond Milk', stock: 55, unit: 'liters' },
        { id: 4, name: 'Soy Milk', stock: 40, unit: 'liters' }
      ],
      supplies: [
        { id: 1, name: 'Cups (Small)', stock: 200, unit: 'units' },
        { id: 2, name: 'Cups (Medium)', stock: 150, unit: 'units' },
        { id: 3, name: 'Cups (Large)', stock: 100, unit: 'units' },
        { id: 4, name: 'Lids', stock: 400, unit: 'units' }
      ]
    };
  }
  
  /**
   * Get fallback settings data
   * @param {string} endpoint - Settings endpoint
   * @param {Object} options - Request options
   * @returns {Object} - Fallback settings data
   * @private
   */
  _getFallbackSettings(endpoint, options) {
    return {
      system: {
        defaultWaitTime: 10,
        notificationsEnabled: true,
        smsNotificationsEnabled: true,
        qrCodeEnabled: true,
        maxOrdersPerStation: 5
      },
      ui: {
        theme: 'light',
        autoDarkMode: true,
        refreshInterval: 30,
        soundEffects: true,
        animations: true
      }
    };
  }
  
  /**
   * Get fallback user data
   * @param {string} endpoint - Users/auth endpoint
   * @param {Object} options - Request options
   * @returns {Object} - Fallback user data
   * @private
   */
  _getFallbackUserData(endpoint, options) {
    // For login endpoint
    if (endpoint.includes('login') && options.method === 'POST') {
      // Create a fallback login response with dummy token
      const token = authService.createValidDummyToken();
      return {
        token,
        refreshToken: 'demo_refresh_token',
        user: {
          id: 'demo_user',
          username: 'demo',
          name: 'Demo User',
          role: 'barista',
          permissions: ['manage_orders', 'view_stations']
        },
        expiresIn: 86400
      };
    }
    
    // For user profile endpoint
    if (endpoint.includes('profile')) {
      return {
        id: 'demo_user',
        username: 'demo',
        name: 'Demo User',
        email: 'demo@example.com',
        role: 'barista',
        permissions: ['manage_orders', 'view_stations'],
        stations: [1, 2]
      };
    }
    
    // For logout endpoint
    if (endpoint.includes('logout')) {
      return { success: true, message: 'Logged out successfully' };
    }
    
    // For refresh token endpoint
    if (endpoint.includes('refresh')) {
      const token = authService.createValidDummyToken();
      return {
        token,
        refreshToken: 'new_demo_refresh_token',
        expiresIn: 86400
      };
    }
    
    // Default user data
    return {
      id: 'demo_user',
      username: 'demo',
      name: 'Demo User',
      role: 'barista'
    };
  }
  
  /**
   * Handle fallback mode enabled event
   * @private
   */
  _handleFallbackModeEnabled() {
    this.fallbackModeActive = true;
    this.log('Fallback mode enabled for API requests');
  }
  
  /**
   * Handle fallback mode disabled event
   * @private
   */
  _handleFallbackModeDisabled() {
    this.fallbackModeActive = false;
    this.log('Fallback mode disabled for API requests');
  }
  
  /**
   * Log messages if debug mode is enabled
   * @param  {...any} args - Message parts
   */
  log(...args) {
    if (this.debug) {
      console.log('[ApiService]', ...args);
    }
  }
  
  /**
   * GET request helper
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'GET'
    });
  }
  
  /**
   * POST request helper
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Data to send
   * @param {Object} options - Additional options
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
   * PUT request helper
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Data to send
   * @param {Object} options - Additional options
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
   * PATCH request helper
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Data to send
   * @param {Object} options - Additional options
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
   * DELETE request helper
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Additional options
   * @returns {Promise<any>} - API response
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'DELETE'
    });
  }
}

// Export as singleton
export default new ApiService();