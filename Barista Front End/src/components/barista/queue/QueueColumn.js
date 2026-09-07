// The queue board. Two layouts, one set of cards:
//   lanes  -- Making | Up next | Ready side by side, each scrolling on its
//             own inside the screen, headings pinned. Landscape tablets and
//             laptops. Nothing on the page scrolls.
//   column -- Making, then Up next, stacked, with a pinned jump bar; Ready
//             is a strip pinned to the bottom so Collected is one tap away.
//             Phones and portrait tablets.
// One primary action per card (Start / Ready / Collected); the rest behind "...".
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Play, Check, MessageCircle, Printer, ArrowRightLeft, Edit, Clock, Users, Coffee, Plus } from 'lucide-react';
import { OrderCard, Button, Pill } from '../../../design';
import MoreMenu from './MoreMenu';
import GroupBadge from '../GroupBadge';
import SourceBadge from '../SourceBadge';
import WorkTypeBadge from '../WorkTypeBadge';
import AskCustomerControls from '../AskCustomerControls';
import { summariseMilk, filterByMilk } from '../../../utils/currentOrderView';
import { parseServerDate } from '../../../utils/orderUtils';
import { orderNumberOf, drinkLine, milkSugarLine, notesOf, messageOf, groupIdOf, isPriority, priceOf, hasPhone, sinceQueued, sinceStarted, sinceReady } from './orderMeta';

const READY_RECENCY_MIN = 30;
const NO_SMS_EXPIRY_MULTIPLIER = 2;
const COMPACT_ABOVE = 4; // more than this on the bench -> compact cards

const Heading = ({ title, count, tone = 'roast', pinned = false, children }) => (
  <div className={`flex items-center gap-3 ${pinned ? 'sticky top-0 z-10 bg-cq-cream pt-1 pb-2' : 'mt-6 mb-3 first:mt-0'}`}>
    <h2 className={`text-2xl font-extrabold leading-none ${tone === 'ready' ? 'text-cq-ready' : 'text-cq-roast'}`}>{title}</h2>
    <span className="text-2xl font-extrabold leading-none text-cq-ink-3 tabular-nums">{count}</span>
    <div className="flex-1 border-t border-cq-line" />
    {children}
  </div>
);

const Empty = ({ Icon = Coffee, title, hint }) => (
  <div className="bg-cq-milk/60 border border-dashed border-cq-line rounded-cq-lg py-8 text-center">
    <Icon size={36} className="mx-auto mb-2 text-cq-ink-3" />
    <div className="font-bold text-cq-ink-2">{title}</div>
    {hint ? <div className="text-sm text-cq-ink-3 mt-0.5">{hint}</div> : null}
  </div>
);

const toCard = (o) => ({
  number: orderNumberOf(o), name: o.customerName || o.customer_name || '', drink: drinkLine(o),
  milk: o.milkType || o.milk_type || null, sugar: [o.sugar || null, o.extraHot ? 'Extra hot' : null].filter(Boolean).join(' · ') || null,
  notes: notesOf(o), message: messageOf(o),
});

