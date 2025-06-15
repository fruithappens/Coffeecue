/**
 * Helper functions for milk color management
 */

import InventoryIntegrationService from '../services/InventoryIntegrationService';

/**
 * Get the color for a specific milk type
 * @param {string} milkName - The name of the milk type
 * @param {string} milkId - The ID of the milk type (optional)
 * @returns {string} - The hex color code for the milk type
 */
export const getMilkColor = (milkName, milkId) => {
  try {
    const debugMode = localStorage.getItem('coffee_debug_milk_colors') === 'true';
    if (debugMode) console.log('Getting milk color for:', { milkName, milkId });
    
    // Get inventory data
    const inventoryData = InventoryIntegrationService.getEventInventory();
    if (debugMode) console.log('Inventory data:', inventoryData);
    
    if (!inventoryData || !inventoryData.milk) {
      if (debugMode) console.log('No inventory data found, using default');
      return getDefaultMilkColor(milkName);
    }
    
    // Find the milk item by name or ID
    const milkItem = inventoryData.milk.find(milk => 
      milk.name === milkName || milk.id === milkId
    );
    // Only log when debugging is enabled
    if (debugMode) console.log('Found milk item:', milkItem);
    
    if (milkItem && milkItem.color) {
      if (debugMode) console.log('Using inventory color:', milkItem.color);
      return milkItem.color;
    }
    
    // Check settings as fallback
    const settings = JSON.parse(localStorage.getItem('coffee_system_settings') || '{}');
    if (settings.milkColors && settings.milkColors[milkName]) {
      if (debugMode) console.log('Using settings color:', settings.milkColors[milkName]);
      return settings.milkColors[milkName];
    }
    
    const defaultColor = getDefaultMilkColor(milkName);
    if (debugMode) console.log('Using default color:', defaultColor);
    return defaultColor;
  } catch (error) {
    console.error('Error getting milk color:', error);
    return getDefaultMilkColor(milkName);
  }
};

/**
 * Get default color for a milk type
 * @param {string} milkName - The name of the milk type
 * @returns {string} - Default hex color
 */
const getDefaultMilkColor = (milkName) => {
  const defaults = {
    // Standard Milks
    "Whole Milk": "#FFFFFF",
    "Full Cream Milk": "#FFFFFF",
    "Skim Milk": "#ADD8E6",
    "Low-fat Milk": "#D3D3D3",
    "Reduced Fat Milk": "#D3D3D3",
    "Lactose-Free Milk": "#FAFAFA",
    
    // Alternative Milks
    "Soy Milk": "#FFEC8B",
    "Oat Milk": "#FF7F7F",
    "Almond Milk": "#87CEEB",
    "Coconut Milk": "#90EE90",
    "Macadamia Milk": "#DEB887",
    "Rice Milk": "#E6E6FA",
    "Hemp Milk": "#D8F8D8",
    "Cashew Milk": "#F5DEB3",
    "Pea Milk": "#CCFFCC"
  };
  
  return defaults[milkName] || generateColorFromName(milkName);
};

/**
 * Generate a color based on milk name
 * @param {string} milkName - The name of the milk type
 * @returns {string} - Generated hex color
 */
const generateColorFromName = (milkName) => {
  const hash = milkName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 80%)`;
};

/**
 * Get CSS style object for milk color border
 * @param {string} milkName - The name of the milk type
 * @param {string} milkId - The ID of the milk type (optional)
 * @returns {Object} - CSS style object
 */
export const getMilkColorStyle = (milkName, milkId) => {
  const color = getMilkColor(milkName, milkId);
  return {
    borderLeftColor: color,
    borderLeftWidth: '8px',
    borderLeftStyle: 'solid'
  };
};

/**
 * Get CSS style object for milk color indicator dot
 * @param {string} milkName - The name of the milk type
 * @param {string} milkId - The ID of the milk type (optional)
 * @returns {Object} - CSS style object
 */
export const getMilkDotStyle = (milkName, milkId) => {
  const color = getMilkColor(milkName, milkId);
  const isLactoseFree = milkName && milkName.toLowerCase().includes('lactose-free');
  
  return {
    backgroundColor: color,
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '8px',
    border: isLactoseFree ? '2px dashed #666' : '2px solid #666'
  };
};