/**
 * Fix Inventory Data Flow Script
 * Sets up missing inventory data and tests the flow from Organiser to Barista interface
 */

console.log('=== FIXING INVENTORY DATA FLOW ===\n');

// This script will create the missing localStorage keys with proper data structure
// to restore the inventory hierarchy: Organiser → Stations → Event Inventory → Event Stock → Station Stock → Menu Items

const setupEventInventory = () => {
  console.log('1. Setting up EVENT INVENTORY (Organiser → Event Inventory)');
  console.log('===========================================================');
  
  const eventInventory = {
    milk: [
      { id: 'milk_1', name: 'Whole Milk', description: 'Regular dairy milk', enabled: true, category: 'milk' },
      { id: 'milk_2', name: 'Skim Milk', description: 'Low-fat dairy milk', enabled: true, category: 'milk' },
      { id: 'milk_3', name: 'Oat Milk', description: 'Plant-based oat milk', enabled: true, category: 'milk' },
      { id: 'milk_4', name: 'Almond Milk', description: 'Plant-based almond milk', enabled: true, category: 'milk' },
      { id: 'milk_5', name: 'Soy Milk', description: 'Plant-based soy milk', enabled: true, category: 'milk' },
      { id: 'milk_6', name: 'Coconut Milk', description: 'Plant-based coconut milk', enabled: true, category: 'milk' }
    ],
    coffee: [
      { id: 'coffee_1', name: 'Espresso', description: 'Strong coffee shot', enabled: true, category: 'coffee' },
      { id: 'coffee_2', name: 'Americano', description: 'Espresso with hot water', enabled: true, category: 'coffee' },
      { id: 'coffee_3', name: 'Latte', description: 'Espresso with steamed milk', enabled: true, category: 'coffee' },
      { id: 'coffee_4', name: 'Cappuccino', description: 'Espresso with foam', enabled: true, category: 'coffee' },
      { id: 'coffee_5', name: 'Flat White', description: 'Double shot with microfoam', enabled: true, category: 'coffee' },
      { id: 'coffee_6', name: 'Mocha', description: 'Chocolate coffee drink', enabled: true, category: 'coffee' },
      { id: 'coffee_7', name: 'Filter Coffee', description: 'Drip brewed coffee', enabled: true, category: 'coffee' },
      { id: 'coffee_8', name: 'Cold Brew', description: 'Cold steeped coffee', enabled: true, category: 'coffee' }
    ],
    cups: [
      { id: 'cups_1', name: 'Small (8oz)', description: '240ml cup', volume: 240, shots: 1, enabled: true, category: 'cups' },
      { id: 'cups_2', name: 'Medium (12oz)', description: '350ml cup', volume: 350, shots: 1, enabled: true, category: 'cups' },
      { id: 'cups_3', name: 'Large (16oz)', description: '470ml cup', volume: 470, shots: 2, enabled: true, category: 'cups' },
      { id: 'cups_4', name: 'Extra Large (20oz)', description: '590ml cup', volume: 590, shots: 2, enabled: true, category: 'cups' }
    ],
    syrups: [
      { id: 'syrup_1', name: 'Vanilla Syrup', description: 'Classic vanilla flavor', enabled: true, category: 'syrups' },
      { id: 'syrup_2', name: 'Caramel Syrup', description: 'Sweet caramel flavor', enabled: true, category: 'syrups' },
      { id: 'syrup_3', name: 'Hazelnut Syrup', description: 'Nutty hazelnut flavor', enabled: true, category: 'syrups' },
      { id: 'syrup_4', name: 'Cinnamon Syrup', description: 'Warm spice flavor', enabled: true, category: 'syrups' },
      { id: 'syrup_5', name: 'Chocolate Syrup', description: 'Rich chocolate flavor', enabled: true, category: 'syrups' }
    ],
    sweeteners: [
      { id: 'sweetener_1', name: 'White Sugar', description: 'Regular granulated sugar', enabled: true, category: 'sweeteners' },
      { id: 'sweetener_2', name: 'Brown Sugar', description: 'Raw cane sugar', enabled: true, category: 'sweeteners' },
      { id: 'sweetener_3', name: 'Honey', description: 'Natural honey sweetener', enabled: true, category: 'sweeteners' },
      { id: 'sweetener_4', name: 'Stevia', description: 'Natural leaf sweetener', enabled: true, category: 'sweeteners' },
      { id: 'sweetener_5', name: 'Artificial Sweetener', description: 'Sugar substitute', enabled: true, category: 'sweeteners' }
    ],
    extras: [
      { id: 'extra_1', name: 'Hot Chocolate Powder', description: 'Premium chocolate powder for hot chocolate drinks', enabled: true, category: 'extras' },
      { id: 'extra_2', name: 'Chai Tea Mix', description: 'Spiced tea blend for chai lattes', enabled: true, category: 'extras' },
      { id: 'extra_3', name: 'Matcha Powder', description: 'Premium green tea powder for matcha lattes', enabled: true, category: 'extras' },
      { id: 'extra_4', name: 'Whipped Cream', description: 'Dairy whipped topping', enabled: true, category: 'extras' },
      { id: 'extra_5', name: 'Cinnamon Powder', description: 'Ground cinnamon spice', enabled: true, category: 'extras' }
    ]
  };
  
  console.log('Created event inventory with:');
  Object.entries(eventInventory).forEach(([category, items]) => {
    console.log(`  - ${category}: ${items.length} items`);
  });
  
  return eventInventory;
};

