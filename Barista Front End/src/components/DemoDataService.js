// DemoDataService.js
// This service handles simulation of demo data for the Coffee Cue system

// Data stores to hold simulated entities
let simulatedOrders = [];
let simulatedMessages = [];
let simulatedStock = {
  milk: [
    { id: 1, name: 'Full Cream', amount: 4, unit: 'L', capacity: 5, status: 'good' },
    { id: 2, name: 'Skim', amount: 1.5, unit: 'L', capacity: 5, status: 'warning' },
    { id: 3, name: 'Soy', amount: 0.5, unit: 'L', capacity: 5, status: 'danger' },
    { id: 4, name: 'Almond', amount: 2, unit: 'L', capacity: 5, status: 'good' },
    { id: 5, name: 'Oat', amount: 3, unit: 'L', capacity: 5, status: 'good' }
  ],
  coffee: [
    { id: 1, name: 'House Blend', amount: 1.2, unit: 'kg', capacity: 2, status: 'warning' },
    { id: 2, name: 'Single Origin', amount: 0.8, unit: 'kg', capacity: 2, status: 'warning' }
  ],
  cups: [
    { id: 1, name: 'Small', amount: 45, unit: '', capacity: 50, status: 'good' },
    { id: 2, name: 'Regular', amount: 37, unit: '', capacity: 100, status: 'good' },
    { id: 3, name: 'Large', amount: 12, unit: '', capacity: 50, status: 'warning' }
  ]
};
let simulatedSchedule = {
  today: [
    { id: 1, start: '08:00', end: '10:30', barista: 'Alex Johnson', status: 'active', isDemoData: true },
    { id: 2, start: '10:30', end: '13:00', barista: 'Sarah Williams', status: 'upcoming', isDemoData: true },
    { id: 3, start: '13:00', end: '15:30', barista: 'Michael Chen', status: 'upcoming', isDemoData: true },
    { id: 4, start: '15:30', end: '18:00', barista: 'Alex Johnson', status: 'upcoming', isDemoData: true }
  ],
  breaks: [
    { id: 1, start: '10:00', end: '10:15', barista: 'Alex Johnson', status: 'completed', isDemoData: true },
    { id: 2, start: '12:30', end: '12:45', barista: 'Sarah Williams', status: 'upcoming', isDemoData: true },
    { id: 3, start: '15:00', end: '15:15', barista: 'Michael Chen', status: 'upcoming', isDemoData: true },
    { id: 4, start: '17:00', end: '17:15', barista: 'Alex Johnson', status: 'upcoming', isDemoData: true }
  ],
  rushPeriods: [
    { id: 1, start: '10:30', end: '11:00', reason: 'Morning Tea Break', isDemoData: true },
    { id: 2, start: '12:30', end: '13:30', reason: 'Lunch Break', isDemoData: true },
    { id: 3, start: '15:30', end: '16:00', reason: 'Afternoon Tea Break', isDemoData: true }
  ]
};

// Sample data for generating realistic orders
const FIRST_NAMES = ['Emma', 'James', 'Olivia', 'William', 'Ava', 'John', 'Sophia', 'Michael', 'Isabella', 'Robert', 
                    'Mia', 'David', 'Charlotte', 'Daniel', 'Amelia', 'Joseph', 'Harper', 'Jackson', 'Evelyn', 'Samuel',
                    'Wei', 'Li', 'Min', 'Sanjay', 'Priya', 'Mohammed', 'Fatima', 'Carlos', 'Maria', 'Juan', 
                    'Sofia', 'Hiroshi', 'Yui', 'Ahmed', 'Zara', 'Kwame', 'Nia', 'Jamal', 'Aisha', 'Aarav'];

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 
                   'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
                   'Lee', 'Wang', 'Zhang', 'Chen', 'Patel', 'Singh', 'Khan', 'Ali', 'Kim', 'Nguyen', 
                   'Tran', 'Park', 'Suzuki', 'Tanaka', 'Ibrahim', 'Hassan', 'Okafor', 'Mensah', 'Nkosi', 'Devi'];

