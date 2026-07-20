// Guards for the walk-in add placebo class (Penny's long black,
// 2026-07-20): the UI said "added", the server had rejected the order,
// and the phantom quietly vanished on the next fetch. Root cause: the
// addWalkInOrder wrapper blindly wrapped WHATEVER createOrder returned
// in {success:true} — including createOrder's own {success:false,
// refused:true} refusal shape — so the caller could never see failure.
//
// Mock ApiService so the ApiService→AuthService→OrderDataService import
// cycle doesn't explode under Jest (same trick as SettingsService.test).
jest.mock('./ApiService', () => jest.fn().mockImplementation(() => ({})));

import OrderDataService from './OrderDataService';

describe('OrderDataService.addWalkInOrder truthfulness', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes a server refusal through instead of wrapping it as success', async () => {
    jest.spyOn(OrderDataService, 'createWalkInOrder').mockResolvedValue({
      success: false,
      refused: true,
      message: "This station doesn't stock almond milk",
    });

    const res = await OrderDataService.addWalkInOrder({ coffee_type: 'latte' });
    expect(res.success).toBe(false);
    expect(res.refused).toBe(true);
    expect(res.message).toMatch(/doesn't stock/);
  });

  it('flags the offline fallback instead of pretending server success', async () => {
    jest.spyOn(OrderDataService, 'createWalkInOrder').mockResolvedValue({
      id: 'local_123',
      orderNumber: 'L123456',
      syncPending: true,
    });

    const res = await OrderDataService.addWalkInOrder({ coffee_type: 'latte' });
    expect(res.success).toBe(true);
    expect(res.offline).toBe(true);
  });

  it('wraps a real server order as plain success', async () => {
    jest.spyOn(OrderDataService, 'createWalkInOrder').mockResolvedValue({
      id: '1234',
      order_number: '1234',
    });

    const res = await OrderDataService.addWalkInOrder({ coffee_type: 'latte' });
    expect(res.success).toBe(true);
    expect(res.offline).toBeUndefined();
    expect(res.data.order_number).toBe('1234');
  });

  it('reports a thrown error as failure, never success', async () => {
    jest.spyOn(OrderDataService, 'createWalkInOrder').mockRejectedValue(
      new Error('boom')
    );

    const res = await OrderDataService.addWalkInOrder({ coffee_type: 'latte' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('boom');
  });
});
