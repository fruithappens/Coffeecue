// api-test.js
// This script tests the direct API access to backend server
(function() {
  console.log("===== DIRECT API CONNECTION TEST =====");
  console.log("Testing direct API access to backend server at http://localhost:5001");
  
  // Function to decode JWT token
  function decodeJwt(token) {
    try {
      // Split the token
      const parts = token.split('.');
      if (parts.length !== 3) {
        return { error: "Invalid token format (not a JWT token)" };
      }
      
      // Get the payload (middle part)
      const payload = parts[1];
      
      // Base64Url decode and parse as JSON
      const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return decoded;
    } catch (e) {
      return { error: `Error decoding token: ${e.message}` };
    }
  }
  
  // Check if a token exists and is valid
  function validateToken() {
    const token = localStorage.getItem('coffee_system_token');
    if (!token) {
      console.log("❌ No token found - will attempt login");
      return null;
    }
    
    console.log("✅ Found token in localStorage");
    
    // Decode token
    const decoded = decodeJwt(token);
    console.log("Token payload:", decoded);
    
    // Check if token is expired
    if (decoded.exp) {
      const expiryDate = new Date(decoded.exp * 1000);
      const now = new Date();
      if (expiryDate > now) {
        console.log(`✅ Token is valid until: ${expiryDate.toLocaleString()}`);
        return token;
      } else {
        console.log(`❌ Token expired on: ${expiryDate.toLocaleString()} - will attempt login`);
        return null;
      }
    }
    
    return token;
  }
  
  // Login and get a token
  async function login() {
    console.log("Attempting to login with admin/adminpassword");
    
    try {
      const loginResponse = await fetch('http://localhost:5001/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: 'admin',
          password: 'adminpassword'
        })
      });
      
      if (!loginResponse.ok) {
        console.error(`❌ Login failed with status: ${loginResponse.status}`);
        console.error(await loginResponse.text());
        return null;
      }
      
      const loginData = await loginResponse.json();
      console.log("✅ Login successful:", loginData);
      
      if (loginData.token) {
        localStorage.setItem('coffee_system_token', loginData.token);
        console.log("✅ Token saved to localStorage");
        return loginData.token;
      } else {
        console.error("❌ No token in login response");
        return null;
      }
    } catch (error) {
      console.error("❌ Login error:", error);
      return null;
    }
  }
  
  // Test API endpoints with token
  async function testEndpoints(token) {
    console.log("\n===== TESTING API ENDPOINTS =====");
    
    // Test endpoints
    const endpoints = [
      { name: "Test", url: "http://localhost:5001/api/test" },
      { name: "Pending Orders", url: "http://localhost:5001/api/orders/pending" },
      { name: "In-Progress Orders", url: "http://localhost:5001/api/orders/in-progress" },
      { name: "Completed Orders", url: "http://localhost:5001/api/orders/completed" },
      { name: "Stations", url: "http://localhost:5001/api/stations" },
      { name: "Schedule Today", url: "http://localhost:5001/api/schedule/today" },
      { name: "Settings", url: "http://localhost:5001/api/settings" }
    ];
    
    for (const endpoint of endpoints) {
      console.log(`\nTesting ${endpoint.name}: ${endpoint.url}`);
      
      try {
        const headers = {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        };
        
        // Add authorization header if token is available
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(endpoint.url, {
          method: 'GET',
          headers: headers
        });
        
        console.log(`Status: ${response.status}`);
        
        if (response.ok) {
          const data = await response.json();
          console.log(`✅ Success:`, data);
          
          // Log specific details
          if (Array.isArray(data)) {
            console.log(`Found ${data.length} items`);
          } else if (data.orders) {
            console.log(`Found ${data.orders.length} orders`);
          } else if (data.stations) {
            console.log(`Found ${data.stations.length} stations`);
          } else if (data.schedules) {
            console.log(`Found ${data.schedules.length} schedule items`);
          } else if (data.settings) {
            console.log(`Found ${Object.keys(data.settings).length} settings`);
          }
        } else {
          console.error(`❌ Error:`, await response.text());
        }
      } catch (error) {
        console.error(`❌ Fetch error for ${endpoint.name}:`, error);
      }
    }
  }
  
  // Initialize and run tests
  async function runTests() {
    // Check for existing token
    let token = validateToken();
    
    // Login if no valid token
    if (!token) {
      token = await login();
    }
    
    // Test API endpoints
    await testEndpoints(token);
    
    console.log("\n===== TEST COMPLETED =====");
    console.log("To resolve any issues:");
    console.log("1. Check the backend server is running on port 5001");
    console.log("2. Verify CORS is enabled on the backend server");
    console.log("3. Verify authentication is working correctly");
    console.log("4. Check browser console for error details");
  }
  
  // Run the tests
  runTests();
})();