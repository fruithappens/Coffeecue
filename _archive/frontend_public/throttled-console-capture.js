// Throttled Console log capture script
(function() {
  // Check if logging is disabled via localStorage
  if (localStorage.getItem('disable_console_capture') === 'true') {
    console.log('Console capture is disabled by user settings');
    return; // Exit early if disabled
  }

  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  
  // Variables for throttling
  const LOG_THROTTLE_MS = 2000; // Only send logs every 2 seconds max
  const MESSAGE_BUFFER_SIZE = 20; // Maximum number of messages to keep in buffer
  let lastSendTime = 0;
  let messageBuffer = [];
  let sendTimer = null;
  
  // Function to add message to buffer
  function addToBuffer(level, args) {
    try {
      const message = Array.from(args).map(arg => {
        try {
          return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
        } catch (e) {
          return 'Unstringifiable value';
        }
      }).join(' ');
      
      // Add to buffer with timestamp
      messageBuffer.push({
        timestamp: new Date().toISOString(),
        level: level,
        message: message
      });
      
      // Limit buffer size by removing oldest messages
      if (messageBuffer.length > MESSAGE_BUFFER_SIZE) {
        messageBuffer = messageBuffer.slice(-MESSAGE_BUFFER_SIZE);
      }
      
      // Schedule sending buffer if not already scheduled
      if (!sendTimer) {
        const now = Date.now();
        const nextSendDelay = Math.max(0, LOG_THROTTLE_MS - (now - lastSendTime));
        
        sendTimer = setTimeout(() => {
          sendLogBuffer();
          sendTimer = null;
        }, nextSendDelay);
      }
    } catch (e) {
      // Don't let logging break the application
      originalLog('Error in log buffering:', e);
    }
  }
  
  // Function to send buffered logs to server
  function sendLogBuffer() {
    if (messageBuffer.length === 0) return;
    
    try {
      const logData = {
        messages: [...messageBuffer], // Make a copy
        url: window.location.href,
        userAgent: navigator.userAgent,
        batchSize: messageBuffer.length
      };
      
      // Clear buffer before sending to avoid duplicates if send fails
      messageBuffer = [];
      lastSendTime = Date.now();
      
      // Send log to our log server
      fetch('http://localhost:3033/log-batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logData),
        // Use no-cors mode to avoid CORS issues during testing
        mode: 'no-cors'
      }).catch(e => {
        // If logging server is down, we don't want to retry or create a loop
        originalLog('Failed to send logs to server, discarding batch');
      });
    } catch (e) {
      // Reset buffer in case of error
      messageBuffer = [];
      originalLog('Error in log sending:', e);
    }
  }
  
  // Check server connectivity before overriding console
  fetch('http://localhost:3033/ping', { mode: 'no-cors' })
    .then(() => {
      // If server is available, set up console overrides
      setupConsoleOverrides();
    })
    .catch(e => {
      // If server is unavailable, disable logging completely
      originalLog('Log server unavailable, console capture disabled');
      localStorage.setItem('disable_console_capture', 'true');
    });
  
  function setupConsoleOverrides() {
    // Add flag to avoid infinite recursion
    let isLogging = false;
    
    // Override console methods
    console.log = function() {
      if (isLogging) return originalLog.apply(console, arguments);
      
      isLogging = true;
      addToBuffer('log', arguments);
      originalLog.apply(console, arguments);
      isLogging = false;
    };
    
    console.error = function() {
      if (isLogging) return originalError.apply(console, arguments);
      
      isLogging = true;
      addToBuffer('error', arguments);
      originalError.apply(console, arguments);
      isLogging = false;
    };
    
    console.warn = function() {
      if (isLogging) return originalWarn.apply(console, arguments);
      
      isLogging = true;
      addToBuffer('warn', arguments);
      originalWarn.apply(console, arguments);
      isLogging = false;
    };
    
    console.info = function() {
      if (isLogging) return originalInfo.apply(console, arguments);
      
      isLogging = true;
      addToBuffer('info', arguments);
      originalInfo.apply(console, arguments);
      isLogging = false;
    };
    
    // Add window.onerror with throttling
    window.addEventListener('error', function(event) {
      if (!isLogging) {
        isLogging = true;
        addToBuffer('uncaught', [
          'Uncaught error: ' + event.message,
          'at ' + event.filename + ':' + event.lineno + ':' + event.colno,
          event.error ? event.error.stack : 'No stack trace available'
        ]);
        isLogging = false;
      }
    });
    
    // Send any remaining logs when page unloads
    window.addEventListener('beforeunload', function() {
      if (messageBuffer.length > 0) {
        sendLogBuffer();
      }
    });
    
    // Report successful setup
    console.log('Throttled console log capture initialized');
  }
  
  // Add a method to the window to toggle console capturing
  window.toggleConsoleCapture = function(enable) {
    if (enable === false || localStorage.getItem('disable_console_capture') === 'true') {
      localStorage.setItem('disable_console_capture', 'true');
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
      console.log('Console capture disabled');
    } else {
      localStorage.setItem('disable_console_capture', 'false');
      setupConsoleOverrides();
      console.log('Console capture enabled');
    }
  };
})();