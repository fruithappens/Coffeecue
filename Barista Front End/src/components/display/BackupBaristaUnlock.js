// BackupBaristaUnlock.js — the ordering iPad becomes a barista station.
//
// Steve: "Behind an unlock code, so a spare device becomes the backup if
// the main one dies. Right now a single failure has no fallback."
//
// Two things this component is deliberately NOT:
//
// It is not a secret. Anyone can read this file, find the corner and
// see the dialog. That is fine, because the code is checked on the
// SERVER — hiding the button is convenience for the customer, not
// security. A gate that only exists in the browser is a gate anyone can
// walk around by opening dev tools.
//
// It is not a shortcut for a barista who has a login. It exists for the
// moment the main device is dead and nobody can remember the password
// for the spare one, which is a real five minutes at a real event.
//
// The gesture is a long press in the BOTTOM-LEFT corner: nothing else
// lives there on the ordering screen, and a customer who brushes it does
// nothing at all, because a tap is not a hold.
import React, { useCallback, useEffect, useRef, useState } from 'react';

const HOLD_MS = 2500;

const BackupBaristaUnlock = () => {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  useEffect(() => clear, [clear]);

  const startHold = () => {
    clear();
    timer.current = setTimeout(() => setOpen(true), HOLD_MS);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/station-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A stable-ish per-device id so one iPad being hammered in a
        // corner cannot throttle the barista trying to bring up the
        // real spare. The server throttles globally as well, so this
        // being forgeable costs nothing.
        body: JSON.stringify({ code, device: deviceId() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success || !d?.token) {
        setError(d?.message || 'That did not work.');
        setBusy(false);
        return;
      }
      localStorage.setItem('coffee_system_token', d.token);
      localStorage.setItem('coffee_system_user', JSON.stringify(d.user || {}));
      if (d.refreshToken) {
        localStorage.setItem('coffee_system_refresh_token', d.refreshToken);
      }
      // A full load rather than a route change: this page was running as
      // an anonymous customer, and every service that cached "no session"
      // needs to start again knowing there is one.
      window.location.assign('/barista');
    } catch (err) {
      setError('No connection.');
      setBusy(false);
    }
  };

  return (
    <>
      {/* The hotspot. Transparent, small, and in a corner the ordering
          screen never puts a control in. aria-hidden because a customer
          using a screen reader should not be offered it at all. */}
      <div
        aria-hidden="true"
        onPointerDown={startHold}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed', left: 0, bottom: 0, width: 44, height: 44,
          // Above the kiosk order card, which is a full-screen z-50
          // overlay. At z-40 this sat underneath it and the long press
          // never reached the handler -- invisible, because the element
          // was there and correct in every other respect. 44px keeps it
          // inside the card's own margin so it cannot clip a drink tile.
          zIndex: 60, background: 'transparent', touchAction: 'none',
        }}
      />
      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(15,23,42,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onSubmit={submit}
            style={{
              background: '#fff', borderRadius: 12, padding: 20,
              width: '100%', maxWidth: 360,
              boxShadow: '0 20px 40px rgba(0,0,0,0.35)',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              Use this device as a barista station
            </h2>
            <p style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
              For when the main screen is down. Ask whoever set up the event
              for the code.
            </p>
            <input
              type="password"
              inputMode="text"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Unlock code"
              style={{
                width: '100%', border: '1px solid #cbd5e1', borderRadius: 8,
                padding: '10px 12px', fontSize: 16, marginBottom: 10,
              }}
            />
            {error && (
              <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setOpen(false); setCode(''); setError(''); }}
                style={{
                  padding: '9px 14px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: '#fff', fontSize: 14,
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !code}
                style={{
                  padding: '9px 14px', borderRadius: 8, border: 0,
                  background: busy || !code ? '#94a3b8' : '#1f2a37',
                  color: '#fff', fontSize: 14,
                }}
              >
                {busy ? 'Checking…' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

// A per-browser id, invented once and kept. Not an identity and not
// trusted as one — it only separates one iPad's failed attempts from
// another's so a single jammed device cannot lock out the rest.
function deviceId() {
  const KEY = 'coffee_cue_device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return 'no-storage';
  }
}

export default BackupBaristaUnlock;
