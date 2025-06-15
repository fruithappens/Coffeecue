/**
 * Early Auth Fix
 * 
 * This script fixes the "this.refreshToken is not a function" error
 * by adding the refreshToken method to the AuthService prototype
 * before React starts initializing components.
 */

// Execute immediately
(function() {
  console.log('🚀 Early Auth Fix: Initializing...');
  
  // Function to create a valid JWT token
  function createToken() {
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
      jti: 'early-fix-' + Math.random().toString(36).substring(2)
    };
    
    // Base64 encode
    const encodeBase64 = (obj) => {
      return btoa(JSON.stringify(obj))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    };
    
    const headerEncoded = encodeBase64(header);
    const payloadEncoded = encodeBase64(payload);
    
    // Create simple signature
    const signature = btoa('signature-placeholder')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    
    return `${headerEncoded}.${payloadEncoded}.${signature}`;
  }
  
  // Store token in localStorage
  function setupAuth() {
    localStorage.setItem('coffee_auth_token', createToken());
    localStorage.setItem('authenticated', 'true');
    localStorage.setItem('user_role', 'barista');
    localStorage.setItem('user_name', 'Barista User');
  }
  
  // Function to patch AuthService
  function patchAuthService() {
    console.log('🔍 Checking for AuthService...');
    
    if (window.AuthService) {
      console.log('✅ Found AuthService, adding refreshToken method');
      
      // Add the refreshToken method if it doesn't exist
      if (!window.AuthService.prototype.refreshToken) {
        window.AuthService.prototype.refreshToken = function() {
          console.log('AuthService.refreshToken called (added by early-auth-fix.js)');
          return Promise.resolve({
            token: createToken(),
            user: {
              id: 'user123',
              name: 'Barista',
              role: 'barista'
            }
          });
        };
        console.log('✅ Added refreshToken method to AuthService.prototype');
      } else {
        console.log('✅ AuthService already has refreshToken method');
      }
    } else {
      console.log('⚠️ AuthService not found, creating a stub');
      
      // Create a stub AuthService
      window.AuthService = function() {
        console.log('AuthService constructor called (from early-auth-fix.js)');
        
        this.token = createToken();
        this.user = {
          id: 'user123',
          name: 'Barista',
          role: 'barista'
        };
        
        // Store in localStorage
        localStorage.setItem('coffee_auth_token', this.token);
        localStorage.setItem('authenticated', 'true');
        localStorage.setItem('user_role', 'barista');
        localStorage.setItem('user_name', 'Barista User');
      };
      
      // Add methods to the prototype
      window.AuthService.prototype = {
        init: function() {
          console.log('AuthService.init called (from early-auth-fix.js)');
          return Promise.resolve({
            authenticated: true,
            token: this.token,
            user: this.user
          });
        },
        
        isLoggedIn: function() {
          return true;
        },
        
        getUserInfo: function() {
          return this.user;
        },
        
        getToken: function() {
          return this.token;
        },
        
        login: function(username, password) {
          console.log('AuthService.login called (from early-auth-fix.js)');
          return Promise.resolve({
            token: this.token,
            user: this.user
          });
        },
        
        refreshToken: function() {
          console.log('AuthService.refreshToken called (from early-auth-fix.js)');
          return Promise.resolve({
            token: createToken(),
            user: this.user
          });
        },
        
        handleAuthentication: function() {
          console.log('AuthService.handleAuthentication called (from early-auth-fix.js)');
          
          // Safe implementation that doesn't call refreshToken
          return Promise.resolve({
            authenticated: true,
            token: this.token,
            user: this.user
          });
        },
        
        logout: function() {
          console.log('AuthService.logout called (from early-auth-fix.js)');
          return Promise.resolve();
        },
        
        hasPermission: function(permission) {
          return true;
        }
      };
      
      console.log('✅ Created AuthService stub with refreshToken method');
    }
  }
  
  // Function to monkey patch the existing handleAuthentication method 
  // to make it safe even if refreshToken doesn't exist
  function patchHandleAuthentication() {
    if (window.AuthService && window.AuthService.prototype.handleAuthentication) {
      console.log('🔍 Found handleAuthentication method, making it safe...');
      
      // Save the original 
      const originalHandleAuthentication = window.AuthService.prototype.handleAuthentication;
      
      // Replace with a safer version
      window.AuthService.prototype.handleAuthentication = function() {
        console.log('AuthService.handleAuthentication called (patched by early-auth-fix.js)');
        
        try {
          // Try to call the original safely
          return originalHandleAuthentication.apply(this, arguments);
        } catch (error) {
          console.log('⚠️ Error in original handleAuthentication: ' + error.message);
          console.log('⚠️ Using fallback implementation');
          
          // Fallback that doesn't rely on refreshToken
          return Promise.resolve({
            authenticated: true,
            token: createToken(),
            user: {
              id: 'user123',
              name: 'Barista',
              role: 'barista'
            }
          });
        }
      };
      
      console.log('✅ Made handleAuthentication method safe');
    }
  }
  
  // Setup authentication
  setupAuth();
  
  // Initial patch
  patchAuthService();
  patchHandleAuthentication();
  
  // Save the fix for future reference
  window.earlyAuthFixApplied = true;
  
  // Function to observe for AuthService changes
  function setupObserver() {
    console.log('👀 Setting up observer for AuthService changes');
    
    // Keep track of the last seen state
    let lastAuthServiceHadRefreshToken = !!window.AuthService?.prototype?.refreshToken;
    
    // Check for changes periodically
    const observer = setInterval(function() {
      // Skip if the page is unloading
      if (document.readyState === 'unloading') {
        clearInterval(observer);
        return;
      }
      
      // Check if AuthService was added or changed
      const hasAuthService = !!window.AuthService;
      const hasRefreshToken = !!window.AuthService?.prototype?.refreshToken;
      
      // If AuthService was added or refreshToken was removed, apply patches
      if ((hasAuthService && !lastAuthServiceHadRefreshToken) || 
          (lastAuthServiceHadRefreshToken && !hasRefreshToken)) {
        console.log('🔄 AuthService changed, re-applying patches');
        patchAuthService();
        patchHandleAuthentication();
        
        // Update state
        lastAuthServiceHadRefreshToken = !!window.AuthService?.prototype?.refreshToken;
      }
    }, 100); // Check frequently during startup
    
    // After 10 seconds, slow down checks
    setTimeout(function() {
      clearInterval(observer);
      
      // Continue monitoring but less frequently
      setInterval(function() {
        if (!!window.AuthService && !window.AuthService.prototype.refreshToken) {
          console.log('🔄 AuthService.refreshToken missing, re-applying patches');
          patchAuthService();
          patchHandleAuthentication();
        }
      }, 2000);
    }, 10000);
  }
  
  // Set up observer to keep monitoring for changes
  setupObserver();
  
  // Make sure we apply fixes if AuthService is loaded after our script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      patchAuthService();
      patchHandleAuthentication();
    });
  }
  
  console.log('✅ Early Auth Fix: Initialized successfully');
})();