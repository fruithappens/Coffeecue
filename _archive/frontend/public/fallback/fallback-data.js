/**
 * Enhanced Fallback Data Provider 
 * Provides sample data for all API endpoints when working offline
 */
(function() {
  console.log('📊 Setting up enhanced fallback data...');
  
  // Sample milk options
  const milkOptions = [
    { id: 1, name: 'Full Cream', color: '#FFFFFF', available: true },
    { id: 2, name: 'Skim', color: '#F0F8FF', available: true },
    { id: 3, name: 'Almond', color: '#FAEBD7', available: true },
    { id: 4, name: 'Oat', color: '#F5DEB3', available: true },
    { id: 5, name: 'Soy', color: '#FFF8DC', available: true },
    { id: 6, name: 'Lactose Free', color: '#FFFACD', available: true }
  ];
  
  // Sample data for pending orders
  const samplePendingOrders = [
    {
      id: 'sample_1',
      orderNumber: 'SP001',
      customerName: 'John Smith',
      coffeeType: 'Large Flat White',
      milkType: 'Regular milk',
      milkTypeId: 1,
      sugar: 'No sugar',
      phoneNumber: '+61412345678',
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
      waitTime: 5,
      promisedTime: 15,
      priority: false,
      status: 'pending',
      stationId: 1
    },
    {
      id: 'sample_2',
      orderNumber: 'SP002',
      customerName: 'Jane Doe',
      coffeeType: 'Medium Cappuccino',
      milkType: 'Almond milk',
      milkTypeId: 3,
      sugar: '1 sugar',
      phoneNumber: '+61412345679',
      createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(), // 3 minutes ago
      waitTime: 8,
      promisedTime: 15,
      priority: true,
      status: 'pending',
      stationId: 2
    },
    {
      id: 'sample_3',
      orderNumber: 'SP003',
      customerName: 'Robert Johnson',
      coffeeType: 'Small Latte',
      milkType: 'Soy milk',
      milkTypeId: 5,
      sugar: '2 sugars',
      phoneNumber: '+61412345680',
      createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(), // 2 minutes ago
      waitTime: 10,
      promisedTime: 15,
      priority: false,
      status: 'pending',
      stationId: 1
    }
  ];
  
  // Sample data for in-progress orders
  const sampleInProgressOrders = [
    {
      id: 'sample_4',
      orderNumber: 'SI001',
      customerName: 'Michael Brown',
      coffeeType: 'Large Long Black',
      milkType: 'No milk',
      milkTypeId: null,
      sugar: 'No sugar',
      phoneNumber: '+61412345681',
      createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 minutes ago
      waitTime: 15,
      promisedTime: 15,
      priority: false,
      status: 'in-progress',
      stationId: 3
    },
    {
      id: 'sample_5',
      orderNumber: 'SI002',
      customerName: 'Sarah Wilson',
      coffeeType: 'Medium Flat White',
      milkType: 'Regular milk',
      milkTypeId: 1,
      sugar: '1 sugar',
      phoneNumber: '+61412345682',
      createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(), // 8 minutes ago
      waitTime: 12,
      promisedTime: 15,
      priority: false,
      status: 'in-progress',
      stationId: 2
    }
  ];
  
  // Sample data for completed orders
  const sampleCompletedOrders = [
    {
      id: 'sample_6',
      orderNumber: 'SC001',
      customerName: 'David Lee',
      coffeeType: 'Medium Cappuccino',
      milkType: 'Regular milk',
      milkTypeId: 1,
      sugar: 'No sugar',
      phoneNumber: '+61412345683',
      createdAt: new Date(Date.now() - 1000 * 60 * 20).toISOString(), // 20 minutes ago
      completedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
      waitTime: 15,
      promisedTime: 15,
      priority: false,
      status: 'completed',
      stationId: 1
    },
    {
      id: 'sample_7',
      orderNumber: 'SC002',
      customerName: 'Linda Chen',
      coffeeType: 'Small Latte',
      milkType: 'Soy milk',
      milkTypeId: 5,
      sugar: '1 sugar',
      phoneNumber: '+61412345684',
      createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(), // 25 minutes ago
      completedAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 minutes ago
      waitTime: 15,
      promisedTime: 15,
      priority: true,
      status: 'completed',
      stationId: 3
    },
    {
      id: 'sample_8',
      orderNumber: 'SC003',
      customerName: 'Mark Taylor',
      coffeeType: 'Large Long Black',
      milkType: 'No milk',
      milkTypeId: null,
      sugar: '2 sugars',
      phoneNumber: '+61412345685',
      createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
      completedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 minutes ago
      waitTime: 15,
      promisedTime: 15,
      priority: false,
      status: 'completed',
      stationId: 2
    }
  ];
  
  // Create a combined orders list for fallback endpoints
  const allOrders = [
    ...samplePendingOrders,
    ...sampleInProgressOrders,
    ...sampleCompletedOrders
  ];
  
  // Sample stations data
  const sampleStations = [
    { id: 1, name: 'Station 1', status: 'active', maxOrders: 8, currentLoad: 2 },
    { id: 2, name: 'Station 2', status: 'active', maxOrders: 8, currentLoad: 1 },
    { id: 3, name: 'Station 3', status: 'active', maxOrders: 8, currentLoad: 1 }
  ];
  
  // Sample inventory data
  const sampleInventory = {
    coffee: { level: 75, unit: "kg" },
    milk: {
      "Full Cream": { level: 80, unit: "L" },
      "Skim": { level: 65, unit: "L" },
      "Almond": { level: 70, unit: "L" },
      "Oat": { level: 60, unit: "L" },
      "Soy": { level: 75, unit: "L" },
      "Lactose Free": { level: 68, unit: "L" }
    }
  };
  
  // Sample system settings
  const sampleSettings = {
    waitTime: 15,
    maxOrdersPerStation: 10,
    enableNotifications: true,
    enableSMS: true,
    showPriority: true,
    allowWalkIn: true,
    stationSettings: sampleStations,
    availableMilkOptions: milkOptions
  };
  
  // Store all this data in window for direct API mocking
  window.FALLBACK_DATA = {
    orders: allOrders,
    pendingOrders: samplePendingOrders,
    inProgressOrders: sampleInProgressOrders,
    completedOrders: sampleCompletedOrders,
    stations: sampleStations,
    inventory: sampleInventory,
    settings: sampleSettings,
    milkOptions: milkOptions
  };
  
  // Set up a function to get fallback data by endpoint
  window.getFallbackData = function(endpoint) {
    console.log(`📊 Retrieving fallback data for: ${endpoint}`);
    
    // Map endpoints to data
    if (endpoint.includes('/api/orders')) {
      if (endpoint.includes('status=pending')) {
        return samplePendingOrders;
      } else if (endpoint.includes('status=in-progress')) {
        return sampleInProgressOrders;
      } else if (endpoint.includes('status=completed')) {
        return sampleCompletedOrders;
      } else {
        return allOrders;
      }
    }
    
    if (endpoint.includes('/api/stations')) {
      return sampleStations;
    }
    
    if (endpoint.includes('/api/inventory')) {
      return sampleInventory;
    }
    
    if (endpoint.includes('/api/settings')) {
      return sampleSettings;
    }
    
    if (endpoint.includes('/api/milk-options')) {
      return milkOptions;
    }
    
    // Default fallback response
    return { 
      success: true, 
      message: "Using fallback data",
      timestamp: new Date().toISOString()
    };
  };
  
  // Store the fallback data in localStorage for components that use it directly
  localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
  localStorage.setItem('fallback_in_progress_orders', JSON.stringify(sampleInProgressOrders));
  localStorage.setItem('fallback_completed_orders', JSON.stringify(sampleCompletedOrders));
  localStorage.setItem('fallback_all_orders', JSON.stringify(allOrders));
  localStorage.setItem('fallback_stations', JSON.stringify(sampleStations));
  localStorage.setItem('fallback_inventory', JSON.stringify(sampleInventory));
  localStorage.setItem('fallback_settings', JSON.stringify(sampleSettings));
  localStorage.setItem('fallback_milk_options', JSON.stringify(milkOptions));
  
  // Flag for the system to know enhanced fallback data is available
  localStorage.setItem('fallback_data_available', 'true');
  localStorage.setItem('enhanced_fallback_data', 'true');
  
  console.log('✅ Enhanced fallback data has been set up');
})();