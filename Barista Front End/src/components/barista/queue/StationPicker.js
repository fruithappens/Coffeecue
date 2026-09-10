// "Which cart is this tablet at?" and "which others do I want to keep an
// eye on?" -- one sheet. The header never shows more than the cap of
// watched carts (Steve saw 200 chips fill the screen), so watching is a
// choice made here, not a default.
import React from 'react';
import { X, Check } from 'lucide-react';
import { Button, Pill } from '../../../design';

export const WATCH_CAP = 3;

export default function StationPicker({ open, stations = [], selectedStation, watchedIds = [], onSelect, onToggleWatch, onClose }) {
  if (!open) return null;
  const list = [...stations].sort((a, b) => (a.id || 0) - (b.id || 0));
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" role="dialog" aria-modal="true" aria-label="Stations">
      <div className="absolute inset-0 bg-cq-roast/60" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-cq-cream rounded-t-cq-xl sm:rounded-cq-xl shadow-cq-raised max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-cq-cream/95 backdrop-blur px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-cq-line">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-cq-ink-3">Stations</div>
            <h2 className="text-xl font-extrabold text-cq-roast mt-0.5">This tablet is at…</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="h-11 w-11 inline-flex items-center justify-center rounded-cq-md text-cq-ink-2 hover:bg-cq-wash"><X size={22} /></button>
        </div>
        <div className="px-5 py-4 space-y-2">
          {list.map((s) => {
            const mine = s.id === selectedStation;
            const watched = watchedIds.includes(s.id);
            const off = (s.status || 'active') !== 'active';
            const full = !watched && watchedIds.length >= WATCH_CAP;
            return (
              <div key={s.id} className={`flex items-center gap-3 bg-cq-milk rounded-cq-lg border-2 ${mine ? 'border-cq-roast' : 'border-cq-line'} px-4 py-3`}>
                <button type="button" onClick={() => onSelect && onSelect(s.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${off ? 'bg-cq-alert' : 'bg-cq-ready'}`} />
                    <span className="font-extrabold text-lg text-cq-roast truncate">{s.name}</span>
                    {mine ? <Pill tone="roast" size="sm">Here</Pill> : null}
                  </div>
                  <div className="text-sm text-cq-ink-3 mt-0.5">{[s.location, off ? 'Not taking orders' : `${s.queueCount ?? 0} in queue`].filter(Boolean).join(' · ')}</div>
                </button>
                {mine ? null : (
                  <button
                    type="button"
                    onClick={() => !full && onToggleWatch && onToggleWatch(s.id)}
                    disabled={full}
                    aria-pressed={watched}
                    title={watched ? 'Stop watching' : full ? `You can watch up to ${WATCH_CAP} other stations` : 'Show this station in the header'}
                    className={`h-11 px-3 rounded-cq-md text-sm font-bold inline-flex items-center gap-1.5 border-2 ${watched ? 'bg-cq-caramel-wash border-cq-caramel text-cq-roast' : 'border-cq-line text-cq-ink-2 hover:border-cq-caramel'} disabled:opacity-40`}
                  >
                    {watched ? <Check size={16} strokeWidth={3} /> : null}
                    {watched ? 'Watching' : 'Watch'}
                  </button>
                )}
              </div>
            );
          })}
          {list.length === 0 ? <div className="text-cq-ink-3">No stations yet.</div> : null}
        </div>
        <div className="px-5 pb-5 flex justify-between items-center gap-3">
          <div className="text-sm text-cq-ink-3">Tap a station to work there. Watch up to {WATCH_CAP} others.</div>
          <Button variant="dark" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