const COFFEE_TYPES = ['Flat White', 'Latte', 'Cappuccino', 'Long Black', 'Espresso', 'Macchiato', 'Mocha', 'Americano', 'Piccolo', 'Filter Coffee', 'Cold Brew'];
const SIZES = ['Small', 'Regular', 'Large'];
const MILK_TYPES = ['Full cream', 'Skim milk', 'Soy milk', 'Almond milk', 'Oat milk', 'No milk'];
const SUGAR_OPTIONS = ['No sugar', '1 sugar', '2 sugars', '3 sugars', 'Half sugar'];

// Event handling
let subscribers = {};
let activeIntervals = {};
let simulationActive = false;
let simulationSettings = {
  orderFrequency: 'medium',
  simulationSpeed: 'normal',
  includeVipOrders: true,
  includeBatchOrders: true,
  simulateStockShortages: true,
  simulateRushPeriods: true,
  simulateEquipmentIssues: false,
  simulateStaffMessages: true
};

// Event types
export const DemoEvents = {
  NEW_ORDER: 'new_order',
  ORDER_UPDATED: 'order_updated',
  STOCK_UPDATED: 'stock_updated',
  MESSAGE_RECEIVED: 'message_received',
  SYSTEM_ALERT: 'system_alert',
  SIMULATION_STATUS: 'simulation_status'
};

// Subscribe to events
export const subscribe = (eventType, callback) => {
  if (!subscribers[eventType]) {
    subscribers[eventType] = [];
  }
  subscribers[eventType].push(callback);
  
  // Return unsubscribe function
  return () => {
    subscribers[eventType] = subscribers[eventType].filter(cb => cb !== callback);
  };
};

// Publish events
const publish = (eventType, data) => {
  if (subscribers[eventType]) {
    subscribers[eventType].forEach(callback => callback(data));
  }
};

// Generate a random integer within a range
const getRandomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Get a random element from an array
const getRandomElement = (array) => {
  return array[Math.floor(Math.random() * array.length)];
};

// Generate a random phone number
const generatePhoneNumber = () => {
  return `+61 4${getRandomInt(0, 9)}${getRandomInt(0, 9)} ${getRandomInt(100, 999)} ${getRandomInt(100, 999)}`;
};

// Generate a unique order ID
const generateOrderId = () => {
  return `45${getRandomInt(100, 999)}`;
};

// Generate a new simulated order
const generateOrder = () => {
  const firstName = getRandomElement(FIRST_NAMES);
  const lastName = getRandomElement(LAST_NAMES);
  const size = getRandomElement(SIZES);
  const coffeeType = getRandomElement(COFFEE_TYPES);
  const milkType = getRandomElement(MILK_TYPES);
  const sugar = getRandomElement(SUGAR_OPTIONS);
  const isVip = simulationSettings.includeVipOrders && Math.random() < 0.15; // 15% chance for VIP
  
  // Determine if this should be a batch order (similar to previous orders)
  let batchGroup = null;
  if (simulationSettings.includeBatchOrders && Math.random() < 0.3) { // 30% chance for batch
    // Check for similar recent orders that could form a batch
    const similarOrders = simulatedOrders.filter(o => 
      o.status === 'pending' && 
      o.coffeeType === coffeeType && 
      o.milkType === milkType
    );
    
    if (similarOrders.length > 0 && similarOrders[0].batchGroup) {
      // Join an existing batch
      batchGroup = similarOrders[0].batchGroup;
    } else if (similarOrders.length > 0) {
      // Create a new batch from similar orders
      batchGroup = `${coffeeType.toLowerCase().replace(/\s+/g, '-')}-${milkType.toLowerCase().split(' ')[0]}`;
      // Update similar orders to be part of this batch
      similarOrders.forEach(o => {
        o.batchGroup = batchGroup;
      });
    }
  }
  
  const order = {
    id: generateOrderId(),
    customerName: `${firstName} ${lastName}`,
    phoneNumber: generatePhoneNumber(),
    coffeeType: `${size} ${coffeeType}`,
    milkType: milkType,
    sugar: sugar,
    priority: isVip,
    createdAt: new Date(),
    waitTime: 0,
    promisedTime: 15,
    status: 'pending',
    batchGroup: batchGroup,
    alternativeMilk: ['Soy milk', 'Almond milk', 'Oat milk'].includes(milkType)
  };
  
  return order;
};

