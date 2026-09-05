import React, { useEffect, useState } from 'react';
import ApiServiceClass from '../../services/ApiService';

// A loud, always-visible heads-up when outbound texts are failing.
//
// Why this exists: at Treenet the outbound SMS path went dark (an eventlet
// DNS failure) and NOBODY knew — guests who chose "text me" never got it and
// coffees sat going cold. The failure was completely silent; it only reached
// the server log.
//
// Why in-app is the RELIABLE channel: in a total outbound outage, email and
// SMS alerts can't leave the box either (they need the network that's down).
// The operator's browser talking to the server is INBOUND, which keeps
// working — so a banner driven by the server's own health is the one signal
// that survives exactly the outage it's warning about.
//
// Reads /api/sms/health (any logged-in user); trips on `outbound_down`
// (>=2 send attempts, 0 delivered = systemic). Self-contained: drop it near
// the top of any operator screen.
const api = new ApiServiceClass();

export default function SmsHealthBanner({ pollMs = 30000 }) {
  const [down, setDown] = useState(false);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const r = await api.get('/sms/health');
        const h = (r && (r.health || r)) || {};
        if (cancelled) return;
        const isDown = !!h.outbound_down;
        setDown(isDown);
        if (isDown) {
          setDetail((Array.isArray(h.problems) && h.problems[0]) || '');
        }
      } catch (e) {
        // A transient fetch error is NOT proof SMS is down (the barista's own
        // connection banner covers "server unreachable"). Leave prior state
        // so we never flash a false alarm.
      }
    };
    check();
    const t = setInterval(check, pollMs);
    return () => { cancelled = true; clearInterval(t); };
  }, [pollMs]);

  if (!down) return null;

  return (
    <div
      role="alert"
      style={{
        background: '#b91c1c',
        color: '#fff',
        padding: '10px 14px',
        textAlign: 'center',
        fontWeight: 700,
        fontSize: 14,
        lineHeight: 1.35,
      }}
    >
      ⚠️ Text messages are NOT sending — anyone who asked for an SMS is not
      getting it. Call names / point people to the board.
      {detail ? (
        <div style={{ fontWeight: 400, fontSize: 12, opacity: 0.9, marginTop: 3 }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}
