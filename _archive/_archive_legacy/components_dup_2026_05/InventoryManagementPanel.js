import React, { useState, useEffect } from 'react';
import { 
  Package, AlertTriangle, TrendingDown, RefreshCw, 
  Plus, Minus, ArrowRight, BarChart3, Clock, Coffee
} from 'lucide-react';
import useStations from '../hooks/useStations';
import StockService from '../services/StockService';

/**
 * Multi-Level Inventory Management Panel
 * Real-time stock management connected to actual inventory data
 */
const InventoryManagementPanel = () => {
  const { stations } = useStations();
  const [activeView, setActiveView] = useState('overview'); // overview, station, transfers
  const [stockByStation, setStockByStation] = useState({});
  const [loading, setLoading] = useState(true);
  
  // Load stock data for all stations
  useEffect(() => {
    const loadAllStockData = async () => {
      setLoading(true);
      const stockData = {};
      
      // Get stock data from localStorage for each station
      if (stations && Array.isArray(stations)) {
        stations.forEach(station => {
          const stationStockKey = `stock_${station.id}`;
          const storedStock = localStorage.getItem(stationStockKey);
          if (storedStock) {
            try {
              stockData[station.id] = JSON.parse(storedStock);
            } catch (e) {
              console.error('Error parsing stock data for station', station.id, e);
              stockData[station.id] = {};
            }
          } else {
            // Initialize with default stock structure
            stockData[station.id] = {
              milk: [],
              coffee: [],
              cups: [],
              syrups: [],
              other: []
            };
          }
        });
      }
      
      setStockByStation(stockData);
      setLoading(false);
    };
    
    loadAllStockData();
    
    // Refresh data every 30 seconds
    const interval = setInterval(loadAllStockData, 30000);
    return () => clearInterval(interval);
  }, [stations]);
  
  // Calculate aggregate inventory data from all stations
  const calculateEventInventory = () => {
    const aggregateStock = {
      milk: {},
      coffee: {},
      cups: {},
      syrups: {},
      other: {},
      // Add allocation rules with default values
      allocationRules: {
        stationLimits: {
          basic_station: 20,
          premium_station: 40
        },
        reservePercentage: 0.2
      }
    };
    
    // Sum up stock across all stations
    Object.entries(stockByStation).forEach(([stationId, stationStock]) => {
      Object.entries(stationStock).forEach(([category, items]) => {
        if (Array.isArray(items)) {
          items.forEach(item => {
            const key = item.name || item.id;
            if (category in aggregateStock && typeof aggregateStock[category] === 'object') {
              if (!aggregateStock[category][key]) {
                aggregateStock[category][key] = {
                  name: item.name,
                  totalAmount: 0,
                  unit: item.unit || 'units',
                  stations: {},
                  lowStockStations: []
                };
              }
              
              aggregateStock[category][key].totalAmount += (item.amount || 0);
              aggregateStock[category][key].stations[stationId] = item.amount || 0;
              
              // Track stations with low stock
              if (item.status === 'warning' || item.status === 'danger') {
                aggregateStock[category][key].lowStockStations.push(stationId);
              }
            }
          });
        }
      });
    });
    
    return aggregateStock;
  };
  
  const eventInventory = calculateEventInventory();
  
  // Calculate depletion predictions
  const calculateDepletionTime = (current, usageRate) => {
    if (usageRate === 0) return 'N/A';
    const hoursRemaining = current / usageRate;
    if (hoursRemaining < 1) return `${Math.round(hoursRemaining * 60)}min`;
    return `${Math.round(hoursRemaining)}hrs`;
  };
  
  return (
    <div className="space-y-6">
      {/* View Selector */}
      <div className="bg-white rounded-lg shadow-sm p-2 flex space-x-2">
        <button
          onClick={() => setActiveView('overview')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeView === 'overview' 
              ? 'bg-green-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Event Overview
        </button>
        <button
          onClick={() => setActiveView('station')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeView === 'station' 
              ? 'bg-green-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Station Levels
        </button>
        <button
          onClick={() => setActiveView('transfers')}
          className={`flex-1 py-2 px-4 rounded-md ${
            activeView === 'transfers' 
              ? 'bg-green-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Transfers
        </button>
      </div>
      
      {/* Event Overview */}
      {activeView === 'overview' && (
        <>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4">Event Inventory Overview</h2>
            
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
                <p className="mt-2 text-gray-500">Loading inventory data...</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Milk Inventory */}
                <div>
                  <h3 className="font-medium text-gray-700 mb-3 flex items-center">
                    <Package className="w-5 h-5 mr-2" />
                    Milk Stock Levels
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(eventInventory.milk || {}).map(([key, item]) => {
                      const hasLowStock = item.lowStockStations?.length > 0;
                      
                      return (
                        <div key={key} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{item.name}</h4>
                            {hasLowStock && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                          </div>
                          
                          <div className="space-y-2">
                            <div className="text-2xl font-bold">
                              {item.totalAmount} {item.unit}
                            </div>
                            <div className="text-sm text-gray-600">
                              Across {Object.keys(item.stations || {}).length} stations
                            </div>
                            {hasLowStock && (
                              <div className="text-xs text-amber-600">
                                Low at Station{item.lowStockStations?.length > 1 ? 's' : ''}: {item.lowStockStations?.join(', ') || 'Unknown'}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Coffee Inventory */}
                <div>
                  <h3 className="font-medium text-gray-700 mb-3 flex items-center">
                    <Coffee className="w-5 h-5 mr-2" />
                    Coffee Stock Levels
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(eventInventory.coffee || {}).map(([key, item]) => {
                      const hasLowStock = item.lowStockStations?.length > 0;
                      
                      return (
                        <div key={key} className="border rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-medium">{item.name}</h4>
                            {hasLowStock && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                          </div>
                          
                          <div className="space-y-2">
                            <div className="text-2xl font-bold">
                              {item.totalAmount} {item.unit}
                            </div>
                            <div className="text-sm text-gray-600">
                              Across {Object.keys(item.stations || {}).length} stations
                            </div>
                            {hasLowStock && (
                              <div className="text-xs text-amber-600">
                                Low at Station{item.lowStockStations?.length > 1 ? 's' : ''}: {item.lowStockStations?.join(', ') || 'Unknown'}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Allocation Rules */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold mb-4">Allocation Rules</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Basic Station Limit</p>
                <p className="text-2xl font-bold">{eventInventory.allocationRules?.stationLimits?.basic_station || 20}L</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Premium Station Limit</p>
                <p className="text-2xl font-bold">{eventInventory.allocationRules?.stationLimits?.premium_station || 40}L</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">Reserve Percentage</p>
                <p className="text-2xl font-bold">{(eventInventory.allocationRules?.reservePercentage || 0.2) * 100}%</p>
              </div>
            </div>
          </div>
        </>
      )}
      
      {/* Station Levels */}
      {activeView === 'station' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">Station Stock Levels</h2>
          
          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
              <p className="mt-2 text-gray-500">Loading station data...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pb-3">Station</th>
                    <th className="pb-3">Category</th>
                    <th className="pb-3">Item</th>
                    <th className="pb-3">Current</th>
                    <th className="pb-3">Min Level</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {Object.entries(stockByStation).flatMap(([stationId, categories]) => {
                    const station = stations.find(s => s.id.toString() === stationId.toString());
                    const stationName = station?.name || `Station ${stationId}`;
                    
                    return Object.entries(categories).flatMap(([category, items]) => {
                      if (!Array.isArray(items)) return [];
                      
                      return items.map((item, idx) => {
                        const status = item.status || 'good';
                        const statusColors = {
                          'good': 'bg-green-100 text-green-800',
                          'warning': 'bg-amber-100 text-amber-800',
                          'danger': 'bg-red-100 text-red-800'
                        };
                        
                        return (
                          <tr key={`${stationId}-${category}-${idx}`}>
                            <td className="py-3">{stationName}</td>
                            <td className="py-3 capitalize">{category}</td>
                            <td className="py-3">{item.name}</td>
                            <td className="py-3">{item.amount} {item.unit}</td>
                            <td className="py-3">{item.min || 'N/A'} {item.unit}</td>
                            <td className="py-3">
                              <span className={`px-2 py-1 text-xs rounded-full ${statusColors[status]}`}>
                                {status === 'danger' ? 'Critical' : status === 'warning' ? 'Low' : 'Good'}
                              </span>
                            </td>
                            <td className="py-3">
                              <button 
                                onClick={() => {
                                  // TODO: Implement restock modal
                                  console.log('Restock', stationId, category, item);
                                }}
                                className="text-blue-600 hover:text-blue-700 text-sm"
                              >
                                Restock
                              </button>
                            </td>
                          </tr>
                        );
                      });
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      
      {/* Transfer Requests */}
      {activeView === 'transfers' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-semibold mb-4">Stock Transfers</h2>
          
          <div className="mb-6">
            <h3 className="font-medium mb-3">Pending Transfers</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div className="text-center">
                    <p className="text-sm text-gray-600">From</p>
                    <p className="font-medium">Station 2</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-400" />
                  <div className="text-center">
                    <p className="text-sm text-gray-600">To</p>
                    <p className="font-medium">Station 1</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">2L Oat Milk</p>
                  <p className="text-sm text-gray-600">Requested 5min ago</p>
                </div>
                <div className="flex space-x-2">
                  <button className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600">
                    Approve
                  </button>
                  <button className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">
                    Deny
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium mb-3">Quick Transfer</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <select className="px-3 py-2 border rounded-lg">
                <option>From Station</option>
                <option>Station 1</option>
                <option>Station 2</option>
                <option>Station 3</option>
              </select>
              <select className="px-3 py-2 border rounded-lg">
                <option>To Station</option>
                <option>Station 1</option>
                <option>Station 2</option>
                <option>Station 3</option>
              </select>
              <select className="px-3 py-2 border rounded-lg">
                <option>Item</option>
                <option>Full Cream</option>
                <option>Oat Milk</option>
                <option>Almond Milk</option>
              </select>
              <input 
                type="number" 
                placeholder="Amount (L)" 
                className="px-3 py-2 border rounded-lg"
              />
            </div>
            <button className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Request Transfer
            </button>
          </div>
        </div>
      )}
      
      {/* Predictive Analytics */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <BarChart3 className="w-6 h-6 mr-2" />
          Stock Alerts & Insights
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Low Stock Summary */}
          <div className="p-4 bg-amber-50 rounded-lg">
            <h3 className="font-medium mb-2">Low Stock Items</h3>
            <p className="text-2xl font-bold">
              {Object.entries(eventInventory).reduce((count, [key, category]) => {
                // Skip non-inventory categories like allocationRules
                if (key === 'allocationRules' || !category || typeof category !== 'object') return count;
                return count + Object.values(category).filter(item => 
                  item && item.lowStockStations && item.lowStockStations.length > 0
                ).length;
              }, 0)}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Items below minimum levels
            </p>
          </div>
          
          {/* Critical Stations */}
          <div className="p-4 bg-red-50 rounded-lg">
            <h3 className="font-medium mb-2">Critical Stations</h3>
            <div className="space-y-1">
              {stations.filter(station => {
                const stationStock = stockByStation[station.id];
                if (!stationStock) return false;
                
                // Check if any items are in danger status
                return Object.values(stationStock).some(items => 
                  Array.isArray(items) && items.some(item => item.status === 'danger')
                );
              }).slice(0, 3).map(station => (
                <p key={station.id} className="text-sm font-medium">{station.name}</p>
              ))}
              {stations.filter(station => {
                const stationStock = stockByStation[station.id];
                if (!stationStock) return false;
                return Object.values(stationStock).some(items => 
                  Array.isArray(items) && items.some(item => item.status === 'danger')
                );
              }).length === 0 && (
                <p className="text-sm text-gray-600">No critical stations</p>
              )}
            </div>
          </div>
          
          {/* Total Inventory Value */}
          <div className="p-4 bg-green-50 rounded-lg">
            <h3 className="font-medium mb-2">Active Stations</h3>
            <p className="text-2xl font-bold">{stations.length}</p>
            <p className="text-sm text-gray-600 mt-1">
              With real-time stock tracking
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InventoryManagementPanel;