export default function QueueColumn({
  pendingOrders = [], inProgressOrders = [], completedOrders = [], stationId, expiryMinutes = READY_RECENCY_MIN,
  teamMode = false, groupInfoByOrderId = {}, stationPrinter = null, compact = false, layout = 'column',
  applicableStages, orderStages, toggleStage,
  onStart, onStartGroup, onComplete, onCollected, onMessage, onPrint, onMove, onEdit, onDelay, onWalkIn, showReady = true, stationMenu = [], rushStrip = null,
}) {
  const lanes = layout === 'lanes';

  // ---- Ready: station match, recency window (longer with no phone), optimistic hide.
  const [hidden, setHidden] = useState(() => new Set());
  useEffect(() => {
    setHidden((prev) => {
      const live = new Set((completedOrders || []).map((o) => o.id || orderNumberOf(o)));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [completedOrders]);
  const ready = useMemo(() => {
    const baseMin = Number(expiryMinutes) > 0 ? Number(expiryMinutes) : READY_RECENCY_MIN;
    const now = Date.now(); const cutoff = now - baseMin * 60000; const cutoffNoSms = now - baseMin * NO_SMS_EXPIRY_MULTIPLIER * 60000;
    const sid = stationId != null ? String(stationId) : null;
    return (completedOrders || []).filter((o) => {
      if (hidden.has(o.id || orderNumberOf(o))) return false;
      const st = String(o.status || '').toLowerCase(); if (st === 'picked_up' || st === 'picked-up') return false;
      if (sid) { const c = [o.stationId, o.station_id, o.assignedStation, o.assigned_to_station].filter((v) => v != null).map(String); if (c.length && !c.includes(sid)) return false; }
      const ts = o.completedAt || o.completed_at || o.updatedAt || o.updated_at; if (!ts) return true;
      const t = parseServerDate(ts).getTime(); if (Number.isNaN(t)) return true;
      return t >= (hasPhone(o) ? cutoff : cutoffNoSms) && t <= now + 5 * 60000;
    }).sort((a, b) => parseServerDate(b.completedAt || b.completed_at || 0).getTime() - parseServerDate(a.completedAt || a.completed_at || 0).getTime());
  }, [completedOrders, stationId, hidden, expiryMinutes]);
  // How the Ready list is ordered. A different question from the queue:
  // longest-waiting is who to chase, just-made is what was called out, and
  // by number is how you find #1847 when someone says it at the hatch.
  const [readySort, setReadySort] = useState(() => { try { return localStorage.getItem('coffee_cue_ready_sort') || 'longest'; } catch (e) { return 'longest'; } });
  const chooseReadySort = (m) => { setReadySort(m); try { localStorage.setItem('coffee_cue_ready_sort', m); } catch (e) { /* device pref */ } };
  const readyAt = (o) => parseServerDate(o.completedAt || o.completed_at || o.updatedAt || o.updated_at || 0).getTime() || 0;
  const readySorted = useMemo(() => {
    const l = [...ready];
    if (readySort === 'newest') return l.sort((a, b) => readyAt(b) - readyAt(a));
    if (readySort === 'number') return l.sort((a, b) => String(orderNumberOf(a)).localeCompare(String(orderNumberOf(b)), undefined, { numeric: true }));
    return l.sort((a, b) => readyAt(a) - readyAt(b)); // longest waiting first
  }, [ready, readySort]);
  const readyControl = ready.length > 1 ? (
    <div className="flex items-center gap-1.5 text-sm font-semibold overflow-x-auto whitespace-nowrap pb-1" title="How the ready list is ordered on this tablet">
      <span className="text-cq-ink-3 mr-0.5">Sort</span>
      {[['longest', 'Waiting'], ['newest', 'Just made'], ['number', 'Number']].map(([m, label]) => (
        <button key={m} type="button" onClick={() => chooseReadySort(m)} aria-pressed={readySort === m}
          className={`h-8 px-2.5 rounded-full ${readySort === m ? 'bg-cq-ready text-white' : 'bg-cq-wash text-cq-ink-2 hover:bg-cq-caramel-wash'}`}>
          {label}
        </button>
      ))}
    </div>
  ) : null;

  const collect = async (o) => {
    const key = o.id || orderNumberOf(o);
    setHidden((p) => new Set(p).add(key));
    try { await onCollected(o.id); } catch (e) { setHidden((p) => { const n = new Set(p); n.delete(key); return n; }); }
  };

  // ---- Sort. Oldest first is the fair queue and the default (Steve saw
  // newest on top and old ones at risk of being missed). Age comes from the
  // server's waitTime (minutes) so it is right on any clock; createdAt only
  // breaks ties. A device remembers its choice.
  const [sortMode, setSortMode] = useState(() => { try { return localStorage.getItem('coffee_cue_queue_sort') || 'oldest'; } catch (e) { return 'oldest'; } });
  const chooseSort = (m) => { setSortMode(m); try { localStorage.setItem('coffee_cue_queue_sort', m); } catch (e) { /* device pref */ } };
  const ageOf = (o) => { const w = Number(o.waitTime); if (!Number.isNaN(w) && o.waitTime != null) return w; const t = parseServerDate(o.createdAt || o.created_at || 0).getTime(); return Number.isNaN(t) ? 0 : (Date.now() - t) / 60000; };
  const created = (o) => parseServerDate(o.createdAt || o.created_at || 0).getTime() || 0;
  const olderFirst = (a, b) => (ageOf(b) - ageOf(a)) || (created(a) - created(b));
  const milkOf = (o) => String(o.milkType || o.milk_type || 'no milk').toLowerCase();
  const orderBy = (list, mode) => {
    const l = [...list];
    if (mode === 'newest') return l.sort((a, b) => -olderFirst(a, b));
    if (mode === 'milk') return l.sort((a, b) => milkOf(a).localeCompare(milkOf(b)) || olderFirst(a, b));
    if (mode === 'vip') return l.filter(isPriority).sort(olderFirst);
    // oldest: the fair queue, priority on top
    return l.sort((a, b) => (Number(isPriority(b)) - Number(isPriority(a))) || olderFirst(a, b));
  };
  const upNext = useMemo(() => orderBy(pendingOrders, sortMode), [pendingOrders, sortMode]);
  const SORTS = [['oldest', 'Oldest'], ['newest', 'Newest'], ['milk', 'Milk'], ['vip', 'VIP']];
  const sortControl = (
    <div className="flex items-center gap-1.5 text-sm font-semibold overflow-x-auto whitespace-nowrap pb-1" title="How the queue is sorted on this tablet">
      <span className="text-cq-ink-3 mr-0.5">Sort</span>
      {SORTS.map(([m, label]) => (
        <button key={m} type="button" onClick={() => chooseSort(m)} aria-pressed={sortMode === m}
          className={`h-8 px-2.5 rounded-full ${sortMode === m ? 'bg-cq-roast text-cq-cream' : 'bg-cq-wash text-cq-ink-2 hover:bg-cq-caramel-wash'}`}>
          {label}
        </button>
      ))}
    </div>
  );

  // ---- The bench: steam summary doubles as a milk filter (tap a milk).
  const [milkFilter, setMilkFilter] = useState('');
  const jugs = useMemo(() => summariseMilk(inProgressOrders), [inProgressOrders]);
  const bench = useMemo(() => orderBy(milkFilter ? filterByMilk(inProgressOrders, milkFilter) : inProgressOrders, sortMode), [inProgressOrders, milkFilter, sortMode]);
  useEffect(() => { if (milkFilter && !jugs.some((j) => j.milk === milkFilter)) setMilkFilter(''); }, [jugs, milkFilter]);
  const dense = compact || inProgressOrders.length > COMPACT_ABOVE;

  // ---- Column mode: jump targets.
  const makingRef = useRef(null); const nextRef = useRef(null);
  const jump = (ref) => ref.current && ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const badgesFor = (o) => (
    <>
      {isPriority(o) ? <Pill tone="roast" size="sm">Priority</Pill> : null}
      <GroupBadge info={groupInfoByOrderId[o.id]} />
      <SourceBadge order={o} />
      {teamMode ? <WorkTypeBadge order={o} teamMode={teamMode} /> : null}
      {priceOf(o) ? <Pill tone="outline" size="sm">{priceOf(o)}</Pill> : null}
    </>
  );
  const phoneItem = (o) => ({ label: hasPhone(o) ? 'Message customer' : 'No phone on this order', Icon: MessageCircle, disabled: !hasPhone(o), onClick: () => onMessage && onMessage(o) });
  const printItem = (o) => stationPrinter ? { label: stationPrinter.online ? 'Print label' : 'Print label (printer offline, will queue)', Icon: Printer, onClick: () => onPrint && onPrint(o) } : null;

  const makingCard = (o) => {
    const stages = teamMode && applicableStages ? applicableStages(o) : [];
    const done = orderStages ? orderStages(o) : {};
    const allDone = stages.length > 0 && stages.every((s) => done[s]);
    return (
      <OrderCard key={o.id} state="making" compact={dense} order={{ ...toCard(o), since: sinceStarted(o) }} badges={badgesFor(o)}
        actions={
          <>
            {stages.length ? (
              <div className="w-full flex gap-2">
                {stages.map((stage) => (
                  <button key={stage} type="button" onClick={() => toggleStage && toggleStage(o, stage)}
                    className={`flex-1 h-11 rounded-cq-md font-bold text-sm border-2 ${done[stage] ? 'bg-cq-ready-wash border-cq-ready text-cq-ready' : 'bg-cq-milk border-cq-line text-cq-ink-2'}`}>
                    {done[stage] ? '✓ ' : ''}{stage === 'shots' ? 'Shots' : 'Milk'}
                  </button>
                ))}
              </div>
            ) : null}
            <Button variant="ready" Icon={Check} className={`flex-1 ${allDone ? 'cq-breathe' : ''}`} onClick={() => onComplete && onComplete(o.id)}>
              {allDone ? 'All parts done · Ready' : 'Ready'}
            </Button>
            <AskCustomerControls order={o} />
            <MoreMenu items={[phoneItem(o), printItem(o), { label: 'Move to another station', Icon: ArrowRightLeft, onClick: () => onMove && onMove(o) }, { label: 'Edit order', Icon: Edit, onClick: () => onEdit && onEdit(o) }]} />
          </>
        } />
    );
  };
  const queuedCard = (o) => {
    const gid = groupIdOf(o);
    const members = gid ? pendingOrders.filter((p) => groupIdOf(p) === gid).length : 0;
    return (
      <OrderCard key={o.id} state="queued" compact={dense || lanes} order={{ ...toCard(o), since: sinceQueued(o) }} badges={badgesFor(o)}
        actions={
          <>
            {members > 1
              ? <Button Icon={Users} className="flex-1" onClick={() => onStartGroup && onStartGroup(o)}>Start group of {members}</Button>
              : <Button Icon={Play} className="flex-1" onClick={() => onStart && onStart(o)}>Start</Button>}
            <MoreMenu items={[
              members > 1 ? { label: 'Start just this one', Icon: Play, onClick: () => onStart && onStart(o) } : null,
              phoneItem(o), { label: 'Delay', Icon: Clock, onClick: () => onDelay && onDelay(o) },
              { label: 'Move to another station', Icon: ArrowRightLeft, onClick: () => onMove && onMove(o) },
              { label: 'Edit order', Icon: Edit, onClick: () => onEdit && onEdit(o) }, printItem(o),
            ]} />
          </>
        } />
    );
  };
  const readyRow = (o) => (
    <div key={o.id} className="bg-cq-milk rounded-cq-lg shadow-cq-card border-l-[6px] border-l-cq-ready px-3 py-2.5 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-extrabold leading-none text-cq-roast tabular-nums">#{orderNumberOf(o)}</span>
          {o.customerName ? <span className="text-base font-bold text-cq-ink truncate">{o.customerName}</span> : null}
        </div>
        <div className="text-xs text-cq-ink-2 mt-0.5 truncate">{[drinkLine(o), milkSugarLine(o)].filter(Boolean).join(' · ')} <span className="text-cq-ink-3">· {sinceReady(o)}</span></div>
      </div>
      <Button variant="dark" size="sm" onClick={() => collect(o)}>Collected</Button>
    </div>
  );

  // Its own row under the Making heading (beside it, four milks wrapped
  // into a tall stack on an iPad and pushed the bench down the lane).
  const steam = jugs.length ? (
    <div className="flex items-center gap-1.5 text-sm font-semibold overflow-x-auto whitespace-nowrap pb-1" title="Milk to steam for everything on the bench. Tap a milk to see only those.">
      <span className="text-cq-ink-3 mr-0.5">Steam</span>
      {jugs.map((j) => (
        <button key={j.milk} type="button" onClick={() => setMilkFilter(milkFilter === j.milk ? '' : j.milk)} aria-pressed={milkFilter === j.milk}
          className={`h-8 px-2.5 rounded-full tabular-nums ${milkFilter === j.milk ? 'bg-cq-roast text-cq-cream' : 'bg-cq-wash text-cq-ink-2 hover:bg-cq-caramel-wash'}`}>
          {j.litres}L {j.milk}
        </button>
      ))}
      {milkFilter ? <button type="button" onClick={() => setMilkFilter('')} className="text-cq-caramel-deep underline underline-offset-4 ml-1">all</button> : null}
    </div>
  ) : null;

  const quickRow = (
    <div className={`flex items-center gap-2 ${lanes ? 'mb-3' : 'mb-4'}`}>
      {onWalkIn ? <Button size={lanes ? 'md' : 'lg'} Icon={Plus} onClick={onWalkIn} className="flex-1 sm:flex-none sm:min-w-[16rem]">Walk-up order</Button> : null}
      <div className="flex-1 hidden sm:block" />
      <MoreMenu items={stationMenu} label="Station actions" direction="down" triggerClassName={lanes ? '' : '!h-14 !w-14'} />
    </div>
  );

  const makingBody = bench.length === 0
    ? (inProgressOrders.length ? <div className="text-center py-6 text-cq-ink-3">Nothing on the bench with {milkFilter}. <button type="button" className="underline text-cq-caramel-deep" onClick={() => setMilkFilter('')}>Show all {inProgressOrders.length}</button></div> : <Empty title="Nothing on the bench" hint="Start an order from Up next" />)
    : <div className={dense && lanes ? 'grid grid-cols-1 2xl:grid-cols-2 gap-3' : 'space-y-3'}>{bench.map(makingCard)}</div>;
  const nextBody = upNext.length === 0
    ? (sortMode === 'vip' && pendingOrders.length ? <Empty title="No VIP orders waiting" hint={`${pendingOrders.length} in the queue · sorted by VIP only`} /> : <Empty title="No one waiting" hint="New orders appear here as they come in" />)
    : <div className="space-y-3">{upNext.map(queuedCard)}</div>;
  const readyBody = ready.length === 0 ? <Empty Icon={Check} title="Nothing to collect" /> : <div className="space-y-2">{readySorted.map(readyRow)}</div>;

  // ================= LANES =================
  if (lanes) {
    const Lane = ({ title, count, tone, sub, children, grow }) => (
      <section className={`flex flex-col min-h-0 ${grow}`}>
        <div className="sticky top-0 z-10 bg-cq-cream">
          <Heading title={title} count={count} tone={tone} pinned />
          {sub ? <div className="-mt-1 pb-2">{sub}</div> : null}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4">{children}</div>
      </section>
    );
    return (
      <div className="flex-1 min-h-0 flex flex-col w-full">
        {quickRow}
        <div className="flex-1 min-h-0 flex gap-5">
          <Lane title="Making" count={inProgressOrders.length} grow={showReady ? 'basis-[44%]' : 'basis-1/2'} sub={steam}>{makingBody}</Lane>
          <Lane title="Up next" count={upNext.length} grow={showReady ? 'basis-[32%]' : 'basis-1/2'} sub={sortControl}>{rushStrip ? <div className="mb-3">{rushStrip}</div> : null}{nextBody}</Lane>
          {showReady ? <Lane title="Ready" count={ready.length} tone="ready" grow="basis-[24%]" sub={readyControl}>{readyBody}</Lane> : null}
        </div>
      </div>
    );
  }

  // ================= COLUMN =================
  return (
    <div className="max-w-4xl mx-auto w-full">
      {quickRow}
      {/* Jump bar: pinned under the tabs while the column scrolls. */}
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-cq-cream/95 backdrop-blur flex gap-2 mb-3">
        {[['Making', inProgressOrders.length, makingRef, 'roast'], ['Up next', upNext.length, nextRef, 'roast'], ...(showReady ? [['Ready', ready.length, null, 'ready']] : [])].map(([label, n, ref, tone]) => (
          <button key={label} type="button" onClick={() => (ref ? jump(ref) : window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }))}
            className={`h-10 px-3 rounded-full font-bold text-sm inline-flex items-center gap-2 bg-cq-milk border-2 border-cq-line ${tone === 'ready' ? 'text-cq-ready' : 'text-cq-roast'}`}>
            {label} <span className="text-cq-ink-3 tabular-nums">{n}</span>
          </button>
        ))}
      </div>
      {rushStrip ? <div className="mb-4">{rushStrip}</div> : null}
      <div ref={makingRef} className="scroll-mt-16">
        <Heading title="Making" count={inProgressOrders.length} />
        {steam ? <div className="-mt-1 mb-3">{steam}</div> : null}
        {makingBody}
      </div>
      <div ref={nextRef} className="scroll-mt-16">
        <Heading title="Up next" count={upNext.length} />
        <div className="-mt-1 mb-3">{sortControl}</div>
        {nextBody}
      </div>
      {/* Ready strip, pinned to the bottom: Collected is always one tap away. */}
      {showReady && ready.length > 0 ? (
        <div className="fixed bottom-0 inset-x-0 z-30 bg-cq-milk border-t-2 border-cq-ready shadow-cq-raised px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-cq-ready flex-shrink-0">Ready {ready.length}</span>
            {readySorted.map((o) => (
              <button key={o.id} type="button" onClick={() => collect(o)} className="flex-shrink-0 h-12 pl-3 pr-2 rounded-cq-md bg-cq-roast text-cq-cream inline-flex items-center gap-2" title={`${drinkLine(o)} · ${sinceReady(o)}`}>
                <span className="text-xl font-extrabold tabular-nums">#{orderNumberOf(o)}</span>
                {o.customerName ? <span className="text-sm font-semibold max-w-[8rem] truncate">{o.customerName}</span> : null}
                <span className="ml-1 h-8 px-2 rounded-cq-sm bg-white/15 text-xs font-bold inline-flex items-center">Collected</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
