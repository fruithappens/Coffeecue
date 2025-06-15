/**
 * Inventory Data Flow Diagnosis Script
 * Analyzes the current state of inventory data flow from Organiser to Barista interface
 */

console.log('=== INVENTORY DATA FLOW DIAGNOSIS ===\n');

// Check for Node.js vs Browser environment
const isNode = typeof window === 'undefined';
let localStorage;

if (isNode) {
  // Mock localStorage for Node.js environment
  localStorage = {
    data: {},
    getItem(key) { return this.data[key] || null; },
    setItem(key, value) { this.data[key] = value; },
    removeItem(key) { delete this.data[key]; },
    get length() { return Object.keys(this.data).length; },
    key(index) { return Object.keys(this.data)[index] || null; }
  };
  console.log('Running in Node.js environment - using mock localStorage');
} else {
  console.log('Running in Browser environment - using real localStorage');
}

// Expected localStorage keys for inventory flow
const expectedKeys = {
  'event_inventory': 'Organiser inventory setup - categories with items (milk, coffee, syrups, sweeteners, etc.)',
  'station_inventory_configs': 'Station assignments - which items are available at each station',
  'station_inventory_quantities': 'Station quantities - how much of each item each station has',
  'coffee_stock_station_1': 'Barista stock data for station 1',
  'coffee_stock_station_2': 'Barista stock data for station 2', 
  'coffee_stock_station_3': 'Barista stock data for station 3'
};

console.log('1. CHECKING EXPECTED INVENTORY KEYS:');
console.log('=====================================');

// Check each expected key
for (const [key, description] of Object.entries(expectedKeys)) {
  const data = localStorage.getItem(key);
  console.log(`\n${key}:`);
  console.log(`  Description: ${description}`);
  console.log(`  Status: ${data ? 'EXISTS' : 'MISSING'}`);
  
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (key === 'event_inventory') {
        console.log(`  Categories: ${Object.keys(parsed).join(', ')}`);
        for (const [category, items] of Object.entries(parsed)) {
          if (Array.isArray(items)) {
            console.log(`    - ${category}: ${items.length} items (${items.filter(i => i.enabled).length} enabled)`);
          }
        }
      } else if (key === 'station_inventory_configs') {
        console.log(`  Stations configured: ${Object.keys(parsed).join(', ')}`);
        for (const [stationId, config] of Object.entries(parsed)) {
          const categories = Object.keys(config);
          console.log(`    - Station ${stationId}: ${categories.length} categories`);
        }
      } else if (key === 'station_inventory_quantities') {
        console.log(`  Stations with quantities: ${Object.keys(parsed).join(', ')}`);
      } else if (key.startsWith('coffee_stock_station_')) {
        const stationId = key.replace('coffee_stock_station_', '');
        console.log(`  Station ${stationId} stock categories: ${Object.keys(parsed).join(', ')}`);
        for (const [category, items] of Object.entries(parsed)) {
          if (Array.isArray(items)) {
            console.log(`    - ${category}: ${items.length} items (${items.filter(i => i.amount > 0).length} in stock)`);
          }
        }
      }
    } catch (e) {
      console.log(`  ERROR: Invalid JSON - ${e.message}`);
    }
  }
}

console.log('\n\n2. IDENTIFYING MISSING LINKS IN DATA FLOW:');
console.log('==========================================');

const eventInventory = localStorage.getItem('event_inventory');
const stationConfigs = localStorage.getItem('station_inventory_configs');
const stationQuantities = localStorage.getItem('station_inventory_quantities');

let issues = [];

if (!eventInventory) {
  issues.push('❌ NO EVENT INVENTORY: Organiser has not set up any inventory items');
} else {
  console.log('✅ Event inventory exists');
  try {
    const inventory = JSON.parse(eventInventory);
    const categories = Object.keys(inventory);
    if (categories.length === 0) {
      issues.push('❌ EMPTY EVENT INVENTORY: No categories defined');
    } else {
      console.log(`   Categories: ${categories.join(', ')}`);
      
      // Check for essential categories
      const essentialCategories = ['milk', 'coffee', 'cups'];
      for (const essential of essentialCategories) {
        if (!categories.includes(essential)) {
          issues.push(`⚠️  MISSING ESSENTIAL CATEGORY: ${essential}`);
        } else if (!inventory[essential] || inventory[essential].length === 0) {
          issues.push(`⚠️  EMPTY ESSENTIAL CATEGORY: ${essential}`);
        }
      }
    }
  } catch (e) {
    issues.push(`❌ CORRUPT EVENT INVENTORY: ${e.message}`);
  }
}

if (!stationConfigs) {
  issues.push('❌ NO STATION CONFIGS: Stations have not been assigned inventory items');
} else {
  console.log('✅ Station configs exist');
  try {
    const configs = JSON.parse(stationConfigs);
    const configuredStations = Object.keys(configs);
    if (configuredStations.length === 0) {
      issues.push('❌ NO STATIONS CONFIGURED: No stations have inventory assignments');
    } else {
      console.log(`   Configured stations: ${configuredStations.join(', ')}`);
    }
  } catch (e) {
    issues.push(`❌ CORRUPT STATION CONFIGS: ${e.message}`);
  }
}

if (!stationQuantities) {
  issues.push('⚠️  NO STATION QUANTITIES: Stations may not have specific quantities set');
} else {
  console.log('✅ Station quantities exist');
}

