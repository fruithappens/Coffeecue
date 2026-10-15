// DeviceSetupPage.js — /setup/<code>: a tablet scans a QR and becomes a
// barista screen (roadmap H5-3).
//
// The code was made by a manager in Runner > Screens for one barista login
// and one station. It works once and expires in minutes; the server trades
// it for a normal sign-in, which is stored exactly as a login would be.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import AuthService from '../../services/AuthService';

// One claim per code, however many times the page mounts (React's dev
// mode mounts twice; a one-time code can't survive a second try).
const claims = new Map();
function claimOnce(code) {
  if (!claims.has(code)) {
    claims.set(code, fetch('/api/devices/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }).then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })));
  }
  return claims.get(code);
}

const DeviceSetupPage = () => {
  const { code } = useParams();
  const [state, setState] = useState({ phase: 'working', message: '' });

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { ok, body: b } = await claimOnce(code);
        if (dead) return;
        if (!ok || !b.success) {
          setState({ phase: 'failed', message: b.message || "That setup code didn't work." });
          return;
        }
        AuthService.adoptSession(b, b.user && b.user.username, { redirect: false });
        try {
          localStorage.setItem('coffee_cue_selected_station', String(b.station_id));
          localStorage.setItem('last_used_station_id', String(b.station_id));
        } catch (e) { /* the station can still be picked on the screen */ }
        setState({ phase: 'done', message: `Signed in as ${b.user.username}, station ${b.station_id}.` });
        window.location.replace(b.redirect || '/barista');
      } catch (e) {
        if (!dead) setState({ phase: 'failed', message: 'No connection. Check the wifi and scan again.' });
      }
    })();
    return () => { dead = true; };
  }, [code]);

  return (
    <div className="cq min-h-screen bg-cq-cream flex items-center justify-center p-6">
      <div className="bg-cq-milk rounded-cq-xl shadow-cq-card p-8 max-w-md text-center">
        <h1 className="text-2xl font-extrabold text-cq-roast">
          {state.phase === 'failed' ? "Couldn't set up this device" : 'Setting up this device…'}
        </h1>
        <p className="mt-3 text-cq-ink-2">{state.message || 'One moment.'}</p>
      </div>
    </div>
  );
};

export default DeviceSetupPage;
