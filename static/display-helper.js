// Display Helper for External Display Management
(function() {
  console.log('🖥️ Display Helper v1.0 initializing...');
  
  // Apply display settings from localStorage
  function applyDisplaySettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('coffee_barista_settings') || '{}');
      const body = document.body;
      const html = document.documentElement;
      
      // Apply display type
      const displayType = settings.displayType || 'ipad';
      body.className = body.className.replace(/display-type-\w+/g, '');
      body.classList.add(`display-type-${displayType}`);
      
      // Apply zoom level
      const zoom = settings.displayZoom || 100;
      body.className = body.className.replace(/zoom-\d+/g, '');
      body.classList.add(`zoom-${zoom}`);
      
      // Apply resolution
      const resolution = settings.displayResolution || 'auto';
      if (resolution !== 'auto') {
        body.className = body.className.replace(/resolution-\w+/g, '');
        body.classList.add(`resolution-${resolution}`);
      }
      
      // Apply theme
      const theme = settings.displayTheme || 'light';
      body.className = body.className.replace(/display-theme-\w+/g, '');
      body.classList.add(`display-theme-${theme}`);
      
      // Apply layout
      const layout = settings.displayLayout || 'grid';
      body.className = body.className.replace(/display-layout-\w+/g, '');
      body.classList.add(`display-layout-${layout}`);
      
      // Apply font size
      const fontSize = settings.displayFontSize || 'medium';
      body.className = body.className.replace(/font-size-\w+/g, '');
      body.classList.add(`font-size-${fontSize}`);
      
      // Apply auto-rotate
      if (settings.autoRotateExternal !== false) {
        body.classList.add('auto-rotate');
      } else {
        body.classList.remove('auto-rotate');
      }
      
      // Apply external display mode
      const externalMode = settings.externalDisplayMode || 'mirror';
      body.className = body.className.replace(/external-display-mode-\w+/g, '');
      body.classList.add(`external-display-mode-${externalMode}`);
      
      console.log(`📱 Display configured: ${displayType} at ${zoom}% zoom, ${theme} theme`);
      
      // Auto-detect resolution if set to auto
      if (resolution === 'auto') {
        detectAndApplyResolution();
      }
      
    } catch (e) {
      console.error('Error applying display settings:', e);
    }
  }
  
  // Auto-detect screen resolution
  function detectAndApplyResolution() {
    const width = window.screen.width;
    const height = window.screen.height;
    const pixelRatio = window.devicePixelRatio || 1;
    
    const actualWidth = width * pixelRatio;
    const actualHeight = height * pixelRatio;
    
    let detectedResolution = 'auto';
    
    if (actualWidth >= 3840 && actualHeight >= 2160) {
      detectedResolution = '4k';
    } else if (actualWidth >= 2560 && actualHeight >= 1440) {
      detectedResolution = '1440p';
    } else if (actualWidth >= 1920 && actualHeight >= 1080) {
      detectedResolution = '1080p';
    }
    
    if (detectedResolution !== 'auto') {
      document.body.classList.add(`resolution-${detectedResolution}`);
      console.log(`🔍 Auto-detected resolution: ${detectedResolution} (${actualWidth}x${actualHeight})`);
    }
  }
  
  // Handle orientation changes
  function handleOrientationChange() {
    // Apply orientation-specific classes
    if (window.innerHeight > window.innerWidth) {
      document.body.classList.add('orientation-portrait');
      document.body.classList.remove('orientation-landscape');
    } else {
      document.body.classList.add('orientation-landscape');
      document.body.classList.remove('orientation-portrait');
    }
    
    console.log(`📱 Orientation: ${window.innerHeight > window.innerWidth ? 'Portrait' : 'Landscape'}`);
  }
  
  // Monitor for settings changes
  function watchForSettingsChanges() {
    // Re-apply settings when localStorage changes
    window.addEventListener('storage', (e) => {
      if (e.key === 'coffee_barista_settings') {
        console.log('⚙️ Display settings updated, reapplying...');
        applyDisplaySettings();
      }
    });
    
    // Also check periodically in case of same-tab updates
    setInterval(() => {
      applyDisplaySettings();
    }, 5000);
  }
  
  // Fullscreen toggle for external displays
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.log(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }
  
  // Keyboard shortcuts for display control
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + F for fullscreen
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
      
      // Ctrl/Cmd + Plus/Minus for zoom
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        adjustZoom(10);
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        adjustZoom(-10);
      }
      
      // Ctrl/Cmd + 0 to reset zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        resetZoom();
      }
    });
  }
  
  function adjustZoom(delta) {
    try {
      const settings = JSON.parse(localStorage.getItem('coffee_barista_settings') || '{}');
      const currentZoom = settings.displayZoom || 100;
      const newZoom = Math.max(50, Math.min(200, currentZoom + delta));
      
      settings.displayZoom = newZoom;
      localStorage.setItem('coffee_barista_settings', JSON.stringify(settings));
      applyDisplaySettings();
      
      console.log(`🔍 Zoom adjusted to ${newZoom}%`);
    } catch (e) {
      console.error('Error adjusting zoom:', e);
    }
  }
  
  function resetZoom() {
    try {
      const settings = JSON.parse(localStorage.getItem('coffee_barista_settings') || '{}');
      settings.displayZoom = 100;
      localStorage.setItem('coffee_barista_settings', JSON.stringify(settings));
      applyDisplaySettings();
      
      console.log('🔍 Zoom reset to 100%');
    } catch (e) {
      console.error('Error resetting zoom:', e);
    }
  }
  
  // Display diagnostic info
  function showDisplayInfo() {
    const info = {
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      orientation: window.innerHeight > window.innerWidth ? 'Portrait' : 'Landscape',
      fullscreen: !!document.fullscreenElement
    };
    
    console.table(info);
    return info;
  }
  
  // Initialize
  function init() {
    applyDisplaySettings();
    handleOrientationChange();
    watchForSettingsChanges();
    setupKeyboardShortcuts();
    
    // Handle orientation changes
    window.addEventListener('orientationchange', () => {
      setTimeout(handleOrientationChange, 100);
    });
    
    window.addEventListener('resize', handleOrientationChange);
    
    console.log('✅ Display Helper ready!');
    console.log('💡 Keyboard shortcuts: Ctrl+F (fullscreen), Ctrl+/- (zoom), Ctrl+0 (reset)');
  }
  
  // Expose API
  window.displayHelper = {
    applySettings: applyDisplaySettings,
    toggleFullscreen: toggleFullscreen,
    adjustZoom: adjustZoom,
    resetZoom: resetZoom,
    showInfo: showDisplayInfo,
    init: init
  };
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();