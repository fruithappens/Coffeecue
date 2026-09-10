// components/AllOrdersTab.js
import React, { useState, useEffect } from 'react';
import { Coffee, Clock, CheckCircle, Package, Users, Search, Filter, AlertCircle } from 'lucide-react';
import { getMilkColorStyle, getMilkDotStyle } from '../../utils/milkColorHelper';
import { Segmented, TextField } from '../../design';
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
      // Newest first, and never on a single field. A missing timestamp makes
      // `new Date(undefined) - new Date(undefined)` NaN, and a comparator
      // that returns NaN does not sort -- it leaves the list in whatever
      // order it arrived in and says nothing. That is exactly what the
      // picked-up list did: this endpoint has never sent pickedUpAt, so the
      // sort was dead and the order was only ever the server's.
      const at = (order, ...fields) => {
        for (const f of fields) {
          const v = order && order[f];
          if (!v) continue;
          const t = new Date(v).getTime();
          if (!Number.isNaN(t)) return t;
        }
        return 0;
      };
      const newestFirst = (...fields) => (a, b) => at(b, ...fields) - at(a, ...fields);
      allOrders.pending.sort(newestFirst('createdAt', 'created_at'));
      allOrders.inProgress.sort(newestFirst('startedAt', 'started_at', 'createdAt', 'created_at'));
      allOrders.completed.sort(newestFirst('completedAt', 'completed_at', 'updatedAt', 'updated_at'));
      allOrders.previous.sort(newestFirst('pickedUpAt', 'picked_up_at', 'updatedAt', 'updated_at', 'completedAt', 'completed_at'));
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

  // Which stations actually have orders, in order.
  const stationOptions = React.useMemo(() => {
    const seen = new Set();
    [...orders.pending, ...orders.inProgress, ...orders.completed, ...orders.previous]
      .forEach((o) => {
        const sid = o.stationId ?? o.station_id ?? o.assignedStation ?? o.assigned_to_station;
        if (sid !== undefined && sid !== null && sid !== '') seen.add(String(sid));
      });
    return [...seen].sort((a, b) => Number(a) - Number(b));
  }, [orders]);

  const filterOrders = (ordersList) => {
    return ordersList.filter(order => {
      // Station filter. It compared `order.assignedStation` -- a field this
      // API does not send -- against a STRING from the dropdown, so
      // undefined !== "1" was true for every order and choosing a station
      // emptied the list completely. Read the aliases the payload actually
      // uses, and compare as strings.
      if (stationFilter !== 'all') {
        const of = [order.stationId, order.station_id, order.assignedStation, order.assigned_to_station]
          .filter((v) => v !== undefined && v !== null).map(String);
        if (!of.includes(String(stationFilter))) return false;
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
      // No milk: a neutral rail from the palette, not a stray Tailwind grey.
      : { borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: '#E6DCD0' };

    // Status colour is INFORMATION, so it survives -- it just moves onto the
    // palette's own semantics. Waiting is the middle state, being made is the
    // active one (the barista board already uses caramel for Brewing), ready
    // is ready, collected is done and quiet.
    const statusIcons = {
      pending: <Clock size={16} className="text-cq-warn" />,
      inProgress: <Coffee size={16} className="text-cq-caramel" />,
      completed: <CheckCircle size={16} className="text-cq-ready" />,
      previous: <Package size={16} className="text-cq-ink-3" />
    };

    return (
      <div 
        key={order.id} 
        className="bg-cq-milk rounded-cq-lg shadow-cq-card p-3.5 mb-2"
        style={milkColorStyle}
      >
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {statusIcons[status]}
              <span className="font-extrabold text-cq-roast whitespace-nowrap tabular-nums">#{order.id}</span>
              <span className="text-sm text-cq-ink-3 whitespace-nowrap">Station {order.assignedStation || '?'}</span>
              {order.priority && (
                <span className="bg-cq-alert-wash text-cq-alert px-2 py-0.5 rounded-full text-xs font-bold">
                  Priority
                </span>
              )}
            </div>
            <div className="mt-1">
              <div className="font-bold text-cq-ink">{order.customerName}</div>
              <div className="text-sm text-cq-ink-2 flex items-center gap-1">
                {order.milkType && order.milkType !== 'No Milk' && (
                  <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
                )}
                {order.coffeeType}, {order.milkType}, {order.sugar}
              </div>
            </div>
          </div>
          <div className="text-right text-sm">
            {status === 'pending' && (
              <div className="text-cq-warn font-semibold">Waiting {order.waitTime} min</div>
            )}
            {status === 'inProgress' && order.startedAt && (
              <div className="text-cq-caramel font-semibold">
                Started {Math.round((Date.now() - parseServerDate(order.startedAt)) / 60000)} min ago
              </div>
            )}
            {status === 'completed' && order.completedAt && (
              <div className="text-cq-ready font-semibold">
                Ready {Math.round((Date.now() - parseServerDate(order.completedAt)) / 60000)} min ago
              </div>
            )}
            {status === 'previous' && order.pickedUpAt && (
              <div className="text-cq-ink-3">
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cq-caramel"></div>
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
        {[
          { n: stats.totalOrders, label: 'Orders', tone: 'text-cq-roast' },
          { n: stats.pendingCount, label: 'Waiting', tone: 'text-cq-warn' },
          { n: stats.inProgressCount, label: 'Being made', tone: 'text-cq-caramel' },
          { n: stats.completedCount, label: 'Ready', tone: 'text-cq-ready' },
          { n: `${stats.avgWaitTime} min`, label: 'Average wait', tone: 'text-cq-roast' },
        ].map((t) => (
          <div key={t.label} className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
            <div className={`text-3xl font-extrabold tabular-nums ${t.tone}`}>{t.n}</div>
            <div className="text-xs font-bold uppercase tracking-wide text-cq-ink-3 mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      {/* Filters and Search */}
      <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-cq-ink-3" />
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pending', label: 'Waiting' },
                { value: 'inProgress', label: 'Being made' },
                { value: 'completed', label: 'Ready' },
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <Users size={18} className="text-cq-ink-3" />
            <select 
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              className="h-9 rounded-cq-md border-2 border-cq-line bg-cq-milk px-3 font-semibold text-cq-roast focus:border-cq-caramel focus:outline-none"
            >
              <option value="all">All stations</option>
              {/* The real stations, from the orders on screen. This was
                  hardcoded 1/2/3: a station 3 that filtered to nothing,
                  and no way to pick a fourth. */}
              {stationOptions.map((sid) => (
                <option key={sid} value={sid}>Station {sid}</option>
              ))}
            </select>
          </div>
          
          <div className="flex-1 flex items-center gap-2">
            <Search size={18} className="text-cq-ink-3" />
            <TextField
              width="flex-1 min-w-[12rem]"
              placeholder="Name, phone or order number"
              value={searchTerm}
              onChange={setSearchTerm}
            />
          </div>
          
          <button
            onClick={loadAllOrders}
            className="h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-semibold hover:bg-cq-caramel-deep"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Orders List */}
      <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
        <h3 className="text-lg font-bold text-cq-roast mb-3">
          {({ all: 'Everything on now', pending: 'Waiting',
              inProgress: 'Being made', completed: 'Ready' }[filter]) || 'Orders'}
          {stationFilter !== 'all' && ` · Station ${stationFilter}`}
        </h3>
        
        {/* max-h is viewport-relative: it was a fixed max-h-96, so four cards
            showed whether the screen was a laptop or a 27-inch monitor and
            everything else hid behind an inner scrollbar. */}
        {filteredData.orders.length > 0 ? (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {filteredData.status === 'mixed' 
              ? filteredData.orders.map(order => renderOrderCard(order, order._status))
              : filteredData.orders.map(order => renderOrderCard(order, filteredData.status))
            }
          </div>
        ) : (
          <div className="text-center py-10 text-cq-ink-3">
            <AlertCircle size={30} className="mx-auto mb-2 text-cq-ink-3" />
            <p>Nothing matches those filters.</p>
          </div>
        )}
      </div>

      {/* Station Activity Summary */}
      {stats.busiestStation && (
        <div className="bg-cq-caramel-wash rounded-cq-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-cq-caramel-deep flex-shrink-0" />
            <span className="text-sm text-cq-ink-2">
              Station {stats.busiestStation} is busiest right now.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AllOrdersTab;