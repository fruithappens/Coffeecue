// Adds a TEST MILK to the current station's inventory and sets cashew milk to 0 to verify walk-in order functionality
(function() {
  // Get the selected station
  const selectedStation = localStorage.getItem('coffee_cue_selected_station');
  if (!selectedStation) {
    alert('No station selected. Please select a station first.');
    return;
  }
  
  // Get the inventory for this station
  const stockKey = `coffee_stock_station_${selectedStation}`;
  let stationInventory = null;
  
  try {
    const savedStock = localStorage.getItem(stockKey);
    if (savedStock) {
      stationInventory = JSON.parse(savedStock);
    } else {
      alert(`No inventory found for station ${selectedStation}`);
      return;
    }
  } catch (e) {
    alert(`Error loading inventory: ${e.message}`);
    return;
  }
  
  // Make sure we have a milk array
  if (!stationInventory.milk) {
    stationInventory.milk = [];
  }
  
  // 1. Add TEST MILK to inventory
  const testMilk = {
    id: 'milk_test',
    name: 'TEST MILK',
    amount: 10,
    capacity: 10,
    unit: 'L',
    status: 'good',
    lowThreshold: 3,
    criticalThreshold: 1
  };
  
  // Check if TEST MILK already exists
  const existingTestIndex = stationInventory.milk.findIndex(m => m.id === 'milk_test');
  if (existingTestIndex >= 0) {
    // Update existing test milk
    stationInventory.milk[existingTestIndex] = testMilk;
  } else {
    // Add new test milk
    stationInventory.milk.push(testMilk);
  }
  
  // 2. Set CASHEW MILK to 0 quantity to ensure it's filtered out
  let cashewFound = false;
  const cashewMilkIds = ['cashew', 'milk_cashew', 'cashew_milk'];
  
  // Try to find cashew milk with various ID formats
  for (const id of cashewMilkIds) {
    const cashewIndex = stationInventory.milk.findIndex(m => 
      m.id === id || 
      m.name.toLowerCase().includes('cashew')
    );
    
    if (cashewIndex >= 0) {
      // Set cashew milk amount to 0
      stationInventory.milk[cashewIndex].amount = 0;
      stationInventory.milk[cashewIndex].status = 'danger';
      cashewFound = true;
      console.log(`Set cashew milk (${stationInventory.milk[cashewIndex].id}) amount to 0`);
    }
  }
  
  // If no cashew milk found, add it with 0 amount
  if (!cashewFound) {
    console.log('No cashew milk found, adding it with 0 amount');
    const cashewMilk = {
      id: 'milk_cashew',
      name: 'Cashew Milk',
      amount: 0,
      capacity: 5,
      unit: 'L',
      status: 'danger',
      lowThreshold: 2,
      criticalThreshold: 1
    };
    stationInventory.milk.push(cashewMilk);
  }
  
  // Save updated inventory
  localStorage.setItem(stockKey, JSON.stringify(stationInventory));
  
  // Display confirmation
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '50%';
  overlay.style.left = '50%';
  overlay.style.transform = 'translate(-50%, -50%)';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
  overlay.style.color = 'white';
  overlay.style.padding = '20px';
  overlay.style.borderRadius = '10px';
  overlay.style.zIndex = '10000';
  overlay.style.maxWidth = '80%';
  overlay.style.textAlign = 'center';
  
  overlay.innerHTML = `
    <h3 style="margin-top: 0;">TEST MILK Added!</h3>
    <p>TEST MILK has been added to station ${selectedStation}'s inventory.</p>
    <p>Cashew Milk has been set to 0 quantity.</p>
    <p>Now open the walk-in order dialog to verify:</p>
    <ul style="text-align: left; margin-top: 10px;">
      <li>✅ TEST MILK should appear in the milk options</li>
      <li>❌ Cashew Milk should NOT appear in the milk options</li>
    </ul>
    <div style="margin-top: 20px;">
      <button id="close-overlay" style="background-color: #4caf50; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
        OK
      </button>
      <button id="reload-page" style="background-color: #2196f3; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; margin-left: 10px;">
        Reload Page
      </button>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  document.getElementById('close-overlay').addEventListener('click', function() {
    document.body.removeChild(overlay);
  });
  
  document.getElementById('reload-page').addEventListener('click', function() {
    location.reload();
  });
})();