// DisplayTab.js
import React, { useState, useEffect } from 'react';
import { Monitor, Settings, Check, QrCode, Smartphone, Eye, Palette, Layout } from 'lucide-react';

// Simple QR Code component (using a QR API service)
const QRCodeComponent = ({ url, size = 150 }) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}`;
  
  return (
    <div className="flex flex-col items-center">
      <img 
        src={qrUrl} 
        alt="QR Code for Display URL"
        className="border rounded"
        style={{ width: size, height: size }}
      />
    </div>
  );
};

// DismissibleInfoPanel component
const DismissibleInfoPanel = ({ id, title, message, borderColor, bgColor, isDismissed, onDismiss, extraContent }) => {
  if (isDismissed) return null;
  
  return (
    <div className={`mb-4 rounded-lg shadow-md p-4 border-l-4 border-${borderColor}-500 bg-${bgColor}-50`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-gray-700">{message}</p>
          {extraContent}
        </div>
        <button 
          className="text-gray-400 hover:text-gray-600" 
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const DisplayTab = ({
  dismissedPanels,
  dismissPanel,
  openDisplayScreen,
  settings,
  setSettings
}) => {
  return (
    <div className="p-4">
      {/* API Usage Notification */}
      <DismissibleInfoPanel
        id="displayInfoPanel"
        title="Display Screen Integration"
        message="The display screen currently shows demo data. It requires backend API integration for showing real-time order data."
        borderColor="amber"
        bgColor="amber"
        isDismissed={dismissedPanels.displayInfoPanel}
        onDismiss={dismissPanel}
      />
      
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <h2 className="text-xl font-bold mb-4">Display Screen Settings</h2>
        <p className="mb-4">Control what appears on the customer-facing display screen.</p>
        
        <div className="flex space-x-4 mb-4">
          <button 
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => {
              alert('The display screen currently shows demo data. Backend API integration is required for real-time order display.');
              openDisplayScreen();
            }}
          >
            Open Display Screen
          </button>
          <button 
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={() => alert('Test display feature requires backend API implementation.')}
          >
            Test Display
          </button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-medium mb-2">Display Options</h3>
            <div className="space-y-2">
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showNameOnDisplay"
                  checked={settings.showNameOnDisplay}
                  onChange={(e) => setSettings({...settings, showNameOnDisplay: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showNameOnDisplay">Show customer name on display</label>
              </div>
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showOrderDetails"
                  checked={settings.showOrderDetails !== false}
                  onChange={(e) => setSettings({...settings, showOrderDetails: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showOrderDetails">Show order details (coffee type, etc.)</label>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">Display Timeout</h3>
            <div className="flex items-center">
              <label htmlFor="displayTimeout" className="mr-2">Clear order from display after:</label>
              <input 
                type="number" 
                id="displayTimeout"
                min="1" 
                max="60"
                value={settings.displayTimeout}
                onChange={(e) => setSettings({...settings, displayTimeout: parseInt(e.target.value) || 5})}
                className="w-16 p-1 border rounded text-center"
              />
              <span className="ml-2">minutes</span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Set how long completed orders remain on the display before being removed.
            </p>
          </div>
        </div>
        
        <div className="mt-6">
          <h3 className="font-medium mb-2">Display Orientation</h3>
          <div className="flex space-x-4">
            <button 
              className={`px-4 py-2 rounded ${settings.displayMode === 'landscape' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setSettings({...settings, displayMode: 'landscape'})}
            >
              Landscape
            </button>
            <button 
              className={`px-4 py-2 rounded ${settings.displayMode === 'portrait' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setSettings({...settings, displayMode: 'portrait'})}
            >
              Portrait
            </button>
          </div>
        </div>
      </div>

      {/* Professional Display Setup Section */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <h2 className="text-xl font-bold mb-4 flex items-center">
          <Monitor size={24} className="mr-2" />
          Professional Display Setup
        </h2>
        <p className="mb-4">Configure external displays connected via iPad USB-C/Thunderbolt docks.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">📱 iPad Direct</h3>
            <p className="text-sm text-gray-600">iPad used directly as customer display</p>
            <button 
              className={`mt-2 px-3 py-1 rounded text-sm ${settings.displayType === 'ipad' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setSettings({...settings, displayType: 'ipad', displayZoom: 100})}
            >
              Select
            </button>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">🖥️ External HD/4K</h3>
            <p className="text-sm text-gray-600">iPad connected to external display via USB-C dock</p>
            <button 
              className={`mt-2 px-3 py-1 rounded text-sm ${settings.displayType === 'external' ? 'bg-green-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setSettings({...settings, displayType: 'external', displayZoom: 75})}
            >
              Select
            </button>
          </div>
          
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="font-semibold mb-2">📺 Large Display</h3>
            <p className="text-sm text-gray-600">TV/projector for large venues</p>
            <button 
              className={`mt-2 px-3 py-1 rounded text-sm ${settings.displayType === 'large' ? 'bg-purple-500 text-white' : 'bg-gray-200'}`}
              onClick={() => setSettings({...settings, displayType: 'large', displayZoom: 150})}
            >
              Select
            </button>
          </div>
        </div>
        
        {settings.displayType === 'external' && (
          <div className="bg-amber-50 p-4 rounded-lg mb-4">
            <h4 className="font-medium mb-2">🔌 External Display Configuration</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Display Output Mode</label>
                <select 
                  value={settings.externalDisplayMode || 'mirror'}
                  onChange={(e) => setSettings({...settings, externalDisplayMode: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="mirror">Mirror iPad Screen</option>
                  <option value="extend">Extend Display (Recommended)</option>
                  <option value="external-only">External Display Only</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Auto-rotate for Display</label>
                <div className="flex items-center">
                  <input 
                    type="checkbox" 
                    id="autoRotateExternal"
                    checked={settings.autoRotateExternal !== false}
                    onChange={(e) => setSettings({...settings, autoRotateExternal: e.target.checked})}
                    className="mr-2"
                  />
                  <label htmlFor="autoRotateExternal">Auto-rotate based on display orientation</label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* QR Code Section for Client-Facing iPad Setup */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <h2 className="text-xl font-bold mb-4 flex items-center">
          <QrCode size={24} className="mr-2" />
          Quick Setup with QR Code
        </h2>
        <p className="mb-4">Set up any iPad or device instantly with this QR code.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium mb-3">Display URL</h3>
            <div className="bg-gray-50 p-3 rounded border">
              <p className="text-sm text-gray-600 mb-2">Customer Display URL:</p>
              <div className="flex items-center space-x-2">
                <input 
                  type="text" 
                  value={`${window.location.origin}/display`}
                  readOnly
                  className="flex-1 p-2 border rounded bg-white text-sm"
                />
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/display`);
                    alert('URL copied to clipboard!');
                  }}
                  className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  Copy
                </button>
              </div>
            </div>
            
            <div className="mt-4 space-y-2">
              <button 
                onClick={() => window.open(`${window.location.origin}/display`, '_blank')}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 flex items-center"
              >
                <Eye size={18} className="mr-2" />
                Preview Display
              </button>
              
              <div className="flex space-x-2">
                <button 
                  onClick={() => {
                    const testWindow = window.open(`${window.location.origin}/display`, '_blank');
                    setTimeout(() => {
                      if (testWindow) {
                        testWindow.displayHelper?.showInfo();
                        alert('Display info logged to console. Check the preview window\'s console (F12).');
                      }
                    }, 2000);
                  }}
                  className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                >
                  Test Resolution
                </button>
                
                <button 
                  onClick={() => {
                    const testWindow = window.open(`${window.location.origin}/display`, '_blank');
                    setTimeout(() => {
                      if (testWindow) {
                        testWindow.displayHelper?.toggleFullscreen();
                      }
                    }, 1000);
                  }}
                  className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                >
                  Test Fullscreen
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col items-center">
            <h3 className="font-medium mb-3">QR Code for Easy Setup</h3>
            <div className="bg-white p-4 border-2 border-gray-300 rounded-lg">
              <QRCodeComponent url={`${window.location.origin}/display`} />
            </div>
            <p className="text-sm text-gray-600 mt-2 text-center">
              Scan with iPad camera to open display
            </p>
          </div>
        </div>
      </div>

      {/* Enhanced Display Appearance Settings */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-4">
        <h2 className="text-xl font-bold mb-4 flex items-center">
          <Palette size={24} className="mr-2" />
          Display Appearance
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium mb-3">Layout & Style</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Display Theme</label>
                <select 
                  value={settings.displayTheme || 'light'}
                  onChange={(e) => setSettings({...settings, displayTheme: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="light">Light Theme</option>
                  <option value="dark">Dark Theme</option>
                  <option value="coffee">Coffee Theme</option>
                  <option value="minimal">Minimal White</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Font Size</label>
                <select 
                  value={settings.displayFontSize || 'medium'}
                  onChange={(e) => setSettings({...settings, displayFontSize: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                  <option value="extra-large">Extra Large</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Display Resolution</label>
                <select 
                  value={settings.displayResolution || 'auto'}
                  onChange={(e) => setSettings({...settings, displayResolution: e.target.value})}
                  className="w-full p-2 border rounded"
                >
                  <option value="auto">Auto-detect</option>
                  <option value="1080p">1080p (1920×1080)</option>
                  <option value="1440p">1440p (2560×1440)</option>
                  <option value="4k">4K (3840×2160)</option>
                  <option value="5k">5K (5120×2880)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Display Zoom Level</label>
                <div className="flex items-center space-x-3">
                  <input 
                    type="range"
                    min="50"
                    max="200"
                    step="10"
                    value={settings.displayZoom || 100}
                    onChange={(e) => setSettings({...settings, displayZoom: parseInt(e.target.value)})}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-12 text-center">
                    {settings.displayZoom || 100}%
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Adjust for different screen sizes (50% for large displays, 150% for small screens)
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Order Layout</label>
                <div className="flex space-x-3">
                  <button 
                    className={`px-3 py-2 rounded text-sm ${settings.displayLayout === 'grid' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => setSettings({...settings, displayLayout: 'grid'})}
                  >
                    Grid View
                  </button>
                  <button 
                    className={`px-3 py-2 rounded text-sm ${settings.displayLayout === 'list' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => setSettings({...settings, displayLayout: 'list'})}
                  >
                    List View
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-3">Information Display</h3>
            <div className="space-y-3">
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showWaitTimes"
                  checked={settings.showWaitTimes !== false}
                  onChange={(e) => setSettings({...settings, showWaitTimes: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showWaitTimes">Show estimated wait times</label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showQueuePosition"
                  checked={settings.showQueuePosition || false}
                  onChange={(e) => setSettings({...settings, showQueuePosition: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showQueuePosition">Show queue position</label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showOrderNumber"
                  checked={settings.showOrderNumber !== false}
                  onChange={(e) => setSettings({...settings, showOrderNumber: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showOrderNumber">Show order numbers</label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showCoffeeIcons"
                  checked={settings.showCoffeeIcons !== false}
                  onChange={(e) => setSettings({...settings, showCoffeeIcons: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showCoffeeIcons">Show coffee type icons</label>
              </div>
              
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="showCompletedOrders"
                  checked={settings.showCompletedOrders !== false}
                  onChange={(e) => setSettings({...settings, showCompletedOrders: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="showCompletedOrders">Show completed orders</label>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-4">
        <h2 className="text-xl font-bold mb-4">Notification Settings</h2>
        <p className="mb-4">Configure how customers are notified when their order is ready.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-medium mb-2">SMS Notifications</h3>
            <div className="space-y-2">
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="autoSendSmsOnComplete"
                  checked={settings.autoSendSmsOnComplete}
                  onChange={(e) => setSettings({...settings, autoSendSmsOnComplete: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="autoSendSmsOnComplete">Automatically send SMS when order is completed</label>
              </div>
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="remindAfterDelay"
                  checked={settings.remindAfterDelay}
                  onChange={(e) => setSettings({...settings, remindAfterDelay: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="remindAfterDelay">Send reminder if order isn't picked up</label>
              </div>
              {settings.remindAfterDelay && (
                <div className="flex items-center ml-6 mt-2">
                  <label htmlFor="reminderDelay" className="mr-2">Reminder delay:</label>
                  <input 
                    type="number" 
                    id="reminderDelay"
                    min="30" 
                    max="300"
                    value={settings.reminderDelay}
                    onChange={(e) => setSettings({...settings, reminderDelay: parseInt(e.target.value) || 30})}
                    className="w-16 p-1 border rounded text-center"
                  />
                  <span className="ml-2">seconds</span>
                </div>
              )}
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-2">Sound and Print</h3>
            <div className="space-y-2">
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="soundEnabled"
                  checked={settings.soundEnabled}
                  onChange={(e) => setSettings({...settings, soundEnabled: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="soundEnabled">Play sound when new orders arrive</label>
              </div>
              <div className="flex items-center">
                <input 
                  type="checkbox" 
                  id="autoPrintLabels"
                  checked={settings.autoPrintLabels}
                  onChange={(e) => setSettings({...settings, autoPrintLabels: e.target.checked})}
                  className="mr-2"
                />
                <label htmlFor="autoPrintLabels">Automatically print labels for new orders</label>
              </div>
            </div>
          </div>
        </div>
        
        <button
          className="mt-6 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center"
          onClick={() => {
            // Save settings using the SettingsService via setSettings (instead of manual localStorage)
            try {
              // setSettings should automatically persist via SettingsService
              // All the settings are already being updated in real-time via setSettings calls above
              alert('Display and notification settings are automatically saved!');
            } catch (error) {
              console.error('Error saving notification settings:', error);
              alert('Error saving settings. Please try again.');
            }
          }}
        >
          <Check size={18} className="mr-1" />
          Settings Auto-Saved
        </button>
      </div>
    </div>
  );
};

export default DisplayTab;