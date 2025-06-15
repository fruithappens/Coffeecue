import React, { useState, useEffect } from 'react';
import { 
  Package, Plus, Minus, Save, AlertCircle, Check,
  Coffee, Droplet, Square, Candy, Beaker, Package2
} from 'lucide-react';

/**
 * Event Stock Management Component
 * Manages total stock levels for the entire event
 */
const EventStockManagement = () => {
  const [eventStock, setEventStock] = useState({});
  const [inventory, setInventory] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Category definitions with units
  const categoryUnits = {
    milk: { unit: 'L', defaultQuantity: 10, step: 1 },
    coffee: { unit: 'kg', defaultQuantity: 5, step: 0.5 },
    cups: { unit: 'units', defaultQuantity: 100, step: 50 },
    syrups: { unit: 'bottles', defaultQuantity: 5, step: 1 },
    sweeteners: { unit: 'units', defaultQuantity: 100, step: 10 },
    extras: { unit: 'units', defaultQuantity: 50, step: 10 }
  };

  // Load data on mount
  useEffect(() => {
    loadInventory();
    loadEventStock();
  }, []);

  // Auto-initialize event stock when inventory loads but no event stock exists
  useEffect(() => {
    if (inventory && Object.keys(inventory).length > 0) {
      const savedStock = localStorage.getItem('event_stock_levels');
      if (!savedStock) {
        console.log('EventStockManagement: Auto-initializing event stock with current station allocations');
        initializeDefaultStock();
      }
    }
  }, [inventory]);

  // Calculate allocated amounts when both eventStock and inventory are loaded
  useEffect(() => {
    if (eventStock && Object.keys(eventStock).length > 0 && inventory && Object.keys(inventory).length > 0) {
      console.log('EventStockManagement: Both eventStock and inventory loaded, calculating allocated amounts');
      updateAllocatedAmounts();
    }
  }, [eventStock, inventory]); // Trigger when either loads

  // Listen for station inventory updates
  useEffect(() => {
    const handleStationInventoryUpdate = () => {
      updateAllocatedAmounts();
    };

    window.addEventListener('stationInventory:updated', handleStationInventoryUpdate);
    return () => window.removeEventListener('stationInventory:updated', handleStationInventoryUpdate);
  }, [eventStock]);

  // Load inventory from localStorage
  const loadInventory = () => {
    const savedInventory = localStorage.getItem('event_inventory');
    if (savedInventory) {
      try {
        setInventory(JSON.parse(savedInventory));
      } catch (e) {
        console.error('Error loading inventory:', e);
      }
    }
  };

  // Load event stock levels
  const loadEventStock = () => {
    const savedStock = localStorage.getItem('event_stock_levels');
    if (savedStock) {
      try {
        const parsedStock = JSON.parse(savedStock);
        setEventStock(parsedStock);
        console.log('EventStockManagement: Loaded existing event stock from localStorage');
      } catch (e) {
        console.error('Error loading event stock:', e);
        // Only initialize if we truly can't load existing data
        if (inventory && Object.keys(inventory).length > 0) {
          initializeDefaultStock();
        }
      }
    } else {
      console.log('EventStockManagement: No saved event stock found - will auto-initialize when inventory loads');
      // Don't initialize here - wait for inventory to load first
    }
  };

  // Initialize with default stock levels for enabled items (preserve existing values)
  const initializeDefaultStock = () => {
    const defaultStock = {};
    
    // Get existing event stock to preserve quantities and allocated amounts
    const existingStock = eventStock || {};
    
    // Load current station quantities to calculate initial allocated amounts
    const stationQuantities = getStationQuantities();
    
    Object.entries(inventory).forEach(([category, items]) => {
      defaultStock[category] = {};
      items?.forEach(item => {
        if (item.enabled) {
          // Check if we already have data for this item - if so, preserve it
          const existingItem = existingStock[category]?.[item.id];
          
          if (existingItem) {
            // Preserve existing quantities and allocated amounts
            defaultStock[category][item.id] = {
              ...existingItem,
              unit: categoryUnits[category]?.unit || existingItem.unit || 'units'
            };
          } else {
            // Calculate allocated amount from current station quantities
            let allocatedAmount = 0;
            Object.keys(stationQuantities).forEach(stationId => {
              const stationData = stationQuantities[stationId];
              if (stationData[category] && stationData[category][item.id]) {
                allocatedAmount += stationData[category][item.id].quantity || 0;
              }
            });
            
            // Set quantity to be at least enough to cover allocated amount + buffer
            const defaultQuantity = categoryUnits[category]?.defaultQuantity || 10;
            const totalQuantity = Math.max(defaultQuantity, allocatedAmount * 2);
            
            defaultStock[category][item.id] = {
              quantity: totalQuantity,
              unit: categoryUnits[category]?.unit || 'units',
              allocated: allocatedAmount, // Set initial allocated from station quantities
              available: totalQuantity - allocatedAmount
            };
            
            if (allocatedAmount > 0) {
              console.log(`EventStockManagement: Auto-calculated ${item.name} allocated: ${allocatedAmount}`);
            }
          }
        }
      });
    });
    
    setEventStock(defaultStock);
    console.log('EventStockManagement: Initialized stock with auto-calculated allocations:', defaultStock);
  };

  // Helper function to get station quantities
  const getStationQuantities = () => {
    try {
      const quantities = localStorage.getItem('station_inventory_quantities');
      return quantities ? JSON.parse(quantities) : {};
    } catch (error) {
      console.error('Error loading station quantities:', error);
      return {};
    }
  };

  // Update stock quantity
  const updateStockQuantity = (category, itemId, newQuantity) => {
    const updatedStock = {
      ...eventStock,
      [category]: {
        ...eventStock[category],
        [itemId]: {
          ...eventStock[category]?.[itemId],
          quantity: Math.max(0, newQuantity),
          available: Math.max(0, newQuantity - (eventStock[category]?.[itemId]?.allocated || 0))
        }
      }
    };
    
    setEventStock(updatedStock);
    setHasChanges(true);
  };

  // Save event stock levels
  const saveEventStock = () => {
    try {
      localStorage.setItem('event_stock_levels', JSON.stringify(eventStock));
      setSaveMessage('Event stock levels saved successfully!');
      setHasChanges(false);
      
      // Notify other components
      window.dispatchEvent(new CustomEvent('eventStock:updated', { 
        detail: { eventStock } 
      }));
      
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (e) {
      console.error('Error saving event stock:', e);
      setSaveMessage('Error saving stock levels');
    }
  };

  // Calculate total allocated to stations for a specific item
  const calculateAllocated = (category, itemId) => {
    try {
      const stationQuantities = localStorage.getItem('station_inventory_quantities');
      if (!stationQuantities) {
        return 0;
      }

      const quantities = JSON.parse(stationQuantities);
      let totalAllocated = 0;

      // Sum up quantities from all stations for this item
      Object.keys(quantities).forEach(stationId => {
        const stationData = quantities[stationId];
        if (stationData[category] && stationData[category][itemId]) {
          const quantity = stationData[category][itemId].quantity || 0;
          totalAllocated += quantity;
        }
      });

      return totalAllocated;
    } catch (error) {
      console.error('Error calculating allocated amount:', error);
      return 0;
    }
  };

  // Update allocated amounts for all items in event stock
  const updateAllocatedAmounts = () => {
    if (!eventStock || Object.keys(eventStock).length === 0) {
      return;
    }

    const updatedStock = { ...eventStock };
    let hasUpdates = false;

    Object.keys(updatedStock).forEach(category => {
      Object.keys(updatedStock[category]).forEach(itemId => {
        const newAllocated = calculateAllocated(category, itemId);
        const currentStock = updatedStock[category][itemId];
        
        if (currentStock.allocated !== newAllocated) {
          updatedStock[category][itemId] = {
            ...currentStock,
            allocated: newAllocated,
            available: Math.max(0, currentStock.quantity - newAllocated)
          };
          hasUpdates = true;
        }
      });
    });

    if (hasUpdates) {
      setEventStock(updatedStock);
      console.log('Updated allocated amounts:', updatedStock);
    }
  };

  // Get stock summary for a category
  const getCategorySummary = (category) => {
    const items = eventStock[category] || {};
    let totalQuantity = 0;
    let totalAllocated = 0;
    let itemCount = 0;

    Object.values(items).forEach(item => {
      totalQuantity += item.quantity || 0;
      totalAllocated += item.allocated || 0;
      itemCount++;
    });

    return {
      itemCount,
      totalQuantity,
      totalAllocated,
      totalAvailable: totalQuantity - totalAllocated
    };
  };

  // Get category icon
  const getCategoryIcon = (category) => {
    switch (category) {
      case 'milk': return <Droplet size={20} />;
      case 'coffee': return <Coffee size={20} />;
      case 'cups': return <Square size={20} />;
      case 'syrups': return <Beaker size={20} />;
      case 'sweeteners': return <Candy size={20} />;
      case 'extras': return <Package size={20} />;
      default: return <Package2 size={20} />;
    }
  };

  // Get category color
  const getCategoryColor = (category) => {
    const colors = {
      milk: 'blue',
      coffee: 'amber',
      cups: 'green',
      syrups: 'purple',
      sweeteners: 'pink',
      extras: 'indigo'
    };
    return colors[category] || 'gray';
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Event Stock Management</h2>
            <p className="text-gray-600 mt-1">
              Manage total stock quantities for the entire event
            </p>
          </div>
          {hasChanges && (
            <button
              onClick={saveEventStock}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              <Save size={20} />
              Save Changes
            </button>
          )}
        </div>
        
        {saveMessage && (
          <div className={`mt-4 p-3 rounded-md flex items-center gap-2 ${
            saveMessage.includes('Error') 
              ? 'bg-red-100 text-red-700' 
              : 'bg-green-100 text-green-700'
          }`}>
            {saveMessage.includes('Error') ? <AlertCircle size={20} /> : <Check size={20} />}
            {saveMessage}
          </div>
        )}
      </div>

      {/* Stock Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {Object.entries(inventory).map(([category, items]) => {
          const summary = getCategorySummary(category);
          const color = getCategoryColor(category);
          const unit = categoryUnits[category]?.unit || 'units';
          
          return (
            <div key={category} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`p-2 bg-${color}-100 rounded-lg`}>
                    {getCategoryIcon(category)}
                  </div>
                  <h3 className="font-semibold capitalize">{category}</h3>
                </div>
                <span className="text-sm text-gray-500">
                  {summary.itemCount} items
                </span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Total Stock:</span>
                  <span className="font-medium">{summary.totalQuantity} {unit}</span>
                </div>
                <div className="flex justify-between">
                  <span>Allocated:</span>
                  <span className="text-orange-600">{summary.totalAllocated} {unit}</span>
                </div>
                <div className="flex justify-between">
                  <span>Available:</span>
                  <span className="text-green-600 font-medium">
                    {summary.totalAvailable} {unit}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detailed Stock Management */}
      <div className="space-y-6">
        {Object.entries(inventory).map(([category, items]) => {
          const enabledItems = items?.filter(item => item.enabled) || [];
          if (enabledItems.length === 0) return null;
          
          const color = getCategoryColor(category);
          const unit = categoryUnits[category]?.unit || 'units';
          const step = categoryUnits[category]?.step || 1;
          
          return (
            <div key={category} className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div className={`px-6 py-4 bg-${color}-50 border-b border-${color}-200`}>
                <div className="flex items-center gap-2">
                  {getCategoryIcon(category)}
                  <h3 className="text-lg font-semibold capitalize">{category}</h3>
                  <span className="text-sm text-gray-600">({unit})</span>
                </div>
              </div>
              
              <div className="p-6">
                <div className="space-y-4">
                  {enabledItems.map(item => {
                    const stock = eventStock[category]?.[item.id] || {
                      quantity: 0,
                      allocated: 0,
                      available: 0
                    };
                    
                    return (
                      <div key={item.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                        <div className="flex-1">
                          <h4 className="font-medium">{item.name}</h4>
                          <p className="text-sm text-gray-600">{item.description}</p>
                          <div className="flex gap-4 mt-1 text-sm">
                            <span className="text-orange-600">
                              Allocated: {stock.allocated} {unit}
                            </span>
                            <span className="text-green-600">
                              Available: {stock.available} {unit}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => updateStockQuantity(
                              category, 
                              item.id, 
                              stock.quantity - step
                            )}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300 transition-colors"
                          >
                            <Minus size={16} />
                          </button>
                          
                          <div className="text-center">
                            <input
                              type="number"
                              min="0"
                              step={step}
                              value={stock.quantity}
                              onChange={(e) => updateStockQuantity(
                                category,
                                item.id,
                                parseFloat(e.target.value) || 0
                              )}
                              className="w-20 px-2 py-1 text-center border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <div className="text-xs text-gray-500 mt-1">{unit}</div>
                          </div>
                          
                          <button
                            onClick={() => updateStockQuantity(
                              category, 
                              item.id, 
                              stock.quantity + step
                            )}
                            className="w-8 h-8 flex items-center justify-center bg-gray-200 rounded hover:bg-gray-300 transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventStockManagement;