// add-sample-data.js - Creates sample data for fallback mode
(function() {
  console.log('Creating sample data for fallback mode...');
  
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
  try {
    // Save orders
    localStorage.setItem('fallback_pending_orders', JSON.stringify(samplePendingOrders));
    localStorage.setItem('fallback_in_progress_orders', JSON.stringify(sampleInProgressOrders));
    localStorage.setItem('fallback_completed_orders', JSON.stringify(sampleCompletedOrders));
    
    // Save stations
    localStorage.setItem('fallback_stations', JSON.stringify(sampleStations));
    
    // Save schedule
    localStorage.setItem('fallback_schedule', JSON.stringify(sampleSchedule));
    
    // Mark fallback data as available
    localStorage.setItem('fallback_data_available', 'true');
    
    console.log('Sample fallback data created successfully');
    
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
    div.innerHTML = 'Sample fallback data created successfully! <button onclick="window.location.reload()" style="margin-left:15px;background:#fff;color:#4CAF50;border:none;padding:5px 10px;border-radius:3px;cursor:pointer;">Refresh Page</button>';
    
    document.body.appendChild(div);
    
  } catch (error) {
    console.error('Error creating sample data:', error);
    
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
    div.innerHTML = `Error creating sample data: ${error.message}`;
    
    document.body.appendChild(div);
  }
})();