// Generate simulated messages
const generateStaffMessage = () => {
  const messageTypes = [
    { 
      type: 'routine', 
      templates: [
        "Running low on {{milk}} milk, can someone bring some over?",
        "Does anyone have extra {{size}} cups?",
        "Break time for {{station}} in 15 minutes",
        "Can someone cover Station {{station}} for 10 minutes?",
        "Has the new coffee delivery arrived yet?",
        "How's everyone keeping up with the orders?",
        "Just finished a big batch of orders!"
      ]
    },
    { 
      type: 'urgent', 
      templates: [
        "URGENT: Coffee machine at Station {{station}} is malfunctioning!",
        "URGENT: We're completely out of {{milk}} milk!",
        "URGENT: Spill at Station {{station}}, need cleanup!",
        "URGENT: Customer complaint at Station {{station}}, need manager!",
        "URGENT: Power issue affecting Station {{station}}!"
      ]
    }
  ];
  
  // Decide if message should be urgent
  const isUrgent = Math.random() < 0.2; // 20% chance for urgent message
  const messageType = isUrgent ? 'urgent' : 'routine';
  const templates = messageTypes.find(t => t.type === messageType).templates;
  let messageTemplate = getRandomElement(templates);
  
  // Replace placeholders with values
  messageTemplate = messageTemplate
    .replace('{{milk}}', getRandomElement(['Soy', 'Almond', 'Oat', 'Full cream', 'Skim']))
    .replace('{{size}}', getRandomElement(['Small', 'Regular', 'Large']))
    .replace('{{station}}', getRandomElement(['#1', '#2', '#3', '#4']));
  
  // Generate sender
  const sender = getRandomElement([
    'Julia (Station #1)',
    'Marcus (Station #2)',
    'System',
    'Manager'
  ]);
  
  return {
    id: Date.now(),
    sender: sender,
    content: messageTemplate,
    timestamp: new Date(),
    isUrgent: isUrgent,
    isSystem: sender === 'System'
  };
};

// Update simulated stock
const updateSimulatedStock = () => {
  if (!simulationSettings.simulateStockShortages) {
    return;
  }
  
  // Randomly select a stock type to update
  const stockTypes = ['milk', 'coffee', 'cups'];
  const stockType = getRandomElement(stockTypes);
  
  // Randomly select an item within that type
  const items = simulatedStock[stockType];
  const itemIndex = getRandomInt(0, items.length - 1);
  const item = items[itemIndex];
  
  // Decrease the amount by a random percentage
  const decreaseAmount = item.amount * (getRandomInt(5, 15) / 100); // 5-15% decrease
  let newAmount = Math.max(0, item.amount - decreaseAmount);
  
  // Update the status based on the new amount
  let newStatus = 'good';
  const percentRemaining = (newAmount / item.capacity) * 100;
  
  if (percentRemaining <= 10) {
    newStatus = 'danger';
  } else if (percentRemaining <= 30) {
    newStatus = 'warning';
  }
  
  // Update the item
  simulatedStock[stockType][itemIndex] = {
    ...item,
    amount: newAmount,
    status: newStatus
  };
  
  // Publish the stock update event
  publish(DemoEvents.STOCK_UPDATED, {
    stockType,
    item: simulatedStock[stockType][itemIndex],
    timestamp: new Date()
  });
  
  // If stock is critical, also send an alert
  if (newStatus === 'danger') {
    publish(DemoEvents.MESSAGE_RECEIVED, {
      sender: 'System',
      content: `ALERT: ${item.name} ${stockType} is critically low!`,
      timestamp: new Date(),
      isUrgent: true,
      isSystem: true
    });
  }
};

