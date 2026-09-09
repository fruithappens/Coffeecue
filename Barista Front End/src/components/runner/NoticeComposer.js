// Tell everyone.
//
// Steve, on the existing broadcast: "wondering how this works for non-SMS
// beacon watching and even display watching... can they see this message via
// sms, via beacon etc?" They could not. This is the fix -- one message, and
// you tick where it goes. Screens and phones are on by default because they
// cost nothing and reach the people actually standing there; the text is off
// by default because every text is money and not everyone gave a number.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Megaphone, Monitor, Smartphone, MessageSquare, X, Check, Clock,
} from 'lucide-react';
import AuthService from '../../services/AuthService';
import NoticeBanner from '../shared/NoticeBanner';

// The two things that actually go wrong at an event, pre-written. Steve's
// own words on both counts -- "ran out of skim milk please come talk to us
// about options", "machine fault were transferring all coffees to station 3".
const PRESETS = [
  { label: 'Out of a milk',
    message: 'We have run out of skim milk. Come and talk to us — we will sort out an alternative.',
    level: 'warning' },
  { label: 'Cart down',
    message: 'One of our machines is down. All coffees are being made at station 3 — your order is still coming.',
    level: 'warning' },
  { label: 'Running behind',
    message: 'We are running about 10 minutes behind. Thanks for your patience — your coffee is on its way.',
    level: 'info' },
  { label: 'Last orders',
    message: 'Last orders in 15 minutes. Get yours in now!',
    level: 'info' },
];

const MINUTES = [
  { v: 15, label: '15 min' },
  { v: 30, label: '30 min' },
  { v: 60, label: '1 hour' },
  { v: 0, label: 'Until I take it down' },
];

