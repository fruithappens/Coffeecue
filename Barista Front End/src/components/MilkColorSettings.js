import React, { useState, useEffect } from 'react';
import SettingsService from '../services/SettingsService';
import '../styles/milkColors.css';

// Import inventory service to get milk types from inventory system
import InventoryIntegrationService from '../services/InventoryIntegrationService';

// Default colors for common milk types
const DEFAULT_MILK_COLORS = {
  // Standard Milks
  "Whole Milk": "#FFFFFF",  // White/Cream
  "Skim Milk": "#ADD8E6",  // Light Blue
  "Low-fat Milk": "#D3D3D3",  // Light Gray
  "Lactose-Free Milk": "#FAFAFA",  // White with special border
  
  // Alternative Milks
  "Soy Milk": "#FFEC8B",  // Bright Yellow
  "Oat Milk": "#FF7F7F",  // Reddish
  "Almond Milk": "#87CEEB",  // Sky Blue
  "Coconut Milk": "#90EE90",  // Light Green
  "Macadamia Milk": "#DEB887",  // Burlywood
  "Rice Milk": "#E6E6FA",  // Light Purple
  "Hemp Milk": "#D8F8D8",  // Pale Green
  "Cashew Milk": "#F5DEB3",  // Wheat
  "Pea Milk": "#CCFFCC"  // Very Light Green
};

