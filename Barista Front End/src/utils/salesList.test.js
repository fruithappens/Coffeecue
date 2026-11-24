import { money, summary, isOverdue, localToday } from './salesList';

const leads = [{ stage: 'enquiry', value: 1000 }, { stage: 'enquiry', value: null }, { stage: 'paid', value: 500 }, { stage: 'lost', value: 99 }];

test('counts and values per stage, open leaving out paid and lost', () => {
  const s = summary(leads, ['enquiry', 'demo', 'paid', 'lost']);
  expect(s.enquiry).toEqual({ count: 2, value: 1000 });
  expect(s.open).toEqual({ count: 2, value: 1000 });
  expect(s.demo).toEqual({ count: 0, value: 0 });
  expect(s.all.count).toBe(4);
  expect(money(12345.4)).toBe('$12,345');
});

test('overdue only while it is still open', () => {
  expect(isOverdue({ stage: 'demo', next_date: '2026-11-24' }, '2026-11-25')).toBe(true);
  expect(isOverdue({ stage: 'demo', next_date: '2026-11-25' }, '2026-11-25')).toBe(false);
  expect(isOverdue({ stage: 'paid', next_date: '2026-11-24' }, '2026-11-25')).toBe(false);
  expect(localToday(new Date(2026, 0, 5))).toBe('2026-01-05');
});
