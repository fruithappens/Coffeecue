import { dedupeOrders, orderKey, upsertOrder } from './orderListUtils';

describe('orderKey', () => {
  it('prefers the order number, which is the customer-facing identity', () => {
    expect(orderKey({ orderNumber: '1234', id: 99 })).toBe('n:1234');
    expect(orderKey({ order_number: '1234' })).toBe('n:1234');
  });

  it('matches the same order across local and server shapes', () => {
    // Local objects and API objects disagree on `id` but agree on the
    // order number -- which is exactly why the number is the key.
    expect(orderKey({ orderNumber: '1234', id: 'local_1234' }))
      .toBe(orderKey({ order_number: '1234', id: 8871 }));
  });

  it('falls back to id, then to nothing', () => {
    expect(orderKey({ id: 42 })).toBe('i:42');
    expect(orderKey({})).toBe('');
    expect(orderKey(null)).toBe('');
  });
});

describe('upsertOrder', () => {
  it('adds an order that is not there', () => {
    expect(upsertOrder([], { orderNumber: '1' })).toHaveLength(1);
  });

  it('does not create a second card for the same order', () => {
    // The actual CTN26 bug: two completion paths, one coffee, two cards.
    const list = upsertOrder([], { orderNumber: '1234', status: 'completed' });
    const again = upsertOrder(list, { orderNumber: '1234', status: 'completed' });
    expect(again).toHaveLength(1);
  });

  it('keeps the newer object, which knows more', () => {
    const list = upsertOrder([], { orderNumber: '1234', prepTime: null });
    const again = upsertOrder(list, { orderNumber: '1234', prepTime: 4 });
    expect(again[0].prepTime).toBe(4);
  });

  it('puts the order at the front', () => {
    const list = [{ orderNumber: 'A' }, { orderNumber: 'B' }];
    expect(upsertOrder(list, { orderNumber: 'C' })[0].orderNumber).toBe('C');
  });

  it('leaves other orders alone', () => {
    const list = [{ orderNumber: 'A' }, { orderNumber: 'B' }];
    expect(upsertOrder(list, { orderNumber: 'A' })).toHaveLength(2);
  });

  it('keeps an unkeyed order rather than dropping a real coffee', () => {
    expect(upsertOrder([{ orderNumber: 'A' }], {})).toHaveLength(2);
  });

  it('survives a non-array list', () => {
    expect(upsertOrder(null, { orderNumber: 'A' })).toHaveLength(1);
  });
});

describe('dedupeOrders', () => {
  it('collapses a payload that repeats an order', () => {
    const out = dedupeOrders([
      { orderNumber: '1' }, { orderNumber: '2' }, { orderNumber: '1' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.orderNumber)).toEqual(['1', '2']);
  });

  it('keeps unkeyed entries', () => {
    expect(dedupeOrders([{}, {}])).toHaveLength(2);
  });

  it('handles rubbish input', () => {
    expect(dedupeOrders(null)).toEqual([]);
  });
});
