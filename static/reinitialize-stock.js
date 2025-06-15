// Utility to reinitialize stock data for the current station
// This can be run in the browser console if the Stock tab is showing blank

(function() {
    console.log('=== Stock Reinitialization Utility ===');
    
    // Get current station info
    const selectedStation = localStorage.getItem('selectedStation');
    const stationName = localStorage.getItem('stationName');
    
    console.log(`Current Station: ${stationName} (ID: ${selectedStation})`);
    
    if (!selectedStation) {
        console.error('No station selected! Please select a station first.');
        return;
    }
    
    // Check for existing stock data
    const correctKey = `coffee_stock_station_${selectedStation}`;
    const existingData = localStorage.getItem(correctKey);
    
    if (existingData) {
        console.log('Stock data already exists for this station.');
        try {
            const data = JSON.parse(existingData);
            console.log('Categories found:', Object.keys(data));
            Object.keys(data).forEach(category => {
                if (Array.isArray(data[category])) {
                    console.log(`- ${category}: ${data[category].length} items`);
                }
            });
        } catch (e) {
            console.error('Error parsing existing data:', e);
        }
    } else {
        console.log('No stock data found for this station.');
        
        // Look for any other stock data
        let foundAnyStock = false;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('coffee_stock_station_')) {
                console.log(`Found stock data at: ${key}`);
                foundAnyStock = true;
                
                // Offer to migrate
                if (confirm(`Found stock data at ${key}. Migrate to current station?`)) {
                    const data = localStorage.getItem(key);
                    localStorage.setItem(correctKey, data);
                    localStorage.removeItem(key);
                    console.log('✓ Stock data migrated successfully!');
                    break;
                }
            }
        }
        
        if (!foundAnyStock) {
            console.log('No stock data found anywhere. Creating default stock...');
            
            const defaultStock = {
                milk: [
                    { id: 'milk_regular', name: 'Regular Milk', amount: 20, capacity: 20, unit: 'L', status: 'good', lowThreshold: 5, criticalThreshold: 2 },
                    { id: 'milk_skim', name: 'Skim Milk', amount: 10, capacity: 10, unit: 'L', status: 'good', lowThreshold: 3, criticalThreshold: 1 },
                    { id: 'milk_almond', name: 'Almond Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 },
                    { id: 'milk_soy', name: 'Soy Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 },
                    { id: 'milk_oat', name: 'Oat Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 }
                ],
                coffee: [
                    { id: 'coffee_house', name: 'House Blend', amount: 5, capacity: 5, unit: 'kg', status: 'good', lowThreshold: 1.5, criticalThreshold: 0.5 },
                    { id: 'coffee_dark', name: 'Dark Roast', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 1, criticalThreshold: 0.3 },
                    { id: 'coffee_decaf', name: 'Decaf Blend', amount: 2, capacity: 2, unit: 'kg', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 }
                ],
                cups: [
                    { id: 'cups_small', name: 'Small Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
                    { id: 'cups_medium', name: 'Medium Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
                    { id: 'cups_large', name: 'Large Cups', amount: 100, capacity: 100, unit: 'pcs', status: 'good', lowThreshold: 30, criticalThreshold: 10 }
                ],
                syrups: [
                    { id: 'syrup_vanilla', name: 'Vanilla Syrup', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
                    { id: 'syrup_caramel', name: 'Caramel Syrup', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
                    { id: 'syrup_hazelnut', name: 'Hazelnut Syrup', amount: 1, capacity: 1, unit: 'L', status: 'good', lowThreshold: 0.3, criticalThreshold: 0.1 }
                ],
                sweeteners: [
                    { id: 'sugar_white', name: 'White Sugar', amount: 5, capacity: 5, unit: 'kg', status: 'good', lowThreshold: 1, criticalThreshold: 0.5 },
                    { id: 'sugar_brown', name: 'Brown Sugar', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 0.8, criticalThreshold: 0.3 },
                    { id: 'sweetener_packets', name: 'Sweetener Packets', amount: 500, capacity: 500, unit: 'pcs', status: 'good', lowThreshold: 100, criticalThreshold: 50 },
                    { id: 'honey', name: 'Honey', amount: 2, capacity: 2, unit: 'L', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 }
                ],
                drinks: [
                    { id: 'hot_chocolate_powder', name: 'Hot Chocolate Powder', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 0.8, criticalThreshold: 0.3 },
                    { id: 'chai_latte_mix', name: 'Chai Latte Mix', amount: 2, capacity: 2, unit: 'kg', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 },
                    { id: 'matcha_powder', name: 'Matcha Powder', amount: 1, capacity: 1, unit: 'kg', status: 'good', lowThreshold: 0.3, criticalThreshold: 0.1 }
                ],
                other: [
                    { id: 'napkins', name: 'Napkins', amount: 1000, capacity: 1000, unit: 'pcs', status: 'good', lowThreshold: 200, criticalThreshold: 100 }
                ]
            };
            
            localStorage.setItem(correctKey, JSON.stringify(defaultStock));
            console.log('✓ Default stock data created!');
        }
    }
    
    console.log('\n=== Next Steps ===');
    console.log('1. Refresh the page (F5 or Cmd+R)');
    console.log('2. Click on the Stock tab');
    console.log('3. Stock items should now be visible');
    console.log('\nIf items still don\'t appear, check the browser console for any errors.');
})();