// auth-service.js - New service to centralize authentication handling
class AuthService {
  constructor() {
    this.baseUrl = 'http://localhost:5001/api';
    this.tokenKey = 'coffee_system_token';
    this.refreshTokenKey = 'coffee_system_refresh_token';
    this.tokenExpiryKey = 'coffee_system_token_expiry';
    this.debugMode = true;
    
    // Load tokens from localStorage
    this.accessToken = localStorage.getItem(this.tokenKey);
    this.refreshToken = localStorage.getItem(this.refreshTokenKey);
    this.tokenExpiry = localStorage.getItem(this.tokenExpiryKey) 
      ? new Date(localStorage.getItem(this.tokenExpiryKey)) 
      : null;
      
    // Track authentication state
    this.isRefreshing = false;
    this.failedRefreshAttempts = 0;
    this.maxRefreshAttempts = 3;
    this.listeners = [];
    
    console.log('AuthService initialized');
  }
  
  /**
   * Get the current access token
   * @returns {string|null} The current JWT token
   */
  getToken() {
    return this.accessToken;
  }
  
  /**
   * Determine if the current token is expired or about to expire
   * @param {number} bufferSeconds - Seconds before actual expiry to consider token as expired
   * @returns {boolean} Whether the token needs refresh
   */
  isTokenExpired(bufferSeconds = 300) { // 5 minute buffer
    if (!this.tokenExpiry) return true;
    
    const now = new Date();
    const bufferedExpiry = new Date(this.tokenExpiry);
    bufferedExpiry.setSeconds(bufferedExpiry.getSeconds() - bufferSeconds);
    
    return now >= bufferedExpiry;
  }
  
  /**
   * Set authentication tokens
   * @param {Object} tokens - The tokens object
   * @param {string} tokens.token - The JWT access token
   * @param {string} tokens.refreshToken - The refresh token
   * @param {number} tokens.expiresIn - Token expiry in seconds
   */
  setTokens(tokens) {
    if (!tokens) return;
    
    if (tokens.token) {
      this.accessToken = tokens.token;
      localStorage.setItem(this.tokenKey, tokens.token);
      
      // Set token expiry if provided
      if (tokens.expiresIn) {
        const expiry = new Date();
        expiry.setSeconds(expiry.getSeconds() + tokens.expiresIn);
        this.tokenExpiry = expiry;
        localStorage.setItem(this.tokenExpiryKey, expiry.toISOString());
      }
    }
    
    if (tokens.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      localStorage.setItem(this.refreshTokenKey, tokens.refreshToken);
    }
  }
  
  /**
   * Clear all authentication tokens
   */
  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    localStorage.removeItem(this.tokenExpiryKey);
  }
  
  /**
   * Refresh the access token using the refresh token
   * @returns {Promise<boolean>} Success status of token refresh
   */
  async refreshAccessToken() {
    if (this.isRefreshing) {
      return new Promise(resolve => {
        // Add listener to be notified when refresh completes
        this.listeners.push(tokenRefreshed => {
          resolve(tokenRefreshed);
        });
      });
    }
    
    if (!this.refreshToken) {
      console.warn('No refresh token available');
      return false;
    }
    
    if (this.failedRefreshAttempts >= this.maxRefreshAttempts) {
      console.warn(`Maximum refresh attempts (${this.maxRefreshAttempts}) reached`);
      return false;
    }
    
    try {
      this.isRefreshing = true;
      
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this.refreshToken
        })
      });
      
      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.token) {
        throw new Error('Invalid response from refresh endpoint');
      }
      
      // Set the new tokens
      this.setTokens(data);
      
      // Reset failed attempts counter
      this.failedRefreshAttempts = 0;
      
      // Notify all listeners
      this.listeners.forEach(listener => listener(true));
      this.listeners = [];
      
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      this.failedRefreshAttempts++;
      
      // Notify all listeners of failure
      this.listeners.forEach(listener => listener(false));
      this.listeners = [];
      
      return false;
    } finally {
      this.isRefreshing = false;
    }
  }
  
  /**
   * Add authorization headers to a request config
   * @param {Object} headers - The headers object
   * @returns {Object} Updated headers with authorization
   */
  async addAuthorizationHeader(headers = {}) {
    // Check if token needs refresh
    if (this.isTokenExpired() && this.refreshToken) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) {
        console.warn('Using potentially expired token');
      }
    }
    
    // Add authorization header if token exists
    if (this.accessToken) {
      return {
        ...headers,
        'Authorization': `Bearer ${this.accessToken}`
      };
    }
    
    return headers;
  }
  
  /**
   * Login to get authentication tokens
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<Object>} Login result
   */
  async login(username, password) {
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password
        })
      });
      
      if (!response.ok) {
        throw new Error(`Login failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.token) {
        throw new Error('Invalid response from login endpoint');
      }
      
      // Set the tokens
      this.setTokens(data);
      
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Login failed:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Verify current authentication status
   * @returns {Promise<boolean>} Authentication status
   */
  async verifyAuth() {
    try {
      // Try to use the token to verify auth status
      const headers = await this.addAuthorizationHeader({
        'Content-Type': 'application/json',
      });
      
      const response = await fetch(`${this.baseUrl}/auth/verify`, {
        headers
      });
      
      if (!response.ok) {
        // If verification fails, try to refresh token
        if (this.refreshToken) {
          const refreshed = await this.refreshAccessToken();
          return refreshed;
        }
        return false;
      }
      
      const data = await response.json();
      return data.authenticated === true;
    } catch (error) {
      console.error('Auth verification failed:', error);
      return false;
    }
  }
  
  /**
   * Logout and clear tokens
   */
  logout() {
    this.clearTokens();
  }
}

// Export as singleton
const authService = new AuthService();
export default authService;
