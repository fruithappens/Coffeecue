import React, { useMemo } from 'react';

// Horizontal auto-scrolling sponsor logo reel for the public display.
//
// Steve (last-minute for Treenet): a strip of sponsor logos scrolling
// across the display, above OR below the Brewing/Ready sections. The
// position is chosen in the Organiser Sponsors panel; this component just
// renders the reel it's handed and honours which edge it sits on.
//
// Presentational + defensive: given a list of {id, name, image} it renders
// a seamless looping marquee. Logos sit on their own white cards at a
// uniform height, so mixed shapes/backgrounds (transparent PNG, logo-on-
// white, wide vs square) all line up and read as deliberate. Renders
// nothing for an empty list, so the display is never broken by this.
// Three heights (Steve): small = the original strip, medium, and large ≈
// a fifth of the screen. Large uses vh so it scales with the screen.
const SIZES = {
  small: { row: '76px', logo: '52px', maxW: '190px', gap: 40, pad: '8px 18px' },
  medium: { row: '118px', logo: '84px', maxW: '260px', gap: 52, pad: '10px 22px' },
  large: { row: '20vh', logo: '13vh', maxW: '30vw', gap: 64, pad: '1.4vh 2vw' },
};

export default function SponsorTicker({ items = [], position = 'bottom', size = 'small' }) {
  const sz = SIZES[size] || SIZES.small;
  const list = useMemo(
    () => (Array.isArray(items) ? items : []).filter((s) => s && s.image),
    [items],
  );

  // Repeat the set enough times to comfortably overfill the width, kept
  // EVEN so a translateX(-50%) loop is perfectly seamless (the second half
  // is identical to the first, so the wrap is invisible). Speed is held
  // roughly constant regardless of how many logos there are.
  const { loop, duration } = useMemo(() => {
    if (!list.length) return { loop: [], duration: 30 };
    const reps = Math.max(2, Math.ceil(10 / list.length));
    const copies = reps % 2 === 0 ? reps : reps + 1;
    const out = [];
    for (let i = 0; i < copies; i += 1) out.push(...list);
    const secs = Math.min(70, Math.max(18, copies * list.length * 2));
    return { loop: out, duration: secs };
  }, [list]);

  if (!list.length) return null;

  const edgeBorder =
    position === 'top'
      ? { borderBottom: '1px solid rgba(0,0,0,0.08)' }
      : { borderTop: '1px solid rgba(0,0,0,0.08)' };

  return (
    <div
      className="w-full flex-shrink-0"
      style={{ background: 'rgba(255,255,255,0.94)', ...edgeBorder }}
      aria-label="Event sponsors"
    >
      <div className="relative overflow-hidden" style={{ height: sz.row }}>
        <div
          className="absolute top-0 left-0 h-full flex items-center"
          style={{
            gap: sz.gap,
            paddingLeft: 20,
            paddingRight: 20,
            willChange: 'transform',
            animation: `cupqSponsorTicker ${duration}s linear infinite`,
          }}
        >
          {loop.map((s, i) => (
            <div
              key={`${s.id}-${i}`}
              className="flex items-center justify-center"
              style={{
                height: sz.row,
                flex: '0 0 auto',
                background: '#fff',
                borderRadius: 12,
                padding: sz.pad,
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}
            >
              <img
                src={s.image}
                alt={s.name || 'Sponsor'}
                draggable={false}
                style={{ maxHeight: sz.logo, maxWidth: sz.maxW, objectFit: 'contain', display: 'block' }}
              />
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes cupqSponsorTicker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) {
          [aria-label="Event sponsors"] div[style*="cupqSponsorTicker"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
