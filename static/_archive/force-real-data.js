/**
 * Force Real Data
 * This script forces the app to use real data by:
 * 1. Removing API blocking
 * 2. Restoring original fetch & XHR
 * 3. Using a simple local test backend if real API is unavailable
 */
(function() {
  console.log('🔧 Force Real Data: Starting setup');
  
  // Check if we're already running
  if (window.forceRealDataActive) {
    console.log('🔧 Force Real Data: Already running');
    return;
  }
  
  // Mark as running
  window.forceRealDataActive = true;
  
  // Save originals before they get messed with
  window.originalFetchNative = window.originalFetchNative || window.fetch;
  window.originalXHROpenNative = window.originalXHROpenNative || XMLHttpRequest.prototype.open;
  window.originalXHRSendNative = window.originalXHRSendNative || XMLHttpRequest.prototype.send;
  
  // Configuration
  const config = {
    apiUrl: 'http://localhost:5001/api',
    mockApiPort: 5001,
    defaultWaitTime: 15,
    fixesApplied: false,
    mockEnabled: true,
    mockDelayMs: 100,
    stationId: 1
  };
  
  // Storage for mock data
  const mockData = {
    orders: [],
    stations: [],
    pendingOrders: [],
    inProgressOrders: [],
    completedOrders: [],
    settings: {}
  };
  
  // Mock order generation
  const generateMockData = function() {
    console.log('📊 Generating mock data');
    
    // Generate stations
    mockData.stations = [
      { id: 1, name: 'Main Bar', status: 'active', type: 'espresso' },
      { id: 2, name: 'Side Bar', status: 'active', type: 'drip' },
      { id: 3, name: 'Specialty Bar', status: 'inactive', type: 'specialty' }
    ];
    
    // Generate pending orders
    mockData.pendingOrders = [
      {
        id: 'p1',
        orderNumber: 'A001',
        customerName: 'John Smith',
        coffeeType: 'Flat White',
        milkType: 'Regular',
        sugar: 'No sugar',
        createdAt: new Date(Date.now() - 600000).toISOString(),
        status: 'pending',
        stationId: 1,
        waitTime: config.defaultWaitTime
      },
      {
        id: 'p2',
        orderNumber: 'A002',
        customerName: 'Alice Brown',
        coffeeType: 'Cappuccino',
        milkType: 'Almond',
        sugar: '1 sugar',
        createdAt: new Date(Date.now() - 540000).toISOString(),
        status: 'pending',
        stationId: 1,
        waitTime: config.defaultWaitTime
      },
      {
        id: 'p3',
        orderNumber: 'A003',
        customerName: 'David Jones',
        coffeeType: 'Latte',
        milkType: 'Oat',
        sugar: '2 sugars',
        createdAt: new Date(Date.now() - 480000).toISOString(),
        status: 'pending',
        stationId: 2,
        waitTime: config.defaultWaitTime
      }
    ];
    
    // Generate in-progress orders
    mockData.inProgressOrders = [
      {
        id: 'i1',
        orderNumber: 'A004',
        customerName: 'Emma Wilson',
        coffeeType: 'Espresso',
        milkType: 'None',
        sugar: 'No sugar',
        createdAt: new Date(Date.now() - 420000).toISOString(),
        status: 'in_progress',
        stationId: 1,
        waitTime: config.defaultWaitTime
      }
    ];
    
    // Generate completed orders
    mockData.completedOrders = [
      {
        id: 'c1',
        orderNumber: 'A005',
        customerName: 'Michael Taylor',
        coffeeType: 'Mocha',
        milkType: 'Regular',
        sugar: '1 sugar',
        createdAt: new Date(Date.now() - 360000).toISOString(),
        completedAt: new Date(Date.now() - 300000).toISOString(),
        status: 'completed',
        stationId: 1,
        waitTime: config.defaultWaitTime
      },
      {
        id: 'c2',
        orderNumber: 'A006',
        customerName: 'Sarah Johnson',
        coffeeType: 'Americano',
        milkType: 'None',
        sugar: 'No sugar',
        createdAt: new Date(Date.now() - 300000).toISOString(),
        completedAt: new Date(Date.now() - 240000).toISOString(),
        status: 'completed',
        stationId: 2,
        waitTime: config.defaultWaitTime
      }
    ];
    
    // Combine all orders
    mockData.orders = [
      ...mockData.pendingOrders,
      ...mockData.inProgressOrders,
      ...mockData.completedOrders
    ];
    
    // Generate settings
    mockData.settings = {
      defaultWaitTime: config.defaultWaitTime,
      notificationsEnabled: true,
      displayName: 'Coffee on Cue',
      stationId: config.stationId
    };
    
    console.log('📊 Mock data generated: ' + mockData.orders.length + ' orders');
  };
  
  // Mock API handlers
  const mockApiHandlers = {
    // Authentication
    'POST /api/auth/login': function(body) {
      // Accept any username/password for now
      const username = body?.username || 'barista';
      const role = body?.username === 'admin' ? 'admin' : 'barista';
      
      // Create a token
      const token = createJwtToken(username, role);
      
      return {
        status: 200,
        data: {
          token: token,
          user: {
            id: '123',
            username: username,
            name: username.charAt(0).toUpperCase() + username.slice(1),
            role: role
          }
        }
      };
    },
    
    'GET /api/auth/status': function() {
      const token = localStorage.getItem('coffee_auth_token');
      
      if (!token) {
        return { 
          status: 401, 
          data: { error: 'Not authenticated' } 
        };
      }
      
      return {
        status: 200,
        data: {
          authenticated: true,
          user: {
            id: '123',
            username: 'barista',
            name: 'Barista',
            role: 'barista'
          }
        }
      };
    },
    
    // Orders
    'GET /api/orders': function() {
      return { status: 200, data: mockData.orders };
    },
    
    'GET /api/orders/pending': function() {
      return { status: 200, data: mockData.pendingOrders };
    },
    
    'GET /api/orders/in-progress': function() {
      return { status: 200, data: mockData.inProgressOrders };
    },
    
    'GET /api/orders/completed': function() {
      return { status: 200, data: mockData.completedOrders };
    },
    
    'POST /api/orders': function(body) {
      const newOrder = {
        id: 'new_' + Date.now(),
        orderNumber: 'A' + (Math.floor(Math.random() * 1000)).toString().padStart(3, '0'),
        customerName: body.customerName || 'New Customer',
        coffeeType: body.coffeeType || 'Espresso',
        milkType: body.milkType || 'Regular',
        sugar: body.sugar || 'No sugar',
        createdAt: new Date().toISOString(),
        status: 'pending',
        stationId: body.stationId || config.stationId,
        waitTime: config.defaultWaitTime
      };
      
      mockData.orders.push(newOrder);
      mockData.pendingOrders.push(newOrder);
      
      return { status: 201, data: newOrder };
    },
    
    'PUT /api/orders/:id': function(body, params) {
      const id = params.id;
      const order = mockData.orders.find(o => o.id === id);
      
      if (!order) {
        return { status: 404, data: { error: 'Order not found' } };
      }
      
      // Update order
      Object.assign(order, body);
      
      // Update status lists
      if (body.status) {
        // Remove from all lists
        mockData.pendingOrders = mockData.pendingOrders.filter(o => o.id !== id);
        mockData.inProgressOrders = mockData.inProgressOrders.filter(o => o.id !== id);
        mockData.completedOrders = mockData.completedOrders.filter(o => o.id !== id);
        
        // Add to correct list
        if (body.status === 'pending') {
          mockData.pendingOrders.push(order);
        } else if (body.status === 'in_progress') {
          mockData.inProgressOrders.push(order);
        } else if (body.status === 'completed') {
          order.completedAt = new Date().toISOString();
          mockData.completedOrders.push(order);
        }
      }
      
      return { status: 200, data: order };
    },
    
    // Stations
    'GET /api/stations': function() {
      return { status: 200, data: mockData.stations };
    },
    
    // Settings
    'GET /api/settings': function() {
      return { status: 200, data: mockData.settings };
    },
    
    // Health check
    'GET /api/health': function() {
      return { 
        status: 200, 
        data: { status: 'ok', timestamp: new Date().toISOString() } 
      };
    }
  };
  
  // Match route pattern
  const matchRoute = function(method, url, routes) {
    for (const route in routes) {
      const [routeMethod, routePath] = route.split(' ');
      
      if (routeMethod !== method) {
        continue;
      }
      
      // Check for exact match
      if (routePath === url) {
        return { match: routes[route], params: {} };
      }
      
      // Check for parameterized route
      if (routePath.includes(':')) {
        const routeParts = routePath.split('/');
        const urlParts = url.split('/');
        
        if (routeParts.length !== urlParts.length) {
          continue;
        }
        
        let isMatch = true;
        const params = {};
        
        for (let i = 0; i < routeParts.length; i++) {
          if (routeParts[i].startsWith(':')) {
            // This is a parameter
            const paramName = routeParts[i].substring(1);
            params[paramName] = urlParts[i];
          } else if (routeParts[i] !== urlParts[i]) {
            // Not a match
            isMatch = false;
            break;
          }
        }
        
        if (isMatch) {
          return { match: routes[route], params: params };
        }
      }
    }
    
    return { match: null, params: {} };
  };
  
  // Handle mock API request
  const handleMockApiRequest = function(method, url, body) {
    // Clean up URL by removing query string
    const cleanUrl = url.split('?')[0];
    
    // Find matching route
    const { match, params } = matchRoute(method, cleanUrl, mockApiHandlers);
    
    if (match) {
      // Simulate network delay
      return new Promise(resolve => {
        setTimeout(() => {
          const result = match(body, params);
          resolve(result);
        }, config.mockDelayMs);
      });
    }
    
    // No route found
    return Promise.resolve({
      status: 404,
      data: { error: 'Not found' }
    });
  };
  
  // Create JWT token
  const createJwtToken = function(username, role) {
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: username,
      name: username.charAt(0).toUpperCase() + username.slice(1),
      role: role,
      iat: now,
      exp: now + 86400 * 30,
      jti: 'mock-' + Math.random().toString(36).substring(2)
    };
    
    // Encode JWT parts
    const encodeBase64 = (obj) => {
      return btoa(JSON.stringify(obj))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };
    
    const headerEncoded = encodeBase64(header);
    const payloadEncoded = encodeBase64(payload);
    
    // Generate a signature
    const signature = btoa('signature-placeholder')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    return `${headerEncoded}.${payloadEncoded}.${signature}`;
  };
  
  // Remove API blocking
  const removeApiBlocking = function() {
    console.log('🔓 Removing API blocking');
    
    // Disable any API blocking flags
    window.blockAPI = false;
    window.isAPIBlocked = false;
    
    // Clean up localStorage
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('force_offline_mode');
    localStorage.setItem('coffee_connection_status', 'online');
    localStorage.setItem('api_mode', 'online');
    
    // Additional flags that might exist
    localStorage.removeItem('use_sample_data');
    localStorage.removeItem('use_offline_mode');
    localStorage.removeItem('force_demo_mode');
    
    // Remove any existing function wrappers and restore originals
    if (window.originalFetch && window.fetch !== window.originalFetch) {
      window.fetch = window.originalFetch;
      console.log('🔄 Restored original fetch function');
    }
    
    if (window.originalXHROpen && XMLHttpRequest.prototype.open !== window.originalXHROpen) {
      XMLHttpRequest.prototype.open = window.originalXHROpen;
      console.log('🔄 Restored original XMLHttpRequest.open function');
    }
    
    if (window.originalXHRSend && XMLHttpRequest.prototype.send !== window.originalXHRSend) {
      XMLHttpRequest.prototype.send = window.originalXHRSend;
      console.log('🔄 Restored original XMLHttpRequest.send function');
    }
    
    // Set a jwt token if not present
    if (!localStorage.getItem('coffee_auth_token')) {
      const token = createJwtToken('barista', 'barista');
      localStorage.setItem('coffee_auth_token', token);
      localStorage.setItem('authenticated', 'true');
      localStorage.setItem('user_role', 'barista');
      localStorage.setItem('user_name', 'Barista');
      console.log('🔑 Created and saved authentication token');
    }
    
    console.log('✅ API blocking disabled');
  };
  
  // Intercept fetch and handle API urls
  const interceptFetch = function() {
    console.log('🔄 Intercepting fetch requests');
    
    // Remember original
    const originalFetch = window.fetch;
    
    // Replace fetch
    window.fetch = async function(resource, init) {
      const url = typeof resource === 'string' ? resource : resource.url;
      
      // Only intercept API calls
      if (typeof url === 'string' && url.includes('/api/')) {
        console.log(`🔄 Intercepted fetch: ${url}`);
        
        const method = init?.method || 'GET';
        let body = null;
        
        // Try to parse body if it exists
        if (init?.body) {
          try {
            body = JSON.parse(init.body);
          } catch (e) {
            console.log('⚠️ Could not parse request body');
          }
        }
        
        // First try the real API
        try {
          console.log(`🌐 Trying real API: ${method} ${url}`);
          const realResponse = await originalFetch(resource, init);
          
          // If we get a successful response, use it
          if (realResponse.ok) {
            console.log(`✅ Real API success: ${url}`);
            return realResponse;
          }
          
          console.log(`❌ Real API error (${realResponse.status}): ${url}`);
          
          // If mock is disabled, just return the real response
          if (!config.mockEnabled) {
            return realResponse;
          }
          
          // Otherwise, fall back to mock API
          console.log(`🔄 Falling back to mock API: ${url}`);
          
          // Extract API path
          const apiPath = url.includes('//') ? 
            '/api' + url.split('/api')[1] : url;
          
          // Call mock API
          const mockResult = await handleMockApiRequest(method, apiPath, body);
          
          // Create a mock response object
          return new Response(JSON.stringify(mockResult.data), {
            status: mockResult.status,
            headers: {
              'Content-Type': 'application/json'
            }
          });
        } catch (e) {
          console.log(`❌ Error with real API: ${e.message}`);
          
          // If mock is disabled, just throw
          if (!config.mockEnabled) {
            throw e;
          }
          
          // Otherwise, fall back to mock API
          console.log(`🔄 Falling back to mock API: ${url}`);
          
          // Extract API path
          const apiPath = url.includes('//') ? 
            '/api' + url.split('/api')[1] : url;
          
          // Call mock API
          const mockResult = await handleMockApiRequest(method, apiPath, body);
          
          // Create a mock response object
          return new Response(JSON.stringify(mockResult.data), {
            status: mockResult.status,
            headers: {
              'Content-Type': 'application/json'
            }
          });
        }
      }
      
      // For non-API calls, use original fetch
      return originalFetch.apply(this, arguments);
    };
    
    console.log('✅ Fetch intercepted');
  };
  
  // Intercept XMLHttpRequest
  const interceptXHR = function() {
    console.log('🔄 Intercepting XMLHttpRequest');
    
    // Remember originals
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    // Replace open to track URL
    XMLHttpRequest.prototype.open = function(method, url) {
      this._method = method;
      this._url = url;
      this._body = null;
      
      return originalOpen.apply(this, arguments);
    };
    
    // Replace send to handle API calls
    XMLHttpRequest.prototype.send = function(body) {
      // Save body
      this._body = body;
      
      // Only intercept API calls
      if (this._url && typeof this._url === 'string' && this._url.includes('/api/')) {
        console.log(`🔄 Intercepted XHR: ${this._method} ${this._url}`);
        
        // Parse body if it exists
        let parsedBody = null;
        if (body) {
          try {
            parsedBody = JSON.parse(body);
          } catch (e) {
            console.log('⚠️ Could not parse XHR body');
          }
        }
        
        // Handle API call
        const handleApiCall = async () => {
          try {
            // First try the real API
            console.log(`🌐 Trying real API: ${this._method} ${this._url}`);
            
            // Let the original call go through
            originalSend.call(this, body);
            
            // We don't need to do anything else here - the XHR will handle the response
          } catch (e) {
            console.log(`❌ Error with real API XHR: ${e.message}`);
            
            // If mock is disabled, just throw
            if (!config.mockEnabled) {
              throw e;
            }
            
            // Otherwise, fall back to mock API
            console.log(`🔄 Falling back to mock API XHR: ${this._url}`);
            
            // Extract API path
            const apiPath = this._url.includes('//') ? 
              '/api' + this._url.split('/api')[1] : this._url;
            
            // Call mock API
            const mockResult = await handleMockApiRequest(this._method, apiPath, parsedBody);
            
            // Create a mock XHR response
            Object.defineProperty(this, 'status', { value: mockResult.status });
            Object.defineProperty(this, 'statusText', { value: mockResult.status === 200 ? 'OK' : 'Error' });
            Object.defineProperty(this, 'response', { value: mockResult.data });
            Object.defineProperty(this, 'responseText', { value: JSON.stringify(mockResult.data) });
            
            // Trigger readystatechange and load events
            Object.defineProperty(this, 'readyState', { value: 4 });
            
            // Fire events
            const readyStateEvent = new Event('readystatechange');
            this.dispatchEvent(readyStateEvent);
            
            const loadEvent = new Event('load');
            this.dispatchEvent(loadEvent);
          }
        };
        
        // Start the API call handling
        handleApiCall();
        
        // Return without calling the original send
        return;
      }
      
      // For non-API calls, use the original send
      return originalSend.apply(this, arguments);
    };
    
    console.log('✅ XMLHttpRequest intercepted');
  };
  
  // Initialize the system
  const init = function() {
    console.log('🚀 Initializing force-real-data.js');
    
    // Generate mock data
    generateMockData();
    
    // Remove API blocking
    removeApiBlocking();
    
    // Intercept fetch and XMLHttpRequest
    interceptFetch();
    //interceptXHR();
    
    console.log('✅ force-real-data.js initialized');
    
    // Create UI
    createUI();
  };
  
  // Create UI
  const createUI = function() {
    // Create UI container
    const container = document.createElement('div');
    container.id = 'force-real-data-ui';
    container.style.position = 'fixed';
    container.style.bottom = '10px';
    container.style.right = '10px';
    container.style.backgroundColor = 'rgba(33, 33, 33, 0.8)';
    container.style.color = 'white';
    container.style.padding = '10px';
    container.style.borderRadius = '5px';
    container.style.zIndex = '10000';
    container.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
    container.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    container.style.fontSize = '12px';
    
    // Add title
    const title = document.createElement('div');
    title.textContent = 'Real Data Switcher';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '5px';
    title.style.display = 'flex';
    title.style.justifyContent = 'space-between';
    title.style.alignItems = 'center';
    container.appendChild(title);
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'X';
    closeButton.style.backgroundColor = 'transparent';
    closeButton.style.border = 'none';
    closeButton.style.color = 'white';
    closeButton.style.cursor = 'pointer';
    closeButton.style.padding = '0';
    closeButton.style.marginLeft = '5px';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    title.appendChild(closeButton);
    
    // Add toggle
    const toggle = document.createElement('div');
    toggle.style.display = 'flex';
    toggle.style.alignItems = 'center';
    toggle.style.marginBottom = '5px';
    
    const toggleLabel = document.createElement('label');
    toggleLabel.textContent = 'Use mock data fallback: ';
    toggleLabel.style.marginRight = '5px';
    toggle.appendChild(toggleLabel);
    
    const toggleCheckbox = document.createElement('input');
    toggleCheckbox.type = 'checkbox';
    toggleCheckbox.checked = config.mockEnabled;
    toggleCheckbox.onchange = function() {
      config.mockEnabled = this.checked;
      console.log(`${config.mockEnabled ? '✅' : '❌'} Mock data fallback ${config.mockEnabled ? 'enabled' : 'disabled'}`);
    };
    toggle.appendChild(toggleCheckbox);
    
    container.appendChild(toggle);
    
    // Add info
    const info = document.createElement('div');
    info.textContent = 'API is unblocked. Trying real APIs first, with mock data fallback.';
    info.style.marginBottom = '5px';
    container.appendChild(info);
    
    // Add buttons container
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '5px';
    container.appendChild(buttons);
    
    // Add retry button
    const retryButton = document.createElement('button');
    retryButton.textContent = 'Retry API';
    retryButton.style.backgroundColor = '#2196f3';
    retryButton.style.color = 'white';
    retryButton.style.border = 'none';
    retryButton.style.borderRadius = '3px';
    retryButton.style.padding = '3px 6px';
    retryButton.style.cursor = 'pointer';
    retryButton.onclick = function() {
      // Reset everything
      removeApiBlocking();
      
      // Try to trigger a refresh of data
      const event = new CustomEvent('force-refresh');
      window.dispatchEvent(event);
      
      console.log('🔄 Forced API retry');
    };
    buttons.appendChild(retryButton);
    
    // Add barista button
    const baristaButton = document.createElement('button');
    baristaButton.textContent = 'Go to Barista';
    baristaButton.style.backgroundColor = '#4caf50';
    baristaButton.style.color = 'white';
    baristaButton.style.border = 'none';
    baristaButton.style.borderRadius = '3px';
    baristaButton.style.padding = '3px 6px';
    baristaButton.style.cursor = 'pointer';
    baristaButton.onclick = function() {
      // Get current URL base
      const baseUrl = window.location.origin;
      
      // Attempt to navigate to barista interface
      const possiblePaths = [
        '/barista',
        '/app/barista',
        '/baristainterface',
        '/interface/barista',
        '/barista/dashboard',
        '/barista-interface'
      ];
      
      // First check if there's a link
      const links = Array.from(document.querySelectorAll('a'));
      const baristaLink = links.find(link => {
        return link.textContent.toLowerCase().includes('barista') || 
               (link.href && link.href.toLowerCase().includes('barista')) ||
               (link.id && link.id.toLowerCase().includes('barista')) ||
               (link.className && link.className.toLowerCase().includes('barista'));
      });
      
      if (baristaLink) {
        console.log('🔗 Found barista link, clicking it');
        baristaLink.click();
        return;
      }
      
      // Try to find a React component that might be the barista interface
      console.log('🔍 Looking for barista interface elements');
      const baristaElements = document.querySelectorAll('[class*=barista], [id*=barista]');
      
      if (baristaElements.length > 0) {
        console.log(`🔍 Found ${baristaElements.length} barista elements`);
      }
      
      // Try each path
      console.log('🔗 Trying barista paths');
      window.location.href = baseUrl + '/barista';
    };
    buttons.appendChild(baristaButton);
    
    document.body.appendChild(container);
  };
  
  // Run initialization
  init();
})();