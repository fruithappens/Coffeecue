import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

// Full-screen sponsor wall for a spare screen (or a board takeover).
//
// Steve (Treenet): sponsors grouped into tiers, shown either as a GRID
// (all at once, Platinum on top) or a SCROLL (one tier at a time, each
// lingering for its own dwell time). Adapts to vertical or landscape on
// its own. Public, no login. Reads /api/sponsors (tiers, sponsors, wall
// layout) and /api/display/config (event name + logo for the header).
//
// `embedded` renders without the full-screen chrome, for the board takeover.
export default function SponsorWall({ embedded = false, preview = null }) {
  const [fetched, setFetched] = useState({ sponsors: [], tiers: [], wall: { layout: 'scroll', background: 'tint' } });
  // Preview mode (the Sponsors panel) feeds unsaved state straight in.
  const data = preview || fetched;
  const [brand, setBrand] = useState({ event_name: '', logo: '', bgP: '', bgL: '' });
  const [portrait, setPortrait] = useState(
    typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : false,
  );
  useEffect(() => {
    const onResize = () => setPortrait(window.innerHeight >= window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (preview) return undefined; // preview: use props, don't poll
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch('/api/sponsors', { cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        if (!dead && b && b.success) {
          setFetched({
            sponsors: Array.isArray(b.sponsors) ? b.sponsors : [],
            tiers: Array.isArray(b.tiers) ? b.tiers : [],
            wall: b.wall && typeof b.wall === 'object' ? b.wall : { layout: 'scroll' },
          });
        }
      } catch (e) { /* keep last */ }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { dead = true; clearInterval(t); };
  }, [preview]);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config', { cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        const c = b && (b.config || b);
        if (!dead && c) setBrand({
          event_name: c.event_name || '', logo: c.logo || '',
          bgP: c.background_portrait || '', bgL: c.background_landscape || '',
        });
      } catch (e) { /* header just omits branding */ }
    })();
    return () => { dead = true; };
  }, []);

  // Group sponsors by tier, in tier order; untiered fall into "Other".
  const groups = useMemo(() => {
    const byTier = new Map();
    (data.tiers || []).forEach((t) => byTier.set(t.id, { tier: t, items: [] }));
    const other = { tier: { id: '__other', name: 'Our Supporters', dwell: 5 }, items: [] };
    (data.sponsors || []).filter((s) => s && s.image).forEach((s) => {
      const g = byTier.get(s.tier);
      if (g) g.items.push(s); else other.items.push(s);
    });
    const out = [...byTier.values()].filter((g) => g.items.length);
    if (other.items.length) out.push(other);
    return out;
  }, [data]);

  const layout = data.wall && data.wall.layout === 'grid' ? 'grid' : 'scroll';

  // Backdrop: white (logos pop), branded (the display's uploaded background
  // image — with a soft white scrim so headings + white cards still read),
  // or the default soft-green tint.
  const wallBg = (data.wall && data.wall.background) || 'tint';
  const bgImg = portrait ? brand.bgP : brand.bgL;
  const branded = wallBg === 'branded' && !!bgImg;
  const bgStyle = wallBg === 'white'
    ? { background: '#ffffff' }
    : branded
      ? { backgroundImage: `url("${bgImg}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundColor: '#0b3d2e' }
      : { background: 'linear-gradient(160deg,#f4faf7 0%,#e9f5ee 100%)' };

  return (
    <div style={{
      position: embedded ? 'relative' : 'fixed', inset: 0, width: '100%', height: embedded ? '100%' : '100vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      color: '#123', fontFamily: 'ui-sans-serif,system-ui,sans-serif',
      ...bgStyle,
    }}>
      {/* Soft scrim over a branded photo so tier headings + white cards stay legible. */}
      {branded && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.45)', pointerEvents: 'none' }} />}
      <header style={{ position: 'relative', zIndex: 1, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '3vh 4vw 1.5vh' }}>
        {brand.logo ? <img src={brand.logo} alt="" style={{ height: '7vh', maxHeight: 84, objectFit: 'contain' }} /> : null}
        <div style={{ textAlign: 'center' }}>
          {brand.event_name ? <div style={{ fontSize: 'clamp(20px,3.2vh,40px)', fontWeight: 800, letterSpacing: '-0.01em' }}>{brand.event_name}</div> : null}
          <div style={{ fontSize: 'clamp(13px,1.8vh,20px)', color: '#0f766e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            Thank you to our sponsors
          </div>
        </div>
      </header>

      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative', zIndex: 1 }}>
        {groups.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 'clamp(14px,2vh,22px)' }}>
            No sponsors added yet.
          </div>
        ) : layout === 'grid' ? (
          <WallGrid groups={groups} />
        ) : (
          <WallScroll groups={groups} />
        )}
      </div>
    </div>
  );
}

// --- GRID: every tier at once, Platinum on top, logos equal size --------
// Scales the whole grid down to fit the screen so nothing clips, however
// many sponsors there are (Steve's find: it was overflowing + cutting off).
function WallGrid({ groups }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const outer = outerRef.current, inner = innerRef.current;
      if (!outer || !inner) return;
      // scrollHeight/Width are the UNSCALED layout size (transforms don't
      // change layout), so this stays correct across re-fits.
      const naturalH = inner.scrollHeight;
      const naturalW = inner.scrollWidth;
      if (!naturalH || !naturalW) return;
      const s = Math.min(1, outer.clientHeight / naturalH, outer.clientWidth / naturalW);
      setScale(s > 0 ? s : 1);
    };
    fit();
    const t1 = setTimeout(fit, 200);
    const t2 = setTimeout(fit, 800);
    window.addEventListener('resize', fit);
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('resize', fit); };
  }, [groups]);
  // Consecutive 'compact' tiers share one row (each becomes a column), so
  // single-logo tiers like Coffee + Dinner sit side by side instead of each
  // eating a full row. Non-compact tiers stay full-width.
  const rows = [];
  let run = [];
  groups.forEach((g) => {
    if (g.tier.compact) { run.push(g); return; }
    if (run.length) { rows.push({ type: 'compact', groups: run }); run = []; }
    rows.push({ type: 'full', group: g });
  });
  if (run.length) rows.push({ type: 'compact', groups: run });

  return (
    <div ref={outerRef} style={{ height: '100%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div ref={innerRef} style={{ width: '100%', transform: `scale(${scale})`, transformOrigin: 'center center', padding: '0 3vw' }}>
        {rows.map((row, ri) => (row.type === 'full' ? (
          <section key={row.group.tier.id} style={{ marginBottom: '3vh' }}>
            <h2 style={tierHeadingStyle}>{row.group.tier.name}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.6vw' }}>
              {row.group.items.map((s) => <LogoCard key={s.id} s={s} h="9vh" maxH={120} />)}
            </div>
          </section>
        ) : (
          <div key={`compact-${ri}`} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '4vw', marginBottom: '3vh' }}>
            {row.groups.map((g) => (
              <section key={g.tier.id} style={{ textAlign: 'center' }}>
                <h2 style={{ ...tierHeadingStyle, margin: '0 0 1.2vh' }}>{g.tier.name}</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.2vw' }}>
                  {g.items.map((s) => <LogoCard key={s.id} s={s} h="7.5vh" maxH={100} />)}
                </div>
              </section>
            ))}
          </div>
        )))}
      </div>
    </div>
  );
}

// --- SCROLL: one tier at a time, lingering by its dwell time ------------
function WallScroll({ groups }) {
  const [idx, setIdx] = useState(0);
  const [show, setShow] = useState(true);
  const timer = useRef(null);

  useEffect(() => {
    setShow(true);
    const g = groups[idx % groups.length];
    const dwell = Math.max(2, Number(g && g.tier && g.tier.dwell) || 5) * 1000;
    clearTimeout(timer.current);
    // fade out just before advancing
    const fade = setTimeout(() => setShow(false), Math.max(400, dwell - 450));
    timer.current = setTimeout(() => setIdx((i) => (i + 1) % groups.length), dwell);
    return () => { clearTimeout(timer.current); clearTimeout(fade); };
  }, [idx, groups]);

  const g = groups[idx % groups.length];
  if (!g) return null;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 4vw 3vh' }}>
      <div style={{ transition: 'opacity .45s ease', opacity: show ? 1 : 0, width: '100%', textAlign: 'center' }}>
        <h2 style={{ ...tierHeadingStyle, fontSize: 'clamp(22px,4vh,52px)', marginBottom: '3vh' }}>{g.tier.name}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '2vw' }}>
          {g.items.map((s) => <LogoCard key={s.id} s={s} h="16vh" maxH={220} />)}
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '2.5vh', display: 'flex', gap: 8 }}>
        {groups.map((gg, i) => (
          <span key={gg.tier.id} style={{ width: 10, height: 10, borderRadius: '50%', background: i === (idx % groups.length) ? '#0f766e' : 'rgba(15,118,110,0.25)' }} />
        ))}
      </div>
    </div>
  );
}

const tierHeadingStyle = {
  textAlign: 'center', fontSize: 'clamp(15px,2.4vh,30px)', fontWeight: 800,
  color: '#0f766e', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '1.6vh 0',
};

function LogoCard({ s, h, maxH }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '1.4vh 2vw',
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.06)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: `calc(${h} + 2.8vh)`,
    }}>
      <img src={s.image} alt={s.name || 'Sponsor'} style={{ height: h, maxHeight: maxH, maxWidth: '38vw', objectFit: 'contain', display: 'block' }} />
    </div>
  );
}
