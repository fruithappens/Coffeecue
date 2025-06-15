/**
 * React Error Overlay Override
 * This script prevents the React error overlay from showing
 * and redirects to our emergency page instead
 */
(function() {
  console.log('Setting up error override...');
  
  // Wait for document to be ready
  document.addEventListener('DOMContentLoaded', function() {
    // Watch for React error overlay 
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.addedNodes) {
          mutation.addedNodes.forEach(function(node) {
            // Look for React error overlay
            if (node.nodeType === 1 && 
                (node.classList.contains('react-error-overlay') || 
                (node.id && node.id.includes('error')))) {
              console.log('Detected React error overlay, redirecting to emergency page');
              
              // If we're not already on an emergency page, redirect
              if (!window.location.href.includes('zero-config') && 
                  !window.location.href.includes('emergency-reset') &&
                  !window.location.href.includes('minimal-fix')) {
                window.location.href = '/zero-config.html?from-error=true';
              }
            }
          });
        }
      });
    });
    
    // Start observing the body for error overlays
    observer.observe(document.body, { childList: true, subtree: true });
    
    // Also listen for errors
    window.addEventListener('error', function(event) {
      console.log('Global error caught:', event.message);
      
      // Don't redirect if we're already on an emergency page
      if (!window.location.href.includes('zero-config') && 
          !window.location.href.includes('emergency-reset') &&
          !window.location.href.includes('minimal-fix')) {
        
        // Store the error for debugging
        try {
          localStorage.setItem('last_error', JSON.stringify({
            message: event.message,
            url: event.filename,
            line: event.lineno,
            column: event.colno,
            timestamp: new Date().toISOString()
          }));
        } catch(e) {
          // Ignore storage errors
        }
        
        // If we have multiple errors in a short time, redirect
        const errorCount = parseInt(sessionStorage.getItem('error_count') || '0') + 1;
        sessionStorage.setItem('error_count', errorCount.toString());
        
        if (errorCount > 3) {
          console.log('Multiple errors detected, redirecting to emergency page');
          window.location.href = '/zero-config.html?from-error=true';
          event.preventDefault();
          return false;
        }
      }
    });
    
    console.log('Error override setup complete');
  });
})();