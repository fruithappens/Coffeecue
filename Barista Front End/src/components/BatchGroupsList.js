// components/BatchGroupsList.js
import React from 'react';
import { Edit, Clock } from 'lucide-react';
import { getOrderBackgroundColor, getTimeRatioColor } from '../utils/orderUtils';
import { useSettings } from '../hooks/useSettings';
import '../styles/milkColors.css';

const BatchGroupsList = ({ batchGroups, onStartOrder, onProcessBatch, onSendMessage, onDelayOrder, onEditOrder }) => {
  const { settings } = useSettings();
  // Format batch group name for display
  const formatBatchName = (batchName) => {
    return batchName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="mb-4">
      <div className="text-xs uppercase text-amber-800 font-semibold mb-1 px-1">
        Batch Groups
      </div>
      
      {Object.entries(batchGroups).map(([batchName, orders]) => (
        <div key={batchName} className="mb-3 bg-amber-50 rounded-lg overflow-hidden">
          <div className="bg-amber-100 px-3 py-2 text-sm text-amber-800 font-medium flex justify-between items-center border-b border-amber-200">
            <span>Batch: {formatBatchName(batchName)} ({orders.length})</span>
            <button 
              className="text-white bg-amber-600 text-xs px-3 py-1 rounded-md hover:bg-amber-700"
              onClick={() => onProcessBatch(batchName)}
            >
              Process Batch
            </button>
          </div>
          
          {orders.map((order, index) => (
            <div 
              key={order.id} 
              className={`p-3 border-b ${index === orders.length - 1 ? '' : 'border-amber-100'} ${getOrderBackgroundColor(order, settings)}`}
            >
              <div className="flex justify-between items-center">
                <div className="font-bold text-gray-800">#{order.orderNumber} - {order.customerName}</div>
                <div className="flex items-center space-x-1">
                  <span className="text-sm text-gray-600">{order.waitTime} min</span>
                  <div className={`w-2 h-2 rounded-full ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}></div>
                </div>
              </div>
              
              <div className="mt-2 p-2 bg-gray-50 rounded">
                <div className="font-medium text-gray-700 flex items-center">
                  {order.milkTypeId && (
                    <div className={`milk-indicator-dot ${order.milkTypeId}`}></div>
                  )}
                  {order.coffeeType}, {order.milkType}, {order.sugar}
                </div>
                {order.alternativeMilk && (
                  <div className="mt-1">
                    <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-sm">
                      Alternative Milk
                    </span>
                  </div>
                )}
              </div>
              
              <div className="mt-2 flex justify-between space-x-2">
                <button 
                  className="flex-1 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm"
                  onClick={() => onStartOrder(order)}
                >
                  Start
                </button>
                <button 
                  className="flex-1 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                  onClick={() => onDelayOrder && onDelayOrder(order)}
                >
                  Delay
                </button>
                <button 
                  className="flex-1 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                  onClick={() => onSendMessage && onSendMessage(order)}
                >
                  Message
                </button>
                <button 
                  className="p-1 text-gray-500 hover:text-gray-700"
                  onClick={() => onEditOrder && onEditOrder(order)}
                  title="Edit order"
                >
                  <Edit size={16} />
                </button>
              </div>
              
              <div className="mt-2 bg-gray-200 h-1 w-full rounded-full overflow-hidden">
                <div 
                  className={`h-1 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`} 
                  style={{ width: `${Math.min((order.waitTime / order.promisedTime) * 100, 100)}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default BatchGroupsList;