// components/AppModeSelector.js
import React from 'react';
import { useAppMode, APP_MODES } from '../context/AppContext';
import { Database, Cloud, RefreshCw } from 'lucide-react';

/**
 * Enhanced AppModeSelector component for switching between production and demo mode
 * with improved UI and positioning
 */
const AppModeSelector = () => {
  const { 
    appMode, 
    toggleAppMode, 
    resetDemoData, 
    isDemoMode 
  } = useAppMode();

  return (
    <div className="inline-flex items-center">
      <button
        onClick={toggleAppMode}
        className={`flex items-center space-x-2 px-3 py-1 rounded font-medium ${
          isDemoMode 
            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-300' 
            : 'bg-green-100 text-green-800 hover:bg-green-200 border border-green-300'
        }`}
        title={isDemoMode ? 'Switch to production mode' : 'Switch to demo mode'}
      >
        {isDemoMode ? (
          <>
            <Database size={16} />
            <span>Demo Mode</span>
          </>
        ) : (
          <>
            <Cloud size={16} />
            <span>Online</span>
          </>
        )}
      </button>
      
      {isDemoMode && (
        <button
          onClick={resetDemoData}
          className="ml-2 p-1 text-amber-800 hover:bg-amber-200 rounded border border-amber-300"
          title="Reset demo data to initial values"
        >
          <RefreshCw size={16} />
        </button>
      )}
    </div>
  );
};

export default AppModeSelector;