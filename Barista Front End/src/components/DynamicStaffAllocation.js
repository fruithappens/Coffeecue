import React, { useState, useEffect, useCallback, useMemo } from 'react';
import useStations from '../hooks/useStations';
import useOrders from '../hooks/useOrders';
import useSettings from '../hooks/useSettings';

const DynamicStaffAllocation = () => {
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
      const saved = localStorage.getItem('coffee_cue_staff_allocation');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          timeframe: parsed.timeframe || '1h',
          showAdvanced: parsed.showAdvanced || false
        };
      }
    } catch (error) {
      console.error('Error loading staff allocation settings:', error);
    }
    return {
      timeframe: '1h',
      showAdvanced: false
    };
  };
  
  const savedSettings = loadSavedSettings();
  const [performanceMetrics, setPerformanceMetrics] = useState({});
  const [allocationSuggestions, setAllocationSuggestions] = useState([]);
  const [timeframe, setTimeframe] = useState(savedSettings.timeframe);
  const [showAdvanced, setShowAdvanced] = useState(savedSettings.showAdvanced);
  
  // Save settings whenever they change
  useEffect(() => {
    try {
      const settingsToSave = {
        timeframe,
        showAdvanced
      };
      localStorage.setItem('coffee_cue_staff_allocation', JSON.stringify(settingsToSave));
      console.log('Saved staff allocation settings:', settingsToSave);
    } catch (error) {
      console.error('Error saving staff allocation settings:', error);
    }
  }, [timeframe, showAdvanced]);

  // Calculate performance metrics for each barista/station
  const calculatePerformanceMetrics = useCallback(() => {
    const metrics = {};
    const timeframes = {
      '1h': 1,
      '4h': 4,
      '8h': 8,
      '1d': 24
    };
    
    const hoursBack = timeframes[timeframe];
    const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
    
    stations.forEach(station => {
      const stationOrders = ordersData.completed.filter(order => 
        order.station_id === station.id && 
        new Date(order.completed_at || order.updated_at) > cutoffTime
      );
      
      const totalOrders = stationOrders.length;
      const totalRevenue = stationOrders.reduce((sum, order) => sum + (order.total || 0), 0);
      
      // Calculate average completion time
      const completionTimes = stationOrders
        .filter(order => order.started_at && order.completed_at)
        .map(order => 
          new Date(order.completed_at) - new Date(order.started_at)
        );
      
      const avgCompletionTime = completionTimes.length > 0 
        ? completionTimes.reduce((sum, time) => sum + time, 0) / completionTimes.length / 60000 // in minutes
        : 0;
      
      // Calculate efficiency score (orders per hour adjusted for complexity)
      const ordersPerHour = totalOrders / hoursBack;
      const complexityFactor = stationOrders.reduce((sum, order) => {
        let complexity = 1;
        if (order.milk_type && order.milk_type !== 'none') complexity += 0.3;
        if (order.size === 'large') complexity += 0.2;
        if (order.special_instructions) complexity += 0.5;
        return sum + complexity;
      }, 0) / Math.max(totalOrders, 1);
      
      const efficiencyScore = ordersPerHour * complexityFactor;
      
      // Error rate (cancelled or refunded orders)
      const errorOrders = ordersData.cancelled?.filter(order => 
        order.station_id === station.id && 
        new Date(order.updated_at) > cutoffTime
      ).length || 0;
      const errorRate = totalOrders > 0 ? (errorOrders / totalOrders) * 100 : 0;
      
      // Current workload
      const currentOrders = ordersData.inProgress.filter(order => order.station_id === station.id).length;
      const pendingOrders = ordersData.pending.filter(order => order.station_id === station.id).length;
      const currentWorkload = currentOrders + pendingOrders;
      
      metrics[station.id] = {
        stationName: station.name,
        baristaName: station.current_barista || 'Unassigned',
        totalOrders,
        totalRevenue,
        ordersPerHour: parseFloat(ordersPerHour.toFixed(1)),
        avgCompletionTime: parseFloat(avgCompletionTime.toFixed(1)),
        efficiencyScore: parseFloat(efficiencyScore.toFixed(2)),
        errorRate: parseFloat(errorRate.toFixed(1)),
        currentWorkload,
        status: station.status || 'active',
        capabilities: station.capabilities || {},
        lastOrderTime: stationOrders.length > 0 
          ? Math.max(...stationOrders.map(o => new Date(o.completed_at || o.updated_at).getTime()))
          : null
      };
    });
    
    setPerformanceMetrics(metrics);
  }, [stations, ordersData?.pending?.length, ordersData?.inProgress?.length, ordersData?.completed?.length, timeframe]);

  // Generate allocation suggestions
  const generateAllocationSuggestions = useCallback(() => {
    const suggestions = [];
    const stationMetrics = Object.values(performanceMetrics);
    
    if (stationMetrics.length === 0) return;
    
    // Find overloaded stations
    const avgWorkload = stationMetrics.reduce((sum, m) => sum + m.currentWorkload, 0) / stationMetrics.length;
    const overloadedStations = stationMetrics.filter(m => m.currentWorkload > avgWorkload * 1.5);
    
    // Find underutilized stations
    const underutilizedStations = stationMetrics.filter(m => 
      m.currentWorkload < avgWorkload * 0.5 && m.status === 'active'
    );
    
    // Suggest redistributions
    overloadedStations.forEach(overloaded => {
      const bestTarget = underutilizedStations
        .filter(under => {
          // Check capability compatibility
          const overloadedCaps = overloaded.capabilities;
          const underCaps = under.capabilities;
          return Object.keys(overloadedCaps).every(cap => underCaps[cap]);
        })
        .sort((a, b) => b.efficiencyScore - a.efficiencyScore)[0];
      
      if (bestTarget) {
        suggestions.push({
          type: 'redistribute',
          from: overloaded.stationName,
          to: bestTarget.stationName,
          reason: `${overloaded.stationName} has ${overloaded.currentWorkload} orders vs ${bestTarget.stationName}'s ${bestTarget.currentWorkload}`,
          impact: `Could reduce wait time by ~${Math.round((overloaded.currentWorkload - bestTarget.currentWorkload) * overloaded.avgCompletionTime / 4)} minutes`,
          priority: overloaded.currentWorkload > avgWorkload * 2 ? 'high' : 'medium'
        });
      }
    });
    
    // Suggest breaks for high-performing but overworked stations
    stationMetrics.forEach(station => {
      const lastOrderTime = station.lastOrderTime;
      const timeSinceLastOrder = lastOrderTime ? (Date.now() - lastOrderTime) / 60000 : 0; // minutes
      
      if (station.ordersPerHour > avgWorkload * 1.2 && timeSinceLastOrder < 30 && station.currentWorkload > 3) {
        suggestions.push({
          type: 'break',
          station: station.stationName,
          reason: `High performance (${station.ordersPerHour} orders/hr) but continuous work for ${Math.round(timeSinceLastOrder)} minutes`,
          impact: 'Prevent burnout and maintain quality',
          priority: 'medium'
        });
      }
    });
    
    // Suggest additional staff for peak times
    const totalCurrentWorkload = stationMetrics.reduce((sum, m) => sum + m.currentWorkload, 0);
    const activeStations = stationMetrics.filter(m => m.status === 'active').length;
    
    if (totalCurrentWorkload > activeStations * 3) {
      suggestions.push({
        type: 'additional_staff',
        reason: `High demand: ${totalCurrentWorkload} orders across ${activeStations} stations`,
        impact: 'Could reduce overall wait times significantly',
        priority: 'high'
      });
    }
    
    setAllocationSuggestions(suggestions);
  }, [performanceMetrics]);

  useEffect(() => {
    calculatePerformanceMetrics();
  }, [calculatePerformanceMetrics]);

  useEffect(() => {
    generateAllocationSuggestions();
  }, [generateAllocationSuggestions]);

  // Get top performers
  const topPerformers = useMemo(() => {
    return Object.values(performanceMetrics)
      .filter(m => m.totalOrders > 0)
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore)
      .slice(0, 3);
  }, [performanceMetrics]);

  const handleStationStatusChange = async (stationId, newStatus) => {
    try {
      await updateStation(stationId, { status: newStatus });
    } catch (error) {
      console.error('Failed to update station status:', error);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'text-red-600 bg-red-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'break': return 'text-yellow-600 bg-yellow-100';
      case 'offline': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Dynamic Staff Allocation</h2>
        <div className="flex space-x-4">
          <select 
            value={timeframe} 
            onChange={(e) => setTimeframe(e.target.value)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="1h">Last Hour</option>
            <option value="4h">Last 4 Hours</option>
            <option value="8h">Last 8 Hours</option>
            <option value="1d">Last Day</option>
          </select>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced
          </button>
        </div>
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Top Performers</h3>
          <div className="space-y-3">
            {topPerformers.map((performer, index) => (
              <div key={performer.stationName} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{performer.baristaName}</div>
                  <div className="text-sm text-gray-500">{performer.stationName}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-green-600">{performer.efficiencyScore}</div>
                  <div className="text-xs text-gray-500">efficiency score</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Current Workload</h3>
          <div className="space-y-3">
            {Object.values(performanceMetrics).map(station => (
              <div key={station.stationName} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{station.stationName}</div>
                  <div className="text-sm text-gray-500">{station.baristaName}</div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="text-lg font-bold">{station.currentWorkload}</span>
                  <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(station.status)}`}>
                    {station.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Allocation Suggestions</h3>
          <div className="space-y-3">
            {allocationSuggestions.slice(0, 3).map((suggestion, index) => (
              <div key={index} className={`p-3 rounded-lg ${getPriorityColor(suggestion.priority)}`}>
                <div className="font-medium text-sm">
                  {suggestion.type === 'redistribute' && `Move orders: ${suggestion.from} → ${suggestion.to}`}
                  {suggestion.type === 'break' && `Break suggested: ${suggestion.station}`}
                  {suggestion.type === 'additional_staff' && 'Additional staff needed'}
                </div>
                <div className="text-xs mt-1">{suggestion.impact}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detailed Performance Metrics */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Station Performance Metrics</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Station</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Barista</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Orders/Hr</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Time</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Efficiency</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Load</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                {showAdvanced && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.values(performanceMetrics).map(station => (
                <tr key={station.stationName}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {station.stationName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {station.baristaName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {station.ordersPerHour}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {station.avgCompletionTime}m
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      station.efficiencyScore > 2 ? 'bg-green-100 text-green-800' :
                      station.efficiencyScore > 1 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {station.efficiencyScore}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {station.errorRate}%
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      station.currentWorkload > 3 ? 'bg-red-100 text-red-800' :
                      station.currentWorkload > 1 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {station.currentWorkload}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(station.status)}`}>
                      {station.status}
                    </span>
                  </td>
                  {showAdvanced && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <select
                        value={station.status}
                        onChange={(e) => {
                          const stationObj = stations.find(s => s.name === station.stationName);
                          if (stationObj?.id) {
                            handleStationStatusChange(stationObj.id, e.target.value);
                          }
                        }}
                        className="border rounded px-2 py-1 text-xs"
                      >
                        <option value="active">Active</option>
                        <option value="break">Break</option>
                        <option value="offline">Offline</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Allocation Suggestions */}
      {allocationSuggestions.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Detailed Allocation Recommendations</h3>
          </div>
          <div className="p-6 space-y-4">
            {allocationSuggestions.map((suggestion, index) => (
              <div key={index} className={`p-4 rounded-lg border-l-4 ${
                suggestion.priority === 'high' ? 'border-red-400 bg-red-50' :
                suggestion.priority === 'medium' ? 'border-yellow-400 bg-yellow-50' :
                'border-green-400 bg-green-50'
              }`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-semibold text-gray-900">
                      {suggestion.type === 'redistribute' && 'Redistribute Orders'}
                      {suggestion.type === 'break' && 'Break Recommendation'}
                      {suggestion.type === 'additional_staff' && 'Additional Staff Needed'}
                    </h4>
                    <p className="text-gray-700 mt-1">{suggestion.reason}</p>
                    <p className="text-sm text-gray-600 mt-2">Expected Impact: {suggestion.impact}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPriorityColor(suggestion.priority)}`}>
                    {suggestion.priority}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default DynamicStaffAllocation;