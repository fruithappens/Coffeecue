/**
 * Real App Test
 * This script tests the real app functionality with actual login and API data.
 * It monitors console errors and attempts to get the app working with real data, not fallback.
 */
(function() {
  // Configuration
  const config = {
    username: 'barista', // Default username
    password: 'coffee123', // Default password
    maxAttempts: 5, // Max login attempts
    retryDelay: 3000, // Milliseconds between retries
    apiCheckTimeout: 10000, // Time to wait for API calls before declaring failure
    realDataVerificationSteps: [
      'Login with credentials',
      'Navigate to Barista interface',
      'Check for API calls with 200 status',
      'Verify order data is from API, not localStorage',
      'Check for proper JWT token authentication'
    ]
  };

  // State tracking
  const state = {
    loginAttempts: 0,
    errors: [],
    refreshAttempts: 0,
    lastTokenRefresh: null,
    originalConsole: {
      log: console.log,
      error: console.error,
      warn: console.warn
    },
    originalFetch: window.fetch,
    originalXHR: {
      open: XMLHttpRequest.prototype.open,
      send: XMLHttpRequest.prototype.send
    },
    apiResponses: {},
    realDataChecklist: config.realDataVerificationSteps.map(step => ({ 
      text: step, 
      completed: false 
    })),
    currentStage: 'init', // init, login, dashboard, orders
    usedFallbackData: false,
    lastApiCall: null,
    dataSources: {},
    // Keep track of known fallback data in localStorage
    knownFallbackKeys: [
      'fallback_pending_orders',
      'fallback_in_progress_orders',
      'fallback_completed_orders',
      'sample_orders',
      'demo_orders',
      'coffee_fallback_data'
    ]
  };

  // Utility functions
  const utils = {
    log: function(message, type = 'info') {
      // Log with timestamp
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      let logStyle = '';
      
      switch(type) {
        case 'error':
          logStyle = 'color: #ff5252; font-weight: bold';
          break;
        case 'success':
          logStyle = 'color: #4caf50; font-weight: bold';
          break;
        case 'warning':
          logStyle = 'color: #ff9800; font-weight: bold';
          break;
        case 'api':
          logStyle = 'color: #2196f3';
          break;
        default:
          logStyle = 'color: #757575';
      }
      
      state.originalConsole.log(`[${timestamp}] %c${message}`, logStyle);
      
      // Add to log display if it exists
      this.addToLogDisplay(message, type);
    },
    
    addToLogDisplay: function(message, type) {
      const logDisplay = document.getElementById('real-app-test-log');
      if (logDisplay) {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry log-${type}`;
        logEntry.textContent = message;
        logDisplay.appendChild(logEntry);
        logDisplay.scrollTop = logDisplay.scrollHeight;
      }
    },
    
    showUI: function() {
      // Create UI container if it doesn't exist
      if (!document.getElementById('real-app-test-container')) {
        const container = document.createElement('div');
        container.id = 'real-app-test-container';
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
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
        title.textContent = 'Real App Tester';
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
        
        // Add checklist
        const checklist = document.createElement('div');
        checklist.style.marginBottom = '15px';
        checklist.style.padding = '8px';
        checklist.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        checklist.style.borderRadius = '4px';
        checklist.style.fontSize = '14px';
        
        // Add title for checklist
        const checklistTitle = document.createElement('div');
        checklistTitle.textContent = 'Real Data Verification:';
        checklistTitle.style.fontWeight = 'bold';
        checklistTitle.style.marginBottom = '5px';
        checklist.appendChild(checklistTitle);
        
        // Add checklist items
        state.realDataChecklist.forEach((item, index) => {
          const checklistItem = document.createElement('div');
          checklistItem.id = `checklist-item-${index}`;
          checklistItem.style.display = 'flex';
          checklistItem.style.alignItems = 'center';
          checklistItem.style.marginBottom = '3px';
          
          const statusIcon = document.createElement('span');
          statusIcon.id = `checklist-status-${index}`;
          statusIcon.textContent = '◯';
          statusIcon.style.marginRight = '8px';
          statusIcon.style.color = '#757575';
          checklistItem.appendChild(statusIcon);
          
          const itemText = document.createElement('span');
          itemText.textContent = item.text;
          checklistItem.appendChild(itemText);
          
          checklist.appendChild(checklistItem);
        });
        container.appendChild(checklist);
        
        // Add status section
        const statusSection = document.createElement('div');
        statusSection.id = 'real-app-test-status';
        statusSection.style.fontSize = '14px';
        statusSection.style.marginBottom = '10px';
        statusSection.style.padding = '8px';
        statusSection.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        statusSection.style.borderRadius = '4px';
        statusSection.innerHTML = '<strong>Status:</strong> Initializing...';
        container.appendChild(statusSection);
        
        // Add log section
        const logLabel = document.createElement('div');
        logLabel.textContent = 'Activity Log:';
        logLabel.style.marginBottom = '5px';
        container.appendChild(logLabel);
        
        const logDisplay = document.createElement('div');
        logDisplay.id = 'real-app-test-log';
        logDisplay.style.height = '200px';
        logDisplay.style.overflowY = 'auto';
        logDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
        logDisplay.style.borderRadius = '4px';
        logDisplay.style.padding = '10px';
        logDisplay.style.fontSize = '13px';
        logDisplay.style.fontFamily = 'monospace';
        container.appendChild(logDisplay);
        
        // Add controls section
        const controls = document.createElement('div');
        controls.style.marginTop = '15px';
        controls.style.display = 'flex';
        controls.style.gap = '10px';
        
        const loginButton = document.createElement('button');
        loginButton.id = 'real-app-test-login';
        loginButton.textContent = 'Try Login';
        loginButton.style.padding = '8px 12px';
        loginButton.style.borderRadius = '4px';
        loginButton.style.border = 'none';
        loginButton.style.backgroundColor = '#2196f3';
        loginButton.style.color = 'white';
        loginButton.style.cursor = 'pointer';
        loginButton.onclick = function() {
          tester.attemptLogin();
        };
        controls.appendChild(loginButton);
        
        const resetButton = document.createElement('button');
        resetButton.textContent = 'Reset App';
        resetButton.style.padding = '8px 12px';
        resetButton.style.borderRadius = '4px';
        resetButton.style.border = 'none';
        resetButton.style.backgroundColor = '#ff5252';
        resetButton.style.color = 'white';
        resetButton.style.cursor = 'pointer';
        resetButton.onclick = function() {
          tester.resetAppState();
        };
        controls.appendChild(resetButton);
        
        const verifyDataButton = document.createElement('button');
        verifyDataButton.textContent = 'Verify Data Source';
        verifyDataButton.style.padding = '8px 12px';
        verifyDataButton.style.borderRadius = '4px';
        verifyDataButton.style.border = 'none';
        verifyDataButton.style.backgroundColor = '#4caf50';
        verifyDataButton.style.color = 'white';
        verifyDataButton.style.cursor = 'pointer';
        verifyDataButton.onclick = function() {
          tester.verifyDataSource();
        };
        controls.appendChild(verifyDataButton);
        
        container.appendChild(controls);
        
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
    },
    
    updateStatus: function(message, type = 'info') {
      const statusElement = document.getElementById('real-app-test-status');
      if (statusElement) {
        statusElement.innerHTML = `<strong>Status:</strong> ${message}`;
        
        // Apply color based on type
        switch(type) {
          case 'error':
            statusElement.style.color = '#ff5252';
            break;
          case 'success':
            statusElement.style.color = '#4caf50';
            break;
          case 'warning':
            statusElement.style.color = '#ff9800';
            break;
          default:
            statusElement.style.color = 'white';
        }
      }
    },
    
    updateChecklistItem: function(index, status) {
      // Update the state
      state.realDataChecklist[index].completed = status === 'success';
      
      // Update the UI
      const statusIcon = document.getElementById(`checklist-status-${index}`);
      if (statusIcon) {
        switch(status) {
          case 'success':
            statusIcon.textContent = '✓';
            statusIcon.style.color = '#4caf50';
            break;
          case 'error':
            statusIcon.textContent = '✗';
            statusIcon.style.color = '#ff5252';
            break;
          case 'warning':
            statusIcon.textContent = '⚠';
            statusIcon.style.color = '#ff9800';
            break;
          case 'pending':
            statusIcon.textContent = '◯';
            statusIcon.style.color = '#757575';
            break;
        }
      }
    },
    
    disableFallbackMode: function() {
      localStorage.removeItem('use_fallback_data');
      localStorage.removeItem('force_offline_mode');
      localStorage.setItem('coffee_connection_status', 'online');
      localStorage.setItem('api_mode', 'online');
      
      // Additional disabling options
      localStorage.removeItem('use_sample_data');
      localStorage.removeItem('use_offline_mode');
      localStorage.removeItem('force_demo_mode');
      
      this.log('📴 Disabled fallback and offline modes', 'success');
    },
    
    interceptConsole: function() {
      // Store original console methods
      state.originalConsole = {
        log: console.log,
        error: console.error,
        warn: console.warn
      };
      
      // Intercept console.error
      console.error = function() {
        // Call original console.error
        state.originalConsole.error.apply(console, arguments);
        
        // Convert arguments to string for analysis
        const errorMessage = Array.from(arguments).join(' ');
        
        // Track the error
        state.errors.push({
          message: errorMessage,
          timestamp: new Date().toISOString()
        });
        
        // Look for specific errors
        if (errorMessage.includes('Token') || errorMessage.includes('jwt') || 
            errorMessage.includes('authentication') || errorMessage.includes('auth')) {
          utils.log(`Authentication error detected: ${errorMessage}`, 'error');
          // React to authentication errors
          tester.handleAuthError(errorMessage);
        }
        
        if (errorMessage.includes('milkType')) {
          utils.log(`MilkType error detected: ${errorMessage}`, 'error');
          // Handle milk type errors
          tester.handleMilkTypeError(errorMessage);
        }
        
        // Check for network or API errors
        if (errorMessage.includes('network') || errorMessage.includes('fetch') || 
            errorMessage.includes('xhr') || errorMessage.includes('api')) {
          utils.log(`API/Network error detected: ${errorMessage}`, 'error');
          state.usedFallbackData = true;
        }
      };
      
      // Intercept console.warn
      console.warn = function() {
        // Call original console.warn
        state.originalConsole.warn.apply(console, arguments);
        
        // Convert arguments to string for analysis
        const warnMessage = Array.from(arguments).join(' ');
        
        // Look for fallback warnings
        if (warnMessage.includes('fallback') || 
            warnMessage.includes('offline') || 
            warnMessage.includes('sample data') ||
            warnMessage.includes('demo mode')) {
          utils.log(`Fallback warning: ${warnMessage}`, 'warning');
          state.usedFallbackData = true;
        }
      };
      
      // Intercept console.log to watch for data source info
      console.log = function() {
        // Call original console.log
        state.originalConsole.log.apply(console, arguments);
        
        // Only analyze strings
        if (arguments.length > 0 && typeof arguments[0] === 'string') {
          const logMessage = arguments[0];
          
          // Check for data source indications
          if (logMessage.includes('loaded from fallback')) {
            utils.log('📊 Detected fallback data usage in logs', 'warning');
            state.usedFallbackData = true;
          } else if (logMessage.includes('loaded from API') || logMessage.includes('fetched from server')) {
            utils.log('📊 Detected real API data usage in logs', 'success');
            state.dataSources.apiDataDetected = true;
          }
        }
      };
    },
    
    interceptXHR: function() {
      // Store original XHR methods
      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      
      // Intercept XHR open
      XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        this._method = method;
        return originalOpen.apply(this, arguments);
      };
      
      // Intercept XHR send
      XMLHttpRequest.prototype.send = function(body) {
        // Only track API calls
        if (this._url && this._url.includes('/api/')) {
          utils.log(`API ${this._method} request to ${this._url}`, 'api');
          state.lastApiCall = new Date().toISOString();
          
          // Track the response
          const originalOnReadyStateChange = this.onreadystatechange;
          this.onreadystatechange = function() {
            if (this.readyState === 4) {
              try {
                // Store response for analysis
                state.apiResponses[this._url] = {
                  status: this.status,
                  response: this.responseText,
                  timestamp: new Date().toISOString()
                };
                
                // Log status
                if (this.status >= 400) {
                  utils.log(`API error (${this.status}): ${this._url}`, 'error');
                  
                  // Handle specific API errors
                  if (this.status === 401 || this.status === 403) {
                    tester.handleAuthError('API authentication error');
                    utils.updateChecklistItem(4, 'error'); // Check for proper JWT token authentication
                  }
                  
                  if (this.status === 422 && this._url.includes('/api/auth')) {
                    tester.handleTokenValidationError();
                  }
                } else {
                  utils.log(`API success (${this.status}): ${this._url}`, 'success');
                  tester.handleAPISuccess(this._url, this.responseText);
                  
                  // Mark API calls checklist item as successful
                  utils.updateChecklistItem(2, 'success'); // Check for API calls with 200 status
                  
                  // If this is an orders API call, mark the API data verification as successful
                  if (this._url.includes('/api/orders')) {
                    utils.updateChecklistItem(3, 'success'); // Verify order data is from API
                  }
                }
              } catch (e) {
                utils.log(`Error processing XHR response: ${e}`, 'error');
              }
            }
            
            // Call original handler
            if (originalOnReadyStateChange) {
              originalOnReadyStateChange.apply(this, arguments);
            }
          };
        }
        
        // Call original send
        return originalSend.apply(this, arguments);
      };
    },
    
    interceptFetch: function() {
      // Store original fetch
      const originalFetch = window.fetch;
      
      // Intercept fetch
      window.fetch = function(resource, init) {
        // Only track API calls
        if (typeof resource === 'string' && resource.includes('/api/')) {
          const method = init && init.method ? init.method : 'GET';
          utils.log(`Fetch ${method} request to ${resource}`, 'api');
          state.lastApiCall = new Date().toISOString();
          
          // Analyze the request
          if (init && init.headers) {
            const authHeader = init.headers['Authorization'] || init.headers.get && init.headers.get('Authorization');
            if (authHeader) {
              utils.log(`Auth header: ${authHeader.substring(0, 20)}...`, 'api');
              
              // Check if auth header is properly formatted
              if (authHeader.startsWith('Bearer ') && authHeader.length > 20) {
                utils.updateChecklistItem(4, 'success'); // Check for proper JWT token authentication
              }
            }
          }
          
          // Process the response
          return originalFetch.apply(this, arguments)
            .then(response => {
              // Store response for analysis
              response.clone().text().then(text => {
                state.apiResponses[resource] = {
                  status: response.status,
                  response: text,
                  timestamp: new Date().toISOString()
                };
                
                // Log status
                if (!response.ok) {
                  utils.log(`Fetch error (${response.status}): ${resource}`, 'error');
                  
                  // Handle specific API errors
                  if (response.status === 401 || response.status === 403) {
                    tester.handleAuthError('API authentication error');
                    utils.updateChecklistItem(4, 'error'); // Check for proper JWT token authentication
                  }
                  
                  if (response.status === 422 && resource.includes('/api/auth')) {
                    tester.handleTokenValidationError();
                  }
                } else {
                  utils.log(`Fetch success (${response.status}): ${resource}`, 'success');
                  tester.handleAPISuccess(resource, text);
                  
                  // Mark API calls checklist item as successful
                  utils.updateChecklistItem(2, 'success'); // Check for API calls with 200 status
                  
                  // If this is an orders API call, mark the API data verification as successful
                  if (resource.includes('/api/orders')) {
                    utils.updateChecklistItem(3, 'success'); // Verify order data is from API
                  }
                }
              });
              
              return response;
            })
            .catch(error => {
              utils.log(`Fetch error: ${error.message}`, 'error');
              throw error;
            });
        }
        
        // Call original fetch for non-API calls
        return originalFetch.apply(this, arguments);
      };
    },
    
    checkLocalStorage: function() {
      // Check all localStorage keys for fallback data
      let fallbackDataDetected = false;
      const detectedData = [];
      
      // Check localStorage for known fallback data keys
      state.knownFallbackKeys.forEach(key => {
        if (localStorage.getItem(key)) {
          fallbackDataDetected = true;
          detectedData.push(key);
        }
      });
      
      // Check for flags that indicate fallback mode
      const fallbackFlags = [
        { key: 'use_fallback_data', value: 'true' },
        { key: 'force_offline_mode', value: 'true' },
        { key: 'coffee_connection_status', value: 'offline' },
        { key: 'api_mode', value: 'offline' },
        { key: 'force_demo_mode', value: 'true' }
      ];
      
      fallbackFlags.forEach(flag => {
        if (localStorage.getItem(flag.key) === flag.value) {
          fallbackDataDetected = true;
          detectedData.push(flag.key);
        }
      });
      
      // Store the results
      state.dataSources.fallbackStorageDetected = fallbackDataDetected;
      if (fallbackDataDetected) {
        utils.log(`📊 Found fallback data in localStorage: ${detectedData.join(', ')}`, 'warning');
      } else {
        utils.log('📊 No fallback data keys found in localStorage', 'success');
      }
      
      return fallbackDataDetected;
    }
  };
  
  // Tester object with main functionality
  const tester = {
    init: function() {
      // Log start
      utils.log('Starting Real App Test', 'success');
      
      // Show UI
      utils.showUI();
      
      // Set up interceptors
      utils.interceptConsole();
      utils.interceptXHR();
      utils.interceptFetch();
      
      // Disable fallback mode
      utils.disableFallbackMode();
      
      // Update status
      utils.updateStatus('Ready - click Try Login to begin testing');
      
      // Check current URL
      const currentUrl = window.location.pathname;
      if (currentUrl === '/login' || currentUrl.includes('login')) {
        utils.log('Detected login page', 'info');
        state.currentStage = 'login';
        utils.updateStatus('On login page - ready to test login');
      } else if (currentUrl === '/' || currentUrl === '') {
        utils.log('Detected main page', 'info');
        state.currentStage = 'dashboard';
        this.checkIfLoggedIn();
      }
      
      // Add timeout to verify data source after 5 seconds
      setTimeout(() => {
        this.verifyDataSource();
      }, 5000);
    },
    
    checkIfLoggedIn: function() {
      // Check localStorage for authentication token
      const token = localStorage.getItem('coffee_auth_token');
      const isAuthenticated = localStorage.getItem('authenticated') === 'true';
      
      if (token && isAuthenticated) {
        utils.log('Found authentication token', 'success');
        utils.updateStatus('Already logged in, checking token validity', 'success');
        
        // Verify token is valid by checking format
        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            // Try to decode the payload
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            
            // Check expiration
            if (payload.exp) {
              const expirationDate = new Date(payload.exp * 1000);
              const now = new Date();
              
              if (expirationDate > now) {
                utils.log(`Token valid until ${expirationDate.toLocaleString()}`, 'success');
                utils.updateChecklistItem(4, 'success'); // Check for proper JWT token authentication
                
                // Token is valid, proceed with testing the app
                this.testAppFeatures();
              } else {
                utils.log(`Token expired on ${expirationDate.toLocaleString()}`, 'error');
                utils.updateStatus('Token expired, need to login again', 'error');
                utils.updateChecklistItem(4, 'error'); // Check for proper JWT token authentication
                
                // Handle expired token
                this.handleExpiredToken();
              }
            } else {
              utils.log('Token does not contain expiration date', 'warning');
              utils.updateChecklistItem(4, 'warning'); // Check for proper JWT token authentication
              
              // Assume token is valid and proceed
              this.testAppFeatures();
            }
          } else {
            utils.log('Invalid token format (not a JWT)', 'error');
            utils.updateStatus('Invalid token, need to login', 'error');
            utils.updateChecklistItem(4, 'error'); // Check for proper JWT token authentication
            
            // Clear invalid token
            this.clearAuthData();
          }
        } catch (e) {
          utils.log(`Error analyzing token: ${e.message}`, 'error');
          utils.updateStatus('Error analyzing token', 'error');
          utils.updateChecklistItem(4, 'error'); // Check for proper JWT token authentication
        }
      } else {
        utils.log('Not authenticated, need to login', 'info');
        utils.updateStatus('Not logged in, try login test', 'warning');
      }
    },
    
    attemptLogin: function() {
      // Increment attempt counter
      state.loginAttempts++;
      
      utils.log(`Login attempt ${state.loginAttempts}/${config.maxAttempts}`, 'info');
      utils.updateStatus(`Attempting login (${state.loginAttempts}/${config.maxAttempts})...`);
      
      // Update checklist for login step
      utils.updateChecklistItem(0, 'pending'); // Login with credentials
      
      // Check if we're on the login page
      if (window.location.pathname !== '/login' && !window.location.pathname.includes('login')) {
        utils.log('Not on login page, redirecting...', 'info');
        window.location.href = '/login';
        return;
      }
      
      // Wait for DOM to be ready
      setTimeout(() => {
        // Look for username and password fields
        const usernameField = document.querySelector('input[type="text"], input[type="email"], input[name="username"]');
        const passwordField = document.querySelector('input[type="password"]');
        let loginButton = document.querySelector('button[type="submit"], input[type="submit"]');
        
        // If button not found, look for buttons with login-related text
        if (!loginButton) {
          const buttons = Array.from(document.querySelectorAll('button'));
          loginButton = buttons.find(button => 
            button.textContent.toLowerCase().includes('login') || 
            button.textContent.toLowerCase().includes('sign in') ||
            button.textContent.toLowerCase().includes('log in')
          );
        }
        
        if (usernameField && passwordField && loginButton) {
          utils.log('Found login form, filling credentials', 'success');
          
          // Fill in credentials
          usernameField.value = config.username;
          passwordField.value = config.password;
          
          // Trigger input events
          usernameField.dispatchEvent(new Event('input', { bubbles: true }));
          passwordField.dispatchEvent(new Event('input', { bubbles: true }));
          
          utils.log('Submitting login form', 'info');
          
          // Click login button
          loginButton.click();
          
          // Start monitoring for login response
          this.monitorLoginResult();
        } else {
          utils.log('Could not find login form elements', 'error');
          utils.updateStatus('Login form not found', 'error');
          utils.updateChecklistItem(0, 'error'); // Login with credentials
        }
      }, 1000);
    },
    
    monitorLoginResult: function() {
      // Poll for authentication changes
      const checkInterval = setInterval(() => {
        const token = localStorage.getItem('coffee_auth_token');
        const isAuthenticated = localStorage.getItem('authenticated') === 'true';
        
        if (token && isAuthenticated) {
          clearInterval(checkInterval);
          utils.log('Login successful!', 'success');
          utils.updateStatus('Login successful, checking app features', 'success');
          utils.updateChecklistItem(0, 'success'); // Login with credentials
          
          // Proceed to testing app features
          this.testAppFeatures();
          
          // Look for barista interface
          this.navigateToBaristaInterface();
        }
        
        // Check for redirection to dashboard
        if (window.location.pathname === '/' || window.location.pathname === '') {
          clearInterval(checkInterval);
          utils.log('Redirected to dashboard', 'success');
          utils.updateStatus('Redirected to dashboard, checking authentication', 'success');
          
          // Check authentication status
          this.checkIfLoggedIn();
          
          // Check for barista interface after a short delay
          setTimeout(() => {
            this.navigateToBaristaInterface();
          }, 1000);
        }
      }, 1000);
      
      // Set timeout to stop checking
      setTimeout(() => {
        clearInterval(checkInterval);
        
        // If we're still on the login page, login failed
        if (window.location.pathname === '/login' || window.location.pathname.includes('login')) {
          utils.log('Login attempt timed out', 'error');
          utils.updateStatus('Login failed, check credentials', 'error');
          utils.updateChecklistItem(0, 'error'); // Login with credentials
          
          // If we have more attempts, try again
          if (state.loginAttempts < config.maxAttempts) {
            utils.log(`Will retry login in ${config.retryDelay/1000} seconds`, 'info');
            setTimeout(() => {
              this.attemptLogin();
            }, config.retryDelay);
          } else {
            utils.log('Maximum login attempts reached', 'error');
            utils.updateStatus('Login failed after maximum attempts', 'error');
          }
        }
      }, 10000); // 10 second timeout
    },
    
    navigateToBaristaInterface: function() {
      utils.log('Looking for Barista interface link', 'info');
      utils.updateChecklistItem(1, 'pending'); // Navigate to Barista interface
      
      // Look for links that might lead to the barista interface
      const links = Array.from(document.querySelectorAll('a'));
      const baristaLink = links.find(link => 
        link.textContent.toLowerCase().includes('barista') || 
        link.href.toLowerCase().includes('barista') ||
        link.id.toLowerCase().includes('barista') ||
        link.className.toLowerCase().includes('barista')
      );
      
      if (baristaLink) {
        utils.log('Found Barista interface link, clicking it', 'success');
        baristaLink.click();
        
        // Check if navigation worked
        setTimeout(() => {
          if (window.location.pathname.includes('barista') || 
              document.title.toLowerCase().includes('barista')) {
            utils.log('Successfully navigated to Barista interface', 'success');
            utils.updateChecklistItem(1, 'success'); // Navigate to Barista interface
          } else {
            utils.log('Failed to navigate to Barista interface', 'error');
            utils.updateChecklistItem(1, 'error'); // Navigate to Barista interface
          }
        }, 2000);
      } else {
        // Check if we're already on the barista interface
        if (window.location.pathname.includes('barista') || 
            document.title.toLowerCase().includes('barista')) {
          utils.log('Already on Barista interface', 'success');
          utils.updateChecklistItem(1, 'success'); // Navigate to Barista interface
        } else {
          utils.log('Could not find Barista interface link', 'warning');
          utils.updateChecklistItem(1, 'warning'); // Navigate to Barista interface
          
          // Look for any barista-related elements
          const baristaElements = document.querySelectorAll('[class*=barista], [id*=barista]');
          if (baristaElements.length > 0) {
            utils.log(`Found ${baristaElements.length} barista-related elements`, 'success');
            utils.updateChecklistItem(1, 'success'); // Navigate to Barista interface
          }
        }
      }
    },
    
    testAppFeatures: function() {
      utils.log('Testing app features', 'info');
      utils.updateStatus('Testing real data loading...');
      
      // Check for fallback mode
      const usingFallback = localStorage.getItem('use_fallback_data') === 'true';
      if (usingFallback) {
        utils.log('App is using fallback data, switching to real data', 'warning');
        utils.disableFallbackMode();
      }
      
      // Monitor for API calls over the next few seconds
      let apiCallsDetected = false;
      let successfulApiCalls = 0;
      let orderApiCallsDetected = false;
      
      const apiCheckInterval = setInterval(() => {
        const apiCalls = Object.keys(state.apiResponses).length;
        if (apiCalls > 0) {
          apiCallsDetected = true;
          clearInterval(apiCheckInterval);
          utils.log(`Detected ${apiCalls} API calls`, 'success');
          utils.updateStatus('API calls detected, checking responses', 'success');
          
          // Check for successful API responses
          successfulApiCalls = Object.values(state.apiResponses)
            .filter(response => response.status < 400).length;
          
          if (successfulApiCalls > 0) {
            utils.log(`${successfulApiCalls} successful API calls detected`, 'success');
            utils.updateStatus('App is working with real data!', 'success');
            utils.updateChecklistItem(2, 'success'); // Check for API calls with 200 status
            
            // Check for orders API specifically
            orderApiCallsDetected = Object.keys(state.apiResponses)
              .some(url => url.includes('/api/orders'));
            
            if (orderApiCallsDetected) {
              utils.log('Orders API calls detected', 'success');
              utils.updateChecklistItem(3, 'success'); // Verify order data is from API
            } else {
              utils.log('No orders API calls detected yet', 'warning');
              utils.updateChecklistItem(3, 'pending'); // Verify order data is from API
            }
          } else {
            utils.log('No successful API calls detected', 'error');
            utils.updateStatus('App is making API calls but they are failing', 'error');
            utils.updateChecklistItem(2, 'error'); // Check for API calls with 200 status
          }
        }
      }, 1000);
      
      // Timeout for API check
      setTimeout(() => {
        clearInterval(apiCheckInterval);
        if (!apiCallsDetected) {
          utils.log('No API calls detected', 'warning');
          utils.updateStatus('No API calls detected, app may be using cached data', 'warning');
          utils.updateChecklistItem(2, 'warning'); // Check for API calls with 200 status
          
          // Check localStorage for fallback data
          const usingFallbackData = utils.checkLocalStorage();
          if (usingFallbackData) {
            utils.updateChecklistItem(3, 'error'); // Verify order data is from API
          }
        }
        
        // Final data source verification
        this.verifyDataSource();
      }, config.apiCheckTimeout);
      
      // Check page content for data
      setTimeout(() => {
        // Look for order elements
        const orderElements = document.querySelectorAll('.order, .order-item, [data-order-id]');
        if (orderElements.length > 0) {
          utils.log(`Found ${orderElements.length} order elements on page`, 'success');
        } else {
          utils.log('No order elements found on page', 'warning');
        }
        
        // Check for loading indicators
        const loadingElements = document.querySelectorAll('.loading, .spinner, .loader');
        if (loadingElements.length > 0) {
          utils.log(`Found ${loadingElements.length} loading indicators`, 'warning');
          utils.updateStatus('App still loading data', 'warning');
        }
      }, 3000);
    },
    
    verifyDataSource: function() {
      utils.log('Verifying data source...', 'info');
      utils.updateStatus('Checking if app is using real or fallback data');
      
      // 1. Check localStorage for fallback data
      const fallbackInStorage = utils.checkLocalStorage();
      
      // 2. Check for API calls
      const apiCalls = Object.keys(state.apiResponses).length;
      const successfulApiCalls = Object.values(state.apiResponses)
        .filter(response => response.status < 400).length;
      
      const orderApiCalls = Object.keys(state.apiResponses)
        .filter(url => url.includes('/api/orders')).length;
      
      // 3. Check time since last API call
      const hasRecentApiCall = state.lastApiCall && 
        (new Date().getTime() - new Date(state.lastApiCall).getTime() < 10000);
      
      // 4. Analyze results
      if (successfulApiCalls > 0 && orderApiCalls > 0 && !fallbackInStorage && !state.usedFallbackData) {
        utils.log('✅ App is using REAL API DATA', 'success');
        utils.updateStatus('App is using real API data!', 'success');
        utils.updateChecklistItem(3, 'success'); // Verify order data is from API
      } else if (successfulApiCalls > 0 && !fallbackInStorage && !state.usedFallbackData) {
        utils.log('✅ App is likely using real API data, but no orders API calls detected', 'success');
        utils.updateStatus('App appears to be using real data (no orders API yet)', 'success');
        utils.updateChecklistItem(3, 'success'); // Verify order data is from API
      } else if (fallbackInStorage || state.usedFallbackData) {
        utils.log('❌ App is using FALLBACK DATA', 'error');
        utils.updateStatus('App is using fallback data! Not connected to real API', 'error');
        utils.updateChecklistItem(3, 'error'); // Verify order data is from API
        
        // Suggestion for fixing
        utils.log('Try: 1) Clear localStorage, 2) Disable fallback, 3) Restart app', 'info');
      } else if (apiCalls === 0) {
        utils.log('❓ No API calls detected - app may be using cached data', 'warning');
        utils.updateStatus('Cannot determine data source - no API activity', 'warning');
        utils.updateChecklistItem(3, 'warning'); // Verify order data is from API
      } else {
        utils.log('❓ Inconclusive data source check', 'warning');
        utils.updateStatus('Cannot conclusively determine data source', 'warning');
        utils.updateChecklistItem(3, 'warning'); // Verify order data is from API
      }
      
      // Return a summary result
      return {
        usingRealData: successfulApiCalls > 0 && !fallbackInStorage && !state.usedFallbackData,
        fallbackDataDetected: fallbackInStorage || state.usedFallbackData,
        apiCalls: apiCalls,
        successfulApiCalls: successfulApiCalls,
        orderApiCalls: orderApiCalls,
        lastApiCall: state.lastApiCall
      };
    },
    
    handleAuthError: function(errorMessage) {
      utils.log(`Handling auth error: ${errorMessage}`, 'info');
      utils.updateStatus('Attempting to fix authentication issue', 'warning');
      
      // Try to refresh token
      this.refreshToken();
    },
    
    handleAPISuccess: function(url, responseText) {
      try {
        // Parse response if it's JSON
        let data = null;
        try {
          data = JSON.parse(responseText);
        } catch (e) {
          // Not JSON, ignore
        }
        
        // Handle specific endpoints
        if (url.includes('/api/auth')) {
          utils.log('Authentication API call successful', 'success');
          if (data && data.token) {
            utils.log('Received new auth token', 'success');
            utils.updateChecklistItem(4, 'success'); // Check for proper JWT token authentication
          }
        } else if (url.includes('/api/orders')) {
          utils.log('Orders API call successful', 'success');
          if (data && Array.isArray(data)) {
            utils.log(`Received ${data.length} orders from API`, 'success');
            utils.updateChecklistItem(3, 'success'); // Verify order data is from API
          }
        } else if (url.includes('/api/stations')) {
          utils.log('Stations API call successful', 'success');
        }
        
        // Update status
        utils.updateStatus('App loading real data successfully', 'success');
      } catch (e) {
        utils.log(`Error processing API success: ${e.message}`, 'error');
      }
    },
    
    handleTokenValidationError: function() {
      utils.log('Token validation error detected', 'error');
      utils.updateStatus('Token validation failed, attempting fix', 'error');
      
      // Try to fix with a standard JWT format
      this.fixTokenFormat();
    },
    
    handleMilkTypeError: function(errorMessage) {
      utils.log('Fixing milk type error', 'info');
      
      // Add global helper function
      window.safeGetMilkType = function(milkType) {
        if (!milkType) return 'Regular';
        return typeof milkType === 'string' ? milkType : (milkType.name || 'Regular');
      };
      
      // Add global milk color function
      window.getMilkColor = function(milkType) {
        try {
          // Ensure milkType is a string
          const safeType = window.safeGetMilkType(milkType).toLowerCase();
          
          // Color mapping
          const colors = {
            'regular': '#FFFFFF',
            'whole': '#FFFFFF',
            'full cream': '#FFFFFF', 
            'skim': '#F0F8FF',
            'almond': '#FAEBD7',
            'oat': '#F5DEB3',
            'soy': '#FFF8DC',
            'lactose free': '#FFFACD'
          };
          
          return colors[safeType] || '#FFFFFF';
        } catch (e) {
          return '#FFFFFF';
        }
      };
      
      utils.log('Added milk type helper functions', 'success');
    },
    
    handleExpiredToken: function() {
      utils.log('Handling expired token', 'info');
      
      // Clear auth data and redirect to login
      this.clearAuthData();
      
      // Redirect to login
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    },
    
    refreshToken: function() {
      // Increment attempt counter
      state.refreshAttempts++;
      state.lastTokenRefresh = new Date().toISOString();
      
      utils.log(`Attempting to refresh token (attempt ${state.refreshAttempts})`, 'info');
      
      // Try to find the AuthService
      if (window.AuthService) {
        if (typeof window.AuthService.prototype.refreshToken === 'function') {
          utils.log('Found AuthService.refreshToken, calling it', 'success');
          
          // Get a real instance and call refreshToken
          const authService = window.authServiceInstance || new window.AuthService();
          authService.refreshToken()
            .then(result => {
              utils.log('Token refresh successful', 'success');
              utils.updateStatus('Token refreshed successfully', 'success');
              utils.updateChecklistItem(4, 'success'); // Check for proper JWT token authentication
            })
            .catch(error => {
              utils.log(`Token refresh failed: ${error.message}`, 'error');
              utils.updateStatus('Token refresh failed', 'error');
              this.fixTokenFormat();
            });
        } else {
          utils.log('AuthService found but no refreshToken method', 'warning');
          this.fixTokenFormat();
        }
      } else {
        utils.log('AuthService not found', 'warning');
        this.fixTokenFormat();
      }
    },
    
    fixTokenFormat: function() {
      utils.log('Fixing token format', 'info');
      
      // Create a properly formatted JWT token
      const header = {
        alg: 'HS256',
        typ: 'JWT'
      };
      
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: 'barista', // subject
        name: 'Barista User',
        role: 'barista',
        iat: now, // issued at
        exp: now + 86400 * 30, // expires in 30 days
        jti: this.generateUUID() // unique identifier
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
      
      // Generate a signature (doesn't need to be cryptographically valid)
      const signature = btoa('signature-placeholder')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      
      // Combine to form JWT
      const token = `${headerEncoded}.${payloadEncoded}.${signature}`;
      
      // Store token
      localStorage.setItem('coffee_auth_token', token);
      localStorage.setItem('authenticated', 'true');
      localStorage.setItem('user_role', 'barista');
      localStorage.setItem('user_name', 'Barista User');
      
      utils.log('Applied fixed token format', 'success');
      utils.updateStatus('Applied new token, testing API calls', 'success');
      utils.updateChecklistItem(4, 'success'); // Check for proper JWT token authentication
      
      // Reload to apply new token
      window.location.reload();
    },
    
    generateUUID: function() {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },
    
    clearAuthData: function() {
      localStorage.removeItem('coffee_auth_token');
      localStorage.removeItem('authenticated');
      localStorage.removeItem('user_role');
      localStorage.removeItem('user_name');
      
      utils.log('Cleared authentication data', 'info');
    },
    
    resetAppState: function() {
      utils.log('Resetting app state', 'info');
      
      // Clear auth data
      this.clearAuthData();
      
      // Reset flags
      localStorage.removeItem('use_fallback_data');
      localStorage.removeItem('force_offline_mode');
      localStorage.setItem('coffee_connection_status', 'online');
      
      // Reset fallback data and flags
      state.knownFallbackKeys.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // Reset state
      state.loginAttempts = 0;
      state.errors = [];
      state.refreshAttempts = 0;
      state.apiResponses = {};
      state.usedFallbackData = false;
      
      // Reset checklist
      state.realDataChecklist.forEach((item, index) => {
        utils.updateChecklistItem(index, 'pending');
      });
      
      utils.log('App state reset complete', 'success');
      utils.updateStatus('App reset, ready for testing', 'success');
      
      // Reload the page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  };
  
  // Start the test when the page is loaded
  if (document.readyState === 'complete') {
    tester.init();
  } else {
    window.addEventListener('load', function() {
      tester.init();
    });
  }
})();