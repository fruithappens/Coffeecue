// components/StationLoadBalancer.js
import React, { useState, useEffect, useCallback } from 'react';
import { Scale, RefreshCw, AlertTriangle, CheckCircle, ArrowRightLeft, Users, Clock, Zap } from 'lucide-react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';

const StationLoadBalancer = () => {
  const { stations } = useStations();
  const { pendingOrders, inProgressOrders, startOrder } = useOrders();
  
  // Load balancing settings from localStorage or use defaults
  const loadBalancingSettings = () => {
    try {
      const saved = localStorage.getItem('coffee_cue_balancing_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          balancingActive: parsed.balancingActive || false,
          balancingRules: parsed.balancingRules || {
            autoBalance: true,
            balanceThreshold: 70, // Trigger balancing when workload > 70%
            maxTransfers: 3, // Max orders to transfer at once
            considerCapabilities: true
          }
        };
      }
    } catch (error) {
      console.error('Error loading balancing settings from localStorage:', error);
    }
    return {
      balancingActive: false,
      balancingRules: {
        autoBalance: true,
        balanceThreshold: 70,
        maxTransfers: 3,
        considerCapabilities: true
      }
    };
  };

  const initialSettings = loadBalancingSettings();
  const [balancingActive, setBalancingActive] = useState(initialSettings.balancingActive);
  const [balancingRules, setBalancingRules] = useState(initialSettings.balancingRules);
  
  // Save settings to localStorage whenever they change
  useEffect(() => {
    try {
      const settings = {
        balancingActive,
        balancingRules
      };
      localStorage.setItem('coffee_cue_balancing_settings', JSON.stringify(settings));
      console.log('Saved balancing settings to localStorage:', settings);
    } catch (error) {
      console.error('Error saving balancing settings to localStorage:', error);
    }
  }, [balancingActive, balancingRules]);
  
  const [transferSuggestions, setTransferSuggestions] = useState([]);
  const [balancingMetrics, setBalancingMetrics] = useState({
    workloadVariance: 0,
    avgWaitTime: 0,
    transfersToday: 0,
    efficiencyGain: 0
  });

  // Calculate station workloads and imbalances
  const calculateWorkloadBalance = useCallback(() => {
    if (!stations || !inProgressOrders) return { stations: [], variance: 0, needsBalancing: false };

    const stationWorkloads = stations.map(station => {
      const stationOrders = inProgressOrders.filter(order => 
        order.stationId === station.id || order.station_id === station.id
      );
      
      const maxCapacity = station.maxCapacity || 5;
      const currentLoad = stationOrders.length;
      const workloadPercentage = (currentLoad / maxCapacity) * 100;
      const avgOrderTime = station.avgOrderTime || 4;
      const estimatedWaitTime = currentLoad * avgOrderTime;
      
      return {
        ...station,
        currentLoad,
        maxCapacity,
        workloadPercentage,
        estimatedWaitTime,
        orders: stationOrders,
        status: workloadPercentage > 90 ? 'overloaded' : 
               workloadPercentage > 70 ? 'busy' : 
               workloadPercentage > 30 ? 'active' : 'available'
      };
    });

    // Calculate workload variance
    const avgWorkload = stationWorkloads.reduce((sum, s) => sum + s.workloadPercentage, 0) / stationWorkloads.length;
    const variance = Math.sqrt(
      stationWorkloads.reduce((sum, s) => sum + Math.pow(s.workloadPercentage - avgWorkload, 2), 0) / stationWorkloads.length
    );

    const needsBalancing = variance > balancingRules.balanceThreshold;

    return { 
      stations: stationWorkloads, 
      variance: Math.round(variance), 
      avgWorkload: Math.round(avgWorkload),
      needsBalancing 
    };
  }, [stations, inProgressOrders, balancingRules.balanceThreshold]);

  const workloadData = calculateWorkloadBalance();

  // Generate transfer suggestions for load balancing
  const generateTransferSuggestions = useCallback(() => {
    if (!workloadData.needsBalancing) return [];

    const overloadedStations = workloadData.stations.filter(s => s.workloadPercentage > balancingRules.balanceThreshold);
    const availableStations = workloadData.stations.filter(s => s.workloadPercentage < 50).sort((a, b) => a.workloadPercentage - b.workloadPercentage);

    if (!overloadedStations.length || !availableStations.length) return [];

    const suggestions = [];

    overloadedStations.forEach(overloadedStation => {
      // Get transferable orders (newest, non-VIP orders first)
      const transferableOrders = overloadedStation.orders
        .filter(order => !order.priority && !order.vip)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, balancingRules.maxTransfers);

      transferableOrders.forEach(order => {
        // Find best destination station
        const bestDestination = availableStations.find(station => {
          if (!balancingRules.considerCapabilities) return true;
          
          // Check if station can handle this order
          const canMakeCoffee = !station.capabilities?.coffee || 
            station.capabilities.coffee.some(type => 
              order.coffeeType?.toLowerCase().includes(type.toLowerCase())
            );
          
          const canProvideMilk = order.milkType === 'No milk' || 
            !station.capabilities?.milk ||
            station.capabilities.milk.some(milk => 
              order.milkType?.toLowerCase().includes(milk.toLowerCase())
            );

          return canMakeCoffee && canProvideMilk;
        });

        if (bestDestination) {
          const waitTimeReduction = overloadedStation.estimatedWaitTime - bestDestination.estimatedWaitTime;
          
          suggestions.push({
            order,
            fromStation: overloadedStation,
            toStation: bestDestination,
            waitTimeReduction,
            priority: waitTimeReduction + (overloadedStation.workloadPercentage - bestDestination.workloadPercentage)
          });
        }
      });
    });

    // Sort by priority (highest impact first)
    return suggestions.sort((a, b) => b.priority - a.priority).slice(0, balancingRules.maxTransfers);
  }, [workloadData, balancingRules]);

  const transferSuggestionsData = generateTransferSuggestions();

  // Auto-execute transfers if auto-balancing is enabled
  useEffect(() => {
    if (balancingRules.autoBalance && transferSuggestionsData.length && !balancingActive) {
      setTransferSuggestions(transferSuggestionsData);
    }
  }, [transferSuggestionsData, balancingRules.autoBalance, balancingActive]);

  // Execute a transfer
  const executeTransfer = async (suggestion) => {
    setBalancingActive(true);
    
    try {
      // In a real implementation, this would call an API to reassign the order
      console.log(`Transferring order ${suggestion.order.id} from ${suggestion.fromStation.name} to ${suggestion.toStation.name}`);
      
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Update metrics
      setBalancingMetrics(prev => ({
        ...prev,
        transfersToday: prev.transfersToday + 1,
        efficiencyGain: prev.efficiencyGain + suggestion.waitTimeReduction
      }));
      
      // Remove from suggestions
      setTransferSuggestions(prev => prev.filter(s => s.order.id !== suggestion.order.id));
      
    } catch (error) {
      console.error('Transfer failed:', error);
    } finally {
      setBalancingActive(false);
    }
  };

  // Execute all suggested transfers
  const executeAllTransfers = async () => {
    setBalancingActive(true);
    
    for (const suggestion of transferSuggestions) {
      await executeTransfer(suggestion);
    }
    
    setBalancingActive(false);
  };

  // Update metrics
  useEffect(() => {
    if (!workloadData.stations?.length) return;
    
    const totalWaitTime = workloadData.stations.reduce((sum, s) => sum + (s.estimatedWaitTime || 0), 0);
    const avgWaitTime = totalWaitTime / workloadData.stations.length;
    
    setBalancingMetrics(prev => ({
      ...prev,
      workloadVariance: workloadData.variance || 0,
      avgWaitTime: Math.round(avgWaitTime * 10) / 10
    }));
  }, [workloadData.variance, workloadData.stations?.length]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'text-green-600 bg-green-100';
      case 'active': return 'text-blue-600 bg-blue-100';
      case 'busy': return 'text-yellow-600 bg-yellow-100';
      case 'overloaded': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-600 to-teal-600 text-white p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center">
              <Scale className="mr-3" />
              Station Load Balancer
            </h2>
            <p className="text-green-100 mt-1">
              Real-time workload distribution and order transfer optimization
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{balancingMetrics.workloadVariance}</div>
              <div className="text-sm text-green-200">Variance</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{balancingMetrics.transfersToday}</div>
              <div className="text-sm text-green-200">Transfers</div>
            </div>
          </div>
        </div>
      </div>

      {/* Balancing Controls */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <Zap className="mr-2 text-yellow-600" />
            Load Balancing Configuration
          </h3>
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={balancingRules.autoBalance}
                onChange={(e) => setBalancingRules({
                  ...balancingRules,
                  autoBalance: e.target.checked
                })}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">Auto-Balance</span>
            </label>
            <button
              onClick={() => setTransferSuggestions(transferSuggestionsData)}
              disabled={balancingActive}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
            >
              <RefreshCw size={16} className={balancingActive ? 'animate-spin' : ''} />
              <span>Analyze</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Balance Threshold (%)
            </label>
            <input
              type="range"
              min="50"
              max="100"
              value={balancingRules.balanceThreshold}
              onChange={(e) => setBalancingRules({
                ...balancingRules,
                balanceThreshold: parseInt(e.target.value)
              })}
              className="w-full"
            />
            <div className="text-xs text-gray-500">{balancingRules.balanceThreshold}%</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Transfers
            </label>
            <select
              value={balancingRules.maxTransfers}
              onChange={(e) => setBalancingRules({
                ...balancingRules,
                maxTransfers: parseInt(e.target.value)
              })}
              className="w-full p-2 border rounded"
            >
              <option value={1}>1</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </div>
          <div className="flex items-center">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={balancingRules.considerCapabilities}
                onChange={(e) => setBalancingRules({
                  ...balancingRules,
                  considerCapabilities: e.target.checked
                })}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">Check Capabilities</span>
            </label>
          </div>
        </div>
      </div>

      {/* Station Workload Visualization */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Users className="mr-2 text-blue-600" />
          Station Workload Distribution
        </h3>
        
        <div className="space-y-4">
          {workloadData.stations.map(station => (
            <div key={station.id} className="flex items-center space-x-4 p-3 bg-gray-50 rounded-lg">
              <div className="w-20 text-sm font-medium">{station.name}</div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>{station.currentLoad}/{station.maxCapacity} orders</span>
                  <span>{Math.round(station.workloadPercentage)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full transition-all duration-300 ${
                      station.workloadPercentage > 90 ? 'bg-red-500' :
                      station.workloadPercentage > 70 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, station.workloadPercentage)}%` }}
                  ></div>
                </div>
              </div>
              
              <div className={`px-2 py-1 rounded-full text-xs flex items-center space-x-1 ${getStatusColor(station.status)}`}>
                <span>{station.status}</span>
              </div>
              
              <div className="text-right text-sm">
                <div className="font-medium">{station.estimatedWaitTime}m</div>
                <div className="text-xs text-gray-500">wait time</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transfer Suggestions */}
      {transferSuggestions.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center">
              <ArrowRightLeft className="mr-2 text-purple-600" />
              Recommended Transfers ({transferSuggestions.length})
            </h3>
            <button
              onClick={executeAllTransfers}
              disabled={balancingActive}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              Execute All Transfers
            </button>
          </div>
          
          <div className="space-y-3">
            {transferSuggestions.map((suggestion, index) => (
              <div key={`${suggestion.order.id}-${index}`} className="flex items-center justify-between p-4 bg-purple-50 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium">
                    #{suggestion.order.orderNumber} - {suggestion.order.customerName}
                  </div>
                  <div className="text-sm text-gray-600">
                    {suggestion.order.coffeeType}, {suggestion.order.milkType}
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  <div className="text-center">
                    <div className="text-sm font-medium">{suggestion.fromStation.name}</div>
                    <div className="text-xs text-gray-500">{suggestion.fromStation.estimatedWaitTime}m wait</div>
                  </div>
                  
                  <ArrowRightLeft size={16} className="text-purple-600" />
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-purple-600">{suggestion.toStation.name}</div>
                    <div className="text-xs text-gray-500">{suggestion.toStation.estimatedWaitTime}m wait</div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-sm font-bold text-green-600">-{suggestion.waitTimeReduction}m</div>
                    <div className="text-xs text-gray-500">time saved</div>
                  </div>
                  
                  <button
                    onClick={() => executeTransfer(suggestion)}
                    disabled={balancingActive}
                    className="px-3 py-1 bg-purple-600 text-white text-xs rounded hover:bg-purple-700 disabled:opacity-50"
                  >
                    Transfer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Balance Status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className={`text-2xl font-bold ${workloadData.needsBalancing ? 'text-red-600' : 'text-green-600'}`}>
            {workloadData.needsBalancing ? <AlertTriangle size={24} className="mx-auto" /> : <CheckCircle size={24} className="mx-auto" />}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {workloadData.needsBalancing ? 'Needs Balancing' : 'Well Balanced'}
          </div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-600">{balancingMetrics.workloadVariance || 0}</div>
          <div className="text-sm text-gray-600">Workload Variance</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-green-600">{balancingMetrics.avgWaitTime || 0}m</div>
          <div className="text-sm text-gray-600">Avg Wait Time</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-purple-600">{Math.round(balancingMetrics.efficiencyGain || 0)}m</div>
          <div className="text-sm text-gray-600">Time Saved Today</div>
        </div>
      </div>
    </div>
  );
};

export default StationLoadBalancer;