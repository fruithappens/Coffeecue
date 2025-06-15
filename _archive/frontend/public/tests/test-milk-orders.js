/**
 * Test Orders with correct milk types
 * This script provides sample orders with proper milkType strings
 */
(function() {
  console.log('📋 Setting up test orders with correct milk types...');
  
  // Create sample orders with proper string milk types
  const testOrders = [
    {
      id: 'test-1001',
      orderNumber: 'ORD1001',
      customerName: 'John Smith',
      coffeeType: 'Large Cappuccino',
      milkType: 'Regular',
      sugar: 'No sugar',
      phoneNumber: '+61412345678',
      createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 minutes ago
      waitTime: 5,
      promisedTime: 15,
      priority: false,
      status: 'pending',
      stationId: 1
    },
    {
      id: 'test-1002',
      orderNumber: 'ORD1002',
      customerName: 'Jane Doe',
      coffeeType: 'Medium Flat White',
      milkType: 'Almond',
      sugar: '1 sugar',
      phoneNumber: '+61412345679',
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 minutes ago
      waitTime: 8,
      promisedTime: 15,
      priority: true,
      status: 'pending',
      stationId: 2
    },
    {
      id: 'test-1003',
      orderNumber: 'ORD1003',
      customerName: 'Robert Johnson',
      coffeeType: 'Small Latte',
      milkType: 'Soy',
      sugar: '2 sugars',
      phoneNumber: '+61412345680',
      createdAt: new Date().toISOString(),
      waitTime: 10,
      promisedTime: 15,
      priority: false,
      status: 'pending',
      stationId: 1
    }
  ];
  
  // Create in-progress orders
  const testInProgressOrders = [
    {
      id: 'test-2001',
      orderNumber: 'ORD2001',
      customerName: 'Michael Brown',
      coffeeType: 'Medium Long Black',
      milkType: 'None',
      sugar: 'No sugar',
      phoneNumber: '+61412345681',
      createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 minutes ago
      waitTime: 15,
      promisedTime: 15,
      priority: false,
      status: 'in-progress',
      stationId: 3
    }
  ];
  
  // Store in localStorage with the correct format
  localStorage.setItem('fallback_pending_orders', JSON.stringify(testOrders));
  localStorage.setItem('fallback_in_progress_orders', JSON.stringify(testInProgressOrders));
  localStorage.setItem('fallback_completed_orders', JSON.stringify([]));
  
  console.log('✅ Test orders with correct milk types saved to localStorage');
})();