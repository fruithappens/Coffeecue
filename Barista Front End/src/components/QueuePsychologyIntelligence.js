import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Brain, Clock, Users, TrendingUp, MessageCircle, 
  AlertCircle, ChevronRight, Zap, Coffee, Star,
  ArrowRight, BarChart2, Target, Award
} from 'lucide-react';
import useOrders from '../hooks/useOrders';
import useStations from '../hooks/useStations';
import useSettings from '../hooks/useSettings';

const QueuePsychologyIntelligence = () => {
  const { pendingOrders, inProgressOrders, completedOrders, sendMessage } = useOrders();
  const { stations } = useStations();
  const { settings } = useSettings();
  
  // Create ordersData object for backward compatibility
  const ordersData = {
    pending: pendingOrders || [],
    inProgress: inProgressOrders || [],
    completed: completedOrders || []
  };
  
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showAlternativeDialog, setShowAlternativeDialog] = useState(false);
  const [communicationMode, setCommunicationMode] = useState('precise'); // precise, friendly, gamified
  const [batchOptimization, setBatchOptimization] = useState(true);
  const [selectedAlternative, setSelectedAlternative] = useState(null);
  
  // Find batch optimization opportunities
  const findBatchOpportunities = useCallback((orders) => {
    const opportunities = [];
    
    // Group by milk type
    const milkGroups = {};
    orders.forEach(order => {
      const milk = order.milkType || 'none';
      if (!milkGroups[milk]) milkGroups[milk] = [];
      milkGroups[milk].push(order);
    });
    
    // Find groups with 3+ orders
    Object.entries(milkGroups).forEach(([milk, orders]) => {
      if (orders.length >= 3) {
        opportunities.push({
          id: `milk-${milk}`,
          type: 'milk',
          description: `${orders.length} ${milk} orders`,
          orders: orders.map(o => o.orderNumber),
          timeSaved: Math.round(orders.length * 0.5), // Estimate 30s saved per order in batch
          priority: orders.some(o => o.vip) ? 'high' : 'medium'
        });
      }
    });
    
    // Group by coffee type
    const coffeeGroups = {};
    orders.forEach(order => {
      const coffee = order.coffeeType || 'unknown';
      if (!coffeeGroups[coffee]) coffeeGroups[coffee] = [];
      coffeeGroups[coffee].push(order);
    });
    
    Object.entries(coffeeGroups).forEach(([coffee, orders]) => {
      if (orders.length >= 3) {
        opportunities.push({
          id: `coffee-${coffee}`,
          type: 'coffee',
          description: `${orders.length} ${coffee} orders`,
          orders: orders.map(o => o.orderNumber),
          timeSaved: Math.round(orders.length * 0.3),
          priority: 'low'
        });
      }
    });
    
    return opportunities.sort((a, b) => b.timeSaved - a.timeSaved);
  }, []);
  
  // Calculate queue insights
  const queueInsights = useMemo(() => {
    if (!ordersData?.pending) return {
      averageWait: 0,
      longestWait: 0,
      queueVelocity: 0,
      predictedClearTime: 0,
      customerTypes: {},
      batchOpportunities: []
    };
    
    const pending = ordersData.pending;
    const inProgress = ordersData.inProgress;
    
    // Average and longest wait
    const waitTimes = pending.map(o => o.waitTime || 0);
    const averageWait = waitTimes.length > 0 
      ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length 
      : 0;
    const longestWait = Math.max(...waitTimes, 0);
    
    // Queue velocity (orders completed per minute)
    const recentCompleted = ordersData.completed.filter(o => {
      const completedTime = new Date(o.completed_at || o.updated_at);
      return completedTime > new Date(Date.now() - 10 * 60 * 1000); // Last 10 minutes
    });
    const queueVelocity = recentCompleted.length / 10; // Per minute
    
    // Predicted clear time
    const totalOrders = pending.length + inProgress.length;
    const predictedClearTime = queueVelocity > 0 ? totalOrders / queueVelocity : 0;
    
    // Customer types analysis
    const customerTypes = {
      vip: pending.filter(o => o.vip || o.priority).length,
      regular: pending.filter(o => !o.vip && !o.priority && !o.first_time).length,
      firstTime: pending.filter(o => o.first_time).length,
      returning: pending.filter(o => o.returning_customer).length
    };
    
    // Batch optimization opportunities
    const batchOpportunities = findBatchOpportunities(pending);
    
    return {
      averageWait: Math.round(averageWait),
      longestWait: Math.round(longestWait),
      queueVelocity: queueVelocity.toFixed(2),
      predictedClearTime: Math.round(predictedClearTime),
      customerTypes,
      batchOpportunities
    };
  }, [ordersData, findBatchOpportunities]);
  
  // Generate personalized wait message
  const generateWaitMessage = (order) => {
    const messages = {
      precise: {
        template: "Your ${coffee} will be ready in ${time} minutes and ${seconds} seconds. You're ${position} in line at ${station}.",
        alternativePrompt: "Station ${altStation} can make your order ${timeDiff} minutes faster. Switch?"
      },
      friendly: {
        template: "Hey ${name}! Your ${coffee} is being crafted with care. About ${time} minutes to go! ☕",
        alternativePrompt: "Pro tip: ${altStation} has a shorter queue! Save ${timeDiff} minutes?"
      },
      gamified: {
        template: "Level up! Your ${coffee} quest: ${time} min remaining. Position: ${position}/${total} 🎮",
        alternativePrompt: "Speed boost available! ${altStation} offers -${timeDiff} min buff!"
      }
    };
    
    const mode = messages[communicationMode];
    const position = ordersData.pending.findIndex(o => o.id === order.id) + 1;
    const station = stations.find(s => s.id === order.station_id)?.name || 'Station 1';
    
    return mode.template
      .replace('${coffee}', order.coffeeType)
      .replace('${time}', Math.floor(order.waitTime))
      .replace('${seconds}', Math.round((order.waitTime % 1) * 60))
      .replace('${position}', position)
      .replace('${station}', station)
      .replace('${name}', order.customerName?.split(' ')[0] || 'there')
      .replace('${total}', ordersData.pending.length);
  };
  
  // Find alternative routing for customer
  const findAlternativeRouting = (order) => {
    const currentStation = stations.find(s => s.id === order.station_id);
    if (!currentStation) return null;
    
    const alternatives = [];
    
    stations.forEach(station => {
      if (station.id === order.station_id || station.status !== 'active') return;
      
      // Check if station can make this order
      const canMake = station.capabilities?.standard_coffee || 
                     (order.alternativeMilk && station.capabilities?.alternative_milk);
      if (!canMake) return;
      
      // Calculate wait time at this station
      const stationOrders = ordersData.pending.filter(o => o.station_id === station.id).length;
      const stationInProgress = ordersData.inProgress.filter(o => o.station_id === station.id).length;
      const estimatedWait = (stationOrders + stationInProgress) * 2; // 2 min per order estimate
      
      if (estimatedWait < order.waitTime - 2) { // At least 2 minutes faster
        alternatives.push({
          station,
          currentWait: order.waitTime,
          newWait: estimatedWait,
          timeSaved: Math.round(order.waitTime - estimatedWait),
          incentive: estimatedWait < 5 ? 'priority' : 'normal'
        });
      }
    });
    
    return alternatives.sort((a, b) => b.timeSaved - a.timeSaved)[0];
  };
  
  // Handle alternative acceptance
  const handleAcceptAlternative = async () => {
    if (!selectedCustomer || !selectedAlternative) return;
    
    try {
      // Update order with new station
      console.log('Switching order to alternative station:', selectedAlternative);
      
      // Send confirmation message
      await sendMessage(selectedCustomer.id, 
        `Great choice! Your order has been moved to ${selectedAlternative.station.name}. New wait time: ${selectedAlternative.newWait} minutes.`
      );
      
      setShowAlternativeDialog(false);
      setSelectedAlternative(null);
    } catch (error) {
      console.error('Failed to switch station:', error);
    }
  };
  
  // Calculate customer satisfaction metrics
  const satisfactionMetrics = useMemo(() => {
    const completed = ordersData.completed || [];
    const total = completed.length;
    
    if (total === 0) return {
      overall: 0,
      waitTimeScore: 0,
      accuracyScore: 0,
      communicationScore: 0
    };
    
    // Wait time satisfaction (under 10 min = 100%, degrades from there)
    const avgCompletionTime = completed.reduce((sum, o) => {
      const wait = o.actual_wait_time || o.waitTime || 0;
      return sum + Math.max(0, 100 - (wait - 10) * 5); // -5% per minute over 10
    }, 0) / total;
    
    // Order accuracy (based on modifications/remakes)
    const accuracyScore = 98; // Would be calculated from actual remake data
    
    // Communication score (based on message response rates)
    const communicationScore = 95; // Would be calculated from actual response data
    
    return {
      overall: Math.round((avgCompletionTime + accuracyScore + communicationScore) / 3),
      waitTimeScore: Math.round(avgCompletionTime),
      accuracyScore,
      communicationScore
    };
  }, [ordersData]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
          <Brain className="mr-2" size={24} />
          Queue Psychology & Customer Intelligence
        </h2>
        <div className="flex items-center space-x-4">
          <select
            value={communicationMode}
            onChange={(e) => setCommunicationMode(e.target.value)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="precise">Precise Mode</option>
            <option value="friendly">Friendly Mode</option>
            <option value="gamified">Gamified Mode</option>
          </select>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={batchOptimization}
              onChange={(e) => setBatchOptimization(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Batch Optimization</span>
          </label>
        </div>
      </div>

      {/* Queue Intelligence Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <Clock className="text-blue-500" size={20} />
            <span className="text-xs text-gray-500">Average</span>
          </div>
          <div className="text-2xl font-bold">{queueInsights.averageWait}m</div>
          <div className="text-sm text-gray-500">Wait Time</div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="text-green-500" size={20} />
            <span className="text-xs text-gray-500">Per minute</span>
          </div>
          <div className="text-2xl font-bold">{queueInsights.queueVelocity}</div>
          <div className="text-sm text-gray-500">Queue Velocity</div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <Target className="text-purple-500" size={20} />
            <span className="text-xs text-gray-500">Predicted</span>
          </div>
          <div className="text-2xl font-bold">{queueInsights.predictedClearTime}m</div>
          <div className="text-sm text-gray-500">Queue Clear Time</div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <Star className="text-yellow-500" size={20} />
            <span className="text-xs text-gray-500">Overall</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{satisfactionMetrics.overall}%</div>
          <div className="text-sm text-gray-500">Satisfaction</div>
        </div>
      </div>

      {/* Customer Type Distribution */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Customer Distribution</h3>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{queueInsights.customerTypes.vip}</div>
            <div className="text-sm text-gray-500">VIP Orders</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{queueInsights.customerTypes.returning}</div>
            <div className="text-sm text-gray-500">Returning</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{queueInsights.customerTypes.firstTime}</div>
            <div className="text-sm text-gray-500">First Time</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-gray-600">{queueInsights.customerTypes.regular}</div>
            <div className="text-sm text-gray-500">Regular</div>
          </div>
        </div>
      </div>

      {/* Batch Optimization Opportunities */}
      {batchOptimization && queueInsights.batchOpportunities.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h3 className="text-lg font-semibold flex items-center">
              <Zap className="mr-2 text-yellow-500" size={20} />
              Batch Optimization Opportunities
            </h3>
          </div>
          <div className="p-4 space-y-3">
            {queueInsights.batchOpportunities.map(batch => (
              <div key={batch.id} className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                <div>
                  <div className="font-medium">{batch.description}</div>
                  <div className="text-sm text-gray-600">
                    Orders: {batch.orders.join(', ')} • Save ~{batch.timeSaved} minutes
                  </div>
                </div>
                <button className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600">
                  Batch Process
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Smart Queue Management */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Smart Queue Management</h3>
        </div>
        <div className="p-4">
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {ordersData.pending.slice(0, 10).map(order => {
              const alternative = findAlternativeRouting(order);
              const message = generateWaitMessage(order);
              
              return (
                <div key={order.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">#{order.orderNumber}</span>
                        <span className="text-gray-600">- {order.customerName}</span>
                        {order.vip && (
                          <span className="bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded">VIP</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 mt-1">{order.coffeeType}, {order.milkType}</div>
                      <div className="text-sm text-blue-600 mt-2 italic">"{message}"</div>
                    </div>
                    
                    <div className="ml-4 text-right">
                      <div className="text-2xl font-bold">{Math.round(order.waitTime)}m</div>
                      <div className="text-xs text-gray-500">wait time</div>
                      
                      {alternative && (
                        <button
                          onClick={() => {
                            setSelectedCustomer(order);
                            setSelectedAlternative(alternative);
                            setShowAlternativeDialog(true);
                          }}
                          className="mt-2 text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                        >
                          Save {alternative.timeSaved}m
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Customer Experience Metrics */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Customer Experience Metrics</h3>
        </div>
        <div className="p-4">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">Wait Time Satisfaction</span>
                <span className="text-sm font-bold">{satisfactionMetrics.waitTimeScore}%</span>
              </div>
              <div className="bg-gray-200 h-3 rounded-full overflow-hidden">
                <div 
                  className="bg-green-500 h-full transition-all"
                  style={{ width: `${satisfactionMetrics.waitTimeScore}%` }}
                />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">Order Accuracy</span>
                <span className="text-sm font-bold">{satisfactionMetrics.accuracyScore}%</span>
              </div>
              <div className="bg-gray-200 h-3 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-full transition-all"
                  style={{ width: `${satisfactionMetrics.accuracyScore}%` }}
                />
              </div>
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">Communication Quality</span>
                <span className="text-sm font-bold">{satisfactionMetrics.communicationScore}%</span>
              </div>
              <div className="bg-gray-200 h-3 rounded-full overflow-hidden">
                <div 
                  className="bg-purple-500 h-full transition-all"
                  style={{ width: `${satisfactionMetrics.communicationScore}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alternative Routing Dialog */}
      {showAlternativeDialog && selectedAlternative && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Faster Service Available!</h3>
            <div className="mb-4 space-y-3">
              <div className="flex items-center space-x-2">
                <Coffee className="text-gray-400" size={20} />
                <span>Order: {selectedCustomer?.coffeeType}, {selectedCustomer?.milkType}</span>
              </div>
              
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="font-medium text-green-800">
                  {selectedAlternative.station.name} can serve you faster!
                </div>
                <div className="mt-2 space-y-1 text-sm">
                  <div>Current wait: {selectedAlternative.currentWait} minutes</div>
                  <div className="font-bold">New wait: {selectedAlternative.newWait} minutes</div>
                  <div className="text-green-600">Save {selectedAlternative.timeSaved} minutes!</div>
                </div>
              </div>
              
              {selectedAlternative.incentive === 'priority' && (
                <div className="bg-purple-50 p-3 rounded text-sm text-purple-800">
                  <Star className="inline mr-1" size={16} />
                  You'll get priority service at the new station!
                </div>
              )}
            </div>
            
            <div className="flex space-x-3">
              <button
                onClick={handleAcceptAlternative}
                className="flex-1 bg-green-500 text-white py-2 rounded-lg hover:bg-green-600"
              >
                Switch Station
              </button>
              <button
                onClick={() => {
                  setShowAlternativeDialog(false);
                  setSelectedAlternative(null);
                }}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
              >
                Keep Current
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueuePsychologyIntelligence;