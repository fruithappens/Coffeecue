// components/QueueIntelligence.js
import React, { useState, useEffect, useCallback } from 'react';
import { Brain, Zap, Clock, Users, BarChart3, AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';

const QueueIntelligence = () => {
  const { stations, loading: stationsLoading } = useStations();
  const { pendingOrders, inProgressOrders } = useOrders();
  
  // Load routing rules from localStorage or use defaults
  const loadRoutingRules = () => {
    try {
      const saved = localStorage.getItem('coffee_cue_routing_rules');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Error loading routing rules from localStorage:', error);
    }
    return {
      prioritizeEfficiency: true,
      balanceWorkload: true,
      considerCapabilities: true,
      emergencyMode: false
    };
  };

  const [routingRules, setRoutingRules] = useState(loadRoutingRules());
  
  // Save routing rules to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('coffee_cue_routing_rules', JSON.stringify(routingRules));
      console.log('Saved routing rules to localStorage:', routingRules);
    } catch (error) {
      console.error('Error saving routing rules to localStorage:', error);
    }
  }, [routingRules]);
  
  const [routingMetrics, setRoutingMetrics] = useState({
    avgWaitTime: 0,
    routingEfficiency: 0,
    workloadBalance: 0,
    totalOrdersRouted: 0
  });

  // Calculate station capabilities and current workload
  const calculateStationStats = useCallback(() => {
    if (!stations || !pendingOrders || !inProgressOrders) return [];

    return stations.map(station => {
      // Get orders currently assigned to this station
      const stationInProgress = inProgressOrders.filter(order => 
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
      
      // Calculate current workload
      const currentLoad = stationInProgress.length;
      const maxCapacity = station.maxCapacity || 5; // Default max 5 concurrent orders
      const workloadPercentage = (currentLoad / maxCapacity) * 100;
      
      // Calculate efficiency (orders per hour estimate)
      const avgOrderTime = station.avgOrderTime || 4; // Default 4 minutes per order
      const ordersPerHour = Math.round(60 / avgOrderTime);
      
      // Calculate wait time estimate for new orders
      const estimatedWaitTime = currentLoad * avgOrderTime;
      
      return {
        ...station,
        capabilities,
        capabilityScore,
        currentLoad,
        maxCapacity,
        workloadPercentage,
        ordersPerHour,
        estimatedWaitTime,
        efficiency: Math.max(0, 100 - workloadPercentage), // Higher efficiency = lower workload
        status: workloadPercentage > 90 ? 'overloaded' : 
               workloadPercentage > 70 ? 'busy' : 
               workloadPercentage > 30 ? 'active' : 'available'
      };
    });
  }, [stations, pendingOrders, inProgressOrders]);

  const stationStats = calculateStationStats();

  // Intelligent routing algorithm
  const findBestStation = useCallback((order) => {
    if (!stationStats.length) return null;

    let scores = stationStats.map(station => {
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

  // Calculate overall metrics
  useEffect(() => {
    if (!stationStats.length) return;
    
    const totalOrders = inProgressOrders?.length || 0;
    const avgWait = stationStats.reduce((sum, s) => sum + (s.estimatedWaitTime || 0), 0) / stationStats.length;
    const workloadVariance = Math.sqrt(
      stationStats.reduce((sum, s) => sum + Math.pow((s.workloadPercentage || 0) - 50, 2), 0) / stationStats.length
    );
    const workloadBalance = Math.max(0, 100 - workloadVariance);
    
    setRoutingMetrics({
      avgWaitTime: Math.round(avgWait * 10) / 10,
      routingEfficiency: Math.round((workloadBalance + (100 - avgWait)) / 2),
      workloadBalance: Math.round(workloadBalance),
      totalOrdersRouted: totalOrders
    });
  }, [inProgressOrders?.length, stations?.length]);

  const getStatusColor = (status) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-800';
      case 'active': return 'bg-blue-100 text-blue-800';
      case 'busy': return 'bg-yellow-100 text-yellow-800';
      case 'overloaded': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'available': return <CheckCircle size={16} className="text-green-600" />;
      case 'active': return <Clock size={16} className="text-blue-600" />;
      case 'busy': return <Users size={16} className="text-yellow-600" />;
      case 'overloaded': return <AlertTriangle size={16} className="text-red-600" />;
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
              <div className="text-2xl font-bold">{routingMetrics.routingEfficiency || 0}%</div>
              <div className="text-sm text-purple-200">Efficiency</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{routingMetrics.avgWaitTime || 0}m</div>
              <div className="text-sm text-purple-200">Avg Wait</div>
            </div>
          </div>
        </div>
      </div>

      {/* Routing Rules */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Zap className="mr-2 text-yellow-600" />
          Routing Configuration
        </h3>
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
          <div className="text-sm text-gray-600">Avg Wait Time</div>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm text-center">
          <div className="text-2xl font-bold text-purple-600">{routingMetrics.routingEfficiency || 0}%</div>
          <div className="text-sm text-gray-600">Routing Efficiency</div>
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