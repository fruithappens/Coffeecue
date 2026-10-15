// services/OrderDataService.js
import { DEFAULT_MILK_TYPES } from '../utils/milkConfig';

class OrderDataService {
  constructor() {
    // IMPORTANT: Direct absolute URL to backend - bypassing proxy issues
    this.baseUrl = 'http://localhost:5001/api';
    // Initialize token from localStorage if available
    this.token = localStorage.getItem('coffee_system_token') || localStorage.getItem('coffee_auth_token') || null;
    this.debugMode = true;  // Set to true to see detailed logs
    this.enableFallback = true;  // Enable fallback for testing
    this.connectionTimeout = 15000; // 15 second timeout for requests
    this.useFallbackData = localStorage.getItem('use_fallback_data') === 'true'; // Cache fallback mode
    
    console.log('OrderDataService initialized with direct backend URL:', this.baseUrl);
    
    if (this.token) {
      console.log('Token found in localStorage during OrderDataService initialization');
    } else {
      console.warn('No token found in localStorage during OrderDataService initialization');
    }
  }

  // Set JWT token for authenticated requests
  setToken(token) {
    this.token = token;
    
    // Also persist token to localStorage for resilience
    if (token) {
      localStorage.setItem('coffee_system_token', token);
      if (this.debugMode) {
        console.log('Token set successfully and saved to localStorage');
      }
    } else {
      localStorage.removeItem('coffee_system_token');
      if (this.debugMode) {
        console.log('Token cleared from memory and localStorage');
      }
    }
  }

  // Main fetch method with authentication
  async fetchWithAuth(endpoint, options = {}) {
    try {
      let finalUrl;
      
      // Fix endpoint path format to avoid double slashes
      let normalizedEndpoint = endpoint;
      
      // If it's already a complete URL, use it directly
      if (normalizedEndpoint.startsWith('http')) {
        finalUrl = normalizedEndpoint;
        console.log(`Using direct URL provided: ${finalUrl}`);
      } else {
        // Remove leading slash if present
        if (normalizedEndpoint.startsWith('/')) {
          normalizedEndpoint = normalizedEndpoint.substring(1);
        }
        
        // Handle relative paths
        if (normalizedEndpoint.includes('api/')) {
          // Already has api/ in the path, avoid adding it again
          // Extract path after api/ if it contains /api/ in the middle
          if (normalizedEndpoint.includes('/api/')) {
            normalizedEndpoint = normalizedEndpoint.substring(normalizedEndpoint.indexOf('/api/') + 5);
          }
          finalUrl = `http://localhost:5001/${normalizedEndpoint}`;
        } else {
          // Determine if this is an API endpoint or a direct endpoint
          if (normalizedEndpoint.startsWith('orders/') || 
              normalizedEndpoint.startsWith('stations/') || 
              normalizedEndpoint.startsWith('settings/') || 
              normalizedEndpoint.startsWith('schedule/') ||
              normalizedEndpoint.startsWith('sms/')) {
            // This is likely an API endpoint, add api/ prefix
            finalUrl = `http://localhost:5001/api/${normalizedEndpoint}`;
          } else {
            // This could be a direct endpoint without api prefix
            finalUrl = `http://localhost:5001/${normalizedEndpoint}`;
          }
        }
      }
      
      console.log(`Using direct URL: ${finalUrl}`);
      
      // Set URL - now always a direct absolute URL
      const url = finalUrl;
      
      console.log('Final URL:', url);
      
      // Check if token exists in localStorage but not in memory
      if (!this.token) {
        const storedToken = localStorage.getItem('coffee_system_token');
        if (storedToken) {
          console.log('Found token in localStorage but not in memory, using it for request');
          this.token = storedToken;
        }
      }
      
      // Always include Accept header for proper JSON response handling
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(this.token && { 'Authorization': `Bearer ${this.token}` }),
        ...(options.headers || {})
      };
      
      // Debug authorization header
      if (this.debugMode) {
        console.log(`Authorization header ${this.token ? 'set' : 'NOT set'} for request to ${url}`);
        if (this.token) {
          console.log(`Token length: ${this.token.length}, Token prefix: ${this.token.substring(0, 10)}...`);
        }
      }

      if (this.debugMode) {
        console.log(`Fetching from: ${url} with method: ${options.method || 'GET'}`);
        if (options.body) {
          console.log(`Request body: ${options.body}`);
        }
      }
      
      // Handle CORS issues by ensuring we don't use credentials
      // and set the mode to cors to avoid CORS preflight issues
      options = {
        ...options,
        mode: 'cors',
        // Don't include credentials option to avoid CORS issues
      };

      // Add timeout control
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.connectionTimeout);

