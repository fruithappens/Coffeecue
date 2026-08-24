// BackupBaristaSettings.js — set the code that turns the ordering iPad
// into a barista station.
//
// Talks to /api/settings/station-unlock directly rather than going
// through useSettings, on purpose: that hook keeps a local copy and much
// of what it holds never reaches the database. A security setting that
// looks saved and is not would be the worst kind of bug here — the code
// would appear set, and the fallback would not work on the day it is
// needed.
//
// The code is WRITE-ONLY. It is never sent back to the browser, so this
// panel can say whether one exists but can never show it. That is the
// point: settings get exported and pasted into support threads.
import React, { useCallback, useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import ApiService from '../../services/ApiService';

const BackupBaristaSettings = () => {
  const [state, setState] = useState(null);   // {enabled, configured}
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);  // {ok, text}

  const load = useCallback(async () => {
    try {
      const r = await ApiService.request('/settings/station-unlock');
      setState(r?.data || { enabled: false, configured: false });
    } catch (e) {
      setState({ enabled: false, configured: false, unreachable: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (body, successText) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await ApiService.request('/settings/station-unlock', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (r?.success) {
        setState(r.data);
        setCode('');
        setMessage({ ok: true, text: successText });
      } else {
        setMessage({ ok: false, text: r?.message || 'Could not save that.' });
      }
    } catch (e) {
      // The server rejects weak codes, so its message is the useful one.
      setMessage({ ok: false, text: e?.message || 'Could not save that.' });
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  return (
    <div>
      <h4 className="font-medium mb-2 flex items-center">
        <Shield size={16} className="mr-2" /> Backup barista device
      </h4>
      <p className="text-sm text-gray-600 mb-3">
        Lets the ordering iPad become a barista station if the main screen
        dies &mdash; long-press the bottom-left corner of the order page and
        enter this code. Off unless you set one.
      </p>

      <div className="text-sm mb-3">
        Status:{' '}
        {state.enabled ? (
          <span className="text-green-700 font-medium">on &mdash; a code is set</span>
        ) : state.configured ? (
          <span className="text-gray-700 font-medium">off &mdash; code saved but not in use</span>
        ) : (
          <span className="text-gray-500">off &mdash; no code set</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={state.configured ? 'New code' : 'Set a code'}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-48"
        />
        <button
          type="button"
          disabled={busy || !code}
          onClick={() => save({ code, enabled: true }, 'Code saved and turned on.')}
          className="bg-gray-800 text-white px-3 py-2 rounded-lg text-sm disabled:bg-gray-400"
        >
          Save code
        </button>
        {state.configured && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ enabled: !state.enabled },
                state.enabled ? 'Turned off.' : 'Turned back on.')}
              className="border border-gray-300 px-3 py-2 rounded-lg text-sm"
            >
              {state.enabled ? 'Turn off' : 'Turn on'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Remove the code? The backup device will stop working until you set a new one.')) return;
                save({ code: '' }, 'Code removed.');
              }}
              className="text-red-700 text-sm underline"
            >
              Remove code
            </button>
          </>
        )}
      </div>

      {message && (
        <p className={`text-sm mt-2 ${message.ok ? 'text-green-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
      <p className="text-xs text-gray-500 mt-2">
        Use at least 6 characters and avoid anything obvious &mdash; this
        device sits unattended in a public room, and the session it opens
        can see customer names and phone numbers.
      </p>
    </div>
  );
};

export default BackupBaristaSettings;
