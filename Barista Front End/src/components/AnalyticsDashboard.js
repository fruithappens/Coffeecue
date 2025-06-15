import React, { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, Clock, Coffee, Users, 
  Calendar, Download, Filter, RefreshCw, Activity,
  DollarSign, Target, Award, AlertCircle
} from 'lucide-react';
import useOrders from '../hooks/useOrders';
import useStations from '../hooks/useStations';

/**
 * Real-Time Analytics Dashboard
 * Comprehensive performance monitoring and insights
 */
const AnalyticsDashboard = () => {
  const { orders } = useOrders();
  const { stations } = useStations();
  
  const [timeRange, setTimeRange] = useState('today'); // today, week, month
  const [selectedMetric, setSelectedMetric] = useState('orders');
  const [refreshing, setRefreshing] = useState(false);
  
  // Calculate key metrics
  const [metrics, setMetrics] = useState({
    ordersPerHour: 0,
    avgWaitTime: 0,
    completionRate: 0,
    customerSatisfaction: 0,
    revenue: 0,
    popularItems: [],
    peakTimes: [],
    stationPerformance: []
  });
  
  // Calculate metrics based on orders
  useEffect(() => {
    if (!orders || orders.length === 0) return;
    
    // Filter orders based on time range
    const now = new Date();
    const filteredOrders = orders.filter(order => {
      const orderDate = new Date(order.created_at);
      if (timeRange === 'today') {
        return orderDate.toDateString() === now.toDateString();
      } else if (timeRange === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return orderDate >= weekAgo;
      } else if (timeRange === 'month') {
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return orderDate >= monthAgo;
      }
      return true;
    });
    
    // Calculate orders per hour
    const hoursSpan = timeRange === 'today' ? 
      (now.getHours() + 1) : 
      timeRange === 'week' ? 168 : 720;
    const ordersPerHour = filteredOrders.length / hoursSpan;
    
    // Calculate average wait time
    const completedOrders = filteredOrders.filter(o => o.status === 'completed');
    const waitTimes = completedOrders.map(order => {
      if (order.completed_at && order.created_at) {
        const wait = new Date(order.completed_at) - new Date(order.created_at);
        return wait / 1000 / 60; // minutes
      }
      return 0;
    });
    const avgWaitTime = waitTimes.length > 0 ? 
      waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
    
    // Calculate completion rate
    const completionRate = filteredOrders.length > 0 ? 
      (completedOrders.length / filteredOrders.length) * 100 : 0;
    
    // Calculate popular items
    const itemCounts = {};
    filteredOrders.forEach(order => {
      if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
          const key = item.coffee_type || 'Unknown';
          itemCounts[key] = (itemCounts[key] || 0) + 1;
        });
      }
    });
    
    const popularItems = Object.entries(itemCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([item, count]) => ({
        item,
        count,
        percentage: (count / filteredOrders.length * 100).toFixed(1)
      }));
    
    // Calculate peak times
    const hourCounts = {};
    filteredOrders.forEach(order => {
      const hour = new Date(order.created_at).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    
    const peakTimes = Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour, count]) => ({
        time: `${hour}:00`,
        count,
        label: `${hour}:00-${hour}:59`
      }));
    
    // Calculate station performance
    const stationPerformance = stations.map(station => {
      const stationOrders = filteredOrders.filter(o => o.station_id === station.id);
      const completedStationOrders = stationOrders.filter(o => o.status === 'completed');
      
      return {
        stationId: station.id,
        stationName: station.name,
        totalOrders: stationOrders.length,
        completedOrders: completedStationOrders.length,
        avgProcessTime: station.average_wait_time || 5,
        efficiency: stationOrders.length > 0 ? 
          (completedStationOrders.length / stationOrders.length * 100).toFixed(1) : 0
      };
    });
    
    // Calculate revenue (mock calculation)
    const avgOrderValue = 5.50;
    const revenue = completedOrders.length * avgOrderValue;
    
    setMetrics({
      ordersPerHour: ordersPerHour.toFixed(1),
      avgWaitTime: avgWaitTime.toFixed(1),
      completionRate: completionRate.toFixed(1),
      customerSatisfaction: 4.8, // Mock value
      revenue: revenue.toFixed(2),
      popularItems,
      peakTimes,
      stationPerformance
    });
  }, [orders, stations, timeRange]);
  
  // Handle refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    // Simulate refresh delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    setRefreshing(false);
  };
  
  // Get trend indicator
  const getTrendIndicator = (current, previous) => {
    const change = ((current - previous) / previous) * 100;
    if (change > 5) return { icon: TrendingUp, color: 'text-green-500', text: `+${change.toFixed(1)}%` };
    if (change < -5) return { icon: TrendingUp, color: 'text-red-500 rotate-180', text: `${change.toFixed(1)}%` };
    return { icon: null, color: 'text-gray-500', text: '0%' };
  };
  
  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
          <h2 className="text-xl font-semibold mb-4 md:mb-0">Analytics Dashboard</h2>
          
          <div className="flex flex-wrap gap-3">
            {/* Time Range Selector */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              {['today', 'week', 'month'].map(range => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-4 py-2 rounded-md capitalize transition-colors ${
                    timeRange === range 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            
            {/* Action Buttons */}
            <button 
              onClick={handleRefresh}
              disabled={refreshing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            
            <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center space-x-2">
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          </div>
        </div>
        
        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">Orders/Hour</p>
                <p className="text-3xl font-bold text-blue-900 mt-1">{metrics.ordersPerHour}</p>
                <div className="flex items-center mt-2 text-sm">
                  <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
                  <span className="text-green-600">+15%</span>
                  <span className="text-gray-600 ml-1">vs target</span>
                </div>
              </div>
              <div className="p-3 bg-blue-200 rounded-lg">
                <Activity className="w-6 h-6 text-blue-700" />
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 p-6 rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-amber-600 font-medium">Avg Wait Time</p>
                <p className="text-3xl font-bold text-amber-900 mt-1">{metrics.avgWaitTime}min</p>
                <div className="flex items-center mt-2 text-sm">
                  <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
                  <span className="text-green-600">-8%</span>
                  <span className="text-gray-600 ml-1">improvement</span>
                </div>
              </div>
              <div className="p-3 bg-amber-200 rounded-lg">
                <Clock className="w-6 h-6 text-amber-700" />
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-green-600 font-medium">Completion Rate</p>
                <p className="text-3xl font-bold text-green-900 mt-1">{metrics.completionRate}%</p>
                <div className="flex items-center mt-2 text-sm">
                  <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
                  <span className="text-green-600">+2%</span>
                  <span className="text-gray-600 ml-1">vs yesterday</span>
                </div>
              </div>
              <div className="p-3 bg-green-200 rounded-lg">
                <Target className="w-6 h-6 text-green-700" />
              </div>
            </div>
          </div>
          
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-lg">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-purple-600 font-medium">Revenue</p>
                <p className="text-3xl font-bold text-purple-900 mt-1">${metrics.revenue}</p>
                <div className="flex items-center mt-2 text-sm">
                  <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
                  <span className="text-green-600">+22%</span>
                  <span className="text-gray-600 ml-1">vs target</span>
                </div>
              </div>
              <div className="p-3 bg-purple-200 rounded-lg">
                <DollarSign className="w-6 h-6 text-purple-700" />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Items Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <Coffee className="w-5 h-5 mr-2" />
            Popular Items
          </h3>
          
          <div className="space-y-3">
            {metrics.popularItems.map((item, index) => (
              <div key={item.item} className="flex items-center">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium capitalize">{item.item}</span>
                    <span className="text-sm text-gray-600">{item.count} orders ({item.percentage}%)</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full ${
                        index === 0 ? 'bg-blue-500' : 
                        index === 1 ? 'bg-green-500' : 
                        index === 2 ? 'bg-amber-500' : 
                        'bg-gray-400'
                      }`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {metrics.popularItems.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Coffee className="w-12 h-12 mx-auto mb-2 text-gray-300" />
              <p>No order data available</p>
            </div>
          )}
        </div>
        
        {/* Station Performance */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center">
            <BarChart3 className="w-5 h-5 mr-2" />
            Station Performance
          </h3>
          
          <div className="space-y-3">
            {metrics.stationPerformance.map(station => (
              <div key={station.stationId} className="border rounded-lg p-3">
                <div className="flex justify-between items-center mb-2">
                  <h4 className="font-medium">{station.stationName}</h4>
                  <span className={`text-sm font-medium ${
                    parseFloat(station.efficiency) > 90 ? 'text-green-600' : 
                    parseFloat(station.efficiency) > 80 ? 'text-amber-600' : 
                    'text-red-600'
                  }`}>
                    {station.efficiency}% efficient
                  </span>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-gray-500">Orders</p>
                    <p className="font-semibold">{station.totalOrders}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Completed</p>
                    <p className="font-semibold">{station.completedOrders}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Avg Time</p>
                    <p className="font-semibold">{station.avgProcessTime}min</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Insights and Recommendations */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          Insights & Recommendations
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {metrics.peakTimes.length > 0 && (
            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Peak Time Identified</h4>
              <p className="text-blue-700">
                Highest traffic at {metrics.peakTimes[0].label} with {metrics.peakTimes[0].count} orders
              </p>
              <p className="text-sm text-blue-600 mt-2">
                → Add extra staff during this period
              </p>
            </div>
          )}
          
          {metrics.popularItems.length > 0 && (
            <div className="p-4 bg-green-50 rounded-lg">
              <h4 className="font-medium text-green-900 mb-2">Most Popular Item</h4>
              <p className="text-green-700">
                {metrics.popularItems[0].item} accounts for {metrics.popularItems[0].percentage}% of orders
              </p>
              <p className="text-sm text-green-600 mt-2">
                → Ensure sufficient stock and ingredients
              </p>
            </div>
          )}
          
          {parseFloat(metrics.avgWaitTime) > 10 && (
            <div className="p-4 bg-amber-50 rounded-lg">
              <h4 className="font-medium text-amber-900 mb-2">Wait Time Alert</h4>
              <p className="text-amber-700">
                Average wait time ({metrics.avgWaitTime}min) exceeds target
              </p>
              <p className="text-sm text-amber-600 mt-2">
                → Consider opening additional stations
              </p>
            </div>
          )}
          
          {metrics.stationPerformance.some(s => parseFloat(s.efficiency) < 80) && (
            <div className="p-4 bg-red-50 rounded-lg">
              <h4 className="font-medium text-red-900 mb-2">Station Efficiency</h4>
              <p className="text-red-700">
                Some stations operating below 80% efficiency
              </p>
              <p className="text-sm text-red-600 mt-2">
                → Review station assignments and workflows
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;