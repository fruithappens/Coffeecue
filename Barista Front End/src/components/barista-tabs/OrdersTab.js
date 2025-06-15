// OrdersTab.js
import React from 'react';
import { Coffee } from 'lucide-react';
import PendingOrdersSection from '../PendingOrdersSection';

const OrdersTab = ({ 
  inProgressOrders,
  pendingOrders,
  filter,
  setFilter,
  startOrder,
  processBatch,
  handleOpenMessageDialog,
  handleDelayOrder,
  renderInProgressOrder
}) => {
  return (
    <div className="flex space-x-4">
      {/* Current Order (In Progress) */}
      <div className="w-1/2">
        <div className="bg-amber-700 text-white p-2 rounded-t-lg">
          <h2 className="text-xl font-bold">Current Order</h2>
        </div>
        <div className="bg-white p-4 rounded-b-lg shadow-md">
          {inProgressOrders.length > 0 ? (
            inProgressOrders.map(order => renderInProgressOrder(order))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Coffee size={48} className="mx-auto mb-2 text-gray-400" />
              <p>No orders in progress</p>
              <p className="text-sm text-gray-400">Start an order from the queue</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Pending Orders Section */}
      <PendingOrdersSection 
        orders={pendingOrders}
        filter={filter}
        onFilterChange={setFilter}
        onStartOrder={startOrder}
        onProcessBatch={processBatch}
        onSendMessage={handleOpenMessageDialog}
        onDelayOrder={handleDelayOrder}
      />
    </div>
  );
};

export default OrdersTab;