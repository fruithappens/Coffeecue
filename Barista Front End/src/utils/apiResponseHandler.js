/**
 * Standardized API response handling
 * 
 * Provides consistent processing of API responses across the application.
 */

import errorHandler from './errorHandler';

/**
 * Process an API response with standardized error handling
 * @param {Response} response - Fetch API Response object
 * @param {string} endpoint - API endpoint for context
 * @returns {Promise<Object>} - Processed response data
 * @throws {Error} - Enhanced error with additional context
 */
export const processResponse = async (response, endpoint) => {
  try {
    // If response is OK, parse and return the data
    if (response.ok) {
      const data = await response.json();
      return data;
    }
    
    // Handle error responses
    let errorData;
    try {
      // Try to parse error details from response
      errorData = await response.json();
    } catch (e) {
      // If parsing fails, use status text
      errorData = { 
        message: response.statusText || `HTTP error ${response.status}`,
        status: response.status 
      };
    }
    
    // Create a standardized error object
    const error = new Error(errorData.message || `API error: ${response.status}`);
    error.status = response.status;
    error.endpoint = endpoint;
    error.data = errorData;
    
    // Handle with error handler
    errorHandler.handleError(error, `API call to ${endpoint}`);
    
    throw error;
  } catch (error) {
    // Handle network errors and other exceptions
    if (!error.status) {
      error.status = 0;
      error.endpoint = endpoint;
    }
    
    errorHandler.handleError(error, `API call to ${endpoint}`);
    throw error;
  }
};

/**
 * Check if a response is successful
 * @param {Object} data - API response data
 * @returns {boolean} - True if successful
 */
export const isSuccessResponse = (data) => {
  // Check different success indicators used in the API
  return (
    // Standard success flag
    data.success === true ||
    // Status indicator
    data.status === 'success' ||
    // Absence of error flags
    (data.error === undefined && data.success !== false)
  );
};

/**
 * Extract data from an API response with consistent structure
 * @param {Object} response - API response
 * @param {string} dataKey - Key for main data (e.g., 'orders', 'users')
 * @param {*} defaultValue - Default value if data not found
 * @returns {*} - Extracted data or default value
 */
export const extractData = (response, dataKey, defaultValue = []) => {
  // If response is null or undefined, return default
  if (!response) return defaultValue;
  
  // If response is an array, return it directly
  if (Array.isArray(response)) return response;
  
  // Check for data in common response formats
  if (response[dataKey]) return response[dataKey];
  if (response.data && response.data[dataKey]) return response.data[dataKey];
  if (response.data && Array.isArray(response.data)) return response.data;
  
  // If we can't find the data, return default
  return defaultValue;
};

/**
 * Process generic API success response with standardized structure
 * @param {Object} response - API response
 * @returns {Object} - Standardized response object
 */
export const processSuccessResponse = (response) => {
  // If response is null or undefined, create a basic success response
  if (!response) {
    return { success: true, message: 'Operation completed successfully' };
  }
  
  // If response already has success flag, return it
  if (response.success !== undefined) {
    return response;
  }
  
  // If response has status, convert to success flag
  if (response.status) {
    return {
      ...response,
      success: response.status === 'success'
    };
  }
  
  // Default to assuming success
  return {
    ...response,
    success: true
  };
};

/**
 * Extract error message from API error response
 * @param {Object} error - Error object
 * @returns {string} - Error message
 */
export const getErrorMessage = (error) => {
  // If error has a data property with message, use it
  if (error.data && error.data.message) {
    return error.data.message;
  }
  
  // If error has a response property with data
  if (error.response && error.response.data) {
    const { data } = error.response;
    return data.message || data.error || 'An error occurred';
  }
  
  // Use error message if available
  return error.message || 'An unknown error occurred';
};

export default {
  processResponse,
  isSuccessResponse,
  extractData,
  processSuccessResponse,
  getErrorMessage
};