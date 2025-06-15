/**
 * Fallback API - Provides sample data for when backend is unavailable
 * Only intercepts requests when in fallback mode
 */
(function() {
  console.log('📦 Initializing fallback API provider...');
  
  // Setup sample data
  function setupSampleData() {
    const now = Date.now();
    const minutes = (min) => min * 60 * 1000;
    
    // Sample stations data
    const stations = [
      {
        id: 1,
        name: "Main Station",
        status: "active",
        barista: "John Barista",
        queue_length: 3,
        last_activity: new Date(now - minutes(2)).toISOString(),
        capabilities: ["espresso", "milk-steaming", "tea"],
        location: "Main Hall"
      },
      {
        id: 2,
        name: "Express Station",
        status: "active",
        barista: "Sarah Barista",
        queue_length: 1,
        last_activity: new Date(now - minutes(5)).toISOString(),
        capabilities: ["espresso", "milk-steaming"],
        location: "Side Entrance"
      },
      {
        id: 3,
        name: "VIP Station",
        status: "inactive",
        barista: null,
        queue_length: 0,
        last_activity: new Date(now - minutes(60)).toISOString(),
        capabilities: ["espresso", "milk-steaming", "tea", "specialty"],
        location: "VIP Area"
      }
    ];
    
    // Sample pending orders
    const pendingOrders = [
      {
        id: "po_001",
        orderNumber: "P001",
        customerName: "John Smith",
        phoneNumber: "+61412345678",
        coffeeType: "Large Flat White",
        milkType: "Full Cream",
        sugar: "1 sugar",
        extraHot: false,
        priority: false,
        status: "pending",
        createdAt: new Date(now - minutes(10)).toISOString(),
        waitTime: 10,
        expectedCompletionTime: new Date(now + minutes(5)).toISOString(),
        stationId: 1,
        batchGroup: "flat-white"
      },
      {
        id: "po_002",
        orderNumber: "P002",
        customerName: "Sarah Williams",
        phoneNumber: "+61423456789",
        coffeeType: "Regular Cappuccino",
        milkType: "Almond",
        sugar: "No sugar",
        extraHot: true,
        priority: true,
        status: "pending",
        createdAt: new Date(now - minutes(7)).toISOString(),
        waitTime: 7,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1,
        batchGroup: "cappuccino-almond"
      },
      {
        id: "po_003",
        orderNumber: "P003",
        customerName: "Michael Brown",
        phoneNumber: "+61434567890",
        coffeeType: "Small Latte",
        milkType: "Oat",
        sugar: "2 sugars",
        extraHot: false,
        priority: false,
        status: "pending",
        createdAt: new Date(now - minutes(5)).toISOString(),
        waitTime: 5,
        expectedCompletionTime: new Date(now + minutes(7)).toISOString(),
        stationId: 2,
        batchGroup: "latte-oat"
      }
    ];
    
    // Sample in-progress orders
    const inProgressOrders = [
      {
        id: "ip_001",
        orderNumber: "IP001",
        customerName: "Emma Davis",
        phoneNumber: "+61445678901",
        coffeeType: "Regular Mocha",
        milkType: "Full Cream",
        sugar: "1 sugar",
        extraHot: false,
        priority: false,
        status: "in-progress",
        createdAt: new Date(now - minutes(12)).toISOString(),
        startedAt: new Date(now - minutes(2)).toISOString(),
        waitTime: 12,
        expectedCompletionTime: new Date(now + minutes(3)).toISOString(),
        stationId: 1
      },
      {
        id: "ip_002",
        orderNumber: "IP002",
        customerName: "David Wilson",
        phoneNumber: "+61456789012",
        coffeeType: "Large Long Black",
        milkType: "No milk",
        sugar: "No sugar",
        extraHot: false,
        priority: true,
        status: "in-progress",
        createdAt: new Date(now - minutes(8)).toISOString(),
        startedAt: new Date(now - minutes(1)).toISOString(),
        waitTime: 8,
        expectedCompletionTime: new Date(now + minutes(2)).toISOString(),
        stationId: 2
      }
    ];
    
    // Sample completed orders
    const completedOrders = [
      {
        id: "co_001",
        orderNumber: "C001",
        customerName: "Jessica Taylor",
        phoneNumber: "+61467890123",
        coffeeType: "Regular Flat White",
        milkType: "Skim",
        sugar: "No sugar",
        extraHot: false,
        priority: false,
        status: "completed",
        createdAt: new Date(now - minutes(30)).toISOString(),
        startedAt: new Date(now - minutes(25)).toISOString(),
        completedAt: new Date(now - minutes(20)).toISOString(),
        stationId: 1
      },
      {
        id: "co_002",
        orderNumber: "C002",
        customerName: "Thomas Johnson",
        phoneNumber: "+61478901234",
        coffeeType: "Large Cappuccino",
        milkType: "Full Cream",
        sugar: "2 sugars",
        extraHot: true,
        priority: true,
        status: "completed",
        createdAt: new Date(now - minutes(25)).toISOString(),
        startedAt: new Date(now - minutes(20)).toISOString(),
        completedAt: new Date(now - minutes(15)).toISOString(),
        stationId: 2
      }
    ];
    
    // Sample schedule data
    const scheduleData = {
      success: true,
      schedule: [
        {
          id: 1,
          date: new Date().toISOString().split('T')[0],
          shifts: [
            {
              id: "shift1",
              startTime: "08:00",
              endTime: "12:00",
              barista: "John Barista",
              stationId: 1
            },
            {
              id: "shift2",
              startTime: "12:00",
              endTime: "16:00",
              barista: "Sarah Barista",
              stationId: 2
            }
          ]
        }
      ]
    };
    
    // Store sample data in localStorage
    localStorage.setItem('fallback_stations', JSON.stringify(stations));
    localStorage.setItem('fallback_pending_orders', JSON.stringify(pendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(inProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(completedOrders));
    localStorage.setItem('fallback_schedule', JSON.stringify(scheduleData));
    
    console.log('Sample data initialized');
  }
  
  // Set up sample data
  setupSampleData();
  
  // Fetch API interception for fallback mode
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    // Only intercept if we're in fallback mode
    if (localStorage.getItem('use_fallback_data') === 'true' && 
        typeof url === 'string' && url.includes('/api/')) {
      
      console.log(`🔄 Using fallback data for: ${url}`);
      return getFallbackResponse(url);
    }
    
    // Otherwise proceed with normal fetch
    return originalFetch.apply(this, arguments);
  };
  
  // Get fallback data based on URL
  function getFallbackResponse(url) {
    // Extract endpoint from URL
    let endpoint = url.substring(url.indexOf('/api/') + 5);
    
    // Determine which data to return
    let mockData;
    
    if (endpoint.includes('stations')) {
      mockData = JSON.parse(localStorage.getItem('fallback_stations') || '[]');
    } else if (endpoint.includes('orders/pending')) {
      mockData = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
    } else if (endpoint.includes('orders/in-progress')) {
      mockData = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
    } else if (endpoint.includes('orders/completed')) {
      mockData = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
    } else if (endpoint.includes('orders')) {
      // Combined orders
      const pending = JSON.parse(localStorage.getItem('fallback_pending_orders') || '[]');
      const inProgress = JSON.parse(localStorage.getItem('fallback_in_progress_orders') || '[]');
      const completed = JSON.parse(localStorage.getItem('fallback_completed_orders') || '[]');
      mockData = [...pending, ...inProgress, ...completed];
    } else if (endpoint.includes('schedule')) {
      mockData = JSON.parse(localStorage.getItem('fallback_schedule') || '{"success":true,"schedule":[]}');
    } else if (endpoint.includes('settings') || endpoint.includes('wait-time')) {
      mockData = { success: true, waitTime: 10, message: "Settings data (fallback mode)" };
    } else if (endpoint.includes('test')) {
      mockData = { success: true, message: "API is available (fallback mode)" };
    } else {
      // Generic success response
      mockData = { success: true, message: "Operation successful (fallback mode)" };
    }
    
    // Create a mock successful response
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
      text: () => Promise.resolve(JSON.stringify(mockData))
    });
  }
  
  console.log('✅ Fallback API provider initialized');
})();