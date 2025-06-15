// Enhanced OrderDataService.js with improved auth handling
// This replaces only the authentication-related methods in OrderDataService.js

import authService from './auth-service';

/**
 * Enhanced fetch method with authentication and automatic token refresh
 * @param {string} endpoint - API endpoint
 * @param {object} options - Request options
 * @returns {Promise<any>} - API response
 */
async fetchWithAuth(endpoint, options = {}) {
  try {
    let finalUrl;
    
    // Fix endpoint path format to avoid double slashes
    let normalizedEndpoint = endpoint;
    
    // If it's already a complete URL, use it directly
    if (normalizedEndpoint.startsWith('http')) {
      finalUrl = normalizedEndpoint;
      if (this.debugMode) console.log(`Using direct URL provided: ${finalUrl}`);
    } else {
      // Remove leading slash if present
      if (normalizedEndpoint.startsWith('/')) {
        normalizedEndpoint = normalizedEndpoint.substring(1);
      }
      
      // Handle relative paths
      if (normalizedEndpoint.includes('api/')) {
        // Already has api/ in the path, avoid adding it again
        // Extract path after api/ if it contains /api/ in the middle
        if (normalizedEndpoint.includes('/api/')) {
          normalizedEndpoint = normalizedEndpoint.substring(normalizedEndpoint.indexOf('/api/') + 5);
        }
        finalUrl = `${this.baseUrl}/${normalizedEndpoint}`;
      } else {
        // Determine if this is an API endpoint or a direct endpoint
        if (normalizedEndpoint.startsWith('orders/') || 
            normalizedEndpoint.startsWith('stations/') || 
            normalizedEndpoint.startsWith('settings/') || 
            normalizedEndpoint.startsWith('schedule/') ||
            normalizedEndpoint.startsWith('sms/')) {
          // This is likely an API endpoint, add api/ prefix
          finalUrl = `${this.baseUrl}/${normalizedEndpoint}`;
        } else {
          // This could be a direct endpoint without api prefix
          finalUrl = `${this.baseUrl.replace('/api', '')}/${normalizedEndpoint}`;
        }
      }
    }
    
    if (this.debugMode) console.log(`Final URL: ${finalUrl}`);
    
    // Add auth headers using the centralized auth service
    const headers = await authService.addAuthorizationHeader({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    });
    
    // Handle CORS issues by ensuring we don't use credentials
    // and set the mode to cors to avoid CORS preflight issues
    options = {
      ...options,
      headers,
      mode: 'cors',
    };

    // Add timeout control
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.connectionTimeout);

    // Make a direct XMLHttpRequest instead of using fetch - more reliable across browsers
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(options.method || 'GET', finalUrl);
      
      // Set headers
      Object.keys(headers).forEach(key => {
        xhr.setRequestHeader(key, headers[key]);
      });
      
      // Handle timeout
      xhr.timeout = this.connectionTimeout;
      xhr.ontimeout = () => {
        clearTimeout(timeoutId);
        reject(new Error('Request timed out'));
      };
      
      // Handle load
      xhr.onload = () => {
        clearTimeout(timeoutId);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (this.debugMode) {
              console.log(`✅ Success response from ${finalUrl}:`, data);
            }
            resolve(data);
          } catch (e) {
            console.error(`Error parsing JSON from ${finalUrl}:`, e);
            console.error(`Raw response: ${xhr.responseText}`);
            reject(new Error('Invalid JSON response'));
          }
        } else if (xhr.status === 401 || xhr.status === 403) {
          // Handle authentication errors
          try {
            const errorData = JSON.parse(xhr.responseText);
            if (errorData && (errorData.msg === 'Signature verification failed' || 
                             errorData.msg === 'Token expired' ||
                             errorData.msg === 'Invalid token')) {
              // Try to refresh the token and retry the request
              authService.refreshAccessToken()
                .then(refreshed => {
                  if (refreshed) {
                    // Retry the original request with new token
                    this.fetchWithAuth(endpoint, options)
                      .then(resolve)
                      .catch(reject);
                  } else {
                    console.error(`Authentication error and token refresh failed: ${xhr.status}`);
                    // If we're in fallback mode, use that instead of throwing
                    if (this.enableFallback) {
                      this.useFallbackData = true;
                      localStorage.setItem('use_fallback_data', 'true');
                      console.log('API protection triggered: Signature verification failed, using fallback data instead');
                      reject(new Error('Authentication failed, switching to fallback mode'));
                    } else {
                      reject(new Error(`Authentication failed: ${xhr.status}`));
                    }
                  }
                });
            } else {
              // Other auth error
              console.error(`Authentication error: ${xhr.status}`, errorData);
              reject(new Error(`Authentication error: ${xhr.status}`));
            }
          } catch (parseError) {
            console.error(`Error parsing auth error response: ${parseError}`);
            reject(new Error(`Authentication error: ${xhr.status}`));
          }
        } else {
          // Handle other HTTP errors
          let errorDetails = {};
          try {
            errorDetails = JSON.parse(xhr.responseText);
          } catch (e) {
            errorDetails = { message: xhr.responseText || `HTTP error: ${xhr.status}` };
          }
          
          console.error(`❌ API error from ${finalUrl}: ${xhr.status}`, errorDetails);
          console.error(`Headers sent:`, headers);
          reject(new Error(errorDetails.message || `API error: ${xhr.status}`));
        }
      };
      
      // Handle error
      xhr.onerror = () => {
        clearTimeout(timeoutId);
        console.error(`Network error for ${finalUrl}`);
        reject(new Error('Network error'));
      };
      
      // Send request
      xhr.send(options.body);
    });
  } catch (error) {
    console.error(`Error fetching from ${endpoint}:`, error);
    throw error;
  }
}

// Direct fetch method that doesn't use the auth service for special endpoints
async directFetch(endpoint, options = {}) {
  try {
    const url = endpoint.startsWith('http') 
      ? endpoint 
      : `${this.baseUrl}/${endpoint.replace(/^\//, '')}`;
    
    if (this.debugMode) console.log(`Using direct URL: ${url}`);
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {})
    };
    
    // For some endpoints we want to try without auth first
    const response = await fetch(url, {
      ...options,
      headers,
      mode: 'cors'
    });
    
    if (!response.ok) {
      // If we get a 401/403, try again with auth
      if (response.status === 401 || response.status === 403) {
        const authHeaders = await authService.addAuthorizationHeader(headers);
        
        const authResponse = await fetch(url, {
          ...options,
          headers: authHeaders,
          mode: 'cors'
        });
        
        if (!authResponse.ok) {
          const errorData = await authResponse.json();
          throw new Error(errorData.message || `API error: ${authResponse.status}`);
        }
        
        return await authResponse.json();
      }
      
      const errorData = await response.json();
      throw new Error(errorData.message || `API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error in directFetch for ${endpoint}:`, error);
    throw error;
  }
}
