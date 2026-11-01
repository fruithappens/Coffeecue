import { recall } from './deviceMemory';

// The owner key for an order this device placed (see utils/order_owner.py on
// the server): kept with the remembered live order, sent back with cancel
// and "got it". A friend who scans the share-QR has the number, not the key.
export const ownerKeyFor = (orderNumber) => {
  try {
    const a = JSON.parse(recall('cupq_active_order') || 'null');
    if (a && String(a.n) === String(orderNumber)) return a.k || '';
  } catch (e) { /* nothing remembered */ }
  return '';
};