const setupStationConfigs = () => {
  console.log('\n2. Setting up STATION CONFIGS (Event Inventory → Station Assignments)');
  console.log('=====================================================================');
  
  const stationConfigs = {
    '1': {
      // Station 1: Full service station (all items available)
      milk: { 'milk_1': true, 'milk_2': true, 'milk_3': true, 'milk_4': true, 'milk_5': true, 'milk_6': true },
      coffee: { 'coffee_1': true, 'coffee_2': true, 'coffee_3': true, 'coffee_4': true, 'coffee_5': true, 'coffee_6': true, 'coffee_7': true, 'coffee_8': true },
      cups: { 'cups_1': true, 'cups_2': true, 'cups_3': true, 'cups_4': true },
      syrups: { 'syrup_1': true, 'syrup_2': true, 'syrup_3': true, 'syrup_4': true, 'syrup_5': true },
      sweeteners: { 'sweetener_1': true, 'sweetener_2': true, 'sweetener_3': true, 'sweetener_4': true, 'sweetener_5': true },
      extras: { 'extra_1': true, 'extra_2': true, 'extra_3': true, 'extra_4': true, 'extra_5': true }
    },
    '2': {
      // Station 2: Standard station (most items available)
      milk: { 'milk_1': true, 'milk_2': true, 'milk_3': true, 'milk_4': true, 'milk_5': true },
      coffee: { 'coffee_1': true, 'coffee_2': true, 'coffee_3': true, 'coffee_4': true, 'coffee_5': true, 'coffee_6': true },
      cups: { 'cups_1': true, 'cups_2': true, 'cups_3': true },
      syrups: { 'syrup_1': true, 'syrup_2': true, 'syrup_3': true },
      sweeteners: { 'sweetener_1': true, 'sweetener_2': true, 'sweetener_3': true, 'sweetener_4': true },
      extras: { 'extra_1': true, 'extra_2': true, 'extra_4': true }
    },
    '3': {
      // Station 3: Basic station (essential items only)
      milk: { 'milk_1': true, 'milk_2': true, 'milk_3': true },
      coffee: { 'coffee_1': true, 'coffee_2': true, 'coffee_3': true, 'coffee_4': true, 'coffee_5': true },
      cups: { 'cups_1': true, 'cups_2': true, 'cups_3': true },
      syrups: { 'syrup_1': true, 'syrup_2': true },
      sweeteners: { 'sweetener_1': true, 'sweetener_2': true, 'sweetener_3': true },
      extras: { 'extra_1': true, 'extra_4': true }
    }
  };
  
  console.log('Created station configurations:');
  Object.entries(stationConfigs).forEach(([stationId, config]) => {
    console.log(`  - Station ${stationId}:`);
    Object.entries(config).forEach(([category, items]) => {
      const enabledCount = Object.values(items).filter(Boolean).length;
      console.log(`    - ${category}: ${enabledCount} items assigned`);
    });
  });
  
  return stationConfigs;
};

