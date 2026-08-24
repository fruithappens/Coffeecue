// The CupQ marks, drawn as SVG.
//
// Recreated from the supplied artwork rather than embedded from the real
// files, which arrived as flattened images. Two consequences worth being
// honest about: the curves are an approximation of the originals, and if
// the brand is ever refined these will not follow. Dropping the genuine
// SVGs in and replacing the paths here is the better end state -- this
// gets the board looking right in the meantime and is crisp at any size,
// which a screenshot of a logo would not be.
//
// Both take their colours as props so a client running their own palette
// gets a mark that matches their board rather than ours.

import React from 'react';

/**
 * The cup mark: takeaway cup with a speech bubble, and steam.
 *
 * `cup` is the body colour and `accent` the bubble and steam. On the
 * dark brand bar the cup is white, which is why it is a prop and not a
 * constant -- the artwork's near-black would disappear there.
 */
export const CupMark = ({ size = 28, cup = '#FFFFFF', accent = '#C08552',
                          className = '' }) => (
  <svg viewBox="0 0 64 82" width={(size * 64) / 82} height={size}
       className={className} role="img" aria-label="CupQ">
    {/* Steam: three strokes, staggered, so it reads as movement rather
        than as three identical marks. */}
    <g stroke={accent} strokeWidth="4.2" strokeLinecap="round" fill="none">
      <path d="M22 15 C25 11, 19 8, 22 3" />
      <path d="M32 13 C35 9, 29 6, 32 1" />
      <path d="M42 15 C45 11, 39 8, 42 3" />
    </g>
    {/* Lid: two bars, the upper one wider, as in the artwork. */}
    <rect x="8"  y="22" width="48" height="7.5" rx="3.4" fill={cup} />
    <rect x="12" y="32" width="40" height="6.5" rx="3"   fill={cup} />
    {/* Body, tapering to the base. The notch on the lower right is where
        the bubble sits, so the two shapes interlock instead of the
        bubble simply being pasted on top. */}
    <path d="M14 41 H50 L46 76 A4 4 0 0 1 42 79 H22 A4 4 0 0 1 18 76 Z"
          fill={cup} />
    {/* Speech bubble, overlapping the cup's lower right. */}
    <g>
      <circle cx="45" cy="60" r="16" fill={cup} />
      <circle cx="45" cy="60" r="13" fill={accent} />
      <path d="M36 70 L33 79 L44 73 Z" fill={accent} />
      <g fill={cup}>
        <circle cx="38.5" cy="60" r="2.6" />
        <circle cx="45"   cy="60" r="2.6" />
        <circle cx="51.5" cy="60" r="2.6" />
      </g>
    </g>
  </svg>
);

/**
 * The wordmark: motion stripes, then "Cup" and a "Q".
 *
 * The stripes are the reason this is drawn rather than typeset -- they
 * carry the "speed" idea the name plays on, and a text-only version of
 * the logo loses the half that makes it a logo.
 */
export const CupQWordmark = ({ height = 24, word = '#FFFFFF',
                               accent = '#C08552', className = '' }) => (
  <svg viewBox="0 0 260 66" height={height} width={(height * 260) / 66}
       className={className} role="img" aria-label="CupQ">
    {/* Woosh: a dot then three tapering strokes, shortest at the top, so
        the eye reads left-to-right movement into the word. */}
    <g fill={accent}>
      <circle cx="6" cy="24" r="4.5" />
      <rect x="18" y="9"  width="46" height="7.5" rx="3.7" />
      <rect x="4"  y="21" width="60" height="7.5" rx="3.7" />
      <rect x="20" y="33" width="44" height="7.5" rx="3.7" />
      <rect x="34" y="45" width="30" height="7.5" rx="3.7" />
    </g>
    <text x="74" y="52" fontSize="58" fontWeight="800" fill={word}
          fontFamily="Inter, system-ui, -apple-system, Segoe UI, sans-serif"
          letterSpacing="-2">Cup</text>
    <text x="188" y="52" fontSize="58" fontWeight="800" fill={accent}
          fontFamily="Inter, system-ui, -apple-system, Segoe UI, sans-serif"
          letterSpacing="-2">Q</text>
  </svg>
);