// Check barista stock data
const stationStockKeys = ['coffee_stock_station_1', 'coffee_stock_station_2', 'coffee_stock_station_3'];
let hasAnyStationStock = false;

for (const stockKey of stationStockKeys) {
  const stockData = localStorage.getItem(stockKey);
  if (stockData) {
    hasAnyStationStock = true;
    console.log(`✅ ${stockKey} exists`);
  } else {
    console.log(`❌ ${stockKey} missing`);
  }
}

if (!hasAnyStationStock) {
  issues.push('❌ NO BARISTA STOCK DATA: No stations have stock data for barista interface');
}

console.log('\n\n3. SUMMARY OF ISSUES:');
console.log('====================');

if (issues.length === 0) {
  console.log('✅ No major issues found - inventory data flow appears complete');
} else {
  console.log(`Found ${issues.length} issue(s):`);
  issues.forEach((issue, index) => {
    console.log(`${index + 1}. ${issue}`);
  });
}

console.log('\n\n4. RECOMMENDED ACTIONS:');
console.log('======================');

if (!eventInventory) {
  console.log('1. Go to Organiser → Stations → Event Inventory');
  console.log('   - Set up milk types (Whole Milk, Skim Milk, Oat Milk, etc.)');
  console.log('   - Set up coffee types (Espresso, Americano, Latte, etc.)');
  console.log('   - Set up syrups and sweeteners');
  console.log('   - Set up cups and sizes');
}

if (!stationConfigs) {
  console.log('2. Go to Organiser → Stations → Station Inventory');
  console.log('   - Select each station');
  console.log('   - Assign which inventory items are available at each station');
}

if (!hasAnyStationStock) {
  console.log('3. Trigger inventory sync:');
  console.log('   - InventoryIntegrationService.forceSyncAllStations()');
  console.log('   - Or manually sync each station');
}

console.log('\n\n5. DATA FLOW VERIFICATION:');
console.log('==========================');

console.log('Expected flow:');
console.log('1. Organiser sets up event_inventory (milk, coffee, syrups, sweeteners)');
console.log('2. Organiser assigns items to stations in station_inventory_configs');
console.log('3. Organiser sets quantities in station_inventory_quantities');
console.log('4. InventoryIntegrationService syncs to coffee_stock_station_X');
console.log('5. Barista interface loads from coffee_stock_station_X');
console.log('6. Walk-in orders use available stock from coffee_stock_station_X');

console.log('\n=== DIAGNOSIS COMPLETE ===');

// If running in Node.js, test with sample data
if (isNode) {
  console.log('\n\n6. TESTING WITH SAMPLE DATA:');
  console.log('=============================');
  
  // Create sample event inventory
  const sampleEventInventory = {
    milk: [
      { id: 'milk_1', name: 'Whole Milk', description: 'Regular dairy milk', enabled: true, category: 'milk' },
      { id: 'milk_2', name: 'Oat Milk', description: 'Plant-based oat milk', enabled: true, category: 'milk' },
      { id: 'milk_3', name: 'Almond Milk', description: 'Plant-based almond milk', enabled: true, category: 'milk' }
    ],
    coffee: [
      { id: 'coffee_1', name: 'Espresso', description: 'Strong coffee shot', enabled: true, category: 'coffee' },
      { id: 'coffee_2', name: 'Americano', description: 'Espresso with hot water', enabled: true, category: 'coffee' },
      { id: 'coffee_3', name: 'Latte', description: 'Espresso with steamed milk', enabled: true, category: 'coffee' }
    ],
    syrups: [
      { id: 'syrup_1', name: 'Vanilla Syrup', description: 'Classic vanilla flavor', enabled: true, category: 'syrups' },
      { id: 'syrup_2', name: 'Caramel Syrup', description: 'Sweet caramel flavor', enabled: true, category: 'syrups' }
    ],
    sweeteners: [
      { id: 'sweetener_1', name: 'White Sugar', description: 'Regular granulated sugar', enabled: true, category: 'sweeteners' },
      { id: 'sweetener_2', name: 'Honey', description: 'Natural honey sweetener', enabled: true, category: 'sweeteners' }
    ]
  };
  
  localStorage.setItem('event_inventory', JSON.stringify(sampleEventInventory));
  console.log('✅ Created sample event inventory');
  
  // Create sample station configs
  const sampleStationConfigs = {
    '1': {
      milk: { 'milk_1': true, 'milk_2': true, 'milk_3': true },
      coffee: { 'coffee_1': true, 'coffee_2': true, 'coffee_3': true },
      syrups: { 'syrup_1': true, 'syrup_2': true },
      sweeteners: { 'sweetener_1': true, 'sweetener_2': true }
    },
    '2': {
      milk: { 'milk_1': true, 'milk_2': true },
      coffee: { 'coffee_1': true, 'coffee_2': true },
      syrups: { 'syrup_1': true },
      sweeteners: { 'sweetener_1': true }
    }
  };
  
  localStorage.setItem('station_inventory_configs', JSON.stringify(sampleStationConfigs));
  console.log('✅ Created sample station configs');
  
  // Re-run diagnosis
  console.log('\nRe-running diagnosis with sample data...');
  console.log('Event inventory now has:', Object.keys(JSON.parse(localStorage.getItem('event_inventory'))).join(', '));
  console.log('Station configs now cover stations:', Object.keys(JSON.parse(localStorage.getItem('station_inventory_configs'))).join(', '));
}