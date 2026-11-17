// BarBoard.js — the board for a tall, narrow bar screen (roadmap H5-9).
//
// A 29" bar-type screen stood upright is 540 x 1920 (or 720 x 3840 on the
// 43"): about 3.5 times taller than it is wide. The main board is tuned for
// TVs and iPads, and at this shape it broke (tested 16 Oct): the scan code
// covered the header, the event name wrapped a letter at a time, and the
// Ready column paged one order at a time with half the screen empty.
//
// So this shape gets its own simple stack, top to bottom, sized from the
// screen's WIDTH (vw) so 540 and 720 both read the same:
//
//   logo + event name + station
//   READY list            (the thing people walk up to read)
//   BREWING list          (compact)
//   sponsors              (the existing ticker, if switched on)
//   scan code + "Order by SMS" number
//
// Each list shows as many orders as fit its box and says "+N more" for the
// rest. Fit is measured from the box itself, which is a fixed share of the
// screen, so showing fewer cards can never change the box (no feedback).

import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, MapPin, MessageCircle } from 'lucide-react';

const useFit = (rowPx, count) => {
  const ref = useRef(null);
  const [fit, setFit] = useState(count || 1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      // Real card height when one is on screen (every card in a list is
      // the same height), the estimate otherwise. The box is a fixed
      // share of the screen, so this never feeds back on itself.
      const w = window.innerWidth;
      const gap = w * 0.02;
      const pad = w * 0.05;          // top + bottom padding of the list
      const moreLine = w * 0.075;    // room kept for "+ N more"
      const card = el.querySelector('[data-barcard]');
      const cardH = (card && card.offsetHeight) || rowPx();
      const avail = el.clientHeight - pad;
      if (avail <= 0 || cardH <= 0) return;
      const all = Math.floor((avail + gap) / (cardH + gap));
      // If they don't all fit, one slot goes to the "+ N more" line.
      const fitsAll = all >= count;
      const n = fitsAll ? all : Math.floor((avail - moreLine + gap) / (cardH + gap)) + 1;
      setFit(Math.max(1, n));
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, [rowPx, count]);
  return [ref, fit];
};

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'Customer';

// Sizes in vw so the layout scales with the screen's width.
const vw = (n) => `${n}vw`;
const READY_ROW = () => window.innerWidth * 0.23;    // card height estimate, px
const BREW_ROW = () => window.innerWidth * 0.12;

const List = ({ orders, kind, rowPx, colour, ink }) => {
  const [ref, fit] = useFit(rowPx, orders.length);
  const more = orders.length > fit ? orders.length - (fit - 1) : 0;
  const shown = more ? orders.slice(0, fit - 1) : orders;
  const ready = kind === 'ready';
  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-hidden flex flex-col"
         style={{ gap: vw(2), padding: `${vw(2.5)} ${vw(3)}` }}>
      {orders.length === 0 && (
        <div className="text-center font-semibold" style={{ fontSize: vw(4.5), color: ink, opacity: 0.6,
                                                             paddingTop: vw(4) }}>
          {ready ? 'Nothing waiting' : 'Nothing brewing'}
        </div>
      )}
      {shown.map(o => (
        <div key={o.id} data-barcard
             className="rounded-2xl bg-white flex items-center justify-between min-w-0"
             style={{ border: `${vw(0.9)} solid ${colour}`,
                      padding: ready ? `${vw(2.5)} ${vw(4)}` : `${vw(1.5)} ${vw(4)}` }}>
          <div className="min-w-0">
            <div className="font-extrabold leading-none truncate"
                 style={{ fontSize: ready ? vw(10) : vw(6), color: '#2A1A10' }}>
              {firstName(o.customerName)}
            </div>
            {ready && (
              <div className="truncate" style={{ fontSize: vw(4), color: '#5B4A3F', marginTop: vw(1) }}>
                {[o.size, o.coffeeType].filter(Boolean).join(' ')}
              </div>
            )}
          </div>
          <div className="font-extrabold tabular-nums flex-shrink-0"
               style={{ fontSize: ready ? vw(9) : vw(5.5), color: '#5B4A3F', marginLeft: vw(2) }}>
            #{o.order_number}
          </div>
        </div>
      ))}
      {more > 0 && (
        <div className="text-center font-bold" style={{ fontSize: vw(4.5), color: ink }}>
          + {more} more
        </div>
      )}
    </div>
  );
};

