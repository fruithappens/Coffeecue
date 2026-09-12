// Panels and tables.
//
// The second half of the vocabulary. SettingRow covers screens that are a list
// of settings; this covers the ones that are a list of THINGS -- printers,
// people, orders, stock. They were the other half of what Steve saw: bare
// <table> with grey headers, or a white box with an <h2> and whatever the
// author felt like underneath.
//
// Promoted from the report screen, which had already grown a table that looked
// right. Same rule as before: not a new design, the one that works, made
// reusable.
import React from 'react';

// A titled card. The plain container for anything that is not a settings list.
export function Panel({ title, Icon, right, children, className = '' }) {
  return (
    <section className={`bg-cq-milk rounded-cq-lg shadow-cq-card p-5 mb-5 ${className}`}>
      {(title || right) ? (
        <div className="flex items-center gap-2 mb-3">
          {Icon ? <Icon className="w-4 h-4 text-cq-caramel" /> : null}
          {title ? <h3 className="text-lg font-bold text-cq-roast flex-1 min-w-0">{title}</h3> : null}
          {right ? <div className="ml-auto text-sm text-cq-ink-3">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// A table that scrolls sideways in its own box rather than pushing the page
// wide -- the thing every one of these got wrong on a laptop.
export function DataTable({ head = [], children, align = [] }) {
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
        {head.length ? (
          <thead>
            <tr className="text-left border-b border-cq-line">
              {head.map((h, i) => (
                <th key={i}
                    className={`py-2 pr-3 text-xs font-extrabold uppercase tracking-wider
                                text-cq-caramel-deep whitespace-nowrap ${
                      align[i] === 'right' ? 'text-right pr-0' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody className="tabular-nums">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children, className = '' }) {
  return <tr className={`border-b border-cq-line last:border-0 ${className}`}>{children}</tr>;
}

export function Cell({ children, strong = false, right = false, dim = false, className = '' }) {
  return (
    <td className={`py-2.5 pr-3 align-middle ${right ? 'text-right pr-0' : ''} ${
      strong ? 'font-bold text-cq-roast' : dim ? 'text-cq-ink-3' : 'text-cq-ink-2'
    } ${className}`}>
      {children}
    </td>
  );
}

// A three-state status dot + label. Health, stock, printers and stations are
// all fine / watch this / broken, and each screen had its own greens and
// yellows. One component, one meaning.
export function Status({ state = 'ok', children, className = '' }) {
  const tone = { ok: 'text-cq-ready', warn: 'text-cq-warn', bad: 'text-cq-alert' }[state]
    || 'text-cq-ink-3';
  const dot = { ok: 'bg-cq-ready', warn: 'bg-cq-warn', bad: 'bg-cq-alert' }[state]
    || 'bg-cq-ink-3';
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${tone} ${className}`}>
      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
      {children}
    </span>
  );
}

// Nothing here yet -- said once, in the right voice, instead of a grey
// "No data available." in every table.
export function Empty({ children }) {
  return <p className="text-sm text-cq-ink-3 py-3">{children}</p>;
}
