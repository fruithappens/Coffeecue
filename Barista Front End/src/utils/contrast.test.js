import { readableColour, contrastRatio } from './contrast';

test('colours that already pass are left alone', () => {
  expect(readableColour('#3B2314')).toBe('#3B2314');
  expect(readableColour('#512698')).toBe('#512698');
});

test('caramel and Virgin red are darkened just enough, for cream and white', () => {
  ['#C08552', '#B8764A', '#E10A0A', '#FFD000'].forEach((c) => {
    const r = readableColour(c);
    expect(contrastRatio(r, '#F6F1EA')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(r, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
  // Barely changed when it barely fails: Virgin red stays Virgin red.
  expect(contrastRatio(readableColour('#E10A0A'), '#E10A0A')).toBeLessThan(1.2);
});

test('rubbish in, rubbish out (never throws)', () => {
  expect(readableColour('')).toBe('');
  expect(readableColour('red')).toBe('red');
});
