// components/dialogs/MoveOrderDialog.js
//
// Reassigns a pending order to a different station. Used when:
//   - Station 1 runs out of oat milk → push the 3 oat orders to Station 2
//   - A machine faults → move queued orders elsewhere before customers
//     start asking where their coffee is
//
// Backend: POST /api/orders/<id>/reassign with {target_station_id}.
// The backend validates the target is active AND can make the drink
// (uses the same capability check as Start) — so we don't have to
// re-implement that here. If the backend refuses, we surface the
// reason verbatim.
import React, { useState } from 'react';
import { XCircle, ArrowRight, AlertCircle, RefreshCw } from 'lucide-react';

const MoveOrderDialog = ({ order, stations, currentStationId, onConfirm, onClose }) => {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Show only OTHER stations that are currently active. No point
  // offering inactive/maintenance ones — the backend would reject
  // them and the operator would have to try again.
  const candidates = (stations || [])
    .filter((s) => s && s.id != null && s.id !== currentStationId)
    .filter((s) => {
      const status = (s.status || '').toLowerCase();
      // Treat blank status as "active" — some older rows don't set it
      // and we don't want to hide stations because of stale data.
      return !status || status === 'active';
    });

  const handlePick = async (targetStationId) => {
    setError(null);
    setSending(true);
    try {
      const result = await onConfirm(order, targetStationId);
      if (result && result.success) {
        onClose();
      } else {
        // Surface backend's specific reason — capability mismatch,
        // station inactive, etc. Operators need to know WHY so they
        // can pick a different target.
        setError((result && result.message) || 'Could not reassign order.');
      }
    } catch (e) {
      setError(e.message || 'Network error reassigning order.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Move order to another station</h3>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
            disabled={sending}
          >
            <XCircle size={20} />
          </button>
        </div>

        {order && (
          <div className="mb-4 bg-gray-100 p-3 rounded">
            <div className="font-medium">
              #{order.orderNumber || order.id} — {order.customerName}
            </div>
            <div className="text-sm text-gray-700">
              {order.coffeeType}, {order.milkType}
              {order.sugar ? `, ${order.sugar}` : ''}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Currently at Station {currentStationId ?? '?'}
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-2 rounded border border-red-200 text-sm flex items-start">
            <AlertCircle size={16} className="mr-1 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="bg-amber-50 text-amber-800 p-3 rounded border border-amber-200 text-sm">
            No other active stations available. Activate another station
            first under Organiser → Stations.
          </div>
        ) : (
          <div>
            <div className="text-sm text-gray-600 mb-2">
              Pick the station to take over this order. Customers won't
              be notified — let them know in person if needed.
            </div>
            <div className="space-y-2">
              {candidates.map((s) => (
                <button
                  key={s.id}
                  className="w-full flex items-center justify-between p-3 border rounded hover:bg-amber-50 hover:border-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  onClick={() => handlePick(s.id)}
                  disabled={sending}
                >
                  <div>
                    <div className="font-medium">
                      Station {s.id}
                      {s.name && s.name !== `Station ${s.id}` ? ` — ${s.name}` : ''}
                    </div>
                    {s.location && (
                      <div className="text-xs text-gray-500">{s.location}</div>
                    )}
                  </div>
                  {sending ? (
                    <RefreshCw size={18} className="animate-spin text-amber-600" />
                  ) : (
                    <ArrowRight size={18} className="text-amber-600" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            onClick={onClose}
            disabled={sending}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveOrderDialog;
