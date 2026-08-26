import React, { useEffect, useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import useCatalog from '../../hooks/useCatalog';

/**
 * EditOrderDialog — barista override for an order taken down wrong.
 *
 * Lets the operator fix the whole order, or cancel it out of the queue
 * (behind a confirm). The parent wires the callbacks to
 * OrderDataService.updateOrder / cancelOrder. Soft cancel — the record is
 * kept for reporting, it just leaves the active queue.
 *
 * SAME RANGE AS TAKING THE ORDER (Steve: "edit order has limited options,
 * and should have same range as when the order first put in").
 *
 * It used to edit drink / milk / size / sugar and nothing else, so a
 * barista who took "double shot decaf, extra hot" down wrong had to
 * cancel the order and re-enter the whole thing. Shots, beans, extra hot,
 * VIP and notes are all here now.
 *
 * AND THE OPTIONS COME FROM THE EVENT.
 *
 * The drink and milk suggestions used to be hardcoded lists in this file
 * — a sixth copy of the menu, listing Oat, Coconut, Lactose Free and five
 * teas at a venue that serves none of them. They now come from the
 * catalogue, filtered to what this event actually has switched on, which
 * is the same source the walk-in form and the SMS bot read.
 */

// Last-resort suggestions, used only if the catalogue cannot be reached.
// Free text still works, so a barista is never blocked by this list.
const FALLBACK_DRINKS = [
  'Latte', 'Flat White', 'Cappuccino', 'Espresso', 'Long Black', 'Mocha',
];
const FALLBACK_MILKS = [
  'Full Cream Milk', 'Skim Milk', 'Soy Milk', 'Almond Milk', 'No milk',
];

const EditOrderDialog = ({ order, onClose, onSave, onCancelOrder, saving = false,
                           drinkOptions, milkOptions }) => {
  const o = order || {};
  const label = o.orderNumber || o.order_number || o.id;

  const { items: catalogMilks } = useCatalog('milk');
  const { items: catalogDrinks } = useCatalog('drink');

  // Only what this event serves. An item with no event_enabled flag is
  // treated as available — an unconfigured event must still be editable.
  const onMenu = (list) => (Array.isArray(list) ? list : [])
    .filter(i => i.event_enabled !== false)
    .map(i => i.name)
    .filter(Boolean);

  const drinkList = drinkOptions
    || (onMenu(catalogDrinks).length ? onMenu(catalogDrinks) : FALLBACK_DRINKS);
  const milkList = milkOptions
    || (onMenu(catalogMilks).length
        ? [...onMenu(catalogMilks), 'No milk']
        : FALLBACK_MILKS);

  // Sizes and the sugar policy come from the same place the customer-facing
  // screens read, so the edit form cannot offer a size the event dropped.
  const [sizes, setSizes] = useState([]);
  const [sugarSelfServe, setSugarSelfServe] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/display/menu');
        const b = r.ok ? await r.json() : null;
        if (cancelled || !b?.menu) return;
        const s = (b.menu.sizes || []).map(x => (x.value || x.name || '').toLowerCase());
        if (s.length) setSizes(s);
        if (b.menu.sugar_self_serve) setSugarSelfServe(true);
      } catch (e) {
        /* offline: fall back to the three standard sizes below */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sizeChoices = sizes.length ? sizes : ['small', 'medium', 'large'];

  const d = o.orderDetails || o.order_details || {};
  const [drink, setDrink] = useState(o.coffeeType || o.coffee_type || o.type || '');
  const [milk, setMilk] = useState(o.milkType || o.milk_type || o.milk || '');
  const [size, setSize] = useState((o.size || 'medium').toString().toLowerCase());
  const [sugar, setSugar] = useState(o.sugar || d.sugar || '');
  const [shots, setShots] = useState(String(o.shots ?? d.shots ?? '1'));
  const [beanType, setBeanType] = useState(o.beanType || o.bean_type || d.bean_type || '');
  const [extraHot, setExtraHot] = useState(!!(o.extraHot ?? o.extra_hot ?? d.extra_hot));
  const [vip, setVip] = useState(!!(o.vip ?? d.vip ?? o.priority));
  const [notes, setNotes] = useState(o.notes || d.notes || '');

  // Phone: editable so a number can be added AFTER ordering ("actually,
  // text me when it's ready"). 'Walk-in' is a placeholder, not a number.
  const _rawPhone = String(o.phoneNumber || o.phone_number || o.phone || '').trim();
  const [phone, setPhone] = useState(/^walk-?in$/i.test(_rawPhone) ? '' : _rawPhone);

  const handleSave = () => {
    const fields = {
      type: (drink || '').trim(),
      milk: (milk || '').trim(),
      size,
      sugar: sugarSelfServe ? 'no sugar' : (sugar || '').trim(),
      shots: parseFloat(shots) || 1,
      bean_type: (beanType || '').trim(),
      extra_hot: extraHot,
      vip,
      notes: (notes || '').trim(),
    };
    // Only send phone when it actually changed — sending it always would
    // overwrite a real number with '' on unrelated edits.
    const cleanedPhone = (phone || '').trim();
    const hadPhone = !/^walk-?in$/i.test(_rawPhone) && _rawPhone !== '';
    if (cleanedPhone !== (hadPhone ? _rawPhone : '')) {
      fields.phone = cleanedPhone;
    }
    onSave(fields);
  };

  const handleCancelOrder = () => {
    if (window.confirm(
      `Cancel order #${label}? This removes it from the queue (the record is kept). This can't be undone.`
    )) {
      onCancelOrder();
    }
  };

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none';
  const labelCls = 'block text-sm font-medium text-gray-600 mb-1';

  const Toggle = ({ on, setOn, children }) => (
    <button
      type="button"
      onClick={() => setOn(!on)}
      aria-pressed={on}
      className={`px-3 py-2 rounded-lg border-2 text-sm font-semibold transition-colors
                  ${on ? 'bg-amber-600 text-white border-amber-600'
                       : 'bg-white text-gray-700 border-gray-300 hover:border-amber-400'}`}
    >
      {children}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 sticky top-0 bg-white">
          <h3 className="text-lg font-bold text-gray-800">
            Edit order #{label}{o.customerName ? ` — ${o.customerName}` : ''}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Drink</label>
            <input value={drink} onChange={(e) => setDrink(e.target.value)} className={inputCls}
                   placeholder="e.g. flat white" list="edit-order-drinks" autoComplete="off" />
            <datalist id="edit-order-drinks">
              {drinkList.map(x => <option key={x} value={x} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Milk</label>
            <input value={milk} onChange={(e) => setMilk(e.target.value)} className={inputCls}
                   placeholder="e.g. full cream, no milk" list="edit-order-milks" autoComplete="off" />
            <datalist id="edit-order-milks">
              {milkList.map(x => <option key={x} value={x} />)}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Size</label>
              <select value={size} onChange={(e) => setSize(e.target.value)} className={inputCls}>
                {sizeChoices.map(sz => (
                  <option key={sz} value={sz}>{sz.charAt(0).toUpperCase() + sz.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Sugar</label>
              {sugarSelfServe ? (
                <div className="px-3 py-2 border border-dashed border-gray-200 rounded-lg text-sm text-gray-500">
                  Help-yourself at the counter
                </div>
              ) : (
                <input value={sugar} onChange={(e) => setSugar(e.target.value)} className={inputCls}
                       placeholder="e.g. no sugar, 1 sugar" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Shots</label>
              <select value={shots} onChange={(e) => setShots(e.target.value)} className={inputCls}>
                <option value="0.5">Half shot</option>
                <option value="1">Single</option>
                <option value="2">Double</option>
                <option value="3">Triple</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Beans</label>
              <select value={beanType} onChange={(e) => setBeanType(e.target.value)} className={inputCls}>
                <option value="">House blend</option>
                <option value="decaf">Decaf</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Extras</label>
            <div className="flex flex-wrap gap-2">
              <Toggle on={extraHot} setOn={setExtraHot}>Extra hot</Toggle>
              <Toggle on={vip} setOn={setVip}>VIP / staff priority</Toggle>
            </div>
          </div>

          <div>
            <label className={labelCls}>Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls}
                   placeholder="e.g. no lid, 1/4 strength, half full" />
          </div>

          <div>
            <label className={labelCls}>
              Mobile number <span className="text-gray-400 font-normal">(optional — enables SMS updates)</span>
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls}
                   placeholder="e.g. 0412 345 678" type="tel" autoComplete="off" />
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button
            onClick={handleCancelOrder}
            disabled={saving}
            className="flex items-center text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
          >
            <Trash2 size={16} className="mr-1" /> Cancel this order
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              <Save size={16} className="mr-1" /> {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditOrderDialog;
