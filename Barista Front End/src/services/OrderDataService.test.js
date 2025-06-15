import OrderDataService from './OrderDataService';
import axios from 'axios';

// Mock axios
jest.mock('axios');

// Mock localStorage
const localStorageMock = (function() {
  let store = {};
  return {
    getItem: jest.fn(key => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    removeItem: jest.fn(key => {
      delete store[key];
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('OrderDataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('getPendingOrders', () => {
    it('returns pending orders from API when connection is successful', async () => {
      const mockOrders = { 
        orders: [
          { order_number: 'A123', status: 'pending' },
          { order_number: 'A124', status: 'pending' }
        ] 
      };
      
      axios.get.mockResolvedValueOnce({ 
        data: mockOrders,
        status: 200 
      });

      const result = await OrderDataService.getPendingOrders();
      
      expect(axios.get).toHaveBeenCalledWith('/api/orders/pending', expect.any(Object));
      expect(result).toEqual(mockOrders);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'pendingOrders',
        JSON.stringify(mockOrders)
      );
    });

    it('falls back to localStorage when API connection fails', async () => {
      const mockOrders = { 
        orders: [
          { order_number: 'A123', status: 'pending' },
          { order_number: 'A124', status: 'pending' }
        ] 
      };
      
      // Setup localStorage with fallback data
      localStorage.setItem('pendingOrders', JSON.stringify(mockOrders));
      
      // Mock API failure
      axios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await OrderDataService.getPendingOrders();
      
      expect(axios.get).toHaveBeenCalledWith('/api/orders/pending', expect.any(Object));
      expect(result).toEqual(mockOrders);
      expect(localStorage.getItem).toHaveBeenCalledWith('pendingOrders');
    });

    it('returns empty array when both API and localStorage fail', async () => {
      // Mock API failure
      axios.get.mockRejectedValueOnce(new Error('Network error'));
      
      // Ensure localStorage returns null for this key
      localStorage.getItem.mockReturnValueOnce(null);

      const result = await OrderDataService.getPendingOrders();
      
      expect(axios.get).toHaveBeenCalledWith('/api/orders/pending', expect.any(Object));
      expect(localStorage.getItem).toHaveBeenCalledWith('pendingOrders');
      expect(result).toEqual({ orders: [] });
    });
  });

  describe('getInProgressOrders', () => {
    it('returns in-progress orders from API when connection is successful', async () => {
      const mockOrders = { 
        orders: [
          { order_number: 'A123', status: 'in_progress' },
          { order_number: 'A124', status: 'in_progress' }
        ] 
      };
      
      axios.get.mockResolvedValueOnce({ 
        data: mockOrders,
        status: 200 
      });

      const result = await OrderDataService.getInProgressOrders();
      
      expect(axios.get).toHaveBeenCalledWith('/api/orders/in-progress', expect.any(Object));
      expect(result).toEqual(mockOrders);
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'inProgressOrders',
        JSON.stringify(mockOrders)
      );
    });
  });

  describe('startOrder', () => {
    it('starts an order successfully via API', async () => {
      const orderNumber = 'A123';
      const mockResponse = { 
        success: true, 
        message: 'Order started' 
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.startOrder(orderNumber);
      
      expect(axios.post).toHaveBeenCalledWith(`/api/orders/${orderNumber}/start`, {}, expect.any(Object));
      expect(result).toEqual(mockResponse);
    });

    it('handles API errors gracefully', async () => {
      const orderNumber = 'A123';
      
      // Mock API failure
      axios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(OrderDataService.startOrder(orderNumber)).rejects.toThrow('Network error');
      expect(axios.post).toHaveBeenCalledWith(`/api/orders/${orderNumber}/start`, {}, expect.any(Object));
    });
  });

  describe('completeOrder', () => {
    it('completes an order successfully via API', async () => {
      const orderNumber = 'A123';
      const mockResponse = { 
        success: true, 
        message: 'Order completed' 
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.completeOrder(orderNumber);
      
      expect(axios.post).toHaveBeenCalledWith(`/api/orders/${orderNumber}/complete`, {}, expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
  });

  describe('batchProcessOrders', () => {
    it('processes a batch of orders successfully', async () => {
      const orderIds = ['A123', 'A124', 'A125'];
      const action = 'start';
      const mockResponse = { 
        success: true, 
        message: 'Batch processed successfully',
        results: [
          { order_number: 'A123', success: true },
          { order_number: 'A124', success: true },
          { order_number: 'A125', success: true }
        ]
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.batchProcessOrders(orderIds, action);
      
      expect(axios.post).toHaveBeenCalledWith('/api/orders/batch', {
        order_ids: orderIds,
        action: action
      }, expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getOrderDetails', () => {
    it('retrieves order details successfully', async () => {
      const orderNumber = 'A123';
      const mockOrderDetails = { 
        order_number: 'A123',
        name: 'Test Customer',
        type: 'Cappuccino',
        status: 'in_progress'
      };
      
      axios.get.mockResolvedValueOnce({ 
        data: mockOrderDetails,
        status: 200 
      });

      const result = await OrderDataService.getOrderDetails(orderNumber);
      
      expect(axios.get).toHaveBeenCalledWith(`/api/orders/${orderNumber}`, expect.any(Object));
      expect(result).toEqual(mockOrderDetails);
    });

    it('falls back to localStorage when API fails', async () => {
      const orderNumber = 'A123';
      const mockOrderDetails = { 
        order_number: 'A123',
        name: 'Test Customer',
        type: 'Cappuccino',
        status: 'in_progress'
      };
      
      // Setup localStorage with the order details in different lists
      const pendingOrders = { orders: [] };
      const inProgressOrders = { orders: [mockOrderDetails] };
      const completedOrders = { orders: [] };
      
      localStorage.setItem('pendingOrders', JSON.stringify(pendingOrders));
      localStorage.setItem('inProgressOrders', JSON.stringify(inProgressOrders));
      localStorage.setItem('completedOrders', JSON.stringify(completedOrders));
      
      // Mock API failure
      axios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await OrderDataService.getOrderDetails(orderNumber);
      
      expect(axios.get).toHaveBeenCalledWith(`/api/orders/${orderNumber}`, expect.any(Object));
      expect(result).toEqual(mockOrderDetails);
    });
  });

  describe('sendOrderMessage', () => {
    it('sends a message for an order successfully', async () => {
      const orderNumber = 'A123';
      const message = 'Your order is almost ready!';
      const mockResponse = { 
        success: true, 
        message: 'Message sent successfully' 
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.sendOrderMessage(orderNumber, message);
      
      expect(axios.post).toHaveBeenCalledWith(`/api/orders/${orderNumber}/message`, {
        message: message
      }, expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
  });
  
  describe('sendReadyNotification', () => {
    it('sends a notification using direct phone number when available', async () => {
      const order = {
        id: 'A123',
        customerName: 'John Doe',
        phoneNumber: '+61412345678',
        coffeeType: 'Cappuccino',
        stationName: 'Station 1'
      };
      
      const mockResponse = { 
        success: true, 
        message: 'Notification sent successfully',
        method: 'direct_phone'
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.sendReadyNotification(order);
      
      expect(axios.post).toHaveBeenCalledWith('/api/sms/send', expect.objectContaining({
        to: '+61412345678',
        message: expect.stringContaining('YOUR COFFEE IS READY')
      }), expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
    
    it('falls back to order-based notification when direct notification fails', async () => {
      const order = {
        id: 'A123',
        customerName: 'John Doe',
        phoneNumber: '+61412345678',
        coffeeType: 'Cappuccino'
      };
      
      // Mock first attempt failure
      axios.post.mockRejectedValueOnce(new Error('SMS service unavailable'));
      
      // Mock second attempt success
      const mockResponse = { 
        success: true, 
        message: 'Notification sent via order API',
        method: 'order_based'
      };
      
      axios.post.mockResolvedValueOnce({ 
        data: mockResponse,
        status: 200 
      });

      const result = await OrderDataService.sendReadyNotification(order);
      
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenLastCalledWith('/api/orders/A123/ready', expect.any(Object), expect.any(Object));
      expect(result).toEqual(mockResponse);
    });
    
    it('falls back to sendMessageToCustomer as last resort', async () => {
      const order = {
        id: 'A123',
        customerName: 'John Doe',
        coffeeType: 'Cappuccino'
      };
      
      // Mock first two attempts failing
      axios.post.mockRejectedValueOnce(new Error('SMS service unavailable'));
      axios.post.mockRejectedValueOnce(new Error('Order API unavailable'));
      
      // Mock third attempt success
      const mockResponse = { 
        success: true, 
        message: 'Message sent to customer',
        method: 'message_to_customer'
      };
      
      // Setup for sendMessageToCustomer
      OrderDataService.sendMessageToCustomer = jest.fn().mockResolvedValueOnce(mockResponse);

      const result = await OrderDataService.sendReadyNotification(order);
      
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(OrderDataService.sendMessageToCustomer).toHaveBeenCalledWith(
        'A123', 
        expect.stringContaining('YOUR COFFEE IS READY')
      );
      expect(result).toEqual(mockResponse);
    });
  });
});