// The screen counts an order's age; the server only says when it was made.
import {
  noteServerDate, serverNow, clockSkewMs, minutesSince, withWaitTime, stampWaitTimes,
} from './orderTime';

describe('orderTime', () => {
  // toISOString, not toUTCString: the HTTP form drops the milliseconds, which
  // is fine for a real header and a second of skew too many for these sums.
  afterEach(() => { noteServerDate(new Date().toISOString()); });

  test('minutesSince counts whole minutes from a naive-UTC server timestamp', () => {
    const now = Date.parse('2026-09-12T02:10:30Z');
    expect(minutesSince('2026-09-12T02:00:00', now)).toBe(10);      // no Z: still UTC
    expect(minutesSince('2026-09-12T02:00:00Z', now)).toBe(10);
    expect(minutesSince('2026-09-12 02:09:59', now)).toBe(0);       // 31 s -> 0 min
    expect(minutesSince('2026-09-12T03:00:00', now)).toBe(0);       // never negative
    expect(minutesSince(null, now)).toBeNull();
    expect(minutesSince('not a date', now)).toBeNull();
  });

  test('withWaitTime stamps both spellings and returns the same object when unchanged', () => {
    const now = Date.parse('2026-09-12T02:10:00Z');
    const o = { id: '7', createdAt: '2026-09-12T02:03:00' };
    const s = withWaitTime(o, now);
    expect(s).not.toBe(o);
    expect(s.waitTime).toBe(7);
    expect(s.wait_time).toBe(7);
    expect(withWaitTime(s, now)).toBe(s);                             // no churn for React
    expect(withWaitTime({ id: 'x' }, now)).toEqual({ id: 'x' });      // no createdAt: untouched
    expect(withWaitTime(null, now)).toBeNull();
  });

  test('stampWaitTimes uses one instant for the whole list', () => {
    const list = stampWaitTimes([
      { id: 'a', created_at: new Date(Date.now() - 5.5 * 60000).toISOString() },
      { id: 'b', createdAt: new Date(Date.now() - 12.5 * 60000).toISOString() },
    ]);
    expect(list.map((o) => o.waitTime)).toEqual([5, 12]);
    expect(stampWaitTimes('nope')).toBe('nope');
  });

  test('the age is measured on the server clock, not the tablet clock', () => {
    // A tablet five minutes FAST: the server's Date header is five minutes behind Date.now().
    const serverTime = new Date(Date.now() - 5 * 60000);
    noteServerDate(serverTime.toUTCString());
    expect(clockSkewMs()).toBeGreaterThan(4.9 * 60000);
    expect(Math.abs(serverNow() - serverTime.getTime())).toBeLessThan(2000);
    // An order the server created "just now" reads 0 min, not 5.
    const justNow = new Date(serverTime.getTime() - 20000).toISOString();
    expect(withWaitTime({ createdAt: justNow }).waitTime).toBe(0);
    // Garbage in the header is ignored, the previous skew stands.
    noteServerDate('');
    noteServerDate('yesterday-ish');
    expect(clockSkewMs()).toBeGreaterThan(4.9 * 60000);
  });
});
