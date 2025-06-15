// components/PendingOrdersSection.js
import React from 'react';
import { ChevronDown, Edit } from 'lucide-react';
import { getOrderBackgroundColor, getTimeRatioColor } from '../utils/orderUtils';
import { useSettings } from '../hooks/useSettings';
import { getMilkColorStyle, getMilkDotStyle } from '../utils/milkColorHelper';
import '../styles/milkColors.css';
import VipOrdersList from './VipOrdersList';
import BatchGroupsList from './BatchGroupsList';
import RegularOrdersList from './RegularOrdersList';

const PendingOrdersSection = ({ 
  orders, 
  filter, 
  onFilterChange, 
  onStartOrder, 
  onProcessBatch,
  onSendMessage,
  onDelayOrder,
  onEditOrder
}) => {
  const { settings } = useSettings();
  // Organize orders into categories - support both vip and priority property names
  const vipOrders = orders.filter(order => order.vip || order.priority);
  
  // Group batch orders by their batch group
  const batchGroups = orders.reduce((groups, order) => {
    if (order.batchGroup) {
      if (!groups[order.batchGroup]) {
        groups[order.batchGroup] = [];
      }
      groups[order.batchGroup].push(order);
    }
    return groups;
  }, {});
  
  const regularOrders = orders.filter(
    order => !(order.vip || order.priority) && !order.batchGroup
  );

  // Apply selected filter
  const getFilteredOrders = () => {
    switch (filter) {
      case 'vip':
        return orders.filter(order => order.vip || order.priority);
      case 'batch':
        return orders.filter(order => order.batchGroup);
      case 'urgent':
        return orders.filter(order => {
          const ratio = order.waitTime / order.promisedTime;
          return ratio > 0.8;
        });
      default:
        return orders;
    }
  };

  return (
    <div className="w-1/2 flex flex-col h-full">
      <div className="bg-amber-600 text-white p-2 rounded-t-lg flex justify-between items-center">
        <h2 className="text-xl font-bold">Upcoming Orders ({orders.length})</h2>
        <div className="flex space-x-1">
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'all' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('all')}
          >
            All
          </button>
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'vip' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('vip')}
          >
            VIP
          </button>
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'batch' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('batch')}
          >
            Batch
          </button>
          <button 
            className="px-2 py-1 rounded-md text-xs bg-amber-500 hover:bg-amber-700"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-b-lg shadow-md p-2 flex-grow overflow-y-auto">
        {filter === 'all' ? (
          <>
            {/* VIP Orders Section */}
            {vipOrders.length > 0 && (
              <VipOrdersList 
                orders={vipOrders} 
                onStartOrder={onStartOrder}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
              />
            )}

            {/* Batch Groups Section */}
            {Object.keys(batchGroups).length > 0 && (
              <BatchGroupsList 
                batchGroups={batchGroups} 
                onStartOrder={onStartOrder}
                onProcessBatch={onProcessBatch}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
              />
            )}

            {/* Regular Orders Section */}
            {regularOrders.length > 0 && (
              <RegularOrdersList 
                orders={regularOrders} 
                onStartOrder={onStartOrder}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
              />
            )}
          </>
        ) : (
          // Filtered view
          <div>
            {getFilteredOrders().map(order => (
              <div 
                key={order.id} 
                className={`mb-2 p-3 rounded-lg border-l-4 ${
                  (order.vip || order.priority) ? 'border-red-500' : 
                  order.batchGroup ? 'border-yellow-500' : 'border-blue-500'
                } shadow-sm hover:shadow transition-all ${getOrderBackgroundColor(order, settings)}`}
              >
                <div className="flex justify-between items-center">
                  <div className="font-bold">#{order.orderNumber} - {order.customerName}</div>
                  <div className="text-sm flex items-center space-x-1">
                    <span>{order.waitTime} min</span>
                    <div className={`w-3 h-3 rounded-full ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}></div>
                  </div>
                </div>
                
                <div className="mt-2 p-2 bg-gray-100 rounded">
                  <div className="font-medium">{order.coffeeType}, {order.milkType}, {order.sugar}</div>
                  {order.alternativeMilk && (
                    <div className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded mt-2">
                      Alternative Milk
                    </div>
                  )}
                </div>
                
                <div className="mt-2 flex justify-between">
                  <button 
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm"
                    onClick={() => onStartOrder(order)}
                  >
                    Start
                  </button>
                  <button 
                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                    onClick={() => onDelayOrder && onDelayOrder(order)}
                  >
                    Delay
                  </button>
                  <button 
                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                    onClick={() => onSendMessage && onSendMessage(order)}
                  >
                    Message
                  </button>
                  <button className="p-1 text-gray-500 hover:text-gray-700">
                    <Edit size={16} />
                  </button>
                </div>
                
                <div className="mt-2 bg-gray-200 h-1 w-full rounded-full overflow-hidden">
                  <div 
                    className={`h-1 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`} 
                    style={{ width: `${(order.waitTime / order.promisedTime) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingOrdersSection;