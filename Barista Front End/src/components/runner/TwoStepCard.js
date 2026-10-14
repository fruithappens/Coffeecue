// TwoStepCard.js — Runner > People: your own two-step login (roadmap X7-3).
//
// Set up: scan the QR with an authenticator app (Google Authenticator,
// Microsoft Authenticator, 1Password, Apple Passwords), type one code, done.
// From then on signing in needs the password AND the app's 6-digit code.
// Lost phone: another admin can switch it off under People.
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

const TwoStepCard = () => {
  const [enabled, setEnabled] = useState(null);
  const [setup, setSetup] = useState(null); // { qr, secret }
  const [code, setCode] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/auth/two-step');
      setEnabled(!!(r && r.enabled));
    } catch (e) { setEnabled(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (path, body) => {
    setBusy(true); setMsg('');
    try {
      const r = await api.post(path, body || {});
      if (r && r.success === false) { setMsg(r.message || 'That did not work.'); return null; }
      return r;
    } catch (e) {
      setMsg((e && e.message) || 'That did not work.');
      return null;
    } finally { setBusy(false); }
  };

  const start = async () => { const r = await call('/auth/two-step/setup'); if (r) { setSetup(r); setCode(''); } };
  const confirm = async () => { const r = await call('/auth/two-step/enable', { code }); if (r) { setSetup(null); setCode(''); setEnabled(true); } };
  const turnOff = async () => { const r = await call('/auth/two-step/disable', { code }); if (r) { setTurningOff(false); setCode(''); setEnabled(false); } };

  const codeBox = (onEnter) => (
    <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code"
      maxLength={7} placeholder="123 456" aria-label="6-digit code"
      onKeyDown={(e) => { if (e.key === 'Enter') onEnter(); }}
      className="w-36 text-xl font-bold tracking-widest px-3 py-2 rounded-cq-md border-2 border-cq-line bg-cq-milk text-cq-roast" />
  );

  if (enabled === null) return null;
  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-5 mb-4">
      <div className="flex items-start gap-3">
        {enabled ? <ShieldCheck className="text-cq-ready flex-shrink-0" size={28} />
          : <ShieldAlert className="text-cq-caramel-deep flex-shrink-0" size={28} />}
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-extrabold text-cq-roast">Two-step login {enabled ? 'is on' : 'is off'}</h3>
          <p className="text-sm text-cq-ink-2 mt-0.5">
            {enabled
              ? 'Signing in to your account needs your password and the code from your authenticator app.'
              : 'Anyone with your password can open the Runner. Turn this on so signing in also needs a code from your phone.'}
          </p>

          {!enabled && !setup && (
            <button type="button" onClick={start} disabled={busy}
              className="mt-3 h-10 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">
              Set up two-step login
            </button>
          )}

          {setup && (
            <div className="mt-4 flex flex-wrap gap-5 items-start">
              <img src={setup.qr} alt="QR code for your authenticator app" className="w-44 h-44 rounded-cq-md border border-cq-line bg-white" />
              <div className="min-w-0 flex-1">
                <ol className="list-decimal pl-5 text-sm text-cq-ink space-y-1">
                  <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or Apple Passwords).</li>
                  <li>Scan this code. Can't scan? Type this key instead: <code className="break-all font-mono text-xs bg-cq-wash px-1 rounded">{setup.secret}</code></li>
                  <li>Type the 6-digit code it shows:</li>
                </ol>
                <div className="mt-2 flex items-center gap-2">
                  {codeBox(confirm)}
                  <button type="button" onClick={confirm} disabled={busy || code.replace(/\D/g, '').length !== 6}
                    className="h-11 px-4 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Turn on</button>
                  <button type="button" onClick={() => { setSetup(null); setCode(''); }}
                    className="h-11 px-3 text-sm font-semibold text-cq-ink-2">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {enabled && !turningOff && (
            <button type="button" onClick={() => { setTurningOff(true); setCode(''); }}
              className="mt-3 text-sm font-semibold text-cq-ink-2 hover:underline">Turn off</button>
          )}
          {enabled && turningOff && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-cq-ink-2">Current code:</span>
              {codeBox(turnOff)}
              <button type="button" onClick={turnOff} disabled={busy}
                className="h-11 px-4 rounded-cq-md border-2 border-cq-line font-bold text-cq-roast">Turn off</button>
              <button type="button" onClick={() => setTurningOff(false)} className="h-11 px-3 text-sm font-semibold text-cq-ink-2">Cancel</button>
            </div>
          )}
          {msg && <p className="mt-2 text-sm font-semibold text-cq-alert" role="alert">{msg}</p>}
        </div>
      </div>
    </div>
  );
};

export default TwoStepCard;
