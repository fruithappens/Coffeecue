// Debug script to show station name, ID, and inventory relationships
(function() {
  function getAllStations() {
    // Get all localStorage keys
    const stationsData = {
      station_ids_and_names: {},
      inventory_by_station: {}
    };
    
    // 1. Look for station data (from useStations hook)
    try {
      const savedStations = localStorage.getItem('coffee_cue_stations');
      if (savedStations) {
        const parsedStations = JSON.parse(savedStations);
        stationsData.raw_stations_data = parsedStations;
        
        // Extract station IDs and names
        parsedStations.forEach(station => {
          stationsData.station_ids_and_names[station.id] = station.name;
          
          // Check for custom name
          try {
            const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
            if (customName) {
              stationsData.station_ids_and_names[station.id] += ` (custom: "${customName}")`;
            }
          } catch (e) {}
        });
      }
    } catch (e) {
      stationsData.station_error = e.message;
    }
    
    // 2. Get selected station
    try {
      const selectedStation = localStorage.getItem('coffee_cue_selected_station');
      stationsData.selected_station = selectedStation ? parseInt(selectedStation, 10) : null;
    } catch (e) {
      stationsData.selected_station_error = e.message;
    }
    
    // 3. Get last used station
    try {
      const lastUsedStation = localStorage.getItem('last_used_station_id');
      stationsData.last_used_station = lastUsedStation ? parseInt(lastUsedStation, 10) : null;
    } catch (e) {
      stationsData.last_used_station_error = e.message;
    }
    
    // 4. Look for inventory data (from StockService)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('coffee_stock_station_')) {
        try {
          const stationId = key.replace('coffee_stock_station_', '');
          const inventory = JSON.parse(localStorage.getItem(key));
          
          stationsData.inventory_by_station[stationId] = {
            milk_inventory: inventory.milk || [],
            coffee_inventory: inventory.coffee || [],
            cups_inventory: inventory.cups || []
          };
        } catch (e) {
          stationsData.inventory_by_station[key] = `Error: ${e.message}`;
        }
      }
    }
    
    // 5. Mismatches and Orphans
    stationsData.mismatches = [];
    stationsData.orphaned_inventory = [];
    
    // Check for stations without inventory
    Object.keys(stationsData.station_ids_and_names).forEach(stationId => {
      const inventoryKey = `coffee_stock_station_${stationId}`;
      if (!stationsData.inventory_by_station[stationId]) {
        stationsData.mismatches.push({
          type: 'missing_inventory',
          station_id: stationId,
          station_name: stationsData.station_ids_and_names[stationId],
          details: `Station exists but has no inventory data`
        });
      }
    });
    
    // Check for inventory without stations
    Object.keys(stationsData.inventory_by_station).forEach(inventoryId => {
      if (!stationsData.station_ids_and_names[inventoryId]) {
        stationsData.orphaned_inventory.push({
          type: 'orphaned_inventory',
          inventory_id: inventoryId,
          details: `Inventory exists for station ID ${inventoryId} but no station with this ID exists`
        });
      }
    });
    
    return stationsData;
  }
  
  // Create display for the data
  function displayStationInfo() {
    const stationsData = getAllStations();
    
    // Format the output
    let output = `
      <h2>Station ID & Inventory Relationships</h2>
      
      <div style="margin-bottom: 20px;">
        <h3>Selected Station: ${stationsData.selected_station}</h3>
        <h3>Last Used Station: ${stationsData.last_used_station}</h3>
      </div>
      
      <div style="margin-bottom: 20px;">
        <h3>Stations (Name & ID)</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #4CAF50; color: white;">Station ID</th>
            <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #4CAF50; color: white;">Station Name</th>
            <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #4CAF50; color: white;">Selected</th>
          </tr>
          ${Object.entries(stationsData.station_ids_and_names).map(([id, name]) => `
            <tr ${id == stationsData.selected_station ? 'style="background-color: #f2fff2;"' : ''}>
              <td style="padding: 8px; border: 1px solid #ddd;">${id}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${name}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${id == stationsData.selected_station ? '✓' : ''}</td>
            </tr>
          `).join('')}
        </table>
      </div>
      
      <div style="margin-bottom: 20px;">
        <h3>Station Inventories</h3>
        ${Object.entries(stationsData.inventory_by_station).map(([stationId, inventory]) => `
          <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: ${stationId == stationsData.selected_station ? '#f2fff2' : 'white'};">
            <h4>Station ID: ${stationId} ${stationsData.station_ids_and_names[stationId] ? `(${stationsData.station_ids_and_names[stationId]})` : '(Unknown Station)'}</h4>
            <div style="margin-left: 20px;">
              <h5>Milk Inventory (${inventory.milk_inventory?.length || 0} items)</h5>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #2196F3; color: white;">ID</th>
                  <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #2196F3; color: white;">Name</th>
                  <th style="text-align: left; padding: 8px; border: 1px solid #ddd; background-color: #2196F3; color: white;">Amount</th>
                </tr>
                ${Array.isArray(inventory.milk_inventory) ? inventory.milk_inventory.map(milk => `
                  <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;">${milk.id}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${milk.name}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${milk.amount} ${milk.unit}</td>
                  </tr>
                `).join('') : '<tr><td colspan="3" style="padding: 8px; border: 1px solid #ddd;">No milk inventory data</td></tr>'}
              </table>
            </div>
          </div>
        `).join('')}
      </div>
      
      ${stationsData.mismatches.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #f44336;">Mismatches</h3>
          <ul>
            ${stationsData.mismatches.map(mismatch => `
              <li>${mismatch.details}</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
      
      ${stationsData.orphaned_inventory.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h3 style="color: #ff9800;">Orphaned Inventory</h3>
          <ul>
            ${stationsData.orphaned_inventory.map(orphan => `
              <li>${orphan.details}</li>
            `).join('')}
          </ul>
        </div>
      ` : ''}
    `;
    
    return output;
  }
  
  // Create a display overlay
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    overlay.style.color = 'black';
    overlay.style.zIndex = '10000';
    overlay.style.padding = '20px';
    overlay.style.overflow = 'auto';
    overlay.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.position = 'fixed';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.padding = '8px 15px';
    closeButton.style.backgroundColor = '#f44336';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontSize = '16px';
    closeButton.onclick = () => document.body.removeChild(overlay);
    
    overlay.appendChild(closeButton);
    
    // Add Reset and Fix buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.position = 'fixed';
    buttonContainer.style.top = '10px';
    buttonContainer.style.left = '20px';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset All Station Data';
    resetButton.style.padding = '8px 15px';
    resetButton.style.backgroundColor = '#ff9800';
    resetButton.style.color = 'white';
    resetButton.style.border = 'none';
    resetButton.style.borderRadius = '4px';
    resetButton.style.cursor = 'pointer';
    resetButton.style.fontSize = '16px';
    resetButton.onclick = () => {
      if (confirm('This will reset ALL station inventory data! Are you sure?')) {
        resetAllStationData();
        overlay.innerHTML = '';
        overlay.appendChild(closeButton);
        overlay.appendChild(buttonContainer);
        const content = document.createElement('div');
        content.innerHTML = displayStationInfo();
        overlay.appendChild(content);
      }
    };
    
    const fixMismatchesButton = document.createElement('button');
    fixMismatchesButton.textContent = 'Fix Mismatches';
    fixMismatchesButton.style.padding = '8px 15px';
    fixMismatchesButton.style.backgroundColor = '#4CAF50';
    fixMismatchesButton.style.color = 'white';
    fixMismatchesButton.style.border = 'none';
    fixMismatchesButton.style.borderRadius = '4px';
    fixMismatchesButton.style.cursor = 'pointer';
    fixMismatchesButton.style.fontSize = '16px';
    fixMismatchesButton.onclick = () => {
      fixStationMismatches();
      overlay.innerHTML = '';
      overlay.appendChild(closeButton);
      overlay.appendChild(buttonContainer);
      const content = document.createElement('div');
      content.innerHTML = displayStationInfo();
      overlay.appendChild(content);
    };
    
    buttonContainer.appendChild(resetButton);
    buttonContainer.appendChild(fixMismatchesButton);
    overlay.appendChild(buttonContainer);
    
    // Add content
    const content = document.createElement('div');
    content.innerHTML = displayStationInfo();
    overlay.appendChild(content);
    
    return overlay;
  }
  
  // Reset all station inventory data
  function resetAllStationData() {
    try {
      const defaultMilks = [
        { id: 'milk_regular', name: 'Regular Milk', amount: 20, capacity: 20, unit: 'L', status: 'good', lowThreshold: 5, criticalThreshold: 2 },
        { id: 'milk_skim', name: 'Skim Milk', amount: 10, capacity: 10, unit: 'L', status: 'good', lowThreshold: 3, criticalThreshold: 1 },
        { id: 'milk_almond', name: 'Almond Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 },
        { id: 'milk_soy', name: 'Soy Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 }
      ];
      
      const defaultCoffee = [
        { id: 'coffee_house', name: 'House Blend', amount: 5, capacity: 5, unit: 'kg', status: 'good', lowThreshold: 1.5, criticalThreshold: 0.5 },
        { id: 'coffee_dark', name: 'Dark Roast', amount: 3, capacity: 3, unit: 'kg', status: 'good', lowThreshold: 1, criticalThreshold: 0.3 },
        { id: 'coffee_decaf', name: 'Decaf Blend', amount: 2, capacity: 2, unit: 'kg', status: 'good', lowThreshold: 0.5, criticalThreshold: 0.2 }
      ];
      
      const defaultCups = [
        { id: 'cups_small', name: 'Small Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
        { id: 'cups_medium', name: 'Medium Cups', amount: 200, capacity: 200, unit: 'pcs', status: 'good', lowThreshold: 50, criticalThreshold: 20 },
        { id: 'cups_large', name: 'Large Cups', amount: 100, capacity: 100, unit: 'pcs', status: 'good', lowThreshold: 30, criticalThreshold: 10 }
      ];
      
      // Get all station IDs
      let stationIds = [];
      try {
        const savedStations = localStorage.getItem('coffee_cue_stations');
        if (savedStations) {
          const parsedStations = JSON.parse(savedStations);
          stationIds = parsedStations.map(s => s.id);
        }
      } catch (e) {
        console.error('Error getting station IDs:', e);
      }
      
      // Make sure we have at least one station
      if (stationIds.length === 0) {
        stationIds = [1]; // Default station ID
      }
      
      // Reset inventory for each station
      stationIds.forEach(stationId => {
        const stockKey = `coffee_stock_station_${stationId}`;
        const inventory = {
          milk: [...defaultMilks],
          coffee: [...defaultCoffee],
          cups: [...defaultCups]
        };
        localStorage.setItem(stockKey, JSON.stringify(inventory));
      });
      
      // Clear any orphaned inventory
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('coffee_stock_station_')) {
          const stationId = key.replace('coffee_stock_station_', '');
          if (!stationIds.includes(parseInt(stationId, 10))) {
            localStorage.removeItem(key);
          }
        }
      }
      
      alert('All station inventory data has been reset to defaults.');
    } catch (e) {
      alert(`Error resetting station data: ${e.message}`);
    }
  }
  
  // Fix station mismatches
  function fixStationMismatches() {
    try {
      const stationsData = getAllStations();
      
      // Fix stations with missing inventory
      stationsData.mismatches.forEach(mismatch => {
        if (mismatch.type === 'missing_inventory') {
          const stationId = mismatch.station_id;
          const stockKey = `coffee_stock_station_${stationId}`;
          
          // Create default inventory for this station
          const defaultInventory = {
            milk: [
              { id: 'milk_regular', name: 'Regular Milk', amount: 20, capacity: 20, unit: 'L', status: 'good', lowThreshold: 5, criticalThreshold: 2 },
              { id: 'milk_skim', name: 'Skim Milk', amount: 10, capacity: 10, unit: 'L', status: 'good', lowThreshold: 3, criticalThreshold: 1 },
              { id: 'milk_almond', name: 'Almond Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 },
              { id: 'milk_soy', name: 'Soy Milk', amount: 5, capacity: 5, unit: 'L', status: 'good', lowThreshold: 2, criticalThreshold: 1 }
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
            ]
          };
          
          localStorage.setItem(stockKey, JSON.stringify(defaultInventory));
        }
      });
      
      // Remove orphaned inventory
      stationsData.orphaned_inventory.forEach(orphan => {
        if (orphan.type === 'orphaned_inventory') {
          const stockKey = `coffee_stock_station_${orphan.inventory_id}`;
          localStorage.removeItem(stockKey);
        }
      });
      
      alert('Fixed station mismatches and removed orphaned inventory.');
    } catch (e) {
      alert(`Error fixing mismatches: ${e.message}`);
    }
  }
  
  // Add the overlay to the page
  document.body.appendChild(createOverlay());
})();