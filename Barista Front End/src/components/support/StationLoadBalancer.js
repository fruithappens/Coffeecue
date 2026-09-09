// components/StationLoadBalancer.js
import React, { useState, useEffect, useCallback } from 'react';
import { Scale, RefreshCw, AlertTriangle, CheckCircle, ArrowRightLeft, Users, Clock, Zap } from 'lucide-react';
import useStations from '../../hooks/useStations';
import useOrders from '../../hooks/useOrders';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

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
  const [transferError, setTransferError] = useState(null);
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
      
      // Offline (maintenance/inactive) stations must not be treated as a
      // transfer destination or shown as "available", whatever their load.
      const offline = (station.status || 'active') !== 'active';

      return {
        ...station,
        currentLoad,
        maxCapacity,
        workloadPercentage,
        estimatedWaitTime,
        orders: stationOrders,
        offline,
        status: offline ? 'offline' :
               workloadPercentage > 90 ? 'overloaded' :
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
    const availableStations = workloadData.stations.filter(s => !s.offline && s.workloadPercentage < 50).sort((a, b) => a.workloadPercentage - b.workloadPercentage);

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
    setTransferError(null);

    try {
      // REAL reassign — this used to be a simulation ("in a real
      // implementation, this would call an API"): a fake delay, fake
      // success metrics, and the order never moved. The backend endpoint
      // is capability-gated (it refuses stations that can't make the
      // drink), so a failed move surfaces instead of stranding an order.
      const orderId = suggestion.order.orderNumber
        || suggestion.order.order_number || suggestion.order.id;
      const resp = await api.request(`/orders/${orderId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_station_id: suggestion.toStation.id }),
      });
      if (!resp || resp.success === false) {
        throw new Error(resp?.error || resp?.message || 'reassign failed');
      }

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
      setTransferError(`Couldn't move order ${suggestion.order.id} to `
        + `${suggestion.toStation.name}: ${error.message || error}`);
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
      case 'available': return 'text-cq-ready bg-cq-ready-wash';
      case 'active': return 'text-cq-caramel-deep bg-cq-caramel-wash';
      case 'busy': return 'text-cq-warn bg-cq-warn-wash';
      case 'overloaded': return 'text-cq-alert bg-cq-alert-wash';
      case 'offline': return 'text-cq-ink-2 bg-cq-line';
      default: return 'text-cq-ink-2 bg-cq-wash';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
        <div className="flex flex-wrap items-center gap-4">
          <Scale className="w-5 h-5 text-cq-caramel flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-cq-roast">Evening out the stations</h2>
            <p className="text-sm text-cq-ink-3">
              Who is busiest, and what moving an order would do about it.
            </p>
          </div>
          <div className="flex items-center gap-6 ml-auto tabular-nums">
            <div>
              <div className="text-2xl font-bold text-cq-roast">
                {balancingMetrics.workloadVariance}
              </div>
              <div className="text-sm text-cq-ink-2">Spread</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-cq-roast">
                {balancingMetrics.transfersToday}
              </div>
              <div className="text-sm text-cq-ink-2">Moved today</div>
            </div>
          </div>
        </div>
      </div>

      {/* Balancing Controls */}
      <div className="bg-cq-milk p-6 rounded-cq-md shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center">
            <Zap className="mr-2 text-cq-warn" />
            When to even things out
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
                className="rounded border-cq-line"
              />
              <span className="text-sm font-medium">Move orders automatically</span>
            </label>
            <button
              onClick={() => setTransferSuggestions(transferSuggestionsData)}
              disabled={balancingActive}
              className="h-10 px-4 rounded-cq-md bg-cq-milk border-2 border-cq-line text-cq-roast font-bold hover:border-cq-caramel disabled:opacity-40 flex items-center space-x-2"
            >
              <RefreshCw size={16} className={balancingActive ? 'animate-spin' : ''} />
              <span>Check now</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-cq-ink-2 mb-1">
              Busy above
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
              className="w-full accent-cq-caramel"
            />
            <div className="text-xs text-cq-ink-3">{balancingRules.balanceThreshold}%</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-cq-ink-2 mb-1">
              Move at most
            </label>
            <select
              value={balancingRules.maxTransfers}
              onChange={(e) => setBalancingRules({
                ...balancingRules,
                maxTransfers: parseInt(e.target.value)
              })}
              className="w-full h-10 px-3 rounded-cq-md border-2 border-cq-line bg-cq-milk text-cq-roast focus:border-cq-caramel focus:outline-none"
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
                className="rounded border-cq-line"
              />
              <span className="text-sm font-medium">Only to a station that can make it</span>
            </label>
          </div>
        </div>
      </div>

      {/* Station Workload Visualization */}
      <div className="bg-cq-milk p-6 rounded-cq-md shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Users className="mr-2 text-cq-caramel-deep" />
          How busy each station is
        </h3>
        
        <div className="space-y-4">
          {workloadData.stations.map(station => (
            <div key={station.id} className="flex items-center space-x-4 p-3 bg-cq-wash rounded-cq-md">
              <div className="w-20 text-sm font-medium">{station.name}</div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-cq-ink-2 mb-1">
                  <span>{station.currentLoad}/{station.maxCapacity} orders</span>
                  <span>{Math.round(station.workloadPercentage)}%</span>
                </div>
                <div className="w-full bg-cq-line rounded-full h-3">
                  <div 
                    className={`h-3 rounded-full transition-all duration-300 ${
                      station.workloadPercentage > 90 ? 'bg-cq-alert' :
                      station.workloadPercentage > 70 ? 'bg-cq-warn' :
                      'bg-cq-ready'
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
                <div className="text-xs text-cq-ink-3">wait time</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Transfer Suggestions */}
      {transferSuggestions.length > 0 && (
        <div className="bg-cq-milk p-6 rounded-cq-md shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center">
              <ArrowRightLeft className="mr-2 text-cq-caramel-deep" />
              Orders worth moving ({transferSuggestions.length})
            </h3>
            <button
              onClick={executeAllTransfers}
              disabled={balancingActive}
              className="h-10 px-4 rounded-cq-md bg-cq-caramel text-white font-bold hover:bg-cq-caramel-deep disabled:opacity-40"
            >
              Move all
            </button>
          </div>
          
          <div className="space-y-3">
            {transferSuggestions.map((suggestion, index) => (
              <div key={`${suggestion.order.id}-${index}`} className="flex items-center justify-between p-4 bg-cq-caramel-wash rounded-cq-md">
                <div className="flex-1">
                  <div className="font-medium">
                    #{suggestion.order.orderNumber} - {suggestion.order.customerName}
                  </div>
                  <div className="text-sm text-cq-ink-2">
                    {suggestion.order.coffeeType}, {suggestion.order.milkType}
                  </div>
                </div>
                
                <div className="flex items-center space-x-4">
                  <div className="text-center">
                    <div className="text-sm font-medium">{suggestion.fromStation.name}</div>
                    <div className="text-xs text-cq-ink-3">{suggestion.fromStation.estimatedWaitTime}m wait</div>
                  </div>
                  
                  <ArrowRightLeft size={16} className="text-cq-caramel-deep" />
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-cq-caramel-deep">{suggestion.toStation.name}</div>
                    <div className="text-xs text-cq-ink-3">{suggestion.toStation.estimatedWaitTime}m wait</div>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-sm font-bold text-cq-ready">{Math.abs(suggestion.waitTimeReduction)}m</div>
                    <div className="text-xs text-cq-ink-3">quicker</div>
                  </div>
                  
                  <button
                    onClick={() => executeTransfer(suggestion)}
                    disabled={balancingActive}
                    className="px-3 py-1 bg-cq-roast text-white text-xs rounded hover:bg-cq-roast disabled:opacity-50"
                  >Move</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};

export default StationLoadBalancer;