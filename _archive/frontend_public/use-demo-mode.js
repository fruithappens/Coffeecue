// use-demo-mode.js - Properly enables demo mode with sample data
(function() {
  console.log('Enabling demo mode with sample data...');
  
  // Clear all authentication-related storage
  function clearAuthStorage() {
    // Remove all tokens
    localStorage.removeItem('coffee_system_token');
    localStorage.removeItem('coffee_auth_token');
    localStorage.removeItem('jwt_token');
    
    // Clear auth error tracking
    localStorage.removeItem('auth_error_count');
    
    console.log('Cleared all authentication tokens');
  }
  
  // Add sample order data
  function createSampleData() {
    // Sample pending orders
    const samplePendingOrders = [
      {
        id: 'sample_p1',
        orderNumber: 'SP001',
        customerName: 'Emma Davis',
        coffeeType: 'Large Latte',
        milkType: 'Soy milk',
        sugar: '1 sugar',
        priority: false,
        createdAt: new Date(Date.now() - 8 * 60000).toISOString(),
        waitTime: 8,
        promisedTime: 15,
        batchGroup: 'latte-soy'
      },
      {
        id: 'sample_p2',
        orderNumber: 'SP002',
        customerName: 'Thomas Brown',
        coffeeType: 'Medium Cappuccino',
        milkType: 'Full Cream',
        sugar: '0 sugar',
        priority: false,
        createdAt: new Date(Date.now() - 9 * 60000).toISOString(),
        waitTime: 9,
        promisedTime: 15,
        batchGroup: 'cappuccino-regular'
      },
      {
        id: 'sample_p3',
        orderNumber: 'SP003',
        customerName: 'Sarah Johnson',
        coffeeType: 'Small Flat White',
        milkType: 'Almond milk',
        sugar: '2 sugar',
        priority: true,
        createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
        waitTime: 5,
        promisedTime: 12,
        batchGroup: 'flatwhite-almond'
      }
    ];

    // Sample in-progress orders
    const sampleInProgressOrders = [
      {
        id: 'sample_i1',
        orderNumber: 'SI001',
        customerName: 'Michael Johnson',
        phoneNumber: '+61 423 555 789',
        coffeeType: 'Large Cappuccino',
        milkType: 'Oat milk',
        sugar: '1 sugar',
        extraHot: true,
        priority: true,
        createdAt: new Date(Date.now() - 3 * 60000).toISOString(),
        startedAt: new Date().toISOString(),
        waitTime: 3,
        promisedTime: 15
      },
      {
        id: 'sample_i2',
        orderNumber: 'SI002',
        customerName: 'Jennifer Wilson',
        phoneNumber: '+61 412 345 678',
        coffeeType: 'Medium Long Black',
        milkType: 'No milk',
        sugar: '0 sugar',
        priority: false,
        createdAt: new Date(Date.now() - 6 * 60000).toISOString(),
        startedAt: new Date(Date.now() - 1 * 60000).toISOString(),
        waitTime: 6,
        promisedTime: 15
      }
    ];

    // Sample completed orders
    const sampleCompletedOrders = [
      {
        id: 'sample_c1',
        orderNumber: 'SC001',
        customerName: 'Emma Johnson',
        phoneNumber: '+61 423 456 789',
        coffeeType: 'Large Flat White',
        milkType: 'Almond milk',
        sugar: '0 sugar',
        createdAt: new Date(Date.now() - 20 * 60000).toISOString(),
        completedAt: new Date(Date.now() - 10 * 60000).toISOString()
      },
      {
        id: 'sample_c2',
        orderNumber: 'SC002',
        customerName: 'David Smith',
        phoneNumber: '+61 434 567 890',
        coffeeType: 'Small Latte',
        milkType: 'Full Cream',
        sugar: '1 sugar',
        createdAt: new Date(Date.now() - 25 * 60000).toISOString(),
        completedAt: new Date(Date.now() - 15 * 60000).toISOString()
      },
      {
        id: 'sample_c3',
        orderNumber: 'SC003',
        customerName: 'Jessica Williams',
        phoneNumber: '+61 445 678 901',
        coffeeType: 'Medium Mocha',
        milkType: 'Soy milk',
        sugar: '2 sugar',
        createdAt: new Date(Date.now() - 30 * 60000).toISOString(),
        completedAt: new Date(Date.now() - 20 * 60000).toISOString()
      }
    ];

    // Sample stations
    const sampleStations = [
      {
        id: 1,
        name: 'Station 1',
        status: 'active',
        barista: 'John Barista',
        queue_length: 2,
        last_activity: new Date(Date.now() - 5 * 60000).toISOString()
      },
      {
        id: 2,
        name: 'Station 2',
        status: 'active',
        barista: 'Sarah Barista',
        queue_length: 1,
        last_activity: new Date(Date.now() - 3 * 60000).toISOString()
      }
    ];

    // Sample schedule
    const sampleSchedule = {
      today: [
        {
          id: 1,
          time_slot: '08:00 - 10:00',
          barista: 'John Barista',
          station_id: 1
        },
        {
          id: 2,
          time_slot: '10:00 - 12:00',
          barista: 'Sarah Barista',
          station_id: 2
        },
        {
          id: 3,
          time_slot: '12:00 - 14:00',
          barista: 'Michael Barista',
          station_id: 1
        }
      ]
    };

    // Save sample data to localStorage
    localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(sampleInProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(sampleCompletedOrders));
    localStorage.setItem('fallback_stations', JSON.stringify(sampleStations));
    localStorage.setItem('fallback_schedule', JSON.stringify(sampleSchedule));
    
    // Mark fallback data as available
    localStorage.setItem('fallback_data_available', 'true');
    
    console.log('Sample fallback data created successfully');
  }
  
  // Enable demo mode
  function enableDemoMode() {
    // Set fallback flags
    localStorage.setItem('use_fallback_data', 'true');
    localStorage.setItem('auth_error_refresh_needed', 'true');
    localStorage.setItem('coffee_connection_status', 'offline');
    localStorage.setItem('demo_mode_enabled', 'true');
    
    console.log('Demo mode enabled successfully');
  }
  
  // Run all setup functions
  function setupDemoMode() {
    try {
      // First clear any existing auth data
      clearAuthStorage();
      
      // Then create sample data
      createSampleData();
      
      // Finally enable demo mode
      enableDemoMode();
      
      console.log('Demo mode setup completed successfully');
      
      // Show success notification
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.top = '10px';
      div.style.left = '10px';
      div.style.right = '10px';
      div.style.backgroundColor = '#4CAF50';
      div.style.color = 'white';
      div.style.padding = '15px';
      div.style.borderRadius = '5px';
      div.style.zIndex = '9999';
      div.style.textAlign = 'center';
      div.innerHTML = 'Demo mode enabled with sample data! <button onclick="window.location.href=\'/barista\'" style="margin-left:15px;background:#fff;color:#4CAF50;border:none;padding:5px 10px;border-radius:3px;cursor:pointer;">Go to Barista View</button>';
      
      document.body.appendChild(div);
      
      // Auto-redirect after 3 seconds
      setTimeout(() => {
        window.location.href = '/barista';
      }, 3000);
      
    } catch (error) {
      console.error('Error setting up demo mode:', error);
      
      // Show error notification
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.top = '10px';
      div.style.left = '10px';
      div.style.right = '10px';
      div.style.backgroundColor = '#f44336';
      div.style.color = 'white';
      div.style.padding = '15px';
      div.style.borderRadius = '5px';
      div.style.zIndex = '9999';
      div.style.textAlign = 'center';
      div.innerHTML = `Error setting up demo mode: ${error.message}`;
      
      document.body.appendChild(div);
    }
  }
  
  // Run the setup
  setupDemoMode();
})();