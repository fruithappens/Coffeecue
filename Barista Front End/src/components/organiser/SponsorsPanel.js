import React, { useEffect, useRef, useState } from 'react';
import { UploadCloud, Trash2, ArrowUp, ArrowDown, Save, ExternalLink } from 'lucide-react';

// Sponsors — the logo reel that scrolls across the public display.
//
// Steve (Treenet): upload sponsor logos, reorder them, pick whether the
// ticker sits at the TOP or BOTTOM of the display, and turn the whole
// thing on/off. Self-serve — no redeploy. Logos are downscaled in the
// browser and stored as data URLs (same as the branding logo), read by
// the public display from /api/sponsors.
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

// Downscale an uploaded image to a sensible logo size and return a PNG
// data URL (PNG keeps transparency; the ticker also puts each on a white
// card so logos-on-white still look right). Retina-ish target height.
const fileToLogo = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const targetH = 120; // rendered ~52px; 120 keeps it crisp on 4K
        const maxW = 520;
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

const SponsorsPanel = () => {
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState('bottom');
  const [sponsors, setSponsors] = useState([]);
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
      } catch (e) { /* start empty */ }
      setLoaded(true);
    })();
  }, []);

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
          added.push({
            id: `${Date.now()}-${Math.round(added.length)}-${f.name.replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
            name: f.name.replace(/\.[^.]+$/, '').slice(0, 60),
            image,
          });
        } catch (e) { /* skip a file that won't decode */ }
      }
      if (!added.length) setErr('Those files could not be read as images.');
      setSponsors((prev) => [...prev, ...added].slice(0, 30));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const move = (i, dir) => {
    setSponsors((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (i) => setSponsors((prev) => prev.filter((_, k) => k !== i));
  const rename = (i, name) => setSponsors((prev) => prev.map((s, k) => (k === i ? { ...s, name } : s)));

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/sponsors', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ enabled, position, sponsors }),
      });
      if (r.ok) setSavedAt(new Date());
      else setErr('Save failed — try again.');
    } catch (e) { setErr('Save failed — check your connection.'); }
    finally { setSaving(false); }
  };

  const origin = (typeof window !== 'undefined' && window.location.origin) || '';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
        <h2 className="text-2xl font-bold text-gray-800">Sponsors</h2>
        <a href={`${origin}/tv1`} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1.5 text-sm text-amber-700 hover:text-amber-900">
          <ExternalLink size={15} /> Open the display
        </a>
      </div>
      <p className="text-gray-600 mb-5">
        A scrolling reel of sponsor logos on the public display. Upload logos,
        drag the order with the arrows, pick where it sits, and turn it on.
        Changes reach the display within about 20 seconds — no reload.
      </p>

      {/* Master controls */}
      <div className="bg-white rounded-xl shadow-sm p-4 sm:p-5 mb-4 grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} disabled={!loaded}
            onChange={(e) => setEnabled(e.target.checked)} className="mt-1 w-4 h-4" />
          <span className="text-sm text-gray-700">
            <strong>Show the sponsor ticker</strong>
            <span className="block text-gray-500">Off = nothing shows on the display, even with logos loaded.</span>
          </span>
        </label>
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1.5">Position on the display</div>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {['top', 'bottom'].map((p) => (
              <button key={p} type="button" disabled={!loaded}
                onClick={() => setPosition(p)}
                className={`px-4 py-2 text-sm font-semibold capitalize ${
                  position === p ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        className="bg-white rounded-xl shadow-sm border-2 border-dashed border-gray-300 p-6 text-center mb-4">
        <UploadCloud className="mx-auto text-amber-600 mb-2" size={30} />
        <p className="text-sm text-gray-700 font-medium">Drop logo files here, or</p>
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()}
          disabled={busy}
          className="mt-2 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-semibold disabled:opacity-50">
          {busy ? 'Adding…' : 'Choose logo images'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => addFiles(e.target.files)} />
        <p className="text-xs text-gray-500 mt-3">
          PNG with a transparent background is ideal; JPG/SVG work too. Any size —
          they're resized automatically and shown on white cards at a uniform height.
        </p>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm p-3 sm:p-4 mb-5">
        {sponsors.length === 0 ? (
          <p className="text-center text-gray-400 py-6 text-sm">No logos yet — upload some above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sponsors.map((s, i) => (
              <li key={s.id || i} className="flex items-center gap-3 py-2.5">
                <div className="w-24 h-12 flex items-center justify-center bg-gray-50 rounded border border-gray-200 flex-shrink-0">
                  <img src={s.image} alt={s.name || 'logo'} style={{ maxHeight: 40, maxWidth: 88, objectFit: 'contain' }} />
                </div>
                <input value={s.name || ''} onChange={(e) => rename(i, e.target.value)}
                  placeholder="Sponsor name (optional)"
                  className="flex-1 min-w-0 border border-gray-200 rounded px-2 py-1.5 text-sm" />
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30" title="Move up">
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === sponsors.length - 1}
                    className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30" title="Move down">
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" onClick={() => remove(i)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Remove">
                    <Trash2 size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving || !loaded}
          className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-lg font-semibold disabled:opacity-50">
          <Save size={17} /> {saving ? 'Saving…' : 'Save sponsors'}
        </button>
        {savedAt && <span className="text-sm text-green-700">Saved {savedAt.toLocaleTimeString()} — live on the display shortly.</span>}
        <span className="ml-auto text-xs text-gray-400">{sponsors.length}/30 logos</span>
      </div>
    </div>
  );
};

export default SponsorsPanel;
