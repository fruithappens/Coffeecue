import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Package, AlertTriangle, TrendingDown, RefreshCw, Truck, Coffee } from 'lucide-react';
import useStations from '../hooks/useStations';
import useStock from '../hooks/useStock';
import useSettings from '../hooks/useSettings';

const MultiLevelInventory = () => {
  const { stations } = useStations();
  const { settings } = useSettings();
  const [selectedView, setSelectedView] = useState('overview'); // overview, station, predictions
  const [selectedStation, setSelectedStation] = useState(null);
  const [inventoryData, setInventoryData] = useState({
    eventLevel: {},
    stationLevel: {},
    predictions: {},
    alerts: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [autoRestockSettings, setAutoRestockSettings] = useState({
    enabled: true,
    threshold: 20, // percentage
    orderLeadTime: 24 // hours
  });

  // Load inventory data from API
  const loadInventoryData = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Fetch event-level inventory
      const token = localStorage.getItem('authToken') || localStorage.getItem('coffee_system_token');
      const eventResponse = await fetch('/api/inventory/event', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });
      
      if (!eventResponse.ok) {
        throw new Error('Failed to fetch event inventory');
      }
      
      const eventData = await eventResponse.json();
      
      // Fetch station-level inventory for all stations
      const stationPromises = stations.map(station => 
        fetch(`/api/inventory?station_id=${station.id}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }).then(res => res.json())
      );
      
      const stationInventories = await Promise.all(stationPromises);
      
      // Process inventory data
      const stationData = {};
      stations.forEach((station, index) => {
        stationData[station.id] = {
          ...station,
          inventory: stationInventories[index]
        };
      });
      
      // Generate predictions and alerts
      const predictions = generatePredictions(eventData, stationData);
      const alerts = generateAlerts(eventData, stationData, predictions);
      
      setInventoryData({
        eventLevel: eventData,
        stationLevel: stationData,
        predictions,
        alerts
      });
      
    } catch (error) {
      console.error('Error loading inventory data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [stations]);

  // Generate predictions based on consumption patterns
  const generatePredictions = (eventData, stationData) => {
    const predictions = {
      milkConsumption: {},
      coffeeConsumption: {},
      stockoutRisk: [],
      reorderSuggestions: []
    };
    
    // Calculate consumption rates (simplified - in real implementation would use historical data)
    const milkTypes = ['Full Cream', 'Skim', 'Soy', 'Almond', 'Oat'];
    const coffeeTypes = ['House Blend', 'Single Origin', 'Decaf'];
    
    milkTypes.forEach(milk => {
      const totalStock = Object.values(stationData).reduce((sum, station) => {
        const milkItem = station.inventory?.milk?.find(item => item.name === milk);
        return sum + (milkItem?.amount || 0);
      }, 0);
      
      const avgConsumptionRate = 0.5; // L per hour (would be calculated from historical data)
      const hoursRemaining = 8; // Event duration
      const predictedConsumption = avgConsumptionRate * hoursRemaining;
      
      predictions.milkConsumption[milk] = {
        currentStock: totalStock,
        predictedConsumption,
        remainingStock: totalStock - predictedConsumption,
        riskLevel: (totalStock - predictedConsumption) < 2 ? 'high' : 
                   (totalStock - predictedConsumption) < 5 ? 'medium' : 'low'
      };
      
      if (predictions.milkConsumption[milk].riskLevel !== 'low') {
        predictions.stockoutRisk.push({
          item: milk,
          type: 'milk',
          hoursUntilStockout: totalStock / avgConsumptionRate,
          riskLevel: predictions.milkConsumption[milk].riskLevel
        });
      }
    });
    
    coffeeTypes.forEach(coffee => {
      const totalStock = Object.values(stationData).reduce((sum, station) => {
        const coffeeItem = station.inventory?.coffee?.find(item => item.name === coffee);
        return sum + (coffeeItem?.amount || 0);
      }, 0);
      
      const avgConsumptionRate = 0.3; // kg per hour
      const hoursRemaining = 8;
      const predictedConsumption = avgConsumptionRate * hoursRemaining;
      
      predictions.coffeeConsumption[coffee] = {
        currentStock: totalStock,
        predictedConsumption,
        remainingStock: totalStock - predictedConsumption,
        riskLevel: (totalStock - predictedConsumption) < 1 ? 'high' : 
                   (totalStock - predictedConsumption) < 2 ? 'medium' : 'low'
      };
    });
    
    // Generate reorder suggestions
    predictions.stockoutRisk.forEach(risk => {
      if (risk.riskLevel === 'high') {
        predictions.reorderSuggestions.push({
          item: risk.item,
          type: risk.type,
          urgency: 'immediate',
          suggestedAmount: risk.type === 'milk' ? 10 : 5, // L or kg
          message: `Urgent: ${risk.item} will run out in ${risk.hoursUntilStockout.toFixed(1)} hours`
        });
      }
    });
    
    return predictions;
  };

  // Generate alerts based on current inventory status
  const generateAlerts = (eventData, stationData, predictions) => {
    const alerts = [];
    
    // Check for low stock at stations
    Object.entries(stationData).forEach(([stationId, station]) => {
      station.inventory?.milk?.forEach(item => {
        if (item.status === 'danger') {
          alerts.push({
            type: 'critical',
            station: station.name,
            message: `${item.name} critically low at ${station.name} (${item.amount}${item.unit} remaining)`,
            action: 'restock',
            itemType: 'milk',
            item: item.name
          });
        } else if (item.status === 'warning') {
          alerts.push({
            type: 'warning',
            station: station.name,
            message: `${item.name} running low at ${station.name} (${item.amount}${item.unit} remaining)`,
            action: 'monitor',
            itemType: 'milk',
            item: item.name
          });
        }
      });
    });
    
    // Check for unbalanced distribution
    const milkDistribution = {};
    Object.values(stationData).forEach(station => {
      station.inventory?.milk?.forEach(item => {
        if (!milkDistribution[item.name]) {
          milkDistribution[item.name] = [];
        }
        milkDistribution[item.name].push({
          station: station.name,
          amount: item.amount,
          status: item.status
        });
      });
    });
    
    Object.entries(milkDistribution).forEach(([milk, distribution]) => {
      const amounts = distribution.map(d => d.amount);
      const max = Math.max(...amounts);
      const min = Math.min(...amounts);
      
      if (max > min * 3 && min < 2) { // Significant imbalance
        const richStation = distribution.find(d => d.amount === max).station;
        const poorStation = distribution.find(d => d.amount === min).station;
        
        alerts.push({
          type: 'info',
          message: `${milk} distribution imbalanced: ${richStation} has ${max}L while ${poorStation} has only ${min}L`,
          action: 'redistribute',
          fromStation: richStation,
          toStation: poorStation,
          item: milk,
          suggestedTransfer: Math.floor((max - min) / 2)
        });
      }
    });
    
    return alerts;
  };

  // Handle stock redistribution
  const handleRedistribute = async (alert) => {
    try {
      // In a real implementation, this would call an API to transfer stock
      console.log('Redistributing:', alert);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Reload data
      await loadInventoryData();
      
    } catch (error) {
      console.error('Redistribution failed:', error);
    }
  };

  // Handle emergency restock
  const handleEmergencyRestock = async (item, type, amount) => {
    try {
      const response = await fetch('/api/inventory/emergency-restock', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('coffee_system_token')}`
        },
        body: JSON.stringify({
          item,
          type,
          amount,
          priority: 'urgent'
        })
      });
      
      if (!response.ok) {
        throw new Error('Restock request failed');
      }
      
      // Reload data
      await loadInventoryData();
      
    } catch (error) {
      console.error('Emergency restock failed:', error);
    }
  };

  useEffect(() => {
    loadInventoryData();
  }, [loadInventoryData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadInventoryData();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [loadInventoryData]);

  // Calculate totals for overview
  const totals = useMemo(() => {
    const milkTotal = Object.values(inventoryData.stationLevel).reduce((sum, station) => {
      return sum + (station.inventory?.milk?.reduce((s, item) => s + item.amount, 0) || 0);
    }, 0);
    
    const coffeeTotal = Object.values(inventoryData.stationLevel).reduce((sum, station) => {
      return sum + (station.inventory?.coffee?.reduce((s, item) => s + item.amount, 0) || 0);
    }, 0);
    
    const cupsTotal = Object.values(inventoryData.stationLevel).reduce((sum, station) => {
      return sum + (station.inventory?.cups?.reduce((s, item) => s + item.amount, 0) || 0);
    }, 0);
    
    return { milk: milkTotal, coffee: coffeeTotal, cups: cupsTotal };
  }, [inventoryData]);

  const getAlertIcon = (type) => {
    switch (type) {
      case 'critical': return <AlertTriangle className="text-red-500" size={20} />;
      case 'warning': return <TrendingDown className="text-yellow-500" size={20} />;
      case 'info': return <RefreshCw className="text-blue-500" size={20} />;
      default: return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Multi-Level Inventory Intelligence</h2>
        <div className="flex space-x-4">
          <button
            onClick={() => loadInventoryData()}
            className="flex items-center space-x-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
          >
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
          <select 
            value={selectedView} 
            onChange={(e) => setSelectedView(e.target.value)}
            className="border rounded-lg px-3 py-2"
          >
            <option value="overview">Event Overview</option>
            <option value="station">Station View</option>
            <option value="predictions">Predictions & Analytics</option>
          </select>
        </div>
      </div>

      {/* Alerts Section */}
      {inventoryData.alerts.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="text-lg font-semibold mb-3">Active Alerts</h3>
          <div className="space-y-2">
            {inventoryData.alerts.map((alert, index) => (
              <div key={index} className={`flex items-center justify-between p-3 rounded-lg border ${
                alert.type === 'critical' ? 'border-red-300 bg-red-50' :
                alert.type === 'warning' ? 'border-yellow-300 bg-yellow-50' :
                'border-blue-300 bg-blue-50'
              }`}>
                <div className="flex items-center space-x-3">
                  {getAlertIcon(alert.type)}
                  <span className="text-sm">{alert.message}</span>
                </div>
                {alert.action === 'redistribute' && (
                  <button
                    onClick={() => handleRedistribute(alert)}
                    className="text-sm bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                  >
                    Redistribute {alert.suggestedTransfer}L
                  </button>
                )}
                {alert.action === 'restock' && (
                  <button
                    onClick={() => handleEmergencyRestock(alert.item, alert.itemType, 10)}
                    className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                  >
                    Emergency Restock
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overview View */}
      {selectedView === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Total Milk Stock</h3>
              <Package className="text-blue-500" size={24} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{totals.milk.toFixed(1)}L</div>
            <div className="mt-2 text-sm text-gray-500">
              Across {Object.keys(inventoryData.stationLevel).length} stations
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Total Coffee Stock</h3>
              <Coffee className="text-brown-500" size={24} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{totals.coffee.toFixed(1)}kg</div>
            <div className="mt-2 text-sm text-gray-500">
              {inventoryData.predictions?.stockoutRisk?.filter(r => r.type === 'coffee').length || 0} items at risk
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Total Cups</h3>
              <Package className="text-green-500" size={24} />
            </div>
            <div className="text-3xl font-bold text-gray-900">{totals.cups}</div>
            <div className="mt-2 text-sm text-gray-500">
              All sizes combined
            </div>
          </div>
        </div>
      )}

      {/* Station View */}
      {selectedView === 'station' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <select
              value={selectedStation?.id || ''}
              onChange={(e) => setSelectedStation(inventoryData.stationLevel[e.target.value])}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Select a station...</option>
              {Object.values(inventoryData.stationLevel).map(station => (
                <option key={station.id} value={station.id}>
                  {station.name}
                </option>
              ))}
            </select>
          </div>
          
          {selectedStation && (
            <div className="p-6">
              <h3 className="text-xl font-semibold mb-4">{selectedStation.name} Inventory</h3>
              
              {/* Milk Inventory */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3">Milk Stock</h4>
                <div className="space-y-2">
                  {selectedStation.inventory?.milk?.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <div>
                        <span className="font-medium">{item.name}</span>
                        <span className={`ml-2 text-xs px-2 py-1 rounded ${
                          item.status === 'good' ? 'bg-green-100 text-green-700' :
                          item.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{item.amount}{item.unit}</div>
                        <div className="text-xs text-gray-500">of {item.capacity}{item.unit}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Coffee Inventory */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3">Coffee Stock</h4>
                <div className="space-y-2">
                  {selectedStation.inventory?.coffee?.map(item => (
                    <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                      <div>
                        <span className="font-medium">{item.name}</span>
                        <span className={`ml-2 text-xs px-2 py-1 rounded ${
                          item.status === 'good' ? 'bg-green-100 text-green-700' :
                          item.status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{item.amount}{item.unit}</div>
                        <div className="text-xs text-gray-500">of {item.capacity}{item.unit}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Predictions View */}
      {selectedView === 'predictions' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Consumption Predictions</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Milk Predictions */}
              <div>
                <h4 className="text-lg font-medium mb-3">Milk Consumption Forecast</h4>
                <div className="space-y-3">
                  {Object.entries(inventoryData.predictions?.milkConsumption || {}).map(([milk, data]) => (
                    <div key={milk} className="border rounded-lg p-3">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-medium">{milk}</span>
                        <span className={`text-xs px-2 py-1 rounded ${
                          data.riskLevel === 'high' ? 'bg-red-100 text-red-700' :
                          data.riskLevel === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {data.riskLevel} risk
                        </span>
                      </div>
                      <div className="text-sm text-gray-600">
                        Current: {data.currentStock.toFixed(1)}L | 
                        Predicted use: {data.predictedConsumption.toFixed(1)}L | 
                        Remaining: {data.remainingStock.toFixed(1)}L
                      </div>
                      <div className="mt-2 bg-gray-200 h-2 rounded-full overflow-hidden">
                        <div 
                          className={`h-2 ${
                            data.riskLevel === 'high' ? 'bg-red-500' :
                            data.riskLevel === 'medium' ? 'bg-yellow-500' :
                            'bg-green-500'
                          }`}
                          style={{ width: `${Math.max(0, Math.min(100, (data.remainingStock / data.currentStock) * 100))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Reorder Suggestions */}
              <div>
                <h4 className="text-lg font-medium mb-3">Reorder Suggestions</h4>
                <div className="space-y-3">
                  {inventoryData.predictions?.reorderSuggestions?.map((suggestion, index) => (
                    <div key={index} className="border border-red-300 bg-red-50 rounded-lg p-3">
                      <div className="flex items-center space-x-2 mb-2">
                        <Truck className="text-red-500" size={20} />
                        <span className="font-medium text-red-700">{suggestion.urgency.toUpperCase()}</span>
                      </div>
                      <div className="text-sm">{suggestion.message}</div>
                      <div className="mt-2">
                        <button className="text-sm bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600">
                          Order {suggestion.suggestedAmount}{suggestion.type === 'milk' ? 'L' : 'kg'} now
                        </button>
                      </div>
                    </div>
                  ))}
                  {(!inventoryData.predictions?.reorderSuggestions || inventoryData.predictions?.reorderSuggestions?.length === 0) && (
                    <div className="text-center py-8 text-gray-500">
                      <Package size={48} className="mx-auto mb-2 text-gray-400" />
                      <p>No urgent reorders needed</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Auto-Restock Settings */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold mb-4">Auto-Restock Settings</h3>
            <div className="space-y-4">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={autoRestockSettings.enabled}
                  onChange={(e) => setAutoRestockSettings({...autoRestockSettings, enabled: e.target.checked})}
                  className="h-4 w-4"
                />
                <span>Enable automatic restock orders</span>
              </label>
              
              {autoRestockSettings.enabled && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Restock when stock falls below:
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="range"
                        min="10"
                        max="50"
                        value={autoRestockSettings.threshold}
                        onChange={(e) => setAutoRestockSettings({...autoRestockSettings, threshold: parseInt(e.target.value)})}
                        className="flex-1"
                      />
                      <span className="w-12 text-right">{autoRestockSettings.threshold}%</span>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Order lead time:
                    </label>
                    <select
                      value={autoRestockSettings.orderLeadTime}
                      onChange={(e) => setAutoRestockSettings({...autoRestockSettings, orderLeadTime: parseInt(e.target.value)})}
                      className="border rounded px-3 py-1"
                    >
                      <option value="12">12 hours</option>
                      <option value="24">24 hours</option>
                      <option value="48">48 hours</option>
                      <option value="72">72 hours</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiLevelInventory;