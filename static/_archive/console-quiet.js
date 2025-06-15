/**
 * Simple Console Quieter - Reduces excessive console logging
 */
(function() {
  // Store original console methods
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  
  // Simple message tracking
  const recentMessages = {};
  const MAX_REPEAT = 3;
  
  // Safe version that avoids recursion
  console.log = function() {
    try {
      // Convert to simple string to avoid recursion
      let key = '';
      for (let i = 0; i < arguments.length; i++) {
        const arg = arguments[i];
        if (arg === null) key += 'null';
        else if (arg === undefined) key += 'undefined';
        else if (typeof arg === 'object') key += '{obj}';
        else key += String(arg);
        if (i < arguments.length - 1) key += ' ';
      }
      
      // Trim to avoid huge strings
      if (key.length > 100) {
        key = key.substring(0, 100);
      }
      
      // Track message count
      if (!recentMessages[key]) {
        recentMessages[key] = { count: 1, last: Date.now() };
        return originalLog.apply(console, arguments);
      } else {
        recentMessages[key].count++;
        recentMessages[key].last = Date.now();
        
        // Only log a few times
        if (recentMessages[key].count <= MAX_REPEAT) {
          return originalLog.apply(console, arguments);
        }
        // Let the user know we're suppressing
        else if (recentMessages[key].count === MAX_REPEAT + 1) {
          return originalLog.call(console, "🔇 Suppressing repeated logs: " + key);
        }
        return;
      }
    } catch (e) {
      // In case of error, revert to original to avoid breaking everything
      return originalLog.apply(console, arguments);
    }
  };
  
  // Simpler implementation for other console methods
  ['warn', 'error', 'info', 'debug'].forEach(method => {
    console[method] = function() {
      try {
        // Use same approach as for console.log
        let key = method + ':';
        for (let i = 0; i < arguments.length; i++) {
          const arg = arguments[i];
          if (arg === null) key += 'null';
          else if (arg === undefined) key += 'undefined';
          else if (typeof arg === 'object') key += '{obj}';
          else key += String(arg);
          if (i < arguments.length - 1) key += ' ';
        }
        
        if (key.length > 100) {
          key = key.substring(0, 100);
        }
        
        if (!recentMessages[key]) {
          recentMessages[key] = { count: 1, last: Date.now() };
          return method === 'error' ? originalError.apply(console, arguments) :
                 method === 'warn' ? originalWarn.apply(console, arguments) :
                 method === 'info' ? originalInfo.apply(console, arguments) :
                 method === 'debug' ? originalDebug.apply(console, arguments) :
                 originalLog.apply(console, arguments);
        } else {
          recentMessages[key].count++;
          recentMessages[key].last = Date.now();
          
          if (recentMessages[key].count <= MAX_REPEAT) {
            return method === 'error' ? originalError.apply(console, arguments) :
                   method === 'warn' ? originalWarn.apply(console, arguments) :
                   method === 'info' ? originalInfo.apply(console, arguments) :
                   method === 'debug' ? originalDebug.apply(console, arguments) :
                   originalLog.apply(console, arguments);
          }
          return;
        }
      } catch (e) {
        // Fallback
        return originalLog.apply(console, arguments);
      }
    };
  });
  
  // Clean up old messages every 30 seconds
  setInterval(function() {
    const now = Date.now();
    for (const key in recentMessages) {
      if (now - recentMessages[key].last > 30000) {
        delete recentMessages[key];
      }
    }
  }, 30000);
  
  // Log initialization
  originalLog.call(console, "✅ Console quieter initialized");
})();