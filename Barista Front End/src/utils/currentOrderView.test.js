import {
  filterByMilk, milkOptions, orderMilk, sortCurrentOrders, summariseMilk,
} from './currentOrderView';

const at = (mins) => new Date(Date.now() - mins * 60000).toISOString();

const BENCH = [
  { id: 1, coffeeType: 'latte', size: 'medium', milkType: 'Full Cream Milk', startedAt: at(9) },
  { id: 2, coffeeType: 'latte', size: 'large', milkType: 'full cream', startedAt: at(6) },
  { id: 3, coffeeType: 'flat white', size: 'medium', milkType: 'Oat Milk', startedAt: at(3) },
  { id: 4, coffeeType: 'long black', size: 'medium', milkType: 'no milk', startedAt: at(1) },
];

describe('orderMilk', () => {
  it('collapses the spellings the database holds', () => {
    expect(orderMilk({ milkType: 'Full Cream Milk' })).toBe('full cream');
    expect(orderMilk({ milkType: 'full cream' })).toBe('full cream');
  });

  it('is empty for a drink that takes no milk', () => {
    expect(orderMilk({ milkType: 'no milk' })).toBe('');
    expect(orderMilk({})).toBe('');
  });
});

describe('sortCurrentOrders', () => {
  it('puts the longest-waiting coffee first by default', () => {
    expect(sortCurrentOrders(BENCH).map((o) => o.id)).toEqual([1, 2, 3, 4]);
  });

  it('can flip to newest first', () => {
    expect(sortCurrentOrders(BENCH, 'newest').map((o) => o.id)).toEqual([4, 3, 2, 1]);
  });

  it('sorts orders with no timestamp last, not first', () => {
    // A missing timestamp reads as 0, which under "oldest" would put a
    // brand new order at the top of the queue and hide the real one.
    const withGap = [...BENCH, { id: 5 }];
    expect(sortCurrentOrders(withGap).map((o) => o.id)).toEqual([1, 2, 3, 4, 5]);
    expect(sortCurrentOrders(withGap, 'newest').map((o) => o.id)).toEqual([4, 3, 2, 1, 5]);
  });

  it('does not mutate the list it was given', () => {
    const original = [...BENCH];
    sortCurrentOrders(BENCH, 'newest');
    expect(BENCH).toEqual(original);
  });

  it('survives rubbish input', () => {
    expect(sortCurrentOrders(null)).toEqual([]);
  });
});

describe('summariseMilk', () => {
  it('totals the litres per milk so the barista can pick a jug', () => {
    // medium full cream 0.25 + large full cream 0.35 = 0.6
    // medium oat 0.25
    expect(summariseMilk(BENCH)).toEqual([
      { milk: 'full cream', count: 2, litres: 0.6 },
      { milk: 'oat', count: 1, litres: 0.25 },
    ]);
  });

  it('ignores drinks that take no milk', () => {
    expect(summariseMilk([{ milkType: 'no milk', size: 'large' }])).toEqual([]);
  });

  it('rounds so a jug reading is not 0.7500000000000001', () => {
    const three = [
      { milkType: 'oat', size: 'medium' },
      { milkType: 'oat', size: 'medium' },
      { milkType: 'oat', size: 'medium' },
    ];
    expect(summariseMilk(three)[0].litres).toBe(0.75);
  });

  it('puts the biggest jug first', () => {
    expect(summariseMilk(BENCH)[0].milk).toBe('full cream');
  });
});

describe('milkOptions and filterByMilk', () => {
  it('lists the milks present, most common first', () => {
    expect(milkOptions(BENCH)).toEqual([
      { milk: 'full cream', count: 2 },
      { milk: 'oat', count: 1 },
    ]);
  });

  it('only offers a chip when filtering would tell you something', () => {
    // One almond coffee on a busy bench does not need a filter -- you
    // can see it. Offering the chip anyway wrapped the header.
    expect(milkOptions(BENCH, 2)).toEqual([{ milk: 'full cream', count: 2 }]);
  });

  it('filters to one milk', () => {
    expect(filterByMilk(BENCH, 'oat').map((o) => o.id)).toEqual([3]);
  });

  it('an empty filter means everything', () => {
    expect(filterByMilk(BENCH, '')).toHaveLength(4);
  });
});
