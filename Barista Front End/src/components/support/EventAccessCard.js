import React, { useEffect, useState } from 'react';
import { KeyRound, Save } from 'lucide-react';

/**
 * The event's ordering code (and optional password).
 *
 * Steve: give people cupq.app and "an event code... so it can direct
 * orders to the correct event and possibly stop orders from a phone from
 * a previous event." The code goes in the URL (cupq.app/treenet26) and on
 * the QR; the optional password is the "were you invited" gate.
 *
 * Turning "Require the code" ON invalidates every QR printed WITHOUT it,
 * which is right before an event and wrong mid-event -- so it is opt-in.
 */
const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const EventAccessCard = () => {
  const [code, setCode] = useState('');
  const [require, setRequire] = useState(false);
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/event-access', { headers: authHeaders() });
        const b = r.ok ? await r.json() : {};
        setCode(String(b.code || ''));
        setRequire(!!b.require);
        setPassword(String(b.password || ''));
      } catch (e) { /* fields start blank; save still works */ }
      setLoaded(true);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/event-access', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ code: code.trim(), require, password: password.trim() }),
      });
      if (r.ok) setSavedAt(new Date());
    } finally { setSaving(false); }
  };

  const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://cupq.app';
  const shareUrl = cleanCode ? `${origin.replace(/^https?:\/\//, '')}/${cleanCode}` : '';

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-5 h-5 text-amber-700" />
        <h3 className="text-lg font-semibold">Event code &amp; access</h3>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Give people <strong>cupq.app/yourcode</strong> and they land straight
        on this event's ordering page. Requiring the code stops a QR or phone
        from a previous event ordering into this one.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Event code <span className="text-gray-400 font-normal">— short, no spaces</span>
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. treenet26"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            disabled={!loaded}
          />
          {shareUrl && (
            <div className="mt-2 flex items-center gap-3">
              <img
                src={`/api/qr?size=4&data=${encodeURIComponent(`${origin}/${cleanCode}`)}`}
                alt="Event ordering QR"
                className="w-16 h-16 rounded bg-white border p-1"
              />
              <div className="text-sm">
                <div className="text-gray-500">Share this:</div>
                <div className="font-mono font-semibold break-all">{shareUrl}</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Event password <span className="text-gray-400 font-normal">— optional</span>
          </label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank for no password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2"
            disabled={!loaded}
          />
          <p className="mt-1 text-xs text-gray-500">
            When set (and the code is required), customers must enter this
            before they can order. A simple "were you invited" gate.
          </p>
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={require} onChange={(e) => setRequire(e.target.checked)}
          disabled={!loaded} className="mt-1" />
        <span className="text-sm text-gray-700">
          <strong>Require the code to order.</strong> Turn this ON just before
          the event — it immediately blocks any QR printed without this code.
          {require && !cleanCode && (
            <span className="block text-amber-700 font-semibold">
              No code set yet — ordering stays open until you set one.
            </span>
          )}
        </span>
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving || !loaded}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg font-semibold">
          <Save size={16} /> {saving ? 'Saving…' : 'Save event access'}
        </button>
        {savedAt && (
          <span className="text-sm text-green-700">
            Saved {savedAt.toLocaleTimeString()} — live now
          </span>
        )}
      </div>
    </div>
  );
};

export default EventAccessCard;
