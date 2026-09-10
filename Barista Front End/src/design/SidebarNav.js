// The runner's sidebar: groups with a small heading, items with an icon and
// a word, the active one in the caramel wash. Collapses to icons.
import React from 'react';

export default function SidebarNav({ groups = [], active, onChange, collapsed = false, className = '' }) {
  return (
    <nav className={`${collapsed ? 'w-16' : 'w-60'} bg-cq-milk border-r border-cq-line px-2 py-3 ${className}`}>
      {groups.map(({ heading, items }, gi) => (
        <div key={heading || gi} className={gi === 0 ? '' : 'mt-4'}>
          {!collapsed ? (
            <div className="px-3 mb-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-cq-ink-3">{heading}</div>
          ) : (gi !== 0 ? <div className="mx-3 mb-2 border-t border-cq-line" /> : null)}
          <div className="space-y-0.5">
            {items.map(({ id, label, Icon, badge }) => {
              const on = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange && onChange(id)}
                  title={collapsed ? label : undefined}
                  aria-current={on ? 'page' : undefined}
                  className={`w-full flex items-center gap-3 h-11 px-3 rounded-cq-md font-semibold text-base leading-none transition-colors
                    ${on ? 'bg-cq-caramel-wash text-cq-roast' : 'text-cq-ink-2 hover:bg-cq-wash hover:text-cq-roast'}`}
                >
                  {Icon ? <Icon size={20} strokeWidth={on ? 2.5 : 2} className="flex-shrink-0" /> : null}
                  {!collapsed ? <span className="truncate">{label}</span> : null}
                  {!collapsed && badge != null ? <span className="ml-auto min-w-[1.4rem] h-6 px-1.5 inline-flex items-center justify-center rounded-full text-xs font-bold bg-cq-alert text-white">{badge}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
