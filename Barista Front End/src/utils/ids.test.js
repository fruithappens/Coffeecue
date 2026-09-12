import { sameId, byId, notId, stationIdOf } from './ids';

describe('ids', () => {
  test('a number and its string are the same id', () => {
    expect(sameId(42, '42')).toBe(true);
    expect(sameId('42', 42)).toBe(true);
    expect(sameId('1021', '1021')).toBe(true);
    expect(sameId(1, 2)).toBe(false);
    expect(sameId('local_order_7', 'local_order_7')).toBe(true);
  });
  test('nothing equals a missing id, not even another missing id', () => {
    expect(sameId(null, null)).toBe(false);
    expect(sameId(undefined, undefined)).toBe(false);
    expect(sameId(null, 'null')).toBe(false);
    expect(sameId(0, null)).toBe(false);
    expect(sameId(0, '0')).toBe(true);
  });
  test('byId / notId work on lists whose ids came back as strings', () => {
    const list = [{ id: '435' }, { id: '436' }, null];
    expect(list.find(byId(435))).toEqual({ id: '435' });
    expect(list.filter(notId(436))).toEqual([{ id: '435' }, null]);
    expect(list.some(byId('999'))).toBe(false);
  });
  test('stationIdOf reads whichever spelling the row carries', () => {
    expect(stationIdOf({ stationId: 2 })).toBe(2);
    expect(stationIdOf({ station_id: '2' })).toBe('2');
    expect(stationIdOf({ assignedStation: '3' })).toBe('3');
    expect(stationIdOf({})).toBeNull();
    expect(stationIdOf(null)).toBeNull();
  });
});
