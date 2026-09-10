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
import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, Notice, Button } from '../../design';

const DEFAULT_MESSAGE =
  "Sorry - we've had a problem with our system. Please come to the counter and confirm your order.";

const BroadcastDialog = ({ open, onClose, onSend, waitingCount = null }) => {
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setMessage(DEFAULT_MESSAGE);
      setBusy(false);
    }
  }, [open]);

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
    <Modal
      title="Tell waiting customers"
      Icon={AlertTriangle}
      onClose={onClose}
      busy={busy}
      size="lg"
      sheet
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={send} disabled={busy || !message.trim()}>
            {busy ? 'Sending…' : 'Send to everyone waiting'}
          </Button>
        </>
      }
    >
      <Notice tone="warn">
        Goes to everyone whose order has <strong>not been printed</strong> yet
        {waitingCount != null && ` — ${waitingCount} right now`}.
        Orders already on a label are left alone.
      </Notice>

      <textarea
        rows={4}
        value={message}
        disabled={busy}
        onChange={(e) => setMessage(e.target.value)}
        className="w-full rounded-cq-md border-2 border-cq-line bg-cq-milk p-3 text-base
                   leading-snug text-cq-roast focus:border-cq-caramel focus:outline-none
                   disabled:opacity-50"
      />

      {/* Shown as the customer will read it, because this cannot be
          unsent and a typo reaches everyone. */}
      <div className="mt-3 rounded-cq-md bg-cq-wash p-3">
        <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-1">
          They will see
        </div>
        <div className="text-sm text-cq-roast whitespace-pre-wrap break-words">
          {message.trim() || <span className="text-cq-ink-3">nothing yet</span>}
        </div>
      </div>
    </Modal>
  );
};

export default BroadcastDialog;
