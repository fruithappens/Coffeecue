import React, { useCallback, useEffect, useState } from 'react';
import {
  Coffee, Droplet, Package, Beaker, ChevronDown, ChevronRight,
  Save, AlertTriangle, RefreshCw,
} from 'lucide-react';

/**
 * Event Stock — the real ledger and the real recipes.
 *
 * This screen used to render drinks carrying kilograms ("Latte — 5 kg,
 * Allocated 2 kg") out of an `event_stock_levels` blob that NOTHING
 * else read: the Allocated numbers influenced no order, no gate, no
 * report. Steve, looking at it the morning after the recipe layer
 * shipped: "the event stock still shows kg of latte and caps etc" —
 * and the rule that whole rebuild enforces is that a drink never
 * carries a quantity.
 *
 * Now it shows the two things that are actually true:
 *
 *   INGREDIENTS — the live inventory rows the resolver checks and the
 *   completion decrement moves. Edit a quantity here and the gate,
 *   the menus and the report all see it, because there is one ledger.
 *
 *   RECIPES — what each drink burns, per size. Edit a dose and it
 *   saves as source='custom', which the boot re-seed never touches.
 *
 * Everything reads/writes the backend. No localStorage mirrors — that
 * pattern is what made this screen decorative in the first place.
 */

const authHeaders = () => ({
  Authorization: `Bearer ${localStorage.getItem('coffee_system_token') || ''}`,
  'Content-Type': 'application/json',
});

const CATEGORY_META = {
  coffee: { label: 'Beans', unit: 'kg', icon: Coffee },
  milk: { label: 'Milk', unit: 'L', icon: Droplet },
  cups: { label: 'Cups', unit: 'units', icon: Package },
  extras: { label: 'Extras', unit: 'kg', icon: Beaker },
  water: { label: 'Water', unit: 'L', icon: Droplet },
  sweeteners: { label: 'Sweeteners', unit: 'units', icon: Beaker },
  syrups: { label: 'Syrups', unit: 'bottles', icon: Beaker },
};

// ---------------------------------------------------------------------
// Bean dose (grams per shot) — kept from the old screen; it is real.
// ---------------------------------------------------------------------
const BeanDoseCard = () => {
  const [grams, setGrams] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/settings', { headers: authHeaders() });
        const b = r.ok ? await r.json() : {};
        const st = b.settings || b.data || b || {};
        const v = parseFloat(st.beans_grams_per_shot);
        setGrams(Number.isFinite(v) ? String(v) : '22');
      } catch (e) {
        setGrams('22');
      }
    })();
  }, []);

  const save = async () => {
    const v = parseFloat(grams);
    if (!Number.isFinite(v) || v < 1 || v > 60) return;
    setSaving(true);
    try {
      const r = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ beans_grams_per_shot: v }),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[16rem]">
        <h3 className="text-lg font-bold">Coffee dose per shot</h3>
        <p className="text-sm text-gray-600">
          Grams of beans one espresso shot deducts from stock. Every recipe
          counts shots; this converts them to grams. Australian standard is
          20–22g — keep it on the high side so dial-in shots and spills
          don't quietly eat your margin.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="1"
          max="60"
          value={grams}
          onChange={(e) => setGrams(e.target.value)}
          className="w-24 border rounded px-2 py-1.5 text-right"
        />
        <span className="text-gray-500 text-sm">g</span>
        <button
          onClick={save}
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-1.5 rounded font-semibold"
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// One ingredient row: live amount, threshold badge, set-and-save.
// ---------------------------------------------------------------------
const IngredientRow = ({ item, onSaved }) => {
  const [value, setValue] = useState(String(item.amount ?? ''));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const amount = parseFloat(item.amount) || 0;
  const threshold = parseFloat(item.minimum_threshold) || 0;
  const low = threshold > 0 && amount <= threshold;
  const dirty = value !== '' && parseFloat(value) !== amount;

  const save = async () => {
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v < 0) { setErr('Enter a number'); return; }
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(`/api/inventory/${item.id}/adjust`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ new_amount: v, change_reason: 'organiser stock screen' }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b.success === false) {
        setErr(b.message || `Save failed (${r.status})`);
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-800 capitalize">{item.name}</span>
        {low && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
            <AlertTriangle size={12} /> low (warn at {threshold})
          </span>
        )}
      </div>
      <input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`w-28 border rounded px-2 py-1 text-right ${dirty ? 'border-amber-500' : 'border-gray-300'}`}
      />
      <span className="text-sm text-gray-500 w-12">{item.unit || ''}</span>
      <button
        onClick={save}
        disabled={saving || !dirty}
        title={dirty ? 'Save this quantity' : 'Unchanged'}
        className={`p-1.5 rounded ${dirty
          ? 'bg-amber-600 text-white hover:bg-amber-700'
          : 'bg-gray-100 text-gray-300 cursor-default'}`}
      >
        <Save size={16} />
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
};

