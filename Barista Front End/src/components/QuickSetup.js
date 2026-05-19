// components/QuickSetup.js
//
// One-page wizard that ends "configuring an event takes 30 clicks".
// Single Apply button POSTs to /api/quick-setup which rebuilds
// inventory, sets the unlimited-stock flag, clones station
// capabilities, and (optionally) clears the break schedule.
//
// Defaults are the operator's "café style" — full cream / skim / oat /
// almond / lactose-free; medium cup only; sugar; espresso-based drinks
// only; everything else off. Operators tweak the checkboxes if they
// need more.
import React, { useEffect, useState } from 'react';
import { Zap, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import ApiServiceClass from '../services/ApiService';

const api = new ApiServiceClass();

const MILK_OPTIONS = ['full cream', 'skim', 'oat', 'almond', 'lactose free',
                      'soy', 'coconut', 'macadamia'];
const SIZE_OPTIONS = ['small', 'medium', 'large'];
const SWEETENER_OPTIONS = ['no sugar', '1 sugar', '2 sugar', '3 sugar', 'half sugar'];
const EXTRA_DRINK_OPTIONS = [
  { key: 'hot_chocolate', label: 'Hot Chocolate' },
  { key: 'chai',          label: 'Chai Latte' },
  { key: 'matcha',        label: 'Matcha Latte' },
  { key: 'tea',           label: 'Tea' },
];

const DEFAULT_STATE = {
  milks: ['full cream', 'skim', 'oat', 'almond', 'lactose free'],
  sizes: ['medium'],
  sweeteners: ['no sugar', '1 sugar', '2 sugar'],
  drinks: {
    espresso_drinks: true,
    hot_chocolate: false,
    chai: false,
    matcha: false,
    tea: false,
  },
  unlimited_stock: true,
  all_stations_same_capabilities: true,
  always_open_schedule: true,
};

const QuickSetup = () => {
  const [config, setConfig] = useState(DEFAULT_STATE);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  // Fetch the server's suggested defaults on mount so the UI stays
  // in sync if we change them later in the backend.
  useEffect(() => {
    api.request('/quick-setup/preset', { method: 'GET' })
       .then(resp => {
         if (resp && resp.preset) {
           setConfig(c => ({ ...c, ...resp.preset,
             drinks: { ...c.drinks, ...(resp.preset.drinks || {}) },
           }));
         }
       })
       .catch(() => { /* defaults are fine if server is unreachable */ });
  }, []);

  const toggleArrayItem = (key, value) => {
    setConfig(c => {
      const arr = c[key] || [];
      return {
        ...c,
        [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  };

  const toggleDrink = (key) => {
    setConfig(c => ({ ...c, drinks: { ...c.drinks, [key]: !c.drinks[key] } }));
  };

  const apply = async () => {
    if (!window.confirm(
      'Apply Quick Setup?\n\nThis REPLACES all current inventory items with the ' +
      'defaults selected here. Existing orders / customers / stations are kept. ' +
      'Continue?'
    )) return;
    setApplying(true);
    setResult(null);
    try {
      const resp = await api.request('/quick-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset: config }),
      });
      setResult({
        success: !!resp.success,
        summary: resp.summary || (resp.applied || []).join('; '),
        applied: resp.applied || [],
        error: resp.error,
      });
    } catch (err) {
      setResult({ success: false, error: err.message });
    } finally {
      setApplying(false);
    }
  };

  const resetDefaults = () => setConfig(DEFAULT_STATE);

  const Checkbox = ({ checked, onChange, label }) => (
    <label className="inline-flex items-center mr-3 mb-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mr-2 h-4 w-4 accent-amber-600"
      />
      <span className={checked ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
    </label>
  );

  return (
    <div className="p-6 max-w-4xl">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start">
        <Zap className="w-6 h-6 text-amber-600 mr-3 mt-0.5 flex-shrink-0" />
        <div>
          <h2 className="text-xl font-bold text-amber-800">Quick Setup</h2>
          <p className="text-amber-700 text-sm mt-1">
            One click. Replaces your inventory with the selections below, copies
            station capabilities, and (optionally) puts the schedule in
            always-open mode. Use this for a fresh event setup; if you've
            already configured things by hand, prefer the individual settings
            panels.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Milks</h3>
        <div>
          {MILK_OPTIONS.map(m => (
            <Checkbox key={m}
              checked={config.milks.includes(m)}
              onChange={() => toggleArrayItem('milks', m)}
              label={m}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Cup sizes</h3>
        <div>
          {SIZE_OPTIONS.map(s => (
            <Checkbox key={s}
              checked={config.sizes.includes(s)}
              onChange={() => toggleArrayItem('sizes', s)}
              label={s}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-3">Sweeteners</h3>
        <div>
          {SWEETENER_OPTIONS.map(s => (
            <Checkbox key={s}
              checked={config.sweeteners.includes(s)}
              onChange={() => toggleArrayItem('sweeteners', s)}
              label={s}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-4">
        <h3 className="font-semibold text-lg mb-1">Drink categories</h3>
        <p className="text-sm text-gray-500 mb-3">
          Espresso drinks (latte, cappuccino, flat white, etc.) are always
          enabled when coffee beans are stocked. Tick anything else you want
          on offer.
        </p>
        <div>
          {EXTRA_DRINK_OPTIONS.map(d => (
            <Checkbox key={d.key}
              checked={!!config.drinks[d.key]}
              onChange={() => toggleDrink(d.key)}
              label={d.label}
            />
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
        <h3 className="font-semibold text-lg mb-3">Event-wide options</h3>
        <Checkbox
          checked={config.unlimited_stock}
          onChange={() => setConfig(c => ({ ...c, unlimited_stock: !c.unlimited_stock }))}
          label="Unlimited stock — don't reject orders when amounts run low"
        />
        <br />
        <Checkbox
          checked={config.all_stations_same_capabilities}
          onChange={() => setConfig(c => ({ ...c, all_stations_same_capabilities: !c.all_stations_same_capabilities }))}
          label="All stations have the same capabilities (every milk, every drink)"
        />
        <br />
        <Checkbox
          checked={config.always_open_schedule}
          onChange={() => setConfig(c => ({ ...c, always_open_schedule: !c.always_open_schedule }))}
          label="Always open — clear any scheduled breaks; orders flow all day"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={apply}
          disabled={applying}
          className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center"
        >
          {applying
            ? (<><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Applying…</>)
            : (<><Zap className="w-5 h-5 mr-2" /> Apply Quick Setup</>)
          }
        </button>
        <button
          onClick={resetDefaults}
          disabled={applying}
          className="px-4 py-3 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
        >
          Reset to café defaults
        </button>
      </div>

      {result && result.success && (
        <div className="mt-4 p-4 border-l-4 border-green-500 bg-green-50 rounded">
          <div className="flex items-start">
            <Check className="w-5 h-5 text-green-700 mr-2 mt-0.5" />
            <div>
              <p className="font-semibold text-green-800">Applied successfully</p>
              <p className="text-sm text-green-700 mt-1">{result.summary}</p>
            </div>
          </div>
        </div>
      )}
      {result && !result.success && (
        <div className="mt-4 p-4 border-l-4 border-red-500 bg-red-50 rounded">
          <div className="flex items-start">
            <AlertTriangle className="w-5 h-5 text-red-700 mr-2 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800">Quick Setup failed</p>
              <p className="text-sm text-red-700 mt-1">{result.error || 'Unknown error'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuickSetup;
