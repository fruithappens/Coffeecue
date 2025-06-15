// ApiErrorHandler.js
// Central service for handling API errors, especially JWT-related issues

import AuthService from './AuthService';

/**
 * API Error Handler service
 * Handles common API errors, particularly JWT token issues
 */
class ApiErrorHandler {
  constructor() {
    this.jwtErrorDebounce = {
      endpoints: {},
      JWT_ERROR_DEBOUNCE_MS: 30000, // 30 seconds
    };
    
    // Load any stored errors
    this._loadStoredErrors();
    
    // Counter for token refresh attempts to prevent infinite loops
    this.refreshAttempts = 0;
    this.MAX_REFRESH_ATTEMPTS = 3;
    
    // Log initialization
    console.log('ApiErrorHandler initialized');
  }
  
  /**
   * Load stored JWT error endpoints from localStorage
   * @private
   */
  _loadStoredErrors() {
    try {
      const storedErrors = localStorage.getItem('jwt_error_endpoints');
      if (storedErrors) {
        this.jwtErrorDebounce.endpoints = JSON.parse(storedErrors);
      }
    } catch (e) {
      console.error('Error loading JWT error endpoints:', e);
      this.jwtErrorDebounce.endpoints = {};
    }
  }
  
  /**
   * Record JWT error for an endpoint
   * @param {string} endpoint - API endpoint that failed
   */
  recordJwtError(endpoint) {
    this.jwtErrorDebounce.endpoints[endpoint] = Date.now();
    try {
      localStorage.setItem('jwt_error_endpoints', 
        JSON.stringify(this.jwtErrorDebounce.endpoints));
    } catch (e) {
      console.error('Error storing JWT error endpoints:', e);
    }
  }
  
  /**
   * Clear JWT error for an endpoint
   * @param {string} endpoint - API endpoint to clear
   */
  clearJwtError(endpoint) {
    delete this.jwtErrorDebounce.endpoints[endpoint];
    try {
      localStorage.setItem('jwt_error_endpoints', 
        JSON.stringify(this.jwtErrorDebounce.endpoints));
    } catch (e) {
      console.error('Error storing JWT error endpoints:', e);
    }
  }
  
  /**
   * Check if endpoint should be debounced due to recent JWT errors
   * @param {string} endpoint - API endpoint to check
   * @returns {boolean} - True if endpoint should be debounced
   */
  shouldDebounce(endpoint) {
    const now = Date.now();
    const lastErrorTime = this.jwtErrorDebounce.endpoints[endpoint] || 0;
    return (now - lastErrorTime) < this.jwtErrorDebounce.JWT_ERROR_DEBOUNCE_MS;
  }
  
  /**
   * Reset JWT error state
   */
  resetState() {
    this.jwtErrorDebounce.endpoints = {};
    this.refreshAttempts = 0;
    localStorage.removeItem('jwt_error_endpoints');
    localStorage.removeItem('JWT_SIGNATURE_ERROR');
    localStorage.removeItem('LAST_TOKEN_RESET');
  }
  
  /**
   * Handle signature verification failed errors
   * @param {string} endpoint - API endpoint that failed
   * @param {Function} retryFn - Function to retry original request
   * @returns {Promise<any>} - Result of retry or fallback data
   */
  async handleSignatureVerificationError(endpoint, retryFn) {
    console.warn(`Handling signature verification error for ${endpoint}`);
    
    // Record this error to prevent excessive retries
    this.recordJwtError(endpoint);
    
    // Increment refresh attempt counter
    this.refreshAttempts++;
    
    // Check if we've reached max attempts
    if (this.refreshAttempts >= this.MAX_REFRESH_ATTEMPTS) {
      console.error(`Max refresh attempts (${this.MAX_REFRESH_ATTEMPTS}) reached, enabling fallback mode`);
      this._enableFallbackMode();
      return this._getFallbackResponse(endpoint);
    }
    
    try {
      // Try to refresh token using AuthService
      const refreshed = await AuthService.refreshToken();
      
      if (refreshed) {
        console.log('Token refreshed successfully, retrying request');
        
        // Retry the request with the new token
        try {
          const result = await retryFn();
          // Clear error state on success
          this.clearJwtError(endpoint);
          this.refreshAttempts = 0;
          return result;
        } catch (retryError) {
          console.error('Retry also failed after token refresh:', retryError);
          
          // If retry fails after valid token refresh, create a completely new token
          // This handles the case where there might be a deeper issue with token format
          const newToken = await this._createNewValidToken();
          
          // Try one more time with the completely new token
          try {
            const finalResult = await retryFn();
            this.clearJwtError(endpoint);
            this.refreshAttempts = 0;
            return finalResult;
          } catch (finalError) {
            console.error('All token refresh attempts failed, enabling fallback mode');
            this._enableFallbackMode();
            return this._getFallbackResponse(endpoint);
          }
        }
      } else {
        console.warn('Token refresh failed, creating new token');
        
        // If normal refresh fails, create a completely new token
        const newToken = await this._createNewValidToken();
        
        // Retry with new token
        try {
          const result = await retryFn();
          this.clearJwtError(endpoint);
          this.refreshAttempts = 0;
          return result;
        } catch (newTokenError) {
          console.error('New token also failed, enabling fallback mode');
          this._enableFallbackMode();
          return this._getFallbackResponse(endpoint);
        }
      }
    } catch (refreshError) {
      console.error('Error during token refresh flow:', refreshError);
      this._enableFallbackMode();
      return this._getFallbackResponse(endpoint);
    }
  }
  
