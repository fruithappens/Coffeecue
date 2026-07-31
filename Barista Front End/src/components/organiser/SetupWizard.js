// SetupWizard.js — the guided questionnaire ("Steve mode: no menus").
//
// One question per screen, plain language, progress + time estimate,
// resumable draft. Ends in a review + Apply that writes through the
// SAME real endpoints the normal screens use — never a parallel store:
//   - event name / sponsor  -> PUT /api/settings/branding (KV blob)
//   - station count         -> POST /api/stations (station_stats; adds
//                              only — the wizard NEVER deletes stations)
//   - menu (milks/sizes/sugars/drinks/teas) + schedule mode
//                           -> POST /api/quick-setup (the proven engine
//                              behind the one-page Quick Setup)
//   - roasts/beans          -> POST /api/inventory rows (coffee, kg)
//
// Everything here is re-editable later in the normal menus; the done
// screen says where each answer lives.
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ClipboardList, X } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import SettingsService from '../../services/SettingsService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();

const DRAFT_KEY = 'setup_wizard_draft';

const MILKS = ['full cream', 'skim', 'oat', 'almond', 'lactose free',
               'soy', 'coconut', 'macadamia'];
const SIZES = ['small', 'medium', 'large'];
const SUGARS = ['no sugar', '1 sugar', '2 sugar', '3 sugar', 'half sugar'];
const EXTRA_DRINKS = [
  { key: 'hot_chocolate', label: 'Hot Chocolate' },
  { key: 'chai', label: 'Chai Latte' },
  { key: 'matcha', label: 'Matcha Latte' },
];
const TEAS = [
  { key: 'english_breakfast', label: 'English Breakfast' },
  { key: 'earl_grey', label: 'Earl Grey' },
  { key: 'green', label: 'Green Tea' },
  { key: 'peppermint', label: 'Peppermint' },
  { key: 'chamomile', label: 'Chamomile' },
  { key: 'lemon_ginger', label: 'Lemon & Ginger' },
  { key: 'rooibos', label: 'Rooibos' },
];

const DEFAULT_ANSWERS = {
  eventName: '',
  sponsorName: '',
  stationCount: 2,
  sizes: ['medium'],
  sameMilks: true,
  milks: ['full cream', 'skim', 'oat', 'almond'],
  roasts: ['House blend'],
  wantExtraDrinks: false,
  extraDrinks: { hot_chocolate: true, chai: false, matcha: false },
  wantTeas: false,
  teas: {},
  customTeas: '',
  sugars: ['no sugar', '1 sugar', '2 sugar'],
  hours: 'always', // 'always' | 'later'
};

const STEPS = [
  'welcome', 'event', 'stations', 'sizes', 'same-milks', 'milks',
  'roasts', 'extra-drinks', 'teas', 'sugars', 'hours', 'review',
];

