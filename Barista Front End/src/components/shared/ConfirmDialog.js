import React, { useEffect, useState } from 'react';

// In-app confirm, promise-based, imperative.
//
//   const ok = await askConfirm({ title, message, confirmLabel, danger });
//
// Replaces window.confirm(): that one is unstyled, blocks the render loop,
// and on an iPad running the barista screen in standalone mode it looks
// like a system error (Claude web audit, 6 Sep 2026). Mount <ConfirmHost/>
// ONCE near the app root; askConfirm() works from anywhere after that. If
// no host is mounted (tests, an unmounted route) it falls back to
// window.confirm so a guard never silently becomes a no-op.
let openFn = null;

export function askConfirm(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {});
  if (!openFn) {
    const text = [o.title, o.message].filter(Boolean).join('\n\n');
    return Promise.resolve(window.confirm(text));
  }
  return openFn(o);
}

export default function ConfirmHost() {
  const [req, setReq] = useState(null); // { opts, resolve }

  useEffect(() => {
    openFn = (opts) => new Promise((resolve) => setReq({ opts, resolve }));
    return () => { openFn = null; };
  }, []);

  const done = (value) => {
    setReq((current) => {
      if (current) current.resolve(value);
      return null;
    });
  };

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  const { title, message, confirmLabel = 'Yes', cancelLabel = 'Cancel', danger = false } = req.opts;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4"
      onClick={() => done(false)}
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Confirm'}
    >
      <div className="bg-cq-milk rounded-cq-xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="text-lg font-bold text-cq-roast mb-2">{title}</h3>}
        {message && <p className="text-cq-ink-2 whitespace-pre-line">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="px-4 py-2 rounded-cq-md bg-cq-wash text-cq-roast hover:bg-cq-wash font-medium"
            onClick={() => done(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            className={`px-4 py-2 rounded-cq-md text-white font-semibold ${danger ? 'bg-cq-alert hover:opacity-90' : 'bg-cq-roast hover:bg-cq-caramel-deep'}`}
            onClick={() => done(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
