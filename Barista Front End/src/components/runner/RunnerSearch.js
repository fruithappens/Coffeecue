// The Runner's search box: type what you're after ("sponsor", "sms off",
// "qr code") and every page and setting that matches is listed; one tap
// goes there. Things that live elsewhere in CupQ (the barista's tablet,
// the screens, the customer page) are listed too, marked with where they
// open. The index and matching live in runnerSearchIndex.js.
import React, { useState, useEffect, useRef } from 'react';
import { Search, X, CornerDownLeft, ExternalLink } from 'lucide-react';
import { searchRunner } from './runnerSearchIndex';
import { NAV, TABS, TITLES } from './runnerNav';

const SUGGESTIONS = ['sponsor', 'texts off', 'logo', 'qr code', 'printer', 'password', 'report'];

// "Messages > Text meter", from the nav itself so it never drifts.
function placeOf(entry) {
  if (entry.where) return entry.where;
  const section = TITLES[entry.section] || entry.section;
  const tab = entry.tab && (TABS[entry.section] || []).find((t) => t.id === entry.tab);
  return tab ? `${section} > ${tab.label}` : section;
}

function iconOf(entry) {
  if (entry.href) return ExternalLink;
  for (const g of NAV) {
    const item = g.items.find((i) => i.id === entry.section);
    if (item) return item.Icon;
  }
  return Search;
}

export function SearchButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label="Search the Runner"
      className="h-10 px-3 inline-flex items-center gap-2 rounded-cq-md bg-cq-milk/10 hover:bg-cq-milk/20 font-bold text-sm">
      <Search size={16} /> <span className="hidden sm:inline">Search</span>
    </button>
  );
}

export default function RunnerSearch({ open, onClose, onOpen }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const results = searchRunner(q).slice(0, 12);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }
  }, [open]);
  useEffect(() => { setSel(0); }, [q]);

  if (!open) return null;

  const pick = (r) => {
    if (r.href) window.open(r.href, '_blank', 'noopener');
    else onOpen({ section: r.section, tab: r.tab });
    onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter' && results[sel]) { e.preventDefault(); pick(results[sel]); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search the Runner">
      <div className="absolute inset-0 bg-cq-roast/60" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-cq-milk text-cq-ink rounded-cq-lg shadow-cq-raised overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b-2 border-cq-line focus-within:border-cq-caramel">
          <Search size={20} className="text-cq-ink-3 shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search, e.g. sponsor, texts off, logo"
            aria-label="Search for a setting or page"
            className="flex-1 h-14 bg-transparent outline-none focus:outline-none focus-visible:outline-none text-lg font-semibold placeholder:text-cq-ink-3 placeholder:font-normal min-w-0" />
          <button type="button" onClick={onClose} aria-label="Close search"
            className="h-10 w-10 inline-flex items-center justify-center rounded-cq-md text-cq-ink-3 hover:bg-cq-wash shrink-0"><X size={20} /></button>
        </div>

        {!q.trim() ? (
          <div className="p-4">
            <div className="text-xs font-extrabold uppercase tracking-[0.12em] text-cq-ink-3 mb-2">Try</div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => setQ(s)}
                  className="h-9 px-3 rounded-full bg-cq-wash text-cq-ink-2 font-semibold text-sm hover:bg-cq-caramel-wash">{s}</button>
              ))}
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="p-6 text-cq-ink-3">
            Nothing matches <b className="text-cq-ink-2">{q}</b>. Try another word, or open <b>Help</b>.
          </div>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox" aria-label="Results">
            {results.map((r, i) => {
              const Icon = iconOf(r);
              return (
                <li key={`${r.section || r.href}/${r.tab || ''}/${r.title}`} role="option" aria-selected={i === sel}>
                  <button type="button" onClick={() => pick(r)} onMouseEnter={() => setSel(i)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 ${i === sel ? 'bg-cq-caramel-wash' : ''}`}>
                    <Icon size={20} className="text-cq-caramel mt-0.5 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-cq-roast">{r.title}</span>
                        {r.app && (
                          <span className="text-[11px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full bg-cq-wash text-cq-ink-2">
                            Opens {r.app}
                          </span>
                        )}
                      </span>
                      <span className="block text-xs font-semibold text-cq-ink-3">{placeOf(r)}</span>
                      <span className="block text-sm text-cq-ink-2 mt-0.5">{r.what}</span>
                    </span>
                    {i === sel && <CornerDownLeft size={16} className="text-cq-ink-3 mt-1 shrink-0 hidden sm:block" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
