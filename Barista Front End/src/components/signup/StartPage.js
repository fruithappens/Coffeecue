// StartPage.js — cupq.app/start: a client signs up for their own CupQ (roadmap X7-9).
//
// One page, no login. What they tell us becomes a saved event (menu, milks,
// sizes, colours, logo) that Steve approves in Runner > System > Enquiries
// and builds with one command. Nothing is built from this page by itself.
import React, { useEffect, useState } from 'react';

const MILKS = ['full cream', 'skim', 'oat', 'almond', 'lactose free', 'soy', 'coconut', 'macadamia'];
const SIZES = ['small', 'medium', 'large'];
const DRINKS = [
  ['espresso_drinks', 'Espresso coffees (latte, flat white, cappuccino...)'],
  ['hot_chocolate', 'Hot chocolate'],
  ['chai', 'Chai latte'],
  ['matcha', 'Matcha latte'],
];
const ZONES = [
  ['Australia/Adelaide', 'Adelaide'], ['Australia/Sydney', 'Sydney / Canberra'], ['Australia/Melbourne', 'Melbourne'],
  ['Australia/Brisbane', 'Brisbane'], ['Australia/Perth', 'Perth'], ['Australia/Hobart', 'Hobart'],
  ['Australia/Darwin', 'Darwin'], ['Pacific/Auckland', 'Auckland'],
];
const PLANS = [
  ['unsure', 'Help me choose'], ['lite', 'Skim'], ['standard', 'Flat White'], ['pro', 'Double Shot'], ['urn', 'The Urn'],
];
const LOGO_MAX = 300 * 1024;

const slugOf = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');

// Shrink a logo to fit: at most 512 px on its long side, PNG (or JPEG if
// the PNG is still too big). SVG isn't accepted: it can carry script.
function readLogo(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) { reject(new Error('Please choose a PNG or JPEG image.')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file couldn't be read."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be read."));
      img.onload = () => {
        const scale = Math.min(1, 512 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let url = c.toDataURL('image/png');
        if (url.length * 0.75 > LOGO_MAX) url = c.toDataURL('image/jpeg', 0.85);
        if (url.length * 0.75 > LOGO_MAX) { reject(new Error('That logo is too big even after shrinking it.')); return; }
        resolve(url);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="text-sm font-semibold text-cq-roast">{label}</span>
    {hint && <span className="block text-xs text-cq-ink-3">{hint}</span>}
    <div className="mt-1">{children}</div>
  </label>
);

const StartPage = () => {
  // The cupq.com.au quote tool links here with ?plan=&attendees=&days=, so
  // what the client just priced arrives filled in.
  const q = (() => { try { return new URLSearchParams(window.location.search); } catch (e) { return new URLSearchParams(); } })();
  const qPlan = PLANS.some(([v]) => v === q.get('plan')) ? q.get('plan') : 'unsure';
  const qPax = (q.get('attendees') || '').replace(/\D/g, '').slice(0, 6);
  const qDays = parseInt(q.get('days'), 10);
  const [f, setF] = useState({
    organisation: '', name: '', email: '', phone: '', event_name: '', slug: '', starts: '', ends: '',
    attendees: qPax, timezone: 'Australia/Adelaide', texts: true, plan: qPlan,
    drinks: { espresso_drinks: true, hot_chocolate: true, chai: true, matcha: false }, teas: false,
    milks: ['full cream', 'skim', 'oat', 'almond'], sizes: ['medium'],
    primary_colour: '#3B2A20', header_colour: '#3B2A20', logo: '',
    notes: qDays > 0 && qDays < 31 ? `From the website quote tool: ${qDays} day${qDays > 1 ? 's' : ''}.` : '',
    agree: false, website: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  // CupQ's own page, not the current event's: don't inherit its tab title.
  useEffect(() => { document.title = 'Get CupQ for your event'; }, []);
  const [status, setStatus] = useState({ phase: 'form', message: '' });

  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const slug = slugTouched ? f.slug : slugOf(f.organisation);

  const pickLogo = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try { set('logo', await readLogo(file)); setStatus({ phase: 'form', message: '' }); }
    catch (err) { set('logo', ''); setStatus({ phase: 'form', message: err.message }); }
  };

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ phase: 'sending', message: '' });
    try {
      const r = await fetch('/api/public/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, slug }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.success) { setStatus({ phase: 'form', message: b.message || 'Sorry, that didn\'t go through.' }); return; }
      setStatus({ phase: 'done', message: b.address || '' });
      window.scrollTo(0, 0);
    } catch (err) {
      setStatus({ phase: 'form', message: 'No connection. Please try again.' });
    }
  };

  const input = 'w-full h-11 px-3 rounded-cq-md border-2 border-cq-line bg-white text-cq-roast';
  if (status.phase === 'done') {
    return (
      <div className="cq min-h-screen bg-cq-cream flex items-center justify-center p-6">
        <div className="bg-cq-milk rounded-cq-xl shadow-cq-card p-8 max-w-lg">
          <h1 className="text-2xl font-extrabold text-cq-roast">Thanks, we've got it</h1>
          <p className="mt-3 text-cq-ink-2">
            We'll be in touch within one business day to confirm pricing and dates. Once you're happy, your CupQ
            is set up with your menu, colours and logo{status.message ? <> at <b>{status.message.replace('https://', '')}</b></> : null}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cq min-h-screen bg-cq-cream py-8 px-4">
      <form onSubmit={submit} className="max-w-2xl mx-auto bg-cq-milk rounded-cq-xl shadow-cq-card p-6 md:p-8 space-y-6" noValidate>
        <div>
          <div className="text-sm font-bold text-cq-caramel-deep tracking-wide">CupQ</div>
          <h1 className="text-3xl font-extrabold text-cq-roast mt-1">Get CupQ for your event</h1>
          <p className="text-cq-ink-2 mt-2">
            Tell us about your event and what you'll serve. We'll confirm pricing and dates with you before
            anything is set up. About 3 minutes.
          </p>
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-bold text-cq-roast">About you</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Organisation"><input className={input} value={f.organisation} onChange={(e) => set('organisation', e.target.value)} autoComplete="organization" /></Field>
            <Field label="Your name"><input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" /></Field>
            <Field label="Email"><input className={input} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /></Field>
            <Field label="Mobile (optional)"><input className={input} type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" /></Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold text-cq-roast">Your event</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Event name" hint="What attendees see, e.g. 'Acme Summit 2027'"><input className={input} value={f.event_name} onChange={(e) => set('event_name', e.target.value)} /></Field>
            <Field label="Web address" hint="Your ordering page">
              <div className="flex items-center gap-1">
                <input className={input} value={slug} onChange={(e) => { setSlugTouched(true); set('slug', slugOf(e.target.value)); }} aria-label="Web address" />
                <span className="text-sm text-cq-ink-2 whitespace-nowrap">.cupq.app</span>
              </div>
            </Field>
            <Field label="First day"><input className={input} type="date" value={f.starts} onChange={(e) => set('starts', e.target.value)} /></Field>
            <Field label="Last day"><input className={input} type="date" value={f.ends} onChange={(e) => set('ends', e.target.value)} /></Field>
            <Field label="About how many people?"><input className={input} inputMode="numeric" value={f.attendees} onChange={(e) => set('attendees', e.target.value)} /></Field>
            <Field label="Where (for the clock)">
              <select className={input} value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold text-cq-roast">What you'll serve</h2>
          <div className="space-y-2">
            {DRINKS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-cq-roast">
                <input type="checkbox" checked={!!f.drinks[k]} onChange={(e) => set('drinks', { ...f.drinks, [k]: e.target.checked })} /> {l}
              </label>
            ))}
            <label className="flex items-center gap-2 text-cq-roast">
              <input type="checkbox" checked={f.teas} onChange={(e) => set('teas', e.target.checked)} /> Tea (English breakfast, Earl Grey, green, peppermint)
            </label>
          </div>
          <div>
            <div className="text-sm font-semibold text-cq-roast">Milks</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mt-1">
              {MILKS.map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-cq-roast capitalize">
                  <input type="checkbox" checked={f.milks.includes(m)} onChange={() => toggle('milks', m)} /> {m}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold text-cq-roast">Cup sizes</div>
            <div className="flex flex-wrap gap-4 mt-1">
              {SIZES.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-cq-roast capitalize">
                  <input type="checkbox" checked={f.sizes.includes(s)} onChange={() => toggle('sizes', s)} /> {s}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-cq-roast">
            <input type="checkbox" checked={f.texts} onChange={(e) => set('texts', e.target.checked)} />
            Attendees can order by text message, and get a text when it's ready
          </label>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold text-cq-roast">Your look</h2>
          <div className="grid md:grid-cols-3 gap-4 items-end">
            <Field label="Main colour"><input type="color" className="h-11 w-full rounded-cq-md border-2 border-cq-line bg-white" value={f.primary_colour} onChange={(e) => set('primary_colour', e.target.value)} /></Field>
            <Field label="Header colour"><input type="color" className="h-11 w-full rounded-cq-md border-2 border-cq-line bg-white" value={f.header_colour} onChange={(e) => set('header_colour', e.target.value)} /></Field>
            <Field label="Logo (PNG or JPEG)"><input type="file" accept="image/png,image/jpeg" onChange={pickLogo} className="text-sm text-cq-ink-2" /></Field>
          </div>
          {f.logo && (
            <div className="rounded-cq-md p-4 flex items-center gap-4" style={{ background: f.header_colour }}>
              <img src={f.logo} alt="Your logo" className="h-12 max-w-[200px] object-contain" />
              <span className="font-bold" style={{ color: '#fff' }}>{f.event_name || 'Your event'}</span>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <Field label="Plan">
            <select className={input} value={f.plan} onChange={(e) => set('plan', e.target.value)}>
              {PLANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Anything else? (optional)">
            <textarea rows={3} className="w-full px-3 py-2 rounded-cq-md border-2 border-cq-line bg-white text-cq-roast" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          {/* Hidden from people; bots fill it in. */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website}
            onChange={(e) => set('website', e.target.value)} style={{ position: 'absolute', left: '-10000px' }} aria-hidden="true" />
          <label className="flex items-start gap-2 text-sm text-cq-roast">
            <input type="checkbox" className="mt-1" checked={f.agree} onChange={(e) => set('agree', e.target.checked)} />
            <span>
              I'm happy for CupQ to contact me about pricing and terms. Nothing is charged or set up until we agree.{' '}
              <a href="/privacy" target="_blank" rel="noopener" className="underline underline-offset-2">How we handle your details</a>
            </span>
          </label>
        </section>

        {status.message && <div role="alert" className="text-sm font-semibold text-cq-alert">{status.message}</div>}
        <button type="submit" disabled={status.phase === 'sending'}
          className="w-full h-12 rounded-cq-md bg-cq-roast text-cq-cream font-extrabold text-lg disabled:opacity-60">
          {status.phase === 'sending' ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default StartPage;