const setupStationQuantities = () => {
  console.log('\n3. Setting up STATION QUANTITIES (Event Stock)');
  console.log('===============================================');
  
  const stationQuantities = {
    '1': {
      // Station 1: High capacity
      milk: { 
        'milk_1': { quantity: 20 }, 'milk_2': { quantity: 15 }, 'milk_3': { quantity: 10 }, 
        'milk_4': { quantity: 8 }, 'milk_5': { quantity: 8 }, 'milk_6': { quantity: 5 }
      },
      coffee: { 
        'coffee_1': { quantity: 5 }, 'coffee_2': { quantity: 5 }, 'coffee_3': { quantity: 5 }, 
        'coffee_4': { quantity: 5 }, 'coffee_5': { quantity: 5 }, 'coffee_6': { quantity: 3 },
        'coffee_7': { quantity: 3 }, 'coffee_8': { quantity: 3 }
      },
      cups: { 
        'cups_1': { quantity: 200 }, 'cups_2': { quantity: 300 }, 'cups_3': { quantity: 150 }, 'cups_4': { quantity: 100 }
      },
      syrups: { 
        'syrup_1': { quantity: 3 }, 'syrup_2': { quantity: 3 }, 'syrup_3': { quantity: 2 }, 
        'syrup_4': { quantity: 2 }, 'syrup_5': { quantity: 2 }
      },
      sweeteners: { 
        'sweetener_1': { quantity: 5 }, 'sweetener_2': { quantity: 3 }, 'sweetener_3': { quantity: 2 }, 
        'sweetener_4': { quantity: 1 }, 'sweetener_5': { quantity: 500 }
      },
      extras: { 
        'extra_1': { quantity: 3 }, 'extra_2': { quantity: 2 }, 'extra_3': { quantity: 1 }, 
        'extra_4': { quantity: 2 }, 'extra_5': { quantity: 1 }
      }
    },
    '2': {
      // Station 2: Medium capacity
      milk: { 
        'milk_1': { quantity: 15 }, 'milk_2': { quantity: 10 }, 'milk_3': { quantity: 8 }, 
        'milk_4': { quantity: 6 }, 'milk_5': { quantity: 6 }
      },
      coffee: { 
        'coffee_1': { quantity: 4 }, 'coffee_2': { quantity: 4 }, 'coffee_3': { quantity: 4 }, 
        'coffee_4': { quantity: 4 }, 'coffee_5': { quantity: 4 }, 'coffee_6': { quantity: 2 }
      },
      cups: { 
        'cups_1': { quantity: 150 }, 'cups_2': { quantity: 200 }, 'cups_3': { quantity: 100 }
      },
      syrups: { 
        'syrup_1': { quantity: 2 }, 'syrup_2': { quantity: 2 }, 'syrup_3': { quantity: 1 }
      },
      sweeteners: { 
        'sweetener_1': { quantity: 4 }, 'sweetener_2': { quantity: 2 }, 'sweetener_3': { quantity: 1 }, 
        'sweetener_4': { quantity: 1 }
      },
      extras: { 
        'extra_1': { quantity: 2 }, 'extra_2': { quantity: 1 }, 'extra_4': { quantity: 1 }
      }
    },
    '3': {
      // Station 3: Basic capacity
      milk: { 
        'milk_1': { quantity: 10 }, 'milk_2': { quantity: 8 }, 'milk_3': { quantity: 5 }
      },
      coffee: { 
        'coffee_1': { quantity: 3 }, 'coffee_2': { quantity: 3 }, 'coffee_3': { quantity: 3 }, 
        'coffee_4': { quantity: 3 }, 'coffee_5': { quantity: 3 }
      },
      cups: { 
        'cups_1': { quantity: 100 }, 'cups_2': { quantity: 150 }, 'cups_3': { quantity: 75 }
      },
      syrups: { 
        'syrup_1': { quantity: 1 }, 'syrup_2': { quantity: 1 }
      },
      sweeteners: { 
        'sweetener_1': { quantity: 3 }, 'sweetener_2': { quantity: 2 }, 'sweetener_3': { quantity: 1 }
      },
      extras: { 
        'extra_1': { quantity: 1 }, 'extra_4': { quantity: 1 }
      }
    }
  };
  
  console.log('Created station quantities:');
  Object.entries(stationQuantities).forEach(([stationId, quantities]) => {
    console.log(`  - Station ${stationId}:`);
    Object.entries(quantities).forEach(([category, items]) => {
      const totalQuantity = Object.values(items).reduce((sum, item) => sum + item.quantity, 0);
      console.log(`    - ${category}: ${Object.keys(items).length} items, total quantity: ${totalQuantity}`);
    });
  });
  
  return stationQuantities;
};

