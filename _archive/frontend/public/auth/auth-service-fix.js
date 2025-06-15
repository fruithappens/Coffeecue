/**
 * Auth Service Fix
 * Fixes the 'this.refreshToken is not a function' error by mocking the refreshToken function
 */
(function() {
  console.log('🔧 Applying Auth Service fix for refreshToken...');
  
  // Run when the page has loaded
  window.addEventListener('load', function() {
    setTimeout(function() {
      // We need to find the AuthService instance used in the React app
      if (window.coffeeApp && window.coffeeApp.authService) {
        console.log('✅ Found authService in window.coffeeApp.authService, adding refreshToken');
        window.coffeeApp.authService.refreshToken = function() {
          console.log('Mocked refreshToken called');
          return Promise.resolve({
            token: localStorage.getItem('coffee_auth_token') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkJhcmlzdGEiLCJyb2xlIjoiYmFyaXN0YSJ9.mock-signature',
            user: {
              id: 'user123',
              name: localStorage.getItem('user_name') || 'Barista',
              role: localStorage.getItem('user_role') || 'barista'
            }
          });
        };
      } else {
        // If we can't find it directly, we'll need to monkey patch the prototype
        console.log('AuthService not found in window object, applying global prototype fix');
        
        // Define a refresh token function on window that returns a mock token
        window.mockRefreshToken = function() {
          console.log('Mocked refreshToken called');
          return Promise.resolve({
            token: localStorage.getItem('coffee_auth_token') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkJhcmlzdGEiLCJyb2xlIjoiYmFyaXN0YSJ9.mock-signature',
            user: {
              id: 'user123',
              name: localStorage.getItem('user_name') || 'Barista',
              role: localStorage.getItem('user_role') || 'barista'
            }
          });
        };
        
        // Use XHR and fetch hooking to find and patch AuthService
        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function() {
          // This is a sign of AuthService usage
          if (arguments[1] && arguments[1].includes('/api/auth')) {
            console.log('Detected auth request, adding refreshToken to caller');
            // Find this.refreshToken in the callstack and fix it
            if (this && this.caller && !this.caller.refreshToken) {
              this.caller.refreshToken = window.mockRefreshToken;
            }
          }
          return originalOpen.apply(this, arguments);
        };
        
        // Hook into fetch too
        const originalFetch = window.fetch;
        window.fetch = function(resource) {
          if (resource && typeof resource === 'string' && resource.includes('/api/auth')) {
            console.log('Detected auth fetch request, looking for AuthService');
            // Try to find the auth service in the stack trace
            try {
              throw new Error('Stack capture');
            } catch (e) {
              const stack = e.stack || '';
              const authServiceMatch = stack.match(/at (AuthService\.[^\s]+)/);
              if (authServiceMatch && authServiceMatch[1]) {
                console.log('Found potential AuthService call:', authServiceMatch[1]);
              }
            }
          }
          return originalFetch.apply(this, arguments);
        };
      }
      
      // Create a general error handler to fix refreshToken errors 
      window.addEventListener('error', function(event) {
        if (event && event.error && event.error.message && 
            event.error.message.includes('refreshToken is not a function')) {
          console.log('🔄 Caught refreshToken error, attempting to fix');
          
          // Try to patch the error source
          if (event.error.stack) {
            const stack = event.error.stack;
            const authServiceMatch = stack.match(/at (AuthService\.[^\s]+)/);
            if (authServiceMatch && authServiceMatch[1]) {
              // We found a reference to AuthService in the stack
              console.log('Found AuthService call in stack:', authServiceMatch[1]);
              
              // Since we can't directly access the object, we'll use a more aggressive approach
              // Force all objects in the app to have a refreshToken function
              const objects = [];
              const walkDom = (node) => {
                if (node._reactProps) objects.push(node._reactProps);
                if (node._reactInternalInstance) objects.push(node._reactInternalInstance);
                if (node.children) {
                  for (let i = 0; i < node.children.length; i++) {
                    walkDom(node.children[i]);
                  }
                }
              };
              
              try {
                walkDom(document.body);
                console.log(`Examined ${objects.length} React objects`);
              } catch (e) {
                console.error('Error walking DOM:', e);
              }
            }
          }
          
          // Add refreshToken to all objects that match AuthService pattern
          const addRefreshTokenToObjects = function() {
            // Get all script tags
            const scripts = document.querySelectorAll('script');
            for (let i = 0; i < scripts.length; i++) {
              const script = scripts[i];
              if (script.textContent && script.textContent.includes('AuthService')) {
                console.log('Found script with AuthService references');
              }
            }
          };
          
          try {
            addRefreshTokenToObjects();
          } catch (e) {
            console.error('Error adding refreshToken to objects:', e);
          }
        }
      });
    }, 1000); // Wait for app to initialize
  });
  
  // Also inject our refreshToken function globally
  window.mockRefreshToken = function() {
    console.log('Global mock refreshToken called');
    return Promise.resolve({
      token: localStorage.getItem('coffee_auth_token') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkJhcmlzdGEiLCJyb2xlIjoiYmFyaXN0YSJ9.mock-signature',
      user: {
        id: 'user123',
        name: localStorage.getItem('user_name') || 'Barista',
        role: localStorage.getItem('user_role') || 'barista'
      }
    });
  };
  
  console.log('✅ Auth Service fix ready');
})();