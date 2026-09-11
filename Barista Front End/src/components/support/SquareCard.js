// Square, for the events that take money.
//
// The operator connects THEIR Square account once (OAuth in a new tab,
// never Steve's account), picks the location the payments land in, and
// from then on every priced order gets a Square-hosted pay link on the
// beacon and in the ready text, and Square's webhook marks it paid.
//
// Three states, plainly said: not set up on this server (Steve has not
// registered a Square app -- nothing an operator can do), set up but not
// connected (the Connect button), connected (where, and Disconnect).
import React, { useEffect, useState } from 'react';
import { CreditCard, Link2, Unplug, RefreshCw } from 'lucide-react';
import { Panel, SettingRow, SelectRow, Button, Status, SettingNote } from '../../design';

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const SquareCard = () => {
  const [st, setSt] = useState(null);
  const [locations, setLocations] = useState([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = async () => {
    try {
      const r = await fetch('/api/square/status', { headers: authHeaders() });
      const b = r.ok ? await r.json() : null;
      setSt(b);
      if (b && b.connected) {
        const lr = await fetch('/api/square/locations', { headers: authHeaders() });
        const lb = lr.ok ? await lr.json() : {};
        setLocations(lb.locations || []);
      }
    } catch (e) { setSt({ configured: false, connected: false }); }
  };
  useEffect(() => {
    load();
    // Back from Square's page: say how it went.
    try {
      const q = new URLSearchParams(window.location.search).get('square');
      if (q === 'connected') setNote('Connected to Square.');
      else if (q === 'declined') setNote('Square connection was cancelled.');
      else if (q) setNote('Square connection did not complete — try again.');
    } catch (e) { /* no query */ }
  }, []);

  const connect = async () => {
    setBusy(true); setNote('');
    try {
      const r = await fetch('/api/square/connect-url', { method: 'POST', headers: authHeaders() });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.url) throw new Error(b.message || 'Could not start the Square connection');
      window.location.assign(b.url);
    } catch (e) { setNote(e.message); setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Square? New orders will stop getting a pay link; nothing already paid changes.')) return;
    setBusy(true);
    try { await fetch('/api/square/disconnect', { method: 'DELETE', headers: authHeaders() }); setNote('Disconnected.'); await load(); }
    catch (e) { setNote(e.message); }
    setBusy(false);
  };
  const setLocation = async (id) => {
    setBusy(true);
    try {
      const r = await fetch('/api/square/location', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ location_id: id }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.success === false) throw new Error(b.message || 'Could not set the location');
      await load();
    } catch (e) { setNote(e.message); }
    setBusy(false);
  };

  const state = !st ? 'loading' : !st.configured ? 'unconfigured' : !st.connected ? 'ready' : 'connected';

  return (
    <Panel title="Square" Icon={CreditCard}
           right={st?.env === 'sandbox' && st?.configured ? 'sandbox' : null}>
      {state === 'loading' ? <p className="text-sm text-cq-ink-3">Checking…</p> : null}
      {state === 'unconfigured' ? (
        <>
          <Status state="warn">Not set up on this server</Status>
          <SettingNote>
            Taking payments through Square needs a Square developer app registered once for CupQ
            (SQUARE_APPLICATION_ID and SECRET in Railway). Until then the honour system runs as it does now:
            the counter takes the money and taps Paid.
          </SettingNote>
        </>
      ) : null}
      {state === 'ready' ? (
        <>
          <Status state="warn">Not connected</Status>
          <p className="text-sm text-cq-ink-2 mt-2 mb-3">
            Connect the event's own Square account. Square opens in this tab, asks you to allow CupQ, and sends you back here.
          </p>
          <Button variant="primary" size="sm" Icon={Link2} onClick={connect} disabled={busy}>
            {busy ? 'Opening Square…' : 'Connect Square'}
          </Button>
        </>
      ) : null}
      {state === 'connected' ? (
        <>
          <Status state="ok">Connected{st.location_name ? ` · ${st.location_name}` : ''}</Status>
          <div className="mt-2">
            <SettingRow label="Payments land in" hint="The Square location that receives them">
              <SelectRow value={st.location_id || ''} ariaLabel="Square location" onChange={setLocation}
                options={(locations.length ? locations : [{ id: st.location_id, name: st.location_name || st.location_id }])
                  .map((l) => ({ value: l.id, label: l.name }))} />
            </SettingRow>
            <SettingRow label="Webhook" hint={st.webhook_key_set ? 'Square tells us the moment a payment lands' : 'SQUARE_WEBHOOK_SIGNATURE_KEY is not set — payments will not mark themselves paid'}>
              <Status state={st.webhook_key_set ? 'ok' : 'bad'}>{st.webhook_key_set ? 'listening' : 'not set'}</Status>
            </SettingRow>
          </div>
          <div className="flex items-center gap-2 pt-3">
            <Button variant="ghost" size="sm" Icon={RefreshCw} onClick={load} disabled={busy}>Refresh</Button>
            <Button variant="ghost" size="sm" Icon={Unplug} onClick={disconnect} disabled={busy}
                    className="!text-cq-alert hover:!bg-cq-alert-wash">Disconnect</Button>
          </div>
          <SettingNote>
            Webhook address for the Square developer dashboard: <code className="text-xs">{st.webhook_url}</code>
          </SettingNote>
        </>
      ) : null}
      {note ? <p className="text-sm font-semibold text-cq-caramel-deep mt-3">{note}</p> : null}
    </Panel>
  );
};

export default SquareCard;
