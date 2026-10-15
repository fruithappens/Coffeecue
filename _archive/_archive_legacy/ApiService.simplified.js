/**
 * Simplified API Service with Demo Mode Support
 * 
 * A clean, simple API service that:
 * 1. Uses a straightforward config approach
 * 2. Provides optional demo mode for testing
 * 3. Handles errors consistently
 * 4. Removes complex fallback mechanisms
 */

import DemoModeService from './DemoModeService';

// Simple configuration object
const config = {
  // Use environment variable if available, otherwise default to localhost
  baseUrl: process.env.REACT_APP_API_URL || 'http://localhost:5001/api',
  debugMode: process.env.NODE_ENV === 'development',
  timeout: 15000, // 15 second timeout
  tokenKey: 'coffee_system_token'
};

class ApiService {
  constructor() {
    this.baseUrl = config.baseUrl;
    this.debug = config.debugMode;
    this.timeout = config.timeout;
    this.token = localStorage.getItem(config.tokenKey);
    
    this.log('ApiService initialized with URL:', this.baseUrl);
  }
  
  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
    
    if (token) {
      localStorage.setItem(config.tokenKey, token);
      this.log('Token set successfully');
    } else {
      localStorage.removeItem(config.tokenKey);
      this.log('Token cleared');
    }
  }
  
  /**
   * Make API request with support for demo mode
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async request(endpoint, options = {}) {
    // Check if demo mode is enabled
    if (DemoModeService.isEnabled()) {
      this.log('Demo mode active, returning sample data for:', endpoint);
      
      // Handle special cases for actions in demo mode
      if (options.method === 'POST' && endpoint.includes('/start')) {
        // Extract order ID from endpoint
        const orderId = endpoint.split('/').pop();
        return DemoModeService.startOrder(orderId);
      } else if (options.method === 'POST' && endpoint.includes('/complete')) {
        const orderId = endpoint.split('/').pop();
        return DemoModeService.completeOrder(orderId);
      } else if (options.method === 'POST' && endpoint.includes('/pickup')) {
        const orderId = endpoint.split('/').pop();
        return DemoModeService.pickupOrder(orderId);
      } else if (options.method === 'POST' && endpoint.includes('walk-in')) {
        // Handle adding walk-in order
        const orderData = options.body ? JSON.parse(options.body) : {};
        return DemoModeService.addOrder(orderData);
      }
      
      // For other endpoints, get general sample data
      return DemoModeService.getSampleData(endpoint);
    }
    
    try {
      const url = this.buildUrl(endpoint);
      this.log(`Making ${options.method || 'GET'} request to: ${url}`);
      
      // Create headers including auth token if available
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers || {})
      };
      
      // Add timeout with AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      // Make the request
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
        mode: 'cors' // For CORS handling
      });
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // Process response
      if (response.ok) {
        const data = await response.json();
        this.log(`✅ Response from ${endpoint}:`, data);
        return data;
      } else {
        // Try to get error details from response
        let errorDetails;
        try {
          errorDetails = await response.json();
        } catch {
          errorDetails = { message: `HTTP error: ${response.status}` };
        }
        
        this.log(`❌ API error from ${endpoint}: ${response.status}`, errorDetails);
        throw new Error(errorDetails.message || `API error: ${response.status}`);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        this.log(`⏱️ Request timeout for ${endpoint}`);
        throw new Error(`Request timeout for ${endpoint}`);
      }
      
      this.log(`❌ Error in request to ${endpoint}:`, error);
      throw error;
    }
  }
  
  /**
   * Build a complete URL from an endpoint
   * @param {string} endpoint - API endpoint
   * @returns {string} - Complete URL
   */
  buildUrl(endpoint) {
    // If it's already a complete URL, use it directly
    if (endpoint.startsWith('http')) {
      return endpoint;
    }
    
    // Remove leading slash if present
    const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    
    // Handle endpoints that already include /api/
    if (path.includes('api/')) {
      // Extract everything after api/
      const apiPath = path.substring(path.indexOf('api/') + 4);
      return `${this.baseUrl}/${apiPath}`;
    }
    
    return `${this.baseUrl}/${path}`;
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
   * Toggle demo mode
   * @returns {boolean} - New demo mode state
   */
  toggleDemoMode() {
    return DemoModeService.toggle();
  }
  
  /**
   * Check if demo mode is enabled
   * @returns {boolean} - Demo mode state
   */
  isDemoMode() {
    return DemoModeService.isEnabled();
  }
  
  /**
   * Reset demo data
   * @returns {object} - Operation result
   */
  resetDemoData() {
    return DemoModeService.resetData();
  }
}

// Export as singleton
export default new ApiService();