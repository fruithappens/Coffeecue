// services/AuthService.improved.js
import TokenService from './TokenService';
import errorHandler from '../utils/errorHandler';
import ConfigService from './ConfigService';

/**
 * Authentication Service 
 * Handles user authentication, login, logout, and token management.
 * Integrated with TokenService for JWT handling and error handling for standardized error management.
 */
class AuthService {
  constructor() {
    this.debug = process.env.NODE_ENV === 'development';
    
    // Track authentication errors for fallback mode
    this.authErrors = parseInt(localStorage.getItem('auth_error_count') || '0');
    this.maxAuthErrors = 3;
    
    // Flag for fallback/demo mode
    this.useFallbackData = localStorage.getItem('use_fallback_data') === 'true';
    
    this.log('AuthService initialized');
  }

  /**
   * Log in user with username and password
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
      
      // Save tokens using TokenService
      TokenService.saveTokens({
        token: data.token,
        refreshToken: data.refreshToken || '',
        expiresIn: data.expiresIn || 3600
      });
      
      // Save user data
      const userData = data.user || { 
        id: 'unknown',
        username,
        role: 'guest'
      };
      
      localStorage.setItem('coffee_system_user', JSON.stringify(userData));
      
      // Reset auth errors on successful login
      this.resetAuthErrors();
      
      // Disable fallback mode on successful login
      this.disableFallbackMode();
      
      // Redirect to the appropriate dashboard based on user role
      this.redirectBasedOnRole(userData.role);
      
      return {
        token: data.token,
        refreshToken: data.refreshToken,
        user: userData,
        expiresIn: data.expiresIn || 3600
      };
    } catch (error) {
      // Handle error with standardized error handler
      errorHandler.handleError(error, 'AuthService.login', {
        notifyUser: true
      });
      throw error;
    }
  }

  /**
   * Log out user
   */
  logout() {
    try {
      // First get current path to potentially redirect back after login
      const currentPath = window.location.pathname;
      const redirectParam = currentPath && currentPath !== '/' && currentPath !== '/login' 
        ? `?redirect=${encodeURIComponent(currentPath)}` 
        : '';
        
      // Clear all tokens using TokenService
      TokenService.clearTokens();
      
      // Clear user data
      localStorage.removeItem('coffee_system_user');
      
      // Call logout endpoint to invalidate token on server
      const token = TokenService.getToken();
      if (token) {
        fetch(ConfigService.getApiUrl('auth/logout'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          mode: 'cors'
        }).catch(err => {
          // Silent catch - we're logging out anyway
          this.log('Logout request error:', err);
        });
      }
      
      // Create a custom event for logout to notify other components
      window.dispatchEvent(new Event('user_logged_out'));
      
      // Redirect to login page with redirect parameter if appropriate
      window.location.href = `/login${redirectParam}`;
    } catch (error) {
      // Use error handler but don't rethrow - logout should always succeed
      errorHandler.handleError(error, 'AuthService.logout');
      
      // Force redirect to login even if there was an error
      window.location.href = '/login';
    }
  }

  /**
   * Reset authentication errors counter
   */
  resetAuthErrors() {
    this.authErrors = 0;
    localStorage.removeItem('auth_error_count');
    localStorage.removeItem('auth_error_refresh_needed');
  }

  /**
   * Track authentication errors
   */
  incrementAuthError() {
    this.authErrors++;
    
    // Store error count in localStorage for persistence across page refreshes
    localStorage.setItem('auth_error_count', this.authErrors.toString());
    
    this.log(`Auth error count: ${this.authErrors}/${this.maxAuthErrors}`);
    
    // If we've hit the threshold, enable fallback mode
    if (this.authErrors >= this.maxAuthErrors) {
      this.log(`Auth error threshold reached (${this.authErrors}/${this.maxAuthErrors}), enabling fallback mode`);
      localStorage.setItem('auth_error_refresh_needed', 'true');
      this.enableFallbackMode();
    }
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
    // First try to get user from TokenService which extracts from JWT
    const tokenUser = TokenService.getUserFromToken();
    if (tokenUser) return tokenUser;
    
    // Fallback to stored user data
    const userStr = localStorage.getItem('coffee_system_user');
    if (!userStr) return null;
    
    try {
      return JSON.parse(userStr);
    } catch (error) {
      errorHandler.handleError(error, 'AuthService.getCurrentUser');
      return null;
    }
  }

