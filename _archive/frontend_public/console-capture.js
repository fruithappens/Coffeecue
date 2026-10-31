// Console log capture script
(function() {
  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  
  // Function to send log to server
  function sendLogToServer(level, args) {
    try {
      const logData = {
        timestamp: new Date().toISOString(),
        level: level,
        message: Array.from(args).map(arg => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
          } catch (e) {
            return 'Unstringifiable value';
          }
        }).join(' '),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      
      // Send log to our log server
      fetch('http://localhost:3033/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(logData),
        // Use no-cors mode to avoid CORS issues during testing
        mode: 'no-cors'
      }).catch(e => {
        // If logging server is down, we don't want to create a loop
        originalLog('Failed to send log to server:', e);
      });
    } catch (e) {
      // Don't let logging break the application
      originalLog('Error in log capture:', e);
    }
  }
  
  // Override console methods
  console.log = function() {
    sendLogToServer('log', arguments);
    originalLog.apply(console, arguments);
  };
  
  console.error = function() {
    sendLogToServer('error', arguments);
    originalError.apply(console, arguments);
  };
  
  console.warn = function() {
    sendLogToServer('warn', arguments);
    originalWarn.apply(console, arguments);
  };
  
  console.info = function() {
    sendLogToServer('info', arguments);
    originalInfo.apply(console, arguments);
  };
  
  // Add to window.onerror to catch uncaught exceptions
  window.addEventListener('error', function(event) {
    sendLogToServer('uncaught', [
      'Uncaught error: ' + event.message,
      'at ' + event.filename + ':' + event.lineno + ':' + event.colno,
      event.error ? event.error.stack : 'No stack trace available'
    ]);
  });
  
  // Report successful setup
  console.log('Console log capture initialized. Logs will be sent to localhost:3033/log');
})();
