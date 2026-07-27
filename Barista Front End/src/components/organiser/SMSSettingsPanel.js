import React, { useState, useEffect } from 'react';
import MessageService from '../../services/MessageService';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

/**
 * Pre-event pre-orders (client request): before the event opens, SMS
 * orders are SAVED as the customer's usual instead of being made. The
 * reply template is editable live — placeholders {name} {order} {event}
 * {sponsor}, plus any free text (date, opening time, spiel). On event
 * day, switch it OFF: returning customers get "Welcome back — your
 * usual X?" built from what they saved.
 */
const PreEventCard = () => {
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState('');
  const [defaultMsg, setDefaultMsg] = useState('');
  const [savedCount, setSavedCount] = useState(null);
  const [status, setStatus] = useState(null); // {type,text}
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/settings/pre-event');
        if (r && r.success) {
          setEnabled(!!r.settings.enabled);
          setMsg(r.settings.message || '');
          setDefaultMsg(r.default_message || '');
          setSavedCount(r.saved_preorders ?? null);
        }
      } catch (e) {
        setStatus({ type: 'error', text: 'Could not load pre-event settings' });
      }
    })();
  }, []);

  const save = async (nextEnabled = enabled, nextMsg = msg) => {
    setSaving(true);
    setStatus(null);
    try {
      const r = await api.request('/settings/pre-event', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled, message: nextMsg }),
      });
      if (r && r.success) {
        setStatus({ type: 'success', text: nextEnabled
          ? 'Pre-event mode is ON — texts now SAVE orders instead of making coffee.'
          : 'Pre-event mode is OFF — texts place live orders as normal.' });
      } else {
        setStatus({ type: 'error', text: (r && r.error) || 'Server did not confirm the save' });
      }
    } catch (e) {
      setStatus({ type: 'error', text: `Save failed: ${e?.message || 'network error'}` });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white shadow-md rounded-lg p-6 mb-6 border-l-4"
         style={{ borderLeftColor: enabled ? '#d97706' : '#e5e7eb' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1">Pre-event pre-orders</h2>
          <p className="text-gray-600 text-sm">
            While ON, SMS orders are <b>saved as the customer's usual</b> — no coffee is
            queued. On event day, switch OFF: when they text again we offer exactly what
            they saved. {savedCount != null && (
              <b>{savedCount} pre-order{savedCount === 1 ? '' : 's'} saved so far.</b>
            )}
          </p>
        </div>
        <label className="flex items-center gap-2 flex-shrink-0 cursor-pointer">
          <input type="checkbox" checked={enabled}
                 onChange={(e) => { setEnabled(e.target.checked); save(e.target.checked, msg); }} />
          <span className="font-bold">{enabled ? 'ON' : 'OFF'}</span>
        </label>
      </div>

      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Reply sent after a pre-order is saved
        </label>
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          onBlur={() => save(enabled, msg)}
          rows={3}
          className="w-full p-2 border rounded font-mono text-sm"
          placeholder={defaultMsg || "Thanks {name}! We've saved your {order} for {event}. On event day, text this number when you arrive and we'll get your order underway."}
        />
        <p className="text-xs text-gray-500 mt-1">
          Placeholders: <code>{'{name}'}</code> <code>{'{order}'}</code> <code>{'{event}'}</code> <code>{'{sponsor}'}</code>.
          Free text welcome — add the date, opening time, a spiel — and edit any time;
          the change applies to the very next text. Leave blank to use the default.
          Plain characters keep SMS cost at one segment.
        </p>
      </div>

      {status && (
        <div className={`mt-3 p-2 rounded text-sm ${status.type === 'success'
          ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {saving ? 'Saving…' : status.text}
        </div>
      )}
    </div>
  );
};

/**
 * Component for configuring SMS settings for the event
 */
const SMSSettingsPanel = () => {
  const [settings, setSettings] = useState({
    autoSendSmsOnComplete: true,
    remindAfterDelay: true,
    reminderDelay: 30,
    includeQrCode: true,
    includeTrackingLink: true,
    useShortUrls: false,
    venueMapUrl: 'https://order.expresso.cafe'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [phonePreview, setPhonePreview] = useState(null);
  
  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        // Get settings from MessageService
        const messageSettings = MessageService.settings;
        
        setSettings({
          ...settings,
          ...messageSettings
        });
      } catch (error) {
        console.error('Error loading SMS settings:', error);
        setMessage({ type: 'error', text: 'Failed to load SMS settings' });
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSettings();
    showSMSPreview();
  }, []);
  
  // Update a setting value
  const updateSetting = (key, value) => {
    setSettings({
      ...settings,
      [key]: value
    });
    
    // Refresh preview
    showSMSPreview();
  };
  
  // Save settings
  const saveSettings = async () => {
    try {
      setIsSaving(true);
      setMessage(null);
      
      // Update MessageService settings
      MessageService.updateSettings(settings);
      
      setMessage({ type: 'success', text: 'SMS settings saved successfully!' });
    } catch (error) {
      console.error('Error saving SMS settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings: ' + (error.message || 'Unknown error') });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Show SMS preview with current settings
  const showSMSPreview = () => {
    const mockOrder = {
      id: 'order_12345',
      orderNumber: '42',
      coffeeType: 'Flat White',
      milkType: 'Oat Milk',
      stationId: '3',
      stationName: 'Station #3',
      waitTime: 5,
      customerName: 'Alex'
    };
    
    let previewMessage = '🔔 YOUR COFFEE IS READY! Your Flat White is now ready for collection from Station #3.';
    
    if (settings.includeTrackingLink) {
      previewMessage += ' Track your order: https://order.expresso.cafe/track?order=42&station=3&eta=5';
      
      if (settings.useShortUrls) {
        previewMessage = previewMessage.replace('https://order.expresso.cafe/track?order=42&station=3&eta=5', 'https://esprs.so/t/42s3');
      }
    }
    
    if (settings.includeQrCode) {
      previewMessage += ' Scan the QR code on the tracking page for easy pickup!';
    }
    
    setPhonePreview(previewMessage);
  };
  
  if (isLoading) {
    return <div className="text-center py-6">Loading SMS settings...</div>;
  }
  
  return (
    <>
    <PreEventCard />
    <div className="bg-white shadow-md rounded-lg p-6">
      <h2 className="text-xl font-bold mb-2">SMS Notification Settings</h2>
      <p className="text-gray-600 mb-6">Configure how SMS notifications are sent to customers</p>
      
      {/* Message display */}
      {message && (
        <div 
          className={`p-4 mb-4 rounded ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 
            message.type === 'error' ? 'bg-red-100 text-red-800' : 
            'bg-blue-100 text-blue-800'
          }`}
        >
          {message.text}
        </div>
      )}
      
      {/* General SMS settings */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">General SMS Settings</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">Send SMS on Order Completion</label>
              <p className="text-sm text-gray-600">Automatically notify customers when their order is ready</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.autoSendSmsOnComplete}
                onChange={(e) => updateSetting('autoSendSmsOnComplete', e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">Send Reminder SMS</label>
              <p className="text-sm text-gray-600">Send a reminder if order hasn't been picked up</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.remindAfterDelay}
                onChange={(e) => updateSetting('remindAfterDelay', e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          
          {settings.remindAfterDelay && (
            <div className="pl-6 border-l-2 border-blue-200">
              <label className="block font-medium mb-1">Reminder Delay (seconds)</label>
              <input 
                type="number"
                min="10"
                max="300"
                value={settings.reminderDelay}
                onChange={(e) => updateSetting('reminderDelay', parseInt(e.target.value, 10))}
                className="w-full p-2 border rounded"
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Order Tracking Settings */}
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Order Tracking Features</h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">Include Tracking Link</label>
              <p className="text-sm text-gray-600">Add a web link to track order status</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.includeTrackingLink}
                onChange={(e) => updateSetting('includeTrackingLink', e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
          
          {settings.includeTrackingLink && (
            <div className="pl-6 border-l-2 border-blue-200">
              <div className="mb-3">
                <label className="block font-medium mb-1">Venue Map URL</label>
                <input 
                  type="text"
                  value={settings.venueMapUrl}
                  onChange={(e) => updateSetting('venueMapUrl', e.target.value)}
                  className="w-full p-2 border rounded"
                  placeholder="https://example.com/track"
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div>
                  <label className="font-medium">Use Short URLs</label>
                  <p className="text-sm text-gray-600">Use shortened URLs in SMS messages</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    className="sr-only peer"
                    checked={settings.useShortUrls}
                    onChange={(e) => updateSetting('useShortUrls', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                </label>
              </div>
            </div>
          )}
          
          <div className="flex items-center justify-between">
            <div>
              <label className="font-medium">Include QR Code Reference</label>
              <p className="text-sm text-gray-600">Mention QR code in SMS for easy pickup</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input 
                type="checkbox" 
                className="sr-only peer"
                checked={settings.includeQrCode}
                onChange={(e) => updateSetting('includeQrCode', e.target.checked)}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
            </label>
          </div>
        </div>
      </div>
      
      {/* Phone Message Preview */}
      {phonePreview && (
        <div className="mb-6">
          <h3 className="text-lg font-medium mb-3">SMS Preview</h3>
          <div className="max-w-xs mx-auto">
            <div className="bg-gray-800 rounded-t-lg p-2 flex items-center justify-center">
              <div className="w-16 h-4 bg-black rounded-full"></div>
            </div>
            <div className="bg-gray-900 border-2 border-gray-800 p-3 rounded-b-lg">
              <div className="flex flex-col space-y-2">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">
                    E
                  </div>
                  <div className="ml-2">
                    <div className="text-white text-xs font-medium">Expresso ☕</div>
                    <div className="text-gray-400 text-xs">Now</div>
                  </div>
                </div>
                <div className="bg-green-800 rounded-lg p-3 ml-2">
                  <p className="text-white text-xs">{phonePreview}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={() => showSMSPreview()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Preview SMS
        </button>
        <button
          type="button"
          onClick={saveSettings}
          disabled={isSaving}
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
    </>
  );
};

export default SMSSettingsPanel;