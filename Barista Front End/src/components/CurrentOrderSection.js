// components/CurrentOrderSection.js
import React from 'react';
import { Coffee, MessageSquare, Printer, Edit } from 'lucide-react';
import { getOrderBackgroundColor, getTimeRatioColor, formatTimeSince } from '../utils/orderUtils';
import { getMilkColorStyle, getMilkDotStyle } from '../utils/milkColorHelper';
import '../styles/milkColors.css';

const CurrentOrderSection = ({ orders, onCompleteOrder, onEditOrder }) => {
  return (
    <div className="w-1/2 flex flex-col h-full">
      <div className="bg-green-500 text-white p-2 rounded-t-lg">
        <h2 className="text-xl font-bold">Current Order</h2>
      </div>
      
      <div className="bg-white p-4 rounded-b-lg shadow-md flex-grow overflow-y-auto">
        {orders.length > 0 ? (
          orders.map(order => {
            const milkColorStyle = order.milkType && order.milkType !== 'No Milk' 
              ? getMilkColorStyle(order.milkType, order.milkTypeId)
              : { borderLeftWidth: '8px', borderLeftStyle: 'solid', borderLeftColor: '#D1D5DB' };
            
            return (
            <div 
              key={order.id} 
              className={`rounded-lg shadow-md p-4 mb-4 ${getOrderBackgroundColor(order)}`}
              style={milkColorStyle}
            >
              <div className="flex justify-between">
                <div>
                  <div className="text-sm text-gray-500">
                    Order #{order.orderNumber} - {order.startedAt ? formatTimeSince(order.startedAt) : 'Just now'}
                  </div>
                  <div className="text-xl font-bold mt-1">{order.customerName}</div>
                  <div className="text-gray-700">Phone: xxx-xxx-{order.phoneLastDigits}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {order.vip && (
                    <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm font-medium">
                      PRIORITY
                    </div>
                  )}
                  <button 
                    className="text-gray-600 hover:text-gray-900"
                    onClick={() => onEditOrder && onEditOrder(order)}
                    title="Edit order"
                  >
                    <Edit size={16} />
                  </button>
                </div>
              </div>
              
              <div className="mt-4 bg-gray-100 p-3 rounded-lg">
                <div className="text-xl font-bold flex items-center">
                  <Coffee size={20} className="mr-2" />
                  {order.coffeeType}
                </div>
                <div className="text-gray-700 flex items-center">
                  {order.milkType && order.milkType !== 'No Milk' && (
                    <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
                  )}
                  {order.milkType}, {order.sugar}
                </div>
                {order.extraHot && <div className="text-gray-700">Extra hot</div>}
                
                {order.alternativeMilk && (
                  <div className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded mt-2 mr-2">
                    Alternative Milk
                  </div>
                )}
                
                {order.allergyWarning && (
                  <div className="inline-block bg-purple-100 text-purple-700 text-xs px-2 py-1 rounded mt-2">
                    Allergy Warning
                  </div>
                )}
              </div>
              
              <div className="mt-4 flex space-x-2">
                <button className="flex-1 bg-gray-200 hover:bg-gray-300 py-2 rounded flex items-center justify-center space-x-1">
                  <MessageSquare size={18} />
                  <span>Message Customer</span>
                </button>
                <button className="flex-1 bg-gray-200 hover:bg-gray-300 py-2 rounded flex items-center justify-center space-x-1">
                  <Printer size={18} />
                  <span>Print Label</span>
                </button>
              </div>
              
              <button 
                className="mt-3 w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg font-bold text-lg"
                onClick={() => onCompleteOrder(order.id)}
              >
                COMPLETE ORDER
              </button>
              
              {/* Time pressure indicator */}
              <div className="mt-3 flex items-center space-x-2">
                <div className="text-sm">Time pressure:</div>
                <div className="flex-grow bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-2 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`} 
                    style={{ 
                      width: `${order.waitTime && order.promisedTime && order.promisedTime > 0 
                        ? Math.min((order.waitTime / order.promisedTime) * 100, 100) 
                        : 0}%` 
                    }}
                  ></div>
                </div>
                <div className="text-sm">
                  {order.waitTime && order.promisedTime && order.promisedTime > 0 
                    ? Math.floor(Math.min((order.waitTime / order.promisedTime) * 100, 100))
                    : 0}%
                </div>
              </div>
            </div>
            );
          })
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Coffee size={48} className="mx-auto mb-3 text-gray-400" />
            <p>No orders in progress</p>
            <p className="text-sm text-gray-400 mt-1">Start an order from the upcoming list</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CurrentOrderSection;