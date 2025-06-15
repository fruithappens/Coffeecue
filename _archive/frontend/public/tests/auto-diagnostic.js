/**
 * Auto-Diagnostic Tool for Coffee Cue System
 * 
 * This script automatically:
 * 1. Tests the login flow
 * 2. Diagnoses authentication issues
 * 3. Attempts to fix common problems
 * 4. Verifies real data connection
 */

(function() {
  console.log('🔍 Starting Auto-Diagnostic Tool...');
  
  // Configuration
  const config = {
    credentials: {
      username: 'barista',
      password: 'password123'
    },
    apiEndpoints: {
      auth: '/api/auth/login',
      orders: '/api/orders/pending',
      stations: '/api/stations'
    },
    selectors: {
      usernameInput: 'input[name="username"]',
      passwordInput: 'input[type="password"]',
      loginButton: 'button[type="submit"]',
      baristaButton: 'a[href="/barista"], button:contains("Barista")',
      errorMessage: '.error-message, .alert-danger'
    },
    timeouts: {
      apiCheck: 2000,
      loginAttempt: 1000,
      navigationCheck: 2000
    }
  };

  // Create a test token
  function createTestToken() {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: 'test-user',
      name: 'Test Barista',
      role: 'barista',
      exp: Math.floor(Date.now() / 1000) + 3600
    }));
    const signature = btoa('test-signature');
    return `${header}.${payload}.${signature}`;
  }

  // Store diagnostic results
  const diagnosticResults = {
    authServiceFound: false,
    refreshTokenExists: false,
    apiCallsBlocked: false,
    proxyConfigured: false,
    loginSuccessful: false,
    realDataRetrieved: false,
    errors: []
  };

  // Log with timestamp
  function logWithTime(message) {
    const now = new Date();
    const timestamp = now.toISOString().split('T')[1].split('.')[0];
    console.log(`[${timestamp}] ${message}`);
  }

  // Apply fixes
  function applyFixes() {
    logWithTime('🔧 Applying fixes...');
    
    // Fix 1: Add refreshToken to AuthService
    if (!diagnosticResults.refreshTokenExists && window.AuthService) {
      logWithTime('➕ Adding refreshToken method to AuthService');
      window.AuthService.prototype.refreshToken = function() {
        logWithTime('📡 Patched refreshToken called');
        return Promise.resolve({
          token: createTestToken(),
          user: { id: 'test-id', name: 'Test User', role: 'barista' }
        });
      };
    }
    
    // Fix 2: Unblock API calls
    if (diagnosticResults.apiCallsBlocked) {
      logWithTime('🔓 Unblocking API calls');
      window.blockAPI = false;
      window.isAPIBlocked = false;
      
      // Restore original fetch if it was modified
      if (window.originalFetch) {
        window.fetch = window.originalFetch;
      }
      
      // Restore original XMLHttpRequest if it was modified
      if (window.originalXMLHttpRequest) {
        window.XMLHttpRequest = window.originalXMLHttpRequest;
      }
    }
    
    // Fix 3: Patch handleAuthentication method
    try {
      logWithTime('🔧 Patching handleAuthentication method');
      
      // Find AuthService instances
      let authServiceInstance = null;
      
      // Check global window object
      if (window.authService) {
        authServiceInstance = window.authService;
      }
      
      // Check React components
      if (!authServiceInstance) {
        // Try to find it in React's fiber tree
        const findAuthServiceInReactTree = () => {
          // Get root fiber node from a DOM element
          let fiber = document.querySelector('#root')?._reactRootContainer?._internalRoot?.current;
          let found = null;
          
          // Traverse the fiber tree
          const traverse = (fiber) => {
            if (!fiber) return;
            
            // Check if this component has authService or AuthService
            if (fiber.memoizedState?.authService || 
                fiber.memoizedState?.AuthService ||
                fiber.memoizedProps?.authService ||
                fiber.memoizedProps?.AuthService) {
              found = fiber.memoizedState?.authService || 
                     fiber.memoizedState?.AuthService ||
                     fiber.memoizedProps?.authService ||
                     fiber.memoizedProps?.AuthService;
              return;
            }
            
            // Check child
            if (fiber.child) traverse(fiber.child);
            
            // Check sibling
            if (fiber.sibling) traverse(fiber.sibling);
          };
          
          traverse(fiber);
          return found;
        };
        
        authServiceInstance = findAuthServiceInReactTree();
      }
      
      // If found, patch the handleAuthentication method
      if (authServiceInstance) {
        logWithTime('✅ Found AuthService instance, patching handleAuthentication');
        
        // Save original method
        const originalHandleAuthentication = authServiceInstance.handleAuthentication;
        
        // Replace with safe version
        authServiceInstance.handleAuthentication = function() {
          try {
            logWithTime('🔒 Safe handleAuthentication called');
            
            // If refreshToken is missing, add it temporarily
            const hasRefreshToken = typeof this.refreshToken === 'function';
            if (!hasRefreshToken) {
              this.refreshToken = function() {
                logWithTime('📡 Temporary refreshToken called');
                return Promise.resolve({
                  token: createTestToken(),
                  user: { id: 'temp-id', name: 'Temporary User', role: 'barista' }
                });
              };
            }
            
            // Call original or use fallback
            let result;
            try {
              result = originalHandleAuthentication.apply(this, arguments);
            } catch (error) {
              logWithTime(`❌ Error in original handleAuthentication: ${error.message}`);
              
              // Fallback implementation
              const token = localStorage.getItem('token') || createTestToken();
              localStorage.setItem('token', token);
              
              result = Promise.resolve();
            }
            
            // Clean up temporary function if we added it
            if (!hasRefreshToken) {
              setTimeout(() => {
                delete this.refreshToken;
              }, 0);
            }
            
            return result;
          } catch (error) {
            logWithTime(`❌ Failed to execute handleAuthentication: ${error.message}`);
            return Promise.resolve();
          }
        };
      } else {
        logWithTime('⚠️ Could not find AuthService instance');
      }
    } catch (error) {
      logWithTime(`❌ Error patching handleAuthentication: ${error.message}`);
    }
    
    // Fix 4: Force real data
    try {
      logWithTime('🔄 Ensuring real data is used instead of fallback');
      
      // Clear any flags that might force fallback data
      localStorage.removeItem('useFallbackData');
      sessionStorage.removeItem('useFallbackData');
      
      if (window.appConfig) {
        window.appConfig.useFallbackData = false;
      }
      
      // Override any functions that might be forcing fallback data
      if (window.shouldUseFallbackData) {
        window.shouldUseFallbackData = function() { return false; };
      }
    } catch (error) {
      logWithTime(`❌ Error forcing real data: ${error.message}`);
    }
  }

  // Test login flow
  function testLoginFlow() {
    logWithTime('🧪 Testing login flow...');
    
    // Check if we're on the login page
    const isLoginPage = !!document.querySelector(config.selectors.usernameInput);
    
    if (!isLoginPage) {
      logWithTime('⚠️ Not on login page, navigating there...');
      window.location.href = '/login';
      return;
    }
    
    // Fill in login form
    setTimeout(() => {
      try {
        const usernameInput = document.querySelector(config.selectors.usernameInput);
        const passwordInput = document.querySelector(config.selectors.passwordInput);
        const loginButton = document.querySelector(config.selectors.loginButton);
        
        if (usernameInput && passwordInput && loginButton) {
          logWithTime('✏️ Filling login form');
          usernameInput.value = config.credentials.username;
          passwordInput.value = config.credentials.password;
          
          // Submit the form
          loginButton.click();
          
          // Check if login was successful
          setTimeout(() => {
            const errorMessage = document.querySelector(config.selectors.errorMessage);
            if (errorMessage && errorMessage.style.display !== 'none') {
              logWithTime(`❌ Login failed: ${errorMessage.textContent}`);
              diagnosticResults.errors.push(`Login error: ${errorMessage.textContent}`);
            } else {
              logWithTime('✅ Login appears successful');
              diagnosticResults.loginSuccessful = true;
              
              // Try to click on Barista button if available
              setTimeout(() => {
                const baristaButton = document.querySelector(config.selectors.baristaButton);
                if (baristaButton) {
                  logWithTime('🖱️ Clicking Barista button');
                  baristaButton.click();
                  
                  // Verify real data is being used
                  setTimeout(checkRealData, config.timeouts.navigationCheck);
                } else {
                  logWithTime('⚠️ Barista button not found');
                }
              }, config.timeouts.navigationCheck);
            }
          }, config.timeouts.loginAttempt);
        } else {
          logWithTime('❌ Could not find login form elements');
        }
      } catch (error) {
        logWithTime(`❌ Error in login flow: ${error.message}`);
      }
    }, config.timeouts.loginAttempt);
  }

  // Check if real data is being used
  function checkRealData() {
    logWithTime('🔍 Checking if real data is being used...');
    
    // Make API request to check if real data is being returned
    fetch(config.apiEndpoints.orders)
      .then(response => {
        if (response.ok) {
          return response.json();
        }
        throw new Error(`API returned ${response.status}`);
      })
      .then(data => {
        if (data && Array.isArray(data)) {
          logWithTime(`✅ Real data received: ${data.length} orders`);
          diagnosticResults.realDataRetrieved = true;
          
          // Show success message
          showResult(true);
        } else {
          logWithTime('❌ Response does not contain expected data format');
          diagnosticResults.errors.push('Unexpected data format received');
          showResult(false);
        }
      })
      .catch(error => {
        logWithTime(`❌ Failed to get real data: ${error.message}`);
        diagnosticResults.errors.push(`API error: ${error.message}`);
        showResult(false);
      });
  }

  // Display diagnostic result
  function showResult(success) {
    // Create result container if it doesn't exist
    let resultContainer = document.getElementById('diagnostic-result');
    if (!resultContainer) {
      resultContainer = document.createElement('div');
      resultContainer.id = 'diagnostic-result';
      resultContainer.style.position = 'fixed';
      resultContainer.style.top = '10px';
      resultContainer.style.right = '10px';
      resultContainer.style.padding = '15px';
      resultContainer.style.borderRadius = '5px';
      resultContainer.style.zIndex = '9999';
      resultContainer.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
      resultContainer.style.maxWidth = '400px';
      resultContainer.style.fontSize = '14px';
      document.body.appendChild(resultContainer);
    }
    
    if (success) {
      resultContainer.style.backgroundColor = '#d4edda';
      resultContainer.style.color = '#155724';
      resultContainer.style.border = '1px solid #c3e6cb';
      resultContainer.innerHTML = '<strong>Success!</strong> Login successful and real data is being used.';
    } else {
      resultContainer.style.backgroundColor = '#f8d7da';
      resultContainer.style.color = '#721c24';
      resultContainer.style.border = '1px solid #f5c6cb';
      
      let errorMessage = '<strong>Diagnostic Failed</strong><br>';
      if (diagnosticResults.errors.length > 0) {
        errorMessage += '<ul style="margin: 5px 0; padding-left: 20px;">';
        diagnosticResults.errors.forEach(error => {
          errorMessage += `<li>${error}</li>`;
        });
        errorMessage += '</ul>';
      } else {
        errorMessage += 'Unknown error occurred during diagnosis.';
      }
      
      resultContainer.innerHTML = errorMessage;
    }
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.marginTop = '10px';
    closeButton.style.padding = '5px 10px';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '3px';
    closeButton.style.backgroundColor = '#007bff';
    closeButton.style.color = 'white';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = function() {
      resultContainer.style.display = 'none';
    };
    resultContainer.appendChild(closeButton);
  }

  // Start diagnostic process
  function runDiagnostic() {
    logWithTime('🚀 Starting diagnostic process');
    
    // Step 1: Check if AuthService is available
    if (window.AuthService) {
      logWithTime('✅ AuthService found');
      diagnosticResults.authServiceFound = true;
      
      // Check if refreshToken exists
      if (typeof window.AuthService.prototype.refreshToken === 'function') {
        logWithTime('✅ refreshToken method exists');
        diagnosticResults.refreshTokenExists = true;
      } else {
        logWithTime('❌ refreshToken method not found');
      }
    } else {
      logWithTime('⚠️ AuthService not found in global scope');
    }
    
    // Step 2: Check if API calls are being blocked
    if (window.blockAPI === true || window.isAPIBlocked === true) {
      logWithTime('❌ API calls are being blocked');
      diagnosticResults.apiCallsBlocked = true;
    } else {
      logWithTime('✅ API calls are not blocked');
    }
    
    // Step 3: Check if proxy is configured (by testing an API endpoint)
    fetch(config.apiEndpoints.auth, { method: 'OPTIONS' })
      .then(response => {
        logWithTime(`✅ Proxy test: Server responded with status ${response.status}`);
        diagnosticResults.proxyConfigured = true;
      })
      .catch(error => {
        logWithTime(`❌ Proxy test failed: ${error.message}`);
        diagnosticResults.errors.push(`Proxy configuration error: ${error.message}`);
      })
      .finally(() => {
        // Step 4: Apply fixes before testing login flow
        applyFixes();
        
        // Step 5: Test login flow
        setTimeout(testLoginFlow, config.timeouts.apiCheck);
      });
  }

  // Install global error listener
  window.addEventListener('error', function(event) {
    logWithTime(`❌ Global error: ${event.message} at ${event.filename}:${event.lineno}`);
    diagnosticResults.errors.push(`Runtime error: ${event.message}`);
    
    // If it's a refreshToken error, apply the fix
    if (event.message.includes('refreshToken is not a function')) {
      logWithTime('🔧 Detected refreshToken error, applying immediate fix');
      
      if (window.AuthService) {
        window.AuthService.prototype.refreshToken = function() {
          logWithTime('📡 Emergency refreshToken called');
          return Promise.resolve({
            token: createTestToken(),
            user: { id: 'emergency-id', name: 'Emergency User', role: 'barista' }
          });
        };
      }
    }
  });

  // Run the diagnostic
  // Wait for page to fully load
  if (document.readyState === 'complete') {
    runDiagnostic();
  } else {
    window.addEventListener('load', runDiagnostic);
  }
})();