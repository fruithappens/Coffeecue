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
import { sameId } from '../../utils/ids';
import { ArrowRight, RefreshCw, MoveRight } from 'lucide-react';
import { Modal, Notice, Subject, PickRow, Button } from '../../design';

const MoveOrderDialog = ({ order, stations, currentStationId, onConfirm, onClose }) => {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Show only OTHER stations that are currently active. No point
  // offering inactive/maintenance ones — the backend would reject
  // them and the operator would have to try again.
  const candidates = (stations || [])
    .filter((s) => s && s.id != null && !sameId(s.id, currentStationId))
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
    <Modal
      title="Move order to another station"
      Icon={MoveRight}
      onClose={onClose}
      busy={sending}
      footer={<Button variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>}
    >
      {order && (
        <Subject title={`#${order.orderNumber || order.id} \u2014 ${order.customerName}`}>
          {order.coffeeType}, {order.milkType}{order.sugar ? `, ${order.sugar}` : ''}
          {' \u00b7 '}Currently at Station {currentStationId ?? '?'}
        </Subject>
      )}

      {error && <Notice tone="bad">{error}</Notice>}

      {candidates.length === 0 ? (
        <Notice tone="warn">
          No other active stations available. Turn one on under Stations first.
        </Notice>
      ) : (
        <>
          <p className="text-sm text-cq-ink-3 mb-3">
            Pick the station to take over. The customer is not told \u2014 let
            them know in person if it matters.
          </p>
          <div className="space-y-2">
            {candidates.map((s) => (
              <PickRow
                key={s.id}
                label={`Station ${s.id}${s.name && s.name !== `Station ${s.id}` ? ` \u2014 ${s.name}` : ''}`}
                hint={s.location || undefined}
                onClick={() => handlePick(s.id)}
                disabled={sending}
                right={sending
                  ? <RefreshCw size={18} className="animate-spin text-cq-caramel flex-shrink-0" />
                  : <ArrowRight size={18} className="text-cq-caramel flex-shrink-0" />}
              />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
};

export default MoveOrderDialog;
