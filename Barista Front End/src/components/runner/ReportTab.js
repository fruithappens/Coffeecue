// The event report.
//
// Phase 7. The numbers were always there -- /api/reports/today has computed
// them for a long time -- but they were only reachable as a printable HTML
// page, and only ever for TODAY. An event you ran last week could not be
// looked at, which is the only time anyone actually wants a report.
//
// So: pick the day (or the run of days) the event happened on, read it here,
// and print or email it from the same screen.
import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3, Clock, Coffee, Printer, Mail, AlertTriangle, Info, Milk, Users,
  Package,
} from 'lucide-react';
import AuthService from '../../services/AuthService';

const authHeaders = () => {
  const t = AuthService.getToken ? AuthService.getToken() : null;
  return t ? { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }
           : { 'Content-Type': 'application/json' };
};

const fmtDay = (iso) => {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined,
      { weekday: 'short', day: 'numeric', month: 'short' });
  } catch (e) { return iso; }
};

const Stat = ({ label, value, sub, Icon }) => (
  <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4 min-w-0">
    <div className="flex items-center gap-1.5 text-cq-ink-3 text-xs font-semibold uppercase tracking-wide">
      {Icon ? <Icon className="w-3.5 h-3.5" /> : null}{label}
    </div>
    <div className="text-3xl font-extrabold text-cq-roast mt-1 tabular-nums">{value}</div>
    {sub ? <div className="text-xs text-cq-ink-3 mt-0.5">{sub}</div> : null}
  </div>
);

const Card = ({ title, Icon, children, right }) => (
  <section className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
    <div className="flex items-center gap-2 mb-3">
      {Icon ? <Icon className="w-4 h-4 text-cq-caramel" /> : null}
      <h3 className="text-lg font-bold text-cq-roast">{title}</h3>
      {right ? <div className="ml-auto text-sm text-cq-ink-3">{right}</div> : null}
    </div>
    {children}
  </section>
);

// A row of the biggest thing, so a count reads as a share without a chart.
const Bar = ({ label, n, max, suffix }) => (
  <div className="flex items-center gap-3 py-1">
    <span className="w-32 shrink-0 text-sm text-cq-ink-2 capitalize truncate">{label}</span>
    <span className="flex-1 h-2.5 rounded-full bg-cq-wash overflow-hidden">
      <span className="block h-full rounded-full bg-cq-caramel"
            style={{ width: `${max ? Math.round((n / max) * 100) : 0}%` }} />
    </span>
    <span className="w-20 text-right text-sm font-semibold text-cq-roast tabular-nums">
      {n}{suffix || ''}
    </span>
  </div>
);

