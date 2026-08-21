// components/StationDefaults.js
import React, { useState, useEffect } from 'react';
import { Coffee, Settings, Save, AlertTriangle } from 'lucide-react';
import useStations from '../../hooks/useStations';
import { DEFAULT_MILK_TYPES } from '../../utils/milkConfig';
import useCatalog from '../../hooks/useCatalog';
import ApiServiceClass from '../../services/ApiService';

// Backend-backed station defaults — the previous version saved only
// to localStorage, so defaults vanished when an operator switched
// browsers or devices. Now /api/station-defaults persists to the
// settings table.
const apiService = new ApiServiceClass();

// `stationId` embeds this inside Station Settings as a section of the
// station you are already editing: one station selector on the page, not
// two. Called with no prop it still stands alone with its own picker.
const StationDefaults = ({ stationId = null }) => {
  const embedded = stationId !== null && stationId !== undefined;
  const { stations } = useStations();
  const [stationDefaults, setStationDefaults] = useState({});
  const [selectedStation, setSelectedStation] = useState(stationId ?? null);

  // Follow the station Station Settings is editing.
  useEffect(() => {
    if (embedded) setSelectedStation(stationId);
  }, [embedded, stationId]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Canonical milk list from /api/catalog/milk. Falls back to
  // DEFAULT_MILK_TYPES (the legacy hardcoded list) only if the
  // catalog endpoint is unreachable. Once catalog is reliably
  // populated in production, DEFAULT_MILK_TYPES can be deleted.
  const { items: catalogMilksRaw } = useCatalog('milk');
  const milkOptions = (Array.isArray(catalogMilksRaw) && catalogMilksRaw.length > 0)
    ? catalogMilksRaw.map(c => ({
        id: c.id,
        name: c.name,
        category: c.subcategory || 'standard',
        properties: {
          lactoseFree: !!c.properties?.lactoseFree,
          lowFat: !!c.properties?.lowFat,
          vegan: !!c.properties?.vegan,
        },
      }))
    : DEFAULT_MILK_TYPES;
  
  // Available options
  const [coffeeMenu, setCoffeeMenu] = useState({});
  const [stationMenuAssignments, setStationMenuAssignments] = useState({});
  const [stationInventories, setStationInventories] = useState({});
  
  useEffect(() => {
    loadData();
  }, []);
  
  const loadData = async () => {
    try {
      // Backend first; fall back to localStorage if the API isn't
      // reachable so the UI still works offline.
      let defaults = null;
      try {
        const resp = await apiService.request('/station-defaults', { method: 'GET' });
        if (resp && typeof resp === 'object') {
          defaults = resp;
        }
      } catch (apiErr) {
        console.warn('station-defaults API unavailable, using localStorage:', apiErr.message);
      }
      if (!defaults) {
        const savedDefaults = localStorage.getItem('stationDefaults');
        if (savedDefaults) defaults = JSON.parse(savedDefaults);
      }
      if (defaults) {
        setStationDefaults(defaults);
        // Mirror to localStorage so the next load is instant.
        localStorage.setItem('stationDefaults', JSON.stringify(defaults));
      }

      // Load coffee menu
      const menuData = localStorage.getItem('coffeeMenu');
      if (menuData) {
        setCoffeeMenu(JSON.parse(menuData));
      }
      
      // Load station menu assignments
      const assignmentData = localStorage.getItem('stationMenuAssignments');
      if (assignmentData) {
        setStationMenuAssignments(JSON.parse(assignmentData));
      }
      
      // Load station inventory configurations
      const inventoryData = localStorage.getItem('stationInventoryConfig');
      if (inventoryData) {
        setStationInventories(JSON.parse(inventoryData));
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading station defaults data:', error);
      setLoading(false);
    }
  };
  
  const saveDefaults = async () => {
    setSaving(true);
    // Always save to localStorage so reloads on the same browser are
    // instant even before the API call completes. Then push to the
    // backend so other devices / operators get the same defaults.
    try {
      localStorage.setItem('stationDefaults', JSON.stringify(stationDefaults));
      try {
        const resp = await apiService.request('/station-defaults', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stationDefaults),
        });
        if (resp && resp.success) {
          setSaveMessage('Station defaults saved (synced to server).');
        } else {
          setSaveMessage('Saved locally — server save returned an error.');
        }
      } catch (apiErr) {
        setSaveMessage('Saved locally — server unreachable, will not sync across devices.');
        console.warn('station-defaults PUT failed:', apiErr.message);
      }
      setTimeout(() => setSaveMessage(''), 4000);
    } catch (error) {
      console.error('Error saving station defaults:', error);
      setSaveMessage('Error saving station defaults');
      setTimeout(() => setSaveMessage(''), 3000);
    } finally {
      setSaving(false);
    }
  };
  
  const updateStationDefault = (stationId, field, value) => {
    setStationDefaults(prev => ({
      ...prev,
      [stationId]: {
        ...prev[stationId],
        [field]: value
      }
    }));
  };
  
  const getStationCoffeeOptions = (stationId) => {
    const stationMenu = stationMenuAssignments[stationId] || {};
    const availableOptions = [];
    
    Object.entries(coffeeMenu).forEach(([drinkId, drink]) => {
      // Check if drink is enabled at event level
      if (!drink.enabled) return;
      
      // Check if drink is enabled at station level
      if (stationMenu[drinkId] && !stationMenu[drinkId].enabled) return;
      
      availableOptions.push(drink.name);
    });
    
    return availableOptions.length > 0 ? availableOptions : [
      'Espresso', 'Long Black', 'Flat White', 'Cappuccino', 'Latte', 'Mocha'
    ];
  };
  
  const getCurrentDefaults = (stationId) => {
    const defaults = stationDefaults[stationId] || {
      coffeeType: 'Flat White',
      size: 'Regular',
      milkType: 'full_cream',
      sweetenerType: 'None',
      sweetenerQuantity: '0',
      shots: '1',
      beanType: ''
    };
    
    // Set default bean type from first available if not set
    if (!defaults.beanType) {
      const beanTypes = getStationBeanTypes(stationId);
      if (beanTypes.length > 0) {
        defaults.beanType = beanTypes[0];
      }
    }
    
    return defaults;
  };
  
  const getStationBeanTypes = (stationId) => {
    const beanTypes = [];
    const stationInventory = stationInventories[stationId];

    // Guard: stationInventory.coffee can be undefined OR an object
    // (older shape) instead of an array. Steve hit the crash:
    // 'stationInventory.coffee.forEach is not a function'. Treat
    // anything non-array as no-data and bail safely.
    const coffeeList = stationInventory && Array.isArray(stationInventory.coffee)
      ? stationInventory.coffee
      : null;

    if (coffeeList) {
      coffeeList.forEach(item => {
        if (item && item.enabled) {
          let beanName = (item.name || '')
            .replace(/\s*(Coffee\s*)?Beans?\s*$/i, '')
            .trim();
          if (beanName && !beanTypes.includes(beanName)) {
            beanTypes.push(beanName);
          }
        }
      });
    }

    return beanTypes;
  };
  
  const getStationSweetenerTypes = (stationId) => {
    const sweetenerTypes = ['None']; // Always include None option
    const stationInventory = stationInventories[stationId];

    if (stationInventory) {
      // Same Array.isArray guards as getStationBeanTypes — these
      // category fields can be undefined or non-array shapes depending
      // on which stock source populated them.
      const sweeteners = Array.isArray(stationInventory.sweeteners)
        ? stationInventory.sweeteners : null;
      const other = Array.isArray(stationInventory.other)
        ? stationInventory.other : null;
      if (sweeteners) {
        sweeteners.forEach(item => {
          if (item && item.enabled) sweetenerTypes.push(item.name);
        });
      } else if (other) {
        other.forEach(item => {
          if (item && item.enabled && (
            item.name.toLowerCase().includes('sugar') ||
            item.name.toLowerCase().includes('honey') ||
            item.name.toLowerCase().includes('sweetener')
          )) {
            sweetenerTypes.push(item.name);
          }
        });
      }
    }

    return sweetenerTypes;
  };

  const getStationCupSizes = (stationId) => {
    const cupSizes = [];
    const stationInventory = stationInventories[stationId];

    const cupsList = stationInventory && Array.isArray(stationInventory.cups)
      ? stationInventory.cups : null;
    if (cupsList) {
      cupsList.forEach(item => {
        if (item && item.enabled) cupSizes.push(item.name);
      });
    }
    
    // Return found cup sizes or default options
    return cupSizes.length > 0 ? cupSizes : [
      'Small Cup', 'Regular Cup', 'Large Cup', 
      'Takeaway Small', 'Takeaway Medium', 'Takeaway Large', 'Ceramic Cup'
    ];
  };
  
  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-green-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading station defaults...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className={embedded ? '' : 'p-6 max-w-4xl mx-auto'}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <Settings size={24} className="text-green-600 mr-2" />
          {embedded ? (
            <h4 className="text-lg font-medium text-gray-800">Walk-in defaults</h4>
          ) : (
            <h2 className="text-2xl font-bold text-gray-800">Station Default Settings</h2>
          )}
        </div>
        <button
          onClick={saveDefaults}
          disabled={saving}
          className={`flex items-center px-4 py-2 rounded-md text-white ${
            saving ? 'bg-gray-400' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          <Save size={16} className="mr-2" />
          {saving ? 'Saving...' : 'Save Defaults'}
        </button>
      </div>
      
      {saveMessage && (
        <div className={`mb-4 p-3 rounded-md ${
          saveMessage.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}>
          {saveMessage}
        </div>
      )}
      
      {!embedded && (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <div className="flex items-start">
          <AlertTriangle size={20} className="text-blue-600 mr-2 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-800 mb-1">About Station Defaults</h3>
            <p className="text-blue-700 text-sm">
              Configure default selections for walk-in orders at each station. These settings will 
              pre-populate the walk-in order form to speed up order entry. Baristas can still 
              modify these selections for individual orders.
            </p>
          </div>
        </div>
      </div>
      )}

      {/* Station Selection — hidden when embedded in Station Settings,
          which already has a picker */}
      {!embedded && (
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Station to Configure
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {stations.map(station => (
            <button
              key={station.id}
              onClick={() => setSelectedStation(station.id)}
              className={`p-3 rounded-lg border-2 text-left transition-colors ${
                selectedStation === station.id
                  ? 'border-green-500 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center">
                <Coffee size={16} className="mr-2" />
                <div>
                  <div className="font-medium">{station.name || `Station ${station.id}`}</div>
                  <div className="text-xs text-gray-500">
                    {stationDefaults[station.id] ? 'Configured' : 'Default settings'}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      
      )}

      {/* Station Configuration */}
      {selectedStation && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold mb-4 flex items-center">
            <Coffee size={20} className="mr-2 text-green-600" />
            Configure Defaults for{' '}
            {stations.find(s => s.id === selectedStation)?.name || `Station ${selectedStation}`}
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Coffee Type
              </label>
              <select
                value={getCurrentDefaults(selectedStation).coffeeType}
                onChange={(e) => updateStationDefault(selectedStation, 'coffeeType', e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                {getStationCoffeeOptions(selectedStation).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Size
              </label>
              <select
                value={getCurrentDefaults(selectedStation).size}
                onChange={(e) => updateStationDefault(selectedStation, 'size', e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                {getStationCupSizes(selectedStation).map(size => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Milk Type
              </label>
              <select
                value={getCurrentDefaults(selectedStation).milkType}
                onChange={(e) => updateStationDefault(selectedStation, 'milkType', e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                <optgroup label="Standard Milks">
                  {milkOptions
                    .filter(milk => milk.category === 'standard')
                    .map(milk => (
                      <option key={milk.id} value={milk.id}>
                        {milk.name}
                        {milk.properties.lactoseFree ? ' (Lactose-Free)' : ''}
                        {milk.properties.lowFat ? ' (Low-Fat)' : ''}
                      </option>
                    ))
                  }
                </optgroup>
                <optgroup label="Alternative Milks">
                  {milkOptions
                    .filter(milk => milk.category === 'alternative')
                    .map(milk => (
                      <option key={milk.id} value={milk.id}>
                        {milk.name}
                        {milk.properties.vegan ? ' (Vegan)' : ''}
                      </option>
                    ))
                  }
                </optgroup>
                <option value="no_milk">No milk</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Espresso Shots
              </label>
              <select
                value={getCurrentDefaults(selectedStation).shots}
                onChange={(e) => updateStationDefault(selectedStation, 'shots', e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                <option value="0.5">Half shot (1/2)</option>
                <option value="1">Single shot</option>
                <option value="2">Double shot</option>
                <option value="3">Triple shot</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Bean Type
              </label>
              {getStationBeanTypes(selectedStation).length > 0 ? (
                <select
                  value={getCurrentDefaults(selectedStation).beanType}
                  onChange={(e) => updateStationDefault(selectedStation, 'beanType', e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
                >
                  {getStationBeanTypes(selectedStation).map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              ) : (
                <p className="p-3 bg-gray-100 text-gray-600 rounded-md">
                  No coffee beans configured for this station. Please add coffee items to the station inventory.
                </p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Default Sweetener Type
              </label>
              <select
                value={getCurrentDefaults(selectedStation).sweetenerType}
                onChange={(e) => updateStationDefault(selectedStation, 'sweetenerType', e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-green-500 focus:border-green-500"
              >
                {getStationSweetenerTypes(selectedStation).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-800 mb-2">Preview Default Order</h4>
            <div className="text-sm text-gray-600">
              <p><strong>Coffee:</strong> {getCurrentDefaults(selectedStation).coffeeType}</p>
              <p><strong>Size:</strong> {getCurrentDefaults(selectedStation).size}</p>
              <p><strong>Milk:</strong> {
                milkOptions.find(m => m.id === getCurrentDefaults(selectedStation).milkType)?.name || 'No milk'
              }</p>
              <p><strong>Shots:</strong> {getCurrentDefaults(selectedStation).shots}</p>
              <p><strong>Bean Type:</strong> {getCurrentDefaults(selectedStation).beanType}</p>
              <p><strong>Sweetener:</strong> {getCurrentDefaults(selectedStation).sweetenerType}</p>
            </div>
          </div>
        </div>
      )}
      
      {!selectedStation && (
        <div className="text-center py-8 text-gray-500">
          <Settings size={48} className="mx-auto mb-2 text-gray-400" />
          <p>Select a station above to configure its default settings</p>
        </div>
      )}
    </div>
  );
};

export default StationDefaults;