// The roast bar. Left: the area mark and THIS station. Middle: the few other
// carts this tablet chose to watch. Right: ONE status line (red only when
// something is broken) and the lock that opens the admin sheet.
import React, { useMemo } from 'react';
import { ChevronDown, Lock, Plus } from 'lucide-react';
import { AreaMark, StationChip } from '../../../design';
import { WATCH_CAP } from './StationPicker';

const Status = ({ items }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold leading-none">
    {items.filter(Boolean).map(({ text, tone, onClick, title }, i) => {
      const cls = tone === 'alert' ? 'text-white bg-cq-alert px-2 py-1 rounded-full' : tone === 'ready' ? 'text-cq-ready-wash' : 'text-cq-cream/85';
      return onClick
        ? <button key={i} type="button" onClick={onClick} title={title} className={`${cls} hover:underline underline-offset-4`}>{text}</button>
        : <span key={i} title={title} className={cls}>{text}</span>;
    })}
  </div>
);

export default function QueueHeader({
  station, stations = [], watchedIds = [], rushMode = false,
  net = true, stationOnline = true, queueCount = 0, madeToday = null, waitMin = null, printer = null, labelRoll = null,
  holding = null, lowStock = [], onTapHold, onTapLowStock,
  onOpenPicker, onOpenAdmin, onTapWait, onTapMade, onToggleOnline, onSelectStation,
}) {
  const watched = useMemo(() => watchedIds.map((id) => stations.find((s) => s.id === id)).filter(Boolean).slice(0, WATCH_CAP), [watchedIds, stations]);
  const rollBad = labelRoll && ['critical', 'empty'].includes(labelRoll.level);
  const status = [
    !net ? { text: 'NO CONNECTION', tone: 'alert', title: 'Cannot reach the server' } : null,
    stationOnline
      ? { text: 'Online', tone: 'ready', onClick: onToggleOnline, title: 'Taking orders. Tap to take this station offline.' }
      : { text: 'OFFLINE · not taking orders', tone: 'alert', onClick: onToggleOnline, title: 'Tap to bring this station back online' },
    { text: `${queueCount} in queue` },
    waitMin != null ? { text: `walk-up ~${waitMin} min`, onClick: onTapWait, title: 'If someone orders now, roughly how long. Tap to set the starting estimate.' } : null,
    madeToday != null ? { text: `${madeToday} made`, onClick: onTapMade, title: 'Coffees finished here today. Tap for the session summary.' } : null,
    printer ? (printer.online ? (rollBad ? { text: 'LABEL ROLL', tone: 'alert', title: labelRoll.message } : { text: 'labels ok' }) : { text: 'LABELS OFF', tone: 'alert', title: 'Printer not polling. Check power and Wi-Fi.' }) : null,
    holding ? { text: `TEXTS HELD${holding.will_send ? ` · ${holding.will_send}` : ''}`, tone: 'alert', onClick: onTapHold, title: 'Customers are not being told their coffee is ready. Tap to release.' } : null,
    lowStock && lowStock.length ? { text: `LOW STOCK · ${lowStock.join(', ')}`, tone: 'alert', onClick: onTapLowStock, title: 'Restock, or turn the item off in Stock' } : null,
  ];
  const chips = (
    <>
      {watched.map((s) => (
        <StationChip key={s.id} compact name={s.name} queue={s.queueCount ?? 0} status={s.status} onClick={() => onSelectStation && onSelectStation(s.id)} className="!bg-white/10 !border-white/20 !text-cq-cream" />
      ))}
      <button type="button" onClick={onOpenPicker} className="h-9 px-3 rounded-full border-2 border-white/25 text-sm font-bold text-cq-cream/85 hover:bg-white/10 inline-flex items-center gap-1" title="Watch another station">
        <Plus size={14} strokeWidth={3} />{watched.length ? '' : 'Watch'}
      </button>
    </>
  );
  return (
    <header className={`bg-cq-roast text-cq-cream ${rushMode ? 'px-3 py-2' : 'px-4 py-3'}`}>
      {/* Row 1: this station, the watched carts, the lock. Row 2: the
          status line. On a phone the chips drop to row 2 so the lock stays
          top-right where a thumb expects it. */}
      <div className="flex items-center gap-x-4 gap-y-2">
        <button type="button" onClick={onOpenPicker} className="flex items-center gap-2 min-w-0 text-left rounded-cq-md hover:bg-white/10 px-1 -mx-1" title="Change station or choose which others to watch">
          <AreaMark area="barista" inverse label={null} size={rushMode ? 'sm' : 'md'} />
          <span className={`font-extrabold truncate ${rushMode ? 'text-lg' : 'text-2xl'}`}>{station?.name || 'Choose a station'}</span>
          <ChevronDown size={18} className="flex-shrink-0 opacity-80" />
        </button>
        {!rushMode ? <div className="hidden sm:flex items-center gap-2 flex-wrap">{chips}</div> : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenAdmin}
          aria-label="Station admin"
          title="Station admin: mode, station, sound, zoom, refresh, sign out"
          className="h-10 w-10 inline-flex items-center justify-center rounded-cq-md bg-white/10 hover:bg-white/20 flex-shrink-0"
        >
          <Lock size={18} />
        </button>
      </div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${rushMode ? 'mt-1' : 'mt-2'}`}>
        {!rushMode ? <div className="flex sm:hidden items-center gap-2 flex-wrap">{chips}</div> : null}
        <Status items={status} />
      </div>
    </header>
  );
}
