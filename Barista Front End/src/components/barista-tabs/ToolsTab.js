// Barista Tools — a self-contained set of on-the-floor helpers. No backend,
// no network: everything here works even if the connection drops mid-event.
// Shot timer, drink recipes ("how do I make X"), dial-in helper, milk guide,
// tally counter, unit converter.
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Timer, BookOpen, Sliders, Milk, Hash, Ruler, Search,
  Plus, Minus, RotateCcw,
} from 'lucide-react';

// ── Shot timer ──────────────────────────────────────────────────────────
const ShotTimer = () => {
  const [running, setRunning] = useState(false);
  const [ms, setMs] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    startRef.current = Date.now() - ms;
    const id = setInterval(() => setMs(Date.now() - startRef.current), 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const secs = ms / 1000;
  const tone = secs === 0 ? 'text-gray-800'
    : secs < 25 ? 'text-amber-600'
    : secs <= 32 ? 'text-green-600'
    : 'text-red-600';

  return (
    <div className="flex flex-col items-center py-6">
      <div className={`font-mono font-bold tabular-nums ${tone}`} style={{ fontSize: '4.5rem', lineHeight: 1 }}>
        {secs.toFixed(1)}<span className="text-3xl">s</span>
      </div>
      <div className="text-sm text-gray-500 mt-2">Target espresso shot: 25–32 seconds</div>
      <div className="flex gap-3 mt-6">
        <button
          onClick={() => setRunning(r => !r)}
          className={`px-10 py-3 rounded-lg text-white font-semibold text-lg transition-colors ${running ? 'bg-red-500 hover:bg-red-600' : 'bg-green-600 hover:bg-green-700'}`}
        >
          {running ? 'Stop' : 'Start'}
        </button>
        <button
          onClick={() => { setRunning(false); setMs(0); }}
          className="px-6 py-3 rounded-lg bg-gray-200 hover:bg-gray-300 font-semibold text-lg flex items-center"
        >
          <RotateCcw size={18} className="mr-1" /> Reset
        </button>
      </div>
    </div>
  );
};

// ── Drink recipes ───────────────────────────────────────────────────────
// AU/NZ cafe conventions. Concise method per drink so a barista can answer a
// customer ("what's a magic?") and make it. Times/ratios are guides, not gospel.
const RECIPES = [
  { name: 'Espresso', aka: ['short black', 'shot'], cup: '~30ml / demitasse',
    method: '1 shot, ~25–32s extraction. Served on its own.' },
  { name: 'Doppio', aka: ['double espresso'], cup: '~60ml',
    method: 'Double shot, no water or milk.' },
  { name: 'Ristretto', aka: ['short shot'], cup: '~15–20ml',
    method: 'Espresso cut short — same dose, less water. Sweeter, more intense.' },
  { name: 'Long Black', aka: ['longblack'], cup: '6–8oz',
    method: 'Hot water in the cup FIRST (~2/3), then pour a double shot on top to keep the crema.' },
  { name: 'Americano', aka: [], cup: '8oz',
    method: 'Double shot, then top with hot water. Similar to a long black but more diluted.' },
  { name: 'Macchiato', aka: ['short macchiato', 'long macchiato'], cup: 'demitasse / glass',
    method: 'Espresso "stained" with a dollop of textured milk. Short = 1 shot; long = 2 shots with a touch more milk.' },
  { name: 'Piccolo', aka: ['piccolo latte'], cup: '~90ml glass',
    method: '1 ristretto shot + ~60ml steamed milk with thin microfoam. Like a mini, strong latte.' },
  { name: 'Cortado', aka: [], cup: '~120ml glass',
    method: 'Equal parts espresso and warm steamed milk (≈1:1), minimal foam.' },
  { name: 'Flat White', aka: ['flatwhite', 'fw'], cup: '5–6oz',
    method: '1–2 shots + steamed milk with a thin (~5mm) glossy microfoam. No dry foam.' },
  { name: 'Latte', aka: ['cafe latte'], cup: '8oz glass',
    method: '1 shot + lots of steamed milk + ~1cm of foam on top.' },
  { name: 'Cappuccino', aka: ['cap', 'cappucino'], cup: '6oz',
    method: 'Roughly equal thirds: espresso / steamed milk / thick foam. Dust with chocolate.' },
  { name: 'Magic', aka: [], cup: '5–6oz',
    method: 'Melbourne style: DOUBLE RISTRETTO + steamed milk in a 5–6oz cup. Like a stronger, smaller flat white.' },
  { name: 'Mocha', aka: ['mochaccino', 'caffe mocha'], cup: '8oz',
    method: 'Chocolate + 1 shot, mixed, then steamed milk (like a chocolate latte).' },
  { name: 'Affogato', aka: [], cup: 'glass / bowl',
    method: 'A scoop of vanilla ice cream "drowned" with a hot shot of espresso poured over.' },
  { name: 'Chai Latte', aka: ['chai'], cup: '8oz',
    method: 'Chai (syrup or brewed) + steamed milk. No coffee unless a "dirty chai" (add a shot).' },
  { name: 'Hot Chocolate', aka: ['hotchoc', 'hot choc'], cup: '8oz',
    method: 'Chocolate + steamed milk. No coffee. Dust on top.' },
  { name: 'Babyccino', aka: ['babycino'], cup: 'small',
    method: 'Just warm (not hot) frothed milk + chocolate dust. For kids — no coffee.' },
  { name: 'Filter', aka: ['batch brew', 'filter coffee', 'drip'], cup: '8–12oz',
    method: 'Brewed batch/filter coffee, served black (milk on the side if asked).' },
];

const Recipes = () => {
  const [q, setQ] = useState('');
  const [openName, setOpenName] = useState(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return RECIPES;
    return RECIPES.filter(r =>
      r.name.toLowerCase().includes(s) || r.aka.some(a => a.includes(s))
    );
  }, [q]);

  return (
    <div className="py-4 max-w-xl mx-auto">
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a drink — e.g. magic, americano, piccolo…"
          className="w-full pl-9 pr-3 py-2 border rounded-lg"
          autoFocus
        />
      </div>
      {results.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">
          No match. Try the closest standard drink (e.g. "latte", "long black").
        </p>
      ) : (
        <ul className="space-y-2">
          {results.map(r => {
            const open = openName === r.name;
            return (
              <li key={r.name} className="border rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenName(open ? null : r.name)}
                  className="w-full flex justify-between items-center px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-gray-400">{r.cup}</span>
                </button>
                {open && (
                  <div className="px-3 pb-3 text-sm text-gray-700 bg-gray-50">
                    {r.method}
                    {r.aka.length > 0 && (
                      <div className="text-xs text-gray-400 mt-1">also: {r.aka.join(', ')}</div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// ── Dial-in helper ──────────────────────────────────────────────────────
const DialIn = () => {
  const [dose, setDose] = useState(18);
  const [yieldG, setYieldG] = useState(36);
  const ratio = dose > 0 ? (yieldG / dose) : 0;

  return (
    <div className="py-4 max-w-xl mx-auto space-y-5">
      <div>
        <h4 className="font-semibold mb-2">Brew ratio</h4>
        <div className="flex items-end gap-3">
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">Dose in (g)</span>
            <input type="number" min="1" step="0.5" value={dose}
              onChange={(e) => setDose(parseFloat(e.target.value) || 0)}
              className="w-24 px-2 py-1 border rounded" />
          </label>
          <span className="pb-2 text-gray-400">→</span>
          <label className="text-sm">
            <span className="block text-gray-500 mb-1">Yield out (g)</span>
            <input type="number" min="1" step="1" value={yieldG}
              onChange={(e) => setYieldG(parseFloat(e.target.value) || 0)}
              className="w-24 px-2 py-1 border rounded" />
          </label>
          <div className="pb-1 ml-2">
            <div className="text-2xl font-bold text-amber-700">1:{ratio.toFixed(2)}</div>
            <div className="text-xs text-gray-500">
              {ratio < 1.7 ? 'ristretto / strong' : ratio <= 2.2 ? 'classic espresso' : 'lungo / long'}
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">Classic target ≈ 1:2 (e.g. 18g → 36g) in 25–32s.</p>
      </div>

      <div>
        <h4 className="font-semibold mb-2">Tastes off? Adjust the grind</h4>
        <div className="space-y-2 text-sm">
          <div className="border rounded-lg px-3 py-2 bg-amber-50 border-amber-200">
            <span className="font-medium text-amber-800">Sour / sharp / thin</span> — under-extracted.
            Grind <b>FINER</b> (or increase dose / time). Shot likely ran too fast.
          </div>
          <div className="border rounded-lg px-3 py-2 bg-orange-50 border-orange-200">
            <span className="font-medium text-orange-900">Bitter / harsh / dry</span> — over-extracted.
            Grind <b>COARSER</b> (or reduce dose / time). Shot likely ran too slow.
          </div>
          <div className="border rounded-lg px-3 py-2 bg-gray-50">
            <span className="font-medium">Shot timing:</span> too fast (&lt;20s) → grind finer;
            too slow (&gt;35s) → grind coarser. Change ONE thing at a time.
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Milk guide ──────────────────────────────────────────────────────────
const MILK = [
  { drink: 'Flat white / Magic', foam: 'Thin glossy microfoam (~5mm)', temp: '60–65°C' },
  { drink: 'Latte', foam: 'Light foam (~1cm)', temp: '60–65°C' },
  { drink: 'Cappuccino', foam: 'Thick, airy foam (~1/3)', temp: '60–65°C' },
  { drink: 'Piccolo / Cortado', foam: 'Small amount, silky', temp: '60–65°C' },
  { drink: 'Babyccino', foam: 'Mostly froth', temp: 'Warm only (~40°C)' },
];

const MilkGuide = () => (
  <div className="py-4 max-w-xl mx-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-gray-500 text-left">
          <th className="py-2">Drink</th><th className="py-2">Texture</th><th className="py-2">Temp</th>
        </tr>
      </thead>
      <tbody>
        {MILK.map(m => (
          <tr key={m.drink} className="border-b last:border-b-0">
            <td className="py-2 font-medium">{m.drink}</td>
            <td className="py-2 text-gray-700">{m.foam}</td>
            <td className="py-2 text-gray-700">{m.temp}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className="text-xs text-gray-400 mt-3">
      Don't exceed ~70°C — milk scalds and loses sweetness. Stretch (air) at the start,
      then submerge the wand tip to roll and polish the texture.
    </p>
  </div>
);

// ── Tally counter ───────────────────────────────────────────────────────
const Tally = () => {
  const KEY = 'barista_tally_count';
  const [n, setN] = useState(() => {
    try { return parseInt(localStorage.getItem(KEY), 10) || 0; } catch (_) { return 0; }
  });
  const set = (v) => {
    const next = Math.max(0, v);
    setN(next);
    try { localStorage.setItem(KEY, String(next)); } catch (_) { /* private mode */ }
  };
  return (
    <div className="flex flex-col items-center py-8">
      <div className="text-7xl font-bold tabular-nums mb-6">{n}</div>
      <div className="flex items-center gap-4">
        <button onClick={() => set(n - 1)}
          className="w-16 h-16 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center">
          <Minus size={28} />
        </button>
        <button onClick={() => set(n + 1)}
          className="w-24 h-24 rounded-full bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center">
          <Plus size={40} />
        </button>
      </div>
      <button onClick={() => set(0)} className="mt-6 text-sm text-gray-500 hover:text-gray-800 flex items-center">
        <RotateCcw size={14} className="mr-1" /> Reset
      </button>
      <p className="text-xs text-gray-400 mt-2">Saved on this device — survives a tab switch.</p>
    </div>
  );
};

// ── Unit converter ──────────────────────────────────────────────────────
const Convert = () => {
  const [oz, setOz] = useState(8);
  const ml = (parseFloat(oz) || 0) * 29.5735;
  return (
    <div className="py-4 max-w-xl mx-auto space-y-5">
      <div>
        <h4 className="font-semibold mb-2">Ounces ↔ millilitres</h4>
        <div className="flex items-center gap-2 text-sm">
          <input type="number" min="0" step="0.5" value={oz}
            onChange={(e) => setOz(e.target.value)}
            className="w-24 px-2 py-1 border rounded" />
          <span className="text-gray-500">fl oz =</span>
          <span className="text-xl font-bold text-amber-700">{Math.round(ml)} ml</span>
        </div>
      </div>
      <div>
        <h4 className="font-semibold mb-2">Common cup sizes</h4>
        <table className="w-full text-sm max-w-xs">
          <tbody>
            {[['Small', '8oz', '~237 ml'], ['Medium', '12oz', '~355 ml'], ['Large', '16oz', '~473 ml']].map(([s, o, m]) => (
              <tr key={o} className="border-b last:border-b-0">
                <td className="py-1.5">{s}</td>
                <td className="py-1.5 text-gray-700">{o}</td>
                <td className="py-1.5 text-gray-500 text-right">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Container ───────────────────────────────────────────────────────────
const TOOLS = [
  { id: 'timer',  label: 'Shot timer', Icon: Timer,    render: () => <ShotTimer /> },
  { id: 'recipes', label: 'Recipes',   Icon: BookOpen, render: () => <Recipes /> },
  { id: 'dialin', label: 'Dial-in',    Icon: Sliders,  render: () => <DialIn /> },
  { id: 'milk',   label: 'Milk',       Icon: Milk,     render: () => <MilkGuide /> },
  { id: 'tally',  label: 'Tally',      Icon: Hash,     render: () => <Tally /> },
  { id: 'convert', label: 'Convert',   Icon: Ruler,    render: () => <Convert /> },
];

const ToolsTab = () => {
  const [tool, setTool] = useState('timer');
  const active = TOOLS.find(t => t.id === tool) || TOOLS[0];
  return (
    <div>
      <div className="mb-3">
        <h2 className="text-xl font-bold">Barista tools</h2>
        <p className="text-sm text-gray-500">Handy on-the-floor helpers — these all work offline.</p>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center ${tool === t.id ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            <t.Icon size={15} className="mr-1.5" /> {t.label}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-lg shadow-sm p-3">
        {active.render()}
      </div>
    </div>
  );
};

export default ToolsTab;
