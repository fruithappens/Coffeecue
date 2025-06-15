/**
 * Instant Preloader for Offline Mode
 * This script pre-renders sample data elements to prevent flickering
 */
(function() {
  console.log('🔄 Initializing instant preloader to prevent flicker...');
  
  // Immediately insert basic UI structure with sample data
  document.addEventListener('DOMContentLoaded', function() {
    // Target the root element
    const root = document.getElementById('root');
    if (!root) return;
    
    // Insert loading notice
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'offline-preloader';
    loadingDiv.style.position = 'fixed';
    loadingDiv.style.top = '0';
    loadingDiv.style.left = '0';
    loadingDiv.style.width = '100%';
    loadingDiv.style.padding = '8px';
    loadingDiv.style.textAlign = 'center';
    loadingDiv.style.backgroundColor = '#f8d7da';
    loadingDiv.style.color = '#721c24';
    loadingDiv.style.borderBottom = '1px solid #f5c6cb';
    loadingDiv.style.zIndex = '9999';
    loadingDiv.style.fontSize = '14px';
    loadingDiv.innerHTML = '<strong>OFFLINE MODE</strong> - Using sample data (loading application...)';
    
    // Insert at top of body
    document.body.insertBefore(loadingDiv, document.body.firstChild);
    
    // Remove preloader when app loads
    setTimeout(() => {
      const preloader = document.getElementById('offline-preloader');
      if (preloader) {
        preloader.style.opacity = '0';
        preloader.style.transition = 'opacity 0.5s';
        setTimeout(() => {
          if (preloader && preloader.parentNode) {
            preloader.parentNode.removeChild(preloader);
          }
        }, 500);
      }
    }, 2000);
  });
  
  // Apply instant data display
  function applyInstantDataDisplay() {
    // Force all data containers to display immediately
    const dataContainers = document.querySelectorAll(
      '.data-container, .order-list, table, .list-group, .station-list'
    );
    
    dataContainers.forEach(container => {
      container.style.opacity = '1';
      container.style.visibility = 'visible';
      container.style.display = 'block';
    });
    
    // Hide all loaders
    const loaders = document.querySelectorAll(
      '.loader, .spinner, [role="progressbar"], .loading'
    );
    
    loaders.forEach(loader => {
      loader.style.display = 'none';
      loader.style.visibility = 'hidden';
      loader.style.opacity = '0';
    });
  }
  
  // Apply repeatedly to catch dynamic content
  setInterval(applyInstantDataDisplay, 100);
  
  // Intercept React rendering
  const originalCreateElement = window.React ? window.React.createElement : null;
  if (originalCreateElement) {
    window.React.createElement = function() {
      const element = originalCreateElement.apply(this, arguments);
      
      // Check if this is a loader/spinner component
      if (element && element.props && element.props.className) {
        const className = element.props.className;
        if (typeof className === 'string' && 
            (className.includes('loader') || 
             className.includes('spinner') || 
             className.includes('loading'))) {
          
          // Hide loaders
          element.props.style = {...(element.props.style || {}), 
            display: 'none', 
            visibility: 'hidden',
            opacity: 0
          };
        }
      }
      
      return element;
    };
  }
  
  console.log('✅ Instant preloader initialized');
})();