// ---------------------------------------------------------------------
// Recipe editor: per drink, sizes × ingredient lines, doses editable.
// ---------------------------------------------------------------------
const lineName = (ln) =>
  ln.name
    ? ln.name
    : ln.category === 'milk'
      ? "customer's milk"
      : ln.category === 'coffee'
        ? "chosen bean"
        : ln.category === 'cups'
          ? 'cup (matches size)'
          : ln.category;

const RecipeLine = ({ drink, size, line, onSaved }) => {
  const [qty, setQty] = useState(String(line.quantity));
  const [saving, setSaving] = useState(false);
  const dirty = parseFloat(qty) !== line.quantity;

  const save = async () => {
    const v = parseFloat(qty);
    if (!Number.isFinite(v) || v < 0) return;
    setSaving(true);
    try {
      const r = await fetch('/api/recipes', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          drink, size,
          category: line.category,
          name: line.name,
          quantity: v,
          unit: line.unit,
        }),
      });
      if (r.ok) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-sm py-1">
      <span className="flex-1 text-gray-700 capitalize">{lineName(line)}</span>
      <input
        type="number"
        min="0"
        step="any"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className={`w-20 border rounded px-2 py-0.5 text-right ${dirty ? 'border-amber-500' : 'border-gray-200'}`}
      />
      <span className="text-gray-500 w-10">{line.unit}</span>
      <button
        onClick={save}
        disabled={saving || !dirty}
        className={`p-1 rounded ${dirty
          ? 'bg-amber-600 text-white hover:bg-amber-700'
          : 'text-gray-300 cursor-default'}`}
      >
        <Save size={14} />
      </button>
      {line.source === 'custom' && (
        <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
          custom
        </span>
      )}
    </div>
  );
};

