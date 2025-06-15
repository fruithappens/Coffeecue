// Milk type configuration constants
// This file provides centralized configuration for milk types
// across the application to ensure consistency

/**
 * Default milk types with their properties
 */
export const DEFAULT_MILK_TYPES = [
  // Standard Milks
  {
    id: 'full_cream',
    name: 'Full Cream Milk',
    category: 'standard',
    available: true,
    properties: {
      dairyFree: false,
      lactoseFree: false,
      vegan: false,
      lowFat: false
    }
  },
  {
    id: 'skim',
    name: 'Skim Milk',
    category: 'standard',
    available: true,
    properties: {
      dairyFree: false,
      lactoseFree: false,
      vegan: false,
      lowFat: true
    }
  },
  {
    id: 'reduced_fat',
    name: 'Reduced Fat Milk',
    category: 'standard',
    available: true,
    properties: {
      dairyFree: false,
      lactoseFree: false,
      vegan: false,
      lowFat: true
    }
  },
  {
    id: 'lactose_free',
    name: 'Lactose-Free Milk',
    category: 'standard',
    available: true,
    properties: {
      dairyFree: false,
      lactoseFree: true,
      vegan: false,
      lowFat: false
    }
  },
  
  // Alternative Milks
  {
    id: 'soy',
    name: 'Soy Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'oat',
    name: 'Oat Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'almond',
    name: 'Almond Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: true
    }
  },
  {
    id: 'coconut',
    name: 'Coconut Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'macadamia',
    name: 'Macadamia Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'rice',
    name: 'Rice Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'hemp',
    name: 'Hemp Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: true
    }
  },
  {
    id: 'cashew',
    name: 'Cashew Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: false
    }
  },
  {
    id: 'pea',
    name: 'Pea Milk',
    category: 'alternative',
    available: true,
    properties: {
      dairyFree: true,
      lactoseFree: true,
      vegan: true,
      lowFat: true
    }
  }
];

/**
 * Get milk type information by ID
 * @param {string} id - Milk type ID
 * @returns {Object|null} - Milk type object or null if not found
 */
export const getMilkTypeById = (id) => {
  return DEFAULT_MILK_TYPES.find(milk => milk.id === id) || null;
};

/**
 * Get milk type information by name
 * @param {string} name - Milk type name
 * @returns {Object|null} - Milk type object or null if not found
 */
export const getMilkTypeByName = (name) => {
  return DEFAULT_MILK_TYPES.find(milk => milk.name === name) || null;
};

/**
 * Get all standard milk types
 * @returns {Array} - Array of standard milk types
 */
export const getStandardMilks = () => {
  return DEFAULT_MILK_TYPES.filter(milk => milk.category === 'standard');
};

/**
 * Get all alternative milk types
 * @returns {Array} - Array of alternative milk types
 */
export const getAlternativeMilks = () => {
  return DEFAULT_MILK_TYPES.filter(milk => milk.category === 'alternative');
};

/**
 * Get all available milk types
 * @param {Object} settings - Application settings
 * @returns {Array} - Array of available milk types based on settings
 */
export const getAvailableMilks = (settings) => {
  if (!settings || !settings.availableMilks) {
    // Default to all milks if no settings provided
    return DEFAULT_MILK_TYPES;
  }
  
  // Filter based on the availableMilks setting
  return DEFAULT_MILK_TYPES.filter(milk => 
    settings.availableMilks[milk.id] === true
  );
};

/**
 * Find closest matching milk types for a requested milk that's unavailable
 * Used primarily for SMS suggestions when a customer requests an unavailable milk
 * @param {string} requestedMilk - The milk type requested (name or id)
 * @param {Object} settings - Application settings with availableMilks
 * @param {number} limit - Max number of suggestions to return
 * @returns {Array} - Array of similar available milk types
 */
export const getSimilarMilkSuggestions = (requestedMilk, settings, limit = 3) => {
  // If no milk requested, return empty array
  if (!requestedMilk) return [];
  
  // Get available milks
  const availableMilks = getAvailableMilks(settings);
  if (availableMilks.length === 0) return [];
  
  // Find the requested milk type
  let requestedMilkObj = null;
  
  // Try to find by id first
  requestedMilkObj = getMilkTypeById(requestedMilk);
  
  // If not found by id, try by name
  if (!requestedMilkObj) {
    // Case insensitive search
    const normalizedName = requestedMilk.toLowerCase();
    
    // Try exact match first
    requestedMilkObj = DEFAULT_MILK_TYPES.find(
      milk => milk.name.toLowerCase() === normalizedName
    );
    
    // If still not found, try partial match
    if (!requestedMilkObj) {
      requestedMilkObj = DEFAULT_MILK_TYPES.find(
        milk => milk.name.toLowerCase().includes(normalizedName) ||
               normalizedName.includes(milk.name.toLowerCase())
      );
    }
  }
  
  // If we found the requested milk type, suggest similar available alternatives
  if (requestedMilkObj) {
    const isRequestedDairy = !requestedMilkObj.properties.dairyFree;
    const isRequestedLactoseFree = requestedMilkObj.properties.lactoseFree;
    const isRequestedLowFat = requestedMilkObj.properties.lowFat;
    
    // Score each available milk by similarity
    const scoredMilks = availableMilks.map(milk => {
      let score = 0;
      
      // Same category is a strong match
      if (milk.category === requestedMilkObj.category) {
        score += 3;
      }
      
      // Same dairy/non-dairy status is important
      if (milk.properties.dairyFree === !isRequestedDairy) {
        score += 2;
      }
      
      // Match lactose-free property
      if (milk.properties.lactoseFree === isRequestedLactoseFree) {
        score += 1;
      }
      
      // Match low-fat property
      if (milk.properties.lowFat === isRequestedLowFat) {
        score += 1;
      }
      
      return {
        milk,
        score
      };
    });
    
    // Sort by score (highest first) and return top suggestions
    return scoredMilks
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.milk);
  }
  
  // If we couldn't find the requested milk, return top available milks
  return availableMilks.slice(0, limit);
};

/**
 * Check if a milk type is available based on settings
 * @param {string} milkTypeId - Milk type ID
 * @param {Object} settings - Application settings
 * @returns {boolean} - True if milk is available
 */
export const isMilkAvailable = (milkTypeId, settings) => {
  if (!settings || !settings.availableMilks) {
    return true; // Default to available if no settings
  }
  
  return settings.availableMilks[milkTypeId] === true;
};

/**
 * Format a list of milk types into a readable string for SMS messages
 * @param {Array} milkTypes - Array of milk type objects
 * @returns {string} - Formatted string of milk types
 */
export const formatMilkListForSMS = (milkTypes) => {
  if (!milkTypes || milkTypes.length === 0) {
    return "no milk options available";
  }
  
  // Return "no milk" as an option if there's only one milk type
  if (milkTypes.length === 1) {
    return `${milkTypes[0].name} or no milk`;
  }
  
  // Format the list with Oxford comma and "or" for the last item
  const names = milkTypes.map(milk => milk.name);
  
  if (names.length === 2) {
    return `${names[0]} or ${names[1]} (or no milk)`;
  }
  
  const lastMilk = names.pop();
  return `${names.join(', ')}, or ${lastMilk} (or no milk)`;
};