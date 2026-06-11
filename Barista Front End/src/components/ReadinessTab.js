// ReadinessTab.js
//
// "Are we ready to take orders?" — single screen that runs ~8 backend
// checks and surfaces green / amber / red so the operator can fix
// problems BEFORE doors open. Embeds a send-test-SMS form so the
// most-likely-to-misconfigure thing (Twilio) can be verified end-to-end
// in one click.
//
// Hits GET /api/readiness (the operator-facing aggregator, separate
// from /api/health/full which is platform-facing) and POST /api/sms/test.

import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle, AlertTriangle, XCircle, RefreshCw,
  Send, Phone, Zap,
} from 'lucide-react';
import ApiServiceClass from '../services/ApiService';

const api = new ApiServiceClass();

const STATUS_STYLES = {
  ok:      { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-800',  Icon: CheckCircle,    iconClass: 'text-green-600' },
  warn:    { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-800',  Icon: AlertTriangle,  iconClass: 'text-amber-600' },
  fail:    { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-800',    Icon: XCircle,        iconClass: 'text-red-600' },
  skipped: { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-600',   Icon: AlertTriangle,  iconClass: 'text-gray-400' },
};

const ReadinessRow = ({ check }) => {
  const s = STATUS_STYLES[check.status] || STATUS_STYLES.warn;
  const { Icon } = s;
  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-4 flex items-start gap-3`}>
      <Icon className={`${s.iconClass} mt-0.5 flex-shrink-0`} size={20} />
      <div className="flex-1 min-w-0">
        <div className={`font-medium ${s.text}`}>{check.label}</div>
        {check.detail && (
          <div className={`text-sm mt-0.5 ${s.text} opacity-90`}>
            {check.detail}
          </div>
        )}
      </div>
      <span className={`text-xs font-mono uppercase ${s.text} opacity-80`}>
        {check.status}
      </span>
    </div>
  );
};

const ReadinessTab = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [testNumber, setTestNumber] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testSending, setTestSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await api.request('/readiness', { method: 'GET' });
      setData(resp);
      setError(null);
    } catch (e) {
      // Endpoint might not be deployed yet — show a clear "deploy needed"
      // rather than blowing up. Aligns with the optional-import pattern
      // on the backend.
      setError(e?.message || 'Readiness endpoint not available');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleSendTest = async (e) => {
    e.preventDefault();
    if (testSending) return;
    const num = testNumber.trim();
    if (!num.startsWith('+')) {
      setTestResult({
        success: false,
        message: 'Number must start with + and country code (e.g. +61400000000)',
      });
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const body = { to: num };
      if (testMessage.trim()) body.message = testMessage.trim();
      const resp = await api.request('/sms/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setTestResult({
        success: !!resp.success,
        message: resp.detail || (resp.success ? 'Sent.' : 'Unknown response'),
        preview: resp.preview,
        testingMode: !!resp.testing_mode,
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err?.message || 'Send failed',
      });
    } finally {
      setTestSending(false);
    }
  };

  const overall = data?.status || 'unknown';
  const overallStyle = STATUS_STYLES[overall] || STATUS_STYLES.warn;
  const OverallIcon = overallStyle.Icon;

  return (
    <div className="p-6 max-w-4xl">
      {/* Headline */}
      <div className={`rounded-lg border-2 ${overallStyle.border} ${overallStyle.bg} p-5 mb-6 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <OverallIcon className={overallStyle.iconClass} size={32} />
          <div>
            <h2 className={`text-xl font-bold ${overallStyle.text}`}>
              {loading ? 'Checking…' :
                error ? 'Readiness check unavailable' :
                overall === 'ok' ? 'Ready to take orders' :
                overall === 'warn' ? 'Mostly ready — review warnings' :
                overall === 'fail' ? 'Not ready — fix the red items first' :
                'Status unknown'}
            </h2>
            <p className={`text-sm ${overallStyle.text} opacity-80`}>
              Aggregated from SMS config, stations, inventory, capabilities,
              schema, Quick Setup, and recent crashes.
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Re-check
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-6">
          <p className="text-red-800 text-sm">{error}</p>
          <p className="text-red-700 text-xs mt-1">
            If you just pushed, wait for Railway to redeploy. Otherwise
            check the backend logs.
          </p>
        </div>
      )}

      {/* Individual checks */}
      {data?.checks?.length > 0 && (
        <div className="space-y-2 mb-8">
          {data.checks.map(check => (
            <ReadinessRow key={check.name} check={check} />
          ))}
        </div>
      )}

      {/* Send test SMS card. Lives here, in the most visited
          pre-event tab, because Twilio misconfiguration is the
          single most common demo-killer and one-click verification
          beats "did the customer get the welcome SMS? Check the
          customer's phone." */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2 mb-1">
          <Phone className="text-amber-600" size={20} />
          <h3 className="font-semibold text-lg">Send a test SMS</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Sends a real Twilio SMS to the number you type. If you get the
          text, customers will too. If you don't, fix Twilio before doors
          open.
        </p>
        <form onSubmit={handleSendTest} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">
                Your phone number (E.164)
              </span>
              <input
                type="tel"
                value={testNumber}
                onChange={e => setTestNumber(e.target.value)}
                placeholder="+61400000000"
                className="w-full px-3 py-2 border border-gray-300 rounded font-mono"
              />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">
                Custom message (optional)
              </span>
              <input
                type="text"
                value={testMessage}
                onChange={e => setTestMessage(e.target.value)}
                placeholder="Leave blank for a default welcome-style message"
                className="w-full px-3 py-2 border border-gray-300 rounded"
                maxLength={300}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={testSending || !testNumber.trim()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md disabled:opacity-50 flex items-center gap-2"
            >
              {testSending
                ? (<><RefreshCw size={16} className="animate-spin" /> Sending…</>)
                : (<><Send size={16} /> Send test SMS</>)}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.success ? 'text-green-700' : 'text-red-700'}`}>
                {testResult.success ? '✓ ' : '✗ '}{testResult.message}
              </span>
            )}
          </div>
          {testResult?.testingMode && testResult.preview && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm">
              <div className="font-medium text-amber-800 mb-1">
                TESTING_MODE preview (not actually sent):
              </div>
              <div className="text-amber-900 font-mono text-xs whitespace-pre-wrap">
                {testResult.preview}
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Demo helper: link back to Quick Setup. Operators land on Readiness
          when something's red and need somewhere to go. */}
      <div className="mt-6 text-sm text-gray-500 flex items-center gap-2">
        <Zap size={14} />
        Most fixes live in <strong className="text-gray-700">Quick Setup</strong> (left sidebar).
      </div>
    </div>
  );
};

export default ReadinessTab;
