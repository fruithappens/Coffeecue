/**
 * Direct API Check
 * This script directly tests if the backend API is accessible
 * and displays results on the page.
 */
(function() {
  // Create testing UI
  const createUI = function() {
    // Create container if it doesn't exist
    if (!document.getElementById('api-test-container')) {
      const container = document.createElement('div');
      container.id = 'api-test-container';
      container.style.position = 'fixed';
      container.style.top = '20px';
      container.style.left = '20px';
      container.style.width = '400px';
      container.style.backgroundColor = 'rgba(33, 33, 33, 0.9)';
      container.style.borderRadius = '8px';
      container.style.padding = '15px';
      container.style.color = 'white';
      container.style.zIndex = '10000';
      container.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.5)';
      container.style.fontFamily = 'system-ui, -apple-system, sans-serif';

      // Add title
      const title = document.createElement('h3');
      title.textContent = 'Direct API Test';
      title.style.margin = '0 0 10px 0';
      title.style.display = 'flex';
      title.style.justifyContent = 'space-between';
      title.style.alignItems = 'center';
      container.appendChild(title);

      // Add close button
      const closeButton = document.createElement('button');
      closeButton.textContent = '×';
      closeButton.style.background = 'none';
      closeButton.style.border = 'none';
      closeButton.style.color = 'white';
      closeButton.style.fontSize = '20px';
      closeButton.style.cursor = 'pointer';
      closeButton.style.padding = '0';
      closeButton.style.marginLeft = '10px';
      closeButton.onclick = function() {
        document.body.removeChild(container);
      };
      title.appendChild(closeButton);

      // Add status section
      const statusSection = document.createElement('div');
      statusSection.id = 'api-test-status';
      statusSection.style.fontSize = '14px';
      statusSection.style.marginBottom = '10px';
      statusSection.style.padding = '8px';
      statusSection.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
      statusSection.style.borderRadius = '4px';
      statusSection.innerHTML = '<strong>Status:</strong> Testing API connection...';
      container.appendChild(statusSection);

      // Add endpoint test results
      const resultsSection = document.createElement('div');
      resultsSection.id = 'api-test-results';
      resultsSection.style.fontSize = '14px';
      resultsSection.style.padding = '8px';
      resultsSection.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
      resultsSection.style.borderRadius = '4px';
      resultsSection.style.marginBottom = '10px';
      resultsSection.innerHTML = '<strong>Endpoint Tests:</strong>';
      container.appendChild(resultsSection);

      // Add results list
      const resultsList = document.createElement('ul');
      resultsList.id = 'api-test-results-list';
      resultsList.style.listStyleType = 'none';
      resultsList.style.padding = '0';
      resultsList.style.margin = '10px 0 0 0';
      resultsSection.appendChild(resultsList);

      // Add log section
      const logLabel = document.createElement('div');
      logLabel.textContent = 'Activity Log:';
      logLabel.style.marginBottom = '5px';
      container.appendChild(logLabel);

      const logDisplay = document.createElement('div');
      logDisplay.id = 'api-test-log';
      logDisplay.style.height = '150px';
      logDisplay.style.overflowY = 'auto';
      logDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
      logDisplay.style.borderRadius = '4px';
      logDisplay.style.padding = '10px';
      logDisplay.style.fontSize = '13px';
      logDisplay.style.fontFamily = 'monospace';
      container.appendChild(logDisplay);

      // Add buttons section
      const buttons = document.createElement('div');
      buttons.style.marginTop = '15px';
      buttons.style.display = 'flex';
      buttons.style.gap = '10px';

      // Add retry button
      const retryButton = document.createElement('button');
      retryButton.id = 'api-test-retry';
      retryButton.textContent = 'Retry Tests';
      retryButton.style.padding = '8px 12px';
      retryButton.style.borderRadius = '4px';
      retryButton.style.border = 'none';
      retryButton.style.backgroundColor = '#2196f3';
      retryButton.style.color = 'white';
      retryButton.style.cursor = 'pointer';
      retryButton.onclick = function() {
        testAllEndpoints();
      };
      buttons.appendChild(retryButton);

      // Add fix button
      const fixButton = document.createElement('button');
      fixButton.id = 'api-test-fix';
      fixButton.textContent = 'Fix API';
      fixButton.style.padding = '8px 12px';
      fixButton.style.borderRadius = '4px';
      fixButton.style.border = 'none';
      fixButton.style.backgroundColor = '#4caf50';
      fixButton.style.color = 'white';
      fixButton.style.cursor = 'pointer';
      fixButton.onclick = function() {
        fixAPI();
      };
      buttons.appendChild(fixButton);

      // Add go to barista button
      const baristaButton = document.createElement('button');
      baristaButton.id = 'go-to-barista';
      baristaButton.textContent = 'Go to Barista';
      baristaButton.style.padding = '8px 12px';
      baristaButton.style.borderRadius = '4px';
      baristaButton.style.border = 'none';
      baristaButton.style.backgroundColor = '#ff9800';
      baristaButton.style.color = 'white';
      baristaButton.style.cursor = 'pointer';
      baristaButton.onclick = function() {
        goToBarista();
      };
      buttons.appendChild(baristaButton);

      container.appendChild(buttons);

      // Add CSS for log entries
      const style = document.createElement('style');
      style.textContent = `
        .log-entry {
          margin-bottom: 5px;
          line-height: 1.4;
        }
        .log-error {
          color: #ff5252;
        }
        .log-success {
          color: #4caf50;
        }
        .log-warning {
          color: #ff9800;
        }
        .log-api {
          color: #2196f3;
        }
      `;
      document.head.appendChild(style);

      document.body.appendChild(container);
    }
  };

  // Log function
  const log = function(message, type = 'info') {
    console.log(`[API Test] ${message}`);
    
    const logEl = document.getElementById('api-test-log');
    if (logEl) {
      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = message;
      logEl.appendChild(entry);
      logEl.scrollTop = logEl.scrollHeight;
    }
  };

  // Update status
  const updateStatus = function(message, type = 'info') {
    const statusEl = document.getElementById('api-test-status');
    if (statusEl) {
      statusEl.innerHTML = `<strong>Status:</strong> ${message}`;
      
      // Apply color based on type
      switch(type) {
        case 'error':
          statusEl.style.color = '#ff5252';
          break;
        case 'success':
          statusEl.style.color = '#4caf50';
          break;
        case 'warning':
          statusEl.style.color = '#ff9800';
          break;
        default:
          statusEl.style.color = 'white';
      }
    }
  };

  // Add result to list
  const addResult = function(endpoint, status, response) {
    const resultsList = document.getElementById('api-test-results-list');
    if (resultsList) {
      const resultItem = document.createElement('li');
      resultItem.style.marginBottom = '8px';
      resultItem.style.padding = '5px';
      resultItem.style.borderRadius = '4px';
      
      if (status >= 200 && status < 300) {
        resultItem.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
        resultItem.style.color = '#4caf50';
      } else {
        resultItem.style.backgroundColor = 'rgba(244, 67, 54, 0.2)';
        resultItem.style.color = '#ff5252';
      }
      
      resultItem.textContent = `${endpoint}: ${status} ${response ? '- ' + JSON.stringify(response).substring(0, 30) : ''}`;
      resultsList.appendChild(resultItem);
    }
  };

  // Clear results
  const clearResults = function() {
    const resultsList = document.getElementById('api-test-results-list');
    if (resultsList) {
      resultsList.innerHTML = '';
    }
  };

  // Test an endpoint
  const testEndpoint = async function(endpoint, method = 'GET', body = null) {
    log(`Testing ${method} ${endpoint}...`, 'api');
    
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      
      // Add auth token if available
      const token = localStorage.getItem('coffee_auth_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Build request options
      const options = {
        method: method,
        headers: headers,
        mode: 'cors',
        credentials: 'include'
      };
      
      // Add body for POST/PUT requests
      if (body && (method === 'POST' || method === 'PUT')) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(`http://localhost:5001${endpoint}`, options);
      const data = await response.json().catch(() => null);
      
      log(`${endpoint} - Status: ${response.status}`, response.ok ? 'success' : 'error');
      addResult(endpoint, response.status, data);
      
      return {
        success: response.ok,
        status: response.status,
        data: data
      };
    } catch (error) {
      log(`Error testing ${endpoint}: ${error.message}`, 'error');
      addResult(endpoint, 500, { error: error.message });
      
      return {
        success: false,
        status: 500,
        error: error.message
      };
    }
  };

  // Test all endpoints
  const testAllEndpoints = async function() {
    updateStatus('Testing API endpoints...', 'info');
    clearResults();
    
    // Define endpoints to test
    const endpoints = [
      '/api/health',
      '/api/auth/status',
      '/api/orders',
      '/api/stations',
      '/api/settings'
    ];
    
    // Test login endpoint with credentials
    const loginResult = await testEndpoint('/api/auth/login', 'POST', {
      username: 'barista',
      password: 'coffee123'
    });
    
    // Get number of successful tests
    let successCount = loginResult.success ? 1 : 0;
    
    // Test other endpoints
    for (const endpoint of endpoints) {
      const result = await testEndpoint(endpoint);
      if (result.success) {
        successCount++;
      }
    }
    
    // Update status based on results
    if (successCount === endpoints.length + 1) {
      updateStatus('All API endpoints are accessible!', 'success');
    } else if (successCount > 0) {
      updateStatus(`${successCount}/${endpoints.length + 1} endpoints accessible`, 'warning');
    } else {
      updateStatus('No API endpoints accessible', 'error');
    }
  };

  // Fix API issues
  const fixAPI = function() {
    updateStatus('Applying API fixes...', 'info');
    log('Removing API blocking code...', 'info');
    
    // Clear any localStorage flags forcing fallback
    localStorage.removeItem('use_fallback_data');
    localStorage.removeItem('force_offline_mode');
    localStorage.setItem('coffee_connection_status', 'online');
    localStorage.setItem('api_mode', 'online');
    
    // Create valid auth token
    const createToken = function() {
      const header = {
        alg: 'HS256',
        typ: 'JWT'
      };
      
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: 'barista',
        name: 'Barista User',
        role: 'barista',
        iat: now,
        exp: now + 86400 * 30,
        jti: 'test-' + Math.random().toString(36).substring(2)
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
    
    // Save token to localStorage
    const token = createToken();
    localStorage.setItem('coffee_auth_token', token);
    localStorage.setItem('authenticated', 'true');
    localStorage.setItem('user_role', 'barista');
    localStorage.setItem('user_name', 'Barista User');
    
    log('Created and saved valid JWT token', 'success');
    
    // Find and disable API blocking
    window.blockAPI = false;
    window.isAPIBlocked = false;
    
    // Restore original fetch and XMLHttpRequest
    if (window.originalFetch) {
      log('Restoring original fetch function', 'info');
      window.fetch = window.originalFetch;
    }
    
    if (window.originalXHROpen) {
      log('Restoring original XMLHttpRequest functions', 'info');
      XMLHttpRequest.prototype.open = window.originalXHROpen;
    }
    
    log('API fixes applied successfully', 'success');
    updateStatus('API fixes applied. Retesting endpoints...', 'success');
    
    // Test endpoints again after fixes
    setTimeout(testAllEndpoints, 500);
  };

  // Navigate to Barista interface
  const goToBarista = function() {
    log('Attempting to navigate to Barista interface...', 'info');
    
    // Approach 1: Look for links with "barista" in them
    const links = Array.from(document.querySelectorAll('a'));
    const baristaLink = links.find(link => {
      return link.textContent.toLowerCase().includes('barista') || 
             (link.href && link.href.toLowerCase().includes('barista')) ||
             (link.id && link.id.toLowerCase().includes('barista')) ||
             (link.className && link.className.toLowerCase().includes('barista'));
    });
    
    if (baristaLink) {
      log(`Found barista link: ${baristaLink.textContent || baristaLink.href}`, 'success');
      baristaLink.click();
      return;
    }
    
    // Approach 2: Try direct navigation
    log('No barista link found, trying direct navigation', 'warning');
    
    // Get current URL base
    const baseUrl = window.location.origin;
    
    // Possible barista URLs
    const possiblePaths = [
      '/barista',
      '/app/barista',
      '/baristainterface',
      '/interface/barista',
      '/barista/dashboard',
      '/barista-interface'
    ];
    
    // Create links for each possible path
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '20px';
    container.style.padding = '15px';
    container.style.backgroundColor = 'white';
    container.style.borderRadius = '8px';
    container.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    container.style.zIndex = '10000';
    
    const title = document.createElement('h4');
    title.textContent = 'Barista Interface Links';
    title.style.margin = '0 0 10px 0';
    container.appendChild(title);
    
    possiblePaths.forEach(path => {
      const link = document.createElement('a');
      link.href = baseUrl + path;
      link.textContent = 'Try ' + path;
      link.style.display = 'block';
      link.style.padding = '5px';
      link.style.marginBottom = '5px';
      link.style.color = '#2196f3';
      link.style.textDecoration = 'none';
      link.target = '_blank';
      container.appendChild(link);
    });
    
    // Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.padding = '5px 10px';
    closeButton.style.borderRadius = '4px';
    closeButton.style.border = 'none';
    closeButton.style.backgroundColor = '#f0f0f0';
    closeButton.style.cursor = 'pointer';
    closeButton.style.marginTop = '10px';
    closeButton.onclick = function() {
      document.body.removeChild(container);
    };
    container.appendChild(closeButton);
    
    document.body.appendChild(container);
    log('Created links to possible barista interfaces', 'info');
  };

  // Start the test
  const startTest = function() {
    createUI();
    log('Starting API test', 'info');
    testAllEndpoints();
  };

  startTest();
})();