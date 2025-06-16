// services/TokenRefreshService.js
/**
 * Service to handle automatic token refresh
 */
class TokenRefreshService {
  constructor() {
    this.refreshTimer = null;
    this.refreshThreshold = 5 * 60 * 1000; // Refresh 5 minutes before expiry
  }

  /**
   * Start automatic token refresh
   */
  startAutoRefresh() {
    this.stopAutoRefresh(); // Clear any existing timer
    
    const token = localStorage.getItem('token');
    const expiresIn = localStorage.getItem('tokenExpiresIn');
    
    if (!token || !expiresIn) {
      console.log('No token to refresh');
      return;
    }
    
    // Calculate when to refresh (5 minutes before expiry)
    const expiresInMs = parseInt(expiresIn) * 1000;
    const refreshIn = Math.max(expiresInMs - this.refreshThreshold, 10000); // At least 10 seconds
    
    console.log(`Token refresh scheduled in ${refreshIn / 1000} seconds`);
    
    this.refreshTimer = setTimeout(async () => {
      await this.refreshToken();
    }, refreshIn);
  }

  /**
   * Stop automatic token refresh
   */
  stopAutoRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Refresh the JWT token
   */
  async refreshToken() {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      
      if (!refreshToken) {
        console.error('No refresh token available');
        this.handleTokenExpired();
        return false;
      }
      
      const response = await fetch('http://localhost:5001/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${refreshToken}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.token) {
          // Update tokens in localStorage
          localStorage.setItem('token', data.token);
          localStorage.setItem('tokenExpiresIn', data.expiresIn || '3600');
          
          console.log('Token refreshed successfully');
          
          // Notify other services about new token
          window.dispatchEvent(new CustomEvent('tokenRefreshed', {
            detail: { token: data.token }
          }));
          
          // Schedule next refresh
          this.startAutoRefresh();
          
          return true;
        }
      } else if (response.status === 401) {
        console.error('Refresh token invalid or expired');
        this.handleTokenExpired();
        return false;
      }
      
      console.error('Token refresh failed:', response.status);
      return false;
      
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  }

  /**
   * Handle token expiration
   */
  handleTokenExpired() {
    console.log('Token expired - user needs to login again');
    
    // Clear auth data
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tokenExpiresIn');
    localStorage.removeItem('user');
    
    // Notify app about logout
    window.dispatchEvent(new CustomEvent('tokenExpired'));
    
    // Redirect to login
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  /**
   * Check if token is expired or about to expire
   */
  isTokenExpiringSoon() {
    const token = localStorage.getItem('token');
    if (!token) return true;
    
    try {
      // Decode JWT to check expiration
      const payload = JSON.parse(atob(token.split('.')[1]));
      const expiresAt = payload.exp * 1000; // Convert to milliseconds
      const now = Date.now();
      const timeUntilExpiry = expiresAt - now;
      
      // Consider it expiring if less than 5 minutes left
      return timeUntilExpiry < this.refreshThreshold;
    } catch (error) {
      console.error('Error checking token expiration:', error);
      return true;
    }
  }
}

// Export singleton instance
const tokenRefreshService = new TokenRefreshService();
export default tokenRefreshService;