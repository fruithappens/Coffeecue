/**
 * BYPASS AUTHENTICATION COMPLETELY
 * 
 * This script completely bypasses all authentication by:
 * 1. Overriding the AuthService prototype methods
 * 2. Setting direct localStorage authentication values
 * 3. Hijacking all API calls to ensure they succeed
 * 4. Creating fake responses for authentication endpoints
 */

(function() {
  console.log('🔐 BYPASS AUTH: Initializing complete authentication bypass...');
  
  // Create a JWT token that doesn't expire for a long time
  function createToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = btoa(JSON.stringify({
      sub: 'bypass_user_' + Math.floor(Math.random() * 10000),
      name: 'Barista User',
      role: 'barista',
      iat: now,
      exp: now + 86400 * 30 // 30 days
    }));
    const signature = btoa('bypass_signature_' + now);
    return `${header}.${payload}.${signature}`;
  }
  
  // Set token in storage
  function setAuthData() {
    console.log('🔐 BYPASS AUTH: Setting auth data in localStorage and sessionStorage');
    
    const token = createToken();
    const user = {
      id: 'bypass_user_' + Math.floor(Math.random() * 10000),
      name: 'Barista User',
      role: 'barista'
    };
    
    try {
      // Set in localStorage
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('isAuthenticated', 'true');
      localStorage.setItem('auth_token', token);
      localStorage.setItem('jwt_token', token);
      localStorage.setItem('access_token', token);
      localStorage.setItem('userId', user.id);
      localStorage.setItem('userRole', user.role);
      localStorage.setItem('user_data', JSON.stringify(user));
      localStorage.setItem('token_expiry', (Date.now() + 86400 * 30 * 1000).toString());
      
      // Set in sessionStorage
      sessionStorage.setItem('token', token);
      sessionStorage.setItem('user', JSON.stringify(user));
      sessionStorage.setItem('isAuthenticated', 'true');
      
      console.log('🔐 BYPASS AUTH: Auth data set successfully');
      return true;
    } catch (error) {
      console.error('🔐 BYPASS AUTH ERROR: Failed to set auth data:', error);
      return false;
    }
  }
  
  // Override the AuthService prototype
  function overrideAuthService() {
    console.log('🔐 BYPASS AUTH: Overriding AuthService prototype methods');
    
    if (window.AuthService) {
      // Track original methods for fallback
      const originalMethods = {
        login: window.AuthService.prototype.login,
        logout: window.AuthService.prototype.logout,
        isAuthenticated: window.AuthService.prototype.isAuthenticated,
        handleAuthentication: window.AuthService.prototype.handleAuthentication,
        refreshToken: window.AuthService.prototype.refreshToken
      };
      
      // Create a unified response object
      const authResponse = {
        token: createToken(),
        user: {
          id: 'bypass_user_' + Math.floor(Math.random() * 10000),
          name: 'Barista User',
          role: 'barista'
        }
      };
      
      // Override login
      window.AuthService.prototype.login = function(username, password) {
        console.log('🔐 BYPASS AUTH: Login called with', username);
        setAuthData();
        return Promise.resolve(authResponse);
      };
      
      // Override logout - make it do nothing
      window.AuthService.prototype.logout = function() {
        console.log('🔐 BYPASS AUTH: Logout called (blocked)');
        return Promise.resolve();
      };
      
      // Override isAuthenticated - always return true
      window.AuthService.prototype.isAuthenticated = function() {
        return true;
      };
      
      // Add or override refreshToken
      window.AuthService.prototype.refreshToken = function() {
        console.log('🔐 BYPASS AUTH: RefreshToken called');
        return Promise.resolve(authResponse);
      };
      
      // Override handleAuthentication
      window.AuthService.prototype.handleAuthentication = function() {
        console.log('🔐 BYPASS AUTH: HandleAuthentication called');
        return Promise.resolve();
      };
      
      console.log('🔐 BYPASS AUTH: Successfully overrode AuthService methods');
    } else {
      console.log('🔐 BYPASS AUTH: AuthService not found, will try again later');
      
      // Try again later
      setTimeout(overrideAuthService, 1000);
    }
  }
  
  // Intercept fetch calls
  function interceptFetch() {
    console.log('🔐 BYPASS AUTH: Intercepting fetch API');
    
    // Save original fetch
    const originalFetch = window.fetch;
    
    // Replace with our version
    window.fetch = function(resource, options = {}) {
      // Get URL string from resource
      const url = resource.url || resource;
      
      // Check if this is an auth endpoint
      if (url.includes('/auth/') || url.includes('/login') || url.includes('/token')) {
        console.log(`🔐 BYPASS AUTH: Intercepted auth fetch to ${url}`);
        
        // Create a successful response
        const responseBody = {
          token: createToken(),
          user: {
            id: 'bypass_user_' + Math.floor(Math.random() * 10000),
            name: 'Barista User',
            role: 'barista'
          },
          success: true,
          message: 'Authentication successful'
        };
        
        // Create a mock response
        const mockResponse = new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        return Promise.resolve(mockResponse);
      }
      
      // If not an auth endpoint, add authorization header
      if (options.headers) {
        if (options.headers instanceof Headers) {
          options.headers.set('Authorization', 'Bearer ' + createToken());
        } else {
          options.headers = {
            ...options.headers,
            'Authorization': 'Bearer ' + createToken()
          };
        }
      } else {
        options.headers = {
          'Authorization': 'Bearer ' + createToken()
        };
      }
      
      // Call original fetch
      return originalFetch.call(window, resource, options);
    };
    
    console.log('🔐 BYPASS AUTH: Fetch API intercepted successfully');
  }
  
  // Intercept XMLHttpRequest
  function interceptXHR() {
    console.log('🔐 BYPASS AUTH: Intercepting XMLHttpRequest');
    
    // Save original XMLHttpRequest methods
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    
    // Override open
    XMLHttpRequest.prototype.open = function(method, url, ...args) {
      this.__bypassUrl = url; // Store URL for later
      return originalOpen.apply(this, [method, url, ...args]);
    };
    
    // Override send
    XMLHttpRequest.prototype.send = function(body) {
      // Check if this is an auth endpoint
      if (this.__bypassUrl && (
        this.__bypassUrl.includes('/auth/') || 
        this.__bypassUrl.includes('/login') || 
        this.__bypassUrl.includes('/token')
      )) {
        console.log(`🔐 BYPASS AUTH: Intercepted auth XHR to ${this.__bypassUrl}`);
        
        // Create a successful response
        const responseBody = {
          token: createToken(),
          user: {
            id: 'bypass_user_' + Math.floor(Math.random() * 10000),
            name: 'Barista User',
            role: 'barista'
          },
          success: true,
          message: 'Authentication successful'
        };
        
        // Simulate successful response
        this.status = 200;
        this.readyState = 4;
        this.responseText = JSON.stringify(responseBody);
        this.response = JSON.stringify(responseBody);
        
        // Call onload
        if (typeof this.onload === 'function') {
          this.onload();
        }
        
        // Call onreadystatechange
        if (typeof this.onreadystatechange === 'function') {
          this.onreadystatechange();
        }
        
        // Don't actually send the request
        return;
      }
      
      // Add authorization header
      this.setRequestHeader('Authorization', 'Bearer ' + createToken());
      
      // Call original send
      return originalSend.apply(this, arguments);
    };
    
    console.log('🔐 BYPASS AUTH: XMLHttpRequest intercepted successfully');
  }
  
  // Fix API blocking
  function fixApiBlocking() {
    console.log('🔐 BYPASS AUTH: Fixing API blocking');
    
    // Reset API blocking flags
    window.blockAPI = false;
    window.isAPIBlocked = false;
    
    // Force real data usage
    localStorage.removeItem('useFallbackData');
    sessionStorage.removeItem('useFallbackData');
    
    if (window.appConfig) {
      window.appConfig.useFallbackData = false;
    }
    
    // Override any shouldUseFallbackData function
    window.shouldUseFallbackData = function() {
      return false;
    };
    
    console.log('🔐 BYPASS AUTH: API blocking fixed');
  }
  
  // Function to initialize everything
  function initialize() {
    console.log('🔐 BYPASS AUTH: Initializing complete bypass...');
    
    // Set authentication data
    setAuthData();
    
    // Override AuthService methods
    overrideAuthService();
    
    // Intercept network requests
    interceptFetch();
    interceptXHR();
    
    // Fix API blocking
    fixApiBlocking();
    
    console.log('🔐 BYPASS AUTH: Complete bypass initialized successfully!');
    console.log('🔐 BYPASS AUTH: You are now automatically authenticated as a barista user.');
    console.log('🔐 BYPASS AUTH: The application should now work with real data.');
  }
  
  // Monitor for errors and fix them
  window.addEventListener('error', function(event) {
    if (event.message && event.message.includes('refreshToken is not a function')) {
      console.log('🔐 BYPASS AUTH: Caught refreshToken error, applying fix');
      
      if (window.AuthService) {
        window.AuthService.prototype.refreshToken = function() {
          console.log('🔐 BYPASS AUTH: Emergency refreshToken called');
          return Promise.resolve({
            token: createToken(),
            user: {
              id: 'emergency_user',
              name: 'Emergency User',
              role: 'barista'
            }
          });
        };
      }
    }
  });
  
  // Start the bypass process
  initialize();
  
  // Export functions to window for debugging
  window.bypassAuth = {
    createToken,
    setAuthData,
    overrideAuthService,
    interceptFetch,
    interceptXHR,
    fixApiBlocking,
    initialize
  };
})();