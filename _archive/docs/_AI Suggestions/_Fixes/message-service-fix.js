// Enhanced MessageService.js with improved auth handling
// This replaces only the authentication-related methods in MessageService.js

import authService from './auth-service';

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
    if (response.status === 401 || response.status === 403) {
      try {
        // Try to refresh the token
        const refreshed = await authService.refreshAccessToken();
        
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
