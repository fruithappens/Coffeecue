// src/data/sampleData.js - Fallback sample data for the application

const sampleData = {
  pendingOrders: [
    { 
      id: '45282', 
      customerName: 'Sarah Williams', 
      coffeeType: 'Regular Flat White', 
      milkType: 'Full cream', 
      sugar: '2 sugars',
      priority: false,
      createdAt: new Date(Date.now() - 5 * 60000),
      waitTime: 5,
      promisedTime: 15
    },
    { 
      id: '45283', 
      customerName: 'James Cooper', 
      coffeeType: 'Regular Latte', 
      milkType: 'Almond milk', 
      sugar: 'No sugar',
      priority: false,
      createdAt: new Date(Date.now() - 7 * 60000),
      waitTime: 7,
      promisedTime: 15
    },
    { 
      id: '45284', 
      customerName: 'Emma Davis', 
      coffeeType: 'Large Latte', 
      milkType: 'Soy milk', 
      sugar: '1 sugar',
      priority: false,
      createdAt: new Date(Date.now() - 8 * 60000),
      waitTime: 8,
      promisedTime: 15,
      batchGroup: 'latte-soy'
    },
    { 
      id: '45285', 
      customerName: 'Thomas Brown', 
      coffeeType: 'Large Latte', 
      milkType: 'Soy milk', 
      sugar: '0 sugar',
      priority: false,
      createdAt: new Date(Date.now() - 9 * 60000),
      waitTime: 9,
      promisedTime: 15,
      batchGroup: 'latte-soy'
    },
  ],
  inProgressOrders: [
    { 
      id: '45281', 
      customerName: 'Michael Johnson', 
      phoneNumber: '+61 423 555 789',
      coffeeType: 'Large Cappuccino', 
      milkType: 'Oat milk', 
      sugar: '1 sugar',
      extraHot: true,
      priority: true,
      createdAt: new Date(Date.now() - 3 * 60000),
      startedAt: new Date(),
      waitTime: 3,
      promisedTime: 15
    }
  ],
  completedOrders: [
    { 
      id: '45266', 
      customerName: 'Emma Johnson', 
      phoneNumber: '+61 423 456 789',
      coffeeType: 'Large Flat White', 
      milkType: 'Almond milk', 
      completedAt: new Date(Date.now() - 10 * 60000),
      readyForPickup: true,
      orderTime: 8,
      promisedTime: 15
    },
    { 
      id: '45270', 
      customerName: 'James Cooper', 
      phoneNumber: '+61 432 987 654',
      coffeeType: 'Regular Cappuccino', 
      milkType: 'Full cream milk', 
      completedAt: new Date(Date.now() - 5 * 60000),
      readyForPickup: true,
      orderTime: 12,
      promisedTime: 15
    }
  ],
  chatMessages: [
    {
      id: 1,
      sender: 'System',
      content: 'Welcome to the barista interface',
      timestamp: new Date(Date.now() - 120 * 60000),
      read: true
    },
    {
      id: 2,
      sender: 'Station Manager',
      content: 'Remember to check milk levels frequently today',
      timestamp: new Date(Date.now() - 60 * 60000),
      read: true
    },
    {
      id: 3,
      sender: 'Support',
      content: 'New batches of specialty beans have arrived',
      timestamp: new Date(Date.now() - 15 * 60000),
      read: false
    }
  ]
};

export default sampleData;