// BroadcastDialog.js — telling everyone still waiting that something
// has gone wrong.
//
// This replaced window.prompt(). A native prompt shows the raw host
// above it — "web-production-4cc9c.up.railway.app says" — which Steve
// rightly called "pretty average", and it is worse than cosmetic: this
// is the one control that sends words to real customers' phones, and a
// browser prompt gives no room to say who it reaches, offers no way to
// see the message as they will, and on iOS can be dismissed by a
// mis-tap with no undo.
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DEFAULT_MESSAGE =
  "Sorry - we've had a problem with our system. Please come to the counter and confirm your order.";

const BroadcastDialog = ({ open, onClose, onSend, waitingCount = null }) => {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [busy, setBusy] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (open) {
      setMessage(DEFAULT_MESSAGE);
      setBusy(false);
      setTimeout(() => box.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    setBusy(true);
    try {
      await onSend(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
                    bg-black/60 p-0 sm:p-4"
         onClick={() => { if (!busy) onClose(); }}>
      {/* Bottom sheet on a phone, centred card on a desktop. A barista
          reaching this mid-service is holding the device one-handed. */}
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl
                      max-h-[92vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={22} />
            <div className="min-w-0">
              <h3 className="text-lg font-bold leading-tight">Tell waiting customers</h3>
              <p className="text-sm text-gray-600 mt-0.5">
                Goes to everyone whose order has <strong>not been printed</strong> yet
                {waitingCount != null && ` — ${waitingCount} right now`}.
                Orders already on a label are left alone.
              </p>
            </div>
          </div>
          <button onClick={() => { if (!busy) onClose(); }}
                  className="p-1 rounded-full hover:bg-gray-100 flex-shrink-0" title="Cancel">
            <X size={20} />
          </button>
        </div>

        <div className="px-5">
          <textarea
            ref={box}
            rows={4}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full border rounded-lg p-3 text-base leading-snug
                       focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {/* Shown as the customer will read it, because this cannot be
              unsent and a typo reaches everyone. */}
          <div className="mt-3 rounded-lg bg-gray-100 p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">
              They will see
            </div>
            <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">
              {message.trim() || <span className="text-gray-400">nothing yet</span>}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-5 pt-4">
          <button onClick={() => { if (!busy) onClose(); }}
                  className="flex-1 py-3 rounded-lg border border-gray-300 font-medium">
            Cancel
          </button>
          <button onClick={send} disabled={busy || !message.trim()}
                  className="flex-1 py-3 rounded-lg bg-amber-600 text-white font-semibold
                             disabled:bg-gray-300">
            {busy ? 'Sending…' : 'Send to everyone waiting'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BroadcastDialog;
