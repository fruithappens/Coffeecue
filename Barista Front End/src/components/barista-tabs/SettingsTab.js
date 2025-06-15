// SettingsTab.js
import React from 'react';
import { Check, RefreshCw } from 'lucide-react';

const SettingsTab = ({
  settings,
  setSettings,
  isRefreshing,
  refreshData,
  autoRefreshEnabled,
  autoRefreshInterval,
  toggleAutoRefresh,
  updateAutoRefreshInterval,
  updateStation,
  selectedStation,
  stations,
  lastUpdated,
  dismissedPanels,
  dismissPanel,
  restoreAllPanels
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-4">Data Management</h2>
        <div className="mb-4">
          <p className="text-gray-600">Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Never'}</p>
        </div>
        
        <div className="mb-4">
          <label className="inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={autoRefreshEnabled} 
              onChange={toggleAutoRefresh}
              className="sr-only peer"
            />
            <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
            <span className="ml-3 text-sm font-medium text-gray-900">Auto Refresh</span>
          </label>
        </div>
        
        {autoRefreshEnabled && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Refresh Interval (seconds)
            </label>
            <div className="flex items-center">
              <input 
                type="number" 
                min="5" 
                max="300"
                value={autoRefreshInterval}
                onChange={(e) => updateAutoRefreshInterval(parseInt(e.target.value))}
                className="w-20 p-2 border rounded mr-2"
              />
              <span className="text-sm text-gray-500">
                {autoRefreshInterval < 15 ? '(Fast refresh may impact performance)' : ''}
              </span>
            </div>
          </div>
        )}
        
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-4">Station Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Station Name
            </label>
            <input 
              type="text" 
              value={settings.stationName}
              onChange={(e) => setSettings({...settings, stationName: e.target.value})}
              className="w-full p-2 border rounded"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Station Location
            </label>
            <input 
              type="text" 
              value={settings.stationLocation}
              onChange={(e) => setSettings({...settings, stationLocation: e.target.value})}
              className="w-full p-2 border rounded"
              placeholder="e.g., Main Hall, Registration Area, etc."
            />
          </div>
          
          <button
            className="mt-4 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center"
            onClick={() => {
              // Save station settings using SettingsService (standardized approach)
              try {
                // Create or update station settings structure in main settings
                const stationSettings = settings.stationSettings || {};
                stationSettings[selectedStation] = {
                  name: settings.stationName,
                  location: settings.stationLocation
                };
                
                // Update settings via SettingsService (instead of fragmented localStorage)
                setSettings({
                  ...settings,
                  stationSettings: stationSettings
                });
                
                // Also update station state if needed via StationsService
                updateStation && updateStation({
                  id: selectedStation,
                  name: settings.stationName,
                  location: settings.stationLocation
                });
                alert('Station settings saved successfully!');
              } catch (error) {
                console.error('Error saving station settings:', error);
                alert('Error saving station settings. Please try again.');
              }
            }}
          >
            <Check size={18} className="mr-1" />
            Save Station Settings
          </button>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Barista Name
            </label>
            <input 
              type="text" 
              value={settings.baristaName}
              onChange={(e) => {
                const newBaristaName = e.target.value;
                // Update barista name using standardized settings structure
                const baristaSettings = settings.baristaSettings || {};
                baristaSettings[selectedStation] = newBaristaName;
                
                setSettings({
                  ...settings, 
                  baristaName: newBaristaName,
                  baristaSettings: baristaSettings
                });
              }}
              className="w-full p-2 border rounded"
              placeholder="Your name"
            />
            <p className="text-sm text-gray-500 mt-1">
              Used for order tagging and customer communications
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-4">User Interface Settings</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Order Warning Time
            </label>
            <div className="flex items-center">
              <input 
                type="number" 
                min="1" 
                max="60"
                value={settings.waitTimeWarning}
                onChange={(e) => setSettings({...settings, waitTimeWarning: parseInt(e.target.value) || 10})}
                className="w-16 p-2 border rounded text-center mr-2"
              />
              <span>minutes</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Orders in queue longer than this will be highlighted
            </p>
          </div>
          
          <div className="flex items-center">
            <input 
              type="checkbox" 
              id="batchSuggestions"
              checked={settings.batchSuggestions}
              onChange={(e) => setSettings({...settings, batchSuggestions: e.target.checked})}
              className="mr-2"
            />
            <label htmlFor="batchSuggestions">Show batch order suggestions</label>
          </div>
          
          <div className="mt-4">
            <button 
              className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 w-full"
              onClick={restoreAllPanels}
            >
              Restore All Information Panels
            </button>
            <p className="text-sm text-gray-500 mt-1">
              Show all previously dismissed information panels
            </p>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-4">Demo Mode</h2>
        <p className="mb-4">Toggle between demo mode and live API mode.</p>
        
        <label className="inline-flex items-center cursor-pointer mb-4">
          <input 
            type="checkbox" 
            checked={settings.demoMode}
            onChange={() => {
              // Toggle demo mode in settings
              setSettings({...settings, demoMode: !settings.demoMode});
              
              // If there's an App Context provider with toggleAppMode function
              if (typeof toggleAppMode === 'function') {
                toggleAppMode();
              } else {
                // Fallback to direct localStorage manipulation
                localStorage.setItem('coffee_cue_demo_mode', !settings.demoMode ? 'true' : 'false');
                // Alert user that page reload is required
                alert('Demo mode setting changed. Page reload required to apply changes.');
              }
            }}
            className="sr-only peer"
          />
          <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
          <span className="ml-3 text-sm font-medium text-gray-900">
            Use Demo Mode
          </span>
        </label>
        
        <p className="text-sm text-gray-500">
          {settings.demoMode ? 
            'Currently using DEMO data - no API connections needed' : 
            'Currently using LIVE data - requires backend API connection'}
        </p>
        
      </div>
    </div>
  );
};

export default SettingsTab;