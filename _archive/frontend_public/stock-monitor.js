// Stock Monitoring Script
// This script provides real-time monitoring of stock levels in development

(function() {
  console.log('Stock Monitoring Script Loaded');
  
  // Monitor interval in milliseconds
  const MONITOR_INTERVAL = 3000;
  
  // State for tracking stock changes
  let previousStock = {};
  let currentStock = {};
  
  // Get station ID from URL or localStorage
  function getCurrentStationId() {
    // Try to get from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const stationParam = urlParams.get('station');
    
    if (stationParam) {
      return stationParam;
    }
    
    // Try to get from localStorage
    return localStorage.getItem('current_station_id') || '1';
  }
  
  // Load stock data for the current station
  function loadStockData() {
    const stationId = getCurrentStationId();
    const stockKey = `coffee_stock_station_${stationId}`;
    
    try {
      const savedStock = localStorage.getItem(stockKey);
      if (savedStock) {
        return JSON.parse(savedStock);
      }
    } catch (e) {
      console.error('Error loading stock data:', e);
    }
    
    return null;
  }
  
  // Update the DOM with current stock levels
  function updateStockDisplay() {
    const stockData = loadStockData();
    if (!stockData) {
      document.getElementById('stock-status').textContent = 'No stock data available';
      return;
    }
    
    // Save previous state for comparison
    previousStock = currentStock;
    currentStock = JSON.parse(JSON.stringify(stockData));
    
    // Update UI
    const stockList = document.getElementById('stock-list');
    stockList.innerHTML = '';
    
    // Track critical items
    let criticalItems = [];
    
    // Process each category
    Object.keys(stockData).forEach(category => {
      const categoryItems = stockData[category];
      
      // Create category section
      const categorySection = document.createElement('div');
      categorySection.className = 'category-section';
      categorySection.innerHTML = `<h3>${category.charAt(0).toUpperCase() + category.slice(1)}</h3>`;
      
      // Create item list
      const itemsList = document.createElement('ul');
      
      categoryItems.forEach(item => {
        const itemElement = document.createElement('li');
        
        // Calculate percentage
        const percentage = Math.round((item.amount / item.capacity) * 100);
        
        // Determine status class
        let statusClass = 'good';
        if (item.amount <= item.criticalThreshold) {
          statusClass = 'critical';
          criticalItems.push(item);
        } else if (item.amount <= item.lowThreshold) {
          statusClass = 'low';
        }
        
        // Check if the item has changed from the previous check
        let hasChanged = false;
        if (previousStock[category]) {
          const prevItem = previousStock[category].find(p => p.id === item.id);
          if (prevItem && prevItem.amount !== item.amount) {
            hasChanged = true;
          }
        }
        
        // Add animation class for changed items
        const animationClass = hasChanged ? 'stock-changed' : '';
        
        itemElement.innerHTML = `
          <div class="item-row ${animationClass}">
            <span class="item-name">${item.name}</span>
            <div class="item-status">
              <div class="progress-bar">
                <div class="progress ${statusClass}" style="width: ${percentage}%"></div>
              </div>
              <span class="amount">${item.amount}${item.unit} / ${item.capacity}${item.unit}</span>
            </div>
          </div>
        `;
        
        itemsList.appendChild(itemElement);
      });
      
      categorySection.appendChild(itemsList);
      stockList.appendChild(categorySection);
    });
    
    // Update status summary
    const statusElement = document.getElementById('stock-status');
    if (criticalItems.length > 0) {
      statusElement.className = 'status critical';
      statusElement.innerHTML = `<strong>CRITICAL:</strong> ${criticalItems.map(item => item.name).join(', ')}`;
    } else {
      statusElement.className = 'status good';
      statusElement.textContent = 'All stock levels are sufficient';
    }
  }
  
  // Start monitoring when DOM is ready
  window.addEventListener('DOMContentLoaded', () => {
    // Set up monitoring interval
    setInterval(updateStockDisplay, MONITOR_INTERVAL);
    
    // Initial update
    updateStockDisplay();
    
    // Add controls for stock management
    const stationSelector = document.getElementById('station-selector');
    if (stationSelector) {
      // Populate station options
      for (let i = 1; i <= 5; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Station ${i}`;
        stationSelector.appendChild(option);
      }
      
      // Set current value
      stationSelector.value = getCurrentStationId();
      
      // Handle station change
      stationSelector.addEventListener('change', () => {
        localStorage.setItem('current_station_id', stationSelector.value);
        updateStockDisplay();
      });
    }
    
    // Reset stock button
    const resetButton = document.getElementById('reset-stock');
    if (resetButton) {
      resetButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset stock levels to default?')) {
          const stationId = getCurrentStationId();
          const stockKey = `coffee_stock_station_${stationId}`;
          localStorage.removeItem(stockKey);
          updateStockDisplay();
        }
      });
    }
  });
})();