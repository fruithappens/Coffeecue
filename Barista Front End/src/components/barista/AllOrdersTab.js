// components/AllOrdersTab.js
import React, { useState, useEffect } from 'react';
import { Coffee, Clock, CheckCircle, Package, Users, Search, Filter, AlertCircle } from 'lucide-react';
import { getMilkColorStyle, getMilkDotStyle } from '../../utils/milkColorHelper';
import { parseServerDate } from '../../utils/orderUtils';
import '../../styles/milkColors.css';

const AllOrdersTab = () => {
  const [orders, setOrders] = useState({
    pending: [],
    inProgress: [],
    completed: [],
    previous: []
  });
  const [filter, setFilter] = useState('all');
  const [stationFilter, setStationFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalOrders: 0,
    pendingCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    avgWaitTime: 0,
    busiestStation: null
  });

  // Load all orders from all stations
  useEffect(() => {
    loadAllOrders();
    // Set up refresh interval
    const interval = setInterval(loadAllOrders, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Ask the server. This tab used to merge every `orders_cache_station_*`
  // key in the browser's localStorage -- so a stale cache showed phantom
  // copies of an order tagged "Station null" / "_backup" while the database
  // held exactly one (Claude web audit, 6 Sep 2026). /api/orders caps at 50
  // rows per status, which is a full day's activity per column.
  const loadAllOrders = async () => {
    try {
      const { default: ApiServiceClass } = await import('../../services/ApiService');
      const api = new ApiServiceClass();
      const fetchStatus = async (status) => {
        try {
          const r = await api.request(`/orders?status=${encodeURIComponent(status)}`);
          const rows = (r && (r.data || r.orders)) || [];
          return Array.isArray(rows) ? rows : [];
        } catch (e) { return []; }
      };
      const [pending, inProgress, completed, previous] = await Promise.all([
        fetchStatus('pending'), fetchStatus('in_progress'), fetchStatus('completed'), fetchStatus('picked_up'),
      ]);
      const mins = (a, b) => (a && b ? Math.max(0, Math.round((parseServerDate(b) - parseServerDate(a)) / 60000)) : null);
      const shape = (o) => ({
        ...o,
        id: o.orderNumber || o.order_number || o.id,
        assignedStation: o.stationId != null ? String(o.stationId) : (o.station_id != null ? String(o.station_id) : undefined),
        startedAt: o.startedAt || o.started_at || o.updatedAt || o.updated_at,
        completedAt: o.completedAt || o.completed_at,
        pickedUpAt: o.pickedUpAt || o.picked_up_at || o.updatedAt || o.updated_at,
        // For finished orders the wait is created -> completed, not "minutes
        // since created" (which grows forever on an old order).
        waitTime: (o.completedAt || o.completed_at)
          ? (mins(o.createdAt || o.created_at, o.completedAt || o.completed_at) ?? o.waitTime)
          : o.waitTime,
      });
      const allOrders = {
        pending: pending.map(shape),
        inProgress: inProgress.map(shape),
        completed: completed.map(shape),
        previous: previous.map(shape),
      };
      allOrders.pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      allOrders.inProgress.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      allOrders.completed.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
      allOrders.previous.sort((a, b) => new Date(b.pickedUpAt) - new Date(a.pickedUpAt));
      setOrders(allOrders);
      calculateStats(allOrders);
      setLoading(false);
    } catch (error) {
      console.error('Error loading all orders:', error);
      setLoading(false);
    }
  };

  const calculateStats = (ordersData) => {
    const totalOrders = 
      ordersData.pending.length + 
      ordersData.inProgress.length + 
      ordersData.completed.length + 
      ordersData.previous.length;

    // Calculate average wait time
    const completedWithTime = [...ordersData.completed, ...ordersData.previous]
      .filter(order => order.waitTime)
      .map(order => order.waitTime);
    
    const avgWaitTime = completedWithTime.length > 0 
      ? Math.round(completedWithTime.reduce((a, b) => a + b, 0) / completedWithTime.length)
      : 0;

    // Find busiest station
    const stationCounts = {};
    [...ordersData.pending, ...ordersData.inProgress, ...ordersData.completed, ...ordersData.previous]
      .forEach(order => {
        const station = order.assignedStation || 'unassigned';
        stationCounts[station] = (stationCounts[station] || 0) + 1;
      });
    
    const busiestStation = Object.entries(stationCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || null;

    setStats({
      totalOrders,
      pendingCount: ordersData.pending.length,
      inProgressCount: ordersData.inProgress.length,
      completedCount: ordersData.completed.length,
      avgWaitTime,
      busiestStation
    });
  };

  const filterOrders = (ordersList) => {
    return ordersList.filter(order => {
      // Station filter
      if (stationFilter !== 'all' && order.assignedStation !== stationFilter) {
        return false;
      }
      
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        return (
          (order.customerName?.toLowerCase().includes(searchLower)) ||
          (order.phoneNumber?.toLowerCase().includes(searchLower)) ||
          (order.coffeeType?.toLowerCase().includes(searchLower)) ||
          (order.id?.toString().includes(searchLower))
        );
      }
      
      return true;
    });
  };

  const renderOrderCard = (order, status) => {
    const milkColorStyle = order.milkType && order.milkType !== 'No Milk' 
      ? getMilkColorStyle(order.milkType, order.milkTypeId)
      : { borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: '#D1D5DB' };

    const statusColors = {
      pending: 'border-amber-500',
      inProgress: 'border-blue-500', 
      completed: 'border-green-500',
      previous: 'border-gray-400'
    };

    const statusIcons = {
      pending: <Clock size={16} className="text-amber-600" />,
      inProgress: <Coffee size={16} className="text-blue-600" />,
      completed: <CheckCircle size={16} className="text-green-600" />,
      previous: <Package size={16} className="text-gray-600" />
    };

    return (
      <div 
        key={order.id} 
        className={`bg-white rounded-lg shadow-sm p-3 mb-2`}
        style={milkColorStyle}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {statusIcons[status]}
              <span className="font-bold whitespace-nowrap">Order #{order.id}</span>
              <span className="text-sm text-gray-500 whitespace-nowrap">Station {order.assignedStation || '?'}</span>
              {order.priority && (
                <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-medium">
                  PRIORITY
                </span>
              )}
            </div>
            <div className="mt-1">
              <div className="font-medium">{order.customerName}</div>
              <div className="text-sm text-gray-600 flex items-center gap-1">
                {order.milkType && order.milkType !== 'No Milk' && (
                  <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
                )}
                {order.coffeeType}, {order.milkType}, {order.sugar}
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            {status === 'pending' && (
              <div className="text-amber-600">Waiting {order.waitTime} min</div>
            )}
            {status === 'inProgress' && order.startedAt && (
              <div className="text-blue-600">
                Started {Math.round((Date.now() - parseServerDate(order.startedAt)) / 60000)} min ago
              </div>
            )}
            {status === 'completed' && order.completedAt && (
              <div className="text-green-600">
                Ready {Math.round((Date.now() - parseServerDate(order.completedAt)) / 60000)} min ago
              </div>
            )}
            {status === 'previous' && order.pickedUpAt && (
              <div className="text-gray-600">
                Picked up {new Date(order.pickedUpAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
      </div>
    );
  }

  const getFilteredOrders = () => {
    switch (filter) {
      case 'pending':
        return { orders: filterOrders(orders.pending), status: 'pending' };
      case 'inProgress':
        return { orders: filterOrders(orders.inProgress), status: 'inProgress' };
      case 'completed':
        return { orders: filterOrders(orders.completed), status: 'completed' };
      case 'all':
      default:
        return {
          orders: [
            ...filterOrders(orders.pending).map(o => ({ ...o, _status: 'pending' })),
            ...filterOrders(orders.inProgress).map(o => ({ ...o, _status: 'inProgress' })),
            ...filterOrders(orders.completed).map(o => ({ ...o, _status: 'completed' }))
          ],
          status: 'mixed'
        };
    }
  };

  const filteredData = getFilteredOrders();

  return (
    <div className="space-y-4">
      {/* Statistics Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-800">{stats.totalOrders}</div>
          <div className="text-sm text-gray-600">Total Orders</div>
        </div>
        <div className="bg-amber-50 rounded-lg shadow-sm p-4">
          <div className="text-2xl font-bold text-amber-600">{stats.pendingCount}</div>
          <div className="text-sm text-gray-600">Pending</div>
        </div>
        <div className="bg-blue-50 rounded-lg shadow-sm p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.inProgressCount}</div>
          <div className="text-sm text-gray-600">In Progress</div>
        </div>
        <div className="bg-green-50 rounded-lg shadow-sm p-4">
          <div className="text-2xl font-bold text-green-600">{stats.completedCount}</div>
          <div className="text-sm text-gray-600">Ready</div>
        </div>
        <div className="bg-gray-50 rounded-lg shadow-sm p-4">
          <div className="text-2xl font-bold text-gray-600">{stats.avgWaitTime} min</div>
          <div className="text-sm text-gray-600">Avg Wait</div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gray-500" />
            <select 
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border rounded px-3 py-1"
            >
              <option value="all">All Orders</option>
              <option value="pending">Pending Only</option>
              <option value="inProgress">In Progress Only</option>
              <option value="completed">Completed Only</option>
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <Users size={18} className="text-gray-500" />
            <select 
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              className="border rounded px-3 py-1"
            >
              <option value="all">All Stations</option>
              <option value="1">Station 1</option>
              <option value="2">Station 2</option>
              <option value="3">Station 3</option>
            </select>
          </div>
          
          <div className="flex-1 flex items-center gap-2">
            <Search size={18} className="text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, phone, or order #..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 border rounded px-3 py-1"
            />
          </div>
          
          <button
            onClick={loadAllOrders}
            className="bg-amber-600 text-white px-4 py-1 rounded hover:bg-amber-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h3 className="text-lg font-bold mb-3">
          {filter === 'all' ? 'All Active Orders' : `${filter.charAt(0).toUpperCase() + filter.slice(1)} Orders`}
          {stationFilter !== 'all' && ` - Station ${stationFilter}`}
        </h3>
        
        {filteredData.orders.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredData.status === 'mixed' 
              ? filteredData.orders.map(order => renderOrderCard(order, order._status))
              : filteredData.orders.map(order => renderOrderCard(order, filteredData.status))
            }
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <AlertCircle size={32} className="mx-auto mb-2 text-gray-400" />
            <p>No orders found matching your filters</p>
          </div>
        )}
      </div>

      {/* Station Activity Summary */}
      {stats.busiestStation && (
        <div className="bg-blue-50 rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-blue-600" />
            <span className="text-sm">
              Station {stats.busiestStation} is the busiest station right now
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllOrdersTab;