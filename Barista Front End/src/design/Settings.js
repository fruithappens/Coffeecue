// The settings vocabulary.
//
// Steve, holding the Station Admin sheet next to the Screens page: "these 2
// screenshots show a contrast of simple clean, branded UI vs cluttered
// complicated, non branded UI."
//
// He is right, and the cause is small: the admin sheet's row pattern was
// written INLINE, inside AdminSheet.js. Twenty good lines that nothing else
// could reach. So every other settings screen went on building its own out of
// bare <select> and <input>, with a paragraph of grey helper text under each
// one, and none of them look like the app.
//
// This is that pattern, promoted so the other screens can use it. It is not a
// new design -- it is the design that already works, made reusable.
//
// The shape of a row is the whole idea: an icon, a name, ONE line of hint, and
// exactly one control on the right. If a setting needs a paragraph to explain
// it, the setting is wrong or the paragraph belongs in Help.
import React from 'react';

// A card of rows. `title` is the small-caps section label above it.
export function SettingGroup({ title, hint, children, className = '' }) {
  return (
    <section className={`mb-5 ${className}`}>
      {title ? (
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-2">
          {title}
        </h3>
      ) : null}
      <div className="bg-cq-milk rounded-cq-lg shadow-cq-card px-4">
        {children}
      </div>
      {hint ? <p className="text-sm text-cq-ink-3 mt-2">{hint}</p> : null}
    </section>
  );
}

// One setting: icon, name, one-line hint, one control.
export function SettingRow({ Icon, label, hint, children, stack = false }) {
  return (
    <div className={`flex gap-3 py-3 border-b border-cq-line last:border-0 ${
      stack ? 'flex-col items-stretch' : 'items-center'}`}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {Icon ? (
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-cq-md bg-cq-caramel-wash text-cq-roast flex-shrink-0">
            <Icon size={20} strokeWidth={2.25} />
          </span>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="font-bold text-cq-roast leading-tight">{label}</div>
          {hint ? <div className="text-sm text-cq-ink-3">{hint}</div> : null}
        </div>
        {!stack ? <div className="flex items-center gap-2 flex-shrink-0">{children}</div> : null}
      </div>
      {stack ? <div className="flex items-center gap-2 flex-wrap">{children}</div> : null}
    </div>
  );
}

// On / Off. Reads as a word, not a switch you have to interpret.
export function Toggle({ on, onChange, labels = ['Off', 'On'], disabled = false }) {
  return (
    <button
      type="button" role="switch" aria-checked={!!on} disabled={disabled}
      onClick={() => onChange && onChange(!on)}
      className={`h-10 px-3 rounded-full font-bold text-sm min-w-[4.5rem] disabled:opacity-40 ${
        on ? 'bg-cq-caramel text-white' : 'bg-cq-wash text-cq-ink-2'}`}
    >
      {on ? labels[1] : labels[0]}
    </button>
  );
}

// A short list of choices, shown as one control. Replaces a <select> whenever
// there are five options or fewer -- a dropdown hides its own contents, and
// on a bench that costs a tap and a squint.
export function Segmented({ value, options, onChange, size = 'md' }) {
  const h = size === 'sm' ? 'h-9 px-2.5 text-sm' : 'h-10 px-3';
  return (
    <div className="inline-flex rounded-cq-md bg-cq-wash p-0.5 gap-0.5">
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        const on = String(v) === String(value);
        return (
          <button
            key={String(v)} type="button" onClick={() => onChange && onChange(v)}
            aria-pressed={on}
            className={`${h} rounded-cq-sm font-bold leading-none transition-colors ${
              on ? 'bg-cq-caramel text-white' : 'text-cq-ink-2 hover:text-cq-roast'}`}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

// For longer lists, where Segmented would wrap. Styled, not bare.
export function SelectRow({ value, options, onChange, ariaLabel }) {
  return (
    <select
      value={value} aria-label={ariaLabel}
      onChange={(e) => onChange && onChange(e.target.value)}
      className="h-10 rounded-cq-md border-2 border-cq-line bg-cq-milk px-3 pr-8
                 font-semibold text-cq-roast max-w-[16rem] truncate
                 focus:border-cq-caramel focus:outline-none"
    >
      {options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return <option key={String(v)} value={v}>{l}</option>;
      })}
    </select>
  );
}

// Controlled (`value` + `onChange`) or uncontrolled (`defaultValue` +
// `onBlur`). The uncontrolled form matters: several fields here save on blur
// on purpose, so typing does not fire a PUT per keystroke. Anything else --
// disabled, maxLength, inputMode -- passes straight through.
export function TextField({ value, onChange, placeholder, type = 'text',
                            width = 'w-full max-w-xs', ...rest }) {
  const controlled = value !== undefined && typeof onChange === 'function';
  return (
    <input
      type={type} placeholder={placeholder}
      {...(controlled ? { value, onChange: (e) => onChange(e.target.value) } : {})}
      {...rest}
      className={`${width} h-10 rounded-cq-md border-2 border-cq-line bg-cq-milk px-3
                  text-cq-roast placeholder:text-cq-ink-3
                  focus:border-cq-caramel focus:outline-none disabled:opacity-50`}
    />
  );
}

// The one place a longer explanation belongs: under the group, once, not under
// every field.
export function SettingNote({ children }) {
  return <p className="text-sm text-cq-ink-3 leading-relaxed">{children}</p>;
}
