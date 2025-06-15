// SystemModeToggle.js
import React, { useState } from 'react';
import { AlertTriangle, Info, Play, PauseCircle, RefreshCw, Clock } from 'lucide-react';
import { useAppMode, APP_MODES } from '../context/AppContext';

const SystemModeToggle = () => {
  // Use the AppContext to get and set the application mode
  const { appMode, setAppMode, toggleAppMode, resetDemoData, isDemoMode } = useAppMode();
  
  // Local component state
  const [demoSpeed, setDemoSpeed] = useState('normal');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [targetMode, setTargetMode] = useState(null);
  const [demoSimulationActive, setDemoSimulationActive] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  
  // Demo settings
  const [demoSettings, setDemoSettings] = useState({
    orderFrequency: 'medium', // low, medium, high
    includeVipOrders: true,
    includeBatchOrders: true,
    simulateStockShortages: true,
    simulateRushPeriods: true,
    simulateEquipmentIssues: false,
    simulateStaffMessages: true
  });

  // Load saved demo settings
  React.useEffect(() => {
    // Load saved demo settings if available
    const savedSettings = localStorage.getItem('demoSettings');
    if (savedSettings) {
      setDemoSettings(JSON.parse(savedSettings));
    }
    
    const savedSpeed = localStorage.getItem('demoSpeed') || 'normal';
    setDemoSpeed(savedSpeed);
  }, []);

  // Handle mode change with confirmation
  const handleModeChange = (newMode) => {
    // Don't show confirmation if already in that mode
    if ((newMode === 'live' && appMode === APP_MODES.PRODUCTION) || 
        (newMode === 'demo' && appMode === APP_MODES.DEMO)) return;
    
    setTargetMode(newMode);
    setShowConfirmDialog(true);
  };

  // Confirm mode change after password verification
  const confirmModeChange = () => {
    // In a real app, this would validate against the server
    if (adminPassword !== 'admin123') {
      setPasswordError(true);
      return;
    }
    
    // Clear any errors
    setPasswordError(false);
    
    // Set the new app mode using AppContext
    setAppMode(targetMode === 'live' ? APP_MODES.PRODUCTION : APP_MODES.DEMO);
    
    // Reset the dialog
    setShowConfirmDialog(false);
    setTargetMode(null);
    setAdminPassword('');
    
    // If switching to demo mode, start simulation automatically
    if (targetMode === 'demo') {
      // Add a short delay before starting simulation
      setTimeout(() => {
        startDemoSimulation();
      }, 500);
    } else {
      // If switching to live mode, stop any active simulation
      stopDemoSimulation();
    }
    
    // Show success alert
    alert(`System switched to ${targetMode === 'live' ? 'LIVE' : 'DEMO'} mode`);
  };

  // Save demo settings
  const saveDemoSettings = () => {
    localStorage.setItem('demoSettings', JSON.stringify(demoSettings));
    localStorage.setItem('demoSpeed', demoSpeed);
    alert('Demo settings saved successfully');
  };

  // Start demo simulation
  const startDemoSimulation = () => {
    if (appMode !== APP_MODES.DEMO) {
      alert('Please switch to Demo mode first');
      return;
    }
    
    setDemoSimulationActive(true);
    
    // This would trigger events in a real implementation
    // Here we'll just simulate with a console log
    console.log('Starting demo simulation with settings:', demoSettings);
    
    // Example of how the simulation would work
    const orderInterval = getOrderIntervalFromFrequency(demoSettings.orderFrequency);
    
    // In a real implementation, this would dispatch events to a demo data service
    // that would generate fake orders, stock changes, messages etc.
    alert(`Demo simulation started! Orders will be simulated every ${orderInterval} seconds.`);
  };

  // Stop demo simulation
  const stopDemoSimulation = () => {
    setDemoSimulationActive(false);
    console.log('Stopping demo simulation');
    
    // In a real implementation, this would stop the demo event generators
    alert('Demo simulation stopped');
  };

  // Helper to convert frequency setting to actual interval
  const getOrderIntervalFromFrequency = (frequency) => {
    // These would be adjusted by the demoSpeed as well
    const speedMultiplier = demoSpeed === 'fast' ? 0.5 : 
                           demoSpeed === 'slow' ? 2 : 1;
    
    switch (frequency) {
      case 'low':
        return 120 * speedMultiplier; // 2 minutes in normal speed
      case 'medium':
        return 60 * speedMultiplier; // 1 minute in normal speed
      case 'high':
        return 30 * speedMultiplier; // 30 seconds in normal speed
      default:
        return 60 * speedMultiplier;
    }
  };

  // Reset demo data
  const handleResetDemoData = () => {
    if (window.confirm('Are you sure you want to reset all demo data? This will clear all simulated orders, messages, and stock levels.')) {
      // Call the resetDemoData function from the AppContext
      resetDemoData();
      
      console.log('Resetting demo data');
      alert('Demo data has been reset');
      
      // If simulation is active, restart it
      if (demoSimulationActive) {
        stopDemoSimulation();
        startDemoSimulation();
      }
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-2xl font-bold mb-6 flex items-center">
        System Mode Control
        {appMode === APP_MODES.PRODUCTION ? (
          <span className="ml-2 bg-green-100 text-green-800 text-sm px-2 py-1 rounded">LIVE</span>
        ) : (
          <span className="ml-2 bg-orange-100 text-orange-800 text-sm px-2 py-1 rounded">DEMO</span>
        )}
      </h2>
      
      {/* Warning banner */}
      <div className={`mb-6 p-3 rounded-md ${appMode === APP_MODES.PRODUCTION ? 'bg-green-50 border border-green-200' : 'bg-orange-50 border border-orange-200'}`}>
        <div className="flex items-start">
          {appMode === APP_MODES.PRODUCTION ? (
            <Info className="text-green-500 mt-0.5 mr-2 flex-shrink-0" size={20} />
          ) : (
            <AlertTriangle className="text-orange-500 mt-0.5 mr-2 flex-shrink-0" size={20} />
          )}
          <div>
            <p className="font-medium">
              {appMode === APP_MODES.PRODUCTION 
                ? 'System is in LIVE mode' 
                : 'System is in DEMO mode - No real orders are being processed'}
            </p>
            <p className="text-sm mt-1">
              {appMode === APP_MODES.PRODUCTION
                ? 'All order data is real. Changes will affect actual customer orders.'
                : 'This is a simulated environment. All orders and data are fake for demonstration and training purposes.'}
            </p>
          </div>
        </div>
      </div>
      
      {/* Mode toggle buttons */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button 
          className={`p-4 rounded-md flex flex-col items-center justify-center border-2 ${
            appMode === APP_MODES.PRODUCTION 
              ? 'border-green-500 bg-green-50' 
              : 'border-gray-200 hover:border-green-300 hover:bg-green-50'
          }`}
          onClick={() => handleModeChange('live')}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 ${
            appMode === APP_MODES.PRODUCTION ? 'bg-green-500 text-white' : 'bg-gray-200'
          }`}>
            <Play fill="currentColor" size={24} />
          </div>
          <span className="font-medium">LIVE Mode</span>
          <span className="text-xs text-gray-500 mt-1">Process real customer orders</span>
        </button>
        
        <button 
          className={`p-4 rounded-md flex flex-col items-center justify-center border-2 ${
            appMode === APP_MODES.DEMO 
              ? 'border-orange-500 bg-orange-50' 
              : 'border-gray-200 hover:border-orange-300 hover:bg-orange-50'
          }`}
          onClick={() => handleModeChange('demo')}
        >
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 ${
            appMode === APP_MODES.DEMO ? 'bg-orange-500 text-white' : 'bg-gray-200'
          }`}>
            <PauseCircle fill="currentColor" size={24} />
          </div>
          <span className="font-medium">DEMO Mode</span>
          <span className="text-xs text-gray-500 mt-1">Simulated environment for training</span>
        </button>
      </div>
      
      {/* Demo mode settings */}
      {appMode === APP_MODES.DEMO && (
        <div className="mt-8">
          <h3 className="text-lg font-medium mb-4">Demo Settings</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Order Frequency
              </label>
              <select 
                className="w-full p-2 border rounded-md"
                value={demoSettings.orderFrequency}
                onChange={(e) => setDemoSettings({...demoSettings, orderFrequency: e.target.value})}
              >
                <option value="low">Low (1 order every 2 minutes)</option>
                <option value="medium">Medium (1 order per minute)</option>
                <option value="high">High (2 orders per minute)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Simulation Speed
              </label>
              <select 
                className="w-full p-2 border rounded-md"
                value={demoSpeed}
                onChange={(e) => setDemoSpeed(e.target.value)}
              >
                <option value="slow">Slow (Half Speed)</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast (Double Speed)</option>
              </select>
            </div>
          </div>
          
          <div className="space-y-3 mb-6">
            <div className="flex items-center">
              <input 
                type="checkbox" 
                id="includeVipOrders"
                checked={demoSettings.includeVipOrders}
                onChange={(e) => setDemoSettings({...demoSettings, includeVipOrders: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="includeVipOrders">Include VIP orders</label>
            </div>
            
            <div className="flex items-center">
              <input 
                type="checkbox" 
                id="includeBatchOrders"
                checked={demoSettings.includeBatchOrders}
                onChange={(e) => setDemoSettings({...demoSettings, includeBatchOrders: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="includeBatchOrders">Include batch orders</label>
            </div>
            
            <div className="flex items-center">
              <input 
                type="checkbox"
                id="simulateStockShortages"
                checked={demoSettings.simulateStockShortages}
                onChange={(e) => setDemoSettings({...demoSettings, simulateStockShortages: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="simulateStockShortages">Simulate stock shortages</label>
            </div>
            
            <div className="flex items-center">
              <input 
                type="checkbox"
                id="simulateRushPeriods"
                checked={demoSettings.simulateRushPeriods}
                onChange={(e) => setDemoSettings({...demoSettings, simulateRushPeriods: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="simulateRushPeriods">Simulate rush periods</label>
            </div>
            
            <div className="flex items-center">
              <input 
                type="checkbox"
                id="simulateEquipmentIssues"
                checked={demoSettings.simulateEquipmentIssues}
                onChange={(e) => setDemoSettings({...demoSettings, simulateEquipmentIssues: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="simulateEquipmentIssues">Simulate equipment issues</label>
            </div>
            
            <div className="flex items-center">
              <input 
                type="checkbox"
                id="simulateStaffMessages"
                checked={demoSettings.simulateStaffMessages}
                onChange={(e) => setDemoSettings({...demoSettings, simulateStaffMessages: e.target.checked})}
                className="mr-2"
              />
              <label htmlFor="simulateStaffMessages">Simulate staff messages</label>
            </div>
          </div>
          
          <div className="flex space-x-3 mt-6">
            <button 
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 flex items-center"
              onClick={saveDemoSettings}
            >
              Save Settings
            </button>
            
            {demoSimulationActive ? (
              <button 
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 flex items-center"
                onClick={stopDemoSimulation}
              >
                Stop Simulation
              </button>
            ) : (
              <button 
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center"
                onClick={startDemoSimulation}
              >
                <Play size={18} className="mr-1" />
                Start Simulation
              </button>
            )}
            
            <button 
              className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 flex items-center"
              onClick={handleResetDemoData}
            >
              <RefreshCw size={18} className="mr-1" />
              Reset Demo Data
            </button>
          </div>
        </div>
      )}
      
      {/* Confirmation dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4">Confirm Mode Change</h3>
            
            <div className="mb-6">
              <div className="flex items-center mb-4">
                <AlertTriangle className="text-yellow-500 mr-2" size={20} />
                <p className="font-medium">
                  Are you sure you want to switch to {targetMode === 'live' ? 'LIVE' : 'DEMO'} mode?
                </p>
              </div>
              
              <p className="text-sm text-gray-600 mb-4">
                {targetMode === 'live' 
                  ? 'Switching to LIVE mode will disable all simulations and connect to real order systems.'
                  : 'Switching to DEMO mode will disconnect from real order systems. No real orders will be processed.'}
              </p>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enter administrator password to confirm
                </label>
                <input 
                  type="password" 
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    setPasswordError(false);
                  }}
                  className={`w-full p-2 border rounded-md ${passwordError ? 'border-red-500' : ''}`}
                />
                {passwordError && (
                  <p className="text-red-500 text-xs mt-1">Invalid password</p>
                )}
              </div>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button 
                className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
                onClick={() => {
                  setShowConfirmDialog(false);
                  setTargetMode(null);
                  setAdminPassword('');
                  setPasswordError(false);
                }}
              >
                Cancel
              </button>
              <button 
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                onClick={confirmModeChange}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemModeToggle;