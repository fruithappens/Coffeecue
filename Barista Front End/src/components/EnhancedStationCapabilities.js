import React, { useState, useEffect, useCallback } from 'react';
import { User, Coffee, Award, Clock, AlertCircle, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useSettings from '../hooks/useSettings';

const EnhancedStationCapabilities = () => {
  const { stations, updateStation } = useStations();
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { settings } = useSettings();
  
  // Create ordersData object for backward compatibility
  const ordersData = {
    pending: pendingOrders || [],
    inProgress: inProgressOrders || [],
    completed: completedOrders || []
  };
  
  // Load saved settings from localStorage
  const loadSavedSettings = () => {
    try {
      const saved = localStorage.getItem('coffee_cue_enhanced_capabilities');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          baristaProfiles: parsed.baristaProfiles || {},
          skillRoutingEnabled: parsed.skillRoutingEnabled !== undefined ? parsed.skillRoutingEnabled : true
        };
      }
    } catch (error) {
      console.error('Error loading enhanced capabilities settings:', error);
    }
    return {
      baristaProfiles: {},
      skillRoutingEnabled: true
    };
  };
  
  const savedSettings = loadSavedSettings();
  const [selectedStation, setSelectedStation] = useState(null);
  const [baristaProfiles, setBaristaProfiles] = useState(savedSettings.baristaProfiles);
  const [expandedStation, setExpandedStation] = useState(null);
  const [skillRoutingEnabled, setSkillRoutingEnabled] = useState(savedSettings.skillRoutingEnabled);
  
  // Save settings whenever they change
  useEffect(() => {
    try {
      const settingsToSave = {
        baristaProfiles,
        skillRoutingEnabled
      };
      localStorage.setItem('coffee_cue_enhanced_capabilities', JSON.stringify(settingsToSave));
      console.log('Saved enhanced capabilities settings:', settingsToSave);
    } catch (error) {
      console.error('Error saving enhanced capabilities settings:', error);
    }
  }, [baristaProfiles, skillRoutingEnabled]);
  
  // Skill levels definition
  const skillLevels = {
    novice: {
      label: 'Novice',
      color: 'bg-gray-100 text-gray-700',
      borderColor: 'border-gray-300',
      allowedDrinks: ['espresso', 'long_black', 'cappuccino'],
      maxConcurrentOrders: 3,
      complexityLimit: 'simple',
      supportMode: 'detailed_instructions',
      description: 'Basic drinks only, detailed guidance provided'
    },
    experienced: {
      label: 'Experienced',
      color: 'bg-blue-100 text-blue-700',
      borderColor: 'border-blue-300',
      allowedDrinks: ['all_standard_drinks'],
      maxConcurrentOrders: 5,
      complexityLimit: 'standard',
      supportMode: 'normal',
      description: 'All standard drinks, normal workflow'
    },
    expert: {
      label: 'Expert',
      color: 'bg-purple-100 text-purple-700',
      borderColor: 'border-purple-300',
      allowedDrinks: ['all_drinks'],
      maxConcurrentOrders: 8,
      complexityLimit: 'complex',
      supportMode: 'minimal',
      customSkills: ['latte_art', 'custom_recipes'],
      description: 'All drinks including custom orders, minimal guidance'
    },
    specialist: {
      label: 'Specialist',
      color: 'bg-green-100 text-green-700',
      borderColor: 'border-green-300',
      allowedDrinks: ['all_drinks'],
      maxConcurrentOrders: 6,
      complexityLimit: 'complex',
      supportMode: 'normal',
      specializations: ['alternative_milk_expert', 'batch_processing', 'vip_service'],
      description: 'Specialized in specific areas with deep expertise'
    }
  };
  
  // Load barista profiles from localStorage or API
  useEffect(() => {
    loadBaristaProfiles();
  }, []);
  
  const loadBaristaProfiles = async () => {
    try {
      // Try to load from API first
      const response = await fetch('/api/barista-profiles', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token')}`,
          'Accept': 'application/json'
        }
      });
      
      if (response.ok) {
        const profiles = await response.json();
        setBaristaProfiles(profiles);
      } else {
        // Fallback to localStorage
        const savedProfiles = localStorage.getItem('barista_profiles');
        if (savedProfiles) {
          setBaristaProfiles(JSON.parse(savedProfiles));
        }
      }
    } catch (error) {
      console.error('Error loading barista profiles:', error);
      // Initialize with default profiles
      const defaultProfiles = {};
      stations.forEach(station => {
        if (station.current_barista) {
          defaultProfiles[station.current_barista] = {
            name: station.current_barista,
            skillLevel: 'experienced',
            specializations: [],
            statistics: {
              totalOrders: 0,
              avgCompletionTime: 0,
              errorRate: 0,
              customerRating: 0
            }
          };
        }
      });
      setBaristaProfiles(defaultProfiles);
    }
  };
  
  // Save barista profile
  const updateBaristaProfile = async (baristaName, updates) => {
    const updatedProfiles = {
      ...baristaProfiles,
      [baristaName]: {
        ...baristaProfiles[baristaName],
        ...updates
      }
    };
    
    setBaristaProfiles(updatedProfiles);
    
    // Save to localStorage
    localStorage.setItem('barista_profiles', JSON.stringify(updatedProfiles));
    
    // Try to save to API
    try {
      await fetch(`/api/barista-profiles/${baristaName}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token')}`
        },
        body: JSON.stringify(updatedProfiles[baristaName])
      });
    } catch (error) {
      console.error('Error saving barista profile:', error);
    }
  };
  
  // Calculate station efficiency based on barista skill
  const calculateStationEfficiency = (station) => {
    const barista = baristaProfiles[station.current_barista];
    if (!barista) return 1;
    
    const skillMultiplier = {
      novice: 0.7,
      experienced: 1.0,
      expert: 1.3,
      specialist: 1.2
    };
    
    return skillMultiplier[barista.skillLevel] || 1;
  };
  
  // Get recommended orders for station based on barista skill
  const getRecommendedOrders = (station) => {
    const barista = baristaProfiles[station.current_barista];
    if (!barista) return [];
    
    const skill = skillLevels[barista.skillLevel];
    if (!skill) return [];
    
    return ordersData.pending.filter(order => {
      // Check complexity
      const isComplex = order.alternativeMilk || order.customizations || order.specialInstructions;
      if (isComplex && skill.complexityLimit === 'simple') return false;
      
      // Check if barista can make this drink
      if (skill.allowedDrinks[0] !== 'all_drinks' && skill.allowedDrinks[0] !== 'all_standard_drinks') {
        const drinkType = order.coffeeType?.toLowerCase().replace(' ', '_');
        if (!skill.allowedDrinks.includes(drinkType)) return false;
      }
      
      // Check specializations
      if (barista.specializations?.includes('alternative_milk_expert') && order.alternativeMilk) {
        return true; // Priority for alternative milk orders
      }
      
      if (barista.specializations?.includes('vip_service') && (order.vip || order.priority)) {
        return true; // Priority for VIP orders
      }
      
      return true;
    }).slice(0, skill.maxConcurrentOrders);
  };
  
  // Update station with barista assignment
  const assignBaristaToStation = async (stationId, baristaName, skillLevel) => {
    try {
      // Update barista profile if needed
      if (!baristaProfiles[baristaName]) {
        await updateBaristaProfile(baristaName, {
          name: baristaName,
          skillLevel: skillLevel || 'experienced',
          specializations: [],
          statistics: {
            totalOrders: 0,
            avgCompletionTime: 0,
            errorRate: 0,
            customerRating: 0
          }
        });
      }
      
      // Update station
      await updateStation(stationId, {
        current_barista: baristaName,
        barista_skill_level: skillLevel || baristaProfiles[baristaName]?.skillLevel || 'experienced'
      });
      
    } catch (error) {
      console.error('Error assigning barista:', error);
    }
  };
  
  const toggleStationExpanded = (stationId) => {
    setExpandedStation(expandedStation === stationId ? null : stationId);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Enhanced Station Capabilities</h2>
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={skillRoutingEnabled}
            onChange={(e) => setSkillRoutingEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Enable Skill-Based Routing</span>
        </label>
      </div>

      {/* Skill Level Legend */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Barista Skill Levels</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Object.entries(skillLevels).map(([level, config]) => (
            <div key={level} className={`p-3 rounded-lg border ${config.borderColor}`}>
              <div className={`inline-block px-2 py-1 rounded text-sm font-medium ${config.color} mb-2`}>
                {config.label}
              </div>
              <p className="text-xs text-gray-600">{config.description}</p>
              <div className="mt-2 text-xs">
                <span className="font-medium">Max Orders:</span> {config.maxConcurrentOrders}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Station Cards */}
      <div className="space-y-4">
        {stations.map(station => {
          const barista = baristaProfiles[station.current_barista];
          const skillConfig = barista ? skillLevels[barista.skillLevel] : null;
          const efficiency = calculateStationEfficiency(station);
          const recommendedOrders = skillRoutingEnabled ? getRecommendedOrders(station) : [];
          const isExpanded = expandedStation === station.id;
          
          return (
            <div key={station.id} className="bg-white rounded-lg shadow">
              <div className="p-6">
                {/* Station Header */}
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{station.name}</h3>
                    <p className="text-sm text-gray-500">Station #{station.id}</p>
                  </div>
                  <button
                    onClick={() => toggleStationExpanded(station.id)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </button>
                </div>

                {/* Barista Assignment */}
                <div className="mb-4">
                  <div className="flex items-center space-x-4">
                    <User size={20} className="text-gray-400" />
                    <div className="flex-1">
                      <input
                        type="text"
                        value={station.current_barista || ''}
                        onChange={(e) => assignBaristaToStation(station.id, e.target.value)}
                        placeholder="Assign barista..."
                        className="w-full border rounded px-3 py-1 text-sm"
                      />
                    </div>
                    {barista && (
                      <select
                        value={barista.skillLevel}
                        onChange={(e) => updateBaristaProfile(station.current_barista, { skillLevel: e.target.value })}
                        className={`border rounded px-3 py-1 text-sm ${skillConfig?.borderColor}`}
                      >
                        {Object.entries(skillLevels).map(([level, config]) => (
                          <option key={level} value={level}>{config.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  
                  {barista && (
                    <div className="mt-2 flex items-center space-x-4 text-sm">
                      <span className={`px-2 py-1 rounded ${skillConfig?.color}`}>
                        {skillConfig?.label}
                      </span>
                      <span className="text-gray-500">
                        Efficiency: {(efficiency * 100).toFixed(0)}%
                      </span>
                      <span className="text-gray-500">
                        Max Orders: {skillConfig?.maxConcurrentOrders}
                      </span>
                    </div>
                  )}
                </div>

                {/* Station Capabilities */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="flex items-center space-x-2">
                    <Coffee size={16} className="text-gray-400" />
                    <span className="text-sm">
                      {station.capabilities?.standard_coffee ? 'Standard Coffee' : 'No Coffee'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Coffee size={16} className="text-gray-400" />
                    <span className="text-sm">
                      {station.capabilities?.alternative_milk ? 'Alt Milk' : 'No Alt Milk'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Award size={16} className="text-gray-400" />
                    <span className="text-sm">
                      {station.capabilities?.high_volume ? 'High Volume' : 'Normal Volume'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock size={16} className="text-gray-400" />
                    <span className="text-sm">
                      {station.status || 'Active'}
                    </span>
                  </div>
                </div>

                {/* Skill-Based Order Recommendations */}
                {skillRoutingEnabled && recommendedOrders.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">
                      Recommended Orders (based on skill level)
                    </h4>
                    <div className="space-y-2">
                      {recommendedOrders.slice(0, 3).map(order => (
                        <div key={order.id} className="flex items-center justify-between text-sm bg-gray-50 p-2 rounded">
                          <div>
                            <span className="font-medium">#{order.orderNumber}</span> - 
                            {order.coffeeType}, {order.milkType}
                            {order.alternativeMilk && (
                              <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1 rounded">Alt Milk</span>
                            )}
                            {(order.vip || order.priority) && (
                              <span className="ml-2 text-xs bg-red-100 text-red-700 px-1 rounded">VIP</span>
                            )}
                          </div>
                          <button
                            className="text-xs bg-blue-500 text-white px-2 py-1 rounded hover:bg-blue-600"
                            onClick={() => console.log('Assign order to station')}
                          >
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t pt-4 mt-4 space-y-4">
                    {/* Barista Statistics */}
                    {barista && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Barista Performance</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-xs text-gray-500">Total Orders</div>
                            <div className="text-lg font-bold">{barista.statistics?.totalOrders || 0}</div>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-xs text-gray-500">Avg Time</div>
                            <div className="text-lg font-bold">
                              {barista.statistics?.avgCompletionTime || 0}m
                            </div>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-xs text-gray-500">Error Rate</div>
                            <div className="text-lg font-bold">
                              {barista.statistics?.errorRate || 0}%
                            </div>
                          </div>
                          <div className="bg-gray-50 p-3 rounded">
                            <div className="text-xs text-gray-500">Rating</div>
                            <div className="text-lg font-bold">
                              {barista.statistics?.customerRating || 'N/A'}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Specializations */}
                    {barista && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Specializations</h4>
                        <div className="flex flex-wrap gap-2">
                          {skillLevels[barista.skillLevel]?.specializations?.map(spec => (
                            <span key={spec} className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                              {spec.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                          )) || <span className="text-xs text-gray-500">No specializations</span>}
                        </div>
                      </div>
                    )}

                    {/* Advanced Settings */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-700 mb-2">Advanced Settings</h4>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={station.auto_accept_orders || false}
                            onChange={(e) => updateStation(station.id, { auto_accept_orders: e.target.checked })}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">Auto-accept suitable orders</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            checked={station.training_mode || false}
                            onChange={(e) => updateStation(station.id, { training_mode: e.target.checked })}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">Training mode (slower, more guidance)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Skill Routing Dashboard */}
      {skillRoutingEnabled && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold mb-4">Skill-Based Routing Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-2">Order Distribution</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Simple Orders:</span>
                  <span className="font-medium">
                    {ordersData.pending.filter(o => !o.alternativeMilk && !o.customizations).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Complex Orders:</span>
                  <span className="font-medium">
                    {ordersData.pending.filter(o => o.alternativeMilk || o.customizations).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>VIP Orders:</span>
                  <span className="font-medium">
                    {ordersData.pending.filter(o => o.vip || o.priority).length}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-2">Barista Availability</h4>
              <div className="space-y-2 text-sm">
                {Object.entries(skillLevels).map(([level, config]) => {
                  const count = Object.values(baristaProfiles).filter(b => b.skillLevel === level).length;
                  return (
                    <div key={level} className="flex justify-between">
                      <span>{config.label}:</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            
            <div className="border rounded-lg p-4">
              <h4 className="font-medium mb-2">Routing Efficiency</h4>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">
                  {((stations.reduce((sum, s) => sum + calculateStationEfficiency(s), 0) / stations.length) * 100).toFixed(0)}%
                </div>
                <div className="text-sm text-gray-500 mt-1">Average Station Efficiency</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedStationCapabilities;