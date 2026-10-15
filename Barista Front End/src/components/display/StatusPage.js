// StatusPage.js — cupq.app/status: is this event's coffee working? (U4-4)
//
// For the client and the venue on the day: ordering, stations, texts and
// cup labels, green / amber / red, refreshed every 30 seconds. Public, no
// login, nothing personal (GET /api/public/status).
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, XCircle, MinusCircle } from 'lucide-react';

const STYLE = {
  up: { Icon: CheckCircle, cls: 'text-cq-ready', word: 'Working' },
  degraded: { Icon: AlertTriangle, cls: 'text-cq-caramel-deep', word: 'Partly working' },
  down: { Icon: XCircle, cls: 'text-cq-alert', word: 'Not working' },
  off: { Icon: MinusCircle, cls: 'text-cq-ink-3', word: 'Off' },
};
const HEADLINE = {
  up: 'Everything is working',
  degraded: 'Working, with a problem the team is on',
  down: 'Ordering is down. The team has been alerted.',
};

const StatusPage = () => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/status', { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json()); setFailed(false);
    } catch (e) { setFailed(true); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const overall = failed ? 'down' : (data?.overall || null);
  return (
    <div className="min-h-screen bg-cq-cream px-4 py-10">
      <div className="max-w-lg mx-auto">
        <p className="text-sm font-semibold text-cq-ink-3 uppercase tracking-wide">
          {data?.event_name ? `${data.event_name} · ` : ''}Coffee status
        </p>
        <h1 className={`text-3xl font-extrabold mt-1 mb-6 ${overall ? STYLE[overall].cls : 'text-cq-roast'}`}>
          {failed ? "Can't reach the coffee system"
            : overall === 'up' && data?.serving === false ? 'Ready. No service running right now'
            : overall ? HEADLINE[overall] : 'Checking…'}
        </h1>
        <div className="bg-cq-milk rounded-cq-xl shadow-cq-card divide-y divide-cq-line">
          {(data?.parts || []).map(p => {
            const s = STYLE[p.state] || STYLE.off;
            return (
              <div key={p.name} className="flex items-center gap-4 px-5 py-4">
                <s.Icon size={28} className={`${s.cls} flex-shrink-0`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-cq-roast">{p.name}</div>
                  <div className="text-sm text-cq-ink-2">{p.detail}</div>
                </div>
                <span className={`text-sm font-semibold ${s.cls}`}>{s.word}</span>
              </div>
            );
          })}
          {failed && (
            <div className="px-5 py-4 text-sm text-cq-ink-2">
              This page couldn't reach the coffee system. If you're at the event, check your internet first.
            </div>
          )}
        </div>
        <p className="text-xs text-cq-ink-3 mt-4">
          {data?.checked_at ? `Checked ${new Date(data.checked_at).toLocaleTimeString()}. ` : ''}Updates every 30 seconds.
        </p>
      </div>
    </div>
  );
};

export default StatusPage;
