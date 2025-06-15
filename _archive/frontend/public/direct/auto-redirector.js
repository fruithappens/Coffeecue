/**
 * Auto Redirector
 * This script detects when the main application is taking too long to load or has failed,
 * and redirects to the appropriate fallback page.
 */
(function() {
  console.log('🔄 Auto redirector starting...');
  
  // Skip if we're already on a fallback page
  if (window.location.pathname.includes('test.html') ||
      window.location.pathname.includes('minimal-fix.html') ||
      window.location.pathname.includes('emergency-reset.html') ||
      window.location.pathname.includes('zero-config.html') ||
      window.location.pathname.includes('ultra-fallback.html')) {
    console.log('Already on a fallback page, skipping redirector');
    return;
  }
  
  // Flag to track if the app loaded successfully
  let appLoaded = false;
  
  // We'll check for React's root element to determine if the app has started properly
  function checkAppLoaded() {
    const rootElement = document.getElementById('root');
    if (rootElement && rootElement.children && rootElement.children.length > 0) {
      console.log('App has loaded content in the root element');
      appLoaded = true;
      return true;
    }
    return false;
  }
  
  // Start checking if the app loads
  setTimeout(function() {
    if (!appLoaded && !checkAppLoaded()) {
      console.log('App taking too long to load, preparing to redirect...');
      
      // Show an overlay to let the user know what's happening
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0,0,0,0.8)';
      overlay.style.color = 'white';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '999999';
      overlay.style.padding = '20px';
      overlay.style.textAlign = 'center';
      overlay.style.fontFamily = 'sans-serif';
      
      overlay.innerHTML = `
        <h2 style="margin-top: 0;">Loading Taking Too Long</h2>
        <p>The Coffee Cue application is taking too long to load or has encountered an error.</p>
        <p>Redirecting to fallback interface in <span id="countdown">5</span> seconds...</p>
        <div style="margin-top: 20px;">
          <button id="cancel-redirect" style="padding: 10px 15px; margin-right: 10px; background: transparent; color: white; border: 1px solid white; cursor: pointer;">Cancel Redirect</button>
          <button id="redirect-now" style="padding: 10px 15px; background: white; color: black; border: none; cursor: pointer;">Go Now</button>
        </div>
      `;
      
      document.body.appendChild(overlay);
      
      // Countdown timer
      let count = 5;
      const countdownElement = document.getElementById('countdown');
      
      const interval = setInterval(function() {
        count--;
        if (countdownElement) {
          countdownElement.textContent = count;
        }
        
        if (count <= 0) {
          clearInterval(interval);
          redirectToFallback();
        }
      }, 1000);
      
      // Add event listeners to buttons
      const cancelButton = document.getElementById('cancel-redirect');
      if (cancelButton) {
        cancelButton.addEventListener('click', function() {
          clearInterval(interval);
          document.body.removeChild(overlay);
        });
      }
      
      const redirectButton = document.getElementById('redirect-now');
      if (redirectButton) {
        redirectButton.addEventListener('click', function() {
          clearInterval(interval);
          redirectToFallback();
        });
      }
    }
  }, 5000); // Check after 5 seconds
  
  // Function to redirect to the appropriate fallback page
  function redirectToFallback() {
    // Choose the best fallback page
    if (navigator.onLine) {
      // If online, try the zero config fix first
      window.location.href = '/zero-config.html?timeout=true';
    } else {
      // If offline, go straight to the ultra fallback
      window.location.href = '/ultra-fallback.html?timeout=true';
    }
  }
  
  // Also set a maximum timeout in case the earlier check doesn't trigger
  setTimeout(function() {
    if (!appLoaded && !checkAppLoaded()) {
      console.log('App failed to load within maximum time, redirecting...');
      redirectToFallback();
    }
  }, 20000); // Maximum 20 seconds wait
  
  console.log('🔄 Auto redirector configured');
})();