// Simulate equipment issue
const simulateEquipmentIssue = () => {
  if (!simulationSettings.simulateEquipmentIssues) {
    return;
  }
  
  // Only a small chance of equipment issue (5%)
  if (Math.random() > 0.05) {
    return;
  }
  
  const issues = [
    'Coffee machine overheating',
    'Grinder malfunction',
    'Water pressure issue',
    'Milk frother not working properly',
    'Touchscreen unresponsive'
  ];
  
  const stations = ['#1', '#2', '#3', '#4'];
  const issue = getRandomElement(issues);
  const station = getRandomElement(stations);
  
  const message = {
    sender: 'System',
    content: `EQUIPMENT ALERT: ${issue} at Station ${station}!`,
    timestamp: new Date(),
    isUrgent: true,
    isSystem: true
  };
  
  // Add to messages
  simulatedMessages.push(message);
  
  // Publish the message
  publish(DemoEvents.MESSAGE_RECEIVED, message);
  
  // Also send system alert
  publish(DemoEvents.SYSTEM_ALERT, {
    type: 'equipment',
    issue,
    station,
    timestamp: new Date()
  });
};

// Update order wait times and status
const updateOrderWaitTimes = () => {
  // Update wait times for all pending orders
  simulatedOrders.forEach(order => {
    if (order.status === 'pending') {
      // Increment wait time
      order.waitTime = Math.round((new Date() - new Date(order.createdAt)) / 60000);
      
      // Publish update for orders with wait time milestones
      if (order.waitTime % 5 === 0 && order.waitTime > 0) {
        publish(DemoEvents.ORDER_UPDATED, { order, reason: 'wait-time' });
      }
    }
  });
  
  // For in-progress orders, randomly complete some
  const inProgressOrders = simulatedOrders.filter(o => o.status === 'in-progress');
  
  inProgressOrders.forEach(order => {
    const timeInProgress = Math.round((new Date() - new Date(order.startedAt)) / 60000);
    
    // 50% chance to complete an order that's been in progress for 2+ minutes
    if (timeInProgress >= 2 && Math.random() < 0.5) {
      order.status = 'completed';
      order.completedAt = new Date();
      
      // Publish order completed event
      publish(DemoEvents.ORDER_UPDATED, { order, reason: 'completed' });
    }
  });
  
  // For completed orders, randomly mark some as picked up
  const completedOrders = simulatedOrders.filter(o => 
    o.status === 'completed' && 
    !o.pickedUp && 
    new Date() - new Date(o.completedAt) > 60000 // completed over 1 minute ago
  );
  
  completedOrders.forEach(order => {
    // 30% chance to mark as picked up
    if (Math.random() < 0.3) {
      order.pickedUp = true;
      order.pickedUpAt = new Date();
      
      // Publish order picked up event
      publish(DemoEvents.ORDER_UPDATED, { order, reason: 'picked-up' });
    }
  });
};

// Check if we're in a rush period
const isInRushPeriod = () => {
  if (!simulationSettings.simulateRushPeriods) {
    return false;
  }
  
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
  
  for (const rushPeriod of simulatedSchedule.rushPeriods) {
    const [startHour, startMinute] = rushPeriod.start.split(':').map(Number);
    const [endHour, endMinute] = rushPeriod.end.split(':').map(Number);
    
    const rushStart = startHour * 60 + startMinute;
    const rushEnd = endHour * 60 + endMinute;
    
    if (currentTime >= rushStart && currentTime <= rushEnd) {
      return true;
    }
  }
  
  return false;
};

