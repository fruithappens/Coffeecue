// services/ConfigService.improved.js
import baseConfig from '../config/config';
import errorHandler from '../utils/errorHandler';

/**
 * Improved ConfigService
 * 
 * Centralized configuration management service.
 * Handles loading/saving config, providing environment-specific settings,
 * and runtime configuration changes.
 */
class ConfigService {
  constructor() {
    // Initialize with base configuration
    this.baseConfig = baseConfig;
    
    // Initialize runtime configuration (can be changed during runtime)
    this.runtimeConfig = {};
    
    // Load saved configuration from localStorage
    this.loadConfig();
    
    // Debug mode depends on environment
    this.debug = this.get('api.debug', process.env.NODE_ENV === 'development');
    
    this.log('ConfigService initialized');
  }
  
  /**
   * Load saved configuration from localStorage
   * @private
   */
  loadConfig() {
    try {
      const storageKey = this.baseConfig.storage.appConfig;
      const savedConfig = localStorage.getItem(storageKey);
      
      this.runtimeConfig = savedConfig ? JSON.parse(savedConfig) : {};
      this.log('Configuration loaded from localStorage');
    } catch (error) {
      errorHandler.handleError(error, 'ConfigService.loadConfig');
      this.runtimeConfig = {};
    }
  }
  
  /**
   * Save current runtime configuration to localStorage
   * @private
   */
  saveConfig() {
    try {
      const storageKey = this.baseConfig.storage.appConfig;
      localStorage.setItem(storageKey, JSON.stringify(this.runtimeConfig));
      this.log('Configuration saved to localStorage');
    } catch (error) {
      errorHandler.handleError(error, 'ConfigService.saveConfig');
    }
  }
  
  /**
   * Get a configuration value by key path
   * @param {string} keyPath - Dot-notation path to the config value
   * @param {any} defaultValue - Default value if not found
   * @returns {any} - The config value or default value
   */
  get(keyPath, defaultValue = null) {
    try {
      // Try to get from runtime config first
      const runtimeValue = this._getValueByPath(this.runtimeConfig, keyPath);
      
      if (runtimeValue !== undefined) {
        return runtimeValue;
      }
      
      // If not in runtime config, get from base config
      const baseValue = this._getValueByPath(this.baseConfig, keyPath);
      
      return baseValue !== undefined ? baseValue : defaultValue;
    } catch (error) {
      this.log('Error getting config value:', error);
      return defaultValue;
    }
  }
  
  /**
   * Set a configuration value by key path
   * @param {string} keyPath - Dot-notation path to the config value
   * @param {any} value - New value to set
   * @returns {boolean} - True if value was set successfully
   */
  set(keyPath, value) {
    try {
      this._setValueByPath(this.runtimeConfig, keyPath, value);
      this.saveConfig();
      return true;
    } catch (error) {
      errorHandler.handleError(error, 'ConfigService.set');
      return false;
    }
  }
  
  /**
   * Reset a configuration value to its default (removing runtime override)
   * @param {string} keyPath - Dot-notation path to the config value
   * @returns {boolean} - True if reset successfully
   */
  reset(keyPath) {
    try {
      this._removeValueByPath(this.runtimeConfig, keyPath);
      this.saveConfig();
      return true;
    } catch (error) {
      errorHandler.handleError(error, 'ConfigService.reset');
      return false;
    }
  }
  
  /**
   * Get API URL with optional endpoint
   * @param {string} endpoint - API endpoint to append to base URL
   * @returns {string} - Full API URL
   */
  getApiUrl(endpoint = '') {
    const baseUrl = this.get('api.baseUrl');
    
    // Clean the endpoint to avoid double slashes
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
    
    // Handle empty endpoint (just return base URL)
    if (!cleanEndpoint) {
      return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }
    
    // Construct full URL
    return `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/${cleanEndpoint}`;
  }
  
  /**
   * Get a section of the configuration
   * @param {string} section - Section name (e.g., 'api', 'auth')
   * @returns {Object} - Configuration section
   */
  getSection(section) {
    const baseSection = this.baseConfig[section] || {};
    const runtimeSection = this.runtimeConfig[section] || {};
    
    // Merge base and runtime sections
    return { ...baseSection, ...runtimeSection };
  }
  
  /**
   * Save multiple configuration values at once
   * @param {Object} configValues - Object with keyPath:value pairs
   * @returns {boolean} - True if all values were set successfully
   */
  setMultiple(configValues) {
    try {
      for (const [keyPath, value] of Object.entries(configValues)) {
        this._setValueByPath(this.runtimeConfig, keyPath, value);
      }
      
      this.saveConfig();
      return true;
    } catch (error) {
      errorHandler.handleError(error, 'ConfigService.setMultiple');
      return false;
    }
  }
  
  /**
   * Check if running in development mode
   * @returns {boolean} - True if in development mode
   */
  isDevelopment() {
    return process.env.NODE_ENV === 'development';
  }
  
  /**
   * Check if running in production mode
   * @returns {boolean} - True if in production mode
   */
  isProduction() {
    return process.env.NODE_ENV === 'production';
  }
  
  /**
   * Check if fallback mode is enabled
   * @returns {boolean} - True if fallback mode is enabled
   */
  isFallbackEnabled() {
    return this.get('api.fallbackEnabled', false) || 
           localStorage.getItem(this.get('storage.fallbackEnabled')) === 'true';
  }
  
  /**
   * Get a value from an object by dot-notation path
   * @param {Object} obj - Object to get value from
   * @param {string} path - Dot-notation path
   * @returns {any} - Value at the path or undefined
   * @private
   */
  _getValueByPath(obj, path) {
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined;
      }
      
      current = current[part];
    }
    
    return current;
  }
  
  /**
   * Set a value in an object by dot-notation path
   * @param {Object} obj - Object to set value in
   * @param {string} path - Dot-notation path
   * @param {any} value - Value to set
   * @private
   */
  _setValueByPath(obj, path, value) {
    const parts = path.split('.');
    const lastPart = parts.pop();
    let current = obj;
    
    for (const part of parts) {
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      }
      
      current = current[part];
    }
    
    current[lastPart] = value;
  }
  
  /**
   * Remove a value from an object by dot-notation path
   * @param {Object} obj - Object to remove value from
   * @param {string} path - Dot-notation path
   * @private
   */
  _removeValueByPath(obj, path) {
    const parts = path.split('.');
    const lastPart = parts.pop();
    let current = obj;
    
    for (const part of parts) {
      if (current[part] === undefined || current[part] === null) {
        return; // Nothing to remove
      }
      
      current = current[part];
    }
    
    delete current[lastPart];
  }
  
  /**
   * Log messages if debug mode is enabled
   * @param  {...any} args - Message parts
   */
  log(...args) {
    if (this.debug) {
      console.log('[ConfigService]', ...args);
    }
  }
}

// Export as singleton
export default new ConfigService();