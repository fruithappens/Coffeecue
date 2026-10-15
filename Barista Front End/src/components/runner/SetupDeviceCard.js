// SetupDeviceCard.js — Runner > Screens: one QR sets up a device (H5-3).
//
// Board and kiosk need no login: their QR is just their address, with the
// station. A barista screen gets a one-time code for a chosen barista login
// and station (works once, expires in 10 minutes), drawn by the server.
import React, { useEffect, useState } from 'react';
import { QrCode } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import useStations from '../../hooks/useStations';

const api = new ApiServiceClass();
const KINDS = [
  { id: 'barista', label: 'Barista screen' },
  { id: 'kiosk', label: 'Kiosk' },
  { id: 'board', label: 'Board (TV)' },
];

const SetupDeviceCard = () => {
  const { stations } = useStations();
  const [kind, setKind] = useState('barista');
  const [station, setStation] = useState('');
  const [baristas, setBaristas] = useState([]);
  const [userId, setUserId] = useState('');
  const [made, setMade] = useState(null);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/users');
        const list = (r && (r.users || r.data)) || (Array.isArray(r) ? r : []);
        setBaristas(list.filter((u) => String(u.role || '').toLowerCase() === 'barista'));
      } catch (e) { setBaristas([]); }
    })();
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const sid = station || (stations[0] && stations[0].id) || '';

  const make = async () => {
    setMsg(''); setMade(null);
    if (kind !== 'barista') {
      const path = kind === 'kiosk' ? `/display?kiosk=1&station=${sid}` : `/display?mode=pickup&station=${sid}`;
      const url = `${window.location.origin}${path}`;
      setMade({ url, qr: `/api/qr?size=8&data=${encodeURIComponent(url)}` });
      return;
    }
    if (!userId) { setMsg('Choose the barista login this tablet will use.'); return; }
    try {
      const r = await api.post('/devices/setup-codes', { station_id: sid, user_id: userId, origin: window.location.origin });
      if (!r || r.success === false) { setMsg((r && r.message) || "Couldn't make a code."); return; }
      setMade(r);
    } catch (e) { setMsg((e && e.message) || "Couldn't make a code."); }
  };

  const left = made && made.expires_at ? Math.max(0, Math.round((new Date(made.expires_at) - now) / 1000)) : null;
  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-5 mb-4">
      <h2 className="text-xl font-extrabold text-cq-roast flex items-center gap-2"><QrCode size={22} /> Set up a device</h2>
      <p className="text-sm text-cq-ink-2 mt-1">Open the camera on the tablet or TV, scan the code, and it becomes that screen.</p>
      <div className="mt-4 flex flex-wrap gap-3 items-end">
        <div className="flex gap-1 bg-cq-wash rounded-cq-md p-1">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => { setKind(k.id); setMade(null); }}
              className={`px-3 py-2 rounded-cq-md text-sm font-bold ${kind === k.id ? 'bg-cq-roast text-cq-cream' : 'text-cq-ink-2'}`}>{k.label}</button>
          ))}
        </div>
        <label className="text-sm"><span className="block text-xs font-bold text-cq-ink-3 uppercase">Station</span>
          <select value={sid} onChange={(e) => { setStation(e.target.value); setMade(null); }}
            className="mt-1 border-2 border-cq-line rounded-cq-md bg-white px-2 py-2">
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name || `Station ${s.id}`}</option>)}
          </select>
        </label>
        {kind === 'barista' && (
          <label className="text-sm"><span className="block text-xs font-bold text-cq-ink-3 uppercase">Barista login</span>
            <select value={userId} onChange={(e) => { setUserId(e.target.value); setMade(null); }}
              className="mt-1 border-2 border-cq-line rounded-cq-md bg-white px-2 py-2">
              <option value="">Choose…</option>
              {baristas.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select>
          </label>
        )}
        <button type="button" onClick={make} className="h-11 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold">Show the code</button>
      </div>
      {kind === 'barista' && baristas.length === 0 && (
        <p className="mt-2 text-sm text-cq-ink-3">No barista logins yet: add one under People.</p>
      )}
      {msg && <p className="mt-2 text-sm font-semibold text-cq-alert" role="alert">{msg}</p>}
      {made && (
        <div className="mt-4 flex flex-wrap gap-5 items-center">
          <img src={made.qr} alt="Scan to set up this device" className="w-48 h-48 bg-white rounded-cq-md border border-cq-line p-2" />
          <div className="text-sm text-cq-ink-2 min-w-0">
            {kind === 'barista' ? (
              <>
                <p>Signs the tablet in as <b>{made.username}</b> at station {made.station_id}.</p>
                <p className="mt-1">{left > 0 ? `Works once, for the next ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.` : 'Expired: make a new one.'}</p>
              </>
            ) : (
              <p className="break-all">{made.url}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupDeviceCard;
