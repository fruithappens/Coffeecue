// Temporary patch for AuthService to bypass token refresh issues
// This script should be included in the React app to override the problematic methods

console.log('Applying AuthService patch...');

// Wait for AuthService to be available
function patchAuthService() {
  // Try to access AuthService from the global scope or module system
  const originalHandleAuth = window.AuthService?.handleAuthentication;
  
  if (window.AuthService) {
    console.log('Patching AuthService.handleAuthentication...');
    
    // Override the handleAuthentication method to bypass refresh
    window.AuthService.handleAuthentication = async function() {
      console.log('🔧 Using patched handleAuthentication');
      
      // Simple check - if we have a token and user, consider authenticated
      const token = this.getToken();
      const user = this.getCurrentUser();
      
      if (!token || !user) {
        console.log('No token or user found');
        return false;
      }
      
      // Validate token format
      try {
        const parts = token.split('.');
        if (parts.length !== 3) {
          console.log('Invalid token format');
          return false;
        }
        
        // Decode payload to check basic validity
        const payload = JSON.parse(atob(parts[1]));
        
        // Check if token is completely expired (not just within refresh window)
        const exp = new Date(payload.exp * 1000);
        const now = new Date();
        
        if (exp <= now) {
          console.log('Token is completely expired');
          return false;
        }
        
        console.log('✅ Token is valid, bypassing refresh logic');
        
        // Set token for API requests
        if (window.OrderDataService?.setToken) {
          window.OrderDataService.setToken(token);
        }
        
        return true;
        
      } catch (error) {
        console.error('Error validating token:', error);
        return false;
      }
    };
    
    console.log('✅ AuthService patched successfully');
    return true;
  }
  
  return false;
}

// Try to patch immediately
if (!patchAuthService()) {
  // If not available yet, try again after a delay
  setTimeout(() => {
    if (!patchAuthService()) {
      console.log('Could not patch AuthService - it may not be globally available');
    }
  }, 2000);
}

export default patchAuthService;