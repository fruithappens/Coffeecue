import { lidCode } from './BenchMode';

describe('lidCode: what the barista writes on the lid', () => {
  it('writes drink and milk, nothing for full cream', () => {
    expect(lidCode({ coffeeType: 'Flat White', milkType: 'Full cream' })).toBe('FW');
    expect(lidCode({ coffeeType: 'Cappuccino', milkType: 'Skim' })).toBe('CAP S');
    expect(lidCode({ coffeeType: 'Latte', milkType: 'Oat' })).toBe('LAT O');
    expect(lidCode({ coffeeType: 'Flat white', milkType: 'Lactose free' })).toBe('FW LF');
    expect(lidCode({ coffeeType: 'Chai latte', milkType: 'Almond' })).toBe('CH A');
  });
  it('marks strong, decaf and notes', () => {
    expect(lidCode({ coffeeType: 'strong flat white', milkType: 'skim' })).toBe('FW S X');
    expect(lidCode({ coffeeType: 'decaf latte', milkType: 'soy' })).toBe('LAT SOY DC');
    expect(lidCode({ coffeeType: 'Long Black', milkType: 'No milk', notes: 'Dash of cold water' })).toBe('LB N');
    expect(lidCode({ coffeeType: 'Flat white', milkType: 'Full cream', shots: 2 })).toBe('FW X');
  });
  it('leaves size off unless asked', () => {
    expect(lidCode({ coffeeType: 'Latte', milkType: 'Skim', size: 'Large' })).toBe('LAT S');
    expect(lidCode({ coffeeType: 'Latte', milkType: 'Skim', size: 'Large' }, { showSize: true })).toBe('L LAT S');
  });
});

describe('same-drink rounds', () => {
  const { drinkGroups, milkTally } = require('./BenchMode');
  const o = (n, type, milk) => ({ id: String(n), orderNumber: String(n), coffeeType: type, milkType: milk });
  it('tallies the milks to steam', () => {
    expect(milkTally([o(1, 'hot chocolate', 'Full cream'), o(2, 'hot chocolate', 'Skim'), o(3, 'hot chocolate', 'full cream'), o(4, 'hot chocolate', 'Oat')]))
      .toBe('2 FC, 1 S, 1 O');
  });
  it('groups only within the fair window, strong and decaf with their drink', () => {
    const waiting = [o(1, 'hot chocolate', 'skim'), o(2, 'flat white', 'skim'), o(3, 'strong flat white', 'oat'), o(4, 'hot chocolate', 'full cream'), o(5, 'hot chocolate', 'oat')];
    const g = drinkGroups(waiting, 4);
    expect(g.map((x) => [x.code, x.orders.length])).toEqual([['HC', 2], ['FW', 2]]);
  });
});
