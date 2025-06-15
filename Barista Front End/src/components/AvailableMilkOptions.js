import React, { useState, useEffect } from 'react';
import SettingsService from '../services/SettingsService';
import { 
  DEFAULT_MILK_TYPES, 
  getStandardMilks, 
  getAlternativeMilks,
  getSimilarMilkSuggestions,
  formatMilkListForSMS 
} from '../utils/milkConfig';

/**
 * Component for configuring which milk types are available for the event
 */
const AvailableMilkOptions = () => {
  const [availableMilks, setAvailableMilks] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [previewMilkSuggestion, setPreviewMilkSuggestion] = useState(null);
  
  // Load current settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);
        const settings = await SettingsService.getSettings(true); // Force refresh
        
        // Initialize milk availability from settings or defaults
        const initialAvailability = {};
        
        // If we have settings, use them
        if (settings && settings.availableMilks) {
          setAvailableMilks(settings.availableMilks);
        } else {
          // Otherwise, set defaults (all milk types available)
          DEFAULT_MILK_TYPES.forEach(milk => {
            initialAvailability[milk.id] = true;
          });
          setAvailableMilks(initialAvailability);
        }
      } catch (error) {
        console.error('Error loading milk availability settings:', error);
        setMessage({ type: 'error', text: 'Failed to load milk settings' });
        
        // Set defaults on error
        const initialAvailability = {};
        DEFAULT_MILK_TYPES.forEach(milk => {
          initialAvailability[milk.id] = true;
        });
        setAvailableMilks(initialAvailability);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadSettings();
  }, []);
  
  // Toggle milk availability
  const toggleMilkAvailability = (milkId) => {
    const newAvailability = {
      ...availableMilks,
      [milkId]: !availableMilks[milkId]
    };
    
    setAvailableMilks(newAvailability);
    
    // Check if we need to show alternative suggestion preview
    const milk = DEFAULT_MILK_TYPES.find(m => m.id === milkId);
    
    if (milk && newAvailability[milkId] === false) {
      // When disabling a milk, show a preview of what suggestions would be
      const suggestions = getSimilarMilkSuggestions(
        milkId, 
        { availableMilks: newAvailability },
        3
      );
      
      if (suggestions.length > 0) {
        setPreviewMilkSuggestion({
          disabled: milk.name,
          suggestions: suggestions,
          smsText: formatMilkListForSMS(suggestions)
        });
      } else {
        setPreviewMilkSuggestion(null);
      }
    } else {
      setPreviewMilkSuggestion(null);
    }
  };
  
  // Save settings
  const saveSettings = async () => {
    try {
      setIsSaving(true);
      setMessage(null);
      
      // Call the API to save settings
      const success = await SettingsService.updateSettings({
        availableMilks
      });
      
      if (success) {
        setMessage({ type: 'success', text: 'Milk options saved successfully!' });
      } else {
        throw new Error('Failed to save settings');
      }
    } catch (error) {
      console.error('Error saving milk options:', error);
      setMessage({ type: 'error', text: 'Failed to save milk options: ' + (error.message || 'Unknown error') });
    } finally {
      setIsSaving(false);
    }
  };
  
  // Reset to defaults (all available)
  const resetToDefaults = () => {
    const defaultAvailability = {};
    DEFAULT_MILK_TYPES.forEach(milk => {
      defaultAvailability[milk.id] = true;
    });
    setAvailableMilks(defaultAvailability);
    setMessage({ type: 'info', text: 'Reset to defaults (all milks available). Click Save to apply.' });
  };
  
  // Render a milk option with toggle
  const renderMilkOption = (milk) => {
    const isAvailable = availableMilks[milk.id] === true;
    
    return (
      <div key={milk.id} className="flex items-center justify-between p-3 border rounded mb-2">
        <div>
          <div className="font-medium">{milk.name}</div>
          <div className="text-sm text-gray-500">
            {Object.entries(milk.properties)
              .filter(([_, value]) => value)
              .map(([key]) => {
                return key === 'dairyFree' ? 'Dairy-Free' :
                       key === 'lactoseFree' ? 'Lactose-Free' :
                       key === 'vegan' ? 'Vegan' :
                       key === 'lowFat' ? 'Low-Fat' : '';
              })
              .filter(label => label)
              .join(', ')}
          </div>
        </div>
        
        <div className="flex items-center">
          <span className={`mr-2 text-sm ${isAvailable ? 'text-green-600' : 'text-red-600'}`}>
            {isAvailable ? 'Available' : 'Not Available'}
          </span>
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={isAvailable}
              onChange={() => toggleMilkAvailability(milk.id)}
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
          </label>
        </div>
      </div>
    );
  };
  
  if (isLoading) {
    return <div className="text-center py-6">Loading milk options...</div>;
  }
  
  const standardMilks = getStandardMilks();
  const alternativeMilks = getAlternativeMilks();
  
  return (
    <div className="bg-white shadow-md rounded-lg p-6">
      <h2 className="text-xl font-bold mb-2">Available Milk Options</h2>
      <p className="text-gray-600 mb-6">Enable or disable milk options for this event</p>
      
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
      
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Standard Milks</h3>
        {standardMilks.map(renderMilkOption)}
      </div>
      
      <div className="mb-6">
        <h3 className="text-lg font-medium mb-3">Alternative Milks</h3>
        {alternativeMilks.map(renderMilkOption)}
      </div>
      
      {/* Preview milk suggestions for SMS */}
      {previewMilkSuggestion && (
        <div className="bg-yellow-50 border border-yellow-200 p-4 rounded mb-6">
          <h3 className="text-md font-medium mb-2">SMS Response Preview:</h3>
          <p className="mb-2 text-sm font-medium">
            When a customer requests <span className="font-bold text-red-600">{previewMilkSuggestion.disabled}</span> (which is disabled):
          </p>
          <div className="bg-white p-3 rounded border border-gray-200 mb-3">
            <p className="italic text-gray-700">
              "Sorry, we don't have {previewMilkSuggestion.disabled}. Available options are: {previewMilkSuggestion.smsText}. Which would you like?"
            </p>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {previewMilkSuggestion.suggestions.map(milk => (
              <span 
                key={milk.id}
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
              >
                {milk.name}
              </span>
            ))}
          </div>
        </div>
      )}
      
      <div className="bg-blue-50 p-4 rounded mb-6">
        <h3 className="text-md font-medium mb-2">SMS Processing:</h3>
        <p className="text-sm text-gray-700 mb-2">
          SMS orders will reflect the available milk options. If a customer requests an unavailable 
          milk type, they will be notified and offered alternatives.
        </p>
        <p className="text-sm text-gray-700">
          The system intelligently suggests similar milk types based on properties like dairy-free, 
          lactose-free, and low-fat status.
        </p>
      </div>
      
      <div className="flex justify-end space-x-3">
        <button
          type="button"
          onClick={resetToDefaults}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
        >
          Reset All to Available
        </button>
        <button
          type="button"
          onClick={saveSettings}
          disabled={isSaving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default AvailableMilkOptions;