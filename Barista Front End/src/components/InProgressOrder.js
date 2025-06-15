// components/InProgressOrder.js
import React, { useState } from 'react';
import { useNotification } from './NotificationSystem';
import { MessageCircle, Printer, Clock, CheckCircle, Coffee, Info } from 'lucide-react';
import { getTimeRatioColor, getOrderBackgroundColor } from '../utils/orderUtils';
import { useSettings } from '../hooks/useSettings';
import { getMilkColorStyle, getMilkDotStyle } from '../utils/milkColorHelper';
import '../styles/milkColors.css';
import Tooltip from './Tooltip';

const InProgressOrder = ({ 
  order, 
  onComplete, 
  onSendMessage, 
  onPrintLabel, 
  getMessagesForOrder 
}) => {
  const { settings } = useSettings();
  const { success, error } = useNotification();
  
  // Debug milk type information
  console.log('InProgressOrder milk info:', { 
    milkType: order.milkType,
    milkTypeId: order.milkTypeId,
    alternativeMilk: order.alternativeMilk,
    dairyFree: order.dairyFree,
    classApplied: getOrderBackgroundColor(order, settings)
  });
  const [isCompleting, setIsCompleting] = useState(false);
  const [showCompletionSuccess, setShowCompletionSuccess] = useState(false);
  
  // Get messages for this order
  const orderMessages = getMessagesForOrder ? getMessagesForOrder(order.id) : [];
  const hasFailedMessages = orderMessages.some(msg => msg.status === 'failed');
  const messageCount = orderMessages.length;

  // Handle order completion
  const handleComplete = async () => {
    if (isCompleting) return;
    
    setIsCompleting(true);
    try {
      await onComplete(order.id);
      setShowCompletionSuccess(true);
      success(`Order #${order.id} completed successfully`);
      
      // Reset after 2 seconds to allow the animation to complete
      setTimeout(() => {
        setShowCompletionSuccess(false);
        setIsCompleting(false);
      }, 2000);
    } catch (err) {
      error(`Failed to complete order: ${err.message}`);
      setIsCompleting(false);
    }
  };

  // Handle sending message
  const handleSendMessage = () => {
    onSendMessage(order);
  };

  // Handle printing label
  const handlePrintLabel = () => {
    onPrintLabel(order);
    success(`Label printed for ${order.coffeeType}`);
  };

  // Debug what milk color is being used
  console.log('InProgressOrder rendering with milk: ', {
    id: order.milkTypeId,
    name: order.milkType,
    cssClass: order.milkTypeId ? `order-milk-${order.milkTypeId}` : 'no-milk-class'
  });

  // Get milk color style
  const milkColorStyle = order.milkType && order.milkType !== 'No Milk' 
    ? getMilkColorStyle(order.milkType, order.milkTypeId)
    : { borderLeftWidth: '8px', borderLeftStyle: 'solid', borderLeftColor: '#D1D5DB' };

  return (
    <div 
      className={`rounded-lg shadow-md p-4 mb-4 relative ${getOrderBackgroundColor(order, settings)}`}
      style={milkColorStyle}
    >
      {/* Completion overlay animation */}
      {showCompletionSuccess && (
        <div className="absolute inset-0 bg-green-50 rounded-lg flex items-center justify-center z-10 animate-fade-in">
          <div className="text-center">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-2" />
            <div className="text-xl font-bold text-green-700">Order Completed!</div>
          </div>
        </div>
      )}
      
      {/* Order header with customer info */}
      <div className="flex justify-between">
        <div>
          <div className="text-sm text-gray-500">Order #{order.id}</div>
          <div className="text-xl font-bold mt-1">{order.customerName}</div>
          <div className="text-gray-700">{order.phoneNumber}</div>
        </div>
        <div className="flex flex-col items-end space-y-1">
          {order.priority && (
            <div className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm font-medium">
              PRIORITY
            </div>
          )}
          {order.batchGroup && (
            <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded text-xs font-medium">
              BATCH: {order.batchGroup.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </div>
          )}
          <div className="flex items-center mt-2 text-gray-500">
            <Clock size={16} className="mr-1" />
            <span>{order.waitTime} min</span>
          </div>
          {messageCount > 0 && (
            <div className={`text-xs mt-1 rounded-full px-2 py-0.5 ${hasFailedMessages ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
              {messageCount} message{messageCount !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>
      
      {/* Order details */}
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
          <div className="mt-1">
            <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded">
              Alternative Milk
            </span>
          </div>
        )}
      </div>
      
      {/* Action buttons */}
      <div className="mt-4 flex space-x-2">
        <button 
          className="flex-1 bg-gray-200 py-2 rounded flex items-center justify-center space-x-1 hover:bg-gray-300 relative"
          onClick={handleSendMessage}
        >
          <MessageCircle size={18} />
          <span>Message Customer</span>
          {hasFailedMessages && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full"></span>
          )}
        </button>
        <button 
          className="flex-1 bg-gray-200 py-2 rounded flex items-center justify-center space-x-1 hover:bg-gray-300"
          onClick={handlePrintLabel}
        >
          <Printer size={18} />
          <span>Print Label</span>
        </button>
      </div>
      
      {/* Complete order button with tooltip */}
      <div className="relative mt-3">
        <Tooltip
          content={
            <div className="p-2 max-w-xs">
              <p className="font-bold mb-1">Complete Order</p>
              <p>This marks the order as ready for pickup and will:</p>
              <ul className="list-disc pl-4 mt-1 text-sm">
                <li>Notify the customer via SMS</li>
                <li>Move the order to the "Ready for Pickup" section</li>
                <li>Free up queue capacity</li>
              </ul>
            </div>
          }
          position="top"
        >
          <button 
            className={`group w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center space-x-2
                      ${isCompleting || showCompletionSuccess 
                        ? 'bg-gray-400 text-gray-100 cursor-not-allowed' 
                        : 'bg-green-500 text-white hover:bg-green-600'}`}
            onClick={handleComplete}
            disabled={isCompleting || showCompletionSuccess}
          >
            {isCompleting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>COMPLETING...</span>
              </>
            ) : (
              <>
                <CheckCircle size={20} />
                <span>COMPLETE ORDER</span>
                <Info size={16} className="text-green-300 group-hover:text-white ml-1" />
              </>
            )}
          </button>
        </Tooltip>
      </div>
      
      {/* Time pressure bar */}
      <div className="mt-3 flex items-center space-x-2">
        <div className="text-sm">Time pressure:</div>
        <div className="flex-grow bg-gray-200 h-2 rounded-full overflow-hidden">
          <div 
            className={`h-2 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}
            style={{ width: `${Math.min((order.waitTime / order.promisedTime) * 100, 100)}%` }}
          ></div>
        </div>
        <div className="text-sm">{Math.floor((order.waitTime / order.promisedTime) * 100)}%</div>
      </div>
    </div>
  );
};

export default InProgressOrder;