const SetupWizard = ({ onClose }) => {
  const [answers, setAnswers] = useState(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) return { ...DEFAULT_ANSWERS, ...JSON.parse(saved) };
    } catch (e) { /* fresh draft */ }
    return { ...DEFAULT_ANSWERS };
  });
  const [stepIdx, setStepIdx] = useState(() => {
    try {
      const saved = localStorage.getItem(`${DRAFT_KEY}_step`);
      const n = parseInt(saved, 10);
      if (Number.isFinite(n) && n >= 0 && n < STEPS.length) return n;
    } catch (e) { /* start at 0 */ }
    return 0;
  });
  const [existingStations, setExistingStations] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyLog, setApplyLog] = useState([]);
  const [doneOk, setDoneOk] = useState(false);

  // Persist the draft on every change so "come back and edit down the
  // track" just works.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(answers));
      localStorage.setItem(`${DRAFT_KEY}_step`, String(stepIdx));
    } catch (e) { /* draft loss is survivable */ }
  }, [answers, stepIdx]);

  // Prefill event name + count existing stations (honesty: the wizard
  // adds stations, never deletes).
  useEffect(() => {
    (async () => {
      try {
        const b = await SettingsService.getBrandingSettings();
        setAnswers(a => ({
          ...a,
          eventName: a.eventName || b?.eventName || b?.event_name || '',
          sponsorName: a.sponsorName || b?.sponsorName || '',
        }));
      } catch (e) { /* blank is fine */ }
      try {
        const r = await api.request('/stations');
        const list = r?.stations || r?.data || [];
        setExistingStations(Array.isArray(list) ? list.length : null);
      } catch (e) { setExistingStations(null); }
    })();
  }, []);

  const step = STEPS[stepIdx];
  const set = (patch) => setAnswers(a => ({ ...a, ...patch }));
  const toggleIn = (key, value) => setAnswers(a => {
    const cur = new Set(a[key]);
    if (cur.has(value)) cur.delete(value); else cur.add(value);
    return { ...a, [key]: Array.from(cur) };
  });

  // Milks step is skipped-from by the same-milks question only in the
  // sense of wording; both paths still pick milks (per-station tuning
  // happens in Station Capabilities afterwards — the done screen says
  // so when they answered "no").
  const next = () => setStepIdx(i => Math.min(i + 1, STEPS.length - 1));
  const back = () => setStepIdx(i => Math.max(i - 1, 0));

  const canNext = useMemo(() => {
    if (step === 'event') return answers.eventName.trim().length >= 2;
    if (step === 'sizes') return answers.sizes.length > 0;
    if (step === 'milks') return answers.milks.length > 0;
    if (step === 'sugars') return answers.sugars.length > 0;
    if (step === 'roasts') return answers.roasts.filter(r => r.trim()).length > 0;
    return true;
  }, [step, answers]);

  const log = (line, ok = true) =>
    setApplyLog(l => [...l, { line, ok }]);

  const apply = async () => {
    setApplying(true);
    setApplyLog([]);
    let allOk = true;
    // 1. Branding: event name + sponsor.
    try {
      await SettingsService.updateBrandingSettings({
        eventName: answers.eventName.trim(),
        ...(answers.sponsorName.trim()
          ? { sponsorName: answers.sponsorName.trim(), showSponsor: true }
          : {}),
      });
      log(`Event name set to "${answers.eventName.trim()}"`
          + (answers.sponsorName.trim() ? ` · sponsor "${answers.sponsorName.trim()}"` : ''));
    } catch (e) {
      allOk = false;
      log(`Event name/sponsor save failed: ${e?.message || 'unknown'}`, false);
    }
    // 2. Stations: add up to the requested count. Never delete.
    try {
      const r = await api.request('/stations');
      const current = (r?.stations || r?.data || []).length;
      const toAdd = Math.max(0, answers.stationCount - current);
      for (let i = 0; i < toAdd; i++) {
        // eslint-disable-next-line no-await-in-loop
        await api.request('/stations', {
          method: 'POST',
          body: JSON.stringify({ name: `Coffee Station ${current + i + 1}` }),
        });
      }
      log(toAdd > 0
        ? `Added ${toAdd} station(s) (you now have ${current + toAdd})`
        : `Stations: you already have ${current} — none added, none removed`);
    } catch (e) {
      allOk = false;
      log(`Station setup failed: ${e?.message || 'unknown'}`, false);
    }
    // 3. The menu engine (same one behind Quick Setup).
    try {
      const teas = {};
      TEAS.forEach(t => { teas[t.key] = !!(answers.wantTeas && answers.teas[t.key]); });
      teas.generic = false;
      const preset = {
        milks: answers.milks,
        sizes: answers.sizes,
        sweeteners: answers.sugars,
        drinks: {
          espresso_drinks: true,
          hot_chocolate: !!(answers.wantExtraDrinks && answers.extraDrinks.hot_chocolate),
          chai: !!(answers.wantExtraDrinks && answers.extraDrinks.chai),
          matcha: !!(answers.wantExtraDrinks && answers.extraDrinks.matcha),
        },
        teas,
        custom_teas: answers.wantTeas ? answers.customTeas : '',
        unlimited_stock: true,
        all_stations_same_capabilities: true,
        always_open_schedule: answers.hours === 'always',
        vip_code: '',              // preserve whatever is saved
        activate_all_stations: true,
      };
      const res = await api.request('/quick-setup', {
        method: 'POST', body: JSON.stringify(preset),
      });
      if (res?.success === false) throw new Error(res?.message || 'quick-setup refused');
      log(`Menu built: ${answers.milks.length} milk(s), ${answers.sizes.length} size(s), `
          + `espresso drinks${answers.wantExtraDrinks ? ' + extras' : ''}`
          + `${answers.wantTeas ? ' + teas' : ''} · all stations activated`);
    } catch (e) {
      allOk = false;
      log(`Menu build failed: ${e?.message || 'unknown'}`, false);
    }
    // 4. Roasts as bean inventory rows (skip names that already exist).
    try {
      const roasts = answers.roasts.map(r => r.trim()).filter(Boolean);
      const inv = await api.request('/inventory');
      const rows = inv?.items || inv?.data || [];
      const flat = Array.isArray(rows) ? rows
        : Object.values(rows).flat();
      const existing = new Set(flat
        .filter(x => String(x.category || '').toLowerCase() === 'coffee')
        .map(x => String(x.name || '').toLowerCase()));
      let added = 0;
      for (const roast of roasts) {
        if (existing.has(roast.toLowerCase())) continue;
        // eslint-disable-next-line no-await-in-loop
        await api.request('/inventory', {
          method: 'POST',
          body: JSON.stringify({
            name: roast, category: 'coffee',
            amount: 5, capacity: 5, unit: 'kg',
          }),
        });
        added += 1;
      }
      log(`Roasts: ${roasts.join(', ')}${added ? ` (${added} new bean row(s) at 5kg)` : ' (already stocked)'}`);
    } catch (e) {
      allOk = false;
      log(`Roast/bean rows failed: ${e?.message || 'unknown'}`, false);
    }
    setApplying(false);
    setDoneOk(allOk);
    if (allOk) {
      try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(`${DRAFT_KEY}_step`); } catch (e) { /* noop */ }
      showToast('Guided setup applied', 'success');
    } else {
      showToast('Setup finished with problems - see the list', 'warning', 6000);
    }
  };

  // ---------- rendering helpers ----------
  const Q = ({ title, sub, children }) => (
    <div>
      <h2 className="text-2xl font-bold mb-1">{title}</h2>
      {sub && <p className="text-gray-500 mb-4">{sub}</p>}
      {children}
    </div>
  );

  const CheckRow = ({ checked, onChange, label }) => (
    <label className="flex items-center space-x-3 py-2 px-3 rounded-lg hover:bg-gray-50 cursor-pointer text-lg">
      <input type="checkbox" className="w-5 h-5" checked={checked} onChange={onChange} />
      <span className="capitalize">{label}</span>
    </label>
  );

  const YesNo = ({ value, onChange, yesLabel = 'Yes', noLabel = 'No' }) => (
    <div className="flex gap-3">
      {[[true, yesLabel], [false, noLabel]].map(([v, lbl]) => (
        <button key={String(v)}
          className={`flex-1 py-4 rounded-xl text-lg font-semibold border-2 ${
            value === v ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}
          onClick={() => onChange(v)}>
          {lbl}
        </button>
      ))}
    </div>
  );

  const body = () => {
    switch (step) {
      case 'welcome':
        return (
          <Q title="Set up your event by answering a few questions"
             sub="About 3 minutes. Nothing here is final — every answer can be changed later in the normal menus, and your progress saves automatically if you step away.">
            <ul className="list-disc ml-6 text-gray-600 space-y-1">
              <li>Event name and sponsor</li>
              <li>Stations, cup sizes, milks and roasts</li>
              <li>Hot chocolate, chai and teas</li>
              <li>Opening hours</li>
            </ul>
          </Q>
        );
      case 'event':
        return (
          <Q title="What's the event called?"
             sub="Shown on the customer displays, SMS messages and cup labels.">
            <input className="w-full border-2 rounded-xl px-4 py-3 text-xl mb-4"
              value={answers.eventName} placeholder="e.g. Treenet 2026"
              onChange={e => set({ eventName: e.target.value })} />
            <label className="text-gray-600 text-sm">Sponsor to credit (optional — appears on screens and the ready SMS)</label>
            <input className="w-full border-2 rounded-xl px-4 py-3 text-lg mt-1"
              value={answers.sponsorName} placeholder="e.g. Platinum Sponsor XYZ"
              onChange={e => set({ sponsorName: e.target.value })} />
          </Q>
        );
      case 'stations':
        return (
          <Q title="How many coffee stations will this event run?"
             sub={existingStations != null
               ? `You currently have ${existingStations}. The wizard only ADDS stations — it never deletes any.`
               : 'The wizard only adds stations — it never deletes any.'}>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <button key={n}
                  className={`w-14 h-14 rounded-xl text-xl font-bold border-2 ${
                    answers.stationCount === n ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'}`}
                  onClick={() => set({ stationCount: n })}>{n}</button>
              ))}
            </div>
          </Q>
        );
      case 'sizes':
        return (
          <Q title="What cup sizes will you offer?">
            {SIZES.map(s => (
              <CheckRow key={s} label={s}
                checked={answers.sizes.includes(s)}
                onChange={() => toggleIn('sizes', s)} />
            ))}
          </Q>
        );
      case 'same-milks':
        return (
          <Q title="Will every station offer the same milks?"
             sub={'If some stations differ (say, one station carries all the alternative milks), pick "No" - you\'ll fine-tune per station afterwards in Station Capabilities.'}>
            <YesNo value={answers.sameMilks} onChange={v => set({ sameMilks: v })}
              yesLabel="Yes - same everywhere" noLabel="No - varies by station" />
          </Q>
        );
      case 'milks':
        return (
          <Q title={answers.sameMilks ? 'Which milks will you offer?'
              : 'Which milks will the event offer overall?'}
             sub={answers.sameMilks ? undefined
               : 'The wizard gives every station this full list to start with; trim individual stations afterwards in Station Capabilities (the done screen links there).'}>
            {MILKS.map(m => (
              <CheckRow key={m} label={m}
                checked={answers.milks.includes(m)}
                onChange={() => toggleIn('milks', m)} />
            ))}
          </Q>
        );
      case 'roasts':
        return (
          <Q title="How many roasts (bean varieties) are you running?"
             sub="Most events run one. Each becomes a bean stock item baristas can report against.">
            {answers.roasts.map((r, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input className="flex-1 border-2 rounded-xl px-4 py-2 text-lg"
                  value={r} placeholder={i === 0 ? 'House blend' : (i === 1 ? 'Decaf' : 'Single origin')}
                  onChange={e => set({ roasts: answers.roasts.map((x, j) => j === i ? e.target.value : x) })} />
                {answers.roasts.length > 1 && (
                  <button className="px-3 text-gray-400 hover:text-red-500"
                    onClick={() => set({ roasts: answers.roasts.filter((_, j) => j !== i) })}>
                    <X size={18} />
                  </button>
                )}
              </div>
            ))}
            {answers.roasts.length < 3 && (
              <button className="text-blue-600 text-sm underline"
                onClick={() => set({ roasts: [...answers.roasts, ''] })}>
                + add another roast
              </button>
            )}
          </Q>
        );
      case 'extra-drinks':
        return (
          <Q title="Besides coffee, will you sell hot chocolate, chai or matcha?">
            <YesNo value={answers.wantExtraDrinks} onChange={v => set({ wantExtraDrinks: v })} />
            {answers.wantExtraDrinks && (
              <div className="mt-4">
                {EXTRA_DRINKS.map(d => (
                  <CheckRow key={d.key} label={d.label}
                    checked={!!answers.extraDrinks[d.key]}
                    onChange={() => set({ extraDrinks: { ...answers.extraDrinks, [d.key]: !answers.extraDrinks[d.key] } })} />
                ))}
              </div>
            )}
          </Q>
        );
      case 'teas':
        return (
          <Q title="Will you serve tea?">
            <YesNo value={answers.wantTeas} onChange={v => set({ wantTeas: v })} />
            {answers.wantTeas && (
              <div className="mt-4">
                {TEAS.map(t => (
                  <CheckRow key={t.key} label={t.label}
                    checked={!!answers.teas[t.key]}
                    onChange={() => set({ teas: { ...answers.teas, [t.key]: !answers.teas[t.key] } })} />
                ))}
                <label className="text-gray-600 text-sm mt-2 block">Other blends (comma-separated)</label>
                <input className="w-full border-2 rounded-xl px-4 py-2 text-lg mt-1"
                  value={answers.customTeas} placeholder="e.g. Oolong, Jasmine"
                  onChange={e => set({ customTeas: e.target.value })} />
              </div>
            )}
          </Q>
        );
      case 'sugars':
        return (
          <Q title="Sugar options for the menu?">
            {SUGARS.map(s => (
              <CheckRow key={s} label={s}
                checked={answers.sugars.includes(s)}
                onChange={() => toggleIn('sugars', s)} />
            ))}
          </Q>
        );
      case 'hours':
        return (
          <Q title="When can people order?"
             sub="Always open is right for most events - baristas pause their own station when they break.">
            <YesNo value={answers.hours === 'always'}
              onChange={v => set({ hours: v ? 'always' : 'later' })}
              yesLabel={'Always open'}
              noLabel={"I'll set a schedule afterwards"} />
          </Q>
        );
      case 'review':
        return (
          <Q title="Ready to build it?"
             sub="This writes your answers into the live system. Everything remains editable in the normal menus.">
            <ul className="space-y-1 text-lg mb-4">
              <li><b>{answers.eventName || '—'}</b>{answers.sponsorName ? ` · sponsored by ${answers.sponsorName}` : ''}</li>
              <li>{answers.stationCount} station(s){existingStations != null ? ` (currently ${existingStations} - additions only)` : ''}</li>
              <li>Sizes: {answers.sizes.join(', ')}</li>
              <li>Milks: {answers.milks.join(', ')}{answers.sameMilks ? '' : ' (then per-station tuning)'}</li>
              <li>Roasts: {answers.roasts.filter(r => r.trim()).join(', ')}</li>
              <li>Extras: {answers.wantExtraDrinks
                ? EXTRA_DRINKS.filter(d => answers.extraDrinks[d.key]).map(d => d.label).join(', ') || 'none picked'
                : 'no'}</li>
              <li>Teas: {answers.wantTeas
                ? [...TEAS.filter(t => answers.teas[t.key]).map(t => t.label),
                   ...(answers.customTeas ? [answers.customTeas] : [])].join(', ') || 'none picked'
                : 'no'}</li>
              <li>Sugars: {answers.sugars.join(', ')}</li>
              <li>Hours: {answers.hours === 'always' ? 'always open' : 'schedule to be set afterwards'}</li>
            </ul>
            {applyLog.length > 0 && (
              <div className="bg-gray-50 border rounded-xl p-3 mb-3 text-sm space-y-1">
                {applyLog.map((l, i) => (
                  <div key={i} className={l.ok ? 'text-gray-700' : 'text-red-600 font-semibold'}>
                    {l.ok ? '✓' : '✗'} {l.line}
                  </div>
                ))}
              </div>
            )}
            {doneOk ? (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="font-bold text-green-800 mb-1 flex items-center">
                  <Check className="mr-1" size={18} /> Your event is set up
                </div>
                <div className="text-sm text-green-900">
                  Change anything later: event name &amp; sponsor in <b>Branding</b>,
                  stations in <b>Stations</b>, the menu in <b>Inventory</b>
                  {answers.sameMilks ? '' : <>, per-station milks in <b>Station Capabilities</b></>}
                  {answers.hours === 'later' ? <>, and opening hours in <b>Schedule</b></> : ''}.
                </div>
              </div>
            ) : (
              <button
                className="w-full py-4 rounded-xl text-xl font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={applying}
                onClick={apply}>
                {applying ? 'Building your event…' : 'Build my event'}
              </button>
            )}
          </Q>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center text-sm text-gray-500">
            <ClipboardList size={16} className="mr-1" />
            Step {stepIdx + 1} of {STEPS.length} · about 3 minutes
          </div>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}
            title="Close - your progress is saved">
            <X size={22} />
          </button>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full mb-6">
          <div className="h-1.5 bg-blue-600 rounded-full transition-all"
            style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }} />
        </div>

        {body()}

        {step !== 'review' && (
          <div className="flex justify-between mt-8">
            <button className="flex items-center px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"
              disabled={stepIdx === 0} onClick={back}>
              <ArrowLeft size={18} className="mr-1" /> Back
            </button>
            <button className="flex items-center px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"
              disabled={!canNext} onClick={next}>
              {step === 'welcome' ? "Let's go" : 'Next'} <ArrowRight size={18} className="ml-1" />
            </button>
          </div>
        )}
        {step === 'review' && !doneOk && (
          <div className="flex justify-start mt-4">
            <button className="flex items-center px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
              onClick={back}>
              <ArrowLeft size={18} className="mr-1" /> Back
            </button>
          </div>
        )}
        {doneOk && (
          <div className="flex justify-end mt-4">
            <button className="px-6 py-2 rounded-lg bg-gray-800 text-white font-semibold"
              onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupWizard;
