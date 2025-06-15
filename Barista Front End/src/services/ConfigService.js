// services/ConfigService.js
class ConfigService {
  constructor() {
    // Try to load configuration from localStorage first (for persistence)
    this.loadConfig();
    
    // Set defaults if not configured
    // Environment-based API URL configuration
    const getApiBaseUrl = () => {
      // Check for explicit environment variable first
      if (process.env.REACT_APP_API_URL) {
        return process.env.REACT_APP_API_URL;
      }
      
      // In production, use relative URLs (same domain)
      if (process.env.NODE_ENV === 'production') {
        return '/api';
      }
      
      // In development, use localhost
      return 'http://localhost:5001/api';
    };
    
    this.config = {
      apiBaseUrl: getApiBaseUrl(),
      defaultWaitTime: 15,
      notificationTimeout: 30,
      ...this.config
    };
    
    console.log('ConfigService initialized with base URL:', this.config.apiBaseUrl);
  }
  
  loadConfig() {
    try {
      const savedConfig = localStorage.getItem('coffee_system_config');
      this.config = savedConfig ? JSON.parse(savedConfig) : {};
    } catch (err) {
      console.error('Failed to load configuration:', err);
      this.config = {};
    }
  }
  
  saveConfig() {
    try {
      localStorage.setItem('coffee_system_config', JSON.stringify(this.config));
    } catch (err) {
      console.error('Failed to save configuration:', err);
    }
  }
  
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }
  
  set(key, value) {
    this.config[key] = value;
    this.saveConfig();
    return value;
  }
  
  getApiUrl(endpoint = '') {
    // Clean the endpoint to avoid double slashes
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    return `${this.config.apiBaseUrl}/${cleanEndpoint}`;
  }
}

// Export as singleton
export default new ConfigService();