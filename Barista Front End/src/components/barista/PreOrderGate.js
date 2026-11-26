// Pre-orders on the barista screen (utils/order_gate.py on the server).
//
// Steve, 26 Nov 2026: during a session people order and are told "we have
// your order and will start making it the moment the session finishes at
// 10:30 -- yours should be ready about 10:42"; the barista "opens the
// gates" when the break starts.
//
// Three pieces: a hook that polls the gate, a banner across the queue
// while it is closed (with the one button that matters: Open), and the
// dialog that closes it with an opening time. Starting any coffee also
// opens the gate on the server, so a barista who forgets the button
// still sets every phone counting down.
import React, { useCallback, useEffect, useState } from 'react';
import { Clock, DoorOpen } from 'lucide-react';
import { Modal, Notice } from '../../design';
import Button from '../../design/Button';

const call = async (method, body) => {
  const api = new (await import('../../services/ApiService')).default();
  return method === 'GET'
    ? api.get('/settings/order-gate')
    : api.put('/settings/order-gate', body);
};

export function usePreOrderGate() {
  const [gate, setGate] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const r = await call('GET');
      if (r?.success) setGate(r);
    } catch (e) { /* the queue matters more than this banner */ }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);
  const save = useCallback(async (body) => {
    const r = await call('PUT', body);
    if (r?.success) setGate(r);
    return r;
  }, []);
  return { gate, refresh, save };
}

// Next quarter hour at least 15 minutes away: a sensible first guess for
// "when does this session end", always editable.
const suggestTime = () => {
  const d = new Date(Date.now() + 15 * 60000);
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  d.setMinutes(m % 60, 0, 0);
  if (m === 60) d.setHours(d.getHours() + 1);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// "14:30" -> "2:30pm", the way the customer's phone writes it.
const label = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return '…';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]}${h < 12 ? 'am' : 'pm'}`;
};

export function PreOrderBanner({ gate, onOpen, onChange, busy }) {
  if (!gate?.closed) return null;
  return (
    <div className="mx-4 mt-3 rounded-cq-xl border-2 border-cq-caramel bg-cq-caramel-wash p-4
                    flex flex-wrap items-center gap-3">
      <Clock size={26} className="text-cq-roast flex-none" />
      <div className="flex-1 min-w-[12rem]">
        <div className="text-lg font-extrabold text-cq-roast">
          Taking pre-orders{gate.opens_label ? ` until ${gate.opens_label}` : ''}
        </div>
        <div className="text-sm text-cq-ink-2">
          {gate.waiting || 0} waiting. Phones say coffee starts
          {gate.started ? ' any minute now' : ` at ${gate.opens_label}`}. Starting any coffee opens it.
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onChange} disabled={busy}>Change time</Button>
      <Button variant="primary" Icon={DoorOpen} onClick={onOpen} disabled={busy}>
        Open now
      </Button>
    </div>
  );
}

export function PreOrderDialog({ gate, onClose, onSave }) {
  const [time, setTime] = useState(gate?.closed && gate?.opens_at ? gate.opens_at : suggestTime());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await onSave({ closed: true, opens_at: time });
      if (r?.success) onClose();
      else setErr(r?.message || 'Could not save');
    } catch (e) {
      setErr(e?.details?.message || e?.message || 'Could not save');
    } finally { setBusy(false); }
  };
  return (
    <Modal
      title="Take pre-orders"
      Icon={Clock}
      onClose={onClose}
      busy={busy}
      sheet
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={go} disabled={busy || !time}>
            {busy ? 'Saving…' : gate?.closed ? 'Change time' : 'Start taking pre-orders'}
          </Button>
        </>
      }
    >
      <label className="block text-base font-bold text-cq-roast mb-2" htmlFor="cq-gate-time">
        Coffee starts at
      </label>
      <input
        id="cq-gate-time"
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        className="w-full rounded-cq-md border-2 border-cq-line bg-cq-milk p-3 text-2xl font-bold
                   text-cq-roast focus:border-cq-caramel focus:outline-none"
      />
      <div className="mt-3 rounded-cq-md bg-cq-wash p-3">
        <div className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-1">
          Their phone will say
        </div>
        <div className="text-base text-cq-roast leading-snug">
          You're in, #12 in line. We start making coffees when the session ends at {label(time)}.
          Yours should be ready about …
        </div>
      </div>
      <Notice tone="info" className="mt-3">
        Orders still come in and queue as normal. Tap <strong>Open now</strong> when the session
        ends, or just start the first coffee: either one sets every phone counting down.
      </Notice>
      {err && <div className="mt-3 text-base font-semibold text-cq-alert">{err}</div>}
    </Modal>
  );
}