const RecipeCard = ({ drink, sizes, onSaved }) => {
  const [open, setOpen] = useState(false);
  const sizeOrder = ['small', 'medium', 'large'];
  const ordered = Object.keys(sizes).sort(
    (a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b)
  );
  return (
    <div className="bg-white rounded-lg shadow">
      <button
        className="w-full flex items-center justify-between px-4 py-3"
        onClick={() => setOpen(v => !v)}
      >
        <span className="font-bold text-gray-800 capitalize">{drink}</span>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {ordered.map(size => (
            <div key={size} className="border border-gray-100 rounded p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                {size}
              </div>
              {sizes[size].map((line, i) => (
                <RecipeLine
                  key={`${line.category}-${line.name || 'choice'}-${i}`}
                  drink={drink}
                  size={size}
                  line={line}
                  onSaved={onSaved}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


// ---------------------------------------------------------------------
// Cup reconciliation — where the venue's tally meets ours.
// ---------------------------------------------------------------------
const CupReconciliation = () => {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [edit, setEdit] = useState({});   // "sid:field" -> value

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/reports/cup-reconciliation', { headers: authHeaders() });
      const b = r.ok ? await r.json() : {};
      setRows(b.stations || []);
      setTotals(b.totals || null);
    } catch (e) { /* refresh next time */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (sid, field) => {
    const v = parseInt(edit[`${sid}:${field}`], 10);
    if (!Number.isFinite(v) || v < 0) return;
    await fetch('/api/reports/cup-reconciliation', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ station_id: sid, [field]: v }),
    });
    setEdit((e) => { const n = { ...e }; delete n[`${sid}:${field}`]; return n; });
    load();
  };

  const CountCell = ({ sid, field, value }) => {
    const key = `${sid}:${field}`;
    const editing = edit[key] !== undefined;
    return (
      <div className="flex items-center gap-1">
        <input
          type="number" min="0"
          value={editing ? edit[key] : (value ?? '')}
          placeholder="—"
          onChange={(e) => setEdit((s2) => ({ ...s2, [key]: e.target.value }))}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-right"
        />
        {editing && (
          <button onClick={() => save(sid, field)}
            className="p-1 bg-amber-600 text-white rounded" title="Save count">
            <Save size={13} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 mt-8">
      <h2 className="text-xl font-bold text-gray-800">Cup reconciliation</h2>
      <p className="text-sm text-gray-600 mb-3">
        The venue counts physical cups (start minus end of day); we count
        completed orders. The two will differ — staff coffees, remakes,
        spills — and the variance belongs in the report, explained, not
        hidden. Enter start counts in the morning, end counts at pack-down.
      </p>
      <div className="overflow-x-auto">
        <table className="text-sm w-full">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-4">Station</th>
              <th className="py-1 pr-4">Cups at start</th>
              <th className="py-1 pr-4">Cups at end</th>
              <th className="py-1 pr-4">Venue used</th>
              <th className="py-1 pr-4">Our orders</th>
              <th className="py-1">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.station_id} className="border-t border-gray-100">
                <td className="py-2 pr-4 font-medium">{r.station_name}</td>
                <td className="py-2 pr-4"><CountCell sid={r.station_id} field="start" value={r.start} /></td>
                <td className="py-2 pr-4"><CountCell sid={r.station_id} field="end" value={r.end} /></td>
                <td className="py-2 pr-4 font-mono">{r.venue_used ?? '—'}</td>
                <td className="py-2 pr-4 font-mono">{r.system_orders}</td>
                <td className={`py-2 font-mono font-bold ${
                  r.variance == null ? 'text-gray-400'
                    : Math.abs(r.variance) <= 5 ? 'text-green-700' : 'text-amber-700'}`}>
                  {r.variance == null ? '—' : (r.variance > 0 ? `+${r.variance}` : r.variance)}
                </td>
              </tr>
            ))}
            {totals && (
              <tr className="border-t-2 border-gray-300 font-bold">
                <td className="py-2 pr-4">Event total</td>
                <td /><td />
                <td className="py-2 pr-4 font-mono">{totals.venue_used || '—'}</td>
                <td className="py-2 pr-4 font-mono">{totals.system_orders}</td>
                <td className="py-2 font-mono">{totals.variance ?? '—'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------
const EventStockManagement = () => {
  const [inventory, setInventory] = useState([]);
  const [recipes, setRecipes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [ri, rr] = await Promise.all([
        fetch('/api/inventory', { headers: authHeaders() }),
        fetch('/api/recipes', { headers: authHeaders() }),
      ]);
      const bi = ri.ok ? await ri.json() : {};
      let items = bi.items || bi.data || bi;
      if (items && !Array.isArray(items)) {
        items = items.inventory || items.items || items.data || [];
      }
      setInventory(Array.isArray(items) ? items : []);
      const br = rr.ok ? await rr.json() : {};
      setRecipes(br.recipes || {});
    } catch (e) {
      setError(`Couldn't load stock: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const byCategory = {};
  inventory.forEach((it) => {
    const cat = String(it.category || '').toLowerCase();
    (byCategory[cat] = byCategory[cat] || []).push(it);
  });

  return (
    <div className="p-6 max-w-5xl">
      <BeanDoseCard />

      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-800">Ingredients</h2>
        <button
          onClick={load}
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <p className="text-gray-600 mb-4">
        The live ledger — what orders check against and completions deduct
        from. Drinks don't carry quantities; these do.
      </p>

      {loading && <div className="text-gray-500 py-8">Loading stock…</div>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        {Object.entries(byCategory)
          .filter(([cat, items]) => items.length > 0 && CATEGORY_META[cat])
          .map(([cat, items]) => {
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <div key={cat} className="bg-white rounded-lg shadow p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={18} className="text-amber-700" />
                  <h3 className="font-bold text-gray-800">{meta.label}</h3>
                  <span className="text-xs text-gray-400">({meta.unit})</span>
                </div>
                {items
                  .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                  .map(item => (
                    <IngredientRow key={item.id} item={item} onSaved={load} />
                  ))}
              </div>
            );
          })}
      </div>

      <h2 className="text-2xl font-bold text-gray-800 mb-1">Recipes</h2>
      <p className="text-gray-600 mb-4">
        What each drink burns, per size. Edit a dose and it sticks — your
        numbers survive updates; "custom" marks the ones you've changed.
      </p>
      <div className="space-y-3">
        {Object.entries(recipes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([drink, sizes]) => (
            <RecipeCard key={drink} drink={drink} sizes={sizes} onSaved={load} />
          ))}
      </div>

      <CupReconciliation />
    </div>
  );
};

export default EventStockManagement;
