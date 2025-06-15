/**
 * Enhanced API Service
 * 
 * Combines the simplicity of the simplified API service with:
 * 1. Centralized environment configuration
 * 2. Standardized error handling
 * 3. Consistent response processing
 */

import DemoModeService from './DemoModeService';
import env from '../config/env';
import errorHandler, { ERROR_TYPES } from '../utils/errorHandler';
import apiResponseHandler from '../utils/apiResponseHandler';

class ApiService {
  constructor() {
    this.baseUrl = env.API_URL;
    this.debug = env.API_DEBUG;
    this.timeout = env.API_TIMEOUT;
    this.tokenKey = 'coffee_system_token';
    this.token = localStorage.getItem(this.tokenKey);
    
    this.log('ApiService initialized with URL:', this.baseUrl);
  }
  
  /**
   * Set JWT token for authenticated requests
   * @param {string} token - JWT token
   */
  setToken(token) {
    this.token = token;
    
    if (token) {
      localStorage.setItem(this.tokenKey, token);
      this.log('Token set successfully');
    } else {
      localStorage.removeItem(this.tokenKey);
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
      
      // Process response using standardized handler
      return await apiResponseHandler.processResponse(response, endpoint);
    } catch (error) {
      // Handle specific error types
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Request timeout for ${endpoint}`);
        errorHandler.handleError(timeoutError, 'API request', { 
          notifyUser: true
        });
        throw timeoutError;
      }
      
      // If it's an authentication error, handle token-related issues
      if (error.status === 401 || error.status === 403) {
        this.handleAuthError(error);
      }
      
      // Log and rethrow
      this.log(`❌ Error in request to ${endpoint}:`, error);
      throw error;
    }
  }
  
  /**
   * Handle authentication errors
   * @param {Error} error - Authentication error
   */
  handleAuthError(error) {
    // Dispatch auth error event for other components to handle
    window.dispatchEvent(new CustomEvent('auth-error', { 
      detail: { error, message: error.message }
    }));
    
    // Log the error
    errorHandler.handleError(error, 'Authentication', { 
      notifyUser: true
    });
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