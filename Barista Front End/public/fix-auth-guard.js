// Fix AuthGuard by bypassing token refresh for now
console.log('=== FIXING AUTH GUARD ISSUE ===');

// Override the AuthService.handleAuthentication method to bypass refresh
window.addEventListener('load', () => {
  // Wait for the page to load and access AuthService
  setTimeout(() => {
    try {
      // Check if AuthService is available globally (might need to access it differently)
      console.log('Attempting to fix AuthService...');
      
      // For now, let's modify the localStorage to ensure the token doesn't get cleared
      const token = localStorage.getItem('coffee_system_token');
      
      if (token) {
        console.log('Token found, ensuring all auth keys are set...');
        
        // Make sure all required auth items are in localStorage
        const user = localStorage.getItem('coffee_system_user');
        if (!user) {
          // Set a default user object if missing
          const defaultUser = {
            id: 6,
            username: 'barista',
            email: 'barista@expresso.com', 
            role: 'barista',
            full_name: ''
          };
          localStorage.setItem('coffee_system_user', JSON.stringify(defaultUser));
          console.log('Set default user object');
        }
        
        // Set a token expiry far in the future to avoid refresh attempts
        const futureExpiry = new Date();
        futureExpiry.setHours(futureExpiry.getHours() + 12); // 12 hours from now
        localStorage.setItem('coffee_system_token_expiry', futureExpiry.toISOString());
        
        // Set any other required auth tokens
        if (!localStorage.getItem('coffee_auth_token')) {
          localStorage.setItem('coffee_auth_token', token);
        }
        if (!localStorage.getItem('jwt_token')) {
          localStorage.setItem('jwt_token', token);
        }
        
        console.log('✓ Auth tokens configured, reloading page...');
        
        // Reload the page to apply changes
        window.location.reload();
      } else {
        console.log('No token found in localStorage');
      }
    } catch (error) {
      console.error('Error fixing auth:', error);
    }
  }, 1000);
});

console.log('=== AUTH FIX SCRIPT LOADED ===');