const generateStockData = (eventInventory, stationConfigs, stationQuantities, stationId) => {
  console.log(`\n4. Generating BARISTA STOCK DATA for Station ${stationId}`);
  console.log('========================================================');
  
  const stockData = {};
  const stationConfig = stationConfigs[stationId] || {};
  const stationQty = stationQuantities[stationId] || {};
  
  // Map inventory categories to stock categories
  const categoryMapping = {
    milk: 'milk',
    coffee: 'coffee', 
    cups: 'cups',
    syrups: 'syrups',
    sweeteners: 'sweeteners',
    extras: 'other'
  };
  
  Object.keys(eventInventory).forEach(inventoryCategory => {
    const stockCategory = categoryMapping[inventoryCategory] || inventoryCategory;
    
    if (!stockData[stockCategory]) {
      stockData[stockCategory] = [];
    }
    
    eventInventory[inventoryCategory]?.forEach(item => {
      // Check if this item is enabled for this station
      const isAvailableAtStation = stationConfig[inventoryCategory]?.[item.id] || false;
      
      if (item.enabled && isAvailableAtStation) {
        // Get quantity for this item at this station
        const stationQuantity = stationQty[inventoryCategory]?.[item.id]?.quantity || 0;
        
        // Get default values based on category
        const defaults = getStockDefaults(stockCategory, item.name);
        
        // Use the station quantity if set, otherwise use defaults
        const actualAmount = stationQuantity > 0 ? stationQuantity : defaults.amount;
        const actualCapacity = Math.max(actualAmount, defaults.capacity);
        
        const stockItem = {
          id: item.id,
          name: item.name,
          amount: actualAmount,
          capacity: actualCapacity,
          unit: item.unit || defaults.unit,
          status: actualAmount <= defaults.criticalThreshold ? 'danger' : 
                  actualAmount <= defaults.lowThreshold ? 'warning' : 'good',
          lowThreshold: Math.max(1, actualCapacity * 0.25),
          criticalThreshold: Math.max(1, actualCapacity * 0.1),
          description: item.description,
          category: item.category,
          enabled: true
        };
        
        stockData[stockCategory].push(stockItem);
      }
    });
  });
  
  console.log(`Generated stock data for Station ${stationId}:`);
  Object.entries(stockData).forEach(([category, items]) => {
    const inStock = items.filter(item => item.amount > 0).length;
    console.log(`  - ${category}: ${items.length} items (${inStock} in stock)`);
  });
  
  return stockData;
};

const getStockDefaults = (category, itemName) => {
  const nameUpper = itemName.toUpperCase();
  
  switch (category) {
    case 'milk':
      if (nameUpper.includes('WHOLE') || nameUpper.includes('REGULAR')) {
        return { amount: 20, capacity: 20, unit: 'L', lowThreshold: 5, criticalThreshold: 2 };
      } else {
        return { amount: 5, capacity: 5, unit: 'L', lowThreshold: 2, criticalThreshold: 1 };
      }
      
    case 'coffee':
      if (nameUpper.includes('ESPRESSO') || nameUpper.includes('HOUSE')) {
        return { amount: 5, capacity: 5, unit: 'kg', lowThreshold: 1.5, criticalThreshold: 0.5 };
      } else {
        return { amount: 3, capacity: 3, unit: 'kg', lowThreshold: 1, criticalThreshold: 0.3 };
      }
      
    case 'cups':
      if (nameUpper.includes('SMALL')) {
        return { amount: 200, capacity: 200, unit: 'pcs', lowThreshold: 50, criticalThreshold: 20 };
      } else if (nameUpper.includes('LARGE')) {
        return { amount: 100, capacity: 100, unit: 'pcs', lowThreshold: 30, criticalThreshold: 10 };
      } else {
        return { amount: 150, capacity: 150, unit: 'pcs', lowThreshold: 40, criticalThreshold: 15 };
      }
      
    case 'syrups':
      return { amount: 2, capacity: 2, unit: 'L', lowThreshold: 0.5, criticalThreshold: 0.2 };
      
    case 'sweeteners':
    case 'other':
      if (nameUpper.includes('SUGAR')) {
        return { amount: 5, capacity: 5, unit: 'kg', lowThreshold: 1, criticalThreshold: 0.5 };
      } else if (nameUpper.includes('PACKET') || nameUpper.includes('PCS')) {
        return { amount: 500, capacity: 500, unit: 'pcs', lowThreshold: 100, criticalThreshold: 50 };
      } else {
        return { amount: 1, capacity: 1, unit: 'kg', lowThreshold: 0.3, criticalThreshold: 0.1 };
      }
      
    default:
      return { amount: 1, capacity: 1, unit: 'unit', lowThreshold: 0.3, criticalThreshold: 0.1 };
  }
};

