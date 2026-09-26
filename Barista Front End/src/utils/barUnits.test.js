import { reconcileUnits } from './barUnits';

const o = (id, extra = {}) => ({ id, ...extra });

describe('reconcileUnits', () => {
  test('no saved layout: one unit per order, in server order', () => {
    expect(reconcileUnits([], [o(1), o(2), o(3)])).toEqual([['1'], ['2'], ['3']]);
  });

  test('keeps the saved order and batches', () => {
    const saved = [['3'], ['1', '2']];
    expect(reconcileUnits(saved, [o(1), o(2), o(3)])).toEqual([['3'], ['1', '2']]);
  });

  test('drops orders that have left Waiting, and empty batches', () => {
    const saved = [['1', '2'], ['3'], ['4']];
    expect(reconcileUnits(saved, [o(2), o(4)])).toEqual([['2'], ['4']]);
  });

  test('new orders join at the end, VIP at the front', () => {
    const saved = [['1']];
    expect(reconcileUnits(saved, [o(1), o(2), o(3, { vip: true })])).toEqual([['3'], ['1'], ['2']]);
  });

  test('an id saved twice is only shown once', () => {
    expect(reconcileUnits([['1'], ['1', '2']], [o(1), o(2)])).toEqual([['1'], ['2']]);
  });

  test('garbage in storage never hides an order', () => {
    expect(reconcileUnits('junk', [o(1)])).toEqual([['1']]);
    expect(reconcileUnits([null, 5, ['x']], [o(1)])).toEqual([['1']]);
  });
});
