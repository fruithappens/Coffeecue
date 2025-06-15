/**
 * Enhanced JWT helper for handling authentication tokens
 * This script fixes authentication issues and ensures proper token handling
 */

(function() {
  console.log('JWT Helper: Initializing enhanced token handling');
  
  // Configuration
  const TOKEN_KEY = 'coffee_system_token';
  const REFRESH_KEY = 'coffee_system_refresh_token';
  const EXPIRY_KEY = 'coffee_system_token_expiry';
  
  // Check token expiration on page load
  window.addEventListener('DOMContentLoaded', function() {
    console.log('JWT Helper: Checking token status on page load');
    checkTokenExpiration();
  });
  
  // Add token to all API requests
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    // Only intercept API requests to our backend
    if (typeof url === 'string' && 
        (url.includes('/api/') || url.includes('localhost:5001'))) {
      
      try {
        // Get token from storage
        const token = localStorage.getItem(TOKEN_KEY);
        
        if (token) {
          // Initialize headers if not present
          options.headers = options.headers || {};
          
          // Add Authorization header if not already present
          if (!options.headers.Authorization && !options.headers.authorization) {
            options.headers.Authorization = `Bearer ${token}`;
            console.log(`JWT Helper: Added token to request for ${url}`);
          }
        }
      } catch (e) {
        console.error('JWT Helper: Error adding token to request', e);
      }
    }
    
    // Call original fetch with possibly modified options
    return originalFetch(url, options);
  };
  
  // Check token expiration
  function checkTokenExpiration() {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const expiry = localStorage.getItem(EXPIRY_KEY);
      
      if (!token) {
        console.log('JWT Helper: No token found');
        return;
      }
      
      // Check if expiry time exists
      if (expiry) {
        const expiryTime = parseInt(expiry, 10);
        const currentTime = new Date().getTime();
        
        // If token is expired, try to refresh
        if (currentTime > expiryTime) {
          console.log('JWT Helper: Token is expired, attempting to refresh');
          refreshToken();
        } else {
          // Calculate time until expiration
          const timeLeft = Math.floor((expiryTime - currentTime) / 1000 / 60);
          console.log(`JWT Helper: Token is valid for approximately ${timeLeft} more minutes`);
          
          // If token expires in less than 5 minutes, refresh it proactively
          if (timeLeft < 5) {
            console.log('JWT Helper: Token expires soon, refreshing proactively');
            refreshToken();
          }
        }
      } else {
        // If no expiry time, try to parse token to get expiration
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          if (payload.exp) {
            const expiryTime = payload.exp * 1000; // Convert to milliseconds
            localStorage.setItem(EXPIRY_KEY, expiryTime.toString());
            
            // Check if token is expired
            if (new Date().getTime() > expiryTime) {
              console.log('JWT Helper: Token is expired (from payload), attempting to refresh');
              refreshToken();
            } else {
              const timeLeft = Math.floor((expiryTime - new Date().getTime()) / 1000 / 60);
              console.log(`JWT Helper: Token is valid for approximately ${timeLeft} more minutes (from payload)`);
            }
          }
        } catch (e) {
          console.log('JWT Helper: Could not parse token payload');
        }
      }
    } catch (e) {
      console.error('JWT Helper: Error checking token expiration', e);
    }
  }
  
  // Refresh token
  function refreshToken() {
    try {
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      
      if (!refreshToken) {
        console.log('JWT Helper: No refresh token available');
        return;
      }
      
      console.log('JWT Helper: Attempting to refresh token');
      
      // Send refresh request
      fetch('http://localhost:5001/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Refresh failed with status ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.token) {
          console.log('JWT Helper: Token refreshed successfully');
          
          // Store new token
          localStorage.setItem(TOKEN_KEY, data.token);
          
          // Store new expiry time if provided
          if (data.expiresIn) {
            const expiryTime = new Date().getTime() + (data.expiresIn * 1000);
            localStorage.setItem(EXPIRY_KEY, expiryTime.toString());
          }
          
          // Store new refresh token if provided
          if (data.refreshToken) {
            localStorage.setItem(REFRESH_KEY, data.refreshToken);
          }
          
          // Reload page to ensure all components use the new token
          window.location.reload();
        } else {
          console.error('JWT Helper: Refresh response did not contain a token');
        }
      })
      .catch(error => {
        console.error('JWT Helper: Token refresh failed', error);
      });
    } catch (e) {
      console.error('JWT Helper: Error in refresh token process', e);
    }
  }
  
  // Expose helper functions for debugging
  window.jwtHelper = {
    checkToken: checkTokenExpiration,
    refreshToken: refreshToken,
    clearTokens: function() {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
      localStorage.removeItem(EXPIRY_KEY);
      console.log('JWT Helper: All tokens cleared');
    }
  };
  
  console.log('JWT Helper: Token handling configured successfully');
})();
