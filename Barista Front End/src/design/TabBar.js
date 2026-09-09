// Tabs inside a section. Replaces shared/SubTabs: icon + word, the active
// one in caramel, two-up on a phone. One tab bar for organiser, runner and
// barista alike.
import React from 'react';

export default function TabBar({ tabs = [], active, onChange, className = '' }) {
  return (
    <div role="tablist" className={`bg-cq-milk p-1.5 rounded-cq-lg shadow-cq-card grid grid-cols-2 gap-1.5 sm:flex ${className}`}>
      {tabs.map(({ id, label, Icon, count }) => {
        const on = active === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange && onChange(id)}
            className={`flex-1 inline-flex items-center justify-center gap-2 h-11 px-3 rounded-cq-md font-bold text-sm sm:text-base leading-none transition-colors
              ${on ? 'bg-cq-caramel text-white shadow-cq-card' : 'text-cq-ink-2 hover:bg-cq-wash hover:text-cq-roast'}`}
          >
            {Icon ? <Icon size={18} strokeWidth={2.5} /> : null}
            <span className="truncate">{label}</span>
            {count != null ? <span className={`ml-1 min-w-[1.4rem] h-6 px-1.5 inline-flex items-center justify-center rounded-full text-xs ${on ? 'bg-cq-milk/20' : 'bg-cq-wash text-cq-ink-2'}`}>{count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
