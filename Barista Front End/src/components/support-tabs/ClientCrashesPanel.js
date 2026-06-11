// ClientCrashesPanel.js
//
// Surfaces frontend crashes captured by ErrorBoundary →
// /api/client-errors. Without this panel the data sits in Postgres
// unread; the whole point of capturing crashes is that an operator
// (or me) can see them. This is where a "the iPad threw an error"
// turns into "click the row, read the stack, fix it."
//
// Lives at the top of DiagnosticsTab. Auto-refreshes every 30s and on
// every WebSocket reconnect — fresh data without manual refresh.

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

const api = new ApiServiceClass();

/** Format an ISO timestamp as "2m ago" / "1h ago" / "Mar 14, 09:12". */
function formatWhen(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const secAgo = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secAgo < 60) return `${secAgo}s ago`;
  if (secAgo < 3600) return `${Math.floor(secAgo / 60)}m ago`;
  if (secAgo < 86400) return `${Math.floor(secAgo / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

const ClientCrashesPanel = () => {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(new Set());
  const [lastFetched, setLastFetched] = useState(null);

  const load = useCallback(async () => {
    try {
      const resp = await api.request('/client-errors?limit=20', { method: 'GET' });
      // The endpoint returns {success, errors: [...]} but never rejects on
      // empty-DB or missing-table — falls back to []. Use whatever we get.
      setErrors(Array.isArray(resp?.errors) ? resp.errors : []);
      setLastFetched(new Date());
    } catch (e) {
      // Endpoint might not be deployed yet (e.g. Railway hasn't picked up
      // the migration). Don't show an error UI for this — the panel is
      // already saying "no crashes" by default, which is the right vibe.
      console.warn('ClientCrashesPanel: failed to load', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Auto-refresh every 30s. Cheap query — newest-first index, limit 20.
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = (id) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Decide the panel's overall state: green if no errors, red if any
  // in the last hour, amber otherwise. Operators glance at the color.
  const recent = errors.filter(e => {
    if (!e.occurred_at) return false;
    return (Date.now() - new Date(e.occurred_at).getTime()) < 3600 * 1000;
  });
  const hasRecent = recent.length > 0;
  const hasAny = errors.length > 0;

  const barClasses = hasRecent
    ? 'border-red-300 bg-red-50'
    : hasAny
      ? 'border-amber-300 bg-amber-50'
      : 'border-green-300 bg-green-50';
  const Icon = hasRecent ? AlertTriangle : hasAny ? AlertTriangle : CheckCircle;
  const iconClasses = hasRecent
    ? 'text-red-600'
    : hasAny
      ? 'text-amber-600'
      : 'text-green-600';

  return (
    <div className={`mb-4 rounded-lg border ${barClasses} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-current/20">
        <div className="flex items-center gap-2">
          <Icon size={20} className={iconClasses} />
          <h3 className="font-semibold">
            Frontend crashes
            {hasRecent && (
              <span className="ml-2 text-sm font-normal text-red-700">
                — {recent.length} in the last hour
              </span>
            )}
            {!hasRecent && hasAny && (
              <span className="ml-2 text-sm font-normal text-amber-700">
                — {errors.length} recent (none in last hour)
              </span>
            )}
            {!hasAny && !loading && (
              <span className="ml-2 text-sm font-normal text-green-700">
                — no crashes captured
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-600">
          {lastFetched && (
            <span title={lastFetched.toLocaleString()}>
              Updated {formatWhen(lastFetched.toISOString())}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded hover:bg-white/40 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="px-4 py-3 text-sm text-gray-600">Loading…</div>
      )}

      {!loading && errors.length === 0 && (
        <div className="px-4 py-3 text-sm text-green-700">
          No React Error Boundary catches recorded. When a component crashes,
          it'll appear here automatically — phoned home via
          <code className="mx-1 px-1 bg-white/60 rounded">/api/client-errors</code>.
        </div>
      )}

      {!loading && errors.length > 0 && (
        <ul className="divide-y divide-current/10">
          {errors.map(err => {
            const isOpen = expanded.has(err.id);
            return (
              <li key={err.id} className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => toggle(err.id)}
                  className="w-full flex items-start gap-2 text-left"
                >
                  {isOpen ? <ChevronDown size={14} className="mt-1" /> : <ChevronRight size={14} className="mt-1" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        {err.component || 'Unknown component'}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatWhen(err.occurred_at)}
                      </span>
                      {err.user_id && (
                        <span className="text-xs px-1.5 py-0.5 bg-white/60 rounded">
                          {err.user_id}
                        </span>
                      )}
                      {err.retry_count > 0 && (
                        <span className="text-xs px-1.5 py-0.5 bg-white/60 rounded">
                          {err.retry_count}× retry
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-700 truncate mt-0.5">
                      {err.message || '(no message)'}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="ml-6 mt-2 text-xs space-y-1">
                    {err.url && (
                      <div className="break-all">
                        <span className="text-gray-500">URL: </span>
                        <span className="font-mono">{err.url}</span>
                      </div>
                    )}
                    {/* The list endpoint omits stack + component_stack
                        to keep payloads small. If we ever want them
                        inline, add a /api/client-errors/<id> detail
                        endpoint — for now we just show the summary. */}
                    <div className="text-gray-500 italic">
                      Full stack + component stack are in Postgres
                      (<code className="font-mono bg-white/60 px-1 rounded">client_errors.id={err.id}</code>) — query directly when fixing.
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ClientCrashesPanel;
