import React, { useState, useEffect } from 'react';
import { 
  Coffee, Settings, Check, X, Search, Filter, 
  CheckCircle, Circle, Package, Trash2, Plus, Minus
} from 'lucide-react';
import InventoryIntegrationService from '../services/InventoryIntegrationService';

/**
 * Station Inventory Configuration Component
 * Allows selecting which inventory items are available at each station
 */
const StationInventoryConfig = ({ stations }) => {
  const [selectedStation, setSelectedStation] = useState(null);
  const [stationConfigs, setStationConfigs] = useState({});
  const [stationInventory, setStationInventory] = useState({}); // Station-specific inventory with quantities
  const [inventory, setInventory] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterAvailability, setFilterAvailability] = useState('all');

  // Category definitions (matching InventoryManagement)
  const categories = {
    milk: { name: 'Milk & Dairy', color: 'blue' },
    coffee: { name: 'Coffee Types', color: 'amber' },
    cups: { name: 'Cups & Sizes', color: 'green' },
    syrups: { name: 'Syrups & Flavors', color: 'purple' },
    sweeteners: { name: 'Sugars & Sweeteners', color: 'pink' },
    extras: { name: 'Extras & Add-ons', color: 'indigo' }
  };

  // Load data on mount
  useEffect(() => {
    console.log('StationInventoryConfig mounting, loading data...');
    loadInventory();
    loadStationConfigs();
    loadStationInventory();
    
    // Cleanup function to track unmounting
    return () => {
      console.log('StationInventoryConfig unmounting...');
    };
  }, []);

  // Don't auto-initialize - let user explicitly choose what's available
  // This was causing all items to be enabled by default
  useEffect(() => {
    console.log('Inventory loaded, length:', Object.keys(inventory).length);
    // Remove auto-initialization
  }, [inventory]);

  // Load inventory from localStorage
  const loadInventory = () => {
    const savedInventory = localStorage.getItem('event_inventory');
    if (savedInventory) {
      try {
        const inventoryData = JSON.parse(savedInventory);
        setInventory(inventoryData);
      } catch (e) {
        console.error('Error loading inventory:', e);
      }
    }
  };

  // Load station configurations
  const loadStationConfigs = () => {
    const savedConfigs = localStorage.getItem('station_inventory_configs');
    console.log('Loading station configs from localStorage:', savedConfigs);
    if (savedConfigs) {
      try {
        const parsed = JSON.parse(savedConfigs);
        console.log('Parsed station configs:', parsed);
        setStationConfigs(parsed);
      } catch (e) {
        console.error('Error loading station configs:', e);
      }
    } else {
      console.log('No saved station configs found');
    }
  };

  // Load station inventory (quantities)
  const loadStationInventory = () => {
    const savedInventory = localStorage.getItem('station_inventory_quantities');
    console.log('Loading station inventory quantities from localStorage:', savedInventory);
    if (savedInventory) {
      try {
        const parsed = JSON.parse(savedInventory);
        console.log('Parsed station inventory quantities:', parsed);
        setStationInventory(parsed);
      } catch (e) {
        console.error('Error loading station inventory:', e);
      }
    } else {
      console.log('No saved station inventory quantities found');
    }
  };

  // Initialize station configurations for all stations
  const initializeStationConfigs = () => {
    console.log('initializeStationConfigs called, current configs:', stationConfigs);
    
    // Only initialize if configs are truly empty
    const hasAnyConfig = Object.keys(stationConfigs).some(stationId => {
      const config = stationConfigs[stationId];
      return config && Object.keys(config).length > 0;
    });
    
    if (hasAnyConfig) {
      console.log('Configs already exist, skipping initialization');
      return;
    }
    
    // Create configurations for stations 1, 2, and 3 if they don't exist
    const stationsToInitialize = ['1', '2', '3'];
    let needsUpdate = false;
    let updatedConfigs = { ...stationConfigs };

    stationsToInitialize.forEach(stationId => {
      if (!updatedConfigs[stationId] || Object.keys(updatedConfigs[stationId]).length === 0) {
        console.log(`Initializing configuration for station ${stationId}`);
        // Default: all enabled items are available
        const defaultConfig = {};
        Object.keys(inventory).forEach(category => {
          defaultConfig[category] = {};
          inventory[category]?.forEach(item => {
            if (item.enabled) {
              defaultConfig[category][item.id] = true;
            }
          });
        });
        updatedConfigs[stationId] = defaultConfig;
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      console.log('Saving initialized station configurations:', updatedConfigs);
      saveStationConfigs(updatedConfigs);
    } else {
      console.log('No initialization needed');
    }
  };

  // Save station configurations
  const saveStationConfigs = (configs) => {
    try {
      // Validate before saving
      const configString = JSON.stringify(configs);
      console.log('Saving to localStorage:', configString);
      
      localStorage.setItem('station_inventory_configs', configString);
      setStationConfigs(configs);
      
      // Verify it was saved correctly
      const savedConfigs = localStorage.getItem('station_inventory_configs');
      console.log('Verified saved configs:', savedConfigs);
      
      // Notify integration service that station configuration was updated
      InventoryIntegrationService.notifyStationConfigUpdated();
    } catch (e) {
      console.error('Error saving station configs:', e);
    }
  };

  // Save station inventory quantities
  const saveStationInventory = (inventory) => {
    try {
      const inventoryString = JSON.stringify(inventory);
      console.log('Saving station inventory quantities to localStorage:', inventoryString);
      localStorage.setItem('station_inventory_quantities', inventoryString);
      setStationInventory(inventory);
      console.log('Station inventory quantities saved successfully');
      
      // Verify it was saved correctly
      const savedInventory = localStorage.getItem('station_inventory_quantities');
      console.log('Verified saved inventory quantities:', savedInventory);
      
      // Dispatch event to notify EventStockManagement component
      window.dispatchEvent(new CustomEvent('stationInventory:updated', {
        detail: { inventory }
      }));
      console.log('Dispatched stationInventory:updated event');
      
      // Don't auto-sync - it's overwriting configurations
      // InventoryIntegrationService.syncInventoryToStations();
      console.log('Skipping auto-sync to prevent config loss');
    } catch (e) {
      console.error('Error saving station inventory:', e);
    }
  };

  // Get station inventory for a specific station and item
  const getStationItemQuantity = (stationId, category, itemId) => {
    // Ensure stationId is a string for consistency
    const stationIdStr = String(stationId);
    return stationInventory[stationIdStr]?.[category]?.[itemId]?.quantity || 0;
  };

  // Update station inventory quantity
  const updateStationItemQuantity = (stationId, category, itemId, newQuantity) => {
    // Ensure stationId is a string for consistency
    const stationIdStr = String(stationId);
    
    // Ensure the nested structure exists
    const updatedInventory = { ...stationInventory };
    
    // Initialize station if it doesn't exist
    if (!updatedInventory[stationIdStr]) {
      updatedInventory[stationIdStr] = {};
    }
    
    // Initialize category if it doesn't exist
    if (!updatedInventory[stationIdStr][category]) {
      updatedInventory[stationIdStr][category] = {};
    }
    
    // Initialize item if it doesn't exist
    if (!updatedInventory[stationIdStr][category][itemId]) {
      updatedInventory[stationIdStr][category][itemId] = {};
    }
    
    // Update the quantity
    updatedInventory[stationIdStr][category][itemId].quantity = Math.max(0, newQuantity);
    
    console.log(`Updated quantity for item ${itemId} in category ${category} at station ${stationIdStr} to ${newQuantity}`);
    
    saveStationInventory(updatedInventory);
  };

  // Remove item from station
  const removeItemFromStation = (stationId, category, itemId) => {
    // Ensure stationId is a string for consistency
    const stationIdStr = String(stationId);
    
    // Remove from config
    const currentConfig = getStationConfig(stationIdStr);
    const updatedConfig = {
      ...currentConfig,
      [category]: {
        ...currentConfig[category]
      }
    };
    delete updatedConfig[category][itemId];

    const updatedConfigs = {
      ...stationConfigs,
      [stationIdStr]: updatedConfig
    };
    saveStationConfigs(updatedConfigs);

    // Remove from inventory
    const updatedInventory = { ...stationInventory };
    if (updatedInventory[stationIdStr]?.[category]?.[itemId]) {
      delete updatedInventory[stationIdStr][category][itemId];
      saveStationInventory(updatedInventory);
    }
  };

  // Get station config - return empty if not configured
  const getStationConfig = (stationId) => {
    // Ensure stationId is a string for consistency
    const stationIdStr = String(stationId);
    if (!stationConfigs[stationIdStr]) {
      // Return empty config - don't auto-enable everything
      return {};
    }
    return stationConfigs[stationIdStr];
  };

  // Toggle item availability for station
  const toggleItemForStation = (stationId, category, itemId) => {
    // Ensure stationId is a string for consistency
    const stationIdStr = String(stationId);
    console.log(`Toggling item ${itemId} in category ${category} for station ${stationIdStr}`);
    
    const currentConfig = getStationConfig(stationIdStr);
    const isCurrentlyAvailable = currentConfig[category]?.[itemId] || false;
    
    console.log(`Current availability: ${isCurrentlyAvailable}, setting to: ${!isCurrentlyAvailable}`);
    
    const updatedConfig = {
      ...currentConfig,
      [category]: {
        ...currentConfig[category],
        [itemId]: !isCurrentlyAvailable
      }
    };

    const updatedConfigs = {
      ...stationConfigs,
      [stationIdStr]: updatedConfig
    };

    // Validate the structure before saving
    console.log('Updated config for station:', stationIdStr, updatedConfig);
    console.log('Full configs to save:', JSON.stringify(updatedConfigs, null, 2));
    
    saveStationConfigs(updatedConfigs);

    // If we're adding the item, initialize with default quantity
    if (!isCurrentlyAvailable) {
      const item = inventory[category]?.find(i => i.id === itemId);
      if (item) {
        // Set default quantity based on category
        const defaultQuantity = category === 'milk' ? 5 : 
                               category === 'coffee' ? 2 : 
                               category === 'cups' ? 50 : 10;
        console.log(`Setting default quantity ${defaultQuantity} for new item ${item.name} (${itemId}) in category ${category}`);
        updateStationItemQuantity(stationId, category, itemId, defaultQuantity);
      }
    }
  };

  // Set all items in category for station
  const setAllItemsInCategory = (stationId, category, available) => {
    const currentConfig = getStationConfig(stationId);
    const categoryItems = {};
    
    inventory[category]?.forEach(item => {
      if (item.enabled) {
        categoryItems[item.id] = available;
      }
    });

    const updatedConfig = {
      ...currentConfig,
      [category]: categoryItems
    };

    const updatedConfigs = {
      ...stationConfigs,
      [stationId]: updatedConfig
    };

    saveStationConfigs(updatedConfigs);
  };

  // Get all items across all categories for filtering
  const getAllItems = () => {
    const allItems = [];
    Object.keys(inventory).forEach(category => {
      inventory[category]?.forEach(item => {
        if (item.enabled) {
          allItems.push({
            ...item,
            category,
            categoryName: categories[category]?.name || category
          });
        }
      });
    });
    return allItems;
  };

  // Filter items based on search and filters
  const getFilteredItems = () => {
    let items = getAllItems();

    // Filter by search term
    if (searchTerm) {
      items = items.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.categoryName.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by category
    if (filterCategory !== 'all') {
      items = items.filter(item => item.category === filterCategory);
    }

    // Filter by availability
    if (filterAvailability !== 'all' && selectedStation) {
      const stationConfig = getStationConfig(selectedStation.id);
      items = items.filter(item => {
        const isAvailable = stationConfig[item.category]?.[item.id] || false;
        return filterAvailability === 'available' ? isAvailable : !isAvailable;
      });
    }

    return items;
  };

  // Get station stats
  const getStationStats = (stationId) => {
    const config = getStationConfig(stationId);
    let totalAvailable = 0;
    let totalItems = 0;

    Object.keys(inventory).forEach(category => {
      inventory[category]?.forEach(item => {
        if (item.enabled) {
          totalItems++;
          if (config[category]?.[item.id]) {
            totalAvailable++;
          }
        }
      });
    });

    return { available: totalAvailable, total: totalItems };
  };

  // Copy config from another station
  const copyConfigFromStation = (fromStationId, toStationId) => {
    const fromConfig = getStationConfig(fromStationId);
    const updatedConfigs = {
      ...stationConfigs,
      [toStationId]: JSON.parse(JSON.stringify(fromConfig))
    };
    saveStationConfigs(updatedConfigs);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Station Inventory Configuration</h2>
      </div>
      
      <div className="grid grid-cols-12 gap-6">
        {/* Station Selector */}
        <div className="col-span-3">
          <h3 className="text-lg font-semibold mb-4 text-gray-700">Select Station</h3>
          <div className="space-y-2">
            {stations.map(station => {
              const stats = getStationStats(station.id);
              return (
                <button
                  key={station.id}
                  onClick={() => setSelectedStation(station)}
                  className={`w-full text-left p-3 rounded-md transition-colors ${
                    selectedStation?.id === station.id
                      ? 'bg-blue-100 border border-blue-300'
                      : 'bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{station.name}</div>
                      {station.location && (
                        <div className="text-sm text-gray-500">{station.location}</div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {stats.available}/{stats.total}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          
          {selectedStation && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Quick Actions</h4>
              <div className="space-y-2">
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      copyConfigFromStation(parseInt(e.target.value), selectedStation.id);
                      e.target.value = '';
                    }
                  }}
                  className="w-full text-sm px-2 py-1 border border-gray-300 rounded"
                >
                  <option value="">Copy from station...</option>
                  {stations
                    .filter(s => s.id !== selectedStation.id)
                    .map(station => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="col-span-9">
          {selectedStation ? (
            <>
              {/* Header */}
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center">
                  <Coffee className="mr-2 text-blue-600" />
                  <h3 className="text-xl font-semibold">
                    Configure {selectedStation.name}
                  </h3>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-sm text-gray-500">
                    {(() => {
                      const stats = getStationStats(selectedStation.id);
                      return `${stats.available} of ${stats.total} items available`;
                    })()}
                  </div>
                  <button
                    onClick={() => {
                      console.log('Manual sync triggered');
                      InventoryIntegrationService.forceSyncAllStations();
                    }}
                    className="px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                    title="Sync configurations to barista stations"
                  >
                    Sync to Stations
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="relative">
                  <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search items..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Categories</option>
                  {Object.entries(categories).map(([key, category]) => (
                    <option key={key} value={key}>{category.name}</option>
                  ))}
                </select>
                <select
                  value={filterAvailability}
                  onChange={(e) => setFilterAvailability(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="all">All Items</option>
                  <option value="available">Available Only</option>
                  <option value="unavailable">Unavailable Only</option>
                </select>
              </div>

              {/* Category Quick Actions */}
              <div className="bg-gray-50 rounded-md p-4 mb-4">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Category Quick Actions</h4>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(categories).map(([categoryKey, category]) => {
                    const categoryItems = inventory[categoryKey]?.filter(item => item.enabled) || [];
                    const config = getStationConfig(selectedStation.id);
                    const availableCount = categoryItems.filter(item => 
                      config[categoryKey]?.[item.id]
                    ).length;

                    return (
                      <div key={categoryKey} className="flex items-center justify-between p-2 bg-white rounded border">
                        <span className="text-sm font-medium">{category.name}</span>
                        <div className="flex space-x-1">
                          <span className="text-xs text-gray-500">
                            {availableCount}/{categoryItems.length}
                          </span>
                          <button
                            onClick={() => setAllItemsInCategory(selectedStation.id, categoryKey, true)}
                            className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                          >
                            All
                          </button>
                          <button
                            onClick={() => setAllItemsInCategory(selectedStation.id, categoryKey, false)}
                            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            None
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                {getFilteredItems().map(item => {
                  const stationConfig = getStationConfig(selectedStation.id);
                  const isAvailable = stationConfig[item.category]?.[item.id] || false;
                  
                  // Debug log for specific items
                  if (item.name === 'Latte' || item.name === 'Small' || item.name === 'Medium') {
                    console.log(`Item ${item.name} (${item.id}) availability for station ${selectedStation.id}:`, isAvailable, 'Config:', stationConfig[item.category]);
                  }
                  const currentQuantity = getStationItemQuantity(selectedStation.id, item.category, item.id);
                  
                  // Debug quantity loading for specific items
                  if (item.name.includes('Latte') || item.name.includes('Small')) {
                    const stationIdStr = String(selectedStation.id);
                    console.log(`Getting quantity for ${item.name} (${item.id}) at station ${selectedStation.id}:`, {
                      stationId: selectedStation.id,
                      stationIdStr,
                      fullInventory: stationInventory,
                      stationInventory: stationInventory[stationIdStr],
                      categoryData: stationInventory[stationIdStr]?.[item.category],
                      itemData: stationInventory[stationIdStr]?.[item.category]?.[item.id],
                      currentQuantity
                    });
                  }
                  
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
                    >
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => toggleItemForStation(selectedStation.id, item.category, item.id)}
                          className={`p-2 rounded-md border-2 transition-colors ${
                            isAvailable 
                              ? 'bg-green-50 border-green-500 text-green-600 hover:bg-green-100' 
                              : 'bg-gray-50 border-gray-300 text-gray-400 hover:bg-gray-100 hover:border-gray-400'
                          }`}
                          title={isAvailable ? 'Click to disable for this station' : 'Click to enable for this station'}
                        >
                          {isAvailable ? <CheckCircle size={18} /> : <Circle size={18} />}
                        </button>
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-900">{item.name}</h4>
                          <p className="text-sm text-gray-600">{item.description}</p>
                          {isAvailable && (
                            <div className="mt-1 flex items-center space-x-2">
                              <span className="text-xs text-gray-500">Quantity:</span>
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => updateStationItemQuantity(
                                    selectedStation.id, 
                                    item.category, 
                                    item.id, 
                                    currentQuantity - 1
                                  )}
                                  disabled={currentQuantity <= 0}
                                  className="w-6 h-6 flex items-center justify-center text-xs bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <Minus size={12} />
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={currentQuantity}
                                  onChange={(e) => updateStationItemQuantity(
                                    selectedStation.id,
                                    item.category,
                                    item.id,
                                    parseInt(e.target.value) || 0
                                  )}
                                  className="w-16 px-1 py-0.5 text-xs text-center border border-gray-300 rounded"
                                />
                                <button
                                  onClick={() => updateStationItemQuantity(
                                    selectedStation.id,
                                    item.category,
                                    item.id,
                                    currentQuantity + 1
                                  )}
                                  className="w-6 h-6 flex items-center justify-center text-xs bg-gray-200 rounded hover:bg-gray-300"
                                >
                                  <Plus size={12} />
                                </button>
                                <span className="text-xs text-gray-500 ml-2">
                                  {item.unit || (item.category === 'milk' ? 'L' : 
                                              item.category === 'coffee' ? 'kg' : 'units')}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          categories[item.category] 
                            ? `bg-${categories[item.category].color}-100 text-${categories[item.category].color}-800`
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {item.categoryName}
                        </span>
                        {isAvailable && (
                          <button
                            onClick={() => removeItemFromStation(selectedStation.id, item.category, item.id)}
                            className="p-1 text-red-500 hover:bg-red-100 rounded"
                            title="Remove from station"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className={`w-3 h-3 rounded-full ${
                          isAvailable ? 'bg-green-500' : 'bg-gray-300'
                        }`} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {getFilteredItems().length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  <Package size={48} className="mx-auto mb-4 text-gray-400" />
                  <p>No items found</p>
                  {searchTerm && (
                    <p className="text-sm">Try adjusting your search or filters</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Settings size={48} className="mx-auto mb-4 text-gray-400" />
              <p>Select a station to configure its available inventory</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StationInventoryConfig;