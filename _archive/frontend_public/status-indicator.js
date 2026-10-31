/**
 * Status Indicator - Shows current connection status and data source
 */
(function() {
  console.log('🔍 Initializing status indicator...');
  
  // Create and inject the status indicator once the DOM is ready
  document.addEventListener('DOMContentLoaded', function() {
    const indicator = document.createElement('div');
    indicator.id = 'connection-status-indicator';
    indicator.style.position = 'fixed';
    indicator.style.bottom = '10px';
    indicator.style.right = '10px';
    indicator.style.backgroundColor = '#2c3e50';
    indicator.style.color = 'white';
    indicator.style.padding = '8px 12px';
    indicator.style.borderRadius = '4px';
    indicator.style.fontSize = '12px';
    indicator.style.fontWeight = 'bold';
    indicator.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    indicator.style.zIndex = '9999';
    indicator.style.cursor = 'pointer';
    indicator.style.opacity = '0.8';
    
    // Start with "Connecting" status
    indicator.innerHTML = `<span style="color:#ff9800;">⟳</span> CONNECTING TO BACKEND...`;
    
    // Add hover effect
    indicator.addEventListener('mouseover', function() {
      this.style.opacity = '1';
    });
    
    indicator.addEventListener('mouseout', function() {
      this.style.opacity = '0.8';
    });
    
    // Add click to toggle fallback mode
    indicator.addEventListener('click', function() {
      const currentMode = localStorage.getItem('use_fallback_data');
      
      if (currentMode === 'true') {
        // Switch to real data mode
        localStorage.removeItem('use_fallback_data');
        indicator.innerHTML = `<span style="color:#ff9800;">⟳</span> CONNECTING TO BACKEND...`;
        window.location.reload();
      } else {
        // Switch to fallback mode
        localStorage.setItem('use_fallback_data', 'true');
        indicator.innerHTML = `<span style="color:#e74c3c;">⚠</span> USING SAMPLE DATA`;
        window.location.reload();
      }
    });
    
    // Add to the document
    document.body.appendChild(indicator);
    
    // Expose update function globally
    window.updateConnectionStatus = function(status, message) {
      switch(status) {
        case 'online':
          indicator.innerHTML = `<span style="color:#2ecc71;">✓</span> CONNECTED TO BACKEND`;
          break;
        case 'offline':
          indicator.innerHTML = `<span style="color:#e74c3c;">⚠</span> USING SAMPLE DATA`;
          localStorage.setItem('use_fallback_data', 'true');
          break;
        case 'error':
          indicator.innerHTML = `<span style="color:#e74c3c;">✗</span> ${message || 'CONNECTION ERROR'}`;
          localStorage.setItem('use_fallback_data', 'true');
          break;
        case 'connecting':
          indicator.innerHTML = `<span style="color:#ff9800;">⟳</span> CONNECTING TO BACKEND...`;
          break;
      }
    };
    
    // Start a test ping after a short delay
    setTimeout(function() {
      // Try to reach the backend API
      fetch('/api/test')
        .then(response => {
          if (response.ok) {
            window.updateConnectionStatus('online');
            localStorage.removeItem('use_fallback_data');
          } else {
            window.updateConnectionStatus('error', `SERVER ERROR (${response.status})`);
          }
        })
        .catch(error => {
          window.updateConnectionStatus('offline');
          console.log('Connection test failed:', error);
        });
    }, 1000);
  });
  
  console.log('✅ Status indicator initialized');
})();