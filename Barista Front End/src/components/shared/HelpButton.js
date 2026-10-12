// HelpButton.js — the ? in the bottom-left corner of staff screens (U4-5).
//
// Say what's wrong, press Send. The request goes to /api/support-requests
// with where you are (screen, station, app version, screen size); the
// server adds who you are and the latest crashes, saves it and texts the
// admin alert number. So nobody on the phone has to ask "which tablet,
// what were you doing?".
//
// Staff screens only, logged in. Not on the public screens, not on the
// touch strip (/bar, every pixel is a card), and not inside a frame (the
// Demo Room shows a dozen screens at once).
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HelpCircle, X } from 'lucide-react';
import AuthService from '../../services/AuthService';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();
const SHOW_ON = ['/barista', '/run', '/opsboard', '/demo'];

const appVersion = () => {
  try {
    const s = document.querySelector('script[src*="/static/js/main."]');
    return s ? s.getAttribute('src').split('/').pop() : 'dev';
  } catch (e) { return ''; }
};

const HelpButton = () => {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // {ok, text}

  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const user = AuthService.getCurrentUser && AuthService.getCurrentUser();
  if (!user || framed || !SHOW_ON.some(p => location.pathname.startsWith(p))) return null;

  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true); setResult(null);
    try {
      let station = '';
      try { station = localStorage.getItem('coffee_cue_selected_station') || ''; } catch (e) { /* private mode */ }
      const r = await api.request('/support-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          screen: `${location.pathname}${location.hash || ''}`,
          station,
          app_version: appVersion(),
          diagnostics: {
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            online: navigator.onLine,
            time: new Date().toString(),
          },
        }),
      });
      if (r?.success === false) throw new Error(r.message || 'Not sent');
      setMessage('');
      setResult({ ok: true, text: `Sent: help request #${r.id}. ${r.notified ? 'The organiser has been texted.' : 'Saved for the organiser.'}` });
    } catch (e) {
      setResult({ ok: false, text: `Not sent: ${e?.message || e}. If it's urgent, phone the organiser.` });
    }
    setSending(false);
  };

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setResult(null); }}
        aria-label="Get help"
        title="Something wrong? Tell the organiser"
        className="fixed bottom-4 left-4 z-40 h-11 w-11 rounded-full bg-cq-roast text-white shadow-lg
                   flex items-center justify-center hover:opacity-90 print:hidden">
        <HelpCircle size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
             role="dialog" aria-modal="true" aria-label="Get help">
          <div className="w-full max-w-md bg-cq-milk rounded-cq-xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-extrabold text-cq-roast">Something wrong?</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                className="p-1 text-cq-ink-3 hover:text-cq-roast"><X size={20} /></button>
            </div>
            <p className="text-sm text-cq-ink-3 mb-3">
              Say what happened. The screen, station and version are sent with it, so you don't need to.
            </p>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={2000}
              autoFocus placeholder="e.g. The printer stopped printing labels at station 2"
              className="w-full rounded-cq-md border border-cq-line p-3 text-sm outline-none focus:border-cq-caramel" />
            {result && (
              <p role="status" className={`text-sm mt-2 ${result.ok ? 'text-cq-ready' : 'text-cq-alert'}`}>{result.text}</p>
            )}
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-cq-md text-cq-ink-2">Close</button>
              <button type="button" onClick={send} disabled={!message.trim() || sending}
                className="px-4 py-2 rounded-cq-md bg-cq-roast text-white font-semibold disabled:opacity-40">
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default HelpButton;
