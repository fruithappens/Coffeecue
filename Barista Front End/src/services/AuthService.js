// services/AuthService.js
import OrderDataService from './OrderDataService';
import ConfigService from './ConfigService';
import tokenRefreshService from './TokenRefreshService';

class AuthService {
  constructor() {
    this.tokenKey = 'coffee_system_token';
    this.userKey = 'coffee_system_user';
    this.refreshKey = 'coffee_system_refresh_token';
    this.expiryKey = 'coffee_system_token_expiry';
    
    // Track authentication errors for fallback mode
    this.authErrors = 0;
    this.maxAuthErrors = 3;
    this.debugMode = true;
    
    // Load tokens from localStorage
    this.accessToken = localStorage.getItem(this.tokenKey);
    this.refreshToken = localStorage.getItem(this.refreshKey);
    this.tokenExpiry = localStorage.getItem(this.expiryKey) 
      ? new Date(localStorage.getItem(this.expiryKey)) 
      : null;
      
    // Check if fallback mode is enabled
    this.useFallbackData = localStorage.getItem('use_fallback_data') === 'true';
    if (this.useFallbackData) {
      console.log('AuthService: Fallback mode is already enabled');
    }
    
    // Start token refresh if we have a valid token
    if (this.accessToken) {
      tokenRefreshService.startAutoRefresh();
    }
  }

  /**
   * Log in user and save JWT tokens
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<Object>} - Login result with user info
   */
  async login(username, password) {
    try {
      // Use ConfigService for API URL
      const response = await fetch(ConfigService.getApiUrl('auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ username, password }),
        mode: 'cors'
        // Don't include credentials to avoid CORS issues with wildcard origin
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { message: 'Invalid username or password' };
        }
        throw new Error(errorData.message || 'Login failed');
      }

      const data = await response.json();
      
      // Make sure we have the expected data structure
      if (!data || !data.token) {
        throw new Error('Invalid response format from server');
      }
      
      // Save tokens and user data
      localStorage.setItem(this.tokenKey, data.token);
      localStorage.setItem(this.refreshKey, data.refreshToken || '');
      
      // Also save with standard keys for compatibility
      localStorage.setItem('token', data.token);
      localStorage.setItem('refreshToken', data.refreshToken || '');
      localStorage.setItem('tokenExpiresIn', String(data.expiresIn || 3600));
      
      // Save token expiry if provided
      if (data.expiresIn) {
        const expiry = new Date();
        expiry.setSeconds(expiry.getSeconds() + data.expiresIn);
        this.tokenExpiry = expiry;
        localStorage.setItem(this.expiryKey, expiry.toISOString());
      }
      
      // Start automatic token refresh
      tokenRefreshService.startAutoRefresh();
      
      // Make sure user object exists before storing
      const userData = data.user || { 
        id: 'unknown',
        username,
        role: 'guest'
      };
      
      localStorage.setItem(this.userKey, JSON.stringify(userData));
      
      // Set token for API requests
      OrderDataService.setToken(data.token);
      
      // Reset auth errors on successful login
      this.authErrors = 0;
      localStorage.removeItem('auth_error_count');
      localStorage.removeItem('auth_error_refresh_needed');
      localStorage.removeItem('use_fallback_data');
      
      // Redirect to the appropriate dashboard based on user role
      this.redirectBasedOnRole(userData.role);
      
      return {
        token: data.token,
        refreshToken: data.refreshToken,
        user: userData,
        expiresIn: data.expiresIn || 3600
      };
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Log out user
   */
  logout() {
    // Stop token refresh
    tokenRefreshService.stopAutoRefresh();
    
    // First get current path to potentially redirect back after login
    const currentPath = window.location.pathname;
    const redirectParam = currentPath && currentPath !== '/' && currentPath !== '/login' 
      ? `?redirect=${encodeURIComponent(currentPath)}` 
      : '';
      
    // Clear local storage tokens and user data
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshKey);
    localStorage.removeItem(this.userKey);
    localStorage.removeItem(this.expiryKey);
    
    // Clear standard token keys
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tokenExpiresIn');
    localStorage.removeItem('user');
    
    // Clear token from API service
    OrderDataService.setToken(null);
    
    // Call logout endpoint to invalidate token on server
    try {
      // Use ConfigService for API URL
      fetch(ConfigService.getApiUrl('auth/logout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.getToken()}`
        },
        mode: 'cors'
        // Don't include credentials to avoid CORS issues with wildcard origin
      }).catch(err => {
        // Silent catch - we're logging out anyway
        console.log('Logout request error:', err);
      });
    } catch (error) {
      // Ignore errors during logout
    }
    
    // Create a custom event for logout to notify other components
    window.dispatchEvent(new Event('user_logged_out'));
    
    // Redirect to login page with redirect parameter if appropriate
    window.location.href = `/login${redirectParam}`;
  }

