// Fix the disconnect between station inventory and walk-in order dialog
(function() {
  function fixWalkInOrderMilkOptions() {
    console.log("Starting walk-in order milk options fix");
    
    try {
      // 1. First, locate the selected station
      const selectedStation = localStorage.getItem('coffee_cue_selected_station');
      console.log(`Selected station: ${selectedStation}`);
      
      if (!selectedStation) {
        throw new Error("No selected station found in localStorage");
      }
      
      // 2. Find the inventory for this station
      const stockKey = `coffee_stock_station_${selectedStation}`;
      const stationInventory = localStorage.getItem(stockKey);
      
      if (!stationInventory) {
        throw new Error(`No inventory found for station ${selectedStation}`);
      }
      
      // 3. Parse the inventory
      const inventory = JSON.parse(stationInventory);
      
      // 4. Extract milk types that have inventory > 0
      const availableMilkTypes = [];
      
      if (inventory.milk && Array.isArray(inventory.milk)) {
        inventory.milk.forEach(milkItem => {
          if (milkItem.amount > 0) {
            availableMilkTypes.push({
              id: milkItem.id,
              name: milkItem.name
            });
          }
        });
      }
      
      console.log("Available milk types from inventory:", availableMilkTypes);
      
      // 5. Create a simple class that overrides the StockService getAvailableMilkTypes method
      const overrideScript = `
        // Override StockService.getAvailableMilkTypes to return an absolute fixed list
        if (window.StockService) {
          console.log("PATCHING StockService.getAvailableMilkTypes");
          
          const originalMethod = StockService.getAvailableMilkTypes;
          
          StockService.getAvailableMilkTypes = function() {
            console.log("🔧 USING PATCHED getAvailableMilkTypes");
            
            // These are the exact milk IDs that should be available (from actual inventory)
            const fixedMilkIds = ${JSON.stringify(availableMilkTypes.map(m => m.id))};
            console.log("🔧 Fixed milk IDs:", fixedMilkIds);
            
            // Also include normalized versions (with/without 'milk_' prefix)
            const allVersions = [];
            fixedMilkIds.forEach(id => {
              allVersions.push(id);
              
              // Add version with prefix if not present
              if (!id.startsWith('milk_')) {
                allVersions.push(\`milk_\${id}\`);
              }
              
              // Add version without prefix if present
              if (id.startsWith('milk_')) {
                allVersions.push(id.substring(5));
              }
            });
            
            console.log("🔧 Normalized milk IDs:", allVersions);
            return allVersions;
          };
        } else {
          console.error("StockService not found - can't patch!");
        }
      `;
      
      // 6. Create a display showing what we're doing and when we're done
      const display = document.createElement('div');
      display.style.position = 'fixed';
      display.style.top = '20px';
      display.style.left = '50%';
      display.style.transform = 'translateX(-50%)';
      display.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
      display.style.color = 'white';
      display.style.padding = '20px';
      display.style.borderRadius = '10px';
      display.style.zIndex = '10000';
      display.style.maxWidth = '80%';
      display.style.textAlign = 'center';
      
      // 7. Add inject button to insert our fix
      display.innerHTML = `
        <h3 style="margin-top: 0;">Walk-In Order Milk Fix</h3>
        <p>This tool will fix the milk options in the walk-in order dialog for station ${selectedStation}</p>
        <p>Available milk types in inventory: ${availableMilkTypes.map(m => m.name).join(', ')}</p>
        <button id="inject-fix" style="background-color: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 10px;">
          Inject Fix
        </button>
        <button id="close-dialog" style="background-color: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 10px; margin-left: 10px;">
          Close
        </button>
      `;
      
      document.body.appendChild(display);
      
      // 8. Inject the override script when button is clicked
      document.getElementById('inject-fix').addEventListener('click', function() {
        // Inject the script
        const script = document.createElement('script');
        script.textContent = overrideScript;
        document.head.appendChild(script);
        
        // Show success message
        display.innerHTML = `
          <h3 style="margin-top: 0;">Walk-In Order Milk Fix</h3>
          <p style="color: #4caf50;">✅ Fix has been injected!</p>
          <p>Now open the walk-in order dialog to see the correct milk options.</p>
          <p style="font-size: 0.9em;">Available milk types: ${availableMilkTypes.map(m => m.name).join(', ')}</p>
          <button id="close-dialog" style="background-color: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-top: 10px;">
            Close
          </button>
        `;
        
        document.getElementById('close-dialog').addEventListener('click', function() {
          document.body.removeChild(display);
        });
      });
      
      document.getElementById('close-dialog').addEventListener('click', function() {
        document.body.removeChild(display);
      });
      
    } catch (error) {
      console.error("Error in milk options fix:", error);
      alert(`Error: ${error.message}`);
    }
  }
  
  // Run the fix
  fixWalkInOrderMilkOptions();
})();