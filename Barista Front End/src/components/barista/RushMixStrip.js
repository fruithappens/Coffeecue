// RushMixStrip.js — the big-event "flat white table" production strip.
//
// Steve's scenario: a pre-event blast lands 200-400 orders before doors
// open. Instead of card-by-card, this strip shows the LIVE MIX and
// drives tray production:
//
//   Pending row:    "Flat White · Full Cream  x12  [Start batch]"
//   In-progress:    "Flat White · Full Cream  x12  [Tray done -> table]"
//   Don't-skip:     aging singles that fit no batch, flagged red so the
//                   bulk process can't bury them (Steve's fairness rule).
//
// Batch completion stamps every order with "the FLAT WHITE table at
// <station>" — the ready-SMS says where to grab it; sugar is already
// covered by self-serve mode for exactly this setup.
import React, { useState } from 'react';
import { Layers, AlertTriangle } from 'lucide-react';
import { showToast } from '../shared/Toast';

const kindKey = (o) => `${(o.coffeeType || '').toLowerCase()}|${(o.milkType || '').toLowerCase()}`;
const kindLabel = (o) => {
  const drink = o.coffeeType || 'Coffee';
  const milk = (o.milkType || '').toLowerCase();
  const showMilk = milk && !['no milk', 'none', ''].includes(milk);
  return showMilk ? `${drink} · ${o.milkType}` : drink;
};

const groupByKind = (orders) => {
  const groups = {};
  (orders || []).forEach(o => {
    const k = kindKey(o);
    (groups[k] = groups[k] || []).push(o);
  });
  return Object.values(groups).filter(g => g.length >= 2)
    .sort((a, b) => b.length - a.length);
};

const RushMixStrip = ({ pendingOrders, inProgressOrders, stationName,
                        onStartBatch, onBatchComplete }) => {
  const [busyKey, setBusyKey] = useState(null);

  const pendingGroups = groupByKind(pendingOrders);
  const inProgressGroups = groupByKind(inProgressOrders);

  // Fairness guard: singles (no batch to ride) waiting 10+ minutes.
  const batchedPendingIds = new Set(
    pendingGroups.flat().map(o => String(o.id)));
  const agingSingles = (pendingOrders || [])
    .filter(o => !batchedPendingIds.has(String(o.id)) && (o.waitTime || 0) >= 10)
    .sort((a, b) => (b.waitTime || 0) - (a.waitTime || 0));

  if (pendingGroups.length === 0 && inProgressGroups.length === 0
      && agingSingles.length === 0) {
    return null; // quiet queue — no strip, no clutter
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-3 mb-4">
      <div className="flex items-center text-sm font-bold text-gray-700 mb-2">
        <Layers size={16} className="mr-1" /> Rush mix
      </div>
      <div className="flex flex-wrap gap-2">
        {pendingGroups.map(group => {
          const key = `p:${kindKey(group[0])}`;
          return (
            <button
              key={key}
              disabled={busyKey != null}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-amber-400 bg-amber-50 hover:bg-amber-100 text-sm font-semibold disabled:opacity-50"
              title={`Start all ${group.length} together — make them as one tray`}
              onClick={async () => {
                setBusyKey(key);
                try {
                  await onStartBatch(group);
                  showToast(`Started ${group.length}x ${kindLabel(group[0])} as a tray`, 'success');
                } catch (e) {
                  showToast(`Batch start failed: ${e?.message || 'unknown'}`, 'error');
                } finally {
                  setBusyKey(null);
                }
              }}
            >
              {kindLabel(group[0])}
              <span className="bg-amber-500 text-white rounded-full px-2">{group.length}</span>
              <span className="text-amber-700">▶ Start batch</span>
            </button>
          );
        })}
        {inProgressGroups.map(group => {
          const key = `i:${kindKey(group[0])}`;
          const tableLabel = `the ${(group[0].coffeeType || 'coffee').toUpperCase()} table at ${stationName || 'this station'}`;
          return (
            <button
              key={key}
              disabled={busyKey != null}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-green-500 bg-green-50 hover:bg-green-100 text-sm font-semibold disabled:opacity-50"
              title={`Complete all ${group.length} at once — every ready-SMS will say "collect from ${tableLabel}"`}
              onClick={async () => {
                setBusyKey(key);
                try {
                  await onBatchComplete(group, tableLabel);
                } finally {
                  setBusyKey(null);
                }
              }}
            >
              {kindLabel(group[0])}
              <span className="bg-green-600 text-white rounded-full px-2">{group.length}</span>
              <span className="text-green-700">✓ Tray done → table</span>
            </button>
          );
        })}
      </div>
      {agingSingles.length > 0 && (
        <div className="mt-2 flex items-start text-sm bg-red-50 border border-red-200 rounded-lg p-2 text-red-800">
          <AlertTriangle size={16} className="mr-2 mt-0.5 flex-shrink-0" />
          <span>
            <b>Don't skip:</b>{' '}
            {agingSingles.slice(0, 5).map(o =>
              `#${o.orderNumber || o.id} ${o.coffeeType || ''} (${o.waitTime}m)`)
              .join(', ')}
            {agingSingles.length > 5 ? ` +${agingSingles.length - 5} more` : ''}
            {' '}— singles waiting 10+ min with no batch to ride. Make these
            between trays.
          </span>
        </div>
      )}
    </div>
  );
};

export default RushMixStrip;
