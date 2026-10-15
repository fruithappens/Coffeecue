// SmsWordingTab.js — Runner > Messages > Text wording (roadmap X7-6).
//
// What the text bot says, message by message. Leave one empty to keep
// CupQ's wording. Each shows its cost: how many texts it takes, and a
// warning when a character (an emoji, a curly quote) makes it cost far more.
// The welcome, confirmation, started and ready texts are edited in
// Messages > Text blast, as before.
import React, { useEffect, useState } from 'react';
import ApiServiceClass from '../../services/ApiService';
import { showToast } from '../shared/Toast';

const api = new ApiServiceClass();

const SmsWordingTab = () => {
  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState({});
  const [problems, setProblems] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const r = await api.get('/settings/sms-wording');
      setMessages(r.messages || []);
      setDraft(Object.fromEntries((r.messages || []).filter((m) => m.override).map((m) => [m.key, m.override])));
    } catch (e) { setMessages([]); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true); setProblems({});
    try {
      const r = await api.put('/settings/sms-wording', { wording: draft });
      if (r && r.success === false) { setProblems(r.problems || {}); showToast(r.message || "Couldn't save", 'error'); return; }
      setMessages(r.messages || []);
      showToast('Saved. The bot uses it from the next text.', 'success');
    } catch (e) {
      // ApiService puts the server's reply on e.details (not e.response.data).
      const p = e && e.details && e.details.problems;
      if (p) setProblems(p);
      showToast("Couldn't save: check the messages marked in red", 'error');
    } finally { setBusy(false); }
  };

  if (!messages) return <div className="cq p-6 text-cq-ink-2">Loading…</div>;
  return (
    <div className="cq bg-cq-milk rounded-cq-lg shadow-cq-card p-6">
      <h2 className="text-xl font-extrabold text-cq-roast">Text wording</h2>
      <p className="text-sm text-cq-ink-2 mt-1">
        What the text bot replies, message by message. Leave one empty to keep CupQ's wording. Words in
        {' {braces} '}are filled in for each customer; keep the ones you need. The welcome, confirmation,
        started and ready texts are under Text blast.
      </p>
      <div className="mt-5 space-y-5">
        {messages.map((m) => {
          const val = draft[m.key] || '';
          const err = problems[m.key] || m.problem;
          return (
            <div key={m.key} className="border-b border-cq-line pb-4">
              <div className="text-sm font-bold text-cq-roast">{m.where}</div>
              <textarea rows={2} value={val} placeholder={m.default}
                onChange={(e) => setDraft((d) => ({ ...d, [m.key]: e.target.value }))}
                className={`mt-1 w-full px-3 py-2 rounded-cq-md border-2 bg-white text-cq-roast text-sm ${err ? 'border-cq-alert' : 'border-cq-line'}`} />
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-cq-ink-3">
                {Object.keys(m.placeholders).length > 0 && (
                  <span>Fills in: {Object.entries(m.placeholders).map(([k, d]) => `{${k}} ${d}`).join(' · ')}</span>
                )}
                <span>{m.cost.segments} text{m.cost.segments === 1 ? '' : 's'} each{!m.cost.plain_text && (
                  <b className="text-cq-alert"> · uses a special character, so each text holds far less and costs about 3x</b>)}
                </span>
              </div>
              {err && <div className="mt-1 text-xs font-semibold text-cq-alert">{err}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={save} disabled={busy}
          className="h-11 px-5 rounded-cq-md bg-cq-roast text-cq-cream font-bold disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setDraft({})} className="h-11 px-4 text-sm font-semibold text-cq-ink-2 hover:underline">
          Use CupQ's wording for all
        </button>
      </div>
    </div>
  );
};

export default SmsWordingTab;
