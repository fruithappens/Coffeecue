// services/SettingsService.js
import ApiService from './ApiService';

/**
 * Service for system settings management
 * Extends ApiService to inherit authentication and API functionality
 */
class SettingsService {
  constructor() {
    // Get ApiService singleton instance instead of extending
    this.apiService = new ApiService();
    // Environment-aware backend URL
    this.baseUrl = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5001/api';
    this.debugMode = true;
    this.enableFallback = true; // Enable fallback to prevent endless retries
    this.settingsCache = null;
    this.cacheTime = 0;
    this.cacheLifetime = 5 * 60 * 1000; // 5 minutes
    this.lastJwtError = 0; // Timestamp for last JWT error
    this.jwtErrorDebounce = 60 * 1000; // 60 seconds debounce for JWT errors
    
    // Initialize token from localStorage if available
    this.token = localStorage.getItem('coffee_system_token') || null;
    
    // Set default settings in memory
    this._setDefaultSettings();
    
    console.log('SettingsService initialized with direct backend URL:', this.baseUrl);
    
    if (this.token) {
      console.log('Token found in localStorage during SettingsService initialization');
    } else {
      console.warn('No token found in localStorage during SettingsService initialization');
    }
  }
  
  /**
   * Get branding settings
   * @returns {Promise<object>} - Branding settings
   */
  async getBrandingSettings() {
    try {
      // Try to get from localStorage first
      const cached = localStorage.getItem('coffee_system_branding');
      if (cached) {
        return JSON.parse(cached);
      }
      
      // Otherwise get from API
      const response = await this.directFetch('/settings/branding', {
        method: 'GET'
      });
      
      if (response.success && response.settings) {
        // Cache in localStorage
        localStorage.setItem('coffee_system_branding', JSON.stringify(response.settings));
        return response.settings;
      }
      
      return null;
    } catch (error) {
      console.error('Error getting branding settings:', error);
      // Return default branding settings
      return {
        systemName: 'CoffeeCue',
        customBranding: false,
        clientName: '',
        primaryColor: '#1e40af',
        secondaryColor: '#f59e0b',
        textColor: '#1f2937',
        backgroundColor: '#f9fafb',
        defaultLanguage: 'en',
        availableLanguages: ['en']
      };
    }
  }
  
  /**
   * Update branding settings
   * @param {object} settings - Branding settings to update
   * @returns {Promise<boolean>} - Success status
   */
  async updateBrandingSettings(settings) {
    try {
      // Save to localStorage immediately for instant UI updates
      localStorage.setItem('coffee_system_branding', JSON.stringify(settings));
      
      // Then try to save to API
      const response = await this.directFetch('/settings/branding', {
        method: 'PUT',
        body: JSON.stringify({ settings })
      });
      
      return response.success || false;
    } catch (error) {
      console.error('Error updating branding settings:', error);
      // Still return true since we saved to localStorage
      return true;
    }
  }
  
  /**
   * Custom fetch with authentication using direct URL approach
   * @param {string} endpoint - API endpoint
   * @param {object} options - Request options
   * @returns {Promise<any>} - API response
   */
  async directFetch(endpoint, options = {}) {
    try {
      // Extract the endpoint path regardless of format
      let apiPath;
      
      // Check if it's a complete URL
      if (endpoint.startsWith('http')) {
        // Extract path from URL
        const url = new URL(endpoint);
        apiPath = url.pathname;
        
        // Further extract after /api/ if present
        if (apiPath.includes('/api/')) {
          apiPath = apiPath.substring(apiPath.indexOf('/api/') + 4);
        }
      } else {
        // Handle relative paths
        if (endpoint.includes('/api/')) {
          // Extract everything after /api/
          apiPath = endpoint.substring(endpoint.indexOf('/api/') + 4);
        } else {
          // Remove leading slash if present
          apiPath = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
        }
      }
      
      // Construct direct URL - this ensures we use the absolute backend URL
      const directUrl = `${this.baseUrl}/${apiPath}`;
      console.log(`Using direct URL strategy: ${directUrl}`);
      
      // Check if token exists in localStorage but not in memory
      if (!this.token) {
        const storedToken = localStorage.getItem('coffee_system_token') || 
                           localStorage.getItem('coffee_auth_token') || 
                           localStorage.getItem('jwt_token') || null;
        if (storedToken) {
          console.log('Found token in localStorage but not in memory, using it for request');
          this.token = storedToken;
        }
      }
      
      // Set headers
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers || {})
      };
      
