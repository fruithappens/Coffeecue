// components/PendingOrdersSection.js
import React from 'react';
import { ChevronDown, Edit } from 'lucide-react';
import { getOrderBackgroundColor, getTimeRatioColor } from '../../utils/orderUtils';
import { useSettings } from '../../hooks/useSettings';
import { getMilkColorStyle, getMilkDotStyle } from '../../utils/milkColorHelper';
import '../../styles/milkColors.css';
import VipOrdersList from './VipOrdersList';
import BatchGroupsList from './BatchGroupsList';
import RegularOrdersList from './RegularOrdersList';
import GroupBadge from './GroupBadge';
import SourceBadge from './SourceBadge';
import WorkTypeBadge from './WorkTypeBadge';

const PendingOrdersSection = ({
  orders,
  teamMode,
  filter,
  onFilterChange,
  onStartOrder,
  onProcessBatch,
  onSendMessage,
  onDelayOrder,
  onEditOrder,
  onMoveOrder,
  groupInfoByOrderId = {},
  onStartGroup
}) => {
  const { settings } = useSettings();
  // Queue direction. The backend serves OLDEST FIRST (the fair queue —
  // whoever has waited longest is at the top, ready to be started).
  // Some minds prefer newest-on-top, so a flip toggle is offered; the
  // fair default stays oldest-first (Steve's call).
  const [newestFirst, setNewestFirst] = React.useState(false);
  const orderedOrders = newestFirst ? [...orders].reverse() : orders;
  // Organize orders into categories - support both vip and priority property names
  const vipOrders = orderedOrders.filter(order => order.vip || order.priority);
  
  // Group batch orders by their batch group — but a batch of ONE is not a
  // batch (Steve: 'batch on all orders is a bit strange'). Only groups
  // with 2+ identical drinks get the group header + Process Batch button;
  // singles render as regular cards (the similarity hints below still
  // point out shared-milk opportunities).
  // VIP orders are ALREADY shown, on their own, at the top. Including
  // them here rendered the same order twice -- once under VIP ORDERS and
  // again inside its batch -- each with its own Start button. Steve's
  // screenshot caught #34 in both.
  //
  // Two cards for one coffee is two coffees, or a Process Batch that
  // quietly re-makes one a barista has already started.
  //
  // They stay in the VIP list rather than the batch: the whole point of
  // priority is not waiting for four other drinks to be ready first.
  // regularOrders already excluded them; the grouping simply never did.
  const allGroups = orderedOrders.reduce((groups, order) => {
    if (order.vip || order.priority) return groups;
    if (order.batchGroup) {
      if (!groups[order.batchGroup]) {
        groups[order.batchGroup] = [];
      }
      groups[order.batchGroup].push(order);
    }
    return groups;
  }, {});
  const batchGroups = {};
  const singletonBatchIds = new Set();
  Object.entries(allGroups).forEach(([key, list]) => {
    if (list.length >= 2) {
      batchGroups[key] = list;
    } else {
      list.forEach((o) => singletonBatchIds.add(o.id));
    }
  });

  const regularOrders = orderedOrders.filter(
    order => !(order.vip || order.priority)
      && (!order.batchGroup || singletonBatchIds.has(order.id))
  );

  // --- Similarity-based batch hints --------------------------------
  // Detect orders that COULD be batched together even though they
  // don't share an explicit batch_group code. Two axes:
  //   - Shared milk type (≥2 pending oat orders → steam one big jug)
  //   - Shared non-coffee base (≥2 hot chocolates → make one batch
  //     of chocolate powder mix)
  // Each hint adds a small coloured tag to the order card so the
  // barista can spot the opportunity at a glance. Originally there
  // was a 'Batch' tag on the cards but it disappeared at some point —
  // this re-introduces it, computed automatically rather than
  // requiring an explicit group.
  // Strip the ' milk' suffix the API uses ('Full Cream Milk') so it
  // matches the batchable set ('full cream') — without this the
  // shared-milk hint NEVER fired (Steve: billy + sammy, both full
  // cream, no batch hint shown).
  const _norm = (s) => (s || '').toString().toLowerCase().trim()
    .replace(/\s+milk$/, '');
  const _BATCHABLE_MILKS = new Set([
    'oat', 'soy', 'almond', 'coconut', 'macadamia',
    'lactose free', 'lactose-free', 'rice',
    'skim', 'full cream', 'whole milk', 'whole',
  ]);
  const _BATCHABLE_BASES = {
    'hot chocolate': /hot chocolate/i,
    'chai':          /chai/i,
    'matcha':        /matcha/i,
  };

  // Bucket all pending orders by milk + base. Only buckets with ≥2
  // entries become hints (a single oat latte isn't a batch).
  const milkBuckets = {};
  const baseBuckets = {};
  orders.forEach((o) => {
    const milk = _norm(o.milkType);
    if (_BATCHABLE_MILKS.has(milk)) {
      (milkBuckets[milk] = milkBuckets[milk] || []).push(o.id);
    }
    const drink = _norm(o.coffeeType);
    Object.entries(_BATCHABLE_BASES).forEach(([base, re]) => {
      if (re.test(drink)) {
        // Bucket on base AND milk. These drinks are made WITH the milk
        // -- a chai is brewed into it, not poured over a shot -- so two
        // chais with different milks cannot share a jug and must not be
        // hinted as batchable (Steve: "chai cant be batched as the milk
        // is differnt fyi"). Grouping on the base alone told the barista
        // to batch an oat chai with a full cream one.
        const key = `${base}|${milk || 'no milk'}`;
        (baseBuckets[key] = baseBuckets[key] || []).push(o.id);
      }
    });
  });

  // For each order, build a list of badge labels (e.g. ['Batch oat (3)',
  // 'Batch hot chocolate (2)']). Most orders will have zero badges.
  const batchHintsByOrderId = {};
  Object.entries(milkBuckets).forEach(([milk, ids]) => {
    if (ids.length < 2) return;
    ids.forEach((id) => {
      (batchHintsByOrderId[id] = batchHintsByOrderId[id] || []).push({
        key: `milk:${milk}`,
        label: `Batch ${milk} (${ids.length})`,
        kind: 'milk',
      });
    });
  });
  Object.entries(baseBuckets).forEach(([bucketKey, ids]) => {
    if (ids.length < 2) return;
    const [base, milk] = bucketKey.split('|');
    // Name the milk in the label. The barista needs to know WHICH chais
    // the hint means, not just that some of them can be batched.
    const label = milk && milk !== 'no milk'
      ? `Batch ${base} + ${milk} (${ids.length})`
      : `Batch ${base} (${ids.length})`;
    ids.forEach((id) => {
      (batchHintsByOrderId[id] = batchHintsByOrderId[id] || []).push({
        key: `base:${bucketKey}`,
        label,
        kind: 'base',
      });
    });
  });

  // Shared-shot hint (Steve's idea): 2+ half-strength drinks pending →
  // one double shot can be SPLIT between them instead of pulling and
  // wasting two halves.
  const halfIds = orders
    .filter((o) => /half/i.test(_norm(o.coffeeType)))
    .map((o) => o.id);
  if (halfIds.length >= 2) {
    halfIds.forEach((id) => {
      (batchHintsByOrderId[id] = batchHintsByOrderId[id] || []).push({
        key: 'shots:half',
        label: `Split one shot (${halfIds.length} half-strength)`,
        kind: 'milk',
      });
    });
  }

  // Apply selected filter. The Batch filter now includes BOTH
  // explicit batch_group orders AND orders with a similarity hint
  // (e.g. shared milk type). Previously it only matched explicit
  // groups, so a queue of 3 oat orders from different customers
  // showed empty under Batch — clearly not what the operator
  // expected. The Urgent filter falls back to a 10-minute absolute
  // threshold when promisedTime isn't set (which it usually isn't).
  const getFilteredOrders = () => {
    switch (filter) {
      case 'vip':
        return orderedOrders.filter(order => order.vip || order.priority);
      case 'batch':
        return orderedOrders.filter(order =>
          order.batchGroup || (batchHintsByOrderId[order.id] || []).length > 0
        );
      case 'urgent':
        return orderedOrders.filter(order => {
          // If promisedTime is set, use the ratio. Otherwise fall
          // back to absolute waitTime threshold (10 min default).
          const promised = order.promisedTime;
          if (promised && promised > 0) {
            return (order.waitTime || 0) / promised > 0.8;
          }
          return (order.waitTime || 0) >= 10;
        });
      default:
        return orderedOrders;
    }
  };

  return (
    // No fixed width — let the parent container (grid or flex) size
    // this column. Previously hardcoded as w-1/2 from when the
    // Orders tab was a 2-column layout; this fought the new
    // 3-column grid and made the centre column visibly narrower.
    <div className="flex flex-col h-full">
      <div className="bg-amber-600 text-white p-2 rounded-t-lg flex justify-between items-center">
        <h2 className="text-xl font-bold">Upcoming Orders ({orders.length})</h2>
        <div className="flex space-x-1">
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'all' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('all')}
          >
            All
          </button>
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'vip' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('vip')}
          >
            VIP
          </button>
          <button 
            className={`px-2 py-1 rounded-md text-xs ${filter === 'batch' ? 'bg-white text-amber-600' : 'bg-amber-500 hover:bg-amber-700'}`}
            onClick={() => onFilterChange('batch')}
          >
            Batch
          </button>
          <button
            className="px-2 py-1 rounded-md text-xs bg-amber-500 hover:bg-amber-700"
            onClick={() => setNewestFirst(v => !v)}
            title={newestFirst
              ? 'Newest first — click for oldest first (waiting longest at top)'
              : 'Oldest first (waiting longest at top) — click for newest first'}
          >
            {newestFirst ? '↓ New' : '↑ Old'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-b-lg shadow-md p-2 flex-grow overflow-y-auto">
        {filter === 'all' ? (
          <>
            {/* VIP Orders Section */}
            {vipOrders.length > 0 && (
              <VipOrdersList
                orders={vipOrders}
                onStartOrder={onStartOrder}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
                onMoveOrder={onMoveOrder}
                groupInfoByOrderId={groupInfoByOrderId}
                onStartGroup={onStartGroup}
              />
            )}

            {/* Batch Groups Section */}
            {Object.keys(batchGroups).length > 0 && (
              <BatchGroupsList
                batchGroups={batchGroups}
                onStartOrder={onStartOrder}
                onProcessBatch={onProcessBatch}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
                onMoveOrder={onMoveOrder}
              />
            )}

            {/* Regular Orders Section */}
            {regularOrders.length > 0 && (
              <RegularOrdersList
                teamMode={teamMode}
                orders={regularOrders}
                onStartOrder={onStartOrder}
                onSendMessage={onSendMessage}
                onDelayOrder={onDelayOrder}
                onEditOrder={onEditOrder}
                onMoveOrder={onMoveOrder}
                batchHintsByOrderId={batchHintsByOrderId}
                groupInfoByOrderId={groupInfoByOrderId}
                onStartGroup={onStartGroup}
              />
            )}
          </>
        ) : (
          // Filtered view
          <div>
            {getFilteredOrders().map(order => (
              <div 
                key={order.id} 
                className={`mb-2 p-3 rounded-lg border-l-4 ${
                  (order.vip || order.priority) ? 'border-red-500' : 
                  order.batchGroup ? 'border-yellow-500' : 'border-blue-500'
                } shadow-sm hover:shadow transition-all ${getOrderBackgroundColor(order, settings)}`}
              >
                <div className="flex justify-between items-center">
                  <div className="font-bold">#{order.orderNumber} - {order.customerName}</div>
                  <div className="text-sm flex items-center space-x-1">
                    <GroupBadge info={groupInfoByOrderId[order.id]} />
                    <SourceBadge order={order} />
                    <WorkTypeBadge order={order} teamMode={teamMode} />
                    <span>{order.waitTime} min</span>
                    <div className={`w-3 h-3 rounded-full ${getTimeRatioColor(order.waitTime, order.promisedTime)}`}></div>
                  </div>
                </div>
                
                <div className="mt-2 p-2 bg-gray-100 rounded">
                  <div className="font-medium flex justify-between items-center gap-2">
                    {/* Show size on the front so the barista knows the cup. Bug Steve hit:
                        SMS "Large oat latte" landed in the queue rendered as just
                        "latte, oat, no sugar" — barista couldn't see the size. */}
                    <span>
                      {order.size ? `${order.size} ` : ''}{order.coffeeType}, {order.milkType}, {order.sugar}
                    </span>
                    {/* Honor-system price tag. Only renders when
                        pricing is enabled — the backend stamps
                        priceFormatted onto the order at confirm time. */}
                    {(order.priceFormatted || order.price_formatted) && (
                      <span className="inline-block bg-green-100 text-green-800 text-sm font-bold px-2 py-1 rounded whitespace-nowrap">
                        {order.priceFormatted || order.price_formatted}
                      </span>
                    )}
                  </div>
                  {order.alternativeMilk && (
                    <div className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded mt-2">
                      Alternative Milk
                    </div>
                  )}
                  {/* The customer's latest unanswered SMS ("no sugar
                      thanks", "make it decaf") — shown on THEIR order, not
                      just the Messages bubble. */}
                  {(order.customerMessage || order.customer_message) && (
                    <div className="mt-2 px-2 py-1 bg-amber-50 border border-amber-300 text-amber-900 text-sm rounded flex items-start gap-1">
                      <span aria-hidden="true">💬</span>
                      <span className="italic">{order.customerMessage || order.customer_message}</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-2 flex justify-between">
                  <button 
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-sm"
                    onClick={() => onStartOrder(order)}
                  >
                    Start
                  </button>
                  <button 
                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                    onClick={() => onDelayOrder && onDelayOrder(order)}
                  >
                    Delay
                  </button>
                  <button
                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-md text-sm"
                    onClick={() => onSendMessage && onSendMessage(order)}
                  >
                    Message
                  </button>
                  {/* Move-to-station — small icon to keep the action
                      row tight. Opens a dialog with active stations. */}
                  {onMoveOrder && (
                    <button
                      className="p-1 text-gray-500 hover:text-amber-600"
                      onClick={() => onMoveOrder(order)}
                      title="Move to another station (e.g. ran out of milk here)"
                    >
                      ↪
                    </button>
                  )}
                  <button className="p-1 text-gray-500 hover:text-gray-700">
                    <Edit size={16} />
                  </button>
                </div>
                
                <div className="mt-2 bg-gray-200 h-1 w-full rounded-full overflow-hidden">
                  <div 
                    className={`h-1 ${getTimeRatioColor(order.waitTime, order.promisedTime)}`} 
                    style={{ width: `${(order.waitTime / order.promisedTime) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingOrdersSection;