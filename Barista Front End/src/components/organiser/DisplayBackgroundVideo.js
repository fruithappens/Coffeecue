import React, { useEffect, useState } from 'react';
import { Upload, Film, Save } from 'lucide-react';

// Display background VIDEO (Steve): a gentle looping animation behind the
// board, most visible when there are no orders. Portrait (9:16) + landscape
// (16:9); the display plays the one matching its own orientation. Each can
// be a short uploaded clip (stored as a data URL) or a hosted URL (best for
// anything HD/long). Self-contained — its own load/save on /api/display/bg-video,
// kept off the branding blob because the clips are large.
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});
const MAX_BYTES = 9 * 1024 * 1024; // ~9MB — bigger should be a URL

const fileToDataUrl = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload = () => res(r.result);
    r.readAsDataURL(file);
  });

const FIELDS = [
  { k: 'landscape', label: 'Landscape 16:9 (horizontal screen)', box: 'h-20 w-36' },
  { k: 'portrait', label: 'Portrait 9:16 (vertical screen)', box: 'h-32 w-20' },
];

export default function DisplayBackgroundVideo() {
  const [vid, setVid] = useState({ portrait: '', landscape: '' });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/display/bg-video', { headers: authHeaders() });
        const b = r.ok ? await r.json() : {};
        setVid({ portrait: b.portrait || '', landscape: b.landscape || '' });
      } catch (e) { /* start empty */ }
      setLoaded(true);
    })();
  }, []);

  const onUpload = (key) => async (e) => {
    setErr('');
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!/^video\//.test(f.type)) { setErr('Please choose a video file (MP4 or WebM).'); return; }
    if (f.size > MAX_BYTES) {
      setErr(`That clip is ${(f.size / 1024 / 1024).toFixed(1)}MB — too big to store here (max ~9MB). Compress it / keep it short, or paste a hosted URL instead.`);
      return;
    }
    try { const dataUrl = await fileToDataUrl(f); setVid((v) => ({ ...v, [key]: dataUrl })); }
    catch (er) { setErr('Could not read that file.'); }
    if (e.target) e.target.value = '';
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/display/bg-video', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(vid) });
      if (r.ok) setSavedAt(new Date());
      else setErr('Save failed — the clip may be too large; try a hosted URL instead.');
    } catch (e) { setErr('Save failed — check your connection.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="md:col-span-2 border-t pt-4 mt-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
        <Film size={14} /> Display background video (optional)
      </p>
      <p className="text-xs text-gray-500 mb-3">
        A gentle looping animation behind the board — most eye-catching when there
        are no orders. Plays muted &amp; looped; the display picks portrait or
        landscape by its own orientation. <strong>Keep uploads short &amp; compressed (≤9MB)</strong> —
        for a longer/HD loop, host it and paste the URL. A video overrides the background image.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map(({ k, label, box }) => (
          <div key={k} className="border border-gray-200 rounded-lg p-3">
            <p className="text-xs font-medium text-gray-600 mb-2">{label}</p>
            <div className="flex items-start gap-3">
              {vid[k] ? (
                <video src={vid[k]} className={`${box} object-cover border border-gray-200 rounded bg-black`} muted loop autoPlay playsInline />
              ) : (
                <div className={`${box} flex items-center justify-center border border-dashed border-gray-300 rounded text-xs text-gray-400 text-center`}>No video</div>
              )}
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <label className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center cursor-pointer text-sm w-fit">
                  <Upload className="mr-2" size={16} /> {vid[k] ? 'Replace' : 'Upload'}
                  <input type="file" accept="video/*" onChange={onUpload(k)} className="hidden" />
                </label>
                <input
                  value={/^data:/.test(vid[k]) ? '' : (vid[k] || '')}
                  onChange={(e) => setVid((v) => ({ ...v, [k]: e.target.value }))}
                  placeholder="…or paste a video URL (mp4/webm)"
                  className="border border-gray-200 rounded px-2 py-1.5 text-sm w-full"
                />
                {vid[k] && (
                  <button type="button" onClick={() => setVid((v) => ({ ...v, [k]: '' }))} className="text-xs text-red-600 hover:underline w-fit">Remove</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={save} disabled={saving || !loaded}
          className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50">
          <Save size={15} /> {saving ? 'Saving…' : 'Save background video'}
        </button>
        {savedAt && <span className="text-sm text-green-700">Saved — reload the display to see it.</span>}
      </div>
    </div>
  );
}
