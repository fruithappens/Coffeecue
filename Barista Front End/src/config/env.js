/**
 * Environment configuration for the application
 * 
 * Provides centralized access to environment variables with validation and defaults.
 */

// Environment type
export const ENV = {
  DEVELOPMENT: 'development',
  PRODUCTION: 'production',
  TEST: 'test'
};

// Current environment
export const NODE_ENV = process.env.NODE_ENV || ENV.DEVELOPMENT;
export const IS_DEV = NODE_ENV === ENV.DEVELOPMENT;
export const IS_PROD = NODE_ENV === ENV.PRODUCTION;
export const IS_TEST = NODE_ENV === ENV.TEST;

/**
 * Get environment variable with validation and default
 * @param {string} name - Environment variable name (without REACT_APP_ prefix)
 * @param {*} defaultValue - Default value if not set
 * @param {Function} validator - Optional validation function
 * @returns {*} - Environment variable value
 */
export const getEnv = (name, defaultValue, validator = null) => {
  // Full environment variable name with REACT_APP_ prefix
  const fullName = `REACT_APP_${name}`;
  
  // Get value from environment
  const value = process.env[fullName];
  
  // If not set, use default
  if (value === undefined) {
    // Log warning in development
    if (IS_DEV && defaultValue !== undefined) {
      console.warn(`Environment variable ${fullName} not set, using default:`, defaultValue);
    }
    return defaultValue;
  }
  
  // If validator provided, validate value
  if (validator && typeof validator === 'function') {
    try {
      const validatedValue = validator(value);
      if (validatedValue === undefined) {
        // If validator returns undefined, use default
        console.warn(`Environment variable ${fullName} invalid, using default:`, defaultValue);
        return defaultValue;
      }
      return validatedValue;
    } catch (error) {
      console.error(`Error validating environment variable ${fullName}:`, error);
      return defaultValue;
    }
  }
  
  return value;
};

/**
 * Validator for boolean values
 * @param {string} value - String value from environment
 * @returns {boolean} - Parsed boolean
 */
export const boolValidator = (value) => {
  return value === 'true' || value === '1';
};

/**
 * Validator for numeric values
 * @param {string} value - String value from environment
 * @returns {number} - Parsed number
 */
export const numberValidator = (value) => {
  const parsed = Number(value);
  return isNaN(parsed) ? undefined : parsed;
};

/**
 * Validator for URL values
 * @param {string} value - String value from environment
 * @returns {string} - Validated URL
 */
export const urlValidator = (value) => {
  try {
    // Check if it's a valid URL
    new URL(value);
    return value;
  } catch (error) {
    return undefined;
  }
};

// API configuration
export const API_URL = getEnv('API_URL', 'http://localhost:5001/api', urlValidator);
export const API_TIMEOUT = getEnv('API_TIMEOUT', 15000, numberValidator);
export const API_DEBUG = IS_DEV ? getEnv('API_DEBUG', true, boolValidator) : false;

// Authentication configuration
export const AUTH_MAX_ERRORS = getEnv('AUTH_MAX_ERRORS', 3, numberValidator);
export const AUTO_REFRESH_ENABLED = getEnv('AUTO_REFRESH_ENABLED', true, boolValidator);
export const AUTO_REFRESH_INTERVAL = getEnv('AUTO_REFRESH_INTERVAL', 60, numberValidator);
export const AUTO_REFRESH_MIN_INTERVAL = getEnv('AUTO_REFRESH_MIN_INTERVAL', 30, numberValidator);

// Demo mode configuration
export const DEMO_MODE_ENABLED = getEnv('DEMO_MODE_ENABLED', false, boolValidator);

// Export all environment variables
export default {
  ENV,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  IS_TEST,
  getEnv,
  API_URL,
  API_TIMEOUT,
  API_DEBUG,
  AUTH_MAX_ERRORS,
  AUTO_REFRESH_ENABLED,
  AUTO_REFRESH_INTERVAL,
  AUTO_REFRESH_MIN_INTERVAL,
  DEMO_MODE_ENABLED,
  
  // Validator functions
  validators: {
    boolValidator,
    numberValidator,
    urlValidator
  }
};