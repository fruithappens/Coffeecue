/**
 * Centralized error handling utility for the application
 * 
 * Provides consistent error handling, logging, and user feedback.
 */

// Error types for categorization
export const ERROR_TYPES = {
  NETWORK: 'network',
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  VALIDATION: 'validation',
  SERVER: 'server',
  CLIENT: 'client',
  UNKNOWN: 'unknown'
};

// Error severity levels
export const ERROR_SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

/**
 * Handle an error with proper logging and categorization
 * @param {Error} error - The error object
 * @param {string} context - Where the error occurred
 * @param {Object} options - Additional options
 * @returns {Object} - Processed error with type and severity
 */
export const handleError = (error, context, options = {}) => {
  // Default options
  const defaultOptions = {
    logToConsole: true,
    notifyUser: false,
    rethrow: false
  };
  
  const config = { ...defaultOptions, ...options };
  
  // Categorize the error
  const errorDetails = categorizeError(error);
  
  // Add context information
  errorDetails.context = context;
  errorDetails.timestamp = new Date().toISOString();
  
  // Log to console if enabled
  if (config.logToConsole) {
    console.error(`[${errorDetails.type.toUpperCase()}] Error in ${context}:`, error);
    
    // Log additional details for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('Error details:', errorDetails);
    }
  }
  
  // Notify user if enabled
  if (config.notifyUser) {
    notifyUser(errorDetails);
  }
  
  // Rethrow if requested
  if (config.rethrow) {
    throw error;
  }
  
  return errorDetails;
};

/**
 * Categorize an error by type and severity
 * @param {Error} error - The error object
 * @returns {Object} - Categorized error
 */
const categorizeError = (error) => {
  // Default categorization
  const result = {
    type: ERROR_TYPES.UNKNOWN,
    severity: ERROR_SEVERITY.ERROR,
    message: error.message || 'An unknown error occurred',
    originalError: error
  };
  
  // Network errors
  if (error.name === 'AbortError' || 
      error.message.includes('network') ||
      error.message.includes('Network') ||
      error.message.includes('fetch') ||
      error.message.includes('timeout')) {
    result.type = ERROR_TYPES.NETWORK;
    result.severity = ERROR_SEVERITY.WARNING;
  }
  // Authentication errors
  else if (error.status === 401 || 
           error.message.includes('token') || 
           error.message.includes('authentication') ||
           error.message.includes('login') ||
           error.message.includes('unauthorized')) {
    result.type = ERROR_TYPES.AUTHENTICATION;
    result.severity = ERROR_SEVERITY.WARNING;
  }
  // Authorization errors
  else if (error.status === 403 ||
           error.message.includes('permission') ||
           error.message.includes('forbidden')) {
    result.type = ERROR_TYPES.AUTHORIZATION;
    result.severity = ERROR_SEVERITY.WARNING;
  }
  // Validation errors
  else if (error.status === 400 ||
           error.status === 422 ||
           error.message.includes('validation') ||
           error.message.includes('invalid')) {
    result.type = ERROR_TYPES.VALIDATION;
    result.severity = ERROR_SEVERITY.INFO;
  }
  // Server errors
  else if (error.status >= 500 ||
           error.message.includes('server')) {
    result.type = ERROR_TYPES.SERVER;
    result.severity = ERROR_SEVERITY.ERROR;
  }
  
  return result;
};

/**
 * Notify the user about an error
 * @param {Object} errorDetails - Processed error details
 */
const notifyUser = (errorDetails) => {
  // Use notification system if available
  if (window.notificationSystem) {
    switch (errorDetails.severity) {
      case ERROR_SEVERITY.INFO:
        window.notificationSystem.info(errorDetails.message);
        break;
      case ERROR_SEVERITY.WARNING:
        window.notificationSystem.warning(errorDetails.message);
        break;
      case ERROR_SEVERITY.ERROR:
      case ERROR_SEVERITY.CRITICAL:
        window.notificationSystem.error(errorDetails.message);
        break;
      default:
        window.notificationSystem.info(errorDetails.message);
    }
    return;
  }
  
  // Fallback to alert for critical errors
  if (errorDetails.severity === ERROR_SEVERITY.CRITICAL) {
    alert(`Error: ${errorDetails.message}`);
  }
  
  // For other severities, log to console only if notification system not available
  console.error(`[${errorDetails.type}] ${errorDetails.message}`);
};

/**
 * Create a user-friendly error message
 * @param {Object|Error} error - The error object
 * @returns {string} - User-friendly error message
 */
export const getFriendlyErrorMessage = (error) => {
  // Default message
  let message = 'Something went wrong. Please try again.';
  
  // If already categorized, use the message
  if (error.type && error.severity) {
    return error.message;
  }
  
  // Otherwise, provide friendly messages based on common patterns
  if (error.name === 'AbortError' || error.message.includes('timeout')) {
    message = 'The request timed out. Please check your connection and try again.';
  } else if (error.status === 401 || error.message.includes('unauthorized')) {
    message = 'Your session has expired. Please log in again.';
  } else if (error.status === 403) {
    message = 'You don\'t have permission to perform this action.';
  } else if (error.status === 404) {
    message = 'The requested resource was not found.';
  } else if (error.status === 422) {
    message = 'The provided information is invalid. Please check your inputs.';
  } else if (error.status >= 500) {
    message = 'A server error occurred. The team has been notified.';
  } else if (error.message) {
    // Use the error message if it's available and reasonably short
    message = error.message.length < 100 ? error.message : message;
  }
  
  return message;
};

export default {
  handleError,
  getFriendlyErrorMessage,
  ERROR_TYPES,
  ERROR_SEVERITY
};