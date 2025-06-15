import React, { useState, useEffect } from 'react';
import ApiService from '../services/ApiService.simplified';

/**
 * Demo Mode Toggle Component
 * 
 * A simple button to toggle demo mode for testing without a backend.
 */
const DemoModeToggle = () => {
  const [isDemoMode, setIsDemoMode] = useState(ApiService.isDemoMode());
  
  // Listen for demo mode changes from other components
  useEffect(() => {
    const handleDemoEnabled = () => setIsDemoMode(true);
    const handleDemoDisabled = () => setIsDemoMode(false);
    
    window.addEventListener('demo-mode-enabled', handleDemoEnabled);
    window.addEventListener('demo-mode-disabled', handleDemoDisabled);
    
    return () => {
      window.removeEventListener('demo-mode-enabled', handleDemoEnabled);
      window.removeEventListener('demo-mode-disabled', handleDemoDisabled);
    };
  }, []);
  
  // Toggle demo mode
  const toggleDemoMode = () => {
    const newMode = ApiService.toggleDemoMode();
    setIsDemoMode(newMode);
  };
  
  // Reset demo data
  const resetDemoData = (e) => {
    e.stopPropagation(); // Prevent triggering the toggle
    ApiService.resetDemoData();
    
    // Show toast or notification if available
    if (window.notificationSystem && window.notificationSystem.success) {
      window.notificationSystem.success('Demo data has been reset');
    } else {
      alert('Demo data has been reset');
    }
  };
  
  return (
    <div className="demo-mode-toggle p-2 mb-4 rounded shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <button 
            onClick={toggleDemoMode}
            className={`relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500 transition-colors ease-in-out duration-200 ${
              isDemoMode ? 'bg-amber-600' : 'bg-gray-200'
            }`}
            aria-pressed={isDemoMode}
          >
            <span className="sr-only">Toggle demo mode</span>
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200 ${
                isDemoMode ? 'translate-x-5' : 'translate-x-0'
              }`}
            ></span>
          </button>
          <span className="ml-2 text-sm font-medium">
            {isDemoMode ? 'Demo Mode: On' : 'Demo Mode: Off'}
          </span>
        </div>
        
        {isDemoMode && (
          <button
            onClick={resetDemoData}
            className="ml-4 px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
            title="Reset demo data to initial state"
          >
            Reset Data
          </button>
        )}
      </div>
      
      {isDemoMode && (
        <div className="mt-2 text-xs text-gray-600">
          <p>Demo mode is active. No API calls will be made.</p>
          <p>All changes are stored locally and will be lost when you exit demo mode.</p>
        </div>
      )}
    </div>
  );
};

export default DemoModeToggle;