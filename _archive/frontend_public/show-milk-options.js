// Debug script to show all milk types in localStorage and current station inventory
(function() {
  function displayObject(obj, label, indent = '') {
    let html = `<div style="margin-left: ${indent ? '20px' : '0'}">`;
    if (label) {
      html += `<strong>${label}</strong>: `;
    }
    
    if (obj === null) {
      html += '<span style="color: gray;">null</span>';
    } else if (obj === undefined) {
      html += '<span style="color: gray;">undefined</span>';
    } else if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      html += `<span style="color: blue;">${obj}</span>`;
    } else if (Array.isArray(obj)) {
      html += '[<br>';
      obj.forEach((item, i) => {
        html += displayObject(item, i, indent + '  ');
        if (i < obj.length - 1) {
          html += ',<br>';
        }
      });
      html += `<br>${indent}]`;
    } else if (typeof obj === 'object') {
      html += '{<br>';
      const keys = Object.keys(obj);
      keys.forEach((key, i) => {
        html += displayObject(obj[key], key, indent + '  ');
        if (i < keys.length - 1) {
          html += ',<br>';
        }
      });
      html += `<br>${indent}}`;
    }
    
    html += '</div>';
    return html;
  }

  // Get all localStorage keys with 'coffee_stock_station' in them
  function getMilkInventories() {
    const results = {};
    
    // Find all station stock keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('coffee_stock_station')) {
        try {
          const data = JSON.parse(localStorage.getItem(key));
          results[key] = data.milk || [];
        } catch (e) {
          results[key] = `Error parsing JSON: ${e.message}`;
        }
      }
    }

    // Get settings if available
    try {
      const settings = JSON.parse(localStorage.getItem('coffee_settings'));
      results['coffee_settings'] = settings?.availableMilks || 'No milk settings found';
    } catch (e) {
      results['coffee_settings'] = `Error parsing settings: ${e.message}`;
    }
    
    return results;
  }

  // Create a display overlay
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    overlay.style.color = 'white';
    overlay.style.zIndex = '10000';
    overlay.style.padding = '20px';
    overlay.style.overflow = 'auto';
    overlay.style.fontFamily = 'monospace';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.style.position = 'fixed';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.padding = '5px 10px';
    closeButton.style.backgroundColor = 'red';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '5px';
    closeButton.style.cursor = 'pointer';
    closeButton.onclick = () => document.body.removeChild(overlay);
    
    overlay.appendChild(closeButton);
    
    // Add content
    const header = document.createElement('h2');
    header.textContent = 'Station Milk Inventory Debug';
    header.style.color = 'white';
    overlay.appendChild(header);
    
    const content = document.createElement('div');
    content.style.marginTop = '20px';
    
    // Get milk inventories
    const inventories = getMilkInventories();
    
    // Display as JSON
    content.innerHTML = displayObject(inventories, 'Station Milk Inventories');
    
    overlay.appendChild(content);
    
    return overlay;
  }
  
  // Add the overlay to the page
  document.body.appendChild(createOverlay());
})();