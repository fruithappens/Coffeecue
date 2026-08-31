import React, { useEffect, useMemo, useRef, useState } from 'react';

// Full-screen sponsor wall for a spare screen (or a board takeover).
//
// Steve (Treenet): sponsors grouped into tiers, shown either as a GRID
// (all at once, Platinum on top) or a SCROLL (one tier at a time, each
// lingering for its own dwell time). Adapts to vertical or landscape on
// its own. Public, no login. Reads /api/sponsors (tiers, sponsors, wall
// layout) and /api/display/config (event name + logo for the header).
//
// `embedded` renders without the full-screen chrome, for the board takeover.
export default function SponsorWall({ embedded = false }) {
  const [data, setData] = useState({ sponsors: [], tiers: [], wall: { layout: 'scroll' } });
  const [brand, setBrand] = useState({ event_name: '', logo: '' });

  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const r = await fetch('/api/sponsors', { cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        if (!dead && b && b.success) {
          setData({
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
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await fetch('/api/display/config', { cache: 'no-store' });
        const b = r.ok ? await r.json() : null;
        const c = b && (b.config || b);
        if (!dead && c) setBrand({ event_name: c.event_name || '', logo: c.logo || '' });
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

  return (
    <div style={{
      position: embedded ? 'relative' : 'fixed', inset: 0, width: '100%', height: embedded ? '100%' : '100vh',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'linear-gradient(160deg,#f4faf7 0%,#e9f5ee 100%)', color: '#123',
      fontFamily: 'ui-sans-serif,system-ui,sans-serif',
    }}>
      <header style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '3vh 4vw 1.5vh' }}>
        {brand.logo ? <img src={brand.logo} alt="" style={{ height: '7vh', maxHeight: 84, objectFit: 'contain' }} /> : null}
        <div style={{ textAlign: 'center' }}>
          {brand.event_name ? <div style={{ fontSize: 'clamp(20px,3.2vh,40px)', fontWeight: 800, letterSpacing: '-0.01em' }}>{brand.event_name}</div> : null}
          <div style={{ fontSize: 'clamp(13px,1.8vh,20px)', color: '#0f766e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
            Thank you to our sponsors
          </div>
        </div>
      </header>

      <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
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
function WallGrid({ groups }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '0 4vw 3vh' }}>
      {groups.map((g) => (
        <section key={g.tier.id} style={{ marginBottom: '3vh' }}>
          <h2 style={tierHeadingStyle}>{g.tier.name}</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '1.6vw' }}>
            {g.items.map((s) => <LogoCard key={s.id} s={s} h="9vh" maxH={120} />)}
          </div>
        </section>
      ))}
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
      boxShadow: '0 2px 10px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: `calc(${h} + 2.8vh)`,
    }}>
      <img src={s.image} alt={s.name || 'Sponsor'} style={{ height: h, maxHeight: maxH, maxWidth: '38vw', objectFit: 'contain', display: 'block' }} />
    </div>
  );
}
