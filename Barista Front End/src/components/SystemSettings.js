import React, { useState } from 'react';
import { 
  Settings, Shield, Database, Wifi, Globe,
  Save, AlertCircle, CheckCircle, RefreshCw,
  Bell, Coffee, Users, Clock, Palette
} from 'lucide-react';
import { useSettings } from '../hooks/useSettings';
import BrandingSettings from './BrandingSettings';

/**
 * System Settings Component
 * Comprehensive system configuration
 */
const SystemSettings = () => {
  const { settings, updateSetting, saveSettings } = useSettings();
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  
  // Handle save
  const handleSave = async () => {
    setSaving(true);
    setSaveMessage('');
    
    try {
      await saveSettings();
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('Error saving settings. Please try again.');
      console.error('Error saving settings:', error);
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow-sm p-2 flex space-x-2">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeTab === 'general' 
              ? 'bg-gray-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          General
        </button>
        <button
          onClick={() => setActiveTab('operations')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeTab === 'operations' 
              ? 'bg-gray-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Operations
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeTab === 'notifications' 
              ? 'bg-gray-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Notifications
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeTab === 'security' 
              ? 'bg-gray-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Security
        </button>
        <button
          onClick={() => setActiveTab('branding')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeTab === 'branding' 
              ? 'bg-gray-600 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Branding
        </button>
      </div>
      
      {/* General Settings */}
      {activeTab === 'general' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-6">General Settings</h3>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Event Name
              </label>
              <input
                type="text"
                value={settings.eventName || ''}
                onChange={(e) => updateSetting('eventName', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Annual Tech Conference 2024"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Venue
              </label>
              <input
                type="text"
                value={settings.venue || ''}
                onChange={(e) => updateSetting('venue', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Convention Center Hall A"
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Time Zone
                </label>
                <select
                  value={settings.timeZone || 'America/New_York'}
                  onChange={(e) => updateSetting('timeZone', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Currency
                </label>
                <select
                  value={settings.currency || 'USD'}
                  onChange={(e) => updateSetting('currency', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AUD">AUD ($)</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Operations Settings */}
      {activeTab === 'operations' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-6">Operations Settings</h3>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Order Timeout (minutes)
              </label>
              <input
                type="number"
                value={settings.orderTimeout || 30}
                onChange={(e) => updateSetting('orderTimeout', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-sm text-gray-500 mt-1">
                Orders will be automatically cancelled after this time if not completed
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Target Wait Time (minutes)
              </label>
              <input
                type="number"
                value={settings.targetWaitTime || 5}
                onChange={(e) => updateSetting('targetWaitTime', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Station Auto-Assignment
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.autoAssignStation || false}
                    onChange={(e) => updateSetting('autoAssignStation', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Automatically assign orders to least busy station</span>
                </label>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Queue Management
              </label>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.enableQueueJumping || false}
                    onChange={(e) => updateSetting('enableQueueJumping', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Allow VIP queue jumping</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.enableStationSwitching || false}
                    onChange={(e) => updateSetting('enableStationSwitching', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Allow customers to switch stations</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Notifications Settings */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-6">Notification Settings</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-3">Customer Notifications</h4>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.sendOrderConfirmation || true}
                    onChange={(e) => updateSetting('sendOrderConfirmation', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Send order confirmation SMS</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.sendWaitTimeUpdates || true}
                    onChange={(e) => updateSetting('sendWaitTimeUpdates', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Send wait time updates</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.sendOrderReady || true}
                    onChange={(e) => updateSetting('sendOrderReady', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Send order ready notifications</span>
                </label>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-3">Staff Alerts</h4>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.alertLowStock || true}
                    onChange={(e) => updateSetting('alertLowStock', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Alert on low stock levels</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.alertHighWaitTime || true}
                    onChange={(e) => updateSetting('alertHighWaitTime', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Alert when wait time exceeds target</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.alertStationOffline || true}
                    onChange={(e) => updateSetting('alertStationOffline', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Alert when station goes offline</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Security Settings */}
      {activeTab === 'security' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-6">Security Settings</h3>
          
          <div className="space-y-6">
            <div>
              <h4 className="font-medium mb-3">Authentication</h4>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.requireStaffLogin || true}
                    onChange={(e) => updateSetting('requireStaffLogin', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Require staff login</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.enableTwoFactor || false}
                    onChange={(e) => updateSetting('enableTwoFactor', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Enable two-factor authentication</span>
                </label>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Session Timeout (minutes)
              </label>
              <input
                type="number"
                value={settings.sessionTimeout || 60}
                onChange={(e) => updateSetting('sessionTimeout', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <h4 className="font-medium mb-3">Data Protection</h4>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.encryptCustomerData || true}
                    onChange={(e) => updateSetting('encryptCustomerData', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Encrypt customer data</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={settings.autoDeleteOldOrders || false}
                    onChange={(e) => updateSetting('autoDeleteOldOrders', e.target.checked)}
                    className="mr-2"
                  />
                  <span>Auto-delete orders older than 30 days</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Branding Settings */}
      {activeTab === 'branding' && (
        <BrandingSettings />
      )}
      
      {/* Save Button */}
      <div className="flex justify-end items-center space-x-4">
        {saveMessage && (
          <div className={`flex items-center space-x-2 ${
            saveMessage.includes('Error') ? 'text-red-600' : 'text-green-600'
          }`}>
            {saveMessage.includes('Error') ? 
              <AlertCircle className="w-5 h-5" /> : 
              <CheckCircle className="w-5 h-5" />
            }
            <span>{saveMessage}</span>
          </div>
        )}
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
        >
          {saving ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-5 h-5" />
              <span>Save Settings</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default SystemSettings;