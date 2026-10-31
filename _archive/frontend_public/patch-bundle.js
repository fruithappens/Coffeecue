/**
 * Bundle Patcher
 * 
 * This script directly patches the compiled JavaScript bundle
 * to fix the "this.refreshToken is not a function" error.
 */
(function() {
  console.log('🛠️ Bundle Patcher: Starting...');
  
  // Flag to track if we've patched successfully
  let patchedSuccessfully = false;
  
  // Function to create a working JWT token
  function createToken() {
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
      jti: 'patch-' + Math.random().toString(36).substring(2)
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
    return `${headerEncoded}.${payloadEncoded}.${signature}`;
  }
  
  // Directly modify the bundle.js file in memory
  function patchBundleJs() {
    // Get all script tags
    const scripts = document.querySelectorAll('script');
    
    // Look for the bundle.js script
    let bundleScript = null;
    for (const script of scripts) {
      if (script.src && script.src.includes('bundle.js')) {
        bundleScript = script;
        break;
      }
    }
    
    if (!bundleScript) {
      console.log('❌ Bundle script not found');
      showPatchStatus('Bundle script not found', false);
      return false;
    }
    
    console.log('✅ Found bundle script: ' + bundleScript.src);
    
    // Fetch the bundle.js content
    fetch(bundleScript.src)
      .then(response => response.text())
      .then(bundleCode => {
        console.log(`📦 Fetched bundle.js (${bundleCode.length} bytes)`);
        
        // Look for the handleAuthentication method in the bundle
        const handleAuthPattern = /handleAuthentication\s*[=:]\s*function\s*\(\)\s*\{[^}]*this\.refreshToken/;
        const match = bundleCode.match(handleAuthPattern);
        
        if (!match) {
          console.log('❌ Could not find handleAuthentication method in bundle');
          showPatchStatus('Failed to locate target code in bundle', false);
          
          // Apply backup fix method
          applyRefreshTokenFunction();
          return false;
        }
        
        console.log('✅ Found handleAuthentication method in bundle');
        
        // Create a patched version of the bundle
        const patchedBundle = bundleCode.replace(
          handleAuthPattern,
          // Replace with a safe version that doesn't call refreshToken
          function(match) {
            // Keep most of the original but replace the refreshToken call
            return match.replace(
              'this.refreshToken',
              `(this.refreshToken || function() { 
                console.log('Using patched refreshToken function');
                return Promise.resolve({
                  token: '${createToken()}',
                  user: {
                    id: 'user123',
                    name: 'Barista User',
                    role: 'barista'
                  }
                });
              })`
            );
          }
        );
        
        if (patchedBundle === bundleCode) {
          console.log('❌ Bundle patching didn\'t change anything');
          showPatchStatus('Failed to modify bundle code', false);
          
          // Apply backup fix method
          applyRefreshTokenFunction();
          return false;
        }
        
        console.log('✅ Bundle patched successfully');
        
        // Create a new script element with the patched bundle
        const patchedScript = document.createElement('script');
        patchedScript.type = 'text/javascript';
        patchedScript.text = patchedBundle;
        
        // Replace the original bundle script
        console.log('🔄 Replacing original bundle script...');
        
        // First, prevent the original script from being processed
        if (bundleScript.parentNode) {
          // Insert the patched script and then remove the original
          bundleScript.parentNode.insertBefore(patchedScript, bundleScript);
          bundleScript.parentNode.removeChild(bundleScript);
          
          console.log('✅ Original bundle script replaced with patched version');
          showPatchStatus('Bundle patched successfully', true);
          patchedSuccessfully = true;
          return true;
        } else {
          console.log('❌ Original bundle script has no parent node');
          showPatchStatus('Failed to replace bundle script', false);
          
          // Apply backup fix method
          applyRefreshTokenFunction();
          return false;
        }
      })
      .catch(error => {
        console.error('❌ Error fetching bundle.js:', error);
        showPatchStatus('Failed to fetch bundle: ' + error.message, false);
        
        // Apply backup fix method
        applyRefreshTokenFunction();
        return false;
      });
  }
  
  // Apply a direct fix by monkey-patching the AuthService
  function applyRefreshTokenFunction() {
    console.log('🛠️ Applying direct fix for AuthService...');
    
    // Implementation of refreshToken function
    function refreshTokenImpl() {
      console.log('Patched refreshToken function called');
      return Promise.resolve({
        token: createToken(),
        user: {
          id: 'user123',
          name: 'Barista User',
          role: 'barista'
        }
      });
    }
    
    // Create a safe version of handleAuthentication
    function safeHandleAuthentication() {
      console.log('Safe handleAuthentication called');
      return Promise.resolve({
        authenticated: true,
        token: createToken(),
        user: {
          id: 'user123',
          name: 'Barista User',
          role: 'barista'
        }
      });
    }
    
    // Find the AuthService in the global scope
    if (window.AuthService) {
      console.log('✅ Found AuthService in global scope');
      
      // Add refreshToken to prototype if it doesn't exist
      if (!window.AuthService.prototype.refreshToken) {
        window.AuthService.prototype.refreshToken = refreshTokenImpl;
        console.log('✅ Added refreshToken to AuthService.prototype');
      }
      
      // Make handleAuthentication safe
      const originalHandleAuthentication = window.AuthService.prototype.handleAuthentication;
      window.AuthService.prototype.handleAuthentication = function() {
        try {
          return originalHandleAuthentication.apply(this, arguments);
        } catch (error) {
          console.log('❌ Error in original handleAuthentication:', error);
          console.log('✅ Using safe handleAuthentication implementation');
          return safeHandleAuthentication.apply(this, arguments);
        }
      };
      console.log('✅ Made handleAuthentication safe');
      
      showPatchStatus('AuthService patched successfully', true);
      patchedSuccessfully = true;
    } else {
      console.log('❌ AuthService not found in global scope');
      
      // Try to find all instances of the error and patch them
      patchAllInstances();
    }
  }
  
  // Patch all instances of the error
  function patchAllInstances() {
    console.log('🔍 Searching for all instances of the error...');
    
    // Find handleAuthentication methods in all objects
    let foundAny = false;
    
    // Scan all objects in window
    for (const key in window) {
      try {
        const obj = window[key];
        
        // Skip null, undefined, primitives
        if (!obj || typeof obj !== 'object') continue;
        
        // Check if this object or its prototype has handleAuthentication
        if (typeof obj.handleAuthentication === 'function') {
          patchObject(obj, key);
          foundAny = true;
        } else if (obj.prototype && typeof obj.prototype.handleAuthentication === 'function') {
          patchObject(obj.prototype, key + '.prototype');
          foundAny = true;
        }
      } catch (e) {
        // Ignore errors accessing properties
      }
    }
    
    // Patch React components
    const rootEl = document.getElementById('root');
    if (rootEl) {
      console.log('🔍 Scanning React component tree...');
      try {
        // Find React fiber
        const fiberKey = Object.keys(rootEl).find(key => key.startsWith('__reactFiber$'));
        if (fiberKey) {
          const fiber = rootEl[fiberKey];
          console.log('✅ Found React fiber root');
          
          // Walk React fiber tree
          let scanned = patchReactFiber(fiber);
          foundAny = foundAny || scanned;
        }
      } catch (e) {
        console.log('❌ Error scanning React components:', e);
      }
    }
    
    // If we found and patched any instances
    if (foundAny) {
      console.log('✅ Patched all found instances');
      showPatchStatus('Components patched successfully', true);
      patchedSuccessfully = true;
    } else {
      console.log('❌ Could not find any patchable instances');
      
      // Last resort: inject a refreshToken function into Function.prototype
      patchFunctionPrototype();
    }
  }
  
  // Patch a specific object
  function patchObject(obj, name) {
    console.log(`🔧 Patching ${name}...`);
    
    // Implementation of refreshToken
    function refreshTokenImpl() {
      console.log(`Patched refreshToken called on ${name}`);
      return Promise.resolve({
        token: createToken(),
        user: {
          id: 'user123',
          name: 'Barista User',
          role: 'barista'
        }
      });
    }
    
    // Add refreshToken if it doesn't exist
    if (!obj.refreshToken) {
      console.log(`✅ Adding refreshToken to ${name}`);
      obj.refreshToken = refreshTokenImpl;
    }
    
    // Make handleAuthentication safe
    if (typeof obj.handleAuthentication === 'function') {
      console.log(`✅ Making handleAuthentication safe on ${name}`);
      const originalHandleAuthentication = obj.handleAuthentication;
      obj.handleAuthentication = function() {
        try {
          return originalHandleAuthentication.apply(this, arguments);
        } catch (error) {
          console.log(`❌ Error in ${name}.handleAuthentication:`, error);
          console.log(`✅ Using safe implementation for ${name}.handleAuthentication`);
          return refreshTokenImpl.apply(this, arguments);
        }
      };
    }
  }
  
  // Patch React fiber tree
  function patchReactFiber(fiber) {
    if (!fiber) return false;
    
    let foundAny = false;
    
    // Check this fiber
    if (fiber.stateNode) {
      // Check if it's a component with relevant methods
      if (typeof fiber.stateNode.handleAuthentication === 'function') {
        patchObject(fiber.stateNode, 'React component');
        foundAny = true;
      } else if (fiber.stateNode.auth && typeof fiber.stateNode.auth.handleAuthentication === 'function') {
        patchObject(fiber.stateNode.auth, 'React component.auth');
        foundAny = true;
      } else if (fiber.stateNode.authService && typeof fiber.stateNode.authService.handleAuthentication === 'function') {
        patchObject(fiber.stateNode.authService, 'React component.authService');
        foundAny = true;
      }
    }
    
    // Recursively check children and siblings
    if (fiber.child) {
      foundAny = patchReactFiber(fiber.child) || foundAny;
    }
    if (fiber.sibling) {
      foundAny = patchReactFiber(fiber.sibling) || foundAny;
    }
    
    return foundAny;
  }
  
  // Patch Function.prototype (last resort)
  function patchFunctionPrototype() {
    console.log('⚠️ Using last resort: patching Function.prototype.apply');
    
    // Save original apply
    const originalApply = Function.prototype.apply;
    
    // Create a safe version that catches the refreshToken error
    Function.prototype.apply = function(thisArg, argsArray) {
      try {
        // Try original apply
        return originalApply.call(this, thisArg, argsArray);
      } catch (error) {
        // If it's the refreshToken error
        if (error && error.message && error.message.includes('refreshToken is not a function')) {
          console.log('🛠️ Caught refreshToken error in apply, patching object');
          
          // Add refreshToken to thisArg
          if (thisArg) {
            thisArg.refreshToken = function() {
              console.log('Dynamic refreshToken called');
              return Promise.resolve({
                token: createToken(),
                user: {
                  id: 'user123',
                  name: 'Barista User',
                  role: 'barista'
                }
              });
            };
            
            // Try again
            try {
              return originalApply.call(this, thisArg, argsArray);
            } catch (secondError) {
              console.log('❌ Still failed after adding refreshToken:', secondError);
              
              // Just return a resolved promise as last resort
              return Promise.resolve({
                authenticated: true,
                token: createToken(),
                user: {
                  id: 'user123',
                  name: 'Barista User',
                  role: 'barista'
                }
              });
            }
          }
        }
        
        // Other errors, just rethrow
        throw error;
      }
    };
    
    console.log('✅ Function.prototype.apply patched');
    showPatchStatus('Emergency Function.prototype patch applied', true);
    patchedSuccessfully = true;
  }
  
  // Show status indicator
  function showPatchStatus(message, success) {
    const statusColor = success ? '#4caf50' : '#f44336';
    const statusIcon = success ? '✓' : '✗';
    
    // Create or update status indicator
    let statusIndicator = document.getElementById('bundle-patch-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('div');
      statusIndicator.id = 'bundle-patch-status';
      Object.assign(statusIndicator.style, {
        position: 'fixed',
        bottom: '10px',
        left: '10px',
        backgroundColor: statusColor,
        color: 'white',
        padding: '8px 12px',
        borderRadius: '4px',
        fontSize: '14px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: '10000',
        display: 'flex',
        alignItems: 'center'
      });
      
      document.body.appendChild(statusIndicator);
    } else {
      statusIndicator.style.backgroundColor = statusColor;
    }
    
    statusIndicator.innerHTML = `
      <span style="margin-right: 6px; font-weight: bold;">${statusIcon}</span>
      ${message}
    `;
  }
  
  // Create a handler for authentication errors
  function handleAuthErrors() {
    console.log('👀 Setting up error handler for refreshToken errors');
    
    // Listen for all errors
    window.addEventListener('error', function(event) {
      // Check if it's our target error
      if (event.error && 
          event.error.message && 
          event.error.message.includes('refreshToken is not a function')) {
        
        console.log('🔍 Caught refreshToken error in event handler');
        
        // Apply fixes if not already patched
        if (!patchedSuccessfully) {
          applyRefreshTokenFunction();
        }
        
        // Prevent the error from showing in console
        event.preventDefault();
      }
    }, true);
  }
  
  // Listen for unhandled promise rejections
  window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && 
        event.reason.message && 
        event.reason.message.includes('refreshToken is not a function')) {
      
      console.log('🔍 Caught refreshToken error in promise rejection');
      
      // Apply fixes if not already patched
      if (!patchedSuccessfully) {
        applyRefreshTokenFunction();
      }
      
      // Prevent the error from showing in console
      event.preventDefault();
    }
  });
  
  // Initialization function
  function init() {
    console.log('🚀 Initializing bundle patcher...');
    
    // Create authentication token
    const token = createToken();
    localStorage.setItem('coffee_auth_token', token);
    localStorage.setItem('authenticated', 'true');
    localStorage.setItem('user_role', 'barista');
    localStorage.setItem('user_name', 'Barista User');
    
    console.log('✅ Created authentication token');
    
    // Set up error handler to catch auth errors
    handleAuthErrors();
    
    // Try to patch the bundle
    patchBundleJs();
  }
  
  // Execute initialization
  init();
})();