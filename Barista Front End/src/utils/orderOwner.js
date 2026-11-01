import { recall } from './deviceMemory';

// The owner key for an order this device placed (see utils/order_owner.py on
// the server): kept with the remembered live order, sent back with cancel
// and "got it". A friend who scans the share-QR has the number, not the key.
// cupq_order_owner is the same for an order placed from /my, which must
// not use cupq_active_order (that one sends /my to the tracking page).
export const ownerKeyFor = (orderNumber) => {
  for (const store of ['cupq_active_order', 'cupq_order_owner']) {
    try {
      const a = JSON.parse(recall(store) || 'null');
      if (a && a.k && String(a.n) === String(orderNumber)) return a.k;
    } catch (e) { /* nothing remembered */ }
  }
  return '';
};