  /**
   * Redirect user based on their role
   * @param {string} role - User role
   */
  redirectBasedOnRole(role) {
    let redirectPath = '/';
    
    switch(role) {
      case 'admin':
        redirectPath = '/admin';
        break;
      case 'staff':
      case 'event_organizer':
        redirectPath = '/staff';
        break;
      case 'barista':
        redirectPath = '/barista';
        break;
      case 'support':
        redirectPath = '/support';
        break;
      case 'display':
        redirectPath = '/display';
        break;
      default:
        // If role doesn't match, go to the role selection page
        redirectPath = '/';
        break;
    }
    
    // In React SPA, if we're already on the page, this won't trigger a reload
    // So force navigation to make sure components re-render
    if (window.location.pathname === redirectPath) {
      window.location.reload();
    } else {
      window.location.href = redirectPath;
    }
  }

  /**
   * Get current authenticated user
   * @returns {Object|null} - User data or null if not logged in
   */
  getCurrentUser() {
    const userStr = localStorage.getItem(this.userKey);
    if (!userStr) return null;
    
    try {
      return JSON.parse(userStr);
    } catch (error) {
      console.error('Error parsing user data:', error);
      return null;
    }
  }

  /**
   * Get JWT token
   * @returns {string|null} - JWT token or null if not logged in
   */
  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Check if user is logged in
   * @returns {boolean} - True if logged in
   */
  isLoggedIn() {
    return !!this.getToken();
  }

  /**
   * Check if token is expired
   * @param {number} bufferSeconds - Seconds before actual expiry to consider token as expired (default: 300s/5min)
   * @returns {boolean} - True if token is expired
   */
  isTokenExpired(bufferSeconds = 300) {
    const token = this.getToken();
    if (!token) return true;
    
    try {
      // Get token payload
      const payload = JSON.parse(atob(token.split('.')[1]));
      
      // Check expiration with buffer
      const currentTime = Math.floor(Date.now() / 1000);
      const expirationTime = payload.exp;
      
      // If expiration is within buffer, consider it expired
      return currentTime + bufferSeconds >= expirationTime;
    } catch (error) {
      console.error('Token validation error:', error);
      return true;
    }
  }
  
