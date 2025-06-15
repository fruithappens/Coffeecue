/**
 * Improved API Service
 * 
 * A simplified, more maintainable API service that:
 * 1. Uses central configuration
 * 2. Implements proper error handling
 * 3. Streamlines fallback mechanisms
 * 4. Removes duplicate code patterns
 */

import config from '../config/config';
import FallbackService from './FallbackService';

class ApiService {
  constructor() {
    this.baseUrl = config.api.baseUrl;
    this.debug = config.api.debug;
    this.timeout = config.api.timeout;
    this.token = localStorage.getItem(config.auth.tokenKey);
    this.authErrors = 0;
    this.maxAuthErrors = config.auth.maxAuthErrors;
    
    this.log('ApiService initialized with base URL:', this.baseUrl);
  }
  
  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
    
    if (token) {
      localStorage.setItem(config.auth.tokenKey, token);
      // Reset auth error count when new token is set
      this.authErrors = 0;
      localStorage.removeItem('auth_error_count');
      this.log('Token set successfully');
    } else {
      localStorage.removeItem(config.auth.tokenKey);
      this.log('Token cleared');
    }
  }
  
  /**
   * Perform an HTTP request
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async request(endpoint, options = {}) {
    // Check if we're in fallback mode
    if (FallbackService.isEnabled()) {
      this.log('In fallback mode, returning mock data for:', endpoint);
      return await FallbackService.getMockData(endpoint, options);
    }
    
    try {
      const url = this.buildUrl(endpoint);
      this.log(`Making ${options.method || 'GET'} request to: ${url}`);
      
      // Add authentication and standard headers
      const headers = this.buildHeaders(options.headers);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      // Make the request
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        mode: 'cors',
      });
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // Process the response
      return await this.handleResponse(response, endpoint);
    } catch (error) {
      return this.handleError(error, endpoint, options);
    }
  }
  
  /**
   * Build the full URL for an API request
   * @param {string} endpoint - API endpoint
   * @returns {string} - Complete URL
   */
  buildUrl(endpoint) {
    // If endpoint is already a full URL, use it directly
    if (endpoint.startsWith('http')) {
      return endpoint;
    }
    
    // Remove leading slash if present
    const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    
    // If path already contains api/, don't add it again
    if (path.includes('api/')) {
      // Extract everything after the api/ part
      const apiPath = path.substring(path.indexOf('api/') + 4);
      return `${this.baseUrl}/${apiPath}`;
    }
    
    return `${this.baseUrl}/${path}`;
  }
  
  /**
   * Build headers for the request
   * @param {Object} additionalHeaders - Additional headers to include
   * @returns {Object} - Complete headers object
   */
  buildHeaders(additionalHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...additionalHeaders
    };
    
    // Add authorization header if token exists
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }
  
  /**
   * Handle API response
   * @param {Response} response - Fetch Response object
   * @param {string} endpoint - Original endpoint
   * @returns {Promise<any>} - Processed response data
   */
  async handleResponse(response, endpoint) {
    // If response is OK, parse and return the data
    if (response.ok) {
      try {
        const data = await response.json();
        this.log(`✅ Success response from ${endpoint}:`, data);
        return data;
      } catch (error) {
        this.log(`Error parsing successful response as JSON:`, error);
        return { success: true, message: 'Operation completed successfully' };
      }
    }
    
    // Handle authentication errors
    if (response.status === 401 || response.status === 403 || response.status === 422) {
      this.handleAuthError(response);
    }
    
    // Parse error details from response
    let errorDetails = {};
    try {
      errorDetails = await response.json();
    } catch (e) {
      errorDetails = { message: await response.text() || `HTTP error: ${response.status}` };
    }
    
    this.log(`❌ API error from ${endpoint}: ${response.status}`, errorDetails);
    throw new Error(errorDetails.message || `API error: ${response.status}`);
  }
  
  /**
   * Handle authentication errors
   * @param {Response} response - Fetch Response object
   */
  handleAuthError(response) {
    this.log('Authentication error detected');
    this.authErrors++;
    localStorage.setItem('auth_error_count', this.authErrors.toString());
    
    // Enable fallback mode if threshold reached
    if (this.authErrors >= this.maxAuthErrors && config.fallback.autoEnable) {
      this.log(`Auth errors threshold reached (${this.authErrors}/${this.maxAuthErrors}), enabling fallback mode`);
      FallbackService.enable();
    }
  }
  
  /**
   * Handle request errors
   * @param {Error} error - Original error
   * @param {string} endpoint - Original endpoint
   * @param {Object} options - Original request options
   * @returns {Promise<any>} - Error response or fallback data
   */
  async handleError(error, endpoint, options) {
    this.log(`Error in ${options.method || 'GET'} request to ${endpoint}:`, error);
    
    // If network error or timeout and fallback is auto-enabled, switch to fallback mode
    if ((error.name === 'AbortError' || error.message.includes('NetworkError')) && 
        config.fallback.autoEnable) {
      this.log('Network error detected, enabling fallback mode');
      FallbackService.enable();
      return await FallbackService.getMockData(endpoint, options);
    }
    
    throw error;
  }
  
  /**
   * Check if the API is reachable
   * @returns {Promise<boolean>} - True if API is reachable
   */
  async checkConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/healthcheck`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      
      return response.ok;
    } catch (error) {
      this.log('API connection check failed:', error);
      return false;
    }
  }
  
  /**
   * Log messages to console if debug mode is enabled
   * @param  {...any} args - Arguments to log
   */
  log(...args) {
    if (this.debug) {
      console.log('[ApiService]', ...args);
    }
  }
  
  /**
   * Make GET request
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
   * Make POST request
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
   * Make PUT request
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
   * Make PATCH request
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
   * Make DELETE request
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