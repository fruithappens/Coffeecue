import { productName } from './productName';

test('old product names read as CupQ; a client name is kept', () => {
  ['Coffee Cue', 'CoffeeCue', 'coffee cue ordering system', 'Expresso Coffee System', '', null].forEach(
    (n) => expect(productName(n)).toBe('CupQ'));
  expect(productName('Virgin Australia')).toBe('Virgin Australia');
});
