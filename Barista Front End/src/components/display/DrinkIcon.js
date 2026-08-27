import React from 'react';
import { drinkEmoji } from './KioskOrder';

/**
 * One recognisable glyph per drink. Steve, looking at the drink grid:
 * "all are 5 shown are the same and no uniqie vidual id" — every coffee
 * emoji is the same cup, so the tiles carried no information.
 *
 * These are drawn the way a barista tells drinks apart: the VESSEL and
 * what's IN it. A demitasse for espresso, a tall glass for latte, the
 * flat surface on a flat white, foam dome and dusting on a cappuccino,
 * the layered glass of a cortado, the little glass with a stain of milk
 * for macchiato. Palette is fixed: dark roast, crema, steamed milk.
 * Anything without a drawing here (teas, hot chocolate…) falls back to
 * the emoji, which for those IS distinctive.
 */

const ROAST = '#4a2c17';
const CREMA = '#c98a3d';
const MILK = '#f6efe4';
const FOAM = '#efe3d0';
const LINE = '#3f3f46';
const GLASS = '#e5e7eb';

// Steam wisps shared by the hot cups.
const Steam = ({ x = 32 }) => (
  <g stroke={LINE} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.45">
    <path d={`M${x - 5} 13 q 2 -4 0 -8`} />
    <path d={`M${x + 5} 13 q -2 -4 0 -8`} />
  </g>
);

const Saucer = ({ y = 52, w = 20 }) => (
  <ellipse cx="32" cy={y} rx={w} ry="3.5" fill="none" stroke={LINE} strokeWidth="2.5" />
);

