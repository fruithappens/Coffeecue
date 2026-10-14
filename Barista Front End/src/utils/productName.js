// productName.js — what the system calls itself.
//
// Old product names saved in a copy's branding ("Coffee Cue", "CoffeeCue",
// "Expresso Coffee System") are still CupQ: no client chose them, they're
// leftovers from older defaults. Same list as services/coffee_system.py
// OLD_PRODUCT_NAMES (the server side of the same rule).
const OLD = new Set(['coffee cue', 'coffeecue', 'coffee cue ordering system',
  'expresso coffee system', 'expresso']);

export function productName(saved) {
  const s = String(saved || '').trim();
  return !s || OLD.has(s.toLowerCase()) ? 'CupQ' : s;
}