// Start simulation intervals
const startSimulation = (settings) => {
  if (simulationActive) {
    stopSimulation();
  }
  
  // Update settings
  simulationSettings = { ...simulationSettings, ...settings };
  simulationActive = true;
  
  // Calculate intervals based on speed
  const speedMultiplier = 
    simulationSettings.simulationSpeed === 'fast' ? 0.5 : 
    simulationSettings.simulationSpeed === 'slow' ? 2 : 1;
  
  // Calculate base intervals
  let orderInterval;
  switch (simulationSettings.orderFrequency) {
    case 'low':
      orderInterval = 120000 * speedMultiplier; // 2 minutes
      break;
    case 'high':
      orderInterval = 30000 * speedMultiplier; // 30 seconds
      break;
    case 'medium':
    default:
      orderInterval = 60000 * speedMultiplier; // 1 minute
  }
  
  // Adjust interval if in rush period
  if (isInRushPeriod()) {
    orderInterval = orderInterval / 3; // 3x more orders during rush
  }
  
  // Set up intervals
  activeIntervals.orderGenerator = setInterval(() => {
    if (!simulationActive) return;
    
    // Create a new order
    const newOrder = generateOrder();
    simulatedOrders.push(newOrder);
    
    // Publish new order event
    publish(DemoEvents.NEW_ORDER, newOrder);
  }, orderInterval);
  
  // Update wait times every 30 seconds
  activeIntervals.waitTimeUpdater = setInterval(updateOrderWaitTimes, 30000 * speedMultiplier);
  
  // Update stock levels periodically
  activeIntervals.stockUpdater = setInterval(updateSimulatedStock, 180000 * speedMultiplier); // 3 minutes
  
  // Generate staff messages periodically
  if (simulationSettings.simulateStaffMessages) {
    activeIntervals.messageGenerator = setInterval(() => {
      if (!simulationActive) return;
      
      const newMessage = generateStaffMessage();
      simulatedMessages.push(newMessage);
      
      // Publish new message event
      publish(DemoEvents.MESSAGE_RECEIVED, newMessage);
    }, 300000 * speedMultiplier); // 5 minutes
  }
  
  // Simulate equipment issues
  if (simulationSettings.simulateEquipmentIssues) {
    activeIntervals.equipmentIssueGenerator = setInterval(simulateEquipmentIssue, 600000 * speedMultiplier); // 10 minutes
  }
  
  // Publish simulation status event
  publish(DemoEvents.SIMULATION_STATUS, { active: true, settings: simulationSettings });
  
  // Create some initial orders immediately
  for (let i = 0; i < 3; i++) {
    const newOrder = generateOrder();
    simulatedOrders.push(newOrder);
    publish(DemoEvents.NEW_ORDER, newOrder);
  }
  
  return true;
};

// Stop all simulation intervals
const stopSimulation = () => {
  simulationActive = false;
  
  // Clear all intervals
  Object.values(activeIntervals).forEach(interval => {
    clearInterval(interval);
  });
  
  // Reset intervals object
  activeIntervals = {};
  
  // Publish simulation status event
  publish(DemoEvents.SIMULATION_STATUS, { active: false });
  
  return true;
};

// Process an order (move from pending to in-progress)
const startOrder = (orderId) => {
  const orderIndex = simulatedOrders.findIndex(o => o.id === orderId);
  
  if (orderIndex === -1 || simulatedOrders[orderIndex].status !== 'pending') {
    return false;
  }
  
  // Update order status
  simulatedOrders[orderIndex] = {
    ...simulatedOrders[orderIndex],
    status: 'in-progress',
    startedAt: new Date()
  };
  
  // Publish order update event
  publish(DemoEvents.ORDER_UPDATED, { 
    order: simulatedOrders[orderIndex], 
    reason: 'started' 
  });
  
  return simulatedOrders[orderIndex];
};