const ART = {
  espresso: (
    <>
      <Steam />
      {/* demitasse: small, wide, on a saucer */}
      <path d="M20 24 h24 l-3 18 h-18 z" fill="#fff" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M22.5 28 h19 l-1.2 7 h-16.6 z" fill={ROAST} />
      <path d="M22.5 28 h19 l-0.5 3 h-18 z" fill={CREMA} />
      <path d="M44 27 q7 1 5 7 q-1.5 4.5 -7 4" fill="none" stroke={LINE} strokeWidth="2.5" />
      <Saucer y={47} w={17} />
    </>
  ),
  ristretto: (
    <>
      <Steam />
      {/* smaller still, and the shot sits LOW: the short pour */}
      <path d="M23 26 h18 l-2.5 15 h-13 z" fill="#fff" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M25.5 33 h13 l-1 6 h-11 z" fill={ROAST} />
      <path d="M25.5 33 h13 l-0.5 2.5 h-12 z" fill={CREMA} />
      <path d="M41 28 q6 1 4.5 6 q-1.2 4 -6 3.5" fill="none" stroke={LINE} strokeWidth="2.5" />
      <Saucer y={44} w={14} />
    </>
  ),
  'long black': (
    <>
      <Steam />
      {/* tall mug, dark to the brim */}
      <rect x="20" y="18" width="22" height="30" rx="3" fill="#fff" stroke={LINE} strokeWidth="2.5" />
      <path d="M23 24 h16 v20 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 z" fill={ROAST} />
      <path d="M23 24 h16 v3.5 h-16 z" fill={CREMA} />
      <path d="M42 24 q8 1 6.5 8 q-1.5 6 -8 5.5" fill="none" stroke={LINE} strokeWidth="2.5" />
    </>
  ),
  americano: (
    <>
      <Steam />
      <rect x="20" y="20" width="22" height="28" rx="3" fill="#fff" stroke={LINE} strokeWidth="2.5" />
      <path d="M23 26 h16 v18 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 z" fill="#5d3a22" />
      <path d="M42 26 q8 1 6.5 7.5 q-1.5 6 -8 5.5" fill="none" stroke={LINE} strokeWidth="2.5" />
    </>
  ),
  latte: (
    <>
      {/* tall glass: milk body, coffee band, thin foam cap */}
      <path d="M22 14 h20 l-2.5 36 h-15 z" fill={MILK} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M23.2 22 h17.6 l-0.8 8 h-16 z" fill="#a9713f" />
      <path d="M22.4 15.5 h19.2 l-0.5 5 h-18.2 z" fill={FOAM} />
      <path d="M25.5 34 h13 l-1.5 13 h-10 z" fill={MILK} />
    </>
  ),
  'flat white': (
    <>
      <Steam />
      {/* wide tulip cup, dead-flat surface with a thin crema ring */}
      <path d="M17 26 q0 16 15 16 q15 0 15 -16 z" fill="#fff" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="32" cy="27.5" rx="12.5" ry="2.5" fill={MILK} stroke={CREMA} strokeWidth="2" />
      <Saucer y={48} w={18} />
    </>
  ),
  cappuccino: (
    <>
      {/* the foam dome, with a cocoa dusting */}
      <path d="M19 28 h26 l-3.5 16 h-19 z" fill="#fff" stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M20 28 q3 -9 12 -9 q9 0 12 9 z" fill={FOAM} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <g fill="#8b5e3c">
        <circle cx="27" cy="24" r="1.3" />
        <circle cx="33" cy="22" r="1.3" />
        <circle cx="38" cy="25" r="1.3" />
      </g>
      <path d="M45 30 q6 1 4.5 6 q-1.2 4.5 -6.5 4" fill="none" stroke={LINE} strokeWidth="2.5" />
      <Saucer y={49} w={17} />
    </>
  ),
  mocha: (
    <>
      <Steam />
      {/* mug with a chocolate drizzle over the top */}
      <rect x="20" y="20" width="22" height="28" rx="3" fill="#fff" stroke={LINE} strokeWidth="2.5" />
      <path d="M23 26 h16 v18 a2 2 0 0 1 -2 2 h-12 a2 2 0 0 1 -2 -2 z" fill="#6b4226" />
      <path d="M23 26 h16 v4 h-16 z" fill={FOAM} />
      <path d="M24 24 l3 4 l3 -4 l3 4 l3 -4 l3 4" fill="none" stroke="#3d2412" strokeWidth="2" strokeLinejoin="round" />
      <path d="M42 26 q8 1 6.5 7.5 q-1.5 6 -8 5.5" fill="none" stroke={LINE} strokeWidth="2.5" />
    </>
  ),
  macchiato: (
    <>
      {/* small glass of dark coffee, stained with one drop of milk */}
      <path d="M24 22 h16 l-2 24 h-12 z" fill={ROAST} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M24.7 24 h14.6 l-0.4 4 h-13.8 z" fill={CREMA} />
      <circle cx="32" cy="26" r="3.2" fill={MILK} />
    </>
  ),
  piccolo: (
    <>
      {/* tiny latte glass */}
      <path d="M26 24 h12 l-1.5 22 h-9 z" fill={MILK} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M26.7 28 h10.6 l-0.5 5 h-9.6 z" fill="#a9713f" />
      <path d="M26.3 24.8 h11.4 l-0.3 2.5 h-10.8 z" fill={FOAM} />
    </>
  ),
  cortado: (
    <>
      {/* the even halves: coffee under, milk over, in a straight glass */}
      <path d="M23 20 h18 l-2 26 h-14 z" fill={GLASS} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M23.8 30 h16.4 l-1.3 14 h-13.8 z" fill="#8b5e3c" />
      <path d="M23.4 22 h17.2 l-0.7 8 h-16 z" fill={MILK} />
    </>
  ),
  magic: (
    <>
      {/* double ristretto under, stretched milk over -- and the name
          earns one small star */}
      <path d="M23 22 h18 l-2 24 h-14 z" fill={GLASS} stroke={LINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M23.9 33 h16.2 l-1.2 11 h-13.8 z" fill={ROAST} />
      <path d="M23.4 24 h17.2 l-0.8 9 h-15.6 z" fill={MILK} />
      <path d="M46 14 l1.3 3.2 l3.2 1.3 l-3.2 1.3 l-1.3 3.2 l-1.3 -3.2 l-3.2 -1.3 l3.2 -1.3 z" fill={CREMA} />
    </>
  ),
};

const DrinkIcon = ({ name, size = 56 }) => {
  const key = String(name || '').toLowerCase().trim();
  const art = ART[key];
  if (!art) {
    return <span style={{ fontSize: size * 0.86, lineHeight: 1 }} aria-hidden>{drinkEmoji(name)}</span>;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {art}
    </svg>
  );
};

export default DrinkIcon;
