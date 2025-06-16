// components/ApiDebugPanel.js
import React, { useState } from 'react';
import { useAppMode, APP_MODES } from '../context/AppContext';

/**
 * Debug panel for API connectivity testing and diagnostics
 * This should only be visible during development
 */
const ApiDebugPanel = ({ className = '' }) => {
  const { appMode, setAppMode } = useAppMode();
  const [isExpanded, setIsExpanded] = useState(false);
  const [testResults, setTestResults] = useState({});
  const [endpoint, setEndpoint] = useState('/api/test');
  const [isPending, setIsPending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('unknown');
  const [logs, setLogs] = useState([]);

  // Add a log entry
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toISOString().split('T')[1].substring(0, 8);
    // Use a more unique ID with additional randomness to prevent duplicate keys
    const uniqueId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setLogs(prev => [{
      id: uniqueId,
      timestamp,
      message,
      type
    }, ...prev].slice(0, 50)); // Keep only last 50 logs
  };

  // Test API connection
  const testConnection = async () => {
    setIsPending(true);
    addLog(`Testing API connection to ${endpoint}...`);
    
    try {
      // Use direct absolute URL if testing the API
      let url = endpoint;
      if (endpoint.startsWith('/api/')) {
        url = `${process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5001'}${endpoint}`;
        addLog(`Using direct URL: ${url}`, 'info');
      }
      
      const response = await fetch(url);
      const status = response.status;
      
      if (response.ok) {
        try {
          const data = await response.json();
          setTestResults({ status, data });
          setConnectionStatus('connected');
          addLog(`Connection successful: ${status}`, 'success');
        } catch (parseError) {
          const text = await response.text();
          setTestResults({ status, text });
          setConnectionStatus('connected');
          addLog(`Connection successful, but response is not JSON: ${text.substring(0, 100)}`, 'warning');
        }
      } else {
        setTestResults({ status, error: `HTTP error ${status}` });
        setConnectionStatus('error');
        addLog(`Connection error: ${status}`, 'error');
      }
    } catch (error) {
      setTestResults({ error: error.message });
      setConnectionStatus('disconnected');
      addLog(`Connection failed: ${error.message}`, 'error');
    } finally {
      setIsPending(false);
    }
  };

  // Toggle between demo and production modes
  const handleModeToggle = () => {
    const newMode = appMode === APP_MODES.PRODUCTION 
      ? APP_MODES.DEMO 
      : APP_MODES.PRODUCTION;
    
    setAppMode(newMode);
    addLog(`Switched to ${newMode} mode`, 'info');
    
    // When switching to production mode, clear localStorage and reload the page
    // to ensure all mock data is cleared from memory
    if (newMode === APP_MODES.PRODUCTION) {
      addLog('Clearing cache and reloading application...', 'info');
      
      // Use a slight delay to ensure the mode is properly saved
      setTimeout(() => {
        // Force a full page reload to clear any in-memory data
        window.location.reload(true);
      }, 500);
    }
  };

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared', 'info');
  };
  
  // Clear all application cache and reload
  const clearCache = () => {
    addLog('Clearing all application cache...', 'info');
    
    // Clear all localStorage items that belong to the app
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('coffee_cue')) {
        localStorage.removeItem(key);
        addLog(`Cleared: ${key}`, 'info');
      }
    });
    
    // Re-set to production mode
    localStorage.setItem('coffee_cue_app_mode', APP_MODES.PRODUCTION);
    
    addLog('Cache cleared, reloading application...', 'info');
    
    // Use a slight delay to ensure logs are displayed
    setTimeout(() => {
      // Force a full page reload
      window.location.reload(true);
    }, 1000);
  };
  
  // Reset just the schedule data
  const resetScheduleData = () => {
    addLog('Resetting schedule data to empty state...', 'info');
    
    // Clear schedule data
    localStorage.removeItem('coffee_cue_schedule');
    
    // Clear any demo_schedule data
    Object.keys(localStorage).forEach(key => {
      if (key.includes('schedule') || key.includes('demo_')) {
        localStorage.removeItem(key);
        addLog(`Cleared: ${key}`, 'info');
      }
    });
    
    // Set empty schedule data
    const emptySchedule = {
      shifts: [],
      breaks: [],
      rushPeriods: []
    };
    
    localStorage.setItem('coffee_cue_schedule', JSON.stringify(emptySchedule));
    
    addLog('Schedule data reset to empty state, reloading...', 'success');
    
    // Refresh the page to clear memory and use the new empty data
    setTimeout(() => {
      window.location.reload(true);
    }, 1000);
  };

  return (
    <div className={`api-debug-panel fixed bottom-0 right-0 bg-gray-800 text-white rounded-tl-lg shadow-lg z-50 ${className}`}>
      {/* Header */}
      <div 
        className="p-2 cursor-pointer flex justify-between items-center"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        <div className="flex items-center">
          <div 
            className={`w-2 h-2 rounded-full mr-2 ${
              connectionStatus === 'connected' ? 'bg-green-400' :
              connectionStatus === 'error' ? 'bg-yellow-400' :
              connectionStatus === 'disconnected' ? 'bg-red-400' :
              'bg-gray-400'
            }`}
          />
          <span className="font-medium text-sm">API Debug Panel</span>
        </div>
        <span className="text-xs bg-blue-600 px-1 rounded">
          {appMode === APP_MODES.PRODUCTION ? 'PRODUCTION' : 'DEMO'}
        </span>
      </div>
      
      {isExpanded && (
        <div className="p-3 border-t border-gray-700 space-y-3">
          {/* Mode toggle */}
          <div className="flex items-center space-x-2 flex-wrap">
            <button
              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded"
              onClick={handleModeToggle}
            >
              Switch to {appMode === APP_MODES.PRODUCTION ? 'Demo' : 'Production'} Mode
            </button>
            <button
              className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 rounded"
              onClick={testConnection}
              disabled={isPending}
            >
              {isPending ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 rounded"
              onClick={clearCache}
            >
              Clear Cache & Reload
            </button>
            <button
              className="px-2 py-1 text-xs bg-orange-700 hover:bg-orange-600 rounded"
              onClick={resetScheduleData}
            >
              Reset Schedule Data
            </button>
          </div>
          
          {/* Endpoint input */}
          <div className="flex items-center space-x-2">
            <label className="text-xs">Endpoint:</label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="flex-1 bg-gray-700 text-white text-xs p-1 rounded"
            />
          </div>
          
          {/* Test results */}
          {Object.keys(testResults).length > 0 && (
            <div className="bg-gray-700 p-2 rounded text-xs font-mono max-h-32 overflow-y-auto">
              <pre className="whitespace-pre-wrap">{JSON.stringify(testResults, null, 2)}</pre>
            </div>
          )}
          
          {/* Logs */}
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium">Logs</span>
              <button
                className="text-xs text-gray-400 hover:text-white"
                onClick={clearLogs}
              >
                Clear
              </button>
            </div>
            <div className="bg-gray-900 p-2 rounded text-xs font-mono max-h-32 overflow-y-auto">
              {logs.map(log => (
                <div 
                  key={log.id}
                  className={`
                    mb-1 
                    ${log.type === 'error' ? 'text-red-400' : 
                     log.type === 'warning' ? 'text-yellow-400' : 
                     log.type === 'success' ? 'text-green-400' : 
                     'text-gray-300'}
                  `}
                >
                  <span className="text-gray-500">{log.timestamp}</span> {log.message}
                </div>
              ))}
              {logs.length === 0 && (
                <div className="text-gray-500 italic">No logs yet</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApiDebugPanel;