import { customerStatusFor, CUSTOMER_STATUS } from './customerStatus';

test("the organiser's wording wins; blanks and missing stages keep ours", () => {
  const w = { pending: 'Hang tight, you are in line', completed: '   ' };
  expect(customerStatusFor('pending', w).title).toBe('Hang tight, you are in line');
  expect(customerStatusFor('completed', w).title).toBe(CUSTOMER_STATUS.completed.title);
  expect(customerStatusFor('in_progress', w).title).toBe(CUSTOMER_STATUS['in-progress'].title);
  expect(customerStatusFor('picked-up', {}).title).toBe(CUSTOMER_STATUS.picked_up.title);
});

test('the colour always stays ours, and unknown statuses are null', () => {
  expect(customerStatusFor('pending', { pending: 'x' }).tone).toBe(CUSTOMER_STATUS.pending.tone);
  expect(customerStatusFor('nonsense', {})).toBeNull();
  expect(customerStatusFor('pending', null).title).toBe(CUSTOMER_STATUS.pending.title);
});
