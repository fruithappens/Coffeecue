// EnquiriesTab -- "Book a demo" requests from the cupq.com.au form.
//
// Each one is also texted to the admin alert number when it arrives; this
// list is the record, so nothing depends on the text getting through.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Inbox, Loader, AlertTriangle, Check, RotateCcw } from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import { Panel, Empty } from '../../design';
import { showToast } from '../shared/Toast';

const when = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch (e) { return ''; }
};

function Field({ label, children }) {
  if (!children) return null;
  return (
    <div className="text-sm">
      <span className="text-cq-ink-3">{label}: </span>
      <span className="text-cq-ink-2">{children}</span>
    </div>
  );
}

export default function EnquiriesTab() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const resp = await apiRef.current.get('/demo-requests');
      const rows = resp && resp.data && resp.data.requests;
      if (Array.isArray(rows)) setList(rows);
      else setError((resp && resp.message) || 'Could not load enquiries.');
    } catch (err) {
      setError(err?.message || 'Could not load enquiries.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (r) => {
    try {
      const resp = await apiRef.current.post(`/demo-requests/${r.id}/handled`, { handled: !r.handled_at });
      if (resp && resp.success) await load();
      else showToast((resp && resp.message) || 'Could not update', 'error');
    } catch (err) {
      showToast(err?.message || 'Could not update', 'error');
    }
  };

  const open = list.filter((r) => !r.handled_at);
  const done = list.filter((r) => r.handled_at);

  const card = (r) => (
    <Panel key={r.id} className={r.handled_at ? 'opacity-60' : ''}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-cq-roast">
            {r.name}{r.organisation ? <span className="font-normal text-cq-ink-3"> - {r.organisation}</span> : null}
          </div>
          <div className="text-xs text-cq-ink-3 mb-2">
            {when(r.created_at)}{r.notified ? ' - texted to you' : ''}
          </div>
          <Field label="Email">{r.email ? <a className="underline" href={`mailto:${r.email}`}>{r.email}</a> : null}</Field>
          <Field label="Phone">{r.phone ? <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a> : null}</Field>
          <Field label="When">{r.event_when}</Field>
          <Field label="Attendees">{r.attendees}</Field>
          {r.message ? <p className="text-sm text-cq-ink-2 mt-2 whitespace-pre-wrap">{r.message}</p> : null}
          {r.quote ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-cq-caramel-deep font-semibold">Their quote</summary>
              <pre className="whitespace-pre-wrap font-sans text-cq-ink-2 mt-1">{r.quote}</pre>
            </details>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => toggle(r)}
          className="h-9 px-3 rounded-cq-sm border-2 border-cq-line text-sm font-semibold text-cq-roast
                     hover:border-cq-caramel inline-flex items-center gap-1.5"
        >
          {r.handled_at ? <><RotateCcw size={14} /> Reopen</> : <><Check size={14} /> Dealt with</>}
        </button>
      </div>
    </Panel>
  );

  return (
    <div className="cq max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <Inbox className="text-cq-caramel" size={22} />
        <h2 className="text-lg font-bold text-cq-roast">Enquiries</h2>
      </div>
      <p className="text-sm text-cq-ink-3 mb-4 max-w-[62ch]">
        "Book a demo" requests from cupq.com.au. Each one is also texted to the
        admin alert number (Live &gt; Readiness &gt; Admin alerts).
      </p>
      {loading ? (
        <Empty><span className="inline-flex items-center gap-2"><Loader className="animate-spin" size={16} /> Loading…</span></Empty>
      ) : error ? (
        <div className="bg-cq-alert-wash rounded-cq-md p-3 text-sm text-cq-alert flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
          <button type="button" onClick={load} className="ml-auto underline font-semibold">Try again</button>
        </div>
      ) : list.length === 0 ? (
        <Panel><Empty>No enquiries yet.</Empty></Panel>
      ) : (
        <>
          {open.map(card)}
          {done.length ? <h3 className="text-sm font-semibold text-cq-ink-3 mt-6 mb-2">Dealt with</h3> : null}
          {done.map(card)}
        </>
      )}
    </div>
  );
}
