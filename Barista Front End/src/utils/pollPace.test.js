import { pollDelayMs, FAST_MS, QUEUED_MS, FAR_BACK_MS, HIDDEN_MS } from './pollPace';

test('being made or ready: fast', () => {
  expect(pollDelayMs({ status: 'in-progress' })).toBe(FAST_MS);
  expect(pollDelayMs({ status: 'completed' })).toBe(FAST_MS);
});

test('near the front: fast; far back: relaxed; position unknown: in between', () => {
  expect(pollDelayMs({ status: 'pending', position: 2 })).toBe(FAST_MS);
  expect(pollDelayMs({ status: 'pending', position: 12 })).toBe(FAR_BACK_MS);
  expect(pollDelayMs({ status: 'pending' })).toBe(QUEUED_MS);
});

test('hidden page: slow; finished order: stop', () => {
  expect(pollDelayMs({ status: 'in-progress', hidden: true })).toBe(HIDDEN_MS);
  expect(pollDelayMs({ status: 'picked_up' })).toBeNull();
  expect(pollDelayMs({ status: 'cancelled' })).toBeNull();
});

test('every visible pace stays well under the 30 s stale warning', () => {
  [FAST_MS, QUEUED_MS, FAR_BACK_MS].forEach((ms) => expect(ms).toBeLessThanOrEqual(20000));
});
