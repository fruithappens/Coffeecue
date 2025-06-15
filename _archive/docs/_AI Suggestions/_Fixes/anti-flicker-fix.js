// anti-flicker.js - Improved anti-flicker protection with better token handling
import authService from './auth-service';

class AntiFlickerProtection {
  constructor() {
    this.errorThreshold = 3;
    this.resetInterval = 60000; // 1 minute
    this.errorCount = 0;
    this.lastResetTime = Date.now();
    this.fallbackEnabled = localStorage.getItem('use_fallback_data') === 'true';
    
    // Initialize auth status check for token validation
    this.checkAuthStatus();
    
    // Periodically check auth status
    setInterval(() => this.checkAuthStatus(), 5 * 60 * 1000); // Check every 5 minutes
  }
  
  /**
   * Check authentication status and try to refresh token if needed
   */
  async checkAuthStatus() {
    if (this.fallbackEnabled) {
      // Already in fallback mode, no need to check auth
      return;
    }
    
    try {
      // Check if token is expired
      if (authService.isTokenExpired()) {
        console.log('Token is expired, attempting to refresh');
        const refreshed = await authService.refreshAccessToken();
        
        if (!refreshed) {
          console.warn('Token refresh failed');
          this.incrementErrorCount();
        } else {
          console.log('Token refreshed successfully');
          // Reset error count on successful refresh
          this.resetErrorCount();
        }
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      this.incrementErrorCount();
    }
  }
  
  /**
   * Reset error count
   */
  resetErrorCount() {
    this.errorCount = 0;
    this.lastResetTime = Date.now();
    console.log('Anti-flicker protection error count reset');
  }
  
  /**
   * Increment error count and enable fallback mode if threshold is reached
   */
  incrementErrorCount() {
    // Check if we should reset the counter based on time
    const now = Date.now();
    if (now - this.lastResetTime > this.resetInterval) {
      this.errorCount = 0;
      this.lastResetTime = now;
    }
    
    this.errorCount++;
    
    console.log(`Auth error count: ${this.errorCount}/${this.errorThreshold}`);
    
    if (this.errorCount >= this.errorThreshold) {
      this.enableFallbackMode();
    }
  }
  
  /**
   * Enable fallback mode
   */
  enableFallbackMode() {
    if (!this.fallbackEnabled) {
      console.log(`Auth error threshold reached (${this.errorCount}/${this.errorThreshold}), enabling fallback mode`);
      localStorage.setItem('use_fallback_data', 'true');
      this.fallbackEnabled = true;
      
      // Dispatch event to notify app components
      window.dispatchEvent(new CustomEvent('fallback-mode-enabled'));
    }
  }
  
  /**
   * Disable fallback mode
   */
  disableFallbackMode() {
    if (this.fallbackEnabled) {
      console.log('Disabling fallback mode');
      localStorage.removeItem('use_fallback_data');
      this.fallbackEnabled = false;
      this.resetErrorCount();
      
      // Dispatch event to notify app components
      window.dispatchEvent(new CustomEvent('fallback-mode-disabled'));
    }
  }
  
  /**
   * Check if we can retry using the API
   * @returns {boolean} Whether to attempt using the API
   */
  canRetryAPI() {
    // Only retry if fallback mode is enabled and sufficient time has passed
    if (!this.fallbackEnabled) {
      return true;
    }
    
    // Try to reconnect periodically (every 5 minutes)
    const now = Date.now();
    const lastRetryTime = parseInt(localStorage.getItem('last_api_retry_time') || '0');
    const retryInterval = 5 * 60 * 1000; // 5 minutes
    
    if (now - lastRetryTime > retryInterval) {
      // Update the last retry time
      localStorage.setItem('last_api_retry_time', now.toString());
      return true;
    }
    
    return false;
  }
  
  /**
   * Handle API response to determine if we should enable/disable fallback mode
   * @param {Response} response - The API response
   * @returns {boolean} Whether the response was successful
   */
  handleAPIResponse(response) {
    if (response.ok) {
      // If we're in fallback mode and get a successful response, we can try disabling it
      if (this.fallbackEnabled) {
        this.disableFallbackMode();
      }
      return true;
    } else if (response.status === 401 || response.status === 403) {
      // Auth error, increment count
      this.incrementErrorCount();
      return false;
    } else if (response.status === 422) {
      // Unprocessable entity, likely signature verification failed
      this.incrementErrorCount();
      return false;
    } else {
      // Other error, don't increment count
      return false;
    }
  }
}

// Export singleton
const antiFlickerProtection = new AntiFlickerProtection();
export default antiFlickerProtection;
