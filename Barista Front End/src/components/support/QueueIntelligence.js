// components/QueueIntelligence.js
import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Zap, Clock, Users, BarChart3, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import useStations from '../../hooks/useStations';
import useOrders from '../../hooks/useOrders';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

const QueueIntelligence = () => {
  const { stations, loading: stationsLoading } = useStations();
  const { pendingOrders, inProgressOrders } = useOrders();

  // Routing rules are now persisted to the backend (/api/routing-rules)
  // so the toggles actually drive _assign_station's behavior. We keep
  // a localStorage mirror so the UI restores instantly on reload even
  // if the network is slow.
  const loadRoutingRules = () => {
    try {
      const saved = localStorage.getItem('coffee_cue_routing_rules');
      if (saved) return JSON.parse(saved);
    } catch (error) {
      console.error('Error loading routing rules from localStorage:', error);
    }
    return {
      prioritizeEfficiency: true,
      balanceWorkload: true,
      considerCapabilities: true,
      emergencyMode: false,
    };
  };

  const [routingRules, setRoutingRules] = useState(loadRoutingRules());
  const [serverSyncStatus, setServerSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'synced' | 'error'

  // On mount, fetch the server's view and reconcile. Server wins —
  // it's what _assign_station actually reads.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.request('/routing-rules', { method: 'GET' });
        if (cancelled || !resp) return;
        // Treat the response itself as the rules object (matches /event-stock pattern).
        const serverRules = resp.rules || resp;
        if (typeof serverRules === 'object') {
          setRoutingRules(prev => ({ ...prev, ...serverRules }));
          localStorage.setItem('coffee_cue_routing_rules', JSON.stringify(serverRules));
          setServerSyncStatus('synced');
        }
      } catch (e) {
        console.warn('Could not fetch routing rules from server:', e);
        setServerSyncStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save routing rules to BOTH localStorage and backend whenever they change.
  // Debounced via a 400ms timeout so a slider drag doesn't hammer the API.
  useEffect(() => {
    try {
      localStorage.setItem('coffee_cue_routing_rules', JSON.stringify(routingRules));
    } catch (error) {
      console.error('Error saving routing rules to localStorage:', error);
    }
    const timer = setTimeout(async () => {
      setServerSyncStatus('syncing');
      try {
        await api.request('/routing-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(routingRules),
        });
        setServerSyncStatus('synced');
      } catch (e) {
        console.warn('Could not save routing rules to server:', e);
        setServerSyncStatus('error');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [routingRules]);
  
  // routingMetrics is derived below (useMemo) — it was component state
  // fed by an effect keyed only on array LENGTHS, so it went stale.

  // Calculate station capabilities and current workload
  const calculateStationStats = useCallback(() => {
    if (!stations || !pendingOrders || !inProgressOrders) return [];

    return stations.map(station => {
      // Get orders currently assigned to this station
      const stationInProgress = inProgressOrders.filter(order =>
        order.stationId === station.id || order.station_id === station.id
      );
      const stationPending = pendingOrders.filter(order =>
        order.stationId === station.id || order.station_id === station.id
      );
      
      // Calculate capability score based on station features
      const capabilities = {
        coffeeTypes: station.capabilities?.coffee || ['Espresso', 'Flat White', 'Cappuccino', 'Latte'],
        milkOptions: station.capabilities?.milk || ['Full Cream', 'Skim', 'Soy', 'Almond'],
        specialFeatures: station.capabilities?.special || []
      };
      
      const capabilityScore = (
        capabilities.coffeeTypes.length * 0.4 +
        capabilities.milkOptions.length * 0.3 +
        capabilities.specialFeatures.length * 0.3
      );
      
      // Current workload = the REAL queue (pending + in-progress).
      // Counting only in-progress showed "1/5" while two more orders
      // sat pending at the same station.
      const currentLoad = (station.queueCount != null && station.queueCount >= 0)
        ? station.queueCount
        : (stationPending.length + stationInProgress.length);
      const maxCapacity = station.maxCapacity || 5; // Default max 5 concurrent orders
      const workloadPercentage = Math.min(100, (currentLoad / maxCapacity) * 100);

      // Orders-per-hour estimate (only meaningful when real per-station
      // timing exists; the 4-min default is a rough rule of thumb).
      const avgOrderTime = station.avgOrderTime || 4; // Default 4 minutes per order
      const ordersPerHour = Math.round(60 / avgOrderTime);

      // Wait estimate: prefer the CANONICAL smart wait from /api/stations
      // (per-drink make-time × queue ÷ capacity — the same number the
      // walk-up pill shows). The old load × 4min synthetic said "1m avg"
      // while real orders had waited far longer (Steve's 83-min testers).
      const estimatedWaitTime = (station.estimatedWait != null)
        ? station.estimatedWait
        : currentLoad * avgOrderTime;
      
      // A station in maintenance/inactive is OFFLINE — it must never be shown
      // as "available" or chosen as a routing target, regardless of its load.
      const offline = (station.status || 'active') !== 'active';

      return {
        ...station,
        capabilities,
        capabilityScore,
        currentLoad,
        maxCapacity,
        workloadPercentage,
        ordersPerHour,
        estimatedWaitTime,
        offline,
        efficiency: offline ? 0 : Math.max(0, 100 - workloadPercentage), // Higher efficiency = lower workload
        status: offline ? 'offline' :
               workloadPercentage > 90 ? 'overloaded' :
               workloadPercentage > 70 ? 'busy' :
               workloadPercentage > 30 ? 'active' : 'available'
      };
    });
  }, [stations, pendingOrders, inProgressOrders]);

  const stationStats = calculateStationStats();

  // Intelligent routing algorithm
  const findBestStation = useCallback((order) => {
    if (!stationStats.length) return null;

    let scores = stationStats.filter(station => !station.offline).map(station => {
      let score = 0;
      
      // Capability matching (40% of score)
      const canMakeCoffee = station.capabilities.coffeeTypes.some(type => 
        order.coffeeType?.toLowerCase().includes(type.toLowerCase())
      );
      const canProvideMilk = order.milkType === 'No milk' || 
        station.capabilities.milkOptions.some(milk => 
          order.milkType?.toLowerCase().includes(milk.toLowerCase())
        );
      
      if (canMakeCoffee && canProvideMilk) {
        score += 40;
      } else if (canMakeCoffee || canProvideMilk) {
        score += 20;
      }
      
      // Workload balance (30% of score)
      if (routingRules.balanceWorkload) {
        const workloadScore = Math.max(0, 100 - station.workloadPercentage);
        score += (workloadScore * 0.3);
      }
      
      // Efficiency consideration (20% of score)
      if (routingRules.prioritizeEfficiency) {
        score += (station.efficiency * 0.2);
      }
      
      // Priority boost for VIP orders (10% of score)
      if (order.priority && station.capabilities.specialFeatures.includes('VIP')) {
        score += 10;
      }
      
      // Penalty for overloaded stations
      if (station.status === 'overloaded') {
        score -= 25;
      }
      
      return {
        station,
        score,
        reasoning: {
          canMake: canMakeCoffee && canProvideMilk,
          workload: station.workloadPercentage,
          efficiency: station.efficiency,
          waitTime: station.estimatedWaitTime
        }
      };
    });

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    
    // Return the best station if score is above threshold
    return scores[0]?.score > 50 ? scores[0] : null;
  }, [stationStats, routingRules]);

  // Auto-routing suggestions for pending orders
  const generateRoutingSuggestions = useCallback(() => {
    if (!pendingOrders.length) return [];
    
    return pendingOrders.map(order => {
      const suggestion = findBestStation(order);
      return {
        order,
        suggested: suggestion,
        currentStation: order.stationId ? 
          stationStats.find(s => s.id === order.stationId) : null
      };
    }).filter(s => s.suggested); // Only show orders with suggestions
  }, [pendingOrders, findBestStation, stationStats]);

  const routingSuggestions = generateRoutingSuggestions();

  // Overall metrics — honest versions. The old ones were synthetic:
  // "Avg Wait" was load×4min averaged over IDLE stations too (a busy
  // station's 4m became "1m avg" across 4 stations); "Efficiency" ADDED
  // A PERCENTAGE TO MINUTES ((balance + (100 − avgWait))/2); "Balance"
  // measured distance from a hardcoded 50% target, so an all-idle event
  // scored 50%, not 100%. Steve caught the 1m ("not sure if it's true").
  const routingMetrics = React.useMemo(() => {
    if (!stationStats.length) {
      return { avgWaitTime: 0, workloadBalance: 100, stationsAvailable: 0, stationsTotal: 0, totalOrdersRouted: 0 };
    }
    const busy = stationStats.filter(s => !s.offline && (s.currentLoad || 0) > 0);
    // Average wait where people are actually queued; 0 when no queue.
    const avgWait = busy.length
      ? busy.reduce((sum, s) => sum + (s.estimatedWaitTime || 0), 0) / busy.length
      : 0;
    // Balance = spread around the MEAN workload (all-idle = perfectly
    // balanced = 100).
    const active = stationStats.filter(s => !s.offline);
    const meanLoad = active.length
      ? active.reduce((sum, s) => sum + (s.workloadPercentage || 0), 0) / active.length
      : 0;
    const workloadStddev = active.length
      ? Math.sqrt(active.reduce((sum, s) => sum + Math.pow((s.workloadPercentage || 0) - meanLoad, 2), 0) / active.length)
      : 0;
    return {
      avgWaitTime: Math.round(avgWait * 10) / 10,
      workloadBalance: Math.max(0, Math.round(100 - workloadStddev)),
      stationsAvailable: active.filter(s => s.status !== 'overloaded').length,
      stationsTotal: stationStats.length,
      totalOrdersRouted: (inProgressOrders?.length || 0) + (pendingOrders?.length || 0),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stations, pendingOrders, inProgressOrders]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800';
      case 'active': return 'bg-blue-100 text-blue-800';
      case 'busy': return 'bg-yellow-100 text-yellow-800';
      case 'overloaded': return 'bg-red-100 text-red-800';
      case 'offline': return 'bg-gray-200 text-gray-600';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'available': return <CheckCircle size={16} className="text-green-600" />;
      case 'active': return <Clock size={16} className="text-blue-600" />;
      case 'busy': return <Users size={16} className="text-yellow-600" />;
      case 'overloaded': return <AlertTriangle size={16} className="text-red-600" />;
      case 'offline': return <AlertTriangle size={16} className="text-gray-500" />;
      default: return <Clock size={16} className="text-gray-600" />;
    }
  };

  if (stationsLoading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="space-y-2">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold flex items-center">
              <Brain className="mr-3" />
              Queue Intelligence Dashboard
            </h2>
            <p className="text-purple-100 mt-1">
              Intelligent order routing and workload optimization
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{routingMetrics.stationsAvailable}/{routingMetrics.stationsTotal}</div>
              <div className="text-sm text-purple-200">Stations Available</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{routingMetrics.avgWaitTime || 0}m</div>
              <div className="text-sm text-purple-200">Avg Wait (busy stations)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Routing Rules */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center justify-between">
          <span className="flex items-center">
            <Zap className="mr-2 text-yellow-600" />
            Routing Configuration
          </span>
          <span className={`text-xs px-2 py-1 rounded font-medium ${
              serverSyncStatus === 'synced'  ? 'bg-green-100 text-green-800' :
              serverSyncStatus === 'syncing' ? 'bg-amber-100 text-amber-800 animate-pulse' :
              serverSyncStatus === 'error'   ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-600'}`}>
            {serverSyncStatus === 'synced'  ? '● Live — affecting routing'
             : serverSyncStatus === 'syncing' ? 'Syncing…'
             : serverSyncStatus === 'error' ? 'Saved locally only — backend offline'
             : 'Not yet synced'}
          </span>
        </h3>
        <p className="text-xs text-gray-500 mb-4">
          These toggles now drive the backend's <code className="bg-gray-100 px-1 rounded">_assign_station</code> algorithm
          directly. Changes apply to the next order placed.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(routingRules).map(([key, value]) => (
            <label key={key} className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => setRoutingRules({
                  ...routingRules,
                  [key]: e.target.checked
                })}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium">
                {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Station Performance Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stationStats.map(station => (
          <div key={station.id} className="bg-white p-4 rounded-lg shadow-sm border">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold">{station.name}</h4>
              <div className={`px-2 py-1 rounded-full text-xs flex items-center space-x-1 ${getStatusColor(station.status)}`}>
                {getStatusIcon(station.status)}
                <span>{station.status}</span>
              </div>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Current Load:</span>
                <span>{station.currentLoad}/{station.maxCapacity}</span>
              </div>
              <div className="flex justify-between">
                <span>Workload:</span>
                <span>{Math.round(station.workloadPercentage)}%</span>
              </div>
              <div className="flex justify-between">
                <span>Est. Wait:</span>
                <span>{station.estimatedWaitTime}m</span>
              </div>
              <div className="flex justify-between">
                <span>Orders/Hour:</span>
                <span>{station.ordersPerHour}</span>
              </div>
            </div>
            
            {/* Workload Bar */}
            <div className="mt-3">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    station.workloadPercentage > 90 ? 'bg-red-500' :
                    station.workloadPercentage > 70 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, station.workloadPercentage)}%` }}
                ></div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Routing Suggestions */}
      {routingSuggestions.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <BarChart3 className="mr-2 text-blue-600" />
            Intelligent Routing Suggestions ({routingSuggestions.length})
          </h3>
          <div className="space-y-3">
            {routingSuggestions.slice(0, 5).map(({ order, suggested, currentStation }) => (
              <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <div className="font-medium">#{order.orderNumber} - {order.customerName}</div>
                  <div className="text-sm text-gray-600">{order.coffeeType}, {order.milkType}</div>
                </div>
                
                <div className="flex items-center space-x-3">
                  {currentStation && (
                    <>
                      <div className="text-center">
                        <div className="text-sm font-medium">{currentStation.name}</div>
                        <div className="text-xs text-gray-500">Current</div>
                      </div>
                      <ArrowRight size={16} className="text-gray-400" />
                    </>
                  )}
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-blue-600">{suggested.station.name}</div>
                    <div className="text-xs text-gray-500">
                      Score: {Math.round(suggested.score)} | Wait: {suggested.station.estimatedWaitTime}m
                    </div>
                  </div>
                  
                  <button className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                    Route
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-blue-600">{routingMetrics.totalOrdersRouted || 0}</div>
          <div className="text-sm text-gray-600">Active Orders</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-green-600">{routingMetrics.avgWaitTime || 0}m</div>
          <div className="text-sm text-gray-600">Avg Wait (busy stations)</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-purple-600">{routingMetrics.stationsAvailable}/{routingMetrics.stationsTotal}</div>
          <div className="text-sm text-gray-600">Stations Available</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-orange-600">{routingMetrics.workloadBalance || 0}%</div>
          <div className="text-sm text-gray-600">Workload Balance</div>
        </div>
      </div>
    </div>
  );
};

export default QueueIntelligence;