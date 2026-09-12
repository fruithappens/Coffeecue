import React, { useEffect, useState } from 'react';
import { AlertTriangle, HelpCircle, Info, CheckCircle2, MessageSquare } from 'lucide-react';
import { Modal, Notice, Button, TextField } from '../../design';

// The app's answer to window.confirm / window.prompt / window.alert.
//
// Promise-based and imperative, so a handler reads the way it did before:
//
//   if (!(await askConfirm({ title, message, confirmLabel, danger }))) return;
//   const name = await askText({ title, message, placeholder });   // null = cancelled
//   await tell({ title, message, tone: 'bad' });                   // an OK box
//
// Why not the browser's: they are unstyled, they block the render loop, and
// on an iPad running the barista screen in standalone mode a confirm() looks
// like a system error (Claude web audit, 6 Sep 2026; finding 8 in
// docs/FINDINGS_ROADMAP.md). For plain feedback -- "copied", "failed to
// send" -- use showToast from shared/Toast instead; a box with an OK button
// is for something the person has to read before they carry on.
//
// Focus: the Modal puts it on the first control -- the text box for askText,
// otherwise Cancel -- so Enter on a tablet keyboard never confirms a delete.
//
// Mount <ConfirmHost/> ONCE near the app root (App.js does). If no host is
// mounted (tests, an unmounted route) each call falls back to the browser's
// own, so a guard never silently becomes a no-op.
let openFn = null;

const normalise = (opts, kind) => {
  const o = typeof opts === 'string' ? { message: opts } : (opts || {});
  return { ...o, kind };
};

export function askConfirm(opts) {
  const o = normalise(opts, 'confirm');
  if (!openFn) {
    return Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join('\n\n')));
  }
  return openFn(o);
}

export function askText(opts) {
  const o = normalise(opts, 'text');
  if (!openFn) {
    const v = window.prompt([o.title, o.message].filter(Boolean).join('\n\n'), o.defaultValue || '');
    return Promise.resolve(v === null ? null : v);
  }
  return openFn(o);
}

export function tell(opts) {
  const o = normalise(opts, 'tell');
  if (!openFn) {
    window.alert([o.title, o.message].filter(Boolean).join('\n\n'));
    return Promise.resolve();
  }
  return openFn(o);
}

const ICONS = { confirm: HelpCircle, text: MessageSquare, tell: Info };
const TONE_ICONS = { bad: AlertTriangle, warn: AlertTriangle, ok: CheckCircle2, info: Info };

export default function ConfirmHost() {
  const [req, setReq] = useState(null); // { opts, resolve }
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    openFn = (opts) => new Promise((resolve) => {
      setText(opts.defaultValue || '');
      setError('');
      setReq({ opts, resolve });
    });
    return () => { openFn = null; };
  }, []);

  const done = (value) => {
    setReq((current) => {
      if (current) current.resolve(value);
      return null;
    });
  };

  if (!req) return null;
  const {
    kind, title, message, confirmLabel, cancelLabel = 'Cancel', danger = false,
    tone, placeholder, multiline = false, validate, maxLength,
  } = req.opts;
  const Icon = (tone && TONE_ICONS[tone]) || ICONS[kind] || HelpCircle;
  const cancelValue = kind === 'text' ? null : (kind === 'tell' ? undefined : false);

  const submitText = () => {
    const v = String(text ?? '');
    if (typeof validate === 'function') {
      const problem = validate(v);
      if (problem) { setError(String(problem)); return; }
    }
    done(v);
  };

  const heading = title || (kind === 'confirm' ? 'Are you sure?' : kind === 'text' ? 'One thing first' : 'Note');
  const body = message ? <p className="text-cq-ink-2 whitespace-pre-line text-sm leading-relaxed">{message}</p> : null;

  return (
    <Modal title={heading} Icon={Icon} size="sm" onClose={() => done(cancelValue)}
           footer={kind === 'tell' ? (
             <Button variant="primary" onClick={() => done(undefined)}>{confirmLabel || 'OK'}</Button>
           ) : kind === 'text' ? (
             <>
               <Button variant="ghost" onClick={() => done(null)}>{cancelLabel}</Button>
               <Button variant={danger ? 'danger' : 'primary'} onClick={submitText}>{confirmLabel || 'OK'}</Button>
             </>
           ) : (
             <>
               <Button variant="ghost" onClick={() => done(false)}>{cancelLabel}</Button>
               <Button variant={danger ? 'danger' : 'primary'} onClick={() => done(true)}>{confirmLabel || 'Yes'}</Button>
             </>
           )}>
      {tone ? <Notice tone={tone}>{message}</Notice> : body}
      {kind === 'text' ? (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); submitText(); }}>
          {multiline ? (
            <textarea value={text} onChange={(e) => { setText(e.target.value); setError(''); }} placeholder={placeholder}
                      maxLength={maxLength} rows={4} autoFocus
                      className="w-full rounded-cq-md border-2 border-cq-line bg-cq-milk px-3 py-2 text-cq-roast
                                 placeholder:text-cq-ink-3 focus:border-cq-caramel focus:outline-none" />
          ) : (
            <TextField value={text} onChange={(v) => { setText(v); setError(''); }} placeholder={placeholder}
                       maxLength={maxLength} width="w-full" autoFocus />
          )}
          {maxLength ? <div className="text-xs text-cq-ink-3 mt-1 text-right">{String(text || '').length}/{maxLength}</div> : null}
          {error ? <p className="text-sm font-semibold text-cq-alert mt-2">{error}</p> : null}
        </form>
      ) : null}
    </Modal>
  );
}