const Toggle = ({ on, onClick, Icon, title, note }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`flex-1 min-w-[150px] text-left rounded-cq-md border-2 px-4 py-3 transition ${
      on ? 'border-cq-caramel bg-cq-caramel/10' : 'border-cq-line bg-cq-milk hover:border-cq-caramel/50'
    }`}
  >
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${on ? 'text-cq-caramel' : 'text-cq-ink-3'}`} />
      <span className="font-semibold text-cq-roast">{title}</span>
      {on && <Check className="w-4 h-4 ml-auto text-cq-caramel" />}
    </div>
    <p className="text-xs text-cq-ink-3 mt-1">{note}</p>
  </button>
);

export default function NoticeComposer() {
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('warning');
  const [onScreens, setOnScreens] = useState(true);
  const [onPhones, setOnPhones] = useState(true);
  const [bySms, setBySms] = useState(false);
  const [minutes, setMinutes] = useState(30);
  const [notices, setNotices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const authHeaders = useCallback(() => {
    const token = AuthService.getToken ? AuthService.getToken() : null;
    return token
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
      : { 'Content-Type': 'application/json' };
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notices', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setNotices(Array.isArray(data.notices) ? data.notices : []);
    } catch (e) { /* the composer still works without the history */ }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/notices', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message: message.trim(), level, minutes, onScreens, onPhones, bySms,
          audience: 'today',
        }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        const where = [];
        if (onScreens) where.push('the screens');
        if (onPhones) where.push('phones');
        if (bySms) where.push(`${data.smsSent || 0} text${data.smsSent === 1 ? '' : 's'}`);
        setResult({ ok: true, text: `Up on ${where.join(', ')}.` });
        setMessage('');
        load();
      } else {
        setResult({ ok: false, text: data.message || 'That did not go up.' });
      }
    } catch (e) {
      setResult({ ok: false, text: 'Could not reach the server.' });
    } finally {
      setBusy(false);
    }
  };

  const takeDown = async (id) => {
    try {
      await fetch(`/api/notices/${id}/clear`, {
        method: 'POST', headers: authHeaders(),
      });
      load();
    } catch (e) { /* the list refreshes on the next load either way */ }
  };

  const live = notices.filter((n) => n.live);
  const past = notices.filter((n) => !n.live).slice(0, 6);

  return (
    <div className="cq space-y-6">
      {live.length > 0 && (
        <section className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
          <h3 className="text-lg font-bold text-cq-roast mb-3">Up right now</h3>
          <div className="space-y-3">
            {live.map((n) => (
              <div key={n.id} className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <NoticeBanner notices={[n]} />
                  <p className="text-xs text-cq-ink-3 mt-1.5">
                    {[n.onScreens && 'screens', n.onPhones && 'phones',
                      n.bySms && `${n.smsSent} texts`].filter(Boolean).join(' · ')}
                    {n.expiresAt ? ' · comes down on its own' : ' · stays until you take it down'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => takeDown(n.id)}
                  className="shrink-0 px-3 py-2 rounded-cq-md border border-cq-line text-sm text-cq-ink-2 hover:bg-cq-wash flex items-center gap-1.5"
                >
                  <X className="w-4 h-4" /> Take it down
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Megaphone className="w-5 h-5 text-cq-caramel" />
          <h3 className="text-lg font-bold text-cq-roast">Tell everyone</h3>
        </div>
        <p className="text-sm text-cq-ink-3 mb-4">
          One message. It goes up on the screens, on the phone of anyone
          watching their order, and — if you tick it — out as a text.
        </p>

        <div className="flex flex-wrap gap-2 mb-3">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => { setMessage(p.message); setLevel(p.level); }}
              className="px-3 py-1.5 rounded-full border border-cq-line text-sm text-cq-ink-2 hover:border-cq-caramel hover:text-cq-roast transition"
            >
              {p.label}
            </button>
          ))}
        </div>

        <textarea
          className="w-full rounded-cq-md border-2 border-cq-line px-4 py-3 text-base
                     focus:border-cq-caramel focus:outline-none"
          rows={3}
          maxLength={280}
          placeholder="We have run out of skim milk — come and talk to us about the options."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div className="flex justify-between items-center text-xs text-cq-ink-3 mt-1 mb-4">
          <span>{message.length}/280</span>
          <div className="flex gap-1.5">
            {['warning', 'info'].map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`px-2.5 py-1 rounded-full border ${
                  level === l ? 'border-cq-caramel bg-cq-caramel/10 text-cq-roast font-semibold'
                    : 'border-cq-line'}`}
              >
                {l === 'warning' ? 'Important' : 'Just so you know'}
              </button>
            ))}
          </div>
        </div>

        <p className="text-sm font-semibold text-cq-roast mb-2">Where it shows</p>
        <div className="flex flex-wrap gap-2 mb-4">
          <Toggle on={onScreens} onClick={() => setOnScreens(!onScreens)}
                  Icon={Monitor} title="The screens"
                  note="Every board in the room" />
          <Toggle on={onPhones} onClick={() => setOnPhones(!onPhones)}
                  Icon={Smartphone} title="People's phones"
                  note="Anyone watching their order" />
          <Toggle on={bySms} onClick={() => setBySms(!bySms)}
                  Icon={MessageSquare} title="As a text"
                  note="Costs money · only people who gave a number" />
        </div>

        <p className="text-sm font-semibold text-cq-roast mb-2">
          <Clock className="w-4 h-4 inline mr-1 -mt-0.5" />How long it stays up
        </p>
        <div className="flex flex-wrap gap-2 mb-5">
          {MINUTES.map((m) => (
            <button
              key={m.v}
              type="button"
              onClick={() => setMinutes(m.v)}
              className={`px-3 py-1.5 rounded-full border-2 text-sm ${
                minutes === m.v
                  ? 'border-cq-caramel bg-cq-caramel/10 font-semibold text-cq-roast'
                  : 'border-cq-line text-cq-ink-3'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="w-full sm:w-auto px-6 py-3 rounded-cq-md bg-cq-roast text-cq-cream font-semibold hover:bg-cq-caramel-deep transition disabled:opacity-40"
          disabled={busy || !message.trim() || !(onScreens || onPhones || bySms)}
          onClick={send}
        >
          {busy ? 'Putting it up…' : 'Put it up'}
        </button>

        {result && (
          <p className={`text-sm mt-3 ${result.ok ? 'text-cq-ready' : 'text-cq-alert'}`}>
            {result.text}
          </p>
        )}
      </section>

      {past.length > 0 && (
        <section className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
          <h3 className="text-lg font-bold text-cq-roast mb-2">Earlier today</h3>
          <ul className="text-sm text-cq-ink-3 space-y-1.5">
            {past.map((n) => (
              <li key={n.id} className="flex gap-2">
                <span className="text-cq-line">·</span>
                <span className="flex-1">{n.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