const MilkColorSettings = () => {
  const [milkColors, setMilkColors] = useState({});
  const [inventoryMilks, setInventoryMilks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Load milk types from inventory and colors from settings
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        // Get milk types from inventory
        const inventoryData = InventoryIntegrationService.getEventInventory();
        const milkItems = inventoryData?.milk || [];
        setInventoryMilks(milkItems);
        
        // Get saved milk colors from settings
        const settings = await SettingsService.getSettings(true);
        const savedColors = settings.milkColors || {};
        
        // Create color mapping for all milk types
        const colorMapping = {};
        milkItems.forEach(milk => {
          // Use color from inventory item first, then saved settings, then default
          colorMapping[milk.name] = milk.color || 
                                   savedColors[milk.name] || 
                                   DEFAULT_MILK_COLORS[milk.name] || 
                                   generateColor(milk.name);
        });
        
        setMilkColors(colorMapping);
      } catch (error) {
        console.error('Error loading data:', error);
        setMessage({ type: 'error', text: 'Failed to load milk data' });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
    
    // Listen for inventory update events
    const handleInventoryUpdate = () => {
      loadData();
    };
    
    window.addEventListener('inventory:updated', handleInventoryUpdate);
    
    return () => {
      window.removeEventListener('inventory:updated', handleInventoryUpdate);
    };
  }, []);
  
  // Generate a color for milk types without defaults
  const generateColor = (milkName) => {
    // Simple color generation based on milk name
    const hash = milkName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  // Save milk colors
  const handleSave = async () => {
    try {
      setIsSaving(true);
      setMessage(null);
      
      // Update inventory items with colors
      const inventoryData = InventoryIntegrationService.getEventInventory();
      if (inventoryData && inventoryData.milk) {
        inventoryData.milk.forEach(milk => {
          if (milkColors[milk.name]) {
            milk.color = milkColors[milk.name];
          }
        });
        
        // Save updated inventory
        localStorage.setItem('event_inventory', JSON.stringify(inventoryData));
        
        // Notify that inventory was updated
        InventoryIntegrationService.notifyInventoryUpdated();
      }
      
      // Save to settings service for app-wide access
      await SettingsService.updateSettings({ milkColors });
      
      setMessage({ type: 'success', text: 'Milk colors saved successfully' });
    } catch (error) {
      console.error('Error saving milk colors:', error);
      setMessage({ type: 'error', text: `Failed to save: ${error.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  // Reset to defaults
  const handleReset = () => {
    const resetColors = {};
    inventoryMilks.forEach(milk => {
      resetColors[milk.name] = DEFAULT_MILK_COLORS[milk.name] || generateColor(milk.name);
    });
    setMilkColors(resetColors);
    setMessage({ type: 'info', text: 'Reset to defaults (not saved yet)' });
  };

  // Handle color change
  const handleColorChange = (milkType, newColor) => {
    setMilkColors({
      ...milkColors,
      [milkType]: newColor
    });
  };

  // Get milk category from inventory item
  const getMilkCategory = (milkName) => {
    const milk = inventoryMilks.find(m => m.name === milkName);
    if (!milk) return 'alternative';
    
    const name = milkName.toLowerCase();
    if (name.includes('whole') || name.includes('skim') || 
        name.includes('full cream') || name.includes('reduced fat') || 
        name.includes('lactose-free') || name.includes('low-fat')) {
      return 'standard';
    }
    return 'alternative';
  };

  // Render milk color pickers grouped by type
  const renderMilkColorsList = () => {
    // Separate standard and alternative milks based on inventory
    const standardMilks = Object.entries(milkColors).filter(([name]) => 
      getMilkCategory(name) === 'standard'
    );
    
    const alternativeMilks = Object.entries(milkColors).filter(([name]) => 
      getMilkCategory(name) === 'alternative'
    );

    return (
      <div className="space-y-6">
        {standardMilks.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-3">Standard Milks</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {standardMilks.map(([milkType, color]) => {
                const milk = inventoryMilks.find(m => m.name === milkType);
                return (
                  <div key={milkType} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50">
                    <div 
                      className="w-8 h-8 rounded-full border-2 border-gray-300" 
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{milkType}</div>
                      {milk?.description && (
                        <div className="text-sm text-gray-500">{milk.description}</div>
                      )}
                    </div>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => handleColorChange(milkType, e.target.value)}
                      className="w-12 h-12 rounded cursor-pointer border-2 border-gray-300"
                      title={`Change color for ${milkType}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {alternativeMilks.length > 0 && (
          <div>
            <h3 className="text-lg font-medium mb-3">Alternative Milks</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {alternativeMilks.map(([milkType, color]) => {
                const milk = inventoryMilks.find(m => m.name === milkType);
                return (
                  <div key={milkType} className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-gray-50">
                    <div 
                      className="w-8 h-8 rounded-full border-2 border-gray-300" 
                      style={{ backgroundColor: color }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{milkType}</div>
                      {milk?.description && (
                        <div className="text-sm text-gray-500">{milk.description}</div>
                      )}
                    </div>
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => handleColorChange(milkType, e.target.value)}
                      className="w-12 h-12 rounded cursor-pointer border-2 border-gray-300"
                      title={`Change color for ${milkType}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Get milk property indicators (dairy-free, vegan, etc.)
  const getMilkProperties = (milkType) => {
    const properties = [];
    const lowercaseMilk = milkType.toLowerCase();
    
    // Determine properties based on milk type
    if (lowercaseMilk.includes('soy') || 
        lowercaseMilk.includes('oat') || 
        lowercaseMilk.includes('almond') ||
        lowercaseMilk.includes('coconut') ||
        lowercaseMilk.includes('macadamia') ||
        lowercaseMilk.includes('rice') ||
        lowercaseMilk.includes('hemp') ||
        lowercaseMilk.includes('cashew') ||
        lowercaseMilk.includes('pea')) {
      properties.push('Dairy-Free');
      properties.push('Vegan');
    }
    
    if (lowercaseMilk.includes('lactose-free')) {
      properties.push('Lactose-Free');
    }
    
    if (lowercaseMilk.includes('skim') || lowercaseMilk.includes('reduced fat')) {
      properties.push('Low-Fat');
    }
    
    return properties;
  };
  
  // Preview what orders will look like with the current colors
  const renderPreview = () => {
    const milkTypes = Object.keys(milkColors);
    
    return (
      <div className="mt-8">
        <h3 className="text-lg font-medium mb-3">Color Preview</h3>
        
        {/* Visual color legend */}
        <div className="mb-6 p-4 border rounded bg-gray-50">
          <h4 className="font-medium mb-3">Color Legend</h4>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center bg-white p-2 border rounded">
              <div className="milk-indicator-dot soy-milk"></div>
              <span className="text-sm">Soy Milk - Yellow</span>
            </div>
            <div className="flex items-center bg-white p-2 border rounded">
              <div className="milk-indicator-dot oat-milk"></div>
              <span className="text-sm">Oat Milk - Red</span>
            </div>
            <div className="flex items-center bg-white p-2 border rounded">
              <div className="milk-indicator-dot almond-milk"></div>
              <span className="text-sm">Almond Milk - Blue</span>
            </div>
            <div className="flex items-center bg-white p-2 border rounded">
              <div className="milk-indicator-dot lactose-free-milk"></div>
              <span className="text-sm">Lactose-Free - Dashed</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {milkTypes.map(milkType => {
            const cssClass = `order-milk-${milkType.toLowerCase().replace(/\s+/g, '-')}`;
            const properties = getMilkProperties(milkType);
            
            return (
              <div key={milkType} className={`p-4 border rounded ${cssClass}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div 
                      className={`milk-indicator-dot ${milkType.toLowerCase().replace(/\s+/g, '-')}`}
                    ></div>
                    <span className="font-medium">Cappuccino</span>
                  </div>
                  
                  {/* Property badges */}
                  <div className="flex gap-1">
                    {properties.map(prop => (
                      <span 
                        key={`${milkType}-${prop}`}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          prop === 'Dairy-Free' ? 'bg-green-100 text-green-800' :
                          prop === 'Vegan' ? 'bg-green-100 text-green-800' :
                          prop === 'Lactose-Free' ? 'bg-blue-100 text-blue-800' :
                          prop === 'Low-Fat' ? 'bg-purple-100 text-purple-800' :
                          'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {prop}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-2 text-sm text-gray-600">
                  Regular, {milkType}, 1 sugar
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <div className="flex justify-center py-8">Loading milk colors...</div>;
  }

  return (
    <div className="bg-white shadow-md rounded-lg p-6">
      <h2 className="text-xl font-bold mb-6">Milk Color Settings</h2>
      
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
      
      {/* Info about managing milk types */}
      <div className="mb-6 p-4 border border-blue-200 rounded-lg bg-blue-50">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Milk types are managed in the{' '}
          <span className="font-semibold">Organiser → Stations → Event Inventory</span> section. 
          Colors you set here will be used throughout the system to identify different milk types visually.
        </p>
      </div>
      
      {/* Milk colors list */}
      {renderMilkColorsList()}
      
      {/* Preview */}
      {renderPreview()}
      
      {/* Action buttons */}
      <div className="mt-6 flex justify-end space-x-3">
        <button
          onClick={handleReset}
          className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-medium py-2 px-4 rounded"
        >
          Reset to Defaults
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded"
        >
          {isSaving ? 'Saving...' : 'Save Colors'}
        </button>
      </div>
    </div>
  );
};

export default MilkColorSettings;