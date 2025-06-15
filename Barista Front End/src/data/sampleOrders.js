// data/sampleOrders.js
// This file contains sample order data for offline mode and development

const sampleData = {
  pending: [
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
      batchGroup: 'latte-soy',
      phoneNumber: '+61 432 567 890'
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
      batchGroup: 'latte-soy',
      phoneNumber: '+61 423 987 654'
    },
    { 
      id: '45282', 
      customerName: 'Sarah Williams', 
      coffeeType: 'Regular Flat White', 
      milkType: 'Full cream', 
      sugar: '2 sugars',
      priority: false,
      createdAt: new Date(Date.now() - 5 * 60000),
      waitTime: 5,
      promisedTime: 15,
      phoneNumber: '+61 498 765 432'
    },
    { 
      id: '45289', 
      customerName: 'Dr. Mark Wilson', 
      coffeeType: 'Double Espresso', 
      milkType: 'No milk', 
      sugar: 'No sugar',
      priority: true,
      createdAt: new Date(Date.now() - 2 * 60000),
      waitTime: 2,
      promisedTime: 10,
      phoneNumber: '+61 432 109 876'
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
      promisedTime: 15,
      phoneNumber: '+61 412 345 678',
      alternativeMilk: true
    },
  ],
  inProgress: [
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
      promisedTime: 15,
      alternativeMilk: true
    }
  ],
  completed: [
    { 
      id: '45266', 
      customerName: 'Emma Johnson', 
      phoneNumber: '+61 423 456 789',
      coffeeType: 'Large Flat White', 
      milkType: 'Almond milk', 
      completedAt: new Date(Date.now() - 10 * 60000),
      alternativeMilk: true
    },
    { 
      id: '45270', 
      customerName: 'James Cooper', 
      phoneNumber: '+61 432 987 654',
      coffeeType: 'Regular Cappuccino', 
      milkType: 'Full cream milk', 
      completedAt: new Date(Date.now() - 5 * 60000)
    },
    { 
      id: '45272', 
      customerName: 'Olivia Smith', 
      phoneNumber: '+61 433 123 456',
      coffeeType: 'Medium Latte', 
      milkType: 'Skim milk', 
      sugar: 'No sugar',
      completedAt: new Date(Date.now() - 7 * 60000)
    },
    { 
      id: '45273', 
      customerName: 'Robert Davis', 
      phoneNumber: '+61 435 678 901',
      coffeeType: 'Espresso Shot', 
      completedAt: new Date(Date.now() - 6 * 60000)
    }
  ],
  previous: [
    { 
      id: '45254', 
      customerName: 'Sarah Williams', 
      coffeeType: 'Large Latte', 
      milkType: 'Soy milk', 
      sugar: '1 sugar',
      completedAt: new Date(Date.now() - 25 * 60000),
      pickedUpAt: new Date(Date.now() - 10 * 60000),
      alternativeMilk: true
    },
    { 
      id: '45251', 
      customerName: 'Michael Thompson', 
      coffeeType: 'Espresso Double Shot', 
      completedAt: new Date(Date.now() - 32 * 60000),
      pickedUpAt: new Date(Date.now() - 15 * 60000)
    }
  ]
};

export default sampleData;
