/**
 * API Connection Fix
 * 
 * This script specifically addresses issues with connecting to the backend API
 * by ensuring the proxy is working correctly and removing any blocks
 */
(function() {
  console.log('🔧 Starting API connection fix...');
  
  // Configuration
  const config = {
    apiUrl: 'http://localhost:5001/api',
    proxyUrl: '/api',  // This should be proxied through the React dev server
    useProxy: true,    // Whether to use the proxy or direct connection
    showUI: true,      // Whether to show the UI
    debug: true,       // Whether to show debug logs
    testEndpoints: [
      '/auth/status',
      '/auth/login',
      '/orders',
      '/stations',
      '/settings'
    ]
  };
  
  // State tracking
  const state = {
    fixesApplied: false,
    testResults: {},
    originalFetch: window.fetch,
    originalXHROpen: XMLHttpRequest.prototype.open,
    loginCredentials: {
      username: 'barista',
      password: 'coffee123'
    }
  };
  
  // Utility functions
  const utils = {
    log: function(message, type = 'info') {
      if (!config.debug && type === 'debug') return;
      
      // Create timestamp
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      
      // Style based on type
      let style = '';
      switch(type) {
        case 'error':
          style = 'color: #ff5252; font-weight: bold';
          break;
        case 'success':
          style = 'color: #4caf50; font-weight: bold';
          break;
        case 'warning':
          style = 'color: #ff9800; font-weight: bold';
          break;
        case 'api':
          style = 'color: #2196f3';
          break;
        default:
          style = 'color: #757575';
      }
      
      // Log to console
      console.log(`[${timestamp}] %c${message}`, style);
      
      // Update UI if it exists
      this.updateUI(message, type);
    },
    
    updateUI: function(message, type = 'info') {
      // If UI is disabled or not created yet, do nothing
      if (!config.showUI || !document.getElementById('api-fix-log')) return;
      
      // Create log entry
      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = message;
      
      // Add to log
      const log = document.getElementById('api-fix-log');
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    },
    
    updateStatus: function(message, type = 'info') {
      // If UI is disabled or not created yet, do nothing
      if (!config.showUI || !document.getElementById('api-fix-status')) return;
      
      // Update status
      const status = document.getElementById('api-fix-status');
      status.textContent = message;
      
      // Update color based on type
      switch(type) {
        case 'error':
          status.style.color = '#ff5252';
          break;
        case 'success':
          status.style.color = '#4caf50';
          break;
        case 'warning':
          status.style.color = '#ff9800';
          break;
        default:
          status.style.color = '#757575';
      }
    },
    
    removeApiBlocking: function() {
      this.log('Removing API blocking...', 'info');
      
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
        this.log('Restored original fetch function', 'success');
      }
      
      if (window.originalXHROpen && XMLHttpRequest.prototype.open !== window.originalXHROpen) {
        XMLHttpRequest.prototype.open = window.originalXHROpen;
        this.log('Restored original XMLHttpRequest.open function', 'success');
      }
      
      this.log('API blocking removed', 'success');
      return true;
    },
    
    checkLocalStorage: function() {
      this.log('Checking localStorage for fallback data...', 'info');
      
      // Known fallback data keys
      const fallbackKeys = [
        'fallback_pending_orders',
        'fallback_in_progress_orders',
        'fallback_completed_orders',
        'sample_orders',
        'demo_orders',
        'coffee_fallback_data'
      ];
      
      // Fallback flags
      const fallbackFlags = [
        { key: 'use_fallback_data', value: 'true' },
        { key: 'force_offline_mode', value: 'true' },
        { key: 'coffee_connection_status', value: 'offline' },
        { key: 'api_mode', value: 'offline' },
        { key: 'force_demo_mode', value: 'true' }
      ];
      
      // Check for fallback data
      let foundData = false;
      fallbackKeys.forEach(key => {
        if (localStorage.getItem(key)) {
          this.log(`Found fallback data: ${key}`, 'warning');
          foundData = true;
        }
      });
      
      // Check for fallback flags
      let foundFlags = false;
      fallbackFlags.forEach(flag => {
        if (localStorage.getItem(flag.key) === flag.value) {
          this.log(`Found fallback flag: ${flag.key}=${flag.value}`, 'warning');
          foundFlags = true;
        }
      });
      
      return { foundData, foundFlags };
    },
    
    clearLocalStorage: function() {
      this.log('Clearing fallback data from localStorage...', 'info');
      
      // Known fallback data keys
      const fallbackKeys = [
        'fallback_pending_orders',
        'fallback_in_progress_orders',
        'fallback_completed_orders',
        'sample_orders',
        'demo_orders',
        'coffee_fallback_data'
      ];
      
      // Clear fallback data
      fallbackKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // Clear fallback flags
      localStorage.removeItem('use_fallback_data');
      localStorage.removeItem('force_offline_mode');
      localStorage.setItem('coffee_connection_status', 'online');
      localStorage.setItem('api_mode', 'online');
      localStorage.removeItem('use_sample_data');
      localStorage.removeItem('use_offline_mode');
      localStorage.removeItem('force_demo_mode');
      
      this.log('Fallback data cleared', 'success');
      return true;
    },
    
    createJwtToken: function() {
      this.log('Creating JWT token...', 'info');
      
      // Create token header
      const header = {
        alg: 'HS256',
        typ: 'JWT'
      };
      
      // Create token payload
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: 'barista',
        name: 'Barista User',
        role: 'barista',
        iat: now,
        exp: now + 86400 * 30,
        jti: 'fix-' + Math.random().toString(36).substring(2)
      };
      
      // Encode parts
      const encodeBase64 = (obj) => {
        return btoa(JSON.stringify(obj))
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      };
      
      const headerEncoded = encodeBase64(header);
      const payloadEncoded = encodeBase64(payload);
      
      // Create signature
      const signature = btoa('signature-placeholder')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      
      // Combine to form token
      const token = `${headerEncoded}.${payloadEncoded}.${signature}`;
      
      // Store token
      localStorage.setItem('coffee_auth_token', token);
      localStorage.setItem('authenticated', 'true');
      localStorage.setItem('user_role', 'barista');
      localStorage.setItem('user_name', 'Barista User');
      
      this.log('JWT token created and stored', 'success');
      return token;
    },
    
    testEndpoint: async function(endpoint) {
      // Determine full URL
      const url = config.useProxy ? 
        `${config.proxyUrl}${endpoint}` : 
        `${config.apiUrl}${endpoint}`;
        
      this.log(`Testing endpoint: ${url}`, 'api');
      
      try {
        // Create headers
        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
        
        // Add auth token if available
        const token = localStorage.getItem('coffee_auth_token');
        if (token && endpoint !== '/auth/login') {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Prepare request options
        const options = {
          method: endpoint === '/auth/login' ? 'POST' : 'GET',
          headers: headers,
          credentials: 'include'
        };
        
        // Add body for login request
        if (endpoint === '/auth/login') {
          options.body = JSON.stringify(state.loginCredentials);
        }
        
        // Make request
        const response = await fetch(url, options);
        
        // Try to parse response as JSON
        let data;
        try {
          data = await response.json();
        } catch(e) {
          data = { error: 'Could not parse response as JSON' };
        }
        
        // Log result
        if (response.ok) {
          this.log(`✅ ${endpoint}: ${response.status} ${response.statusText}`, 'success');
        } else {
          this.log(`❌ ${endpoint}: ${response.status} ${response.statusText}`, 'error');
        }
        
        // Store result
        state.testResults[endpoint] = {
          success: response.ok,
          status: response.status,
          data: data
        };
        
        // Update UI
        this.updateTestResults(endpoint, response.ok, response.status, data);
        
        return {
          success: response.ok,
          status: response.status,
          data: data
        };
      } catch(error) {
        this.log(`❌ ${endpoint}: ${error.message}`, 'error');
        
        // Store result
        state.testResults[endpoint] = {
          success: false,
          status: 0,
          error: error.message
        };
        
        // Update UI
        this.updateTestResults(endpoint, false, 0, { error: error.message });
        
        return {
          success: false,
          status: 0,
          error: error.message
        };
      }
    },
    
    updateTestResults: function(endpoint, success, status, data) {
      // If UI is disabled or not created yet, do nothing
      if (!config.showUI || !document.getElementById('api-test-results')) return;
      
      // Find or create result element
      let resultEl = document.getElementById(`test-result-${endpoint.replace(/\//g, '-')}`);
      
      if (!resultEl) {
        resultEl = document.createElement('div');
        resultEl.id = `test-result-${endpoint.replace(/\//g, '-')}`;
        resultEl.className = 'test-result';
        document.getElementById('api-test-results').appendChild(resultEl);
      }
      
      // Update result
      resultEl.className = `test-result ${success ? 'success' : 'error'}`;
      resultEl.innerHTML = `
        <div class="endpoint">${endpoint}</div>
        <div class="status">${status}</div>
        <div class="data">${JSON.stringify(data).substring(0, 100)}${JSON.stringify(data).length > 100 ? '...' : ''}</div>
      `;
    },
    
    goToBarista: function() {
      this.log('Attempting to navigate to Barista interface...', 'info');
      
      // First check if there's a link
      const links = Array.from(document.querySelectorAll('a'));
      const baristaLink = links.find(link => {
        return link.textContent.toLowerCase().includes('barista') || 
               (link.href && link.href.toLowerCase().includes('barista')) ||
               (link.id && link.id.toLowerCase().includes('barista')) ||
               (link.className && link.className.toLowerCase().includes('barista'));
      });
      
      if (baristaLink) {
        this.log('Found Barista link, clicking it', 'success');
        baristaLink.click();
        return true;
      }
      
      // Check if we're already on a barista page
      if (window.location.pathname.includes('barista') || 
          document.title.toLowerCase().includes('barista')) {
        this.log('Already on Barista interface', 'success');
        return true;
      }
      
      // Try to find barista elements
      const baristaElements = document.querySelectorAll('[class*=barista], [id*=barista]');
      if (baristaElements.length > 0) {
        this.log(`Found ${baristaElements.length} Barista elements, might already be on Barista interface`, 'success');
        return true;
      }
      
      // Try each path
      this.log('No Barista link found, trying common paths', 'warning');
      
      // Get current base URL
      const baseUrl = window.location.origin;
      
      // Create links to possible paths
      const paths = [
        '/barista',
        '/app/barista',
        '/baristainterface',
        '/interface/barista',
        '/barista/dashboard',
        '/barista-interface'
      ];
      
      // Try the first path
      this.log(`Navigating to ${baseUrl}/barista`, 'info');
      window.location.href = `${baseUrl}/barista`;
      
      return false;
    }
  };
  
  // Fix methods
  const fixes = {
    // Apply all fixes
    applyAllFixes: function() {
      utils.log('Applying all fixes...', 'info');
      utils.updateStatus('Applying fixes...', 'info');
      
      // Remove API blocking
      utils.removeApiBlocking();
      
      // Clear localStorage
      utils.clearLocalStorage();
      
      // Create JWT token
      utils.createJwtToken();
      
      state.fixesApplied = true;
      utils.log('All fixes applied', 'success');
      utils.updateStatus('All fixes applied, testing API connection...', 'success');
      
      // Test API connection
      setTimeout(() => {
        tests.testAllEndpoints();
      }, 500);
      
      return true;
    }
  };
  
  // Test methods
  const tests = {
    // Test all endpoints
    testAllEndpoints: async function() {
      utils.log('Testing all endpoints...', 'info');
      utils.updateStatus('Testing API connection...', 'info');
      
      // Clear previous results
      state.testResults = {};
      
      // Track success count
      let successCount = 0;
      
      // Test each endpoint
      for (const endpoint of config.testEndpoints) {
        const result = await utils.testEndpoint(endpoint);
        if (result.success) {
          successCount++;
        }
      }
      
      // Update status
      if (successCount === config.testEndpoints.length) {
        utils.log('All endpoints tested successfully', 'success');
        utils.updateStatus('API connection successful!', 'success');
      } else if (successCount > 0) {
        utils.log(`${successCount} of ${config.testEndpoints.length} endpoints tested successfully`, 'warning');
        utils.updateStatus(`Partial API connection: ${successCount}/${config.testEndpoints.length} successful`, 'warning');
      } else {
        utils.log('All endpoint tests failed', 'error');
        utils.updateStatus('API connection failed', 'error');
      }
      
      return {
        success: successCount > 0,
        successCount,
        totalCount: config.testEndpoints.length
      };
    }
  };
  
  // UI methods
  const ui = {
    // Create UI
    createUI: function() {
      // If UI is disabled, do nothing
      if (!config.showUI) return;
      
      // Create container if it doesn't exist
      if (!document.getElementById('api-fix-container')) {
        // Create styles
        const style = document.createElement('style');
        style.textContent = `
          #api-fix-container {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            background-color: rgba(33, 33, 33, 0.9);
            color: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
            font-family: system-ui, -apple-system, sans-serif;
            z-index: 10000;
          }
          
          #api-fix-container h3 {
            margin: 0 0 10px 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          
          #api-fix-container .close-button {
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            padding: 0;
          }
          
          #api-fix-status {
            margin-bottom: 10px;
            padding: 8px;
            background-color: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
          }
          
          #api-test-results {
            margin-bottom: 10px;
            background-color: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            padding: 8px;
          }
          
          #api-test-results .test-result {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            padding: 5px;
            border-radius: 4px;
          }
          
          #api-test-results .test-result.success {
            background-color: rgba(76, 175, 80, 0.3);
          }
          
          #api-test-results .test-result.error {
            background-color: rgba(244, 67, 54, 0.3);
          }
          
          #api-test-results .test-result .endpoint {
            flex: 1;
          }
          
          #api-test-results .test-result .status {
            width: 50px;
            text-align: center;
          }
          
          #api-test-results .test-result .data {
            flex: 2;
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          
          #api-fix-log {
            height: 150px;
            overflow-y: auto;
            background-color: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            padding: 8px;
            font-family: monospace;
            font-size: 12px;
            margin-bottom: 10px;
          }
          
          #api-fix-log .log-entry {
            margin-bottom: 5px;
          }
          
          #api-fix-log .log-error {
            color: #ff5252;
          }
          
          #api-fix-log .log-success {
            color: #4caf50;
          }
          
          #api-fix-log .log-warning {
            color: #ff9800;
          }
          
          #api-fix-log .log-api {
            color: #2196f3;
          }
          
          #api-fix-buttons {
            display: flex;
            gap: 10px;
          }
          
          #api-fix-buttons button {
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            color: white;
            font-weight: bold;
          }
          
          #apply-fixes-button {
            background-color: #2196f3;
          }
          
          #test-api-button {
            background-color: #ff9800;
          }
          
          #go-barista-button {
            background-color: #4caf50;
          }
        `;
        document.head.appendChild(style);
        
        // Create container
        const container = document.createElement('div');
        container.id = 'api-fix-container';
        
        // Add title
        const title = document.createElement('h3');
        title.textContent = 'API Connection Fix';
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.className = 'close-button';
        closeButton.textContent = '×';
        closeButton.onclick = function() {
          document.body.removeChild(container);
        };
        title.appendChild(closeButton);
        container.appendChild(title);
        
        // Add status
        const status = document.createElement('div');
        status.id = 'api-fix-status';
        status.textContent = 'Initializing...';
        container.appendChild(status);
        
        // Add test results
        const resultsLabel = document.createElement('div');
        resultsLabel.textContent = 'API Test Results:';
        resultsLabel.style.marginBottom = '5px';
        container.appendChild(resultsLabel);
        
        const results = document.createElement('div');
        results.id = 'api-test-results';
        container.appendChild(results);
        
        // Add log
        const logLabel = document.createElement('div');
        logLabel.textContent = 'Activity Log:';
        logLabel.style.marginBottom = '5px';
        container.appendChild(logLabel);
        
        const log = document.createElement('div');
        log.id = 'api-fix-log';
        container.appendChild(log);
        
        // Add buttons
        const buttons = document.createElement('div');
        buttons.id = 'api-fix-buttons';
        
        // Apply fixes button
        const applyFixesButton = document.createElement('button');
        applyFixesButton.id = 'apply-fixes-button';
        applyFixesButton.textContent = 'Apply Fixes';
        applyFixesButton.onclick = function() {
          fixes.applyAllFixes();
        };
        buttons.appendChild(applyFixesButton);
        
        // Test API button
        const testApiButton = document.createElement('button');
        testApiButton.id = 'test-api-button';
        testApiButton.textContent = 'Test API';
        testApiButton.onclick = function() {
          tests.testAllEndpoints();
        };
        buttons.appendChild(testApiButton);
        
        // Go to barista button
        const goBaristaButton = document.createElement('button');
        goBaristaButton.id = 'go-barista-button';
        goBaristaButton.textContent = 'Go to Barista';
        goBaristaButton.onclick = function() {
          utils.goToBarista();
        };
        buttons.appendChild(goBaristaButton);
        
        container.appendChild(buttons);
        
        // Add to body
        document.body.appendChild(container);
      }
    }
  };
  
  // Initialize
  const init = function() {
    // Create UI
    ui.createUI();
    
    // Log start
    utils.log('API connection fix initialized', 'success');
    utils.updateStatus('Ready to apply fixes', 'info');
    
    // Check localStorage
    const { foundData, foundFlags } = utils.checkLocalStorage();
    
    // If fallback data or flags found, recommend fixes
    if (foundData || foundFlags) {
      utils.log('Fallback data or flags found, recommend applying fixes', 'warning');
      utils.updateStatus('Fallback data detected, click Apply Fixes', 'warning');
    } else {
      utils.log('No fallback data or flags found, testing API connection', 'info');
      
      // Test API connection
      setTimeout(() => {
        tests.testAllEndpoints();
      }, 500);
    }
  };
  
  // Run init
  init();
})();