/**
 * Auth Service Stub
 * Creates a complete stub for the AuthService that the React app can use
 */
(function() {
  console.log('🔧 Initializing AuthService stub...');
  
  // Create a working JWT token
  const createToken = function() {
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkJhcmlzdGEiLCJyb2xlIjoiYmFyaXN0YSIsImlhdCI6MTcxNzExMjAwMCwiZXhwIjoxODAwMDAwMDAwfQ.signature';
  };
  
  // Create user info
  const userInfo = {
    id: 'user123',
    name: 'Barista',
    role: 'barista',
    permissions: ['order:read', 'order:update']
  };
  
  // Create the stub for the AuthService class
  window.AuthService = function() {
    console.log('AuthService constructor called');
    
    // Store authentication state
    this.isAuthenticated = true;
    this.token = createToken();
    this.user = userInfo;
    
    // Store the token in localStorage
    localStorage.setItem('coffee_auth_token', this.token);
    localStorage.setItem('authenticated', 'true');
    localStorage.setItem('user_role', this.user.role);
    localStorage.setItem('user_name', this.user.name);
  };
  
  // Add methods to the prototype
  window.AuthService.prototype = {
    // Initialize the authentication state
    init: function() {
      console.log('AuthService.init called');
      return Promise.resolve({
        authenticated: true,
        token: this.token,
        user: this.user
      });
    },
    
    // Check if the user is authenticated
    isLoggedIn: function() {
      console.log('AuthService.isLoggedIn called');
      return true;
    },
    
    // Get the user info
    getUserInfo: function() {
      console.log('AuthService.getUserInfo called');
      return this.user;
    },
    
    // Get the token
    getToken: function() {
      console.log('AuthService.getToken called');
      return this.token;
    },
    
    // Login with credentials
    login: function(username, password) {
      console.log('AuthService.login called');
      return Promise.resolve({
        token: this.token,
        user: this.user
      });
    },
    
    // Refresh the token
    refreshToken: function() {
      console.log('AuthService.refreshToken called');
      return Promise.resolve({
        token: createToken(),
        user: this.user
      });
    },
    
    // Handle authentication (called when token is present)
    handleAuthentication: function() {
      console.log('AuthService.handleAuthentication called');
      return Promise.resolve({
        authenticated: true,
        token: this.token,
        user: this.user
      });
    },
    
    // Logout
    logout: function() {
      console.log('AuthService.logout called');
      return Promise.resolve();
    },
    
    // Check a permission
    hasPermission: function(permission) {
      console.log('AuthService.hasPermission called for ' + permission);
      return true; // Always return true for permissions
    }
  };
  
  // Also create a global instance so it can be found
  window.authServiceInstance = new window.AuthService();
  
  console.log('✅ AuthService stub initialized');
})();