// src/context/AppContext.js
import React, { createContext, useContext, useState, useEffect } from 'react';

// Create the context
const AppContext = createContext();

// App modes
export const APP_MODES = {
  PRODUCTION: 'production', // Real API mode
  DEMO: 'demo'              // Demo mode with mock data
};

export const AppProvider = ({ children }) => {
  // Start in PRODUCTION mode by default
  const [appMode, setAppMode] = useState(() => {
    // Get saved mode from localStorage or default to PRODUCTION
    const savedMode = localStorage.getItem('coffee_cue_app_mode');
    return savedMode || APP_MODES.PRODUCTION;
  });
  
  // Persist mode changes to localStorage
  useEffect(() => {
    localStorage.setItem('coffee_cue_app_mode', appMode);
  }, [appMode]);
  
  // Toggle between modes
  const toggleAppMode = () => {
    const newMode = appMode === APP_MODES.PRODUCTION ? APP_MODES.DEMO : APP_MODES.PRODUCTION;
    
    // Pre-toggle: Save important data that should be preserved across mode switches
    const customStations = localStorage.getItem('coffee_cue_stations');
    const selectedStation = localStorage.getItem('coffee_cue_selected_station');
    
    // When switching to PRODUCTION mode, clear any lingering demo data from localStorage
    if (newMode === APP_MODES.PRODUCTION) {
      // Clear cached schedule data
      localStorage.removeItem('coffee_cue_schedule');
      
      // Clear other demo data from localStorage
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('coffee_cue_demo_')) {
          localStorage.removeItem(key);
        }
      });
      
      console.log('Cleared cached demo data from localStorage');
    }
    
    // Set the new mode
    setAppMode(newMode);
    
    // Post-toggle: Restore important data
    if (customStations) {
      localStorage.setItem('coffee_cue_stations', customStations);
      console.log('Restored custom stations configuration after mode toggle');
    }
    
    if (selectedStation) {
      localStorage.setItem('coffee_cue_selected_station', selectedStation);
      console.log('Restored selected station after mode toggle');
    }
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