// Main execution
console.log('Starting inventory data flow setup...\n');

// Step 1: Create event inventory
const eventInventory = setupEventInventory();

// Step 2: Create station configurations
const stationConfigs = setupStationConfigs();

// Step 3: Create station quantities
const stationQuantities = setupStationQuantities();

// Step 4: Generate barista stock data for each station
const stations = ['1', '2', '3'];
const stockDataByStation = {};

stations.forEach(stationId => {
  stockDataByStation[stationId] = generateStockData(eventInventory, stationConfigs, stationQuantities, stationId);
});

// Output the setup commands for browser console
console.log('\n\n5. BROWSER CONSOLE SETUP COMMANDS');
console.log('=================================');
console.log('Copy and paste the following commands into your browser console:');
console.log('');

console.log('// 1. Set up event inventory');
console.log(`localStorage.setItem('event_inventory', '${JSON.stringify(eventInventory)}');`);
console.log('');

console.log('// 2. Set up station configurations');
console.log(`localStorage.setItem('station_inventory_configs', '${JSON.stringify(stationConfigs)}');`);
console.log('');

console.log('// 3. Set up station quantities');
console.log(`localStorage.setItem('station_inventory_quantities', '${JSON.stringify(stationQuantities)}');`);
console.log('');

console.log('// 4. Set up barista stock data for each station');
stations.forEach(stationId => {
  console.log(`localStorage.setItem('coffee_stock_station_${stationId}', '${JSON.stringify(stockDataByStation[stationId])}');`);
});

console.log('');
console.log('// 5. Verify setup');
console.log('console.log("Event inventory:", localStorage.getItem("event_inventory") ? "✅ EXISTS" : "❌ MISSING");');
console.log('console.log("Station configs:", localStorage.getItem("station_inventory_configs") ? "✅ EXISTS" : "❌ MISSING");');
console.log('console.log("Station quantities:", localStorage.getItem("station_inventory_quantities") ? "✅ EXISTS" : "❌ MISSING");');
stations.forEach(stationId => {
  console.log(`console.log("Station ${stationId} stock:", localStorage.getItem("coffee_stock_station_${stationId}") ? "✅ EXISTS" : "❌ MISSING");`);
});

console.log('\n\n6. TESTING INSTRUCTIONS');
console.log('=======================');
console.log('After running the setup commands:');
console.log('1. Go to Organiser → Stations → Event Inventory');
console.log('   - You should see milk, coffee, syrups, sweeteners, and extras categories');
console.log('   - All items should be enabled');
console.log('2. Go to Organiser → Stations → Station Inventory');
console.log('   - You should see 3 stations with different item assignments');
console.log('3. Go to Barista Interface');
console.log('   - Select a station');
console.log('   - Go to Stock tab - you should see inventory items');
console.log('   - Try creating a walk-in order - milk and coffee options should be available');
console.log('');
console.log('Expected results:');
console.log('- Station 1: Full range of options (6 milks, 8 coffees, 5 syrups)');
console.log('- Station 2: Standard options (5 milks, 6 coffees, 3 syrups)');
console.log('- Station 3: Basic options (3 milks, 5 coffees, 2 syrups)');

console.log('\n=== SETUP COMPLETE ===');

// For testing - output compact commands that can be copy-pasted easily
console.log('\n\n7. QUICK SETUP (Single command)');
console.log('===============================');

const quickSetup = `
localStorage.setItem('event_inventory', '${JSON.stringify(eventInventory)}');
localStorage.setItem('station_inventory_configs', '${JSON.stringify(stationConfigs)}');
localStorage.setItem('station_inventory_quantities', '${JSON.stringify(stationQuantities)}');
${stations.map(stationId => `localStorage.setItem('coffee_stock_station_${stationId}', '${JSON.stringify(stockDataByStation[stationId])}');`).join('\n')}
console.log('✅ Inventory data flow setup complete!');
location.reload();
`.trim();

console.log('Copy this single command:');
console.log('```');
console.log(quickSetup);
console.log('```');