  /**
   * Validate token format and structure
   * @returns {Object} - Validation result with status and error message if any
   */
  validateToken() {
    const token = this.getToken();
    if (!token) {
      return { isValid: false, error: 'No token found' };
    }
    
    try {
      // Check token format (should be 3 parts separated by dots)
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { isValid: false, error: 'Invalid token format' };
      }
      
      // Try to decode header
      try {
        const header = JSON.parse(atob(parts[0]));
        if (!header.alg || !header.typ) {
          return { isValid: false, error: 'Invalid token header' };
        }
      } catch (e) {
        return { isValid: false, error: 'Cannot decode token header' };
      }
      
      // Try to decode payload
      try {
        const payload = JSON.parse(atob(parts[1]));
        
        // Verify required claims
        if (!payload.sub) {
          return { isValid: false, error: 'Token missing subject claim' };
        }
        
        // Check subject format - must be a string
        if (typeof payload.sub !== 'string') {
          return { isValid: false, error: 'Subject must be a string' };
        }
        
        // Check expiration
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return { isValid: false, error: 'Token has expired', expired: true };
        }
        
        // Everything looks good
        return { 
          isValid: true, 
          payload: payload,
          expiresAt: payload.exp ? new Date(payload.exp * 1000) : null
        };
      } catch (e) {
        return { isValid: false, error: 'Cannot decode token payload' };
      }
    } catch (error) {
      console.error('Token validation error:', error);
      return { isValid: false, error: error.message };
    }
  }

  /**
   * Refresh token
   * @returns {Promise<boolean>} - True if refresh successful
   */
  async refreshToken() {
    const refreshToken = localStorage.getItem(this.refreshKey);
    if (!refreshToken) return false;
    
    try {
      // Use ConfigService for API URL
      const response = await fetch(ConfigService.getApiUrl('auth/refresh'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ refreshToken }),
        mode: 'cors'
        // Don't include credentials to avoid CORS issues with wildcard origin
      });
      
      if (!response.ok) {
        this.incrementAuthError();
        throw new Error('Token refresh failed');
      }
      
      const data = await response.json();
      
      // Validate response contains token
      if (!data || !data.token) {
        this.incrementAuthError();
        throw new Error('Invalid response from refresh endpoint');
      }
      
      // Save new token
      localStorage.setItem(this.tokenKey, data.token);
      
      // Save token expiry if provided
      if (data.expiresIn) {
        const expiry = new Date();
        expiry.setSeconds(expiry.getSeconds() + data.expiresIn);
        this.tokenExpiry = expiry;
        localStorage.setItem(this.expiryKey, expiry.toISOString());
      }
      
      // Update token for API requests
      OrderDataService.setToken(data.token);
      
      // Reset auth error count on successful refresh
      this.authErrors = 0;
      localStorage.removeItem('auth_error_count');
      
      console.log('Token refreshed successfully');
      return true;
    } catch (error) {
      console.error('Token refresh error:', error);
      this.incrementAuthError();
      return false;
    }
  }

  /**
   * Handle authentication - check token and refresh if needed
   * @returns {Promise<boolean>} - True if authenticated
   */
  async handleAuthentication() {
    console.log('🔧 handleAuthentication called');
    
    if (!this.isLoggedIn()) {
      console.log('Not logged in - no token found');
      return false;
    }
    
    // TEMPORARY FIX: Bypass refresh logic for now
    const token = this.getToken();
    const user = this.getCurrentUser();
    
    if (!token || !user) {
      console.log('Missing token or user data');
      return false;
    }
    
    // Simple validation - check if token is completely expired
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = new Date(payload.exp * 1000);
      const now = new Date();
      
      // Only fail if token is completely expired (not just within refresh window)
      if (exp <= now) {
        console.log('Token is completely expired');
        localStorage.removeItem(this.tokenKey);
        return false;
      }
      
      console.log('✅ Token is valid, user authenticated');
      
      // Set token for API requests
      OrderDataService.setToken(token);
      
      return true;
      
    } catch (error) {
      console.error('Error validating token:', error);
      localStorage.removeItem(this.tokenKey);
      return false;
    }
  }
  
  /**
   * Track authentication errors
   */
  incrementAuthError() {
    this.authErrors++;
    
    // Store error count in localStorage for persistence across page refreshes
    const currentCount = parseInt(localStorage.getItem('auth_error_count') || '0');
    localStorage.setItem('auth_error_count', (currentCount + 1).toString());
    
    console.log(`Auth error count: ${this.authErrors}/${this.maxAuthErrors}`);
    
    // If we've hit the threshold, enable fallback mode
    if (this.authErrors >= this.maxAuthErrors || currentCount + 1 >= this.maxAuthErrors) {
      console.warn(`Auth error threshold reached (${this.authErrors}/${this.maxAuthErrors}), enabling fallback mode`);
      localStorage.setItem('use_fallback_data', 'true');
      localStorage.setItem('auth_error_refresh_needed', 'true');
      this.useFallbackData = true;
      
      // Dispatch event to notify app components
      window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
    }
  }
  
  /**
   * Create and use a valid dummy token for offline/demo mode
   * Useful for fixing "Subject must be a string" errors
   */
  createValidDummyToken() {
    // Create header part
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    // Create payload with proper sub field as string
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: 'demo_user', // Must be a string
      name: 'Demo User',
      role: 'barista',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (24 * 60 * 60), // 24 hours from now
      permissions: ['manage_orders', 'view_stations']
    };
    
    // Base64 encode parts
    const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '');
    
    // Create a dummy signature
    const signature = 'valid_signature_for_offline_demo_mode';
    
    // Create and store the token
    const validToken = `${headerB64}.${payloadB64}.${signature}`;
    localStorage.setItem(this.tokenKey, validToken);
    
    // Add to other storages for compatibility
    localStorage.setItem('coffee_auth_token', validToken);
    localStorage.setItem('jwt_token', validToken);
    
    // Enable fallback mode for complete offline operation
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('auth_error_refresh_needed', 'true');
    
    // Reset error counts
    localStorage.removeItem('auth_error_count');
    this.authErrors = 0;
    
    console.log('Created and stored valid dummy token for offline/demo mode');
    return validToken;
  }
  
  /**
   * Enable demo/fallback mode with valid token
   */
  enableDemoMode() {
    // Create valid token
    this.createValidDummyToken();
    
    // Set fallback flags
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('auth_error_refresh_needed', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    console.log('Demo mode enabled with valid token and fallback data');
    
    // Dispatch event to notify app components
    window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
  }
  
  /**
   * Disable demo/fallback mode
   */
  disableDemoMode() {
    // Remove fallback flags
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('fallback_data_available');
    localStorage.removeItem('demo_mode_enabled');
    
    // Remove dummy tokens
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem('coffee_auth_token');
    localStorage.removeItem('jwt_token');
    
    // Reset error counts
    localStorage.removeItem('auth_error_count');
    this.authErrors = 0;
    
    console.log('Demo mode disabled, returning to normal operation');
    
    // Dispatch event to notify app components
    window.dispatchEvent(new CustomEvent('fallback-mode-disabled'));
  }

  /**
   * Add authorization header to existing headers object
   * @param {Object} headers - The headers object to modify
   * @returns {Object} - The modified headers object with authorization header
   */
  async addAuthorizationHeader(headers = {}) {
    // Make sure we have a valid token
    await this.handleAuthentication();
    
    const token = this.getToken();
    if (token) {
      return {
        ...headers,
        'Authorization': `Bearer ${token}`
      };
    }
    
    return headers;
  }

  /**
   * Refresh access token
   * @returns {Promise<boolean>} - True if refresh was successful
   */
  async refreshAccessToken() {
    return await this.refreshToken();
  }
}

// Export as singleton
export default new AuthService();