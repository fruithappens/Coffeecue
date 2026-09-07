// ONE column: making, then up next, then what is ready to hand over. The
// eye reads down the page in the order the work happens; nothing is three
// columns apart. One primary action per card; the rest behind "...".
import React, { useMemo, useState, useEffect } from 'react';
import { Play, Check, MessageCircle, Printer, ArrowRightLeft, Edit, Clock, Users, Coffee, Plus } from 'lucide-react';
import { OrderCard, Button, Pill } from '../../../design';
import MoreMenu from './MoreMenu';
import GroupBadge from '../GroupBadge';
import SourceBadge from '../SourceBadge';
import WorkTypeBadge from '../WorkTypeBadge';
import AskCustomerControls from '../AskCustomerControls';
import { summariseMilk } from '../../../utils/currentOrderView';
import { parseServerDate } from '../../../utils/orderUtils';
import { orderNumberOf, drinkLine, milkSugarLine, notesOf, messageOf, groupIdOf, isPriority, priceOf, hasPhone, sinceQueued, sinceStarted, sinceReady } from './orderMeta';

const READY_RECENCY_MIN = 30;
const NO_SMS_EXPIRY_MULTIPLIER = 2;

const SectionHead = ({ title, count, tone = 'roast', children }) => (
  <div className="flex items-center gap-3 mt-6 mb-3 first:mt-0">
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
  teamMode = false, groupInfoByOrderId = {}, stationPrinter = null, compact = false,
  applicableStages, orderStages, toggleStage,
  onStart, onStartGroup, onComplete, onCollected, onMessage, onPrint, onMove, onEdit, onDelay, onWalkIn, showReady = true, stationMenu = [],
}) {
  // ---- Ready list: same rules the old Ready column used (station match,
  // recency window, longer for no-phone orders, optimistic hide on tap).
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
  const collect = async (o) => {
    const key = o.id || orderNumberOf(o);
    setHidden((p) => new Set(p).add(key));
    try { await onCollected(o.id); } catch (e) { setHidden((p) => { const n = new Set(p); n.delete(key); return n; }); }
  };

  // ---- Up next: priority first, then the fair queue (oldest first, as served).
  const upNext = useMemo(() => {
    const vip = pendingOrders.filter(isPriority); const rest = pendingOrders.filter((o) => !isPriority(o));
    return [...vip, ...rest];
  }, [pendingOrders]);
  const jugs = useMemo(() => summariseMilk(inProgressOrders), [inProgressOrders]);

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

  return (
    <div className="max-w-4xl mx-auto w-full">
      {/* The two things a barista reaches for between coffees: take a
          walk-up order, and the station-level tools. Big, at the top,
          never hidden in a section header (Steve could not find it). */}
      <div className="flex items-center gap-2 mb-5">
        {onWalkIn ? <Button size="lg" Icon={Plus} onClick={onWalkIn} className="flex-1 sm:flex-none sm:min-w-[16rem]">Walk-up order</Button> : null}
        <div className="flex-1 hidden sm:block" />
        <MoreMenu items={stationMenu} label="Station actions" direction="down" triggerClassName="!h-14 !w-14" />
      </div>

      {/* ---------------- MAKING ---------------- */}
      <SectionHead title="Making" count={inProgressOrders.length}>
        {jugs.length ? (
          <div className="hidden sm:flex flex-wrap gap-x-3 text-sm font-semibold text-cq-ink-2" title="Milk to steam for everything on the bench">
            <span className="text-cq-ink-3">Steam</span>
            {jugs.map((j) => <span key={j.milk} className="tabular-nums">{j.litres}L {j.milk}</span>)}
          </div>
        ) : null}
      </SectionHead>
      {inProgressOrders.length === 0 ? <Empty title="Nothing on the bench" hint="Start an order from Up next" /> : (
        <div className="space-y-3">
          {inProgressOrders.map((o) => {
            const stages = teamMode && applicableStages ? applicableStages(o) : [];
            const done = orderStages ? orderStages(o) : {};
            const allDone = stages.length > 0 && stages.every((s) => done[s]);
            return (
              <OrderCard key={o.id} state="making" compact={compact} order={{ ...toCard(o), since: sinceStarted(o) }} badges={badgesFor(o)}
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
                    <MoreMenu items={[
                      phoneItem(o), printItem(o),
                      { label: 'Move to another station', Icon: ArrowRightLeft, onClick: () => onMove && onMove(o) },
                      { label: 'Edit order', Icon: Edit, onClick: () => onEdit && onEdit(o) },
                    ]} />
                  </>
                } />
            );
          })}
        </div>
      )}

      {/* ---------------- UP NEXT ---------------- */}
      <SectionHead title="Up next" count={upNext.length} />
      {upNext.length === 0 ? <Empty title="No one waiting" hint="New orders appear here as they come in" /> : (
        <div className="space-y-3">
          {upNext.map((o) => {
            const gid = groupIdOf(o);
            const members = gid ? pendingOrders.filter((p) => groupIdOf(p) === gid).length : 0;
            return (
              <OrderCard key={o.id} state="queued" compact={compact} order={{ ...toCard(o), since: sinceQueued(o) }} badges={badgesFor(o)}
                actions={
                  <>
                    {members > 1 ? (
                      <Button Icon={Users} className="flex-1" onClick={() => onStartGroup && onStartGroup(o)}>Start group of {members}</Button>
                    ) : (
                      <Button Icon={Play} className="flex-1" onClick={() => onStart && onStart(o)}>Start</Button>
                    )}
                    <MoreMenu items={[
                      members > 1 ? { label: 'Start just this one', Icon: Play, onClick: () => onStart && onStart(o) } : null,
                      phoneItem(o),
                      { label: 'Delay', Icon: Clock, onClick: () => onDelay && onDelay(o) },
                      { label: 'Move to another station', Icon: ArrowRightLeft, onClick: () => onMove && onMove(o) },
                      { label: 'Edit order', Icon: Edit, onClick: () => onEdit && onEdit(o) },
                      printItem(o),
                    ]} />
                  </>
                } />
            );
          })}
        </div>
      )}

      {/* ---------------- READY ---------------- */}
      {showReady ? <SectionHead title="Ready to hand over" count={ready.length} tone="ready" /> : null}
      {!showReady ? null : ready.length === 0 ? <Empty Icon={Check} title="Nothing waiting to be collected" /> : (
        <div className="space-y-2">
          {ready.map((o) => (
            <div key={o.id} className="bg-cq-milk rounded-cq-lg shadow-cq-card border-l-[6px] border-l-cq-ready px-4 py-3 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-3xl font-extrabold leading-none text-cq-roast tabular-nums">#{orderNumberOf(o)}</span>
                  {o.customerName ? <span className="text-lg font-bold text-cq-ink truncate">{o.customerName}</span> : null}
                </div>
                <div className="text-sm text-cq-ink-2 mt-0.5">{[drinkLine(o), milkSugarLine(o)].filter(Boolean).join(' · ')} <span className="text-cq-ink-3">· {sinceReady(o)}</span></div>
              </div>
              <Button variant="dark" onClick={() => collect(o)}>Collected</Button>
              <MoreMenu items={[phoneItem(o)]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
