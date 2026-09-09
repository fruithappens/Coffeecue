// components/barista/StationChooser.js
//
// A tablet has to be TOLD which station it is at. This screen asks, once,
// when no station has been chosen on this device (or the one it had no
// longer exists). The old code silently picked station 1, so a tablet
// carried between carts kept showing the wrong cart's orders.
import React from 'react';
import { Coffee, MapPin, RefreshCw } from 'lucide-react';
import { Status } from '../../design';

export default function StationChooser({ stations = [], loading = false, onChoose, onRefresh }) {
  const list = [...stations].sort((a, b) => (a.id || 0) - (b.id || 0));

  return (
    <div className="cq min-h-screen bg-cq-cream flex flex-col items-center justify-center p-6"
         data-testid="station-chooser">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-center mb-3 text-cq-caramel">
          <Coffee size={40} />
        </div>
        <h1 className="text-2xl font-bold text-center text-cq-roast">
          Which station is this tablet at?
        </h1>
        <p className="text-center text-cq-ink-2 mt-1 mb-6">
          Pick the cart you are standing at. You can change it later from the
          station name at the top of the screen.
        </p>

        {loading && list.length === 0 && (
          <p className="text-center text-cq-ink-3">Loading stations\u2026</p>
        )}
        {!loading && list.length === 0 && (
          <p className="text-center text-cq-ink-2">
            No stations yet. Add them under Stations, then refresh.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChoose && onChoose(s.id)}
              className="text-left bg-cq-milk rounded-cq-lg shadow-cq-card p-5 border-2
                         border-transparent transition-colors hover:border-cq-caramel
                         focus:outline-none focus:border-cq-caramel-deep
                         active:bg-cq-caramel-wash"
            >
              <div className="text-lg font-bold text-cq-roast">
                {s.name || `Station ${s.id}`}
              </div>
              {s.location ? (
                <div className="text-sm text-cq-ink-2 flex items-center gap-1 mt-1">
                  <MapPin size={14} />
                  {s.location}
                </div>
              ) : null}
              <div className="text-xs mt-2">
                <Status state={s.status === 'active' ? 'ok' : 'bad'}>
                  {s.status === 'active' ? 'Active' : 'Not active'}
                </Status>
              </div>
            </button>
          ))}
        </div>

        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-6 mx-auto flex items-center gap-1 text-sm text-cq-ink-2
                       hover:text-cq-roast"
          >
            <RefreshCw size={14} />
            Refresh list
          </button>
        ) : null}
      </div>
    </div>
  );
}
