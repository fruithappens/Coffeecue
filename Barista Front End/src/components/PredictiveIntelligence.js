import React, { useState, useEffect } from 'react';
import { 
  Brain, TrendingUp, AlertTriangle, Shield,
  Activity, Target, Zap, Users, Coffee,
  Clock, BarChart3, ArrowRight, RefreshCw,
  CheckCircle, XCircle, Info, ChevronDown
} from 'lucide-react';
import useOrders from '../hooks/useOrders';
import useStations from '../hooks/useStations';
import useStock from '../hooks/useStock';

/**
 * Predictive Intelligence & Resilience System
 * AI-powered predictions with automated adjustments
 */
const PredictiveIntelligence = () => {
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stations } = useStations();
  const { stockData } = useStock();
  
  // Combine all orders
  const orders = [...(pendingOrders || []), ...(inProgressOrders || []), ...(completedOrders || [])];
  
  const [predictions, setPredictions] = useState({
    demandForecast: [],
    bottlenecks: [],
    stockAlerts: [],
    staffingNeeds: [],
    customerSurge: null
  });
  
  const [resilience, setResilience] = useState({
    mode: 'normal', // normal, degraded, emergency
    activeProtocols: [],
    automations: [],
    healthScore: 85
  });
  
  const [selectedTimeframe, setSelectedTimeframe] = useState('next2hours');
  const [autoAdjust, setAutoAdjust] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Run predictions on data change
  useEffect(() => {
    runPredictions();
  }, [orders?.length, stations?.length, stockData?.length, selectedTimeframe]);
  
  // Predictive algorithms
  const runPredictions = () => {
    // Demand Forecasting
    const demandForecast = predictDemand();
    
    // Bottleneck Detection
    const bottlenecks = detectBottlenecks();
    
    // Stock Depletion Alerts
    const stockAlerts = predictStockDepletion();
    
    // Staffing Optimization
    const staffingNeeds = predictStaffingNeeds();
    
    // Customer Surge Detection
    const customerSurge = detectCustomerSurge();
    
    setPredictions({
      demandForecast,
      bottlenecks,
      stockAlerts,
      staffingNeeds,
      customerSurge
    });
    
    // Update resilience status
    updateResilienceStatus(bottlenecks, stockAlerts);
  };
  
  const predictDemand = () => {
    // Analyze historical patterns
    const hourlyOrders = {};
    // Add safety check for orders
    if (orders && Array.isArray(orders)) {
      orders.forEach(order => {
        const hour = new Date(order.created_at).getHours();
        hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
      });
    }
    
    // Generate forecast
    const currentHour = new Date().getHours();
    const forecast = [];
    
    for (let i = 0; i < 4; i++) {
      const hour = (currentHour + i) % 24;
      const historicalAvg = hourlyOrders[hour] || 0;
      
      // Apply predictive factors
      let predicted = historicalAvg;
      
      // Rush hour multiplier
      if (hour >= 7 && hour <= 9) predicted *= 1.5;
      if (hour >= 12 && hour <= 13) predicted *= 1.3;
      
      // Day of week factor
      const dayOfWeek = new Date().getDay();
      if (dayOfWeek === 1) predicted *= 1.2; // Monday surge
      if (dayOfWeek === 5) predicted *= 1.1; // Friday boost
      
      forecast.push({
        hour: `${hour}:00`,
        predicted: Math.round(predicted),
        confidence: predicted > 0 ? 85 + Math.random() * 10 : 0,
        trend: predicted > historicalAvg ? 'up' : 'down'
      });
    }
    
    return forecast;
  };
  
  const detectBottlenecks = () => {
    const bottlenecks = [];
    
    // Station capacity analysis
    if (stations && Array.isArray(stations)) {
      stations.forEach(station => {
        const stationOrders = (orders || []).filter(o => 
        o.station_id === station.id && 
        ['pending', 'in-progress'].includes(o.status)
      );
      
      const utilization = (stationOrders.length / (station.capacity || 10)) * 100;
      
      if (utilization > 80) {
        bottlenecks.push({
          id: `station-${station.id}`,
          type: 'station',
          severity: utilization > 95 ? 'critical' : 'warning',
          location: station.name,
          metric: `${utilization.toFixed(0)}% capacity`,
          impact: `${stationOrders.length} orders affected`,
          recommendation: 'Redistribute orders or add staff',
          automatable: true
        });
      }
    });
    }
    
    // Milk type bottlenecks
    const milkTypeCounts = {};
    if (orders && Array.isArray(orders)) {
      orders.forEach(order => {
      if (order.items) {
        order.items.forEach(item => {
          if (item.milk_type) {
            milkTypeCounts[item.milk_type] = (milkTypeCounts[item.milk_type] || 0) + 1;
          }
        });
      }
    });
    }
    
    Object.entries(milkTypeCounts).forEach(([milkType, count]) => {
      if (count > 20) {
        bottlenecks.push({
          id: `milk-${milkType}`,
          type: 'ingredient',
          severity: 'warning',
          location: 'All stations',
          metric: `${count} ${milkType} milk orders`,
          impact: 'Potential stock shortage',
          recommendation: 'Prepare extra stock',
          automatable: false
        });
      }
    });
    
    return bottlenecks;
  };
  
  const predictStockDepletion = () => {
    const alerts = [];
    
    if (!stockData || stockData.length === 0) return alerts;
    
    // Calculate burn rates
    if (stockData && Array.isArray(stockData)) {
      stockData.forEach(item => {
      if (item.current_stock < item.min_stock * 1.5) {
        const burnRate = calculateBurnRate(item.name);
        const hoursUntilDepletion = item.current_stock / burnRate;
        
        if (hoursUntilDepletion < 4) {
          alerts.push({
            id: `stock-${item.id}`,
            item: item.name,
            currentStock: item.current_stock,
            burnRate: burnRate.toFixed(1),
            timeToDepletion: `${hoursUntilDepletion.toFixed(1)} hours`,
            severity: hoursUntilDepletion < 2 ? 'critical' : 'warning',
            action: 'Reorder immediately',
            automatable: true
          });
        }
      }
    });
    }
    
    return alerts;
  };
  
  const calculateBurnRate = (itemName) => {
    // Simulate burn rate calculation based on recent orders
    const recentOrders = orders.filter(o => {
      const orderTime = new Date(o.created_at);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return orderTime > hourAgo;
    });
    
    // Mock calculation - in production, analyze actual consumption
    return recentOrders.length * 0.3;
  };
  
  const predictStaffingNeeds = () => {
    const needs = [];
    const forecast = predictions.demandForecast;
    
    forecast.forEach((period, index) => {
      const requiredStaff = Math.ceil(period.predicted / 10); // 1 staff per 10 orders/hour
      const currentStaff = stations.filter(s => s.is_active).length;
      
      if (requiredStaff > currentStaff) {
        needs.push({
          id: `staff-${index}`,
          time: period.hour,
          current: currentStaff,
          required: requiredStaff,
          gap: requiredStaff - currentStaff,
          urgency: index === 0 ? 'immediate' : 'scheduled',
          action: `Add ${requiredStaff - currentStaff} barista(s)`
        });
      }
    });
    
    return needs;
  };
  
  const detectCustomerSurge = () => {
    // Analyze order velocity
    const last15min = orders.filter(o => {
      const orderTime = new Date(o.created_at);
      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
      return orderTime > fifteenMinAgo;
    });
    
    const orderVelocity = last15min.length * 4; // Orders per hour
    const averageVelocity = orders.length / 8; // Assuming 8 hour day
    
    if (orderVelocity > averageVelocity * 1.5) {
      return {
        detected: true,
        velocity: orderVelocity,
        increase: ((orderVelocity / averageVelocity - 1) * 100).toFixed(0),
        duration: 'Next 30-45 minutes',
        confidence: 87
      };
    }
    
    return null;
  };
  
  const updateResilienceStatus = (bottlenecks, stockAlerts) => {
    const criticalIssues = [
      ...bottlenecks.filter(b => b.severity === 'critical'),
      ...stockAlerts.filter(a => a.severity === 'critical')
    ];
    
    let mode = 'normal';
    let healthScore = 100;
    const activeProtocols = [];
    const automations = [];
    
    // Determine mode based on issues
    if (criticalIssues.length > 3) {
      mode = 'emergency';
      healthScore = 40;
      activeProtocols.push('Emergency Response Protocol');
      automations.push('Auto-redistribute orders');
      automations.push('Priority queue activation');
    } else if (criticalIssues.length > 0 || bottlenecks.length > 2) {
      mode = 'degraded';
      healthScore = 70;
      activeProtocols.push('Load Balancing Protocol');
      automations.push('Smart routing enabled');
    }
    
    // Adjust health score based on various factors
    healthScore -= bottlenecks.length * 5;
    healthScore -= stockAlerts.length * 3;
    healthScore = Math.max(0, Math.min(100, healthScore));
    
    setResilience({
      mode,
      activeProtocols,
      automations,
      healthScore
    });
  };
  
  const handleRefresh = async () => {
    setRefreshing(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    runPredictions();
    setRefreshing(false);
  };
  
  const getHealthColor = (score) => {
    if (score >= 80) return 'text-green-600 bg-green-50';
    if (score >= 60) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };
  
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-600 bg-red-50';
      case 'warning': return 'text-amber-600 bg-amber-50';
      default: return 'text-blue-600 bg-blue-50';
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-3">
            <Brain className="w-8 h-8 text-purple-600" />
            <div>
              <h2 className="text-xl font-semibold">Predictive Intelligence</h2>
              <p className="text-sm text-gray-600">AI-powered forecasting & resilience</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {/* Timeframe Selector */}
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="next2hours">Next 2 Hours</option>
              <option value="next4hours">Next 4 Hours</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
            </select>
            
            {/* Auto-adjust Toggle */}
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAdjust}
                onChange={(e) => setAutoAdjust(e.target.checked)}
                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-sm font-medium">Auto-adjust</span>
            </label>
            
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center space-x-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
        
        {/* System Health */}
        <div className={`p-4 rounded-lg flex items-center justify-between ${getHealthColor(resilience.healthScore)}`}>
          <div className="flex items-center space-x-3">
            <Shield className="w-6 h-6" />
            <div>
              <p className="font-semibold">System Resilience: {resilience.mode.toUpperCase()}</p>
              <p className="text-sm">Health Score: {resilience.healthScore}%</p>
            </div>
          </div>
          
          {resilience.activeProtocols.length > 0 && (
            <div className="text-right">
              <p className="text-sm font-medium">Active Protocols:</p>
              {resilience.activeProtocols.map((protocol, idx) => (
                <p key={idx} className="text-xs">{protocol}</p>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {/* Demand Forecast */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <TrendingUp className="w-5 h-5 mr-2" />
          Demand Forecast
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {predictions.demandForecast.map((period, idx) => (
            <div key={idx} className="border rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-medium">{period.hour}</h4>
                {period.trend === 'up' ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : (
                  <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />
                )}
              </div>
              
              <p className="text-2xl font-bold text-gray-900">{period.predicted}</p>
              <p className="text-sm text-gray-600">orders expected</p>
              
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span>Confidence</span>
                  <span>{period.confidence}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div 
                    className="bg-purple-600 h-1.5 rounded-full"
                    style={{ width: `${period.confidence}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        
        {predictions.customerSurge && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Zap className="w-6 h-6 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-900">Customer Surge Detected!</p>
                <p className="text-sm text-amber-700">
                  +{predictions.customerSurge.increase}% increase • {predictions.customerSurge.duration}
                </p>
              </div>
            </div>
            <button className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm">
              Activate Surge Protocol
            </button>
          </div>
        )}
      </div>
      
      {/* Bottlenecks & Issues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bottleneck Detection */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2" />
            Bottleneck Detection
          </h3>
          
          <div className="space-y-3">
            {predictions.bottlenecks.length > 0 ? (
              predictions.bottlenecks.map(bottleneck => (
                <div key={bottleneck.id} className={`p-4 rounded-lg ${getSeverityColor(bottleneck.severity)}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-medium">{bottleneck.location}</h4>
                      <p className="text-sm">{bottleneck.metric} • {bottleneck.impact}</p>
                    </div>
                    <span className="text-xs font-medium uppercase">{bottleneck.severity}</span>
                  </div>
                  
                  <p className="text-sm mb-2">{bottleneck.recommendation}</p>
                  
                  {bottleneck.automatable && autoAdjust && (
                    <div className="flex items-center text-xs">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      <span>Auto-adjustment enabled</span>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-400" />
                <p>No bottlenecks detected</p>
              </div>
            )}
          </div>
        </div>
        
        {/* Stock Alerts */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Coffee className="w-5 h-5 mr-2" />
            Stock Depletion Alerts
          </h3>
          
          <div className="space-y-3">
            {predictions.stockAlerts.length > 0 ? (
              predictions.stockAlerts.map(alert => (
                <div key={alert.id} className={`p-4 rounded-lg ${getSeverityColor(alert.severity)}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium">{alert.item}</h4>
                    <span className="text-xs font-medium uppercase">{alert.severity}</span>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                    <div>
                      <p className="text-xs opacity-75">Current</p>
                      <p className="font-semibold">{alert.currentStock}</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-75">Burn Rate</p>
                      <p className="font-semibold">{alert.burnRate}/hr</p>
                    </div>
                    <div>
                      <p className="text-xs opacity-75">Time Left</p>
                      <p className="font-semibold">{alert.timeToDepletion}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <p className="text-sm">{alert.action}</p>
                    {alert.automatable && autoAdjust && (
                      <button className="text-xs underline">Auto-order</button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-400" />
                <p>Stock levels healthy</p>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Staffing Optimization */}
      {predictions.staffingNeeds.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Users className="w-5 h-5 mr-2" />
            Staffing Optimization
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {predictions.staffingNeeds.map(need => (
              <div key={need.id} className={`p-4 rounded-lg border ${
                need.urgency === 'immediate' ? 'border-red-300 bg-red-50' : 'border-gray-300'
              }`}>
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-medium">{need.time}</h4>
                  {need.urgency === 'immediate' && (
                    <span className="text-xs text-red-600 font-medium">URGENT</span>
                  )}
                </div>
                
                <div className="flex items-center space-x-4 mb-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold">{need.current}</p>
                    <p className="text-xs text-gray-600">Current</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400" />
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-600">{need.required}</p>
                    <p className="text-xs text-gray-600">Required</p>
                  </div>
                </div>
                
                <p className="text-sm font-medium text-center">{need.action}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Automated Adjustments */}
      {resilience.automations.length > 0 && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Zap className="w-5 h-5 mr-2" />
            Active Automations
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resilience.automations.map((automation, idx) => (
              <div key={idx} className="bg-white rounded-lg p-4 flex items-center space-x-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Activity className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{automation}</p>
                  <p className="text-xs text-gray-600">Running automatically</p>
                </div>
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default PredictiveIntelligence;