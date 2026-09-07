// components/barista/StationChooser.js
//
// A tablet has to be TOLD which station it is at. This screen asks, once,
// when no station has been chosen on this device (or the one it had no
// longer exists). The old code silently picked station 1, so a tablet
// carried between carts kept showing the wrong cart's orders.
import React from 'react';
import { Coffee, MapPin, RefreshCw } from 'lucide-react';

export default function StationChooser({ stations = [], loading = false, onChoose, onRefresh }) {
  const list = [...stations].sort((a, b) => (a.id || 0) - (b.id || 0));

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col items-center justify-center p-6" data-testid="station-chooser">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-center mb-3 text-amber-800">
          <Coffee size={40} />
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-900">Which station is this tablet at?</h1>
        <p className="text-center text-gray-600 mt-1 mb-6">
          Pick the cart you are standing at. You can change it later from the station name at the top of the screen.
        </p>

        {loading && list.length === 0 && (
          <p className="text-center text-gray-500">Loading stations…</p>
        )}
        {!loading && list.length === 0 && (
          <p className="text-center text-gray-600">
            No stations yet. Add them in Organiser → Stations, then refresh.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onChoose && onChoose(s.id)}
              className="text-left bg-white rounded-xl shadow p-5 border-2 border-transparent hover:border-amber-500 focus:outline-none focus:border-amber-600 active:bg-amber-100"
            >
              <div className="text-lg font-bold text-gray-900">{s.name || `Station ${s.id}`}</div>
              {s.location ? (
                <div className="text-sm text-gray-600 flex items-center mt-1">
                  <MapPin size={14} className="mr-1" />
                  {s.location}
                </div>
              ) : null}
              <div className="text-xs mt-2 flex items-center text-gray-500">
                <span className={`w-2 h-2 rounded-full mr-1 ${s.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {s.status === 'active' ? 'Active' : 'Not active'}
              </div>
            </button>
          ))}
        </div>

        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-6 mx-auto flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <RefreshCw size={14} className="mr-1" />
            Refresh list
          </button>
        ) : null}
      </div>
    </div>
  );
}