      if (this.debugMode) {
        console.log(`Authorization header ${this.token ? 'set' : 'NOT set'} for request to ${directUrl}`);
        if (this.token) {
          console.log(`Token length: ${this.token.length}, Token prefix: ${this.token.substring(0, 10)}...`);
        }
        
        console.log(`Fetching from: ${directUrl} with method: ${options.method || 'GET'}`);
        if (options.body) {
          console.log(`Request body: ${options.body}`);
        }
      }
      
      // Make the request
      const response = await fetch(directUrl, {
        ...options,
        headers,
        mode: 'cors',
        // Don't include credentials to avoid CORS issues with wildcard origin
        credentials: 'same-origin'
      });
      
      if (!response.ok) {
        // Try to get error details from response
        let errorDetails = {};
        try {
          errorDetails = await response.json();
        } catch (e) {
          try {
            errorDetails = { message: await response.text() };
          } catch (e2) {
            errorDetails = { message: `HTTP error: ${response.status} ${response.statusText}` };
          }
        }
        
        console.error(`API error: ${response.status}`, errorDetails);
        throw new Error(errorDetails.message || `API error: ${response.status}`);
      }
      
      const data = await response.json();
      if (this.debugMode) {
        console.log(`Response from ${directUrl}:`, data);
      }
      return data;
    } catch (error) {
      console.error(`Error fetching from ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Set default settings in memory to prevent repeated failures
   * @private
   */
  _setDefaultSettings() {
    // Initialize default settings
    const defaultSettings = {
      displayMode: 'landscape',
      soundEnabled: true,
      autoPrintLabels: false,
      batchSuggestions: true,
      waitTimeWarning: 10, // minutes
      displayTimeout: 5, // minutes
      autoSendSmsOnComplete: true,
      remindAfterDelay: true,
      reminderDelay: 30, // seconds
      showNameOnDisplay: true,
      // Display screen settings
      displaySettings: {
        eventName: 'ANZCA ASM 2025',
        organizationName: 'Australian and New Zealand College of Anaesthetists',
        headerColor: '#1e40af', // blue-800
        customMessage: 'Enjoy your coffee!',
        smsNumber: '+61 123 456 789',
        showSponsor: false,
        sponsorName: '',
        sponsorMessage: ''
      },
      // Station-specific settings (standardized structure)
      stationSettings: {
        // Structure: { [stationId]: { name: string, location: string } }
      },
      baristaSettings: {
        // Structure: { [stationId]: string } - barista name per station
      },
      // Milk color settings
      milkColors: {
        // Standard Milks
        "Full Cream Milk": "#FFFFFF",  // White/Cream
        "Skim Milk": "#ADD8E6",  // Light Blue
        "Reduced Fat Milk": "#D3D3D3",  // Light Gray
        "Lactose-Free Milk": "#FAFAFA",  // White with special border
        
        // Alternative Milks
        "Soy Milk": "#FFFACD",  // Yellow
        "Oat Milk": "#FFCCCB",  // Light Red
        "Almond Milk": "#EADDCA",  // Light Blue-Brown
        "Coconut Milk": "#D0F0C0",  // Light Green
        "Macadamia Milk": "#D2B48C",  // Soft Brown
        "Rice Milk": "#E6E6FA"   // Light Purple
      }
    };
    
    // Set as initial cache
    this.settingsCache = defaultSettings;
    this.cacheTime = Date.now();
  }

  /**
   * Get all system settings
   * @param {boolean} forceRefresh - Force refresh from server instead of using cache
   * @returns {Promise<Object>} - System settings
   */
  async getSettings(forceRefresh = false) {
    try {
      // Use cache if available and not expired
      const now = Date.now();
      if (!forceRefresh && this.settingsCache && (now - this.cacheTime) < this.cacheLifetime) {
        return this.settingsCache;
      }
      
      // Check if we've recently had a JWT error to avoid constant retries
      const timeSinceLastJwtError = now - this.lastJwtError;
      if (timeSinceLastJwtError < this.jwtErrorDebounce) {
        console.log(`Skipping API call due to recent JWT error (${Math.round(timeSinceLastJwtError/1000)}s ago)`);
        return this.settingsCache; // Return cached settings instead of making API call
      }

      let response;

      // Use direct URL approach first
      const directUrl = `${this.baseUrl}/settings`;
      console.log(`Using direct URL for settings: ${directUrl}`);
      
      try {
        // Try direct URL approach
        response = await this.directFetch('settings', {
          method: 'GET'
        });
        
        console.log('✅ Got response from direct URL:', response);
      } catch (directError) {
        console.error('Direct URL approach failed:', directError);
        
        // Check for JWT error
        if (directError.message && directError.message.includes('Signature verification')) {
          console.warn('JWT token error detected, using cached settings to prevent flickering');
          this.lastJwtError = now; // Record the time of this JWT error
          return this.settingsCache; // Return cached settings instead of retrying
        }
        
        // Fall back to the inherited method
        try {
          console.log('Falling back to inherited method');
          response = await this.get('/settings');
        } catch (fallbackError) {
          console.error('Fallback method failed:', fallbackError);
          
          // Check for JWT error in fallback also
          if (fallbackError.message && fallbackError.message.includes('Signature verification')) {
            console.warn('JWT token error detected in fallback, using cached settings');
            this.lastJwtError = now; // Record the time of this JWT error
            return this.settingsCache;
          }
          
          // Return cached settings instead of throwing
          console.warn('Using cached settings due to API failure');
          return this.settingsCache;
        }
      }

      if (!response) {
        console.warn('No response received from server, using cached settings');
        return this.settingsCache;
      }

      // Merge API response with localStorage settings for persistence (deep merge)
      const localStorageSettings = this.loadSettingsFromLocalStorage();
      const mergedSettings = this.deepMergeSettings(response, localStorageSettings);
      
      // Update cache
      this.settingsCache = mergedSettings;
      this.cacheTime = now;

      console.log('🔄 Merged API settings with localStorage settings');
      return mergedSettings;
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      // Return cached settings instead of creating new default settings
      return this.settingsCache;
    }
  }

  /**
   * Update a specific setting
   * @param {string} key - Setting key
   * @param {any} value - Setting value
   * @returns {Promise<Object>} - Updated settings
   */
  async updateSetting(key, value) {
    try {
      // Update cache first for responsive UI
      if (this.settingsCache) {
        this.settingsCache = {
          ...this.settingsCache,
          [key]: value
        };
      }
      
      // Check if we've recently had a JWT error to avoid constant retries
      const now = Date.now();
      const timeSinceLastJwtError = now - this.lastJwtError;
      if (timeSinceLastJwtError < this.jwtErrorDebounce) {
        console.log(`Skipping API call due to recent JWT error (${Math.round(timeSinceLastJwtError/1000)}s ago)`);
        return { [key]: value }; // Return simple object showing the update was applied locally
      }
      
      try {
        // Use individual setting endpoint approach
        const response = await this.directFetch(`settings/${key}`, {
          method: 'POST',
          body: JSON.stringify({ value: value })
        });
        
        if (response && response.success) {
          // Save successful server update to localStorage for persistence
          this.saveSettingToLocalStorage(key, value);
          return response.settings || { [key]: value };
        }
        
        // Server update failed, but save to localStorage for persistence
        console.warn(`Server update failed for ${key}, saving to localStorage for persistence`);
        this.saveSettingToLocalStorage(key, value);
        return { [key]: value };
      } catch (error) {
        // Check for JWT error
        if (error.message && error.message.includes('Signature verification')) {
          console.warn('JWT token error detected during setting update, cached value will be used');
          this.lastJwtError = now; // Record the time of this JWT error
          this.saveSettingToLocalStorage(key, value); // Save to localStorage for persistence
          return { [key]: value }; // Return simple success since we updated the cache
        }
        
        console.error(`API call failed for setting ${key}, saving to localStorage:`, error);
        this.saveSettingToLocalStorage(key, value); // Save to localStorage for persistence
        return { [key]: value }; // Return success anyway since cache is updated
      }
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      // Save to localStorage even if everything fails
      this.saveSettingToLocalStorage(key, value);
      return { [key]: value, warning: 'Cached only' };
    }
  }

  /**
   * Save individual setting to localStorage for persistence
   * @private
   */
  saveSettingToLocalStorage(key, value) {
    try {
      const existingSettings = JSON.parse(localStorage.getItem('coffee_cue_settings') || '{}');
      existingSettings[key] = value;
      localStorage.setItem('coffee_cue_settings', JSON.stringify(existingSettings));
      console.log(`💾 Saved setting ${key}=${value} to localStorage`);
    } catch (error) {
      console.error('Failed to save setting to localStorage:', error);
    }
  }

  /**
   * Load settings from localStorage to merge with defaults/API data
   * @private
   */
  loadSettingsFromLocalStorage() {
    try {
      const savedSettings = localStorage.getItem('coffee_cue_settings');
      if (savedSettings) {
        return JSON.parse(savedSettings);
      }
    } catch (error) {
      console.error('Failed to load settings from localStorage:', error);
    }
    return {};
  }

  /**
   * Deep merge settings objects, with localStorage taking precedence
   * @private
   */
  deepMergeSettings(apiSettings, localStorageSettings) {
    const merged = { ...apiSettings };
    
    for (const key in localStorageSettings) {
      if (Object.prototype.hasOwnProperty.call(localStorageSettings, key)) {
        const localValue = localStorageSettings[key];
        const apiValue = merged[key];
        
        // If both values are objects (but not arrays), merge them recursively
        if (
          localValue && 
          typeof localValue === 'object' && 
          !Array.isArray(localValue) &&
          apiValue && 
          typeof apiValue === 'object' && 
          !Array.isArray(apiValue)
        ) {
          merged[key] = {
            ...apiValue,
            ...localValue // localStorage takes precedence in nested objects too
          };
        } else {
          // For primitive values, localStorage takes precedence
          merged[key] = localValue;
        }
      }
    }
    
    console.log('🔀 Deep merged settings - localStorage overrides:', Object.keys(localStorageSettings));
    return merged;
  }

  /**
   * Update multiple settings at once
   * @param {Object} settings - Settings to update
   * @returns {Promise<Object>} - Updated settings
   */
  async updateSettings(settings) {
    try {
      // Update local storage immediately
      const currentSettings = JSON.parse(localStorage.getItem('coffee_system_settings') || '{}');
      const updatedSettings = {
        ...currentSettings,
        ...settings
      };
      localStorage.setItem('coffee_system_settings', JSON.stringify(updatedSettings));
      
      // Update cache
      if (this.settingsCache) {
        this.settingsCache = {
          ...this.settingsCache,
          ...settings
        };
      }
      
      // Try to sync with backend (but don't fail if it doesn't work)
      try {
        const response = await this.directFetch('settings', {
          method: 'PUT',
          body: JSON.stringify(settings)
        });
        
        if (response && response.success) {
          return response.settings || updatedSettings;
        }
      } catch (apiError) {
        console.warn('Failed to sync settings with backend, but saved locally:', apiError);
      }
      
      return updatedSettings;
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  /**
   * Reset settings to default values
   * @returns {Promise<Object>} - Default settings
   */
  async resetSettings() {
    try {
      // Use direct URL approach
      const response = await this.directFetch('settings/reset', {
        method: 'POST'
      });
      
      if (response && response.success) {
        // Update cache if successful
        this.settingsCache = response.settings;
        this.cacheTime = Date.now();
        
        return response.settings;
      }
      
      throw new Error(response?.error || 'Failed to reset settings');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      throw error;
    }
  }

  /**
   * Get specific setting by key
   * @param {string} key - Setting key
   * @returns {Promise<any>} - Setting value
   */
  async getSetting(key) {
    try {
      // Try to get from cache first
      if (this.settingsCache && this.settingsCache[key] !== undefined) {
        return this.settingsCache[key];
      }
      
      // If not in cache or cache expired, fetch all settings
      const settings = await this.getSettings();
      return settings[key];
    } catch (error) {
      console.error(`Failed to get setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Update wait time settings
   * @param {number} waitTime - New wait time in minutes
   * @returns {Promise<Object>} - Response with success status
   */
  async updateWaitTime(waitTime) {
    try {
      // Use direct URL approach
      const response = await this.directFetch('settings/wait-time', {
        method: 'POST',
        body: JSON.stringify({ waitTime })
      });
      
      if (response && response.success) {
        // Update cache if successful
        if (this.settingsCache) {
          this.settingsCache.defaultWaitTime = waitTime;
        }
        
        return response;
      }
      
      throw new Error(response?.error || 'Failed to update wait time');
    } catch (error) {
      console.error('Failed to update wait time:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new SettingsService();