// Complete an order (move from in-progress to completed)
const completeOrder = (orderId) => {
  const orderIndex = simulatedOrders.findIndex(o => o.id === orderId);
  
  if (orderIndex === -1 || simulatedOrders[orderIndex].status !== 'in-progress') {
    return false;
  }
  
  // Update order status
  simulatedOrders[orderIndex] = {
    ...simulatedOrders[orderIndex],
    status: 'completed',
    completedAt: new Date()
  };
  
  // Publish order update event
  publish(DemoEvents.ORDER_UPDATED, { 
    order: simulatedOrders[orderIndex], 
    reason: 'completed' 
  });
  
  // Update stock levels
  updateStockForOrder(simulatedOrders[orderIndex]);
  
  return simulatedOrders[orderIndex];
};

// Mark an order as picked up
const markOrderPickedUp = (orderId) => {
  const orderIndex = simulatedOrders.findIndex(o => o.id === orderId);
  
  if (orderIndex === -1 || simulatedOrders[orderIndex].status !== 'completed' || simulatedOrders[orderIndex].pickedUp) {
    return false;
  }
  
  // Update order status
  simulatedOrders[orderIndex] = {
    ...simulatedOrders[orderIndex],
    pickedUp: true,
    pickedUpAt: new Date()
  };
  
  // Publish order update event
  publish(DemoEvents.ORDER_UPDATED, { 
    order: simulatedOrders[orderIndex], 
    reason: 'picked-up' 
  });
  
  return simulatedOrders[orderIndex];
};

// Update stock levels for a completed order
const updateStockForOrder = (order) => {
  // Decrease milk amount based on coffee type and milk type
  if (order.milkType !== 'No milk') {
    const milkType = order.milkType.split(' ')[0]; // Extract first word (e.g., "Full" from "Full cream")
    const milkIndex = simulatedStock.milk.findIndex(m => 
      m.name.toLowerCase().includes(milkType.toLowerCase())
    );
    
    if (milkIndex !== -1) {
      // Determine milk amount based on coffee size
      let milkAmount = 0.15; // Default for Regular
      if (order.coffeeType.startsWith('Small')) {
        milkAmount = 0.1;
      } else if (order.coffeeType.startsWith('Large')) {
        milkAmount = 0.25;
      }
      
      // Update milk amount
      const milk = simulatedStock.milk[milkIndex];
      const newAmount = Math.max(0, milk.amount - milkAmount);
      
      // Update status
      let newStatus = 'good';
      const percentRemaining = (newAmount / milk.capacity) * 100;
      
      if (percentRemaining <= 10) {
        newStatus = 'danger';
      } else if (percentRemaining <= 30) {
        newStatus = 'warning';
      }
      
      simulatedStock.milk[milkIndex] = {
        ...milk,
        amount: newAmount,
        status: newStatus
      };
      
      // Publish stock update if status changed
      if (newStatus !== milk.status) {
        publish(DemoEvents.STOCK_UPDATED, {
          stockType: 'milk',
          item: simulatedStock.milk[milkIndex],
          timestamp: new Date()
        });
      }
    }
  }
  
  // Decrease coffee amount
  const coffeeIndex = 0; // Default to house blend
  const coffee = simulatedStock.coffee[coffeeIndex];
  const coffeeAmount = 0.018; // 18g per shot
  const newCoffeeAmount = Math.max(0, coffee.amount - coffeeAmount);
  
  // Update status
  let newCoffeeStatus = 'good';
  const percentCoffeeRemaining = (newCoffeeAmount / coffee.capacity) * 100;
  
  if (percentCoffeeRemaining <= 10) {
    newCoffeeStatus = 'danger';
  } else if (percentCoffeeRemaining <= 30) {
    newCoffeeStatus = 'warning';
  }
  
  simulatedStock.coffee[coffeeIndex] = {
    ...coffee,
    amount: newCoffeeAmount,
    status: newCoffeeStatus
  };
  
  // Publish stock update if status changed
  if (newCoffeeStatus !== coffee.status) {
    publish(DemoEvents.STOCK_UPDATED, {
      stockType: 'coffee',
      item: simulatedStock.coffee[coffeeIndex],
      timestamp: new Date()
    });
  }
  
  // Decrease cup count
  let cupSize = 'Regular';
  if (order.coffeeType.startsWith('Small')) {
    cupSize = 'Small';
  } else if (order.coffeeType.startsWith('Large')) {
    cupSize = 'Large';
  }
  
  const cupIndex = simulatedStock.cups.findIndex(c => c.name === cupSize);
  if (cupIndex !== -1) {
    const cup = simulatedStock.cups[cupIndex];
    const newCupAmount = Math.max(0, cup.amount - 1);
    
    // Update status
    let newCupStatus = 'good';
    const percentCupRemaining = (newCupAmount / cup.capacity) * 100;
    
    if (percentCupRemaining <= 10) {
      newCupStatus = 'danger';
    } else if (percentCupRemaining <= 30) {
      newCupStatus = 'warning';
    }
    
    simulatedStock.cups[cupIndex] = {
      ...cup,
      amount: newCupAmount,
      status: newCupStatus
    };
    
    // Publish stock update if status changed
    if (newCupStatus !== cup.status) {
      publish(DemoEvents.STOCK_UPDATED, {
        stockType: 'cups',
        item: simulatedStock.cups[cupIndex],
        timestamp: new Date()
      });
    }
  }
};