export default function ReportTab() {
  const [days, setDays] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [emailNote, setEmailNote] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/reports/days', { headers: authHeaders() });
        const d = await r.json();
        const list = d.days || [];
        setDays(list);
        // Open on the busiest recent day rather than today, because today is
        // usually empty and an empty report looks broken.
        const best = list.slice(0, 14).reduce(
          (a, b) => (!a || b.orders > a.orders ? b : a), null);
        if (best) { setFrom(best.date); setTo(best.date); }
      } catch (e) { /* the pickers still work typed in by hand */ }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!from) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams({ from, to: to || from });
      const r = await fetch(`/api/reports/today?${qs}`, { headers: authHeaders() });
      setData(await r.json());
    } catch (e) {
      setData({ success: false, error: 'Could not reach the server.' });
    } finally { setBusy(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const emailIt = async () => {
    setEmailNote(null);
    try {
      const r = await fetch('/api/reports/post-event/email', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ from, to: to || from }),
      });
      const d = await r.json();
      setEmailNote(d.success === false
        ? (d.error || d.message || 'That did not send.')
        : 'Sent.');
    } catch (e) { setEmailNote('Could not reach the server.'); }
  };

  const d = data || {};
  const ok = d.success !== false;
  const topDrinks = d.top_drinks || [];
  const byMilk = (d.milk && d.milk.by_milk) || [];
  const stations = d.per_station || [];
  const issues = d.issues || [];
  const maxDrink = topDrinks.reduce((m, x) => Math.max(m, x.orders || 0), 0);
  const maxMilk = byMilk.reduce((m, x) => Math.max(m, x.orders || 0), 0);
  const done = ((d.status_breakdown || {}).picked_up || 0)
             + ((d.status_breakdown || {}).completed || 0);

  return (
    <div className="cq space-y-5">
      <section className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <BarChart3 className="w-5 h-5 text-cq-caramel" />
          <h2 className="text-lg font-bold text-cq-roast">The event report</h2>
        </div>
        <p className="text-sm text-cq-ink-3 mb-4">
          Built from the orders themselves. Pick the day it happened —
          or the first and last day, if it ran over more than one.
        </p>

        {days.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {days.slice(0, 8).map((x) => (
              <button
                key={x.date}
                type="button"
                onClick={() => { setFrom(x.date); setTo(x.date); }}
                className={`px-3 py-1.5 rounded-full border-2 text-sm ${
                  from === x.date && (to === x.date || !to)
                    ? 'border-cq-caramel bg-cq-caramel/10 font-semibold text-cq-roast'
                    : 'border-cq-line text-cq-ink-2 hover:border-cq-caramel'}`}
              >
                {fmtDay(x.date)}
                <span className="ml-1.5 text-cq-ink-3 tabular-nums">{x.orders}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-cq-ink-3 mb-1">First day</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                   className="border-2 border-cq-line rounded-cq-md px-3 py-2" />
          </label>
          <label className="text-sm">
            <span className="block text-cq-ink-3 mb-1">Last day</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                   className="border-2 border-cq-line rounded-cq-md px-3 py-2" />
          </label>
          <a href={`/api/reports/today/print?view=post&from=${from}&to=${to || from}`}
             target="_blank" rel="noreferrer"
             className="px-4 py-2.5 rounded-cq-md border-2 border-cq-line text-cq-ink-2
                        hover:border-cq-caramel flex items-center gap-1.5">
            <Printer className="w-4 h-4" /> Print or save as PDF
          </a>
          <button type="button" onClick={emailIt}
                  className="px-4 py-2.5 rounded-cq-md border-2 border-cq-line text-cq-ink-2
                             hover:border-cq-caramel flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Email it
          </button>
          {emailNote ? <span className="text-sm text-cq-ink-3">{emailNote}</span> : null}
        </div>
        {d.timezone ? (
          <p className="text-xs text-cq-ink-3 mt-3">
            Days and times are {d.timezone.replace('_', ' ')} — where the event is,
            not where the server is.
          </p>
        ) : null}
      </section>

      {busy && <p className="text-sm text-cq-ink-3">Reading the orders…</p>}

      {!busy && !ok && (
        <p className="text-sm text-cq-alert">{d.error || 'The report could not be built.'}</p>
      )}

      {!busy && ok && data && (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Stat label="Coffees" value={d.total_orders ?? 0}
                  sub={`${done} handed over`} Icon={Coffee} />
            <Stat label="Average wait"
                  value={d.avg_wait_min == null ? '—' : `${d.avg_wait_min} min`}
                  sub="order to collection" Icon={Clock} />
            <Stat label="Busiest hour"
                  value={d.peak_hour ? `${d.peak_hour.hour}:00` : '—'}
                  sub={d.peak_hour ? `${d.peak_hour.orders} in that hour` : null}
                  Icon={BarChart3} />
            <Stat label="Stations" value={stations.length}
                  sub={d.busiest_station_id ? `busiest was ${d.busiest_station_id}` : null}
                  Icon={Users} />
          </div>

          {issues.length > 0 && (
            <Card title="Worth knowing" Icon={AlertTriangle}>
              <ul className="space-y-2.5">
                {issues.map((i) => (
                  <li key={i.key} className="flex gap-2.5">
                    {i.severity === 'warning'
                      ? <AlertTriangle className="w-4 h-4 text-cq-alert shrink-0 mt-0.5" />
                      : <Info className="w-4 h-4 text-cq-caramel shrink-0 mt-0.5" />}
                    <div>
                      <div className="font-semibold text-cq-roast text-sm">{i.title}</div>
                      {i.hint ? <div className="text-sm text-cq-ink-3">{i.hint}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="What they drank" Icon={Coffee}>
              {topDrinks.length
                ? topDrinks.map((x) => (
                    <Bar key={x.drink} label={x.drink} n={x.orders} max={maxDrink} />))
                : <p className="text-sm text-cq-ink-3">No orders in this window.</p>}
            </Card>

            <Card title="Milk" Icon={Milk}
                  right={d.milk ? `${d.milk.alternative} of ${
                    (d.milk.dairy || 0) + (d.milk.alternative || 0)} non-dairy` : null}>
              {byMilk.length
                ? byMilk.slice(0, 7).map((x) => (
                    <Bar key={x.milk} label={x.milk} n={x.orders} max={maxMilk} />))
                : <p className="text-sm text-cq-ink-3">No milk recorded.</p>}
              {(d.unused_milks || []).length > 0 && (
                <p className="text-xs text-cq-ink-3 mt-3">
                  Stocked but never ordered: {(d.unused_milks || []).join(', ')}.
                </p>
              )}
            </Card>
          </div>

          {d.beans && d.beans.orders_counted > 0 && (
            <Card title="Coffee used" Icon={Package}
                  right={`at ${d.beans.grams_per_shot} g a shot`}>
              <div className="grid gap-4 sm:grid-cols-3 mb-4">
                <div>
                  <div className="text-3xl font-extrabold text-cq-roast tabular-nums">
                    {d.beans.kg} kg
                  </div>
                  <div className="text-xs text-cq-ink-3">
                    across {d.beans.orders_counted} coffees
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-cq-roast tabular-nums">
                    {d.beans.shots}
                  </div>
                  <div className="text-xs text-cq-ink-3">shots pulled</div>
                </div>
                <div>
                  <div className="text-3xl font-extrabold text-cq-roast tabular-nums">
                    {d.beans.kg_per_100} kg
                  </div>
                  <div className="text-xs text-cq-ink-3">per 100 coffees — order by this</div>
                </div>
              </div>

              {Object.keys(d.beans.by_bean || {}).length > 1 && (
                <div className="mb-4">
                  {Object.entries(d.beans.by_bean).map(([name, kg]) => (
                    <Bar key={name} label={name} n={kg}
                         max={Math.max(...Object.values(d.beans.by_bean))} suffix=" kg" />
                  ))}
                </div>
              )}

              <div className="text-sm text-cq-ink-2 border-t border-cq-line pt-3">
                <span className="font-semibold text-cq-roast">
                  {d.beans.strength_mix.as_recipe}
                </span> as the recipe
                {' · '}
                <span className="font-semibold text-cq-roast">
                  {d.beans.strength_mix.extra}
                </span> with an extra shot
                {' · '}
                <span className="font-semibold text-cq-roast">
                  {d.beans.strength_mix.lighter}
                </span> lighter
              </div>
              <p className="text-xs text-cq-ink-3 mt-2">
                Worked out from the recipe cards at today's dose, so it answers
                "how much would this event take now" rather than what the ledger
                happened to record on the day.
                {d.beans.no_recipe
                  ? ` ${d.beans.no_recipe} order(s) had no recipe and are not counted.`
                  : ''}
              </p>
            </Card>
          )}

          <Card title="How each station went" Icon={Users}>
            {stations.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-cq-ink-3 border-b border-cq-line">
                      <th className="py-2 font-semibold">Station</th>
                      <th className="py-2 font-semibold text-right">Orders</th>
                      <th className="py-2 font-semibold text-right">Handed over</th>
                      <th className="py-2 font-semibold text-right">Avg wait</th>
                      <th className="py-2 font-semibold text-right">Per hour</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {stations.map((s) => (
                      <tr key={s.station_id} className="border-b border-cq-line last:border-0">
                        <td className="py-2 font-semibold text-cq-roast">
                          Station {s.station_id}
                        </td>
                        <td className="py-2 text-right">{s.orders}</td>
                        <td className="py-2 text-right">{s.completed}</td>
                        <td className="py-2 text-right">
                          {s.avg_wait_min == null ? '—' : `${s.avg_wait_min} min`}
                        </td>
                        <td className="py-2 text-right">{s.orders_per_hour ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-cq-ink-3">No station activity in this window.</p>}
          </Card>

          {d.sms && (
            <Card title="Texts" Icon={Mail}
                  right={`${d.sms.est_segments} segment(s) billed`}>
              <p className="text-sm text-cq-ink-2">
                {d.sms.outbound} sent, {d.sms.inbound} received
                {d.sms.inbound_unanswered
                  ? `, ${d.sms.inbound_unanswered} never answered` : ''}.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
