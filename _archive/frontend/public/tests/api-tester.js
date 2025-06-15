// api-tester.js
// This script provides direct API testing functions that can be called from the browser console
(function(window) {
  console.log("API Tester loaded - use window.testApi() and window.testOrders() functions");
  
  // Test basic API connectivity
  function testApi() {
    console.log("Testing API connection to http://localhost:5001/api/test...");
    
    return fetch('http://localhost:5001/api/test')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log("✅ API test successful:", data);
        return data;
      })
      .catch(error => {
        console.error("❌ API test failed:", error.message);
        return { error: error.message };
      });
  }
  
  // Test authenticated API endpoint (orders)
  function testOrders() {
    console.log("Testing authenticated API endpoint (orders)...");
    
    // Get token from localStorage
    const token = localStorage.getItem('coffee_system_token');
    if (!token) {
      console.error("❌ No authentication token found in localStorage!");
      return Promise.resolve({ error: "No authentication token found" });
    }
    
    console.log(`Using token: ${token.substring(0, 20)}...`);
    
    return fetch('http://localhost:5001/api/orders/pending', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log("✅ Orders API test successful:", data);
        return data;
      })
      .catch(error => {
        console.error("❌ Orders API test failed:", error.message);
        return { error: error.message };
      });
  }
  
  // Create a manual login function to get a fresh token
  function login(username = 'admin', password = 'adminpassword') {
    console.log(`Logging in with username: ${username}...`);
    
    return fetch('http://localhost:5001/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log("✅ Login successful:", data);
        
        // Save token to localStorage
        if (data.token) {
          localStorage.setItem('coffee_system_token', data.token);
          console.log("Token saved to localStorage");
          
          // Save user data if available
          if (data.user) {
            localStorage.setItem('coffee_system_user', JSON.stringify(data.user));
            console.log("User data saved to localStorage");
          }
        }
        
        return data;
      })
      .catch(error => {
        console.error("❌ Login failed:", error.message);
        return { error: error.message };
      });
  }
  
  // Export functions to window for console access
  window.testApi = testApi;
  window.testOrders = testOrders;
  window.loginApi = login;
  
  // Add more test functions as needed
  
})(window);