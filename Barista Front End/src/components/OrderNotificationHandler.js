// components/OrderNotificationHandler.js
import React, { useState, useEffect } from 'react';
import { Bell, MessageSquare, Settings } from 'lucide-react';
import MessageService from '../services/MessageService';

/**
 * Component that adds notification functionality to the BaristaInterface
 * This handles automatic notifications and display integration
 */
const OrderNotificationHandler = ({ onSendMessage, onUpdateSettings }) => {
  const [settings, setSettings] = useState(MessageService.settings);
  const [showSettings, setShowSettings] = useState(false);
  
  // Update settings in local component and service
  const updateSettings = (newSettings) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    MessageService.updateSettings(updatedSettings);
    
    if (onUpdateSettings) {
      onUpdateSettings(updatedSettings);
    }
  };
  
  // Method to handle order completion notification
  const completeWithNotification = async (order) => {
    try {
      console.log('Completing order with notification:', order);
      
      // Show on display if enabled
      if (settings.showNameOnDisplay) {
        MessageService.showOnDisplay(order);
      }
      
      // Force SMS notification regardless of setting
      // This ensures message is always sent when order is completed
      await MessageService.sendReadyNotification(order);
      console.log('SMS notification sent for order:', order.id);
      
      // If reminder is enabled, start a timer
      if (settings.remindAfterDelay && settings.reminderDelay > 0) {
        setTimeout(() => {
          // Check if order is still completed (not picked up yet)
          // This should be implemented based on your app's logic
          const isStillCompleted = true; // Placeholder logic
          
          if (isStillCompleted) {
            MessageService.sendReminderNotification(
              order, 
              Math.floor(settings.reminderDelay / 60)
            );
          }
        }, settings.reminderDelay * 1000);
      }
    } catch (error) {
      console.error('Failed to send order completion notification:', error);
    }
  };
  
  // Component for notification settings
  const NotificationSettings = () => (
    <div className="bg-white p-4 rounded-lg shadow-lg">
      <h3 className="text-lg font-medium mb-3">Notification Settings</h3>
      
      <div className="space-y-4">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="autoSendSms"
            checked={settings.autoSendSmsOnComplete}
            onChange={(e) => updateSettings({ autoSendSmsOnComplete: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="autoSendSms">Automatically send SMS when order is completed</label>
        </div>
        
        <div className="flex items-center">
          <input
            type="checkbox"
            id="showOnDisplay"
            checked={settings.showNameOnDisplay}
            onChange={(e) => updateSettings({ showNameOnDisplay: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="showOnDisplay">Show customer name on display screen</label>
        </div>
        
        <div className="flex items-center">
          <input
            type="checkbox"
            id="remindAfterDelay"
            checked={settings.remindAfterDelay}
            onChange={(e) => updateSettings({ remindAfterDelay: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="remindAfterDelay">Send reminder if not picked up</label>
        </div>
        
        {settings.remindAfterDelay && (
          <div className="ml-6">
            <label className="block text-sm mb-1">Reminder delay (seconds):</label>
            <input
              type="number"
              min="10"
              max="300"
              step="10"
              value={settings.reminderDelay}
              onChange={(e) => updateSettings({ reminderDelay: Number(e.target.value) })}
              className="w-24 p-1 border rounded"
            />
          </div>
        )}
      </div>
      
      <div className="mt-4 flex justify-end">
        <button
          className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
          onClick={() => setShowSettings(false)}
        >
          Save Settings
        </button>
      </div>
    </div>
  );
  
  return {
    // Render the settings toggle button
    renderSettingsButton: () => (
      <button
        className="p-2 bg-gray-200 rounded-full hover:bg-gray-300 relative"
        onClick={() => setShowSettings(!showSettings)}
        title="Notification Settings"
      >
        <Settings size={20} />
        {showSettings && (
          <div className="absolute right-0 top-full mt-2 z-20">
            <NotificationSettings />
          </div>
        )}
      </button>
    ),
    
    // Method to complete an order with notification
    completeWithNotification,
    
    // Current settings
    settings
  };
};

export default OrderNotificationHandler;
