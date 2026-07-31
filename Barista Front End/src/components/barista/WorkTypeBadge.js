// WorkTypeBadge.js — team-mode tag on PENDING cards.
//
// Steve's scenario: three black coffees are underway (all shots, no
// milk) while a hot chocolate and a chai sit further down the queue.
// The milk barista is idle — those two drinks need NO shots and could
// be made right now, out of chronological order (starts were never
// forced FIFO; this makes the opportunity visible).
import React from 'react';
import { applicableStages } from '../../utils/orderUtils';

const WorkTypeBadge = ({ order, teamMode }) => {
  if (!teamMode || !order) return null;
  const stages = applicableStages(order);
  if (stages.length !== 1) return null; // both-stage drinks are the normal case
  const milkOnly = stages[0] === 'milk';
  return (
    <span
      className={`inline-block text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap ${
        milkOnly ? 'bg-sky-100 text-sky-800' : 'bg-stone-200 text-stone-700'}`}
      title={milkOnly
        ? 'No shots needed - whoever is on milk can take this now, even out of order'
        : 'Shots only - no milk to steam'}
    >
      {milkOnly ? '🥛 no shots needed' : '☕ shots only'}
    </span>
  );
};

export default WorkTypeBadge;
