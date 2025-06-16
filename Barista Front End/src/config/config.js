/**
 * Central configuration for the Expresso application
 * All environment-specific values and configurations should go here
 */

const config = {
  // API configuration
  api: {
    // Base URL for API calls
    baseUrl: process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:5001/api'),
    
    // Timeout for API requests in milliseconds
    timeout: 15000,
    
    // Enable debug logging for API calls
    debug: process.env.NODE_ENV === 'development',
    
    // Enable retries for failed API requests
    retryAttempts: 3,
    
    // Enable fallback mode for API requests
    fallbackEnabled: true
  },
  
  // Authentication configuration
  auth: {
    // Storage keys for tokens and user data
    tokenKey: 'coffee_system_token',
    refreshTokenKey: 'coffee_system_refresh_token',
    userKey: 'coffee_system_user',
    tokenExpiryKey: 'coffee_system_token_expiry',
    
    // Refresh token before it expires (in seconds)
    refreshBeforeExpiry: 300, // 5 minutes
    
    // Maximum auth errors before fallback
    maxAuthErrors: 3,
    
    // Default token TTL in seconds
    tokenTTL: 3600, // 1 hour
    
    // Default refresh token TTL in seconds
    refreshTokenTTL: 604800 // 7 days
  },
  
  // App mode configuration
  appModes: {
    PRODUCTION: 'production',
    DEMO: 'demo',
    DEVELOPMENT: 'development',
    TEST: 'test'
  },
  
  // Fallback mode configuration
  fallback: {
    // Enable fallback mode when API is unavailable
    enabled: process.env.REACT_APP_FALLBACK_ENABLED === 'true',
    
    // Storage keys for fallback data and state
    dataKey: 'fallback_data_available',
    modeKey: 'use_fallback_data',
    
    // Automatically enable fallback after maxFailures consecutive failures
    autoEnable: true,
    maxFailures: 3,
  },
  
  // Storage keys for app state
  storage: {
    appMode: 'app_mode',
    fallbackEnabled: 'use_fallback_data',
    fallbackAvailable: 'fallback_data_available',
    demoModeEnabled: 'demo_mode_enabled',
    authErrorCount: 'auth_error_count',
    authErrorRefreshNeeded: 'auth_error_refresh_needed',
    jwtErrorEndpoints: 'jwt_error_endpoints',
    appConfig: 'coffee_system_config'
  },
  
  // Station default settings
  stations: {
    // Default wait time in minutes
    defaultWaitTime: 15,
    
    // Milk types available across the system
    milkTypes: [
      { id: 'regular', name: 'Regular milk', category: 'dairy', properties: { dairyFree: false } },
      { id: 'skim', name: 'Skim milk', category: 'dairy', properties: { dairyFree: false } },
      { id: 'soy', name: 'Soy milk', category: 'alternative', properties: { dairyFree: true } },
      { id: 'almond', name: 'Almond milk', category: 'alternative', properties: { dairyFree: true } },
      { id: 'oat', name: 'Oat milk', category: 'alternative', properties: { dairyFree: true } },
      { id: 'coconut', name: 'Coconut milk', category: 'alternative', properties: { dairyFree: true } },
    ],
    
    // Standard portion sizes for stock management
    portions: {
      coffee: {
        small: 0.008, // kg of coffee (8g)
        medium: 0.015, // kg of coffee (15g)
        large: 0.022, // kg of coffee (22g)
      },
      milk: {
        small: 0.15, // L of milk (150ml)
        medium: 0.25, // L of milk (250ml)
        large: 0.35, // L of milk (350ml)
      },
    },
  },
  
  // Auto-refresh settings
  refresh: {
    // Default auto-refresh interval in seconds
    defaultInterval: 60,
    
    // Minimum allowed interval to prevent UI flickering
    minInterval: 30,
    
    // Storage keys for refresh settings
    enabledKey: 'coffee_auto_refresh_enabled',
    intervalKey: 'coffee_auto_refresh_interval',
  },
  
  // UI Configuration
  ui: {
    defaultTheme: 'light',
    notificationTimeout: 5000, // Notification display time in milliseconds
    animationsEnabled: true
  }
};

// Apply environment-specific overrides
if (process.env.NODE_ENV === 'development') {
  config.api.debug = true;
} else if (process.env.NODE_ENV === 'production') {
  config.api.debug = false;
  config.api.fallbackEnabled = false;
}

export default config;