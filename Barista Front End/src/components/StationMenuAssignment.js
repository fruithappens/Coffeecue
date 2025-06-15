import React, { useState, useEffect } from 'react';
import useStations from '../hooks/useStations';

const StationMenuAssignment = () => {
  const { stations, updateStation } = useStations();
  const [menuItems, setMenuItems] = useState({});
  const [stationMenus, setStationMenus] = useState({});
  const [expandedStations, setExpandedStations] = useState({});

  // Load menu items from localStorage
  useEffect(() => {
    const savedMenu = localStorage.getItem('coffeeMenu');
    if (savedMenu) {
      try {
        const menu = JSON.parse(savedMenu);
        setMenuItems(menu);
      } catch (error) {
        console.error('Error loading coffee menu:', error);
      }
    }
  }, []);

  // Load station menu assignments from localStorage
  useEffect(() => {
    const savedAssignments = localStorage.getItem('stationMenuAssignments');
    if (savedAssignments) {
      try {
        setStationMenus(JSON.parse(savedAssignments));
      } catch (error) {
        console.error('Error loading station menu assignments:', error);
      }
    } else if (stations && stations.length > 0 && Object.keys(menuItems).length > 0) {
      // Initialize with all items enabled for all stations
      const initialAssignments = {};
      stations.forEach(station => {
        initialAssignments[station.id] = {};
        Object.keys(menuItems).forEach(itemId => {
          initialAssignments[station.id][itemId] = {
            enabled: true,
            availableSizes: Object.keys(menuItems[itemId]?.sizes || {})
          };
        });
      });
      setStationMenus(initialAssignments);
    }
  }, [stations, menuItems]);

  // Save to localStorage whenever assignments change
  useEffect(() => {
    if (Object.keys(stationMenus).length > 0) {
      localStorage.setItem('stationMenuAssignments', JSON.stringify(stationMenus));
      
      // Dispatch event for other components
      window.dispatchEvent(new CustomEvent('stationMenus:updated', { 
        detail: { stationMenus } 
      }));
    }
  }, [stationMenus]);

  const toggleStation = (stationId) => {
    setExpandedStations(prev => ({
      ...prev,
      [stationId]: !prev[stationId]
    }));
  };

  const toggleMenuItem = (stationId, itemId) => {
    setStationMenus(prev => {
      const updated = { ...prev };
      if (!updated[stationId]) {
        updated[stationId] = {};
      }
      if (!updated[stationId][itemId]) {
        updated[stationId][itemId] = {
          enabled: true,
          availableSizes: Object.keys(menuItems[itemId]?.sizes || {})
        };
      } else {
        updated[stationId][itemId] = {
          ...updated[stationId][itemId],
          enabled: !updated[stationId][itemId].enabled
        };
      }
      return updated;
    });
  };

  const toggleSize = (stationId, itemId, size) => {
    setStationMenus(prev => {
      const updated = { ...prev };
      if (!updated[stationId]?.[itemId]) {
        return prev;
      }
      
      const currentSizes = updated[stationId][itemId].availableSizes || [];
      if (currentSizes.includes(size)) {
        updated[stationId][itemId].availableSizes = currentSizes.filter(s => s !== size);
      } else {
        updated[stationId][itemId].availableSizes = [...currentSizes, size];
      }
      
      return updated;
    });
  };

  const toggleAllItems = (stationId, enabled) => {
    setStationMenus(prev => {
      const updated = { ...prev };
      updated[stationId] = {};
      Object.keys(menuItems).forEach(itemId => {
        updated[stationId][itemId] = {
          enabled,
          availableSizes: enabled ? Object.keys(menuItems[itemId]?.sizes || {}) : []
        };
      });
      return updated;
    });
  };

  const getStationCapabilities = (station) => {
    const capabilities = [];
    if (station.capabilities?.coffeeTypes?.length > 0) {
      capabilities.push(`Coffee: ${station.capabilities.coffeeTypes.join(', ')}`);
    }
    if (station.capabilities?.milkOptions?.length > 0) {
      capabilities.push(`Milk: ${station.capabilities.milkOptions.join(', ')}`);
    }
    return capabilities;
  };

  const getEnabledCount = (stationId) => {
    const stationMenu = stationMenus[stationId] || {};
    return Object.values(stationMenu).filter(item => item.enabled).length;
  };

  const getCategoryDrinks = (category) => {
    return Object.entries(menuItems).filter(([_, item]) => 
      item.category === category && item.enabled
    );
  };

  const categories = [
    { id: 'espresso-based', name: 'Espresso Based' },
    { id: 'milk-based', name: 'Milk Based' },
    { id: 'cold-drinks', name: 'Cold Drinks' },
    { id: 'tea', name: 'Tea' },
    { id: 'non-coffee', name: 'Non-Coffee' }
  ];

  const cupSizeLabels = {
    'small-8oz': '8oz',
    'regular-12oz': '12oz',
    'large-16oz': '16oz'
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Station Menu Assignment</h3>
        <p className="text-sm text-blue-700">
          Configure which drinks each station can make. This affects what customers can order
          based on available stations and their capabilities.
        </p>
      </div>

      {!stations || stations.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No stations available. Add stations to configure their menus.
        </div>
      ) : (
        <div className="space-y-4">
          {stations.map(station => (
            <div key={station.id} className="bg-white rounded-lg shadow-sm border border-gray-200">
              <div 
                className="p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleStation(station.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900">
                      {station.name}
                      <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                        station.status === 'active' 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {station.status}
                      </span>
                    </h4>
                    <div className="text-sm text-gray-600 mt-1">
                      {getStationCapabilities(station).join(' • ')}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {getEnabledCount(station.id)} of {Object.keys(menuItems).length} items enabled
                    </div>
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform ${
                      expandedStations[station.id] ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {expandedStations[station.id] && (
                <div className="border-t border-gray-200 p-4">
                  <div className="flex justify-between items-center mb-4">
                    <h5 className="font-medium text-gray-700">Available Menu Items</h5>
                    <div className="space-x-2">
                      <button
                        onClick={() => toggleAllItems(station.id, true)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Enable All
                      </button>
                      <button
                        onClick={() => toggleAllItems(station.id, false)}
                        className="text-sm text-red-600 hover:text-red-800"
                      >
                        Disable All
                      </button>
                    </div>
                  </div>

                  <div className="space-y-6">
                    {categories.map(category => {
                      const drinks = getCategoryDrinks(category.id);
                      if (drinks.length === 0) return null;

                      return (
                        <div key={category.id}>
                          <h6 className="text-sm font-medium text-gray-600 mb-2">
                            {category.name}
                          </h6>
                          <div className="space-y-2">
                            {drinks.map(([itemId, item]) => {
                              const isEnabled = stationMenus[station.id]?.[itemId]?.enabled;
                              const availableSizes = stationMenus[station.id]?.[itemId]?.availableSizes || [];

                              return (
                                <div key={itemId} className="border border-gray-200 rounded-lg p-3">
                                  <div className="flex items-center justify-between">
                                    <label className="flex items-center cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={isEnabled || false}
                                        onChange={() => toggleMenuItem(station.id, itemId)}
                                        className="mr-3 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                      />
                                      <span className={`font-medium ${isEnabled ? 'text-gray-900' : 'text-gray-500'}`}>
                                        {item.name}
                                      </span>
                                    </label>
                                  </div>

                                  {isEnabled && item.sizes && Object.keys(item.sizes).length > 1 && (
                                    <div className="mt-2 ml-7">
                                      <div className="text-sm text-gray-600 mb-1">Available sizes:</div>
                                      <div className="flex flex-wrap gap-2">
                                        {Object.entries(item.sizes).map(([size, sizeConfig]) => {
                                          if (!sizeConfig.enabled) return null;
                                          const isSelected = availableSizes.includes(size);
                                          return (
                                            <button
                                              key={size}
                                              onClick={() => toggleSize(station.id, itemId, size)}
                                              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                                                isSelected
                                                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                                  : 'bg-gray-100 text-gray-600 border border-gray-300'
                                              }`}
                                            >
                                              {cupSizeLabels[sizeConfig.cupSize] || size}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StationMenuAssignment;