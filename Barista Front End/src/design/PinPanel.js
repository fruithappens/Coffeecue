// The PIN panel: a barista taps four digits to open the station's admin
// settings (phase 4). Big keys, one hand, no keyboard. The dots fill as you
// type; a wrong PIN shakes the dots red and clears.
import React, { useState } from 'react';
import { Delete, Lock, Check } from 'lucide-react';

// A PIN is 4 to 6 digits (the organiser chooses). Six digits submit on
// their own; fewer need the tick, so a 4-digit PIN is never cut short.
export default function PinPanel({ title = 'Station settings', hint = 'Enter the station PIN', minLength = 4, maxLength = 6, onSubmit, error = false, className = '' }) {
  const [pin, setPin] = useState('');
  const submit = (value) => { if (onSubmit) onSubmit(value); setTimeout(() => setPin(''), 250); };
  const press = (d) => {
    if (pin.length >= maxLength) return;
    const next = pin + d;
    setPin(next);
    if (next.length === maxLength) submit(next);
  };
  const length = Math.max(minLength, pin.length);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ok', '0', 'del'];
  return (
    <div className={`bg-cq-milk rounded-cq-xl shadow-cq-raised p-6 w-full max-w-xs ${className}`}>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-cq-md bg-cq-caramel-wash text-cq-roast"><Lock size={20} strokeWidth={2.5} /></span>
        <div>
          <div className="font-extrabold text-lg text-cq-roast leading-tight">{title}</div>
          <div className="text-sm text-cq-ink-3">{hint}</div>
        </div>
      </div>
      <div className={`mt-5 flex justify-center gap-3 ${error ? 'animate-pulse' : ''}`} aria-label={`${pin.length} of ${length} digits`}>
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={`w-4 h-4 rounded-full border-2 ${error ? 'border-cq-alert bg-cq-alert' : i < pin.length ? 'border-cq-roast bg-cq-roast' : 'border-cq-line bg-transparent'}`} />
        ))}
      </div>
      {error ? <div className="mt-2 text-center text-sm font-semibold text-cq-alert">That PIN isn’t right. Try again.</div> : null}
      <div className="mt-5 grid grid-cols-3 gap-2">
        {keys.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={k === 'ok' && pin.length < minLength}
            onClick={() => (k === 'del' ? setPin(pin.slice(0, -1)) : k === 'ok' ? submit(pin) : press(k))}
            aria-label={k === 'del' ? 'Delete' : k === 'ok' ? 'Unlock' : k}
            className={`h-14 rounded-cq-md text-2xl font-extrabold leading-none transition-colors ${
              k === 'del' ? 'text-cq-ink-2 hover:bg-cq-wash'
              : k === 'ok' ? 'bg-cq-caramel text-white hover:bg-cq-caramel-deep disabled:opacity-30'
              : 'bg-cq-wash text-cq-roast hover:bg-cq-caramel-wash active:bg-cq-caramel active:text-white'}`}
          >
            {k === 'del' ? <Delete size={22} className="mx-auto" /> : k === 'ok' ? <Check size={24} strokeWidth={3} className="mx-auto" /> : k}
          </button>
        ))}
      </div>
    </div>
  );
}
