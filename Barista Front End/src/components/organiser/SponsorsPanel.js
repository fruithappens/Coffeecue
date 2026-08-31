import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Trash2, ArrowUp, ArrowDown, Save, ExternalLink, Plus, Layers } from 'lucide-react';

// Sponsors — logos, tiers, the scrolling ticker, and the full-screen wall.
//
// Steve (Treenet): upload sponsor logos, group them into tiers you name
// yourself (Platinum/Gold — or Diamond for another event), give each tier
// a dwell time for the scrolling wall, and choose how the wall shows (grid
// vs scroll, and an optional takeover of the main board). Self-serve, no
// redeploy. Read by the public display + beacon from /api/sponsors.
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

// Downscale an uploaded image to a logo-sized PNG data URL (PNG keeps
// transparency; the reel/wall also put logos on white cards).
const fileToLogo = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const targetH = 160; // rendered smaller; 160 stays crisp on 4K walls
        const maxW = 640;
        let h = Math.min(targetH, img.height || targetH);
        let w = Math.round((img.width || h) * (h / (img.height || h)));
        if (w > maxW) { w = maxW; h = Math.round((img.height || 1) * (w / (img.width || 1))); }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        try { resolve(canvas.toDataURL('image/png')); }
        catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const uid = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`;

const SponsorsPanel = () => {
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState('bottom');
  const [sponsors, setSponsors] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [wall, setWall] = useState({ enabled: false, layout: 'scroll', background: 'tint', takeover: false, everySec: 180, forSec: 20 });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/sponsors', { headers: authHeaders() });
        const b = r.ok ? await r.json() : {};
        setEnabled(!!b.enabled);
        setPosition(b.position === 'top' ? 'top' : 'bottom');
        setSponsors(Array.isArray(b.sponsors) ? b.sponsors : []);
        setTiers(Array.isArray(b.tiers) ? b.tiers : []);
        if (b.wall && typeof b.wall === 'object') setWall((w) => ({ ...w, ...b.wall }));
      } catch (e) { /* start empty */ }
      setLoaded(true);
    })();
  }, []);

  // ---- logos --------------------------------------------------------------
  const addFiles = async (fileList) => {
    setErr('');
    const files = [...(fileList || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        try {
          const image = await fileToLogo(f);
          added.push({ id: uid('s'), name: f.name.replace(/\.[^.]+$/, '').slice(0, 60), image, tier: (tiers[0] && tiers[0].id) || '' });
        } catch (e) { /* skip */ }
      }
      if (!added.length) setErr('Those files could not be read as images.');
      setSponsors((prev) => [...prev, ...added].slice(0, 30));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const moveSponsor = (i, dir) => setSponsors((prev) => {
    const next = [...prev]; const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const removeSponsor = (i) => setSponsors((prev) => prev.filter((_, k) => k !== i));
  const patchSponsor = (i, patch) => setSponsors((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  // ---- tiers --------------------------------------------------------------
  const addTier = () => setTiers((prev) => [...prev, { id: uid('t'), name: '', dwell: 5 }]);
  const patchTier = (i, patch) => setTiers((prev) => prev.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const moveTier = (i, dir) => setTiers((prev) => {
    const next = [...prev]; const j = i + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const removeTier = (i) => setTiers((prev) => prev.filter((_, k) => k !== i));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const cleanTiers = tiers.filter((t) => (t.name || '').trim());
      const r = await fetch('/api/sponsors', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ enabled, position, sponsors, tiers: cleanTiers, wall }),
      });
      if (r.ok) setSavedAt(new Date()); else setErr('Save failed — try again.');
    } catch (e) { setErr('Save failed — check your connection.'); }
    finally { setSaving(false); }
  };

  const origin = (typeof window !== 'undefined' && window.location.origin) || '';
  const tierName = (id) => (tiers.find((t) => t.id === id) || {}).name || '';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h2 className="text-2xl font-bold text-gray-800">Sponsors</h2>
        <div className="flex items-center gap-4 text-sm">
          <a href={`${origin}/tv1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-amber-700 hover:text-amber-900"><ExternalLink size={15} /> Display</a>
          <a href={`${origin}/sponsors`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-amber-700 hover:text-amber-900"><ExternalLink size={15} /> Sponsor wall</a>
        </div>
      </div>
      <p className="text-gray-600 mb-5">
        Logos, tiers, the scrolling ticker and the full-screen wall — all in one place.
        Changes reach the screens within about 20 seconds, no reload.
      </p>

      {/* Ticker controls */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 mb-4 grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={!loaded} onChange={(e) => setEnabled(e.target.checked)} className="mt-1 w-4 h-4" />
          <span className="text-sm text-gray-700">
            <strong>Scrolling ticker</strong>
            <span className="block text-gray-500">A strip of logos on the display and the customer beacon.</span>
          </span>
        </label>
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1.5">Ticker position (display)</div>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {['top', 'bottom'].map((p) => (
              <button key={p} type="button" disabled={!loaded} onClick={() => setPosition(p)}
                className={`px-4 py-2 text-sm font-semibold capitalize ${position === p ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Tiers */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 mb-4">
        <div className="flex items-center gap-2 mb-1"><Layers size={18} className="text-amber-700" /><h3 className="font-semibold text-gray-800">Tiers</h3></div>
        <p className="text-sm text-gray-500 mb-3">
          Name your own tiers (Platinum, Gold… or Diamond) and order them top to bottom.
          <strong> Dwell</strong> is how long that tier lingers in the scrolling wall.
        </p>
        {tiers.length === 0 && <p className="text-sm text-gray-400 mb-3">No tiers yet — add Platinum, Gold, etc.</p>}
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={t.id || i} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
              <input value={t.name || ''} onChange={(e) => patchTier(i, { name: e.target.value })}
                placeholder="Tier name (e.g. Platinum)" className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm" />
              <div className="flex items-center gap-1">
                <input type="number" min="1" max="60" value={t.dwell}
                  onChange={(e) => patchTier(i, { dwell: e.target.value })}
                  className="w-16 border border-gray-200 rounded px-2 py-1.5 text-sm text-right" />
                <span className="text-xs text-gray-500">sec</span>
              </div>
              <button type="button" onClick={() => moveTier(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowUp size={15} /></button>
              <button type="button" onClick={() => moveTier(i, 1)} disabled={i === tiers.length - 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowDown size={15} /></button>
              <button type="button" onClick={() => removeTier(i)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addTier} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 hover:text-amber-900"><Plus size={16} /> Add tier</button>
      </div>

      {/* Upload */}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-6 text-center mb-4">
        <UploadCloud className="mx-auto text-amber-600 mb-2" size={30} />
        <p className="text-sm text-gray-700 font-medium">Drop logo files here, or</p>
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
          className="mt-2 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50">
          {busy ? 'Adding…' : 'Choose logo images'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        <p className="text-xs text-gray-500 mt-3">PNG with a transparent background is ideal; JPG/SVG work too. Auto-resized and shown on white cards.</p>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {/* Sponsor list */}
      <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 mb-4">
        {sponsors.length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">No logos yet — upload some above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sponsors.map((s, i) => (
              <li key={s.id || i} className="flex items-center gap-3 py-2.5">
                <div className="w-24 h-12 flex items-center justify-center bg-gray-50 rounded border border-gray-200 flex-shrink-0">
                  <img src={s.image} alt={s.name || 'logo'} style={{ maxHeight: 40, maxWidth: 88, objectFit: 'contain' }} />
                </div>
                <input value={s.name || ''} onChange={(e) => patchSponsor(i, { name: e.target.value })} placeholder="Name (optional)"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm" />
                <select value={s.tier || ''} onChange={(e) => patchSponsor(i, { tier: e.target.value })}
                  className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white flex-shrink-0" title="Tier">
                  <option value="">— tier —</option>
                  {tiers.filter((t) => (t.name || '').trim()).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => moveSponsor(i, -1)} disabled={i === 0} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowUp size={16} /></button>
                  <button type="button" onClick={() => moveSponsor(i, 1)} disabled={i === sponsors.length - 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"><ArrowDown size={16} /></button>
                  <button type="button" onClick={() => removeSponsor(i)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Wall settings */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 mb-5">
        <h3 className="font-semibold text-gray-800 mb-1">Full-screen sponsor wall</h3>
        <p className="text-sm text-gray-500 mb-4">Open <code>{origin.replace(/^https?:\/\//, '')}/sponsors</code> on any screen (vertical or landscape — it adapts).</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1.5">Layout</div>
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              {[['scroll', 'Scroll'], ['grid', 'Grid']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setWall((w) => ({ ...w, layout: v }))}
                  className={`px-4 py-2 text-sm font-semibold ${wall.layout === v ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">{wall.layout === 'grid' ? 'All logos at once, grouped by tier (Platinum on top).' : 'One tier at a time, lingering by each tier’s dwell time.'}</p>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-700 mb-1.5">Background</div>
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              {[['tint', 'Soft tint'], ['white', 'White'], ['branded', 'Event-branded']].map(([v, label]) => (
                <button key={v} type="button" onClick={() => setWall((w) => ({ ...w, background: v }))}
                  className={`px-3 py-2 text-sm font-semibold ${wall.background === v ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{label}</button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">“Event-branded” reuses your uploaded display background image (falls back to the tint if none is set).</p>
          </div>
          <div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={wall.takeover} onChange={(e) => setWall((w) => ({ ...w, takeover: e.target.checked }))} className="mt-1 w-4 h-4" />
              <span className="text-sm text-gray-700"><strong>Take over the main board</strong>
                <span className="block text-gray-500">The order board flips to the wall now and then, then back.</span></span>
            </label>
            {wall.takeover && (
              <div className="mt-2 flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                every <input type="number" min="15" max="3600" value={wall.everySec} onChange={(e) => setWall((w) => ({ ...w, everySec: e.target.value }))} className="w-20 border border-gray-200 rounded px-2 py-1 text-right" /> sec,
                for <input type="number" min="3" max="600" value={wall.forSec} onChange={(e) => setWall((w) => ({ ...w, forSec: e.target.value }))} className="w-16 border border-gray-200 rounded px-2 py-1 text-right" /> sec
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !loaded} className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg font-semibold disabled:opacity-50">
          <Save size={17} /> {saving ? 'Saving…' : 'Save sponsors'}
        </button>
        {savedAt && <span className="text-sm text-green-700">Saved {savedAt.toLocaleTimeString()} — live shortly.</span>}
        <span className="ml-auto text-xs text-gray-400">{sponsors.length}/30 logos · {tiers.filter((t) => (t.name || '').trim()).length} tiers</span>
      </div>
      {sponsors.some((s) => !s.tier) && tiers.length > 0 && (
        <p className="text-xs text-amber-700 mt-2">Some logos have no tier — they’ll show in an “Other” group on the wall.</p>
      )}
    </div>
  );
};

export default SponsorsPanel;
