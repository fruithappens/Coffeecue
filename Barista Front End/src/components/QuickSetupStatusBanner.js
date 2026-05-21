// QuickSetupStatusBanner.js
//
// Small heads-up banner shown at the top of sub-tabs that Quick Setup
// populates. Without this, an operator runs Quick Setup, opens (say)
// Event Inventory, and sees a populated list — but has no way to tell
// whether it came from Quick Setup or someone typed it in manually.
//
// Usage:
//   <QuickSetupStatusBanner section="event_inventory" />
//
// The `section` controls the explanatory text — e.g. for Schedule we
// explain that Quick Setup DOESN'T touch sessions (so the operator
// knows they still need to add them), while for Event Inventory we
// confirm that Quick Setup did write here.
//
// Listens for the 'quick_setup_applied' window event so the banner
// updates immediately when Quick Setup re-runs in another tab.
import React, { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';

const READ_STAMP = () => {
  try {
    const raw = localStorage.getItem('quick_setup_last_applied');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const _formatAgo = (iso) => {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day ago' : `${days} days ago`;
  } catch (_) {
    return iso;
  }
};

// Per-section copy: what does Quick Setup actually do for this tab?
// Be honest — for tabs Quick Setup doesn't manage (Schedule sessions)
// say so explicitly.
const SECTION_COPY = {
  event_inventory: {
    populated:    'Quick Setup populated this list — edit individual items or re-run Quick Setup to reset.',
    not_populated: null,
  },
  station_inventory: {
    populated:    'Quick Setup pushed your selected milks / drinks / cup sizes to each station — adjust per-station here.',
    not_populated: null,
  },
  menu_items: {
    populated:    'Quick Setup reconciled this menu with your selected drink categories — re-enable individual items below if needed.',
    not_populated: null,
  },
  schedule: {
    // Quick Setup does NOT create sessions, so be explicit.
    populated:    "Quick Setup ran for the rest of your event, but doesn't manage session schedules — add your event sessions here manually.",
    not_populated: null,
  },
};

const QuickSetupStatusBanner = ({ section }) => {
  const [stamp, setStamp] = useState(READ_STAMP);

  // Refresh on the cross-tab event. Polling once a minute keeps the
  // "X minutes ago" relative time fresh without a full re-render.
  useEffect(() => {
    const onApplied = () => setStamp(READ_STAMP());
    window.addEventListener('quick_setup_applied', onApplied);
    const tick = setInterval(() => setStamp((s) => (s ? { ...s } : s)), 60_000);
    return () => {
      window.removeEventListener('quick_setup_applied', onApplied);
      clearInterval(tick);
    };
  }, []);

  if (!stamp || !stamp.appliedAt) return null;
  const copy = SECTION_COPY[section];
  if (!copy?.populated) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 rounded-md mb-4 flex items-start gap-2">
      <Zap size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
      <div>
        <strong>Quick Setup applied {_formatAgo(stamp.appliedAt)}.</strong>{' '}
        {copy.populated}
      </div>
    </div>
  );
};

export default QuickSetupStatusBanner;
