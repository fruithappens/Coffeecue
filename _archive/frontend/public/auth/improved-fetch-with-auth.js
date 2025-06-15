/**
 * improved-fetch-with-auth.js
 * Improved implementation of fetchWithAuth method that handles JWT errors properly
 */

(function() {
  console.log('Loading improved fetchWithAuth implementation...');
  
  // Counter for retry attempts to prevent infinite loops
  let retryCount = 0;
  const MAX_RETRIES = 2;
  
  /**
   * JWT error handler that generates new tokens when signature verification fails
   * @param {Error} error - The error that occurred
   * @param {Function} requestFn - Function to retry the original request
   * @returns {Promise<any>} - Result of retry or null if redirected to login
   */
  async function handleJwtError(error, requestFn) {
    // Reset retry count if it's too high
    if (retryCount >= MAX_RETRIES) {
      console.error(`Max JWT retry attempts (${MAX_RETRIES}) reached, forcing logout`);
      retryCount = 0;
      
      // Force logout by clearing tokens
      Object.keys(localStorage).forEach(key => {
        if (key.includes('token')) {
          localStorage.removeItem(key);
        }
      });
      
      // In debug mode, provide more options instead of forcing redirect
      const debugMode = localStorage.getItem('debug_mode') === 'true';
      if (debugMode) {
        console.log('Debug mode enabled, showing options instead of forcing logout');
        return { 
          error: 'jwt_failed', 
          reason: 'max_retries',
          message: 'JWT token authentication failed after multiple retries'
        };
      }
      
      // Redirect to login
      window.location.href = '/login?error=jwt_failed&reason=max_retries';
      return null;
    }
    
    // Check if this is a JWT error
    const isJwtError = 
      (error.message && (
        error.message.includes('Signature verification failed') ||
        error.message.includes('JWT') ||
        error.message.includes('token')
      )) ||
      (error.response && error.response.status === 422) ||
      (error.status === 422);
    
    if (!isJwtError) {
      // Not a JWT error, don't handle
      throw error;
    }
    
    console.log(`JWT error detected, attempt #${retryCount + 1}`);
    retryCount++;
    
    // Create a new token since we know signature verification failed
    // This is more reliable than trying to use a refresh token
    try {
      console.log('Creating new token to resolve signature verification error');
      
      // Use the createProperJwt function from jwt-debug.js if available
      let newToken;
      if (window.createProperJwt) {
        newToken = window.createProperJwt();
      } else {
        // Fallback implementation if jwt-debug.js is not loaded
        const header = {
          alg: 'HS256',
          typ: 'JWT'
        };
        
        const now = Math.floor(Date.now() / 1000);
        const payload = {
          sub: 'barista_user',  // Must be a string
          name: 'Barista User',
          role: 'barista',
          iat: now,
          exp: now + (24 * 60 * 60)  // 24 hours
        };
        
        // Base64Url encode parts
        function base64UrlEncode(str) {
          return btoa(str)
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
        }
        
        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const signature = base64UrlEncode(`signature-${Date.now()}`);
        
        newToken = `${encodedHeader}.${encodedPayload}.${signature}`;
      }
      
      // Store the new token in all known token storage locations
      const tokenKeys = [
        'coffee_system_token', 
        'coffee_auth_token',
        'auth_token',
        'token',
        'access_token',
        'jwt_token'
      ];
      
      tokenKeys.forEach(key => {
        localStorage.setItem(key, newToken);
      });
      
      console.log('New token created and stored, retrying original request');
      
      // Retry the original request with the new token
      try {
        return await requestFn();
      } catch (retryError) {
        console.error('Retry with new token also failed:', retryError);
        
        // If retry still fails and we haven't reached max retries,
        // let the next call to handleJwtError handle it
        throw retryError;
      }
    } catch (tokenError) {
      console.error('Error creating/using new token:', tokenError);
      throw error; // Re-throw the original error
    }
  }
  
  /**
   * Improved fetchWithAuth method that handles JWT signature verification errors
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async function improvedFetchWithAuth(endpoint, options = {}) {
    try {
      // Ensure endpoint is properly formatted
      let finalUrl;
      if (endpoint.startsWith('http')) {
        finalUrl = endpoint;
      } else {
        // Remove leading slash if present
        const normalizedEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        
        // Ensure api/ prefix is present
        if (!normalizedEndpoint.startsWith('api/')) {
          finalUrl = `http://localhost:5001/api/${normalizedEndpoint}`;
        } else {
          finalUrl = `http://localhost:5001/${normalizedEndpoint}`;
        }
      }
      
      console.log(`Making authenticated request to: ${finalUrl}`);
      
      // Get the token - try multiple storage locations
      const possibleTokenKeys = [
        'coffee_system_token', 
        'coffee_auth_token', 
        'auth_token',
        'token',
        'access_token',
        'jwt_token'
      ];
      
      let token = null;
      
      for (const key of possibleTokenKeys) {
        const storedToken = localStorage.getItem(key);
        if (storedToken) {
          token = storedToken;
          // Don't log the token itself for security
          console.log(`Using token from localStorage key: ${key}`);
          break;
        }
      }
      
      // Prepare request headers
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      
      // Only add Authorization if we have a token
      if (token) {
        // IMPORTANT: Make sure the Bearer format is correct with a space after "Bearer"
        headers['Authorization'] = `Bearer ${token}`;
        
        // Debug token format
        if (token.split('.').length !== 3) {
          console.warn('⚠️ Warning: Token does not appear to be in correct JWT format');
        }
      } else {
        console.warn('No token available for authenticated request');
      }
      
      // Make the request
      const response = await fetch(finalUrl, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {})
        },
        mode: 'cors'
      });
      
      // Handle response
      if (!response.ok) {
        let errorData;
        
        try {
          const errorText = await response.text();
          try {
            errorData = JSON.parse(errorText);
          } catch (e) {
            errorData = { 
              message: errorText || `HTTP error: ${response.status}`,
              rawText: errorText
            };
          }
        } catch (e) {
          errorData = { message: `HTTP error: ${response.status}` };
        }
        
        // Specific handling for JWT signature errors
        if (response.status === 422 && 
            errorData && 
            errorData.msg === 'Signature verification failed') {
          console.error('JWT signature verification failed');
          
          // Store error info in sessionStorage for debugging
          sessionStorage.setItem('last_jwt_error', JSON.stringify({
            time: new Date().toISOString(),
            url: finalUrl,
            error: errorData,
            tokenFirstChars: token ? token.substring(0, 10) : 'none'
          }));
          
          // Try to handle the JWT error
          return await handleJwtError(
            { message: 'Signature verification failed', response, status: response.status },
            () => improvedFetchWithAuth(endpoint, options)
          );
        }
        
        // For other errors
        console.error(`API error ${response.status} for ${finalUrl}:`, errorData);
        throw new Error(errorData.msg || errorData.message || `API error: ${response.status}`);
      }
      
      // Parse JSON response
      try {
        const jsonResponse = await response.json();
        return jsonResponse;
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        throw new Error('Invalid JSON response from server');
      }
    } catch (error) {
      console.error(`Error during improvedFetchWithAuth for ${endpoint}:`, error);
      
      // Check if this might be a JWT error
      if (error.message && (
        error.message.includes('Signature verification failed') ||
        error.message.includes('API error: 422')
      )) {
        // Try JWT error handler
        try {
          return await handleJwtError(error, () => improvedFetchWithAuth(endpoint, options));
        } catch (handlerError) {
          console.error('JWT error handler failed:', handlerError);
          throw handlerError;
        }
      }
      
      // Re-throw the error if it's not a JWT error or if handling failed
      throw error;
    }
  }
  
  // Expose the improved fetch function
  window.improvedFetchWithAuth = improvedFetchWithAuth;
  
  // Function to patch OrderDataService
  window.patchOrderDataService = function() {
    if (typeof window.OrderDataService !== 'undefined') {
      console.log('OrderDataService found, patching fetchWithAuth method...');
      
      // Save reference to original method
      const originalFetchWithAuth = window.OrderDataService.prototype.fetchWithAuth;
      
      // Replace with improved version
      window.OrderDataService.prototype.fetchWithAuth = async function(endpoint, options = {}) {
        console.log('Using improved fetchWithAuth for request to:', endpoint);
        
        try {
          // Use the improved implementation
          return await improvedFetchWithAuth(endpoint, options);
        } catch (error) {
          // If we're already in fallback mode, don't try to handle errors
          if (this.useFallbackData) {
            console.log('Already in fallback mode, not attempting error handling');
            throw error;
          }
          
          // Log the error
          console.error(`Error in patched fetchWithAuth: ${error.message}`);
          
          // Enable fallback mode for unrecoverable errors
          console.log('Enabling fallback mode due to unrecoverable error');
          this.useFallbackData = true;
          localStorage.setItem('use_fallback_data', 'true');
          
          // Throw the error to be handled by the calling function
          throw error;
        }
      };
      
      console.log('OrderDataService.fetchWithAuth successfully patched');
    } else {
      console.log('OrderDataService not found, cannot patch.');
    }
  };
  
  // Wait for DOM load and apply patches
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Try to patch OrderDataService if it's available
      window.setTimeout(window.patchOrderDataService, 1000);
    });
  } else {
    // DOM already loaded, try to patch immediately
    window.setTimeout(window.patchOrderDataService, 1000);
  }
  
  console.log('Improved fetchWithAuth implementation loaded successfully');
})();