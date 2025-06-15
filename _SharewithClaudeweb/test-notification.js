// test-notification.js
// This script provides test data and functions for testing the notification system

// Sample order with complete data for testing
const SAMPLE_ORDER = {
  id: 'test_123',
  orderNumber: 'test_123',
  customerName: 'Test Customer',
  phoneNumber: '+61412345678', // Replace with a real phone number for actual testing
  coffeeType: 'Cappuccino',
  milkType: 'Regular milk',
  sugar: '1 sugar',
  stationName: 'Test Station',
  stationId: 1,
  status: 'completed',
  completedAt: new Date(),
  waitTime: 0,
  promisedTime: 15
};

// Function to simulate an order completion notification
async function testOrderCompleteNotification() {
  console.log('Testing order completion notification with sample order:', SAMPLE_ORDER);
  
  try {
    // Import required services
    const orderService = window.OrderDataService || (await import('/src/services/OrderDataService.js')).default;
    const messageService = window.MessageService || (await import('/src/services/MessageService.js')).default;
    
    // First test with OrderDataService
    console.log('Testing OrderDataService.sendReadyNotification...');
    try {
      const result = await orderService.sendReadyNotification(SAMPLE_ORDER);
      console.log('OrderDataService notification result:', result);
    } catch (error) {
      console.error('OrderDataService notification failed:', error);
    }
    
    // Then test with MessageService
    console.log('Testing MessageService.sendReadyNotification...');
    try {
      const result = await messageService.sendReadyNotification(SAMPLE_ORDER);
      console.log('MessageService notification result:', result);
    } catch (error) {
      console.error('MessageService notification failed:', error);
    }
    
    // Finally, test the combined approach used in BaristaInterface.handleCompleteOrder
    console.log('Testing combined notification approach...');
    try {
      // This simulates what happens in BaristaInterface.handleCompleteOrder
      let notificationSuccess = false;
      let notificationError = null;
      
      // Attempt 1: Use notificationHandler (simulated here)
      try {
        console.log('Attempt 1: Simulating notificationHandler.completeWithNotification...');
        throw new Error('Simulated error for notificationHandler');
      } catch (error1) {
        console.error('Primary notification failed:', error1);
        notificationError = error1;
        
        // Attempt 2: Use multi-layered fallback
        try {
          // First try MessageService
          console.log('Attempt 2: Using MessageService...');
          const smsResult = await messageService.sendReadyNotification(SAMPLE_ORDER);
          console.log('MessageService notification result:', smsResult);
          
          if (smsResult && smsResult.success) {
            console.log('MessageService notification sent successfully');
            notificationSuccess = true;
          } else {
            // If MessageService fails, try OrderDataService
            console.log('MessageService failed, falling back to OrderDataService');
            const orderServiceResult = await orderService.sendReadyNotification(SAMPLE_ORDER);
            console.log('OrderDataService notification result:', orderServiceResult);
            
            if (orderServiceResult && orderServiceResult.success) {
              console.log('OrderDataService notification sent successfully');
              notificationSuccess = true;
            } else {
              throw new Error(orderServiceResult?.error || smsResult?.error || 'All notification attempts failed');
            }
          }
        } catch (error2) {
          console.error('Secondary notification failed:', error2);
          
          // Attempt 3: Try direct OrderDataService.sendMessageToCustomer
          try {
            console.log('Attempt 3: Using OrderDataService.sendMessageToCustomer...');
            const directResult = await orderService.sendMessageToCustomer(
              SAMPLE_ORDER.id,
              `🔔 YOUR COFFEE IS READY! Your ${SAMPLE_ORDER.coffeeType || 'coffee'} is now ready for collection. Enjoy! ☕`
            );
            
            console.log('Direct SMS result:', directResult);
            
            if (directResult && (directResult.success === true || !Object.prototype.hasOwnProperty.call(directResult, 'success'))) {
              console.log('Last resort notification sent successfully');
              notificationSuccess = true;
            } else {
              throw new Error(directResult?.error || 'Final notification attempt failed without details');
            }
          } catch (error3) {
            console.error('All notification attempts failed:', error3);
            notificationError = error3;
          }
        }
      }
      
      // Final result
      if (notificationSuccess) {
        console.log('✅ Notification test completed successfully!');
      } else {
        console.error('❌ All notification attempts failed:', notificationError);
      }
    } catch (error) {
      console.error('Combined notification test failed:', error);
    }
  } catch (error) {
    console.error('Failed to load required services:', error);
  }
}

// Function to test with a customer phone number
function testWithPhoneNumber(phoneNumber) {
  const testOrder = {
    ...SAMPLE_ORDER,
    phoneNumber: phoneNumber
  };
  
  console.log(`Testing notification with custom phone number: ${phoneNumber}`);
  
  // Create a modified version of testOrderCompleteNotification that uses the custom order
  // This approach keeps the original function intact
  const originalSampleOrder = SAMPLE_ORDER;
  SAMPLE_ORDER = testOrder;
  testOrderCompleteNotification().finally(() => {
    // Restore original sample order
    SAMPLE_ORDER = originalSampleOrder;
  });
}

// Export functions for use in the browser console
window.testOrderCompleteNotification = testOrderCompleteNotification;
window.testWithPhoneNumber = testWithPhoneNumber;

console.log('Notification test utilities loaded!');
console.log('To test notification system, run:');
console.log('1. testOrderCompleteNotification() - Test with sample data');
console.log('2. testWithPhoneNumber("+61412345678") - Test with a specific phone number');