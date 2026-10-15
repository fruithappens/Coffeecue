// services/ApiService.fixed.js
import serviceFactory from './ServiceFactory';
import MockDataService from './MockDataService';
import authService from './AuthService';
import { APP_MODES } from '../context/AppContext';

// Singleton instance storage
let instance = null;

class ApiService {
  constructor() {
    // Enforce singleton
    if (instance) {
      return instance;
    }
    
    console.log('ApiService: Creating new singleton instance');
    
    this.baseUrl = 'http://localhost:5001/api';
    this.token = null;
    this.debugMode = true;
    this.enableFallback = false;
    this.connectionTimeout = 10000;
    this.isRefreshing = false; // Prevent infinite refresh loops
    
    // Defer localStorage access until after constructor
    setTimeout(() => {
      this.token = localStorage.getItem('coffee_system_token') || localStorage.getItem('token') || null;
    }, 0);
    
    // Monitor for app mode changes
    serviceFactory.addModeChangeListener(this._handleModeChange.bind(this));
    
    instance = this;
  }

  /**
   * Set JWT token for authenticated requests
   */
  setToken(token) {
    this.token = token;
    if (this.debugMode) {
      console.log(token ? 'Token set successfully' : 'Token cleared');
    }
  }

  /**
   * Check if we're running in demo mode
   */
  isDemoMode() {
    return serviceFactory.getMode() === APP_MODES.DEMO;
  }

  /**
   * Make API request with proper error handling
   */
  async request(endpoint, options = {}) {
    try {
      if (this.isDemoMode()) {
        // Use MockDataService in demo mode
        const method = (options.method || 'GET').toLowerCase();
        const body = options.body ? JSON.parse(options.body) : undefined;
        
        switch (method) {
          case 'get':
            return await MockDataService.get(endpoint);
          case 'post':
            return await MockDataService.post(endpoint, body);
          case 'put':
            return await MockDataService.put(endpoint, body);
          case 'patch':
            return await MockDataService.patch(endpoint, body);
          case 'delete':
            return await MockDataService.delete(endpoint);
          default:
            throw new Error(`Unsupported method: ${method}`);
        }
      } else {
        // Use real API
        return await this.fetchWithAuth(endpoint, options);
      }
    } catch (error) {
      console.error(`Error in request to ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Make real API request with authentication
   */
  async fetchWithAuth(endpoint, options = {}) {
    // Normalize endpoint
    let normalizedEndpoint = endpoint;
    if (normalizedEndpoint.startsWith('/')) {
      normalizedEndpoint = normalizedEndpoint.substring(1);
    }
    
    // Construct URL - in development, use relative URL for proxy
    let url;
    if (process.env.NODE_ENV === 'development') {
      // Remove duplicate /api/ if present
      if (normalizedEndpoint.startsWith('api/')) {
        url = `/${normalizedEndpoint}`;
      } else {
        url = `/api/${normalizedEndpoint}`;
      }
    } else {
      // In production, use full URL
      const baseUrlNoSlash = this.baseUrl.endsWith('/') 
        ? this.baseUrl.slice(0, -1) 
        : this.baseUrl;
      
      if (normalizedEndpoint.startsWith('api/')) {
        const pathWithoutApi = normalizedEndpoint.substring(4);
        url = `${baseUrlNoSlash}/${pathWithoutApi}`;
      } else {
        url = `${baseUrlNoSlash}/${normalizedEndpoint}`;
      }
    }
    
    if (this.debugMode) {
      console.log(`API Request: ${options.method || 'GET'} ${url}`);
    }
    
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
      ...(options.headers || {})
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        mode: 'cors'
      });

      // Handle auth errors
      if (response.status === 401 && !this.isRefreshing) {
        this.isRefreshing = true;
        try {
          const refreshed = await authService.refreshToken();
          if (refreshed) {
            // Retry once with new token
            const retryResponse = await fetch(url, {
              ...options,
              headers: {
                ...headers,
                'Authorization': `Bearer ${authService.getToken()}`
              },
              mode: 'cors'
            });
            this.isRefreshing = false;
            
            if (!retryResponse.ok) {
              throw new Error(`API error: ${retryResponse.status}`);
            }
            return await retryResponse.json();
          }
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          // Redirect to login
          window.location.href = '/login';
        } finally {
          this.isRefreshing = false;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching from ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Make GET request
   */
  async get(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'GET'
    });
  }

  /**
   * Make POST request
   */
  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make PUT request
   */
  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make PATCH request
   */
  async patch(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(data)
    });
  }

  /**
   * Make DELETE request
   */
  async delete(endpoint, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'DELETE'
    });
  }

  /**
   * Handle mode changes
   */
  _handleModeChange(newMode) {
    if (this.debugMode) {
      console.log(`ApiService: Mode changed to ${newMode}`);
    }
  }
}

// Export singleton instance
export default new ApiService();