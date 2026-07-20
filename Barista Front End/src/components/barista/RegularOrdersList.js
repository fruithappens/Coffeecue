// components/RegularOrdersList.js
import React from 'react';
import { Edit, ArrowRightLeft } from 'lucide-react';
import { getTimeRatioColor, getOrderBackgroundColor } from '../../utils/orderUtils';
import { useSettings } from '../../hooks/useSettings';
import { getMilkColorStyle, getMilkDotStyle } from '../../utils/milkColorHelper';
import GroupBadge from './GroupBadge';
import '../../styles/milkColors.css';

const RegularOrdersList = ({ orders, onStartOrder, onSendMessage, onDelayOrder, onEditOrder, onMoveOrder, batchHintsByOrderId = {}, groupInfoByOrderId = {}, onStartGroup }) => {
  const { settings } = useSettings();
  
  // Debug first order's milk info
  if (orders && orders.length > 0) {
    console.log('RegularOrdersList first order milk info:', {
      milkType: orders[0].milkType, 
      milkTypeId: orders[0].milkTypeId,
      alternativeMilk: orders[0].alternativeMilk,
      dairyFree: orders[0].dairyFree,
      classApplied: getOrderBackgroundColor(orders[0], settings)
    });
  }
  if (!orders || orders.length === 0) {
    return null;
  }

  return (
    <div>
      {orders.map(order => {
        const hints = batchHintsByOrderId[order.id] || [];
        // When a batch hint exists, override the milk colour bar with
        // a more eye-catching amber stripe + thicker border. The
        // operator's request was 'a coloured side bar or Batch tag
        // so I can use a larger frothing jug and do a few at a
        // time' — this is the side bar.
        const milkColorStyle = hints.length > 0
          ? { borderLeftWidth: '6px', borderLeftStyle: 'solid', borderLeftColor: '#f59e0b' }  // amber-500
          : order.milkType && order.milkType !== 'No Milk'
            ? getMilkColorStyle(order.milkType, order.milkTypeId)
            : { borderLeftWidth: '4px', borderLeftStyle: 'solid', borderLeftColor: '#3B82F6' };

        return (
        <div
          key={order.id}
          className={`mb-2 rounded-lg overflow-hidden shadow-sm ${getOrderBackgroundColor(order, settings)}`}
          style={milkColorStyle}
        >
          <div className="p-3">
            <div className="flex justify-between items-center">
              <div className="font-bold text-gray-800">#{order.orderNumber} - {order.customerName}</div>
              <div className="flex items-center space-x-1">
                {/* Group badge — this coffee was ordered together with
                    others (multi-drink SMS or FRIEND order); serve as one. */}
                <GroupBadge info={groupInfoByOrderId[order.id]} />
                {/* Batch hint badges — small amber tags telling the
                    barista this order can be made alongside N
                    others of the same kind. */}
                {hints.map((h) => (
                  <span
                    key={h.key}
                    className="inline-block bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap"
                    title={
                      h.kind === 'milk'
                        ? `Steam one jug — ${h.label.replace(/^Batch /,'')} pending`
                        : `Make one base — ${h.label.replace(/^Batch /,'')} pending`
                    }
                  >
                    {h.label}
                  </span>
                ))}
                <span className="text-sm text-gray-600">{order.waitTime} min</span>
                <div className={`w-2 h-2 rounded-full ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}></div>
              </div>
            </div>

            <div className="mt-2 p-2 bg-gray-50 rounded">
              <div className="font-medium text-gray-700 flex items-center">
                {order.milkType && order.milkType !== 'No Milk' && (
                  <span style={getMilkDotStyle(order.milkType, order.milkTypeId)}></span>
                )}
                {order.size ? `${order.size} ` : ''}{order.coffeeType}, {order.milkType}, {order.sugar}
              </div>
              {order.alternativeMilk && (
                <div className="mt-1">
                  <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-sm">
                    Alternative Milk
                  </span>
                </div>
              )}
            </div>
            
            {/* Start the whole group at once so they get made — and
                collected — together. Individual Start still available below. */}
            {groupInfoByOrderId[order.id] && onStartGroup && (
              <button
                className="w-full mt-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm font-medium"
                onClick={() => onStartGroup(order)}
              >
                Start group ({groupInfoByOrderId[order.id].size})
              </button>
            )}

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
              {/* Move icon — opens the dialog to reassign this order
                  to another active station. Use case: milk just ran
                  out at this station, push the queue elsewhere. */}
              {onMoveOrder && (
                <button
                  className="p-1 text-gray-500 hover:text-amber-600"
                  onClick={() => onMoveOrder(order)}
                  title="Move to another station"
                >
                  <ArrowRightLeft size={16} />
                </button>
              )}
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
        </div>
        );
      })}
    </div>
  );
};

export default RegularOrdersList;