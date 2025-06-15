/**
 * Login Bypass Script
 * This script bypasses token validation for login screens
 */
(function() {
  console.log('🔑 Initializing login bypass...');
  
  // Listen for the page load event
  window.addEventListener('DOMContentLoaded', function() {
    console.log('Checking if on login page...');
    
    // Check if we're on a login page
    const isLoginPage = window.location.pathname.includes('/login') || 
                        document.title.toLowerCase().includes('login') ||
                        document.querySelector('form') !== null;
    
    if (isLoginPage) {
      console.log('Login page detected, applying bypass...');
      
      // Set authenticated state directly
      localStorage.setItem('authenticated', 'true');
      localStorage.setItem('coffee_auth_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
      localStorage.setItem('user_role', 'barista');
      localStorage.setItem('user_name', 'Demo User');
      
      // Set fallback mode
      localStorage.setItem('use_fallback_data', 'true');
      localStorage.setItem('force_offline_mode', 'true');
      
      // Add a login bypass button
      const loginForm = document.querySelector('form');
      if (loginForm) {
        // Create bypass button
        const bypassButton = document.createElement('button');
        bypassButton.innerText = 'Login with Demo Account';
        bypassButton.style.backgroundColor = '#4CAF50';
        bypassButton.style.color = 'white';
        bypassButton.style.border = 'none';
        bypassButton.style.padding = '10px 15px';
        bypassButton.style.marginTop = '10px';
        bypassButton.style.borderRadius = '4px';
        bypassButton.style.cursor = 'pointer';
        bypassButton.style.width = '100%';
        
        // Add click handler
        bypassButton.addEventListener('click', function(e) {
          e.preventDefault();
          
          // Set additional bypass values
          sessionStorage.setItem('login_bypass_applied', 'true');
          
          // Redirect to main page
          console.log('Login bypass applied, redirecting...');
          window.location.href = '/?bypass=true';
        });
        
        // Add to form
        loginForm.appendChild(bypassButton);
      } else {
        // If no form found, add a message and button to the body
        const bypassContainer = document.createElement('div');
        bypassContainer.style.margin = '20px auto';
        bypassContainer.style.padding = '15px';
        bypassContainer.style.backgroundColor = '#f8f9fa';
        bypassContainer.style.border = '1px solid #ddd';
        bypassContainer.style.borderRadius = '4px';
        bypassContainer.style.maxWidth = '400px';
        bypassContainer.style.textAlign = 'center';
        
        const bypassTitle = document.createElement('h3');
        bypassTitle.innerText = 'Login Bypass Available';
        bypassTitle.style.margin = '0 0 10px 0';
        
        const bypassDesc = document.createElement('p');
        bypassDesc.innerText = 'Token validation errors detected. Use the demo account to bypass login.';
        
        const bypassButton = document.createElement('button');
        bypassButton.innerText = 'Login with Demo Account';
        bypassButton.style.backgroundColor = '#4CAF50';
        bypassButton.style.color = 'white';
        bypassButton.style.border = 'none';
        bypassButton.style.padding = '10px 15px';
        bypassButton.style.marginTop = '10px';
        bypassButton.style.borderRadius = '4px';
        bypassButton.style.cursor = 'pointer';
        
        // Add click handler
        bypassButton.addEventListener('click', function() {
          // Set additional bypass values
          sessionStorage.setItem('login_bypass_applied', 'true');
          
          // Redirect to main page
          console.log('Login bypass applied, redirecting...');
          window.location.href = '/?bypass=true';
        });
        
        // Assemble and add to body
        bypassContainer.appendChild(bypassTitle);
        bypassContainer.appendChild(bypassDesc);
        bypassContainer.appendChild(bypassButton);
        
        // Add to beginning of body
        document.body.insertBefore(bypassContainer, document.body.firstChild);
      }
      
      console.log('✅ Login bypass UI added');
    } else {
      // If we're redirected from login page with bypass
      if (window.location.search.includes('bypass=true') || sessionStorage.getItem('login_bypass_applied') === 'true') {
        console.log('Bypass flag detected, applying authentication...');
        
        // Ensure authentication is set
        localStorage.setItem('authenticated', 'true');
        localStorage.setItem('coffee_auth_token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
        localStorage.setItem('user_role', 'barista');
        localStorage.setItem('user_name', 'Demo User');
      }
    }
  });
  
  // Also intercept any requests to login/auth endpoints
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    if (typeof url === 'string' && (url.includes('/api/auth') || url.includes('/api/login'))) {
      console.log('Intercepting auth request to: ' + url);
      
      // Return a successful auth response
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              success: true,
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
              user: {
                id: 'demo-123',
                name: 'Demo User',
                role: 'barista'
              }
            }),
            text: () => Promise.resolve(JSON.stringify({
              success: true,
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
              user: {
                id: 'demo-123',
                name: 'Demo User',
                role: 'barista'
              }
            }))
          });
        }, 500);
      });
    }
    
    // For other URLs, proceed normally
    return originalFetch.apply(this, arguments);
  };
  
  // Similar intercept for XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
    if (typeof url === 'string' && (url.includes('/api/auth') || url.includes('/api/login'))) {
      // We'll redirect this to a dummy URL and handle the response manually
      const mockUrl = '/mock-auth-endpoint';
      
      // Call original with mock URL
      originalOpen.call(this, method, mockUrl, async === false ? false : true, user, password);
      
      // Override send to return a mock response
      const originalSend = this.send;
      this.send = function(body) {
        // Set our own onload handler
        const originalOnload = this.onload;
        this.onload = function() {
          if (originalOnload) {
            originalOnload.call(this);
          }
        };
        
        // Mock the response
        setTimeout(() => {
          Object.defineProperty(this, 'status', { value: 200 });
          Object.defineProperty(this, 'statusText', { value: 'OK' });
          Object.defineProperty(this, 'response', { 
            value: JSON.stringify({
              success: true,
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
              user: {
                id: 'demo-123',
                name: 'Demo User',
                role: 'barista'
              }
            })
          });
          Object.defineProperty(this, 'responseText', { 
            value: JSON.stringify({
              success: true,
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwicm9sZSI6ImJhcmlzdGEiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
              user: {
                id: 'demo-123',
                name: 'Demo User',
                role: 'barista'
              }
            })
          });
          
          if (this.onload) {
            this.onload();
          }
          
          if (this.onreadystatechange) {
            Object.defineProperty(this, 'readyState', { value: 4 });
            this.onreadystatechange();
          }
        }, 500);
        
        // Don't actually send the request
        console.log('Blocked auth XHR and mocked response');
      };
      
      return;
    }
    
    // For other URLs, proceed normally
    return originalOpen.call(this, method, url, async === false ? false : true, user, password);
  };
  
  console.log('✅ Login bypass initialized');
})();