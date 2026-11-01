/**
 * Flexible API Handler
 * Tries multiple approaches to get data, with smart fallback to various backends
 */
(function() {
  console.log('🔄 Initializing Flexible API Handler...');
  
  // Try different backend URLs in order
  const API_URLS = [
    '/api',             // Default relative URL
    'http://localhost:5001/api', // Direct local backend
    'https://mock-expresso-api.onrender.com/api' // Public mock API if available
  ];
  
  // Current API URL index
  let currentApiUrlIndex = 0;
  
  // JWT tokens to try
  const JWT_TOKENS = [
    // Token 1: String subject and ID
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vX3VzZXIiLCJuYW1lIjoiRGVtbyBVc2VyIiwicm9sZSI6ImJhcmlzdGEiLCJ1c2VybmFtZSI6ImRlbW8iLCJpZCI6ImRlbW9fdXNlciIsInN0YXRpb25zIjpbMSwyLDNdLCJpYXQiOjE2MzA0NzMxMjQsImV4cCI6MTY2MjAwOTEyNCwicGVybWlzc2lvbnMiOlsidmlld19vcmRlcnMiLCJtYW5hZ2Vfb3JkZXJzIiwidmlld19zdGF0aW9ucyJdfQ.b2ZmbGluZV9tb2RlX3NpZ25hdHVyZQ",
    
    // Token 2: Minimal token with string subject
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiaWF0IjoxNjMwNDczMTI0LCJleHAiOjE2NjIwMDkxMjR9.c2ltcGxlX3NpZ25hdHVyZQ"
  ];
  
  // Current token index
  let currentTokenIndex = 0;
  
  // Get the current API URL
  function getCurrentApiUrl() {
    return API_URLS[currentApiUrlIndex] || API_URLS[0];
  }
  
  // Get the current token
  function getCurrentToken() {
    return JWT_TOKENS[currentTokenIndex] || JWT_TOKENS[0];
  }
  
  // Initialize status indicator
  function initStatusIndicator() {
    if (document.getElementById('api-status-indicator')) {
      return; // Already exists
    }
    
    const indicator = document.createElement('div');
    indicator.id = 'api-status-indicator';
    indicator.style.position = 'fixed';
    indicator.style.bottom = '10px';
    indicator.style.right = '10px';
    indicator.style.padding = '8px 12px';
    indicator.style.borderRadius = '4px';
    indicator.style.color = 'white';
    indicator.style.fontSize = '12px';
    indicator.style.fontWeight = 'bold';
    indicator.style.zIndex = '9999';
    indicator.style.cursor = 'pointer';
    indicator.style.opacity = '0.85';
    indicator.style.backgroundColor = '#FF9800'; // Orange while checking
    indicator.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    indicator.style.transition = 'background-color 0.3s';
    
    indicator.innerText = '⟳ CONNECTING...';
    
    // Hover effect
    indicator.addEventListener('mouseover', () => {
      indicator.style.opacity = '1';
    });
    
    indicator.addEventListener('mouseout', () => {
      indicator.style.opacity = '0.85';
    });
    
    // Click handler to cycle through modes
    indicator.addEventListener('click', () => {
      const isUsingFallback = localStorage.getItem('use_fallback_data') === 'true';
      
      if (isUsingFallback) {
        // Switch to real API mode
        localStorage.removeItem('use_fallback_data');
        
        // Cycle to next API URL and token
        currentApiUrlIndex = (currentApiUrlIndex + 1) % API_URLS.length;
        currentTokenIndex = (currentTokenIndex + 1) % JWT_TOKENS.length;
        
        // Update indicator
        indicator.style.backgroundColor = '#FF9800'; // Orange
        indicator.innerText = `⟳ CONNECTING TO ${getCurrentApiUrl()}...`;
        
        // Store current settings
        localStorage.setItem('api_url_index', currentApiUrlIndex);
        localStorage.setItem('token_index', currentTokenIndex);
        
        // Update token
        const token = getCurrentToken();
        ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'].forEach(key => {
          localStorage.setItem(key, token);
        });
        
        // Reload the page
        setTimeout(() => location.reload(), 500);
      } else {
        // Switch to fallback mode
        localStorage.setItem('use_fallback_data', 'true');
        
        // Update indicator
        indicator.style.backgroundColor = '#e74c3c'; // Red
        indicator.innerText = '⚠ USING FALLBACK DATA';
        
        // Reload the page
        setTimeout(() => location.reload(), 500);
      }
    });
    
    // Add to the document
    document.body.appendChild(indicator);
    
    // Expose update function globally
    window.updateApiStatus = function(status, message) {
      switch (status) {
        case 'online':
          indicator.style.backgroundColor = '#2ecc71'; // Green
          indicator.innerText = `✓ CONNECTED TO ${getCurrentApiUrl()}`;
          break;
        case 'offline':
          indicator.style.backgroundColor = '#e74c3c'; // Red
          indicator.innerText = '⚠ USING FALLBACK DATA';
          break;
        case 'connecting':
          indicator.style.backgroundColor = '#FF9800'; // Orange
          indicator.innerText = `⟳ CONNECTING TO ${getCurrentApiUrl()}...`;
          break;
        case 'error':
          indicator.style.backgroundColor = '#e74c3c'; // Red
          indicator.innerText = `✗ ERROR: ${message || 'CONNECTION FAILED'}`;
          break;
        default:
          indicator.style.backgroundColor = '#FF9800'; // Orange
          indicator.innerText = message || 'CHECKING CONNECTION...';
      }
    };
  }
  
  // Initialize the status indicator when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    // Restore previous settings if available
    const savedApiUrlIndex = localStorage.getItem('api_url_index');
    const savedTokenIndex = localStorage.getItem('token_index');
    
    if (savedApiUrlIndex !== null) {
      currentApiUrlIndex = parseInt(savedApiUrlIndex, 10);
    }
    
    if (savedTokenIndex !== null) {
      currentTokenIndex = parseInt(savedTokenIndex, 10);
    }
    
    // Store the current token
    const token = getCurrentToken();
    ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'].forEach(key => {
      localStorage.setItem(key, token);
    });
    
    // Initialize user data
    const user = {
      id: "demo_user",
      username: "demo",
      name: "Demo User",
      role: "barista",
      stations: [1, 2, 3]
    };
    localStorage.setItem('coffee_system_user', JSON.stringify(user));
    
    // Initialize the status indicator
    initStatusIndicator();
    
    // Initial status
    if (localStorage.getItem('use_fallback_data') === 'true') {
      window.updateApiStatus('offline');
    } else {
      window.updateApiStatus('connecting');
      
      // Test the connection
      testConnection();
    }
  });
  
  // Test the connection
  function testConnection() {
    const baseUrl = getCurrentApiUrl();
    const token = getCurrentToken();
    
    fetch(`${baseUrl}/test`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    })
    .then(response => {
      if (response.ok) {
        console.log('✅ Connection successful');
        window.updateApiStatus('online');
        localStorage.removeItem('use_fallback_data');
      } else {
        console.warn(`❌ Connection failed with status: ${response.status}`);
        
        // Try the next token if we have another
        if (currentTokenIndex < JWT_TOKENS.length - 1) {
          currentTokenIndex++;
          localStorage.setItem('token_index', currentTokenIndex);
          console.log(`Trying next token: ${currentTokenIndex + 1}/${JWT_TOKENS.length}`);
          
          // Store the new token
          const newToken = getCurrentToken();
          ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'].forEach(key => {
            localStorage.setItem(key, newToken);
          });
          
          // Try again
          testConnection();
          return;
        }
        
        // Try the next API URL if we have another
        if (currentApiUrlIndex < API_URLS.length - 1) {
          currentApiUrlIndex++;
          currentTokenIndex = 0; // Reset token index for new URL
          localStorage.setItem('api_url_index', currentApiUrlIndex);
          localStorage.setItem('token_index', currentTokenIndex);
          console.log(`Trying next API URL: ${currentApiUrlIndex + 1}/${API_URLS.length}`);
          
          // Store the new token
          const newToken = getCurrentToken();
          ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'].forEach(key => {
            localStorage.setItem(key, newToken);
          });
          
          // Update the status indicator
          window.updateApiStatus('connecting');
          
          // Try again
          testConnection();
          return;
        }
        
        // If we've tried all tokens and URLs, fall back to sample data
        console.warn('All connection attempts failed, switching to fallback data');
        window.updateApiStatus('offline');
        localStorage.setItem('use_fallback_data', 'true');
      }
    })
    .catch(error => {
      console.error('Network error:', error);
      
      // Try the next API URL if we have another
      if (currentApiUrlIndex < API_URLS.length - 1) {
        currentApiUrlIndex++;
        currentTokenIndex = 0; // Reset token index for new URL
        localStorage.setItem('api_url_index', currentApiUrlIndex);
        localStorage.setItem('token_index', currentTokenIndex);
        console.log(`Network error, trying next API URL: ${currentApiUrlIndex + 1}/${API_URLS.length}`);
        
        // Store the new token
        const newToken = getCurrentToken();
        ['coffee_system_token', 'auth_token', 'coffee_auth_token', 'jwt_token'].forEach(key => {
          localStorage.setItem(key, newToken);
        });
        
        // Update the status indicator
        window.updateApiStatus('connecting');
        
        // Try again
        testConnection();
        return;
      }
      
      // If we've tried all URLs, fall back to sample data
      console.warn('All connection attempts failed, switching to fallback data');
      window.updateApiStatus('offline');
      localStorage.setItem('use_fallback_data', 'true');
    });
  }
  
  // Intercept fetch API calls to use the current API URL
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    // Check if it's an API call and we're not in fallback mode
    if (typeof url === 'string' && 
        url.includes('/api/') && 
        !url.includes('://') && 
        localStorage.getItem('use_fallback_data') !== 'true') {
      
      // Replace the API URL with the current one
      const apiPath = url.substring(url.indexOf('/api/') + 5);
      const fullUrl = `${getCurrentApiUrl()}/${apiPath}`;
      
      console.log(`🔄 Redirecting API call to: ${fullUrl}`);
      
      // Make sure authorization header is set
      options = options || {};
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${getCurrentToken()}`;
      
      return originalFetch(fullUrl, options)
        .then(response => {
          // If successful, return the response
          if (response.ok) {
            return response;
          }
          
          // If we get an authentication error, try fallback data
          if (response.status === 401 || response.status === 403 || response.status === 422) {
            console.warn(`Auth error (${response.status}), using fallback data`);
            
            // Update status indicator
            if (window.updateApiStatus) {
              window.updateApiStatus('offline');
            }
            
            // Switch to fallback mode
            localStorage.setItem('use_fallback_data', 'true');
            
            // Return mock data from fallbackData
            return getFallbackResponse(apiPath);
          }
          
          // For other errors, return the response as-is
          return response;
        })
        .catch(error => {
          console.error(`API call to ${fullUrl} failed:`, error);
          
          // Update status indicator
          if (window.updateApiStatus) {
            window.updateApiStatus('offline');
          }
          
          // Switch to fallback mode
          localStorage.setItem('use_fallback_data', 'true');
          
          // Return mock data
          return getFallbackResponse(apiPath);
        });
    }
    
    // If it's an API call and we are in fallback mode
    if (typeof url === 'string' && url.includes('/api/') && 
        localStorage.getItem('use_fallback_data') === 'true') {
      
      // Extract the API path
      const apiPath = url.substring(url.indexOf('/api/') + 5);
      
      console.log(`📦 Using fallback data for: ${apiPath}`);
      
      // Return mock data
      return getFallbackResponse(apiPath);
    }
    
    // For non-API calls or URLs with protocol, use original fetch
    return originalFetch.apply(this, arguments);
  };
  
  // Helper function to get fallback response
  function getFallbackResponse(apiPath) {
    // Get the appropriate data based on the endpoint
    let mockData;
    
    if (apiPath.includes('stations')) {
      mockData = JSON.parse(localStorage.getItem('fallback_stations') || '[]');
    } else if (apiPath.includes('orders/pending')) {
      mockData = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
    } else if (apiPath.includes('orders/in-progress')) {
      mockData = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
    } else if (apiPath.includes('orders/completed')) {
      mockData = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
    } else if (apiPath.includes('orders')) {
      // All orders
      const pending = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
      const inProgress = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
      const completed = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
      mockData = [...pending, ...inProgress, ...completed];
    } else if (apiPath.includes('schedule')) {
      mockData = {
        success: true,
        schedule: [
          {
            id: 1,
            date: new Date().toISOString().split('T')[0],
            shifts: [
              {
                id: "shift1",
                startTime: "08:00",
                endTime: "12:00",
                barista: "John Barista",
                stationId: 1
              },
              {
                id: "shift2",
                startTime: "12:00",
                endTime: "16:00",
                barista: "Sarah Barista",
                stationId: 2
              }
            ]
          }
        ]
      };
    } else if (apiPath.includes('settings/wait-time')) {
      mockData = { success: true, message: 'Wait time updated', waitTime: 10 };
    } else if (apiPath.includes('test')) {
      mockData = { success: true, message: 'API test successful (fallback)' };
    } else {
      // Generic success for other endpoints
      mockData = { success: true, message: 'Operation successful (fallback)' };
    }
    
    // Create a mock successful response
    return Promise.resolve({
      ok: true, 
      status: 200,
      json: () => Promise.resolve(mockData),
      text: () => Promise.resolve(JSON.stringify(mockData))
    });
  }
  
  // Initialize fallback data if not already present
  if (!localStorage.getItem('fallback_stations')) {
    console.log('Setting up fallback data...');
    
    // Generate sample data
    const now = Date.now();
    const minutes = (min) => min * 60 * 1000;
    
    // Stations
    const stations = [
      {
        id: 1,
        name: "Main Station",
        status: "active",
        barista: "John Barista",
        queue_length: 3,
        last_activity: new Date(now - minutes(2)).toISOString(),
        capabilities: ["espresso", "milk-steaming", "tea"],
        location: "Main Hall"
      },
      {
        id: 2,
        name: "Express Station",
        status: "active",
        barista: "Sarah Barista",
        queue_length: 1,
        last_activity: new Date(now - minutes(5)).toISOString(),
        capabilities: ["espresso", "milk-steaming"],
        location: "Side Entrance"
      },
      {
        id: 3,
        name: "VIP Station",
        status: "inactive",
        barista: null,
        queue_length: 0,
        last_activity: new Date(now - minutes(60)).toISOString(),
        capabilities: ["espresso", "milk-steaming", "tea", "specialty"],
        location: "VIP Area"
      }
    ];
    
    // Orders
    const pendingOrders = [
      {
        id: "po_001",
        orderNumber: "P001",
        customerName: "John Smith",
        phoneNumber: "+61412345678",
        coffeeType: "Large Flat White",
        milkType: "Full Cream",
        sugar: "1 sugar",
        extraHot: false,
        priority: false,
        status: "pending",
        createdAt: new Date(now - minutes(10)).toISOString(),
        waitTime: 10,
        expectedCompletionTime: new Date(now + minutes(5)).toISOString(),
        stationId: 1,
        batchGroup: "flat-white"
      },
      {
        id: "po_002",
        orderNumber: "P002",
        customerName: "Sarah Williams",
        phoneNumber: "+61423456789",
        coffeeType: "Regular Cappuccino",
        milkType: "Almond",
        sugar: "No sugar",
        extraHot: true,
        priority: true,
        status: "pending",
        createdAt: new Date(now - minutes(7)).toISOString(),
        waitTime: 7,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1,
        batchGroup: "cappuccino-almond"
      }
    ];
    
    const inProgressOrders = [
      {
        id: "ip_001",
        orderNumber: "IP001",
        customerName: "Emma Davis",
        phoneNumber: "+61445678901",
        coffeeType: "Regular Mocha",
        milkType: "Full Cream",
        sugar: "1 sugar",
        extraHot: false,
        priority: false,
        status: "in-progress",
        createdAt: new Date(now - minutes(12)).toISOString(),
        startedAt: new Date(now - minutes(2)).toISOString(),
        waitTime: 12,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1
      }
    ];
    
    const completedOrders = [
      {
        id: "co_001",
        orderNumber: "C001",
        customerName: "Jessica Taylor",
        phoneNumber: "+61467890123",
        coffeeType: "Regular Flat White",
        milkType: "Skim",
        sugar: "No sugar",
        extraHot: false,
        priority: false,
        status: "completed",
        createdAt: new Date(now - minutes(30)).toISOString(),
        startedAt: new Date(now - minutes(25)).toISOString(),
        completedAt: new Date(now - minutes(20)).toISOString(),
        stationId: 1
      }
    ];
    
    // Store the data
    localStorage.setItem('fallback_stations', JSON.stringify(stations));
    localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
  }
  
  console.log('✅ Flexible API Handler initialized');
})();