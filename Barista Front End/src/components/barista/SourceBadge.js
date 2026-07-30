// SourceBadge.js — order-channel chip for barista cards.
//
// Shows a purple APP chip on orders that arrived via the EventsAir
// event-app survey channel (source "ea_app"), so baristas learn the new
// channel exists. When the attendee's registration had no mobile number
// the chip adds "no SMS" — the ready-notification can't be texted, so
// the barista calls the name at pickup instead.
import React from 'react';

const SourceBadge = ({ order }) => {
  if (!order || (order.orderSource || order.source) !== 'ea_app') return null;
  return (
    <span
      className="inline-block bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap"
      title={order.needsContact
        ? 'Ordered in the event app — no phone number on file; call the name at pickup'
        : 'Ordered in the event app (EventsAir)'}
    >
      APP{order.needsContact ? ' · no SMS' : ''}
    </span>
  );
};

export default SourceBadge;
