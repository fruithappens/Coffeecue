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
export default function SponsorTicker({ items = [], position = 'bottom' }) {
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
      <div className="relative overflow-hidden" style={{ height: 76 }}>
        <div
          className="absolute top-0 left-0 h-full flex items-center"
          style={{
            gap: 40,
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
                height: 76,
                flex: '0 0 auto',
                background: '#fff',
                borderRadius: 12,
                padding: '8px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              }}
            >
              <img
                src={s.image}
                alt={s.name || 'Sponsor'}
                draggable={false}
                style={{ maxHeight: 52, maxWidth: 190, objectFit: 'contain', display: 'block' }}
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
