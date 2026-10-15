// contrast.js — make an organiser's colour readable (WCAG AA, 4.5:1).
//
// The event's colour is used two ways on customer screens: as text on the
// cream page (the event name, highlights) and as a background behind white
// text (headers, buttons). The axe audit (15 Oct 2026) found Virgin red at
// 4.39:1 on cream and CupQ's caramel default at 3.12:1 under white text.
// This darkens the colour, keeping its hue, only as far as needed for both
// uses: 4.5:1 against cream also gives 4.5:1+ against white. Colours that
// already pass come back unchanged.
// The darkest background a customer screen puts event colour on (cq-wash);
// passing here also passes on cream (#F6F1EA) and white.
const CREAM = '#EFE7DC';
const AA = 4.5;

function channels(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

function luminance([r, g, b]) {
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return 1;
  const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** The colour, darkened just enough to read on cream and to carry white text. */
export function readableColour(hex, against = CREAM) {
  const c = channels(hex);
  if (!c) return hex;
  if (contrastRatio(toHex(c), against) >= AA) return hex;
  for (let k = 0.98; k > 0.2; k -= 0.02) {
    const d = toHex(c.map((v) => v * k));
    if (contrastRatio(d, against) >= AA) return d;
  }
  return '#2A1F17';
}
