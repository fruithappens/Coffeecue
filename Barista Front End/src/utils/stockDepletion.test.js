import {
  normalizeMilkName, planDepletion, resolveMilkId, resolveSize,
} from './stockDepletion';

// What a real station stocks, including milks the old hardcoded list
// never knew about.
const STOCK = [
  { id: 'milk_regular', name: 'Full Cream' },
  { id: 'milk_skim', name: 'Skim Milk' },
  { id: 'milk_oat', name: 'Oat Milk' },
  { id: 'milk_lactose_free', name: 'Lactose Free' },
  { id: 'milk_soy', name: 'Soy' },
];

describe('resolveSize', () => {
  it('uses the order size field', () => {
    expect(resolveSize({ size: 'large', coffeeType: 'latte' })).toBe('large');
    expect(resolveSize({ size: 'Small', coffeeType: 'flat white' })).toBe('small');
  });

  it('falls back to the drink text for SMS orders that bake it in', () => {
    expect(resolveSize({ coffeeType: 'large flat white' })).toBe('large');
  });

  it('defaults to medium when nothing says otherwise', () => {
    expect(resolveSize({ coffeeType: 'latte' })).toBe('medium');
    expect(resolveSize({})).toBe('medium');
    expect(resolveSize(null)).toBe('medium');
  });

  it('does not read a size out of a drink name that has none', () => {
    // The original bug: coffeeType is the ONLY thing the old code read,
    // and it never contains a size, so every order came back medium.
    expect(resolveSize({ size: 'large', coffeeType: 'cappuccino' })).toBe('large');
  });
});

describe('normalizeMilkName', () => {
  it('collapses the spellings the database actually holds', () => {
    // CTN26 stored both of these for the same milk.
    expect(normalizeMilkName('Full Cream Milk')).toBe('full cream');
    expect(normalizeMilkName('full cream')).toBe('full cream');
    expect(normalizeMilkName('Oat Milk')).toBe('oat');
    expect(normalizeMilkName('oat')).toBe('oat');
    expect(normalizeMilkName('lactose-free')).toBe('lactose free');
  });
});

describe('resolveMilkId', () => {
  it('matches what the station stocks, by name', () => {
    expect(resolveMilkId({ milkType: 'oat' }, STOCK)).toBe('milk_oat');
    expect(resolveMilkId({ milkType: 'Oat Milk' }, STOCK)).toBe('milk_oat');
    expect(resolveMilkId({ milkType: 'lactose free' }, STOCK)).toBe('milk_lactose_free');
  });

  it('handles the milks that used to fall through to full cream', () => {
    // Oat, lactose free, coconut and macadamia all silently became
    // full cream. That is two wrong numbers per order.
    for (const milk of ['oat', 'lactose free']) {
      expect(resolveMilkId({ milkType: milk }, STOCK)).not.toBe('milk_regular');
    }
    expect(resolveMilkId({ milkType: 'coconut' }, [])).toBe('milk_coconut');
    expect(resolveMilkId({ milkType: 'macadamia' }, [])).toBe('milk_macadamia');
  });

  it('depletes nothing for a black coffee', () => {
    // Ten long blacks at CTN26 each took 250ml of milk that was never poured.
    expect(resolveMilkId({ milkType: 'no milk' }, STOCK)).toBeNull();
    expect(resolveMilkId({ milkType: 'none' }, STOCK)).toBeNull();
    expect(resolveMilkId({ milkType: '' }, STOCK)).toBeNull();
    expect(resolveMilkId({}, STOCK)).toBeNull();
  });

  it('returns null rather than guessing at an unknown milk', () => {
    expect(resolveMilkId({ milkType: 'unicorn tears' }, STOCK)).toBeNull();
  });

  it('still resolves a known milk the station has not configured', () => {
    expect(resolveMilkId({ milkType: 'skim' }, [])).toBe('milk_skim');
  });
});

describe('planDepletion', () => {
  it('deducts the right cup size', () => {
    // The quietest of the three faults: large cups never depleted, so a
    // cart could run out with the system still showing a full box.
    expect(planDepletion({ size: 'large', coffeeType: 'latte' }, STOCK).cup.id)
      .toBe('cups_large');
    expect(planDepletion({ size: 'small', coffeeType: 'latte' }, STOCK).cup.id)
      .toBe('cups_small');
  });

  it('scales milk and beans with size', () => {
    const large = planDepletion({ size: 'large', milkType: 'oat' }, STOCK);
    const small = planDepletion({ size: 'small', milkType: 'oat' }, STOCK);
    expect(large.milk.litres).toBeGreaterThan(small.milk.litres);
    expect(large.beans.kilos).toBeGreaterThan(small.beans.kilos);
  });

  it('a large oat latte: the case that was wrong three ways', () => {
    const plan = planDepletion(
      { size: 'large', coffeeType: 'latte', milkType: 'Oat Milk' }, STOCK);
    expect(plan).toEqual({
      size: 'large',
      milk: { id: 'milk_oat', litres: 0.35 },
      beans: { id: 'coffee_house', kilos: 0.022 },
      cup: { id: 'cups_large', count: 1 },
    });
  });

  it('a small long black takes a cup and beans but no milk', () => {
    const plan = planDepletion(
      { size: 'small', coffeeType: 'long black', milkType: 'no milk' }, STOCK);
    expect(plan.milk).toBeNull();
    expect(plan.cup.id).toBe('cups_small');
    expect(plan.beans.kilos).toBe(0.008);
  });
});
