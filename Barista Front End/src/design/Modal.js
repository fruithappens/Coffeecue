// Dialogs.
//
// The third of the three shapes. SettingRow covers a list of settings, Panel
// covers a list of things, and this covers the box that opens on top of both.
//
// Five dialogs shipped before this existed -- edit an order, move an order,
// message a customer, broadcast, adjust the wait -- and every one of them
// hand-rolled the same forty lines: a grey scrim, a white card, a title with
// an X, a grey Cancel button. They were the last screens in the app still
// wearing the old palette, and they were invisible to the screen sweep for a
// structural reason: a dialog that is not open is not in the DOM, so a page
// could score a perfect zero with five legacy screens one tap away.
//
// A dialog is also the one surface where getting the small things wrong is
// most expensive -- it appears over the work, it takes the focus, and a
// barista meets it mid-order. So the shell handles them once: Escape closes,
// the backdrop closes, focus moves into the box on open and returns to
// whatever opened it on close, and the page behind cannot scroll away.
import React, { useEffect, useRef, useCallback } from 'react';
import { X, AlertCircle, Info, CheckCircle2, ChevronRight } from 'lucide-react';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

// The shell. `title` and `onClose` are the whole required API; `footer` takes
// the action buttons so every dialog puts them in the same place.
//
// `busy` is deliberately more than cosmetic: while a dialog is sending, the
// close paths are shut off. Half these dialogs fire a request that changes an
// order, and closing one mid-flight leaves the operator with no idea whether
// it landed.
// `sheet` slides up from the bottom edge on a phone and centres on a desktop.
// Use it for anything a barista meets mid-service: they are holding the
// device one-handed and the bottom of the screen is the only part their thumb
// reaches.
export function Modal({
  title, Icon, onClose, footer, size = 'md', busy = false, sheet = false,
  children, className = '',
}) {
  const cardRef = useRef(null);
  const openerRef = useRef(null);

  const close = useCallback(() => {
    if (!busy && typeof onClose === 'function') onClose();
  }, [busy, onClose]);

  useEffect(() => {
    // Remember what had focus, put it back on the way out. Without this a
    // barista who closes a dialog is returned to the top of the page.
    openerRef.current = document.activeElement;
    const card = cardRef.current;
    if (card) {
      const first = card.querySelector(
        'input, select, textarea, button:not([data-cq-close])');
      (first || card).focus({ preventScroll: true });
    }
    // The page behind must not scroll while a dialog is over it -- on a
    // tablet, dragging the dialog drags the queue underneath.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [close]);

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center bg-cq-roast/50 ${
        sheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-4'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={`bg-cq-milk shadow-cq-raised w-full flex flex-col outline-none
                    ${SIZES[size] || SIZES.md} ${sheet
                      ? 'rounded-t-cq-xl sm:rounded-cq-lg max-h-[92vh]'
                      : 'rounded-cq-lg max-h-[90vh]'} ${className}`}
      >
        <div className="flex items-center gap-2 px-5 pt-5 pb-3">
          {Icon ? <Icon className="w-5 h-5 text-cq-caramel flex-shrink-0" /> : null}
          <h3 className="text-lg font-bold text-cq-roast leading-tight">{title}</h3>
          <button
            type="button"
            data-cq-close
            aria-label="Close"
            onClick={close}
            disabled={busy}
            className="ml-auto -mr-1 p-1.5 rounded-cq-sm text-cq-ink-3 hover:text-cq-roast
                       hover:bg-cq-wash disabled:opacity-40 transition-colors"
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-5 pb-5 overflow-y-auto flex-1 min-h-0">{children}</div>

        {footer ? (
          <div className="px-5 py-4 border-t border-cq-line flex items-center justify-end gap-2
                          flex-shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The coloured box every dialog re-invented: red for a refusal, amber for
// "you can carry on but read this", caramel for plain context. Same three
// meanings as Status, so a screen never has to pick its own red.
const TONES = {
  bad:  { box: 'bg-cq-alert-wash border-cq-alert/30 text-cq-alert', Icon: AlertCircle },
  warn: { box: 'bg-cq-warn-wash border-cq-warn/30 text-cq-warn', Icon: AlertCircle },
  ok:   { box: 'bg-cq-ready-wash border-cq-ready/30 text-cq-ready', Icon: CheckCircle2 },
  info: { box: 'bg-cq-caramel-wash border-cq-line text-cq-ink-2', Icon: Info },
};

export function Notice({ tone = 'info', children, className = '' }) {
  const t = TONES[tone] || TONES.info;
  const I = t.Icon;
  return (
    <div className={`flex items-start gap-2 p-3 mb-4 rounded-cq-md border text-sm
                     font-medium ${t.box} ${className}`}>
      <I size={16} className="flex-shrink-0 mt-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// A quiet card summarising the thing being acted on -- the order you are
// about to move, the person you are about to text. Every dialog had one and
// every one of them was `bg-cq-wash p-3 rounded`.
export function Subject({ title, children }) {
  return (
    <div className="bg-cq-wash rounded-cq-md p-3 mb-4">
      {title ? <div className="font-bold text-cq-roast">{title}</div> : null}
      {children ? <div className="text-sm text-cq-ink-2 mt-0.5">{children}</div> : null}
    </div>
  );
}

// "Pick one of these" -- the station list in Move order, the station list at
// sign-in. A full-width row, big enough for a thumb, that says where it goes.
export function PickRow({ label, hint, right, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-3 text-left rounded-cq-md border-2
                 border-cq-line bg-cq-milk hover:border-cq-caramel hover:bg-cq-caramel-wash
                 disabled:opacity-40 disabled:pointer-events-none transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="font-bold text-cq-roast truncate">{label}</div>
        {hint ? <div className="text-xs text-cq-ink-3 truncate">{hint}</div> : null}
      </div>
      {right !== undefined
        ? right
        : <ChevronRight size={18} className="text-cq-caramel flex-shrink-0" />}
    </button>
  );
}