const Heading = ({ icon, label, count, colour }) => (
  <div className="flex items-center justify-between flex-shrink-0 font-extrabold uppercase"
       style={{ backgroundColor: colour, color: '#FFFFFF', fontSize: vw(5.5),
                padding: `${vw(2)} ${vw(4)}`, letterSpacing: '0.04em' }}>
    <span className="flex items-center" style={{ gap: vw(2) }}>{icon}{label}</span>
    <span className="tabular-nums">{count}</span>
  </div>
);

const BarBoard = ({
  config, station, orders, qrSrc, smsNumber, connected, hadResult, error,
  readyColour = '#2E7D4F', brewColour = '#8A5A35', ticker = null, healthDot = null,
}) => (
  <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ backgroundColor: '#F4EDE4' }}>
    {/* Brand: logo, event name (wraps by word, never by letter), station. */}
    <header className="flex-shrink-0 bg-white relative flex items-center"
            style={{ padding: `${vw(4)} ${vw(5)}`, gap: vw(4), borderBottom: `${vw(1)} solid ${brewColour}` }}>
      {healthDot}
      {config.logo && (
        <img src={config.logo} alt="" className="object-contain flex-shrink-0"
             style={{ height: vw(18), maxWidth: vw(30) }} />
      )}
      <div className="min-w-0">
        <div className="font-extrabold leading-tight" style={{ fontSize: vw(8), color: '#2A1A10',
                                                               overflowWrap: 'normal', wordBreak: 'normal' }}>
          {config.event_name || config.system_name || ' '}
        </div>
        {station && station.id !== 'all' && (
          <div className="font-bold flex items-center truncate" style={{ fontSize: vw(5), color: '#5B4A3F',
                                                                         marginTop: vw(1) }}>
            <MapPin style={{ width: vw(5), height: vw(5), marginRight: vw(1.5), flexShrink: 0 }} />
            {station.name}
          </div>
        )}
      </div>
    </header>

    {hadResult && !connected && (
      <div className="flex-shrink-0 text-center font-semibold text-white"
           style={{ backgroundColor: '#B3261E', fontSize: vw(3.6), padding: vw(1.5) }}>
        {error || 'Not connected - orders may be stale.'}
      </div>
    )}

    {/* Ready gets the larger share: it is what people walk up to read. */}
    <section className="flex flex-col min-h-0" style={{ flex: '58 1 0' }}>
      <Heading icon={<Check style={{ width: vw(6), height: vw(6) }} />} label="Ready"
               count={orders.ready.length} colour={readyColour} />
      <List orders={orders.ready} kind="ready" rowPx={READY_ROW} colour={readyColour} ink="#2A1A10" />
    </section>
    <section className="flex flex-col min-h-0" style={{ flex: '30 1 0' }}>
      <Heading icon={<Clock style={{ width: vw(6), height: vw(6) }} />} label="Brewing"
               count={orders.inProgress.length} colour={brewColour} />
      <List orders={orders.inProgress} kind="brewing" rowPx={BREW_ROW} colour={brewColour} ink="#2A1A10" />
    </section>

    {ticker}

    {/* Ordering, at the bottom where someone at the bar is standing. */}
    {(qrSrc || smsNumber) && (
      <footer className="flex-shrink-0 bg-white flex items-center"
              style={{ padding: `${vw(4)} ${vw(5)}`, gap: vw(5), borderTop: `${vw(1)} solid ${brewColour}` }}>
        {qrSrc && (
          <div className="flex flex-col items-center flex-shrink-0">
            <img src={qrSrc} alt="Scan to order" className="bg-white"
                 style={{ width: vw(34), height: vw(34) }}
                 onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <div className="font-bold uppercase" style={{ fontSize: vw(3), color: '#5B4A3F',
                                                         letterSpacing: '0.12em', marginTop: vw(1) }}>
              Scan to order
            </div>
          </div>
        )}
        {smsNumber && (
          <div className="min-w-0">
            <div className="font-bold uppercase flex items-center" style={{ fontSize: vw(3.6), color: '#5B4A3F',
                                                                           letterSpacing: '0.08em', gap: vw(1.5) }}>
              <MessageCircle style={{ width: vw(4.5), height: vw(4.5) }} />
              {qrSrc ? 'Or order by SMS' : 'Order by SMS'}
            </div>
            <div className="font-extrabold whitespace-nowrap tabular-nums"
                 style={{ fontSize: vw(7.5), color: '#2A1A10' }}>
              {smsNumber}
            </div>
          </div>
        )}
      </footer>
    )}
  </div>
);

export default BarBoard;
