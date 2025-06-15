import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InProgressOrder from './InProgressOrder';
import { AppContext } from '../context/AppContext';

// Mock the API service
jest.mock('../services/OrderDataService', () => ({
  completeOrder: jest.fn().mockResolvedValue({ success: true }),
  updateOrderStatus: jest.fn().mockResolvedValue({ success: true }),
}));

// Sample order data
const mockOrder = {
  id: '12345',
  order_number: 'A123',
  name: 'Test Customer',
  type: 'Cappuccino',
  milk: 'Oat milk',
  milkTypeId: 'oat',
  size: 'Regular',
  sugar: '1 sugar',
  notes: 'Test notes',
  status: 'in_progress',
  created_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  vip: false,
  estimated_completion_time: new Date(Date.now() + 5 * 60000).toISOString(),
};

// Mock context value
const mockContextValue = {
  settings: {
    enableSounds: true,
    showMilkIndicator: true,
  },
  refreshOrders: jest.fn(),
  setErrorMessage: jest.fn(),
  setSuccessMessage: jest.fn(),
};

describe('InProgressOrder Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an in-progress order correctly', () => {
    render(
      <AppContext.Provider value={mockContextValue}>
        <InProgressOrder order={mockOrder} />
      </AppContext.Provider>
    );

    // Check if order details are displayed
    expect(screen.getByText(mockOrder.order_number)).toBeInTheDocument();
    expect(screen.getByText(mockOrder.name)).toBeInTheDocument();
    expect(screen.getByText(mockOrder.type)).toBeInTheDocument();
    
    // Check if milk indicator is displayed
    expect(screen.getByTestId('milk-indicator')).toHaveClass(`milk-indicator-dot ${mockOrder.milkTypeId}`);
    
    // Check if completion button is displayed
    expect(screen.getByText(/complete/i)).toBeInTheDocument();
  });

  it('displays VIP indicator for VIP orders', () => {
    const vipOrder = { ...mockOrder, vip: true };
    
    render(
      <AppContext.Provider value={mockContextValue}>
        <InProgressOrder order={vipOrder} />
      </AppContext.Provider>
    );

    // Check if VIP indicator is displayed
    expect(screen.getByTestId('order-card')).toHaveClass('border-l-4 border-red-500');
    expect(screen.getByText(/VIP/i)).toBeInTheDocument();
  });

  it('handles order completion correctly', async () => {
    const OrderService = require('../services/OrderDataService');
    
    render(
      <AppContext.Provider value={mockContextValue}>
        <InProgressOrder order={mockOrder} />
      </AppContext.Provider>
    );

    // Click the complete button
    fireEvent.click(screen.getByText(/complete/i));
    
    // Wait for completion to be processed
    await waitFor(() => {
      expect(OrderService.completeOrder).toHaveBeenCalledWith(mockOrder.order_number);
      expect(mockContextValue.refreshOrders).toHaveBeenCalled();
      expect(mockContextValue.setSuccessMessage).toHaveBeenCalledWith(
        expect.stringContaining(mockOrder.order_number)
      );
    });
  });

  it('shows an error message when completion fails', async () => {
    const OrderService = require('../services/OrderDataService');
    OrderService.completeOrder.mockRejectedValueOnce(new Error('API error'));
    
    render(
      <AppContext.Provider value={mockContextValue}>
        <InProgressOrder order={mockOrder} />
      </AppContext.Provider>
    );

    // Click the complete button
    fireEvent.click(screen.getByText(/complete/i));
    
    // Wait for error to be processed
    await waitFor(() => {
      expect(OrderService.completeOrder).toHaveBeenCalledWith(mockOrder.order_number);
      expect(mockContextValue.setErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Failed to complete order')
      );
    });
  });

  it('shows time pressure indicator when order is nearing completion time', () => {
    const urgentOrder = {
      ...mockOrder,
      estimated_completion_time: new Date(Date.now() + 2 * 60000).toISOString(), // 2 minutes away
    };
    
    render(
      <AppContext.Provider value={mockContextValue}>
        <InProgressOrder order={urgentOrder} />
      </AppContext.Provider>
    );

    // Check if time pressure indicator is displayed with the urgent color
    const timePressureBar = screen.getByTestId('time-pressure-bar');
    expect(timePressureBar).toHaveClass('bg-yellow-500'); // Assuming yellow for time pressure warning
  });

  it('hides milk indicator when disabled in settings', () => {
    const contextWithDisabledMilk = {
      ...mockContextValue,
      settings: {
        ...mockContextValue.settings,
        showMilkIndicator: false,
      },
    };
    
    render(
      <AppContext.Provider value={contextWithDisabledMilk}>
        <InProgressOrder order={mockOrder} />
      </AppContext.Provider>
    );

    // Milk indicator should not be present
    expect(screen.queryByTestId('milk-indicator')).not.toBeInTheDocument();
  });
});