import React, { useState } from 'react';
import { Coffee, Clock, User, AlertTriangle } from 'lucide-react';

/**
 * Basic Barista Interface - Fallback for when main interface fails
 * Provides essential functionality to keep coffee service running
 */
const BasicBaristaInterface = ({ error, onRetry }) => {
  const [orders, setOrders] = useState([]);
  const [newOrder, setNewOrder] = useState({ customer: '', coffee: '', notes: '' });

  const addOrder = () => {
    if (newOrder.customer && newOrder.coffee) {
      const order = {
        id: Date.now(),
        customer: newOrder.customer,
        coffee: newOrder.coffee,
        notes: newOrder.notes,
        status: 'pending',
        timestamp: new Date().toLocaleTimeString()
      };
      setOrders([...orders, order]);
      setNewOrder({ customer: '', coffee: '', notes: '' });
    }
  };

  const completeOrder = (orderId) => {
    setOrders(orders.filter(order => order.id !== orderId));
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center mb-4">
        <AlertTriangle className="text-amber-500 mr-2" size={24} />
        <h2 className="text-xl font-bold text-gray-800">Emergency Barista Mode</h2>
        <button
          onClick={onRetry}
          className="ml-auto bg-blue-500 text-white px-3 py-1 rounded text-sm hover:bg-blue-600"
        >
          Try Full Interface
        </button>
      </div>
      
      <div className="bg-amber-50 border border-amber-200 rounded p-3 mb-6">
        <p className="text-amber-800 text-sm">
          The main barista interface is temporarily unavailable. 
          Use this basic interface to continue taking orders manually.
        </p>
      </div>

      {/* Simple Order Form */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-3 flex items-center">
            <User size={18} className="mr-2" />
            New Order
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Customer Name"
              value={newOrder.customer}
              onChange={(e) => setNewOrder({...newOrder, customer: e.target.value})}
              className="w-full p-2 border rounded"
            />
            <select
              value={newOrder.coffee}
              onChange={(e) => setNewOrder({...newOrder, coffee: e.target.value})}
              className="w-full p-2 border rounded"
            >
              <option value="">Select Coffee Type</option>
              <option value="Espresso">Espresso</option>
              <option value="Americano">Americano</option>
              <option value="Latte">Latte</option>
              <option value="Cappuccino">Cappuccino</option>
              <option value="Flat White">Flat White</option>
              <option value="Mocha">Mocha</option>
            </select>
            <input
              type="text"
              placeholder="Special requests (optional)"
              value={newOrder.notes}
              onChange={(e) => setNewOrder({...newOrder, notes: e.target.value})}
              className="w-full p-2 border rounded"
            />
            <button
              onClick={addOrder}
              className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700"
            >
              Add to Queue
            </button>
          </div>
        </div>

        {/* Order Queue */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold mb-3 flex items-center">
            <Clock size={18} className="mr-2" />
            Order Queue ({orders.length})
          </h3>
          {orders.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No pending orders</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {orders.map(order => (
                <div key={order.id} className="bg-white p-3 rounded border">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h4 className="font-medium">{order.customer}</h4>
                      <p className="text-sm text-gray-600">{order.coffee}</p>
                      {order.notes && (
                        <p className="text-xs text-gray-500 mt-1">{order.notes}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">{order.timestamp}</p>
                    </div>
                    <button
                      onClick={() => completeOrder(order.id)}
                      className="bg-blue-500 text-white px-2 py-1 rounded text-xs hover:bg-blue-600"
                    >
                      Complete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded p-4">
        <h4 className="font-medium text-blue-800 mb-2">Emergency Mode Instructions:</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Use this interface to manually track orders</li>
          <li>• Check with support staff for system status updates</li>
          <li>• Consider backup procedures for payment processing</li>
          <li>• Click "Try Full Interface" periodically to check if system is restored</li>
        </ul>
      </div>
    </div>
  );
};

export default BasicBaristaInterface;