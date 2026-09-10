// Reading the notice that is currently up.
//
// One hook, because three very different screens need the same answer and
// none of them should have to think about it: the public board, the beacon
// page in a customer's hand, and the runner's own preview.
//
// It polls, and it listens. Polling is the floor -- a board left running for
// eight hours on a venue's flaky wifi will drop a socket and never notice --
// and the socket is what makes "we've run out of skim" appear within the
// second on a screen someone is looking at right now.
import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const POLL_MS = 20000;

export default function useNotices(surface, stationId) {
  const [notices, setNotices] = useState([]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (surface) qs.set('surface', surface);
      if (stationId) qs.set('station_id', String(stationId));
      const res = await fetch(`/api/notices/active?${qs.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotices(Array.isArray(data.notices) ? data.notices : []);
    } catch (e) {
      // A board that can't reach the server keeps showing coffee. Silence
      // here is deliberate: the alternative is a console full of noise on
      // every venue with a wobbly connection.
    }
  }, [surface, stationId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // Production refuses a socket with no JWT (websocket_routes_fixed.py
    // _extract_role -> None unless TESTING_MODE). Only a signed-in screen --
    // the barista tablet, the runner -- opens one; the public board, the
    // order form and the beacon are served by the 20 s poll above.
    let token = '';
    try { token = localStorage.getItem('coffee_system_token') || ''; } catch (e) { token = ''; }
    if (!token) return undefined;
    let socket;
    try {
      socket = io({ transports: ['websocket', 'polling'], auth: { token } });
      socket.on('notice_update', load);
    } catch (e) {
      // No socket here -- the poll above still gets there.
    }
    return () => { if (socket) socket.close(); };
  }, [load]);

  return notices;
}
