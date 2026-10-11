// OrderDataService: the order list every barista and display screen reads.
//
// The previous version of this file was written against an earlier API
// (/api/orders/pending and friends) and never ran -- the suite failed to
// load because Jest couldn't parse axios. It now tests what the service
// actually does: one /orders call grouped by status, a 2 s burst cache that
// Refresh bypasses, a localStorage copy used only when the API fails, and
// live order events clearing the cache.
import orderDataService from './OrderDataService';

const sample = [
  { id: 1, order_number: '101', status: 'pending', createdAt: new Date().toISOString() },
  { id: 2, order_number: '102', status: 'in_progress', createdAt: new Date().toISOString() },
  { id: 3, order_number: '103', status: 'completed', createdAt: new Date().toISOString() },
  { id: 4, order_number: '104', status: 'picked_up', createdAt: new Date().toISOString() },
];

let api;
beforeEach(() => {
  api = { get: jest.fn().mockResolvedValue({ status: 'success', data: sample }) };
  orderDataService.apiService = api;
  orderDataService.cache.clear();
  localStorage.clear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('groups one /orders response by status', async () => {
  const got = await orderDataService.getOrders();
  expect(api.get).toHaveBeenCalledWith('/orders?');
  expect(got.pendingOrders.map((o) => o.order_number)).toEqual(['101']);
  expect(got.inProgressOrders.map((o) => o.order_number)).toEqual(['102']);
  // Collected orders count as completed for the screens.
  expect(got.completedOrders.map((o) => o.order_number)).toEqual(['103', '104']);
});

test('filters by station when given one', async () => {
  await orderDataService.getOrders(2);
  expect(api.get).toHaveBeenCalledWith('/orders?station_id=2');
});

test('a burst of calls costs one request; Refresh (force) always asks the server', async () => {
  await orderDataService.getOrders();
  await orderDataService.getPendingOrders();
  await orderDataService.getInProgressOrders();
  expect(api.get).toHaveBeenCalledTimes(1);
  await orderDataService.getOrders(null, { force: true });
  expect(api.get).toHaveBeenCalledTimes(2);
});

test('uses the saved copy only when the API fails', async () => {
  await orderDataService.getOrders(); // saves the backup
  orderDataService.cache.clear();
  api.get.mockRejectedValueOnce(new Error('offline'));
  const got = await orderDataService.getOrders();
  expect(got.pendingOrders.map((o) => o.order_number)).toEqual(['101']);
});

test('with no saved copy and no API, screens get empty lists, not a crash', async () => {
  api.get.mockRejectedValueOnce(new Error('offline'));
  const got = await orderDataService.getOrders();
  expect(got).toEqual({ pendingOrders: [], inProgressOrders: [], completedOrders: [] });
});

test('a live order update clears the cache so the next read is fresh', async () => {
  await orderDataService.getOrders();
  window.dispatchEvent(new CustomEvent('order_updated', { detail: { id: 2 } }));
  await orderDataService.getOrders();
  expect(api.get).toHaveBeenCalledTimes(2);
});
