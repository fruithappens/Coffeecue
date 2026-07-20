import React, { useState } from 'react';
import { X, Save, Trash2 } from 'lucide-react';

/**
 * EditOrderDialog — barista override for an order taken down wrong.
 *
 * Lets the operator fix the drink / milk / size / sugar, or cancel the order
 * out of the queue (behind a confirm). The parent wires the callbacks to
 * OrderDataService.updateOrder / cancelOrder. Soft cancel — the record is
 * kept for reporting, it just leaves the active queue.
 */
// Suggestion lists for the datalists below. Free text still works (the
// menu is operator-configurable), but picking from the list avoids the
// typo class ('flat wite') that then matches nothing downstream.
const COMMON_DRINKS = [
  'Latte', 'Flat White', 'Cappuccino', 'Espresso', 'Long Black',
  'Americano', 'Macchiato', 'Piccolo', 'Mocha', 'Hot Chocolate',
  'Chai Latte', 'English Breakfast Tea', 'Earl Grey Tea', 'Green Tea',
  'Peppermint Tea',
];
const COMMON_MILKS = [
  'Full Cream Milk', 'Skim Milk', 'Oat Milk', 'Almond Milk', 'Soy Milk',
  'Coconut Milk', 'Macadamia Milk', 'Lactose Free Milk', 'No milk',
];

const EditOrderDialog = ({ order, onClose, onSave, onCancelOrder, saving = false,
                           drinkOptions = COMMON_DRINKS, milkOptions = COMMON_MILKS }) => {
  const o = order || {};
  const label = o.orderNumber || o.order_number || o.id;
  const [drink, setDrink] = useState(o.coffeeType || o.coffee_type || o.type || '');
  const [milk, setMilk] = useState(o.milkType || o.milk_type || o.milk || '');
  const [size, setSize] = useState((o.size || 'medium').toString().toLowerCase());
  const [sugar, setSugar] = useState(o.sugar || '');
  // Phone: editable so a number can be added AFTER ordering ("actually,
  // text me when it's ready"). 'Walk-in' is a placeholder, not a number.
  const _rawPhone = String(o.phoneNumber || o.phone_number || o.phone || '').trim();
  const [phone, setPhone] = useState(/^walk-?in$/i.test(_rawPhone) ? '' : _rawPhone);

  const handleSave = () => {
    const fields = {
      type: (drink || '').trim(),
      milk: (milk || '').trim(),
      size,
      sugar: (sugar || '').trim(),
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-800">
            Edit order #{label}{o.customerName ? ` — ${o.customerName}` : ''}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Drink</label>
            <input value={drink} onChange={(e) => setDrink(e.target.value)} className={inputCls}
                   placeholder="e.g. flat white" list="edit-order-drinks" autoComplete="off" />
            <datalist id="edit-order-drinks">
              {drinkOptions.map(d => <option key={d} value={d} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">Milk</label>
            <input value={milk} onChange={(e) => setMilk(e.target.value)} className={inputCls}
                   placeholder="e.g. oat, full cream, no milk" list="edit-order-milks" autoComplete="off" />
            <datalist id="edit-order-milks">
              {milkOptions.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Size</label>
              <select value={size} onChange={(e) => setSize(e.target.value)} className={inputCls}>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Sugar</label>
              <input value={sugar} onChange={(e) => setSugar(e.target.value)} className={inputCls} placeholder="e.g. no sugar, 1 sugar" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Mobile number <span className="text-gray-400 font-normal">(optional — enables SMS updates)</span>
            </label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls}
                   placeholder="e.g. 0412 345 678" type="tel" autoComplete="off" />
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200">
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