// Process a batch of orders
const processBatchOrders = (batchGroup) => {
  const batchOrders = simulatedOrders.filter(o => 
    o.status === 'pending' && o.batchGroup === batchGroup
  );
  
  if (batchOrders.length === 0) {
    return false;
  }
  
  // Update all orders in the batch
  batchOrders.forEach(order => {
    startOrder(order.id);
  });
  
  return batchOrders;
};

// Add a new custom message
const addMessage = (message) => {
  const newMessage = {
    id: Date.now(),
    timestamp: new Date(),
    isSystem: false,
    ...message
  };
  
  simulatedMessages.push(newMessage);
  
  // Publish new message event
  publish(DemoEvents.MESSAGE_RECEIVED, newMessage);
  
  return newMessage;
};

// Reset all simulation data
const resetSimulation = () => {
  // Stop any active simulation
  stopSimulation();
  
  // Clear all data
  simulatedOrders = [];
  simulatedMessages = [];
  
  // Reset stock to initial values
  simulatedStock = {
    milk: [
      { id: 1, name: 'Full Cream', amount: 4, unit: 'L', capacity: 5, status: 'good' },
      { id: 2, name: 'Skim', amount: 1.5, unit: 'L', capacity: 5, status: 'warning' },
      { id: 3, name: 'Soy', amount: 0.5, unit: 'L', capacity: 5, status: 'danger' },
      { id: 4, name: 'Almond', amount: 2, unit: 'L', capacity: 5, status: 'good' },
      { id: 5, name: 'Oat', amount: 3, unit: 'L', capacity: 5, status: 'good' }
    ],
    coffee: [
      { id: 1, name: 'House Blend', amount: 1.2, unit: 'kg', capacity: 2, status: 'warning' },
      { id: 2, name: 'Single Origin', amount: 0.8, unit: 'kg', capacity: 2, status: 'warning' }
    ],
    cups: [
      { id: 1, name: 'Small', amount: 45, unit: '', capacity: 50, status: 'good' },
      { id: 2, name: 'Regular', amount: 37, unit: '', capacity: 100, status: 'good' },
      { id: 3, name: 'Large', amount: 12, unit: '', capacity: 50, status: 'warning' }
    ]
  };
  
  // Publish reset event
  publish(DemoEvents.SIMULATION_STATUS, { reset: true });
  
  return true;
};

