import React, { useState } from 'react';

// The customer cancels their own order from the tracking page -- but only
// while it's still QUEUED. Once a barista has started it, the button is
// gone and the server refuses anyway (mirrors the SMS OOPS rule: too late
// once it's being made -> see a barista). Two taps, so a stray touch on a
// phone in a pocket can't scrap a coffee.
export default function CancelOrderButton({ orderNumber, status, onCancelled }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Cancellable only while pending (in the queue, not yet being made).
  const pending = status === 'pending';
  if (!pending && !msg) return null;

  const doCancel = async () => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/customer-cancel`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.success) {
        setMsg('Your order has been cancelled.');
        setConfirming(false);
        if (onCancelled) onCancelled();
      } else if (r.status === 409 || b.too_late) {
        setMsg("Too late to cancel here — it's already being made. Please see a barista.");
        setConfirming(false);
      } else {
        setMsg(b.message || 'Could not cancel — please see a barista.');
      }
    } catch (e) {
      setMsg('Network problem — try again, or see a barista.');
    } finally {
      setBusy(false);
    }
  };

  if (msg) {
    return <p className="text-center text-sm text-cq-ink-3 mt-3">{msg}</p>;
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
        className="block mx-auto mt-3 text-sm text-cq-ink-3 underline">
        Cancel my order
      </button>
    );
  }

  // Two deliberate taps -- Steve: "people might have phone out and leave
  // page open and accidently cancel". "Keep it" is the bigger, greener,
  // default-looking button; cancelling is the smaller, plainer one.
  return (
    <div className="mt-3 rounded-cq-lg border-2 border-cq-line p-3 text-center">
      <p className="text-base font-semibold text-cq-roast mb-1">Are you sure you want to cancel?</p>
      <p className="text-xs text-cq-ink-3 mb-3">This can't be undone. If it's already being made you'll need to see a barista.</p>
      <div className="flex gap-2 justify-center">
        <button onClick={() => setConfirming(false)} disabled={busy}
          className="px-5 py-3 rounded-cq-lg bg-cq-ready text-white text-base font-bold">
          No, keep my order
        </button>
        <button onClick={doCancel} disabled={busy}
          className="px-4 py-3 rounded-cq-lg bg-cq-milk border-2 border-cq-alert text-cq-alert text-sm font-semibold disabled:opacity-50">
          {busy ? 'Cancelling…' : 'Yes, cancel it'}
        </button>
      </div>
    </div>
  );
}
