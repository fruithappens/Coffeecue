// context/AppContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';

// Create the context
const AppContext = createContext();

// App modes
export const APP_MODES = {
  PRODUCTION: 'production', // Real API mode
  DEMO: 'demo'              // Demo mode with mock data
};

export const AppProvider = ({ children }) => {
  // Get initial mode from localStorage or default to production
  const [appMode, setAppMode] = useState(() => {
    // Always default to PRODUCTION to ensure real data is used
    const savedMode = localStorage.getItem('coffee_cue_app_mode');
    // Force reset to production mode if demo mode was previously saved
    if (savedMode === APP_MODES.DEMO) {
      localStorage.setItem('coffee_cue_app_mode', APP_MODES.PRODUCTION);
      return APP_MODES.PRODUCTION;
    }
    return savedMode || APP_MODES.PRODUCTION;
  });
  
  // Persist mode changes to localStorage
  useEffect(() => {
    localStorage.setItem('coffee_cue_app_mode', appMode);
  }, [appMode]);
  
  // Toggle between modes
  const toggleAppMode = () => {
    setAppMode(prevMode => 
      prevMode === APP_MODES.PRODUCTION ? APP_MODES.DEMO : APP_MODES.PRODUCTION
    );
  };
  
  // Reset demo data (only relevant in demo mode)
  const resetDemoData = () => {
    if (appMode === APP_MODES.DEMO) {
      // Import MockDataService dynamically to avoid loading it in production mode
      import('../services/MockDataService').then(module => {
        const MockDataService = module.default;
        MockDataService.resetDemoData();
        
        // Force a refresh to show the reset data
        window.location.reload();
      });
    }
  };
  
  return (
    <AppContext.Provider value={{ 
      appMode, 
      setAppMode, 
      toggleAppMode,
      resetDemoData,
      isDemoMode: appMode === APP_MODES.DEMO,
      isProductionMode: appMode === APP_MODES.PRODUCTION
    }}>
      {children}
    </AppContext.Provider>
  );
};

// Custom hook for using the context
export const useAppMode = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppMode must be used within an AppProvider');
  }
  return context;
};

export default AppContext;