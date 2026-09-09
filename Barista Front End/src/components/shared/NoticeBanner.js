// The notice, as customers see it.
//
// Deliberately loud, and deliberately NOT built on the .cq utility classes:
// the public board and the beacon page both predate the design system and
// neither is wrapped in .cq, so the palette is applied directly here. It
// sits ABOVE the queue, not beside it -- a banner in a column is a banner
// nobody reads.
import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

const PALETTE = {
  warning: { bg: '#C8372D', ink: '#FFF6F4' },   // alert
  info: { bg: '#B8764A', ink: '#FFF9F3' },      // caramel
};

export default function NoticeBanner({ notices, big = false, className = '' }) {
  if (!notices || notices.length === 0) return null;
  return (
    <div className={`${big ? 'space-y-3' : 'space-y-2'} ${className}`}>
      {notices.map((n) => {
        const tone = PALETTE[n.level === 'warning' ? 'warning' : 'info'];
        const Icon = n.level === 'warning' ? AlertTriangle : Info;
        return (
          <div
            key={n.id}
            role="status"
            className={`flex items-start gap-3 rounded-cq-lg shadow-cq-card ${
              big ? 'px-6 py-5' : 'px-4 py-3'}`}
            style={{ backgroundColor: tone.bg, color: tone.ink }}
          >
            <Icon className={`shrink-0 ${big ? 'w-9 h-9 mt-1' : 'w-5 h-5 mt-0.5'}`} />
            <p className={`font-semibold leading-snug ${
              big ? 'text-2xl md:text-4xl' : 'text-base'}`}>
              {n.message}
            </p>
          </div>
        );
      })}
    </div>
  );
}