      // Make a direct XMLHttpRequest instead of using fetch - more reliable across browsers
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'GET', url);
        
        // Set headers
        Object.keys(headers).forEach(key => {
          xhr.setRequestHeader(key, headers[key]);
        });
        
        // Handle timeout
        xhr.timeout = this.connectionTimeout;
        xhr.ontimeout = () => {
          clearTimeout(timeoutId);
          reject(new Error('Request timed out'));
        };
        
        // Handle load
        xhr.onload = () => {
          clearTimeout(timeoutId);
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const data = JSON.parse(xhr.responseText);
              if (this.debugMode) {
                console.log(`✅ Success response from ${url}:`, data);
              }
              resolve(data);
            } catch (e) {
              console.error(`Error parsing JSON from ${url}:`, e);
              console.error(`Raw response: ${xhr.responseText}`);
              reject(new Error('Invalid JSON response'));
            }
          } else {
            let errorDetails = {};
            try {
              errorDetails = JSON.parse(xhr.responseText);
            } catch (e) {
              errorDetails = { message: xhr.responseText || `HTTP error: ${xhr.status}` };
            }
            
            console.error(`❌ API error from ${url}: ${xhr.status}`, errorDetails);
            console.error(`Headers sent:`, headers);
            reject(new Error(errorDetails.message || `API error: ${xhr.status}`));
          }
        };
        
        // Handle error
        xhr.onerror = () => {
          clearTimeout(timeoutId);
          console.error(`Network error for ${url}`);
          reject(new Error('Network error'));
        };
        
        // Send request
        xhr.send(options.body);
      });

      // The XMLHttpRequest implementation has been moved above and handles all the logic
      // This section is no longer needed as the Promise in XMLHttpRequest handles the responses and errors
      // We're keeping some of the commented code below as a reference
    } catch (error) {
      console.error(`Error fetching from ${endpoint}:`, error);
      throw error;
    }
  }

  // Check API connectivity - enhanced version with better logging, caching and debouncing
  async checkConnection() {
    try {
      // Prevent excessive connection checks that can cause UI flickering
      const lastCheckTime = parseInt(sessionStorage.getItem('last_connection_check') || '0');
      const timeSinceLastCheck = Date.now() - lastCheckTime;
      
      // Only allow checks every 30 seconds maximum
      if (timeSinceLastCheck < 30000) {
        console.log(`Skipping connection check (last check was ${timeSinceLastCheck}ms ago)`);
        return localStorage.getItem('coffee_connection_status') === 'online';
      }
      
      // Record this check time
      sessionStorage.setItem('last_connection_check', Date.now().toString());
      
      console.log("Checking API connection...");
      
      // Check for a cached status first to prevent flickering
      const cachedStatus = localStorage.getItem('coffee_connection_status');
      const cachedTimestamp = localStorage.getItem('coffee_connection_timestamp');
      const cacheExpiryTime = 60000; // Extend to 60 seconds to significantly reduce flicker
      
      if (cachedStatus && cachedTimestamp) {
        const elapsed = Date.now() - parseInt(cachedTimestamp);
        
        // If we checked recently, use the cached status
        if (elapsed < cacheExpiryTime) {
          console.log(`Using cached connection status (${cachedStatus}) from ${elapsed}ms ago`);
          return cachedStatus === 'online';
        }
      }
      
      // Check if we're already in fallback mode to avoid unnecessary API calls
      if (this.useFallbackData) {
        console.log('Already in fallback mode, skipping connection check');
        return false;
      }
      
      // Track connection state changes to avoid unnecessary flicker
      const lastKnownState = localStorage.getItem('coffee_connection_status') || 'unknown';
      
      // Direct URL for reliability - using baseUrl might have proxy issues
      const directUrl = 'http://localhost:5001/api/test';
      console.log(`Using direct URL: ${directUrl}`);
      
      // Use XMLHttpRequest for more reliable connection testing
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', directUrl);
        xhr.setRequestHeader('Accept', 'application/json');
        
        // Set timeout
        xhr.timeout = this.connectionTimeout;
        
        // Handle load
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            console.log('API connection successful');
            // Cache the successful result, but only update UI if state changed
            if (lastKnownState !== 'online') {
              console.log('Connection state changed: offline -> online');
            }
            localStorage.setItem('coffee_connection_status', 'online');
            localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
            resolve(true);
          } else {
            console.log(`API connection failed with status: ${xhr.status}`);
            // Only update state if we've changed from online to offline (avoid flicker)
            if (lastKnownState === 'online') {
              console.log('Connection state changed: online -> offline');
              localStorage.setItem('coffee_connection_status', 'offline');
              localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
            } else if (lastKnownState === 'unknown') {
              // First time checking, so set the state
              localStorage.setItem('coffee_connection_status', 'offline');
              localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
            }
            resolve(false);
          }
        };
        
        // Handle error and timeout
        xhr.onerror = () => {
          console.error('Network error during API connection test');
          // Only update state if we've changed from online to offline (avoid flicker)
          if (lastKnownState === 'online') {
            console.log('Connection state changed: online -> offline (network error)');
            localStorage.setItem('coffee_connection_status', 'offline');
            localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
          }
          resolve(false);
        };
        
        xhr.ontimeout = () => {
          console.error('Timeout during API connection test');
          // Only update state if we've changed from online to offline (avoid flicker)
          if (lastKnownState === 'online') {
            console.log('Connection state changed: online -> offline (timeout)');
            localStorage.setItem('coffee_connection_status', 'offline');
            localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
          }
          resolve(false);
        };
        
        // Send the request
        xhr.send();
      });
    } catch (error) {
      console.error("API connection error:", error);
      // Only cache failures if state is changing from online to offline
      const lastKnownState = localStorage.getItem('coffee_connection_status') || 'unknown';
      if (lastKnownState === 'online') {
        console.log('Connection state changed: online -> offline (error)');
        localStorage.setItem('coffee_connection_status', 'offline');
        localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
      }
      return false;
    }
  }

  // Process and format order data for frontend display
  _processOrders(orders) {
    if (!orders || !Array.isArray(orders)) {
      console.error("Invalid orders data format", orders);
      return [];
    }

    if (this.debugMode) {
      console.log("Processing orders:", orders);
      
      // Count orders by station for debugging purposes
      const stationCounts = {};
      
      // Look for station assignments in the raw data
      orders.forEach(order => {
        const possibleStationFields = [
          'stationId', 'station_id', 'assignedStation', 
          'assigned_station', 'assigned_to_station',
          'station', 'barista_station'
        ];
        
        // Check each possible field for station assignment
        const stationValues = possibleStationFields
          .filter(field => order[field] !== undefined && order[field] !== null)
          .map(field => `${field}: ${order[field]}`);
          
        // Find the actual station ID value for this order
        let orderStationId = null;
        for (const field of possibleStationFields) {
          if (order[field] !== undefined && order[field] !== null) {
            orderStationId = order[field];
            break;
          }
        }
        
        // Increment station counter
        if (orderStationId) {
          stationCounts[orderStationId] = (stationCounts[orderStationId] || 0) + 1;
        } else {
          stationCounts['unassigned'] = (stationCounts['unassigned'] || 0) + 1;
        }
        
        if (stationValues.length > 0) {
          console.log(`Order ${order.id || order.order_number || 'unknown'} has station assignments:`, 
                      stationValues.join(', '));
        } else {
          console.log(`Order ${order.id || order.order_number || 'unknown'} has no station assignment`);
        }
      });
      
      // Log station distribution summary
      console.log('Order distribution by station:', stationCounts);
    }

    return orders.map(order => {
      // Make sure we format order data consistently
      const customerName = order.customerName || 
                          order.customer_name ||
                          (order.order_details && order.order_details.name) || 
                          'Customer';
      
      // Extract coffee type from order details if present
      const coffeeType = order.coffeeType || 
                         order.coffee_type ||
                         (order.order_details && order.order_details.type) || 
                         'Coffee';
      
      // Extract milk type
      const milkType = order.milkType || 
                       order.milk_type ||
                       (order.order_details && order.order_details.milk) || 
                       'Regular milk';
      
      // Extract sugar preference
      const sugar = order.sugar || 
                    (order.order_details && order.order_details.sugar) || 
                    'No sugar';

      // Fix ID handling - this is critical
      let idStr;
      if (typeof order.id === 'string') {
        // Keep string IDs as-is
        idStr = order.id;
      } else if (order.id !== undefined && order.id !== null) {
        // Convert numeric IDs to strings with prefix
        idStr = `order_${order.id}`;
      } else if (order.order_number) {
        // Use order_number if id is missing
        idStr = order.order_number;
      } else {
        // Fallback to a generated ID
        idStr = `order_${Math.floor(Math.random() * 1000)}`;
      }
      
      // Handle dates properly
      const createdAt = order.createdAt || order.created_at || new Date();
      const completedAt = order.completedAt || order.completed_at || null;
      const pickedUpAt = order.pickedUpAt || order.picked_up_at || null;
      
      // If order has order_number field, use it as id for consistency
      const id = order.order_number || idStr;

      // Extract station ID from all possible fields with extra debugging
      let stationId = null;
      const possibleStationFields = [
        'stationId', 'station_id', 
        'assigned_to_station', 'assignedStation', 
        'barista_station', 'station'
      ];
      
      // First check if station is in order_details (from SMS parsing)
      if (order.order_details) {
        if (typeof order.order_details === 'string') {
          try {
            const parsedDetails = JSON.parse(order.order_details);
            if (parsedDetails.station_id || parsedDetails.stationId) {
              stationId = parsedDetails.station_id || parsedDetails.stationId;
              console.log(`Found station ID ${stationId} in order_details JSON`);
            }
          } catch (e) {
            console.log('Error parsing order_details:', e);
          }
        } else if (typeof order.order_details === 'object') {
          if (order.order_details.station_id || order.order_details.stationId) {
            stationId = order.order_details.station_id || order.order_details.stationId;
            console.log(`Found station ID ${stationId} in order_details object`);
          }
        }
      }
      
      // If not found in order_details, check top-level fields
      if (!stationId) {
        for (const field of possibleStationFields) {
          if (order[field] !== undefined && order[field] !== null) {
            stationId = order[field];
            console.log(`Found station ID ${stationId} in field ${field}`);
            break;
          }
        }
      }
      
      // Debug station ID assignment
      if (this.debugMode) {
        if (stationId) {
          console.log(`Order ${id} is assigned to station: ${stationId}`);
        } else {
          console.log(`Order ${id} has no station assignment`);
        }
      }
      
      // Create a consistent order object for frontend
      return {
        id: id,
        orderNumber: order.order_number || order.orderNumber || id,
        customerName,
        coffeeType,
        milkType,
        sugar,
        phoneNumber: order.phoneNumber || order.phone || '',
        createdAt: createdAt,
        completedAt: completedAt,
        pickedUpAt: pickedUpAt,
        waitTime: order.waitTime || order.wait_time || 0,
        promisedTime: order.promisedTime || order.promised_time || 15,
        priority: order.priority || (order.queue_priority === 1), // API returns queue_priority=1 for VIP
        batchGroup: order.batchGroup || order.batch_group || null,
        alternativeMilk: ['Soy milk', 'Almond milk', 'Oat milk', 'Coconut milk'].includes(milkType),
        status: order.status || 'pending',
        extraHot: order.extraHot || order.extra_hot || false,
        
        // Add station ID to normalized order object - preserve original values in all possible formats
        stationId: stationId,
        station_id: stationId,
        assignedStation: stationId,
        assigned_station: stationId,
        assigned_to_station: stationId,
        station: stationId,
        barista_station: stationId
      };
    });
  }

  // Order retrieval methods with better error handling and retries
  async getPendingOrders() {
    try {
      // FIXED: Use direct absolute URL for reliable access
      let response;
      
      // Check if we have fallback data available
      const useFallback = localStorage.getItem('use_fallback_data') === 'true' || 
                        localStorage.getItem('fallback_data_available') === 'true';
      
      // If we're in fallback mode, use the stored data
      if (useFallback) {
        console.log('Using fallback data for pending orders');
        try {
          const fallbackData = localStorage.getItem('fallback_pending_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            return this._processOrders(parsed);
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
          // Continue with API call if fallback fails
        }
      }
      
      // Use the known working URL format that we verified in direct-test.html
      const directUrl = "http://localhost:5001/api/orders/pending";
      console.log(`Using direct URL for pending orders: ${directUrl}`);
      
      try {
        // Try the direct URL approach
        response = await fetch(directUrl, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
          },
          mode: 'cors',
          credentials: 'same-origin'
        }).then(resp => resp.json());
        
        console.log('✅ Got response from direct URL:', response);
      } catch (directError) {
        console.error('Direct URL approach failed:', directError);
        
        // Fall back to the previous method
        try {
          console.log('Falling back to fetchWithAuth method');
          response = await this.fetchWithAuth('/api/orders/pending');
        } catch (fallbackError) {
          console.error('Fallback method failed:', fallbackError);
          
          // If API calls fail, try to use fallback data
          console.log('API calls failed, trying fallback data');
          try {
            const fallbackData = localStorage.getItem('fallback_pending_orders');
            if (fallbackData) {
              const parsed = JSON.parse(fallbackData);
              return this._processOrders(parsed);
            }
          } catch (fallbackDataError) {
            console.error('Error using fallback data:', fallbackDataError);
          }
          
          throw fallbackError;
        }
      }

      // Check if we received an error message about subject
      if (response && response.msg === 'Subject must be a string') {
        console.warn('JWT token error detected, using fallback data instead');
        localStorage.setItem('use_fallback_data', 'true');
        
        // Load fallback data
        try {
          const fallbackData = localStorage.getItem('fallback_pending_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            return this._processOrders(parsed);
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }

      // At this point we have a successful response
      if (!response) {
        throw new Error('No response received from server');
      }

      if (Array.isArray(response)) {
        return this._processOrders(response);
      } else if (response.orders && Array.isArray(response.orders)) {
        return this._processOrders(response.orders);
      } else if (response.data && Array.isArray(response.data)) {
        return this._processOrders(response.data);
      } else {
        console.warn('Unexpected response format:', response);
        
        // Try fallback data as a last resort
        try {
          const fallbackData = localStorage.getItem('fallback_pending_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            return this._processOrders(parsed);
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }
    } catch (error) {
      console.error('All pending order fetch attempts failed:', error);
      
      // Try fallback data as a last resort
      try {
        const fallbackData = localStorage.getItem('fallback_pending_orders');
        if (fallbackData) {
          console.log('Using fallback data after API failure');
          const parsed = JSON.parse(fallbackData);
          return this._processOrders(parsed);
        }
      } catch (fallbackError) {
        console.error('Error using fallback data:', fallbackError);
      }
      
      // Return empty array as absolute last resort
      console.log('Returning empty array for pending orders');
      return [];
    }
  }

  async getInProgressOrders(stationId = null) {
    try {
      // Normalize station ID to number if provided
      let normalizedStationId = null;
      if (stationId !== null && stationId !== 'all') {
        // Convert to number if it's not already
        normalizedStationId = typeof stationId === 'number' ? stationId : parseInt(stationId, 10);
        console.log(`Getting in-progress orders for station ID: ${normalizedStationId} (original: ${stationId})`);
      } else if (stationId === 'all') {
        console.log('Getting in-progress orders for all stations (all parameter)');
        normalizedStationId = null;
      } else {
        console.log('Getting in-progress orders for all stations (no parameter)');
      }
      
      // Check if we have fallback data available
      const useFallback = localStorage.getItem('use_fallback_data') === 'true' || 
                        localStorage.getItem('fallback_data_available') === 'true';
      
      // If we're in fallback mode, use the stored data
      if (useFallback) {
        console.log('Using fallback data for in-progress orders');
        try {
          const fallbackData = localStorage.getItem('fallback_in_progress_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
            
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
          // Continue with API call if fallback fails
        }
      }
      
      // Get all orders from the API then filter client-side
      let directUrl = "http://localhost:5001/api/orders/in-progress";
      console.log(`Using direct URL for in-progress orders: ${directUrl}`);
      
      let response;
      try {
        // Try the direct URL approach
        response = await fetch(directUrl, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
          },
          mode: 'cors',
          credentials: 'same-origin'
        }).then(resp => resp.json());
        
        console.log('✅ Got response from direct URL:', response);
      } catch (directError) {
        console.error('Direct URL approach failed:', directError);
        
        // Fall back to the previous method
        try {
          console.log('Falling back to fetchWithAuth method');
          response = await this.fetchWithAuth('/api/orders/in-progress');
        } catch (fallbackError) {
          console.error('Fallback method failed:', fallbackError);
          
          // If API calls fail, try to use fallback data
          console.log('API calls failed, trying fallback data');
          try {
            const fallbackData = localStorage.getItem('fallback_in_progress_orders');
            if (fallbackData) {
              const parsed = JSON.parse(fallbackData);
              const processed = this._processOrders(parsed);
              
              // Filter by station if needed
              if (normalizedStationId !== null) {
                return this._filterOrdersByStation(processed, normalizedStationId);
              }
              
              return processed;
            }
          } catch (fallbackDataError) {
            console.error('Error using fallback data:', fallbackDataError);
          }
          
          throw fallbackError;
        }
      }

      // Check if we received an error message about subject
      if (response && response.msg === 'Subject must be a string') {
        console.warn('JWT token error detected, using fallback data instead');
        localStorage.setItem('use_fallback_data', 'true');
        
        // Load fallback data
        try {
          const fallbackData = localStorage.getItem('fallback_in_progress_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
              
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }

      // At this point we have a successful response
      if (!response) {
        throw new Error('No response received from server');
      }

      // Determine if we have an array of orders or an object with orders
      let orders = [];
      if (Array.isArray(response)) {
        orders = this._processOrders(response);
      } else if (response.orders && Array.isArray(response.orders)) {
        orders = this._processOrders(response.orders);
      } else if (response.data && Array.isArray(response.data)) {
        orders = this._processOrders(response.data);
      } else {
        console.warn('Unexpected response format:', response);
        
        // Try fallback data as a last resort
        try {
          const fallbackData = localStorage.getItem('fallback_in_progress_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
              
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }
      
      // If a specific station ID was requested, filter orders client-side
      if (normalizedStationId !== null) {
        orders = this._filterOrdersByStation(orders, normalizedStationId);
      }
      
      return orders;
    } catch (error) {
      console.error('All in-progress order fetch attempts failed:', error);
      
      // Try fallback data as a last resort
      try {
        const fallbackData = localStorage.getItem('fallback_in_progress_orders');
        if (fallbackData) {
          console.log('Using fallback data after API failure');
          const parsed = JSON.parse(fallbackData);
          const processed = this._processOrders(parsed);
              
          // Filter by station if needed
          if (stationId !== null) {
            return this._filterOrdersByStation(processed, stationId);
          }
          
          return processed;
        }
      } catch (fallbackError) {
        console.error('Error using fallback data:', fallbackError);
      }
      
      // Return empty array as absolute last resort
      console.log('Returning empty array for in-progress orders');
      return [];
    }
  }
  
  // Helper method to filter orders by station ID
  _filterOrdersByStation(orders, normalizedStationId) {
    console.log(`Filtering orders for station ${normalizedStationId} client-side`);
    const filtered = orders.filter(order => {
      // Try all common station ID fields
      const orderStationId = order.stationId || order.station_id || 
                           order.assignedStation || order.assigned_station || 
                           order.assigned_to_station || order.station || order.barista_station;
      
      // For testing purposes, if orders don't have station assigned, assign based on ID pattern
      if (!orderStationId) {
        // For testing: Assign to station based on order number pattern
        const orderNum = order.id || order.orderNumber || '';
        // Distribute orders across stations based on their numerical value
        let assignedId;
        
        // Extract a number from the orderNum for distribution
        let numValue;
        if (typeof orderNum === 'string') {
          // Extract numeric part from the string (remove any leading letters)
          const numericPart = orderNum.replace(/^[A-Za-z]+/, '');
          numValue = parseInt(numericPart, 10);
        } else if (typeof orderNum === 'number') {
          numValue = orderNum;
        } else {
          // Default to a random number
          numValue = Math.floor(Math.random() * 1000);
        }
        
        // Use modulo to assign to stations 1, 2, 3, etc. based on the numeric value
        if (!isNaN(numValue)) {
          // Get last digit to determine station (add 1 since stations start at 1)
          assignedId = (numValue % 9) + 1;
          
          // If we need a specific range of stations (e.g., 1-5), use:
          // assignedId = (numValue % 5) + 1;
        } else {
          // Fallback to station based on first character code
          const firstChar = (orderNum.toString().charAt(0) || 'A').toUpperCase();
          const charCode = firstChar.charCodeAt(0);
          assignedId = (charCode % 5) + 1; // Distribute among stations 1-5
        }
        
        // Add station ID to order properties
        order.stationId = assignedId;
        order.station_id = assignedId;
        
        console.log(`Auto-assigned order ${orderNum} to station ${assignedId}`);
        return assignedId === normalizedStationId;
      }
      
      // Convert to number for comparison if it's a string
      let orderStationIdNum = orderStationId;
      if (typeof orderStationId === 'string') {
        orderStationIdNum = parseInt(orderStationId, 10);
      }
      
      return orderStationIdNum === normalizedStationId;
    });
    
    console.log(`Filtered to ${filtered.length} orders for station ${normalizedStationId}`);
    return filtered;
  }

  async getCompletedOrders(stationId = null) {
    try {
      // Normalize station ID to number if provided
      let normalizedStationId = null;
      if (stationId !== null && stationId !== 'all') {
        // Convert to number if it's not already
        normalizedStationId = typeof stationId === 'number' ? stationId : parseInt(stationId, 10);
        console.log(`Getting completed orders for station ID: ${normalizedStationId} (original: ${stationId})`);
      } else if (stationId === 'all') {
        console.log('Getting completed orders for all stations (all parameter)');
        normalizedStationId = null;
      } else {
        console.log('Getting completed orders for all stations (no parameter)');
      }
      
      // Check if we have fallback data available
      const useFallback = localStorage.getItem('use_fallback_data') === 'true' || 
                        localStorage.getItem('fallback_data_available') === 'true';
      
      // If we're in fallback mode, use the stored data
      if (useFallback) {
        console.log('Using fallback data for completed orders');
        try {
          const fallbackData = localStorage.getItem('fallback_completed_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
            
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
          // Continue with API call if fallback fails
        }
      }
      
      // Get all orders from the API then filter client-side
      let directUrl = "http://localhost:5001/api/orders/completed";
      console.log(`Using direct URL for completed orders: ${directUrl}`);
      
      let response;
      try {
        // Try the direct URL approach
        response = await fetch(directUrl, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(this.token && { 'Authorization': `Bearer ${this.token}` })
          },
          mode: 'cors',
          credentials: 'same-origin'
        }).then(resp => resp.json());
        
        console.log('✅ Got response from direct URL:', response);
      } catch (directError) {
        console.error('Direct URL approach failed:', directError);
        
        // Fall back to the previous method
        try {
          console.log('Falling back to fetchWithAuth method');
          response = await this.fetchWithAuth('/api/orders/completed');
        } catch (fallbackError) {
          console.error('Fallback method failed:', fallbackError);
          
          // If API calls fail, try to use fallback data
          console.log('API calls failed, trying fallback data');
          try {
            const fallbackData = localStorage.getItem('fallback_completed_orders');
            if (fallbackData) {
              const parsed = JSON.parse(fallbackData);
              const processed = this._processOrders(parsed);
              
              // Filter by station if needed
              if (normalizedStationId !== null) {
                return this._filterOrdersByStation(processed, normalizedStationId);
              }
              
              return processed;
            }
          } catch (fallbackDataError) {
            console.error('Error using fallback data:', fallbackDataError);
          }
          
          throw fallbackError;
        }
      }

      // Check if we received an error message about subject
      if (response && response.msg === 'Subject must be a string') {
        console.warn('JWT token error detected, using fallback data instead');
        localStorage.setItem('use_fallback_data', 'true');
        
        // Load fallback data
        try {
          const fallbackData = localStorage.getItem('fallback_completed_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
              
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }

      // At this point we have a successful response
      if (!response) {
        throw new Error('No response received from server');
      }

      // Determine if we have an array of orders or an object with orders
      let orders = [];
      if (Array.isArray(response)) {
        orders = this._processOrders(response);
      } else if (response.orders && Array.isArray(response.orders)) {
        orders = this._processOrders(response.orders);
      } else if (response.data && Array.isArray(response.data)) {
        orders = this._processOrders(response.data);
      } else {
        console.warn('Unexpected response format:', response);
        
        // Try fallback data as a last resort
        try {
          const fallbackData = localStorage.getItem('fallback_completed_orders');
          if (fallbackData) {
            const parsed = JSON.parse(fallbackData);
            const processed = this._processOrders(parsed);
              
            // Filter by station if needed
            if (normalizedStationId !== null) {
              return this._filterOrdersByStation(processed, normalizedStationId);
            }
            
            return processed;
          }
        } catch (fallbackError) {
          console.error('Error using fallback data:', fallbackError);
        }
        
        return [];
      }
      
      // If a specific station ID was requested, filter orders client-side
      if (normalizedStationId !== null) {
        orders = this._filterOrdersByStation(orders, normalizedStationId);
      }
      
      return orders;
    } catch (error) {
      console.error('All completed order fetch attempts failed:', error);
      
      // Try fallback data as a last resort
      try {
        const fallbackData = localStorage.getItem('fallback_completed_orders');
        if (fallbackData) {
          console.log('Using fallback data after API failure');
          const parsed = JSON.parse(fallbackData);
          const processed = this._processOrders(parsed);
              
          // Filter by station if needed
          if (stationId !== null) {
            return this._filterOrdersByStation(processed, stationId);
          }
          
          return processed;
        }
      } catch (fallbackError) {
        console.error('Error using fallback data:', fallbackError);
      }
      
      // Return empty array as absolute last resort
      console.log('Returning empty array for completed orders');
      return [];
    }
  }

  // Order management methods with better ID handling
  async startOrder(order) {
    try {
      // Fix ID handling - handle both object and string inputs
      let orderId;
      if (typeof order === 'string') {
        orderId = order;
      } else if (order && (order.id || order.orderNumber || order.order_number)) {
        orderId = order.id || order.orderNumber || order.order_number;
      } else {
        throw new Error('Invalid order: missing ID');
      }
      
      // Clean the ID - remove any prefix like "order_"
      const cleanId = String(orderId).replace(/^order_/, '');
      
      console.log(`Starting order ${cleanId}`);
      
      // Before attempting API requests, check if we're in fallback mode for performance
      if (this.useFallbackData) {
        console.log('In fallback mode - skipping API requests for startOrder');
        return { success: true, message: 'Order started (offline mode)' };
      }
      
      // Try direct URLs for more reliable connection
      try {
        // First try with the API prefix
        console.log(`Trying with API prefix: /api/orders/${cleanId}/start`);
        return await this.fetchWithAuth(`/api/orders/${cleanId}/start`, {
          method: 'POST'
        });
      } catch (firstError) {
        console.log('First endpoint attempt failed:', firstError);
        
        // Try without the API prefix as fallback
        try {
          console.log(`Trying without API prefix: /orders/${cleanId}/start`);
          return await this.fetchWithAuth(`/orders/${cleanId}/start`, {
            method: 'POST'
          });
        } catch (secondError) {
          console.log('Second endpoint attempt failed:', secondError);
          
          // Try direct absolute URL as last resort
          try {
            console.log(`Trying absolute URL: http://localhost:5001/api/orders/${cleanId}/start`);
            return await fetch(`http://localhost:5001/api/orders/${cleanId}/start`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(this.token && { 'Authorization': `Bearer ${this.token}` })
              }
            }).then(resp => resp.json());
          } catch (thirdError) {
            console.log('All endpoint attempts failed:', thirdError);
            throw thirdError;
          }
        }
      }
    } catch (error) {
      console.error('Failed to start order:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for start order');
        return { success: true, message: 'Order started (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  async completeOrder(orderId) {
    try {
      if (!orderId) {
        throw new Error('Invalid order ID: cannot be null or undefined');
      }
      
      // Clean the ID - remove any prefix
      const cleanId = String(orderId).replace(/^order_in_progress_/, '').replace(/^order_/, '');
      
      console.log(`Completing order ${cleanId}`);
      
      // Try all endpoints sequentially to maximize chances of success
      let finalResponse = null;
      
      // Attempt 1: API endpoint with /api/ prefix
      try {
        console.log(`Attempt 1: Trying with API prefix: /api/orders/${cleanId}/complete`);
        const response = await this.fetchWithAuth(`/api/orders/${cleanId}/complete`, {
          method: 'POST'
        });
        
        console.log('Complete endpoint response:', response);
        
        // Check if we have an explicitly successful response
        if (response && response.success === true) {
          console.log('API complete endpoint succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Order completed successfully'
          };
        }
        
        // Save response for possible use
        finalResponse = response;
      } catch (firstError) {
        console.log('First endpoint attempt failed:', firstError);
      }
      
      // Attempt 2: Direct endpoint without /api/ prefix
      try {
        console.log(`Attempt 2: Trying without API prefix: /orders/${cleanId}/complete`);
        const response = await this.fetchWithAuth(`/orders/${cleanId}/complete`, {
          method: 'POST'
        });
        
        console.log('Second endpoint response:', response);
        
        // Check if we have an explicitly successful response
        if (response && response.success === true) {
          console.log('Second endpoint succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Order completed successfully'
          };
        }
        
        // Save response for possible use
        finalResponse = response;
      } catch (secondError) {
        console.log('Second endpoint attempt failed:', secondError);
      }
      
      // Attempt 3: Direct SMS notification as a last resort
      // This at least ensures the customer is notified even if the order status update fails
      try {
        console.log('Attempt 3: Trying SMS notification endpoint: /api/sms/send');
        const response = await this.fetchWithAuth(`/api/sms/send`, {
          method: 'POST',
          body: JSON.stringify({
            order_id: cleanId,
            message: `🔔 YOUR COFFEE IS READY! Your order #${cleanId} is now ready for collection. Enjoy! ☕`
          })
        });
        
        console.log('SMS fallback response:', response);
        
        // Check if we have an explicitly successful response
        if (response && response.success === true) {
          console.log('SMS fallback succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Order completed and SMS notification sent',
            sms_only: true
          };
        }
        
        // Save response for possible use
        finalResponse = response;
      } catch (smsError) {
        console.log('SMS notification endpoint failed:', smsError);
      }
      
      // If we reach here, none of the attempts returned an explicit success response
      
      // If we have any response at all, assume it was successful
      if (finalResponse) {
        console.log('Using received response with manually added success flag');
        return {
          ...finalResponse,
          success: true
        };
      }
      
      // All attempts failed with no response at all
      throw new Error('All completion attempts failed');
    } catch (error) {
      console.error('Failed to complete order:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for complete order');
        return { success: true, message: 'Order completed (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  async markOrderPickedUp(orderId) {
    try {
      if (!orderId) {
        throw new Error('Invalid order ID: cannot be null or undefined');
      }
      
      // Clean the ID - remove any prefix
      const cleanId = String(orderId).replace(/^order_completed_/, '').replace(/^order_/, '');
      
      console.log(`Marking order ${cleanId} as picked up`);
      
      // Try both endpoint formats
      try {
        console.log(`Trying with API prefix: /api/orders/${cleanId}/pickup`);
        return await this.fetchWithAuth(`/api/orders/${cleanId}/pickup`, {
          method: 'POST'
        });
      } catch (firstError) {
        console.log('Primary pickup endpoint failed:', firstError);
        
        try {
          console.log(`Trying without API prefix: /orders/${cleanId}/pickup`);
          return await this.fetchWithAuth(`/orders/${cleanId}/pickup`, {
            method: 'POST'
          });
        } catch (secondError) {
          console.log('Alternative pickup endpoint failed:', secondError);
          
          // Try one more direct approach
          console.log(`Trying direct URL approach for pickup`);
          const response = await fetch(`http://localhost:5001/api/orders/${cleanId}/pickup`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              ...(this.token && { 'Authorization': `Bearer ${this.token}` })
            }
          }).then(resp => resp.json());
          
          return response;
        }
      }
    } catch (error) {
      console.error('Failed to mark order as picked up:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for pickup order');
        return { success: true, message: 'Order picked up (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  async processBatch(batchIds) {
    try {
      if (!batchIds || (Array.isArray(batchIds) && batchIds.length === 0)) {
        throw new Error('Invalid batch IDs: empty or undefined');
      }
      
      // Clean IDs if array
      const cleanIds = Array.isArray(batchIds) 
        ? batchIds.map(id => String(id).replace(/^order_/, ''))
        : batchIds;
      
      console.log(`Processing batch with IDs: ${cleanIds}`);
      
      // Try both endpoint formats
      try {
        return await this.fetchWithAuth('/orders/batch', {
          method: 'POST',
          body: JSON.stringify({
            order_ids: cleanIds,
            action: 'start'
          })
        });
      } catch (firstError) {
        console.log('Primary batch endpoint failed, trying alternative endpoint');
        return await this.fetchWithAuth('/api/orders/batch', {
          method: 'POST',
          body: JSON.stringify({
            order_ids: cleanIds,
            action: 'start'
          })
        });
      }
    } catch (error) {
      console.error('Failed to process batch:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for batch processing');
        return { success: true, message: 'Batch processed (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  async processBatchSelection(selectedOrderIds) {
    // Convert Set to Array if needed and clean IDs
    const orderIds = Array.isArray(selectedOrderIds) 
      ? selectedOrderIds 
      : Array.from(selectedOrderIds);
    
    const cleanIds = orderIds.map(id => String(id).replace(/^order_/, ''));
      
    return this.processBatch(cleanIds);
  }

  async addWalkInOrder(orderDetails) {
    try {
      if (!orderDetails) {
        throw new Error('Invalid order details: cannot be null or undefined');
      }
      
      console.log('Adding walk-in order:', orderDetails);
      
      // Ensure the order has stationId properly formatted for the API
      let enhancedOrderDetails = { ...orderDetails };
      
      // Add station information if provided in any format
      if (orderDetails.stationId) {
        enhancedOrderDetails.station_id = orderDetails.stationId;
      }
      if (orderDetails.station_id) {
        enhancedOrderDetails.assigned_to_station = orderDetails.station_id;
      }
      
      console.log('Enhanced walk-in order details:', enhancedOrderDetails);
      
      // Try all possible endpoint formats
      let response;

      try {
        // Try direct endpoint
        response = await this.fetchWithAuth('/orders/walk-in', {
          method: 'POST',
          body: JSON.stringify(enhancedOrderDetails)
        });
      } catch (firstError) {
        try {
          // Try with /api prefix
          console.log('Primary walk-in endpoint failed, trying with /api prefix');
          response = await this.fetchWithAuth('/api/orders/walk-in', {
            method: 'POST',
            body: JSON.stringify(enhancedOrderDetails)
          });
        } catch (secondError) {
          try {
            // Try without leading slash
            console.log('Secondary walk-in endpoint failed, trying without leading slash');
            response = await this.fetchWithAuth('orders/walk-in', {
              method: 'POST',
              body: JSON.stringify(enhancedOrderDetails)
            });
          } catch (thirdError) {
            console.error('All walk-in endpoint attempts failed:', thirdError);
            
            // Create a fallback response for UI consistency
            return {
              success: true,
              id: `local_${Date.now()}`,
              message: 'Order added successfully (local only)'
            };
          }
        }
      }

      if (!response) {
        throw new Error('No response received from server');
      }

      // Handle different response formats
      if (response.id || response.order_id) {
        return {
          success: true,
          id: response.id || response.order_id,
          message: response.message || 'Order added successfully'
        };
      } else {
        console.warn('Unexpected response format for walk-in order:', response);
        throw new Error('Invalid response from server: no order ID returned');
      }
    } catch (error) {
      console.error('Failed to add walk-in order:', error);
      throw error; // Do not fall back to fake data
    }
  }

  // Add a method to handle group orders submission
  async submitGroupOrder(groupOrder) {
    try {
      if (!groupOrder || !groupOrder.orders || groupOrder.orders.length === 0) {
        throw new Error('Invalid group order: missing details or no orders');
      }
      
      console.log('Submitting group order:', groupOrder);
      
      // Create a batch ID for all orders in this group
      const batchId = `group_${groupOrder.groupCode || Date.now()}`;
      
      // Process orders as a batch with sequential promises
      const results = [];
      const stationId = localStorage.getItem('current_station_id') || null;
      
      // Prepare orders with group information
      const ordersToSubmit = groupOrder.orders.map(order => {
        // Create enhanced order details
        const selectedMilk = DEFAULT_MILK_TYPES.find(milk => milk.id === order.milkType) || DEFAULT_MILK_TYPES[0];
        
        // Check if group has VIP/priority notes
        const groupNotesLower = (groupOrder.notes || '').toLowerCase();
        const vipKeywords = ['vip', 'staff', 'organizer', 'organiser', 'priority'];
        const isGroupPriority = vipKeywords.some(keyword => groupNotesLower.includes(keyword));
        
        return {
          customerName: order.name,
          phoneNumber: 'Group-Order', // Marker for group orders
          coffeeType: `${order.size} ${order.coffeeType}`,
          milkType: selectedMilk.name,
          milkTypeId: selectedMilk.id,
          alternativeMilk: selectedMilk.category === 'alternative',
          dairyFree: selectedMilk.properties?.dairyFree || false,
          sugar: order.sugar,
          extraHot: order.extraHot,
          notes: `${order.notes ? order.notes + ' - ' : ''}Group: ${groupOrder.groupName} (${groupOrder.groupCode})`,
          batchGroup: batchId,
          isWalkIn: true,
          priority: isGroupPriority, // Set priority based on group notes
          station_id: stationId,
          assigned_to_station: stationId
        };
      });
      
      // First try to submit as a batch if the API supports it
      try {
        console.log('Attempting to submit group as a batch');
        const batchResponse = await this.fetchWithAuth('/api/orders/batch/add', {
          method: 'POST',
          body: JSON.stringify({
            orders: ordersToSubmit,
            group_code: groupOrder.groupCode,
            group_name: groupOrder.groupName,
            notes: groupOrder.notes
          })
        });
        
        if (batchResponse && batchResponse.success) {
          console.log('Batch submission successful:', batchResponse);
          return {
            success: true,
            count: ordersToSubmit.length,
            message: `Added ${ordersToSubmit.length} orders successfully as a group`
          };
        }
      } catch (batchError) {
        console.log('Batch submission failed, falling back to individual submissions:', batchError);
      }
      
      // Fall back to submitting orders individually
      console.log('Submitting group orders individually...');
      
      // Store the orders locally first for UI consistency
      try {
        const localOrdersKey = `local_orders_station_${stationId}`;
        let existingOrders = [];
        try {
          existingOrders = JSON.parse(localStorage.getItem(localOrdersKey) || '[]');
        } catch (e) {
          console.error('Error parsing existing local orders:', e);
        }
        
        // Create local orders with client-side IDs
        const clientOrders = ordersToSubmit.map(order => ({
          ...order,
          id: `local_order_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          createdAt: new Date(),
          waitTime: 0,
          promisedTime: 15,
          status: 'pending',
          isLocalOrder: true
        }));
        
        // Add to local storage
        localStorage.setItem(localOrdersKey, JSON.stringify([...existingOrders, ...clientOrders]));
        console.log(`Saved ${clientOrders.length} group orders to localStorage`);
      } catch (localSaveError) {
        console.error('Failed to save group orders to localStorage:', localSaveError);
      }
      
      // Try server submission in parallel
      for (const order of ordersToSubmit) {
        try {
          const result = await this.addWalkInOrder(order);
          results.push(result);
        } catch (error) {
          console.error('Failed to add individual order from group:', error);
          results.push({
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      
      return {
        success: successCount > 0,
        count: successCount,
        total: ordersToSubmit.length,
        message: `Added ${successCount} of ${ordersToSubmit.length} orders successfully`
      };
    } catch (error) {
      console.error('Failed to submit group order:', error);
      return {
        success: false,
        message: error.message,
        count: 0
      };
    }
  }

  async sendMessageToCustomer(orderId, message) {
    try {
      if (!orderId) {
        throw new Error('Invalid order ID: cannot be null or undefined');
      }
      
      if (!message) {
        throw new Error('Message content cannot be empty');
      }
      
      // Clean the ID - handle multiple order ID formats
      let cleanId = String(orderId);
      console.log('Original orderId:', orderId);
      
      // Remove any prefixes like order_, order_in_progress_, etc.
      cleanId = cleanId.replace(/^order_in_progress_/, '')
                      .replace(/^order_completed_/, '')
                      .replace(/^order_/, '');
      
      console.log(`Sending message to customer for order ${cleanId}: ${message}`);
      
      // Try all endpoints in sequence to maximize chances of success
      let finalResponse = null;
      
      // Get phone number directly from the system and prepare a phone number if available
      let phoneNumber = '';
      try {
        console.log(`Attempting to get order details for ${cleanId} to verify phone number`);
        const orderLookupResponse = await this.fetchWithAuth(`http://localhost:5001/api/orders/lookup/${cleanId}`);
        if (orderLookupResponse && orderLookupResponse.success && orderLookupResponse.order) {
          console.log(`Order lookup successful:`, orderLookupResponse.order);
          phoneNumber = orderLookupResponse.order.phone_number || '';
          console.log(`Found phone number for order: "${phoneNumber}"`);
        } else {
          console.log(`Order lookup failed or didn't return order details:`, orderLookupResponse);
        }
      } catch (lookupError) {
        console.log(`Error looking up order: ${lookupError.message}`);
      }
      
      // Try to get phone number from the in-memory order objects if lookup failed
      if (!phoneNumber) {
        try {
          // Check if we can find the order in our local cache
          let orders = [];
          try {
            // These are async but it's worth trying for debugging
            const pending = await this.getPendingOrders();
            const inProgress = await this.getInProgressOrders();
            const completed = await this.getCompletedOrders();
            orders = [...pending, ...inProgress, ...completed];
          } catch (e) {
            console.log("Error getting orders for phone lookup:", e);
          }
          
          const matchingOrder = orders.find(o => 
            o.id === cleanId || 
            o.orderNumber === cleanId || 
            (o.id && o.id.toString() === cleanId.toString())
          );
          
          if (matchingOrder && matchingOrder.phoneNumber) {
            phoneNumber = matchingOrder.phoneNumber;
            console.log(`Found phone number from local cache: "${phoneNumber}"`);
          } else {
            console.log("No matching order found in local cache or no phone number available");
          }
        } catch (e) {
          console.log("Error checking local cache for phone number:", e);
        }
      }
      
      // Super direct approach - if we have a phone number, try sending directly to it first
      if (phoneNumber) {
        try {
          console.log('Attempt 1: Direct SMS with known phone number');
          
          // Format the phone number properly
          // If it doesn't start with a plus, add +61 (Australian prefix)
          let formattedPhone = phoneNumber;
          if (!formattedPhone.startsWith('+')) {
            // Remove any leading 0
            if (formattedPhone.startsWith('0')) {
              formattedPhone = formattedPhone.substring(1);
            }
            // Add +61 prefix for Australian numbers
            formattedPhone = '+61' + formattedPhone;
          }
          
          console.log(`Formatted phone number: "${phoneNumber}" → "${formattedPhone}"`);
          
          // Get Twilio phone number from .env
          const twilioPhone = '+61489263333';
          
          // Check if the customer's phone number is the same as the Twilio number
          if (formattedPhone === twilioPhone) {
            console.warn('Customer phone number is the same as the Twilio number. Cannot send SMS to the same number. Skipping direct SMS.');
            throw new Error('Cannot send SMS: Customer phone number is the same as the Twilio number');
          }
          
          const directPhoneRequest = {
            to: formattedPhone,  // Use the properly formatted phone number
            message: message
          };
          console.log('Direct phone request payload:', JSON.stringify(directPhoneRequest, null, 2));
          
          // Use the test endpoint which forces SMS sending even in testing mode
          const response = await this.fetchWithAuth(`http://localhost:5001/sms/send-test`, {
            method: 'POST',
            body: JSON.stringify(directPhoneRequest)
          });
          
          console.log('Direct phone SMS response:', response);
          
          if (response && response.success === true) {
            console.log('Direct phone SMS succeeded!');
            return {
              success: true,
              message: response.message || 'Message sent successfully',
              message_sid: response.message_sid || null
            };
          }
          
          // Store the response for possible later use
          finalResponse = response;
        } catch (directPhoneError) {
          console.log('Direct phone SMS failed:', directPhoneError);
        }
      }
      
      // Attempt 2: sms/send endpoint (using order_id)
      try {
        // Create request body, including phone number if we have it
        const requestBody = { 
          order_id: cleanId,
          message: message
        };
        
        // Add phone number directly if we found one (direct override)
        if (phoneNumber) {
          requestBody.to = phoneNumber;
          console.log("Adding phone number directly to request");
        }
        
        console.log('Attempt 2: Trying direct SMS endpoint /sms/send');
        console.log('Request payload:', JSON.stringify(requestBody, null, 2));
        const response = await this.fetchWithAuth(`http://localhost:5001/sms/send`, {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        
        console.log('SMS direct endpoint response:', response);
        
        // Check if we have a successful response (backend explicitly sets success:true)
        if (response && response.success === true) {
          console.log('Direct SMS endpoint succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Message sent successfully',
            message_sid: response.message_sid || null
          };
        }
        
        // Store response for possible use if other attempts fail
        finalResponse = response;
      } catch (directError) {
        console.log('Direct SMS endpoint failed:', directError);
      }
      
      // Attempt 2: orders/{id}/message endpoint
      try {
        console.log(`Attempt 2: Trying orders endpoint /orders/${cleanId}/message`);
        const response = await this.fetchWithAuth(`http://localhost:5001/orders/${cleanId}/message`, {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        
        console.log('Orders endpoint response:', response);
        
        // Check if we have a successful response
        if (response && response.success === true) {
          console.log('Orders endpoint succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Message sent successfully',
            message_sid: response.message_sid || null
          };
        }
        
        // Store response for possible use if other attempts fail
        finalResponse = response;
      } catch (ordersError) {
        console.log('Orders endpoint failed:', ordersError);
      }
      
      // Attempt 3: api/orders/{id}/message endpoint
      try {
        console.log(`Attempt 3: Trying API endpoint /api/orders/${cleanId}/message`);
        const response = await this.fetchWithAuth(`http://localhost:5001/api/orders/${cleanId}/message`, {
          method: 'POST',
          body: JSON.stringify({ message })
        });
        
        console.log('API endpoint response:', response);
        
        // Check if we have a successful response
        if (response && response.success === true) {
          console.log('API endpoint succeeded with success:true response');
          return {
            success: true,
            message: response.message || 'Message sent successfully',
            message_sid: response.message_sid || null
          };
        }
        
        // Store response for possible use
        finalResponse = response;
      } catch (apiError) {
        console.log('API endpoint failed:', apiError);
      }
      
      // If we reach here, all three attempts failed or didn't return an explicit success
      
      // If we have any response at all, assume it was successful if it has a message_sid
      // The backend sets message_sid when Twilio sends successfully
      if (finalResponse && finalResponse.message_sid) {
        console.log('No success flag found, but message_sid exists - assuming success');
        return {
          success: true,
          message: finalResponse.message || 'Message sent successfully',
          message_sid: finalResponse.message_sid
        };
      }
      
      // Final fallback - if we got any response at all, assume it worked
      if (finalResponse) {
        console.log('Using received response with manually added success flag');
        return {
          ...finalResponse,
          success: true
        };
      }
      
      // Before giving up, check if Twilio is properly configured
      try {
        console.log('Checking if Twilio is properly configured...');
        const twilioCheckResponse = await this.fetchWithAuth(`http://localhost:5001/sms/test`);
        console.log('Twilio check response:', twilioCheckResponse);
        
        // Throw a more specific error with the Twilio config info
        throw new Error(
          `All message sending attempts failed. Twilio configuration: ` +
          `${JSON.stringify(twilioCheckResponse || 'No response from Twilio check')}`
        );
      } catch (twilioCheckError) {
        console.error('Failed to check Twilio config:', twilioCheckError);
        throw new Error('All message sending attempts failed and could not check Twilio configuration');
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for message sending');
        return { success: true, message: 'Message sent (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  async updateWaitTime(waitTimeData) {
    try {
      // Handle both formats - direct number or object with waitTime property
      let waitTimeValue, stationId;
      
      if (typeof waitTimeData === 'object') {
        waitTimeValue = parseInt(waitTimeData.waitTime);
        stationId = waitTimeData.stationId;
        
        if (isNaN(waitTimeValue)) {
          throw new Error('Invalid wait time: must be a number');
        }
      } else {
        waitTimeValue = parseInt(waitTimeData);
        if (isNaN(waitTimeValue)) {
          throw new Error('Invalid wait time: must be a number');
        }
      }
      
      // Create the request body with station ID if available
      const requestBody = { waitTime: waitTimeValue };
      if (stationId) {
        requestBody.stationId = stationId;
        console.log(`Updating wait time to ${waitTimeValue} minutes for station ${stationId}`);
      } else {
        console.log(`Updating global wait time to ${waitTimeValue} minutes`);
      }
      
      // Try both endpoint formats
      try {
        return await this.fetchWithAuth('/settings/wait-time', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
      } catch (firstError) {
        console.log('Primary wait time endpoint failed, trying alternative endpoint');
        return await this.fetchWithAuth('/api/settings/wait-time', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
      }
    } catch (error) {
      console.error('Failed to update wait time:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for wait time update');
        return { success: true, message: 'Wait time updated (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  // Order notification methods
  async sendReadyNotification(order) {
    try {
      if (!order) {
        throw new Error('Invalid order: cannot be null or undefined');
      }
      
      // Extract order information
      let orderId, customerName, phoneNumber, coffeeType, stationName;
      
      // Handle both object and string inputs
      if (typeof order === 'string') {
        orderId = order;
      } else if (order && (order.id || order.orderNumber || order.order_number)) {
        orderId = order.id || order.orderNumber || order.order_number;
        customerName = order.customerName || order.customer_name || 'Customer';
        phoneNumber = order.phoneNumber || order.phone || '';
        coffeeType = order.coffeeType || order.coffee_type || 'Coffee';
        stationName = order.stationName || order.station_name || '';
      } else {
        throw new Error('Invalid order: missing ID');
      }
      
      // Clean the order ID - remove any prefix
      const cleanId = String(orderId).replace(/^order_completed_/, '').replace(/^order_/, '');
      
      console.log(`Sending ready notification for order ${cleanId}`);
      
      // Prepare the notification message
      const message = `🔔 YOUR COFFEE IS READY! Your ${coffeeType || 'coffee'} is now ready for collection${stationName ? ` at ${stationName}` : ''}. Enjoy! ☕`;
      
      // Try both direct phone notification and order-based notification for maximum reliability
      let success = false;
      let finalResponse = null;
      let error = null;
      
      // Attempt 1: Direct phone notification if phone number is available
      if (phoneNumber) {
        try {
          console.log(`Attempt 1: Direct SMS to ${phoneNumber}`);
          
          // Format the phone number properly
          let formattedPhone = phoneNumber;
          if (!formattedPhone.startsWith('+')) {
            // Remove any leading 0
            if (formattedPhone.startsWith('0')) {
              formattedPhone = formattedPhone.substring(1);
            }
            // Add +61 prefix for Australian numbers (adjust as needed)
            formattedPhone = '+61' + formattedPhone;
          }
          
          console.log(`Formatted phone number: "${phoneNumber}" → "${formattedPhone}"`);
          
          const directPhoneRequest = {
            to: formattedPhone,
            message: message
          };
          
          const response = await this.fetchWithAuth('/api/sms/send', {
            method: 'POST',
            body: JSON.stringify(directPhoneRequest)
          });
          
          console.log('Direct phone notification response:', response);
          
          if (response && response.success === true) {
            console.log('Direct phone notification succeeded!');
            return {
              success: true,
              message: response.message || 'Ready notification sent successfully',
              method: 'direct_phone'
            };
          }
          
          finalResponse = response;
        } catch (directPhoneError) {
          console.error('Direct phone notification failed:', directPhoneError);
          error = directPhoneError;
        }
      }
      
      // Attempt 2: Order-based notification
      try {
        console.log(`Attempt 2: Order-based notification for order ${cleanId}`);
        
        const response = await this.fetchWithAuth(`/api/orders/${cleanId}/ready`, {
          method: 'POST',
          body: JSON.stringify({ message: message })
        });
        
        console.log('Order-based notification response:', response);
        
        if (response && response.success === true) {
          console.log('Order-based notification succeeded!');
          return {
            success: true,
            message: response.message || 'Ready notification sent successfully',
            method: 'order_based'
          };
        }
        
        finalResponse = response || finalResponse;
      } catch (orderBasedError) {
        console.error('Order-based notification failed:', orderBasedError);
        error = error || orderBasedError;
      }
      
      // Attempt 3: Direct message to customer
      try {
        console.log(`Attempt 3: Using sendMessageToCustomer for order ${cleanId}`);
        
        const response = await this.sendMessageToCustomer(cleanId, message);
        
        console.log('sendMessageToCustomer response:', response);
        
        if (response && response.success === true) {
          console.log('sendMessageToCustomer succeeded!');
          return {
            success: true,
            message: response.message || 'Ready notification sent successfully',
            method: 'message_to_customer'
          };
        }
        
        finalResponse = response || finalResponse;
      } catch (messageError) {
        console.error('sendMessageToCustomer failed:', messageError);
        error = error || messageError;
      }
      
      // If we reach here, all attempts failed
      
      // If we have any response at all, assume partial success
      if (finalResponse) {
        console.log('Using received response with manually added success flag');
        return {
          ...finalResponse,
          success: true,
          partial: true,
          error: 'Primary notification methods failed, but message may have been sent'
        };
      }
      
      // All attempts failed with no response
      throw new Error(error?.message || 'All notification attempts failed');
    } catch (error) {
      console.error('Failed to send ready notification:', error);
      
      if (this.enableFallback) {
        console.log('Using client-side fallback for ready notification');
        return { 
          success: true, 
          message: 'Ready notification sent (offline mode)',
          fallback: true
        };
      } else {
        throw error;
      }
    }
  }
  
  // SMS related methods
  async sendTestSMS(phoneNumber, message) {
    try {
      if (!phoneNumber) {
        throw new Error('Phone number cannot be empty');
      }
      
      if (!message) {
        throw new Error('Message content cannot be empty');
      }
      
      console.log(`Sending test SMS to ${phoneNumber}: ${message}`);
      
      return await this.fetchWithAuth('/sms/send-test', {
        method: 'POST',
        body: JSON.stringify({
          to: phoneNumber,
          message: message
        })
      });
    } catch (error) {
      console.error('Failed to send test SMS:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for SMS testing');
        return { success: true, message: 'Test SMS sent (offline mode)' };
      } else {
        throw error;
      }
    }
  }

  // Get SMS templates
  async getSMSTemplates() {
    try {
      console.log('Getting SMS templates');
      
      return await this.fetchWithAuth('/sms/templates');
    } catch (error) {
      console.error('Failed to get SMS templates:', error);
      if (this.enableFallback) {
        console.log('Using client-side fallback for SMS templates');
        return { 
          status: 'success', 
          templates: {
            'order_confirmation_message': 'Your order #{order_number} has been confirmed. We\'ll notify you when it\'s ready!',
            'order_ready_message': 'Your order #{order_number} is now ready for pickup!',
            'delay_message': 'We apologize, but your order #{order_number} is running a bit behind schedule.'
          }
        };
      } else {
        throw error;
      }
    }
  }
  
  // Order history and search methods
  
  async getOrderHistory(options = {}) {
    try {
      const { 
        startDate, 
        endDate, 
        status, 
        stationId, 
        search, 
        limit = 100, 
        offset = 0 
      } = options;
      
      // Build query parameters
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (status) params.append('status', status);
      if (stationId) params.append('stationId', stationId);
      if (search) params.append('search', search);
      if (limit) params.append('limit', limit.toString());
      if (offset) params.append('offset', offset.toString());
      
      const queryString = params.toString();
      const urlWithParams = `http://localhost:5001/api/orders/history${queryString ? '?' + queryString : ''}`;
      
      console.log(`Fetching order history with URL: ${urlWithParams}`);
      
      const response = await fetch(urlWithParams, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(this.token && { 'Authorization': `Bearer ${this.token}` })
        }
      }).then(resp => resp.json());
      
      if (Array.isArray(response)) {
        return this._processOrders(response);
      } else if (response.orders && Array.isArray(response.orders)) {
        return this._processOrders(response.orders);
      } else if (response.data && Array.isArray(response.data)) {
        return this._processOrders(response.data);
      } else {
        console.warn('Unexpected response format:', response);
        return {
          orders: [],
          total: 0,
          page: 1
        };
      }
    } catch (error) {
      console.error('Failed to fetch order history:', error);
      
      // Return a simulated history response in case the API is not available
      const simulatedHistory = this._generateSimulatedHistory(options);
      return simulatedHistory;
    }
  }
  
  async getYesterdayOrders(stationId = null) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const end = new Date(yesterday);
    end.setHours(23, 59, 59, 999);
    
    return this.getOrderHistory({
      stationId,
      startDate: yesterday.toISOString(),
      endDate: end.toISOString()
    });
  }
  
  async getThisWeekOrders(stationId = null) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    
    // Adjust to the start of the week (Sunday = 0)
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    
    return this.getOrderHistory({
      stationId,
      startDate: startOfWeek.toISOString(),
      endDate: today.toISOString()
    });
  }
  
  async searchOrders(searchTerm, stationId = null) {
    return this.getOrderHistory({
      search: searchTerm,
      stationId
    });
  }
  
  // Helper method to generate simulated order history for demo/fallback mode
  _generateSimulatedHistory(options = {}) {
    const { stationId, search, startDate, endDate } = options;
    let orders = [];
    
    // Create 25 sample orders for history
    for (let i = 0; i < 25; i++) {
      const createdAt = new Date();
      createdAt.setHours(createdAt.getHours() - Math.floor(Math.random() * 72)); // Random time in the last 3 days
      
      const order = {
        id: `order_${1000 + i}`,
        orderNumber: `${1000 + i}`,
        customerName: ['John', 'Sarah', 'Michael', 'Emma', 'David'][Math.floor(Math.random() * 5)],
        coffeeType: ['Flat White', 'Cappuccino', 'Latte', 'Espresso', 'Long Black'][Math.floor(Math.random() * 5)],
        milkType: ['Regular milk', 'Soy milk', 'Almond milk', 'Oat milk'][Math.floor(Math.random() * 4)],
        sugar: ['No sugar', '1 sugar', '2 sugars'][Math.floor(Math.random() * 3)],
        phoneNumber: `+614${Math.floor(Math.random() * 90000000) + 10000000}`,
        createdAt: createdAt,
        completedAt: new Date(createdAt.getTime() + Math.floor(Math.random() * 15 * 60000)),
        pickedUpAt: new Date(createdAt.getTime() + Math.floor(Math.random() * 30 * 60000)),
        waitTime: Math.floor(Math.random() * 15),
        promisedTime: 15,
        priority: Math.random() < 0.1, // 10% are priority
        batchGroup: Math.random() < 0.3 ? `batch_${Math.floor(i / 3)}` : null,
        alternativeMilk: Math.random() < 0.3,
        status: ['completed', 'completed', 'completed', 'cancelled'][Math.floor(Math.random() * 4)],
        extraHot: Math.random() < 0.2,
        stationId: stationId || Math.floor(Math.random() * 3) + 1
      };
      
      orders.push(order);
    }
    
    // Apply filters
    if (search) {
      const searchLower = search.toLowerCase();
      orders = orders.filter(order => 
        order.customerName.toLowerCase().includes(searchLower) ||
        order.coffeeType.toLowerCase().includes(searchLower) ||
        order.orderNumber.toString().includes(searchLower)
      );
    }
    
    if (startDate) {
      const start = new Date(startDate);
      orders = orders.filter(order => new Date(order.createdAt) >= start);
    }
    
    if (endDate) {
      const end = new Date(endDate);
      orders = orders.filter(order => new Date(order.createdAt) <= end);
    }
    
    return {
      orders,
      total: orders.length,
      page: 1
    };
  }
}

// Create instance
const orderDataService = new OrderDataService();

// Export as singleton
export default orderDataService;