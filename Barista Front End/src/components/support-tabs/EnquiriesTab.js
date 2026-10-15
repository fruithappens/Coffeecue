// EnquiriesTab -- sign-ups (cupq.app/start), help requests, and "Book a demo"
// requests from the cupq.com.au form.
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

// Help requests from the ? button on staff screens (U4-5), newest first.
function HelpRequests() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();
  const [rows, setRows] = useState(null);
  const [tags, setTags] = useState([]);
  const [notes, setNotes] = useState({});
  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.get('/support-requests');
      setRows(Array.isArray(r?.requests) ? r.requests : []);
      setTags(Array.isArray(r?.tags) ? r.tags : []);
    } catch (e) { setRows([]); }
  }, []);
  // Tag it, take it, or note what was done (U4-6).
  const triage = async (r, change) => {
    try {
      await apiRef.current.request(`/support-requests/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      if ('note' in change) setNotes((n) => { const c = { ...n }; delete c[r.id]; return c; });
      load();
    } catch (e) { showToast("Couldn't save that", 'error'); }
  };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const markHandled = async (r) => {
    try { await apiRef.current.post(`/support-requests/${r.id}/handled`, {}); load(); } catch (e) { /* stays */ }
  };
  if (!rows || rows.length === 0) return null;
  const open = rows.filter(r => !r.handled_at).length;
  return (
    <div className="mb-6">
      <h3 className="text-base font-bold text-cq-roast mb-1">Help requests {open ? `(${open} open)` : ''}</h3>
      <p className="text-sm text-cq-ink-3 mb-2">
        Sent from the ? button on staff screens, with where they were. Each is texted to whoever is on call
        (People &gt; On call) and the admin alert number. Tag it, say you're on it, and note what fixed it.
      </p>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className={`rounded-cq-md border p-3 ${r.handled_at ? 'border-cq-line bg-cq-wash opacity-70' : 'border-cq-caramel bg-cq-milk'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-cq-roast break-words">#{r.id} · {r.message}</div>
                <div className="text-xs text-cq-ink-3 mt-1">
                  {r.username || 'someone'}{r.role ? ` (${r.role})` : ''} · {when(r.created_at)} · {r.screen || '?'}
                  {r.station ? ` · station ${r.station}` : ''}{r.crashes ? ` · ${r.crashes} crash(es) just before` : ''}
                  {r.notified ? ' · texted' : ''}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <select value={r.tag || ''} onChange={(e) => triage(r, { tag: e.target.value })}
                    aria-label={`Tag for request ${r.id}`}
                    className="h-8 px-2 rounded border border-cq-line bg-white text-cq-roast">
                    <option value="">No tag</option>
                    {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {r.taken_by
                    ? <span className="font-semibold text-cq-roast">{r.taken_by} is on it</span>
                    : !r.handled_at && (
                      <button type="button" onClick={() => triage(r, { take: true })}
                        className="h-8 px-2 rounded border border-cq-line font-semibold text-cq-roast">I'm on it</button>
                    )}
                </div>
                {r.note && notes[r.id] === undefined && (
                  <div className="mt-2 text-sm text-cq-ink-2 whitespace-pre-wrap">
                    <span className="text-cq-ink-3">Note: </span>{r.note}
                    <button type="button" onClick={() => setNotes((n) => ({ ...n, [r.id]: r.note }))}
                      className="ml-2 text-xs underline">Edit</button>
                  </div>
                )}
                {!r.note && notes[r.id] === undefined && (
                  <button type="button" onClick={() => setNotes((n) => ({ ...n, [r.id]: '' }))}
                    className="mt-2 text-xs underline text-cq-ink-2">Add a note</button>
                )}
                {notes[r.id] !== undefined && (
                  <div className="mt-2">
                    <textarea rows={2} value={notes[r.id]} aria-label={`Note for request ${r.id}`}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder="What was wrong, what fixed it"
                      className="w-full px-2 py-1 rounded border border-cq-line bg-white text-sm text-cq-roast" />
                    <button type="button" onClick={() => triage(r, { note: notes[r.id] })}
                      className="mt-1 h-8 px-3 rounded bg-cq-roast text-cq-cream text-xs font-bold">Save note</button>
                  </div>
                )}
              </div>
              {!r.handled_at && (
                <button type="button" onClick={() => markHandled(r)}
                  className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border border-cq-line text-xs">
                  <Check size={14} /> Handled
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Self-serve sign-ups from cupq.app/start (X7-9). Approving one doesn't
// build anything: it gives you their event file and the one command that
// builds their copy (scripts/new_client.py --apply) on your Mac.
function Signups() {
  const apiRef = useRef(null);
  if (!apiRef.current) apiRef.current = new ApiServiceClass();
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await apiRef.current.get('/signups');
      setRows(Array.isArray(r?.signups) ? r.signups : []);
    } catch (e) { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const decide = async (r, decision) => {
    try { await apiRef.current.post(`/signups/${r.id}/decision`, { decision }); load(); }
    catch (e) { showToast("Couldn't save that", 'error'); }
  };
  const download = async (r) => {
    try {
      const token = localStorage.getItem('coffee_system_token');
      const resp = await fetch(`/api/signups/${r.id}/event-file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(String(resp.status));
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `${r.slug}.cupq-event.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { showToast("Couldn't download the event file", 'error'); }
  };
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); showToast('Command copied', 'success'); }
    catch (e) { showToast('Select the command and copy it', 'info'); }
  };
  if (!rows || rows.length === 0) return null;
  const open = rows.filter((r) => r.status === 'new').length;
  return (
    <div className="mb-6">
      <h3 className="text-base font-bold text-cq-roast mb-1">Sign-ups {open ? `(${open} new)` : ''}</h3>
      <p className="text-sm text-cq-ink-3 mb-2">
        From cupq.app/start. Agree pricing first; then download their event file and run the build command on your Mac.
      </p>
      <div className="space-y-3">
        {rows.map((r) => (
          <Panel key={r.id} className={r.status === 'declined' ? 'opacity-60' : ''}>
            <div className="flex items-start gap-4 flex-wrap">
              {r.logo && <img src={r.logo} alt={`${r.organisation} logo`} className="h-12 max-w-[120px] object-contain rounded" style={{ background: (r.answers && r.answers.header_colour) || '#3B2A20' }} />}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-cq-roast">{r.organisation} <span className="font-normal text-cq-ink-3">- {r.event_name}</span></div>
                <div className="text-xs text-cq-ink-3 mb-2">
                  {when(r.created_at)} · {r.status}{r.decided_by ? ` by ${r.decided_by}` : ''}{r.notified ? ' · texted to you' : ''}
                </div>
                <Field label="Contact">{r.name}{r.email ? <> · <a className="underline" href={`mailto:${r.email}`}>{r.email}</a></> : null}{r.phone ? <> · <a className="underline" href={`tel:${r.phone}`}>{r.phone}</a></> : null}</Field>
                <Field label="When">{r.starts}{r.ends && r.ends !== r.starts ? ` to ${r.ends}` : ''} ({(r.timezone || '').split('/').pop()})</Field>
                <Field label="People">{r.attendees}</Field>
                <Field label="Address">{r.slug}.cupq.app</Field>
                <Field label="Serving">{[
                  ...Object.entries((r.answers && r.answers.drinks) || {}).filter(([, v]) => v).map(([k]) => k.replace('_', ' ').replace('espresso drinks', 'coffee')),
                  r.answers && r.answers.teas ? 'tea' : null,
                ].filter(Boolean).join(', ')}</Field>
                <Field label="Milks">{((r.answers && r.answers.milks) || []).join(', ')}</Field>
                <Field label="Sizes">{((r.answers && r.answers.sizes) || []).join(', ')}</Field>
                <Field label="Texts">{r.texts ? 'yes' : 'no'}</Field>
                <Field label="Plan">{r.plan}</Field>
                {r.quote && (
                  <div className="mt-3 rounded-cq-md bg-cq-wash p-3 text-sm">
                    <div className="font-bold text-cq-roast">
                      Starting quote: {r.quote.tier_name}{r.quote.suggested ? ' (fits their headcount)' : ''}, {r.quote.days} day{r.quote.days === 1 ? '' : 's'}
                    </div>
                    {r.quote.quoted_separately ? (
                      <div className="text-cq-ink-2 mt-1">The Urn is quoted by stations and days.</div>
                    ) : (
                      <>
                        {r.quote.lines.map((l, i) => (
                          <div key={i} className="flex justify-between text-cq-ink-2 mt-1">
                            <span>{l.what}{l.qty > 1 ? ` × ${l.qty}` : ''}</span><span className="tabular-nums">${l.amount.toLocaleString()}</span>
                          </div>
                        ))}
                        <div className="flex justify-between font-bold text-cq-roast mt-1 pt-1 border-t border-cq-line">
                          <span>Total ex GST</span><span className="tabular-nums">${r.quote.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-cq-ink-3 mt-1">${r.quote.total.toLocaleString()} incl. GST. Software only: add hardware, crew or EventsAir in the reply if they want them.</div>
                      </>
                    )}
                  </div>
                )}
                {r.notes ? <p className="text-sm text-cq-ink-2 mt-2 whitespace-pre-wrap">{r.notes}</p> : null}
                {r.status === 'approved' && (
                  <div className="mt-3">
                    <div className="text-xs text-cq-ink-3 mb-1">1. Download their event file. 2. Run this in Terminal (about 10 minutes):</div>
                    <code className="block text-xs bg-cq-wash rounded p-2 break-all text-cq-roast">{r.build_command}</code>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => download(r)} className="h-9 px-3 rounded-cq-sm border-2 border-cq-line text-sm font-semibold text-cq-roast">Download event file</button>
                      <button type="button" onClick={() => copy(r.build_command)} className="h-9 px-3 rounded-cq-sm border-2 border-cq-line text-sm font-semibold text-cq-roast">Copy command</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {r.status !== 'approved' && (
                  <button type="button" onClick={() => decide(r, 'approved')} className="h-9 px-3 rounded-cq-sm bg-cq-roast text-cq-cream text-sm font-bold">Approve</button>
                )}
                {r.status === 'new' && (
                  <button type="button" onClick={() => decide(r, 'declined')} className="h-9 px-3 rounded-cq-sm border-2 border-cq-line text-sm font-semibold text-cq-roast">Decline</button>
                )}
                {r.status !== 'new' && (
                  <button type="button" onClick={() => decide(r, 'new')} className="h-9 px-3 text-xs underline text-cq-ink-2 inline-flex items-center gap-1"><RotateCcw size={12} /> Undo</button>
                )}
              </div>
            </div>
          </Panel>
        ))}
      </div>
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
        Sign-ups from cupq.app/start, help requests from staff screens, and "Book a demo" requests from
        cupq.com.au. Each is also texted to the admin alert number (Live &gt; Readiness &gt; Admin alerts)
        and whoever is on call.
      </p>
      <Signups />
      <HelpRequests />
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