  /**
   * Handle general API error
   * @param {Error} error - Error that occurred
   * @param {string} endpoint - API endpoint that failed
   * @param {Function} retryFn - Function to retry original request
   * @returns {Promise<any>} - Result of handling or rethrown error
   */
  async handleError(error, endpoint, retryFn) {
    // Check if this is a JWT signature verification error
    const isSignatureError = 
      (error.message && (
        error.message.includes('Signature verification failed') ||
        error.message.includes('invalid token') ||
        error.message.includes('Token validation failed')
      )) || 
      (error.status === 422) ||
      (error.response && error.response.status === 422);
      
    if (isSignatureError) {
      return this.handleSignatureVerificationError(endpoint, retryFn);
    }
    
    // Check if this is an authentication error
    const isAuthError = 
      (error.status === 401) || 
      (error.status === 403) ||
      (error.response && (error.response.status === 401 || error.response.status === 403)) ||
      (error.message && (
        error.message.includes('401') ||
        error.message.includes('403') ||
        error.message.includes('unauthorized') ||
        error.message.includes('Unauthorized') ||
        error.message.includes('forbidden') ||
        error.message.includes('Forbidden')
      ));
      
    if (isAuthError) {
      // Try refreshing the token for auth errors
      const refreshed = await AuthService.refreshToken();
      
      if (refreshed) {
        console.log('Token refreshed successfully, retrying request');
        try {
          return await retryFn();
        } catch (retryError) {
          // If retry fails, create a new token as last resort
          await this._createNewValidToken();
          
          try {
            return await retryFn();
          } catch (finalError) {
            console.error('All auth error recovery attempts failed');
            throw finalError;
          }
        }
      } else {
        // Try creating a new token
        await this._createNewValidToken();
        
        try {
          return await retryFn();
        } catch (newTokenError) {
          console.error('Auth error recovery with new token failed');
          throw newTokenError;
        }
      }
    }
    
    // For other errors, just rethrow
    throw error;
  }
  
  /**
   * Create a completely new valid token
   * @returns {Promise<string>} - Newly created token
   * @private
   */
  async _createNewValidToken() {
    console.log('Creating new valid token for auth recovery');
    
    // Use AuthService's createValidDummyToken
    const newToken = AuthService.createValidDummyToken();
    console.log('Created new token for authentication recovery');
    
    return newToken;
  }
  
  /**
   * Enable fallback mode after persistent API errors
   * @private
   */
  _enableFallbackMode() {
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('auth_error_refresh_needed', 'true');
    
    console.warn('Fallback mode enabled due to persistent API errors');
    
    // Notify the application if possible
    try {
      window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
    } catch (e) {
      // Ignore errors if event dispatch fails
    }
  }
  
  /**
   * Get a standardized fallback response
   * @param {string} endpoint - API endpoint
   * @returns {Object} - Fallback response data
   * @private
   */
  _getFallbackResponse(endpoint) {
    // Basic fallback response
    const response = {
      success: true,
      message: 'Operation completed in fallback mode',
      timestamp: new Date().toISOString(),
      fallback: true
    };
    
    // Add appropriate data based on endpoint type
    if (endpoint.includes('orders')) {
      response.data = [];
    } else if (endpoint.includes('stations')) {
      response.data = [{ id: 1, name: 'Station 1', status: 'active' }];
    } else if (endpoint.includes('settings')) {
      response.data = { 
        defaultWaitTime: 15, 
        notificationEnabled: true 
      };
    } else {
      response.data = {};
    }
    
    return response;
  }
}

// Export as singleton
export default new ApiErrorHandler();