  /**
   * Check if user is logged in
   * @returns {boolean} - True if logged in
   */
  isLoggedIn() {
    return TokenService.hasValidToken();
  }

  /**
   * Check if user has specific role
   * @param {string|Array} roles - Role(s) to check
   * @returns {boolean} - True if user has role
   */
  hasRole(roles) {
    return TokenService.hasRole(roles);
  }

  /**
   * Check if token is expired
   * @param {number} bufferSeconds - Seconds before expiry to consider token expired
   * @returns {boolean} - True if token is expired
   */
  isTokenExpired(bufferSeconds = 300) {
    return TokenService.isTokenExpired(bufferSeconds);
  }

  /**
   * Handle authentication - check token and refresh if needed
   * @returns {Promise<boolean>} - True if authenticated
   */
  async handleAuthentication() {
    if (!this.isLoggedIn()) {
      return false;
    }
    
    // Check if token is expiring soon (within 5 minutes)
    if (this.isTokenExpired(300)) {
      return await this.refreshToken();
    }
    
    return true;
  }

  /**
   * Refresh access token
   * @returns {Promise<boolean>} - True if refresh successful
   */
  async refreshToken() {
    const refreshToken = TokenService.getRefreshToken();
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
      
      // Save new tokens using TokenService
      TokenService.saveTokens({
        token: data.token,
        refreshToken: data.refreshToken || refreshToken,
        expiresIn: data.expiresIn || 3600
      });
      
      // Reset auth error count on successful refresh
      this.resetAuthErrors();
      
      this.log('Token refreshed successfully');
      return true;
    } catch (error) {
      errorHandler.handleError(error, 'AuthService.refreshToken');
      this.incrementAuthError();
      return false;
    }
  }

  /**
   * Add authorization header to existing headers object
   * @param {Object} headers - The headers object to modify
   * @returns {Promise<Object>} - The modified headers object with authorization header
   */
  async addAuthorizationHeader(headers = {}) {
    // Make sure we have a valid token
    await this.handleAuthentication();
    
    const token = TokenService.getToken();
    if (token) {
      return {
        ...headers,
        'Authorization': `Bearer ${token}`
      };
    }
    
    return headers;
  }

  /**
   * Enable fallback/demo mode
   */
  enableFallbackMode() {
    // Create valid token for fallback mode
    this.createValidDummyToken();
    
    // Set fallback flags
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('fallback_data_available', 'true');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    this.useFallbackData = true;
    
    this.log('Fallback mode enabled');
    
    // Dispatch event to notify app components
    window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
  }

  /**
   * Disable fallback/demo mode
   */
  disableFallbackMode() {
    // Remove fallback flags
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('auth_error_refresh_needed');
    localStorage.removeItem('fallback_data_available');
    localStorage.removeItem('demo_mode_enabled');
    
    this.useFallbackData = false;
    
    this.log('Fallback mode disabled, returning to normal operation');
    
    // Dispatch event to notify app components
    window.dispatchEvent(new CustomEvent('fallback-mode-disabled'));
  }

  /**
   * Create a valid dummy token for fallback/demo mode
   * @returns {string} - Created token
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
    
    // Create token
    const validToken = `${headerB64}.${payloadB64}.${signature}`;
    
    // Save token using TokenService
    TokenService.saveTokens({
      token: validToken,
      refreshToken: 'demo_refresh_token',
      expiresIn: 86400 // 24 hours
    });
    
    // Add to other storages for compatibility with legacy code
    localStorage.setItem('coffee_auth_token', validToken);
    localStorage.setItem('jwt_token', validToken);
    
    // Reset error counts
    this.resetAuthErrors();
    
    this.log('Created and stored valid dummy token for offline/demo mode');
    return validToken;
  }

  /**
   * Check if fallback mode is active
   * @returns {boolean} - True if fallback mode is active
   */
  isFallbackModeActive() {
    return this.useFallbackData || localStorage.getItem('use_fallback_data') === 'true';
  }

  /**
   * Log messages if debug mode is enabled
   * @param  {...any} args - Message parts
   */
  log(...args) {
    if (this.debug) {
      console.log('[AuthService]', ...args);
    }
  }
}

// Export as singleton
export default new AuthService();