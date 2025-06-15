/**
 * Spinner Buster - Aggressively removes all loading indicators and spinners
 * This script actively hunts for and destroys any spinners or loading indicators
 */
(function() {
  console.log('🔄 Initializing spinner buster...');
  
  // List of classes and attributes that might indicate a spinner
  const spinnerIndicators = [
    'spinner', 'loader', 'loading', 'progress', 'circular', 
    'rotating', 'spin', 'wait', 'busy', 'activity', 'throbber',
    'preloader', 'processing', 'animated', 'pulsate', 'pulse'
  ];
  
  // Create a robust selector for spinners
  const spinnerSelector = [
    // Class-based selectors
    ...spinnerIndicators.map(s => `.${s}`),
    ...spinnerIndicators.map(s => `[class*="${s}"]`),
    
    // Role-based selectors
    '[role="progressbar"]',
    '[role="status"][aria-busy="true"]',
    
    // Animation-related selectors
    '[style*="animation"]',
    '[style*="rotate"]',
    '[style*="spin"]',
    
    // ARIA attributes
    '[aria-busy="true"]',
    '[aria-live="polite"]'
  ].join(',');
  
  // Function to hide spinners
  function hideSpinners() {
    const spinners = document.querySelectorAll(spinnerSelector);
    
    spinners.forEach(spinner => {
      // Hide the spinner
      spinner.style.display = 'none';
      spinner.style.visibility = 'hidden';
      spinner.style.opacity = '0';
      spinner.style.animation = 'none';
      spinner.style.transition = 'none';
      
      // Stop animations
      spinner.getAnimations?.().forEach(animation => animation.cancel());
      
      // Remove animation classes that might be added later
      const classList = Array.from(spinner.classList);
      classList.forEach(className => {
        if (spinnerIndicators.some(indicator => 
            className.toLowerCase().includes(indicator.toLowerCase()))) {
          spinner.classList.remove(className);
        }
      });
      
      // Add a class to mark as processed (to avoid repetitive work)
      spinner.classList.add('spinner-busted');
    });
    
    // Also inject CSS to prevent any future spinners
    if (!document.getElementById('anti-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'anti-spinner-styles';
      style.innerHTML = `
        ${spinnerSelector}:not(.spinner-busted) {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          animation: none !important;
          transition: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  // Function to show content
  function showContent() {
    // Find main content areas
    const contentContainers = document.querySelectorAll('.main-content, .content, main, [role="main"], .container, .app-container, #root > div');
    
    contentContainers.forEach(container => {
      if (container) {
        container.style.visibility = 'visible';
        container.style.opacity = '1';
        container.style.display = 'block';
      }
    });
    
    // Find data-related elements that should be visible
    const dataElements = document.querySelectorAll('table, .orders, .order-list, .stations, .station-list, .inventory, .stock-list');
    
    dataElements.forEach(element => {
      if (element) {
        element.style.visibility = 'visible';
        element.style.opacity = '1';
        element.style.display = '';
      }
    });
  }
  
  // Run spinner buster repeatedly
  let runCount = 0;
  const maxRuns = 50; // Limit the number of runs to avoid performance issues
  
  function runSpinnerBuster() {
    hideSpinners();
    showContent();
    
    runCount++;
    if (runCount < maxRuns) {
      setTimeout(runSpinnerBuster, 200); // Run again after 200ms
    }
  }
  
  // Start immediately
  runSpinnerBuster();
  
  // Also run on document ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    runSpinnerBuster();
  } else {
    document.addEventListener('DOMContentLoaded', runSpinnerBuster);
  }
  
  // Run after window load too
  window.addEventListener('load', runSpinnerBuster);
  
  // Also monitor for DOM changes to catch dynamically added spinners
  if (window.MutationObserver) {
    const observer = new MutationObserver((mutations) => {
      hideSpinners();
    });
    
    // Observe the entire document for changes
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
  
  console.log('✅ Spinner buster initialized');
})();