// Get pending orders
const getPendingOrders = () => {
  return simulatedOrders
    .filter(o => o.status === 'pending')
    .sort((a, b) => {
      // Sort by priority first, then by wait time (oldest first)
      if (a.priority && !b.priority) return -1;
      if (!a.priority && b.priority) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
};

// Get in-progress orders
const getInProgressOrders = () => {
  return simulatedOrders
    .filter(o => o.status === 'in-progress')
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
};

// Get completed orders
const getCompletedOrders = () => {
  return simulatedOrders
    .filter(o => o.status === 'completed')
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
};

// Get messages
const getMessages = () => {
  return simulatedMessages
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
};

// Get stock levels
const getStockLevels = () => {
  return simulatedStock;
};

// Get schedule
const getSchedule = () => {
  return simulatedSchedule;
};

// Update simulation settings
const updateSettings = (settings) => {
  simulationSettings = { ...simulationSettings, ...settings };
  
  // If simulation is active, restart with new settings
  if (simulationActive) {
    stopSimulation();
    startSimulation(simulationSettings);
  }
  
  return simulationSettings;
};

// Check if simulation is active
const isSimulationActive = () => {
  return simulationActive;
};

// Get current simulation settings
const getSettings = () => {
  return { ...simulationSettings };
};

// Add a walk-in order
const addWalkInOrder = (orderDetails) => {
  const newOrder = {
    id: generateOrderId(),
    customerName: orderDetails.customerName || 'Walk-in Customer',
    phoneNumber: orderDetails.phoneNumber || '-',
    coffeeType: orderDetails.coffeeType || 'Regular Coffee',
    milkType: orderDetails.milkType || 'Full cream',
    sugar: orderDetails.sugar || 'No sugar',
    priority: orderDetails.priority || false,
    createdAt: new Date(),
    waitTime: 0,
    promisedTime: 15,
    status: 'pending',
    batchGroup: null,
    isWalkIn: true,
    alternativeMilk: ['Soy milk', 'Almond milk', 'Oat milk'].includes(orderDetails.milkType)
  };
  
  simulatedOrders.push(newOrder);
  
  // Publish new order event
  publish(DemoEvents.NEW_ORDER, newOrder);
  
  return newOrder;
};

// Adjust wait time for all pending orders
const adjustWaitTime = (newWaitTime) => {
  simulatedOrders.forEach(order => {
    if (order.status === 'pending') {
      order.promisedTime = newWaitTime;
    }
  });
  
  // Publish status update
  publish(DemoEvents.SYSTEM_ALERT, {
    type: 'wait-time',
    waitTime: newWaitTime,
    timestamp: new Date()
  });
  
  return true;
};

// Remove an order
const removeOrder = (orderId) => {
  const orderIndex = simulatedOrders.findIndex(o => o.id === orderId);
  
  if (orderIndex === -1) {
    return false;
  }
  
  const removedOrder = simulatedOrders[orderIndex];
  simulatedOrders.splice(orderIndex, 1);
  
  // Publish order removed event
  publish(DemoEvents.ORDER_UPDATED, { 
    order: removedOrder, 
    reason: 'removed' 
  });
  
  return removedOrder;
};

// Export all functions
export default {
  // Event handling
  subscribe,
  DemoEvents,
  
  // Simulation control
  startSimulation,
  stopSimulation,
  resetSimulation,
  isSimulationActive,
  updateSettings,
  getSettings,
  
  // Data access
  getPendingOrders,
  getInProgressOrders,
  getCompletedOrders,
  getMessages,
  getStockLevels,
  getSchedule,
  
  // Order actions
  startOrder,
  completeOrder,
  markOrderPickedUp,
  processBatchOrders,
  addWalkInOrder,
  removeOrder,
  
  // Message actions
  addMessage,
  
  // System actions
  adjustWaitTime
};