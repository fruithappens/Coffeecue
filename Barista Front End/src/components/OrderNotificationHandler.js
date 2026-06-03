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
  
  // Method to handle order completion notification.
  //
  // SMS notifications used to be sent from here via
  // MessageService.sendReadyNotification + a setTimeout reminder.
  // The BACKEND now owns both — _notify_customer_order_ready in
  // routes/consolidated_api_routes.py fires the "your coffee is
  // ready" SMS from POST /api/orders/<id>/complete, and
  // services/pickup_reminder.py handles uncollected reminders
  // server-side with proper time gating + status re-check.
  //
  // Doing the SMS from BOTH sides caused:
  //  - Customer received two "ready" texts (the backend's "☕ Hi"
  //    and the frontend's "🔔 YOUR COFFEE IS READY!")
  //  - Setting reminderDelay=30 (seconds) fired a "⏰ REMINDER:
  //    has been ready for 0 minutes" text 30s after completion,
  //    even if the customer had already collected.
  //
  // This handler is now ONLY responsible for the local Display
  // screen pop-up. SMS is single-sourced to the backend.
  const completeWithNotification = async (order) => {
    try {
      console.log('Completing order with notification (display-only; SMS is backend-owned):', order);

      // Show on display if enabled.
      if (settings.showNameOnDisplay) {
        MessageService.showOnDisplay(order);
      }
    } catch (error) {
      console.error('Failed to display order completion notification:', error);
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
