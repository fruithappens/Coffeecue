"""Order lists and lookups for the barista and organiser screens.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import STAFF_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import datetime, timedelta
from flask import current_app, jsonify, request
from utils import event_time as _event_time
from utils.order_provenance import infer_channel, is_estimated as provenance_estimated, normalize_channel, stamp as stamp_provenance
from routes.consolidated_api_routes import (  # noqa: F401
    _drink_display_name,
    _emit_new_order,
    _event_timezone,
    _kv_get,
    _pay_state,
    _pending_questions_by_phone,
    _pricing_for,
    _revalidating_json,
    _station_can_make_order,
    bp,
    clean_order_id,
    logger,
)


# /orders IS THE BIGGEST PAYLOAD WE SERVE, AND IT REVALIDATES
#
# ~200 KB, re-polled by every barista screen every 5 s. _revalidating_json
# hashes the serialised payload and answers an unchanged poll with a 304 and
# no body. That was shipped once before (#608) and reverted the same night
# (#609): measured against production, three polls with nothing placed gave
# three different tags, because waitTime / wait_time -- minutes-since-created,
# recomputed here for every order on every request -- tick. Any open order
# crossing a minute boundary changed the bytes, so the 304 could never fire
# during exactly the load it was for.
#
# So elapsed time is no longer this route's business. The list carries
# createdAt and the screen counts (utils/orderTime.js stamps waitTime on
# every order as it arrives, corrected by the response's Date header so a
# tablet with a wrong clock still shows the right age). Two polls 8 s apart
# on a 227-order copy differed in those two fields and nothing else; without
# them the bytes are identical until an order actually changes.
#
# Honest limit, unchanged from #608: this saves the bandwidth, not the query.
# Skipping the query needs a change-stamp every write path touches, which
# is not yet proven.

@bp.route('/orders', methods=['GET', 'POST'])
@jwt_required_with_demo()
@writes_need(STAFF_ROLES)
def orders():
    """Handle orders - GET for listing all orders, POST for creating new orders"""
    if request.method == 'GET':
        # Get all orders with optional status and station filters
        status_filter = request.args.get('status')
        station_id = request.args.get('station_id')
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db

            # Lazy promotion of due ETA-scheduled orders — the barista UI
            # polls this endpoint, so due orders surface within one poll.
            try:
                coffee_system.promote_due_scheduled_orders()
            except Exception:
                pass

            # Build query with filters
            cursor = db.cursor()
            query_conditions = []
            query_params = []
            
            if status_filter:
                query_conditions.append("status = %s")
                query_params.append(status_filter)
            
            if station_id:
                query_conditions.append("station_id = %s")
                query_params.append(int(station_id))
            
            # Build the complete query
            base_query = '''
                SELECT id, order_number, status, station_id, 
                       created_at, phone, order_details, queue_priority,
                       completed_at, updated_at, picked_up_at, payment_status
                FROM orders
            '''
            _pricing = _pricing_for(coffee_system.db)
            
            if query_conditions:
                query = base_query + " WHERE " + " AND ".join(query_conditions)
                query += " ORDER BY queue_priority, created_at ASC"
                cursor.execute(query, query_params)
            else:
                # The unfiltered listing is what the BARISTA BOARD polls, and
                # it had two faults that cost real orders.
                #
                # 1. It ordered newest first, so the board read backwards:
                #    a fresh order sat above someone who had waited 25 minutes,
                #    and the longest wait sank down the screen.
                # 2. `LIMIT 50` counted EVERY status. At a busy event most
                #    recent rows are picked-up and cancelled history -- on the
                #    Treenet data, 40 of any 50 -- so a pending order older
                #    than that window simply stopped being returned. It was
                #    still pending in the database, its customer had been told
                #    it was coming, and no barista could see it. 96 completed
                #    orders awaiting collection were outside the window too.
                #
                # So: the WORK is never truncated. Every pending and
                # in-progress order comes back, however old. Completed orders
                # (the "ready to hand over" column) keep a generous cap, and
                # picked-up / cancelled rows are history and keep the small
                # one. Oldest first -- the same fair order the filtered branch
                # above has always used.
                #
                # (routes/api_routes.py has a twin of this endpoint with the
                # same fault; it is shadowed -- consolidated_api_bp registers
                # first -- so it is dead code, left alone deliberately.)
                _ACTIVE = "('pending', 'in-progress', 'in_progress')"
                query = (
                    "(" + base_query + " WHERE status IN " + _ACTIVE + ")"
                    " UNION ALL "
                    "(" + base_query + " WHERE status = 'completed'"
                    " ORDER BY created_at DESC LIMIT 200)"
                    " UNION ALL "
                    "(" + base_query + " WHERE status NOT IN " + _ACTIVE +
                    " AND status <> 'completed'"
                    " ORDER BY created_at DESC LIMIT 50)"
                    " ORDER BY queue_priority, created_at ASC"
                )
                cursor.execute(query)
            
            # Process orders
            orders = []
            for order in cursor.fetchall():
                # Extract order details
                (order_id, order_number, status, station_id, created_at, phone,
                 order_details_json, priority, completed_at, updated_at,
                 picked_up_at, payment_status) = order
                
                # Parse order details
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Format order for frontend - include both snake_case and camelCase
                # Batch key — the /orders listing is what the Barista UI
                # actually polls, and it OMITTED batch_group entirely, so
                # the batch-groups section (and its Process Batch button)
                # could never render for anyone (Test Bench Phase C v4).
                _bg = None
                if order_details.get('type') and order_details.get('milk'):
                    _bg = f"{str(order_details['type']).lower()}-{str(order_details['milk']).lower()}"
                # Completion timestamps. Without these the Barista's
                # "Ready for Pickup" column could never expire anything:
                # its filter falls back to "keep it" when an order has no
                # timestamp, and this listing -- the one the UI actually
                # polls -- never sent one. Orders sat in that column for
                # the rest of the event.
                def _iso(v):
                    if not v:
                        return None
                    return v.isoformat() if hasattr(v, 'isoformat') else str(v)

                orders.append({
                    'id': order_number,  # Use order_number as id for consistency
                    'order_number': order_number,
                    'completed_at': _iso(completed_at),
                    'completedAt': _iso(completed_at),
                    # When it was handed over. This listing never sent it,
                    # so anything sorting the picked-up list by pickup time
                    # was comparing Invalid Date against Invalid Date --
                    # a comparator that returns NaN leaves the list in
                    # whatever order it arrived in, silently.
                    'picked_up_at': _iso(picked_up_at),
                    'pickedUpAt': _iso(picked_up_at),
                    'updated_at': _iso(updated_at),
                    'updatedAt': _iso(updated_at),
                    # Whether a "your coffee is ready" text could have been
                    # sent. A boolean rather than the number itself: the
                    # UI only needs to know it exists, and the phone is
                    # already omitted from this listing on purpose.
                    'hasPhone': bool(str(phone or '').strip()),
                    'orderNumber': order_number,  # camelCase
                    'customer_name': order_details.get('name', 'Customer'),
                    'customerName': order_details.get('name', 'Customer'),  # camelCase
                    'coffee_type': _drink_display_name(order_details),
                    'coffeeType': _drink_display_name(order_details),  # camelCase
                    'milk_type': order_details.get('milk', 'Standard'),
                    'milkType': order_details.get('milk', 'Standard'),  # camelCase
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'size': order_details.get('size', 'Regular'),
                    'extra_hot': order_details.get('temp') == 'extra hot',
                    'extraHot': order_details.get('temp') == 'extra hot',
                    'strength': order_details.get('strength', ''),
                    # Team mode stage ticks. The guard's first live run
                    # caught this endpoint missing the field: a tick
                    # SAVED but vanished from the next poll — the other
                    # serializer had it, this one didn't.
                    'stages': order_details.get('stages') or {},
                    # Order channel: 'sms' (default) | 'walkin' | 'ea_app'.
                    # The barista card shows an APP chip for ea_app, and
                    # needsContact marks orders that can't get ready-SMS
                    # (barista calls the name instead).
                    'orderSource': order_details.get('source') or 'sms',
                    # Provenance: how it was ordered and which QR/sign it
                    # came from. channelEstimated flags orders from before
                    # stamping, where 'kiosk' may really have been a /my scan.
                    'channel': infer_channel(order_details),
                    'sourceCode': order_details.get('source_code') or '',
                    'channelEstimated': provenance_estimated(order_details),
                    'needsContact': bool(order_details.get('needs_contact')),
                    # Milk metadata for the card colour dot + badges.
                    # Stored by the walk-in endpoint; absent (→ null /
                    # false) for SMS orders, which the UI tolerates.
                    'milk_type_id': order_details.get('milk_type_id'),
                    'milkTypeId': order_details.get('milk_type_id'),
                    'alternative_milk': bool(order_details.get('alternative_milk')),
                    'alternativeMilk': bool(order_details.get('alternative_milk')),
                    'dairy_free': bool(order_details.get('dairy_free')),
                    'dairyFree': bool(order_details.get('dairy_free')),
                    'shots': order_details.get('shots'),
                    'bean_type': order_details.get('bean_type'),
                    'beanType': order_details.get('bean_type'),
                    'service': order_details.get('service'),
                    'batch_group': _bg,
                    'batchGroup': _bg,
                    'status': status,
                    'created_at': created_at,
                    'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,  # camelCase
                    # No waitTime here on purpose: it ticked, and every tick
                    # broke the ETag. The screen counts from createdAt.
                    'priority': priority == 1,  # Convert 1/0 to True/False
                    # Why they are one, when the EventsAir rule made them a
                    # VIP -- "Priority · Speaker" on the barista card.
                    'vipReason': (order_details.get('vip_reason') or '') if isinstance(order_details, dict) else '',
                    'paymentStatus': _pay_state(payment_status, order_details, _pricing),
                    'paidMethod': (order_details.get('paid_method') or '') if isinstance(order_details, dict) else '',
                    'special_instructions': order_details.get('notes', ''),
                    'specialInstructions': order_details.get('notes', ''),  # camelCase
                    'payment_method': order_details.get('payment_method', ''),
                    'paymentMethod': order_details.get('payment_method', ''),  # camelCase
                    'order_type': order_details.get('order_type', 'walk-in'),
                    'orderType': order_details.get('order_type', 'walk-in'),  # camelCase
                    'station_id': station_id,
                    'stationId': station_id,  # camelCase
                    # Pricing — pulled straight from order_details
                    # (stamped at confirm-time by the SMS flow or
                    # walk-in endpoint when pricing_settings.enabled
                    # is true). Both casings surfaced for the barista
                    # card's `order.priceFormatted || order.price_formatted`
                    # check. Without these the green price tag never
                    # showed even with pricing fully enabled.
                    'price': order_details.get('price'),
                    'price_formatted': order_details.get('price_formatted'),
                    'priceFormatted': order_details.get('price_formatted'),
                    # Group link — set on multi-drink + FRIEND orders so the
                    # barista UI can show "these go together" and start/collect
                    # them as one. group_id is the lead order's number.
                    'group_id': order_details.get('group_id'),
                    'groupId': order_details.get('group_id'),
                    'group_label': order_details.get('group_label'),
                    'groupLabel': order_details.get('group_label'),
                })

            # Unchanged payload -> 304, no body. See the note above the route.
            return _revalidating_json({
                'status': 'success',
                'data': orders,
                'message': f'Retrieved {len(orders)} orders'
            })
        
        except Exception as e:
            logger.error(f"Error fetching orders: {str(e)}")
            return jsonify({
                'status': 'error',
                'data': [],
                'message': f'Error fetching orders: {str(e)}'
            }), 500
    
    elif request.method == 'POST':
        # Create a new order
        try:
            data = request.json
            logger.info(f"Creating new order with data: {data}")

            # Validate required fields
            required_fields = ['customer_name', 'coffee_type', 'size']
            for field in required_fields:
                if not data.get(field):
                    return jsonify({
                        "status": "error",
                        "message": f"Missing required field: {field}"
                    }), 400

            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db

            # Defensive rollback — if a previous request left this
            # singleton connection in aborted-transaction state, every
            # subsequent query would silently fail. before_request
            # also does this, but belt-and-braces.
            try:
                db.rollback()
            except Exception:
                pass
            
            # Generate a unique order number. Steve wanted shorter,
            # event-prefixed codes ("C1", "C2", …) rather than the old
            # 9-character timestamp format ("W0544296"). We read an
            # operator-configurable prefix from settings (default
            # empty — just digits) and combine with order_number_seq
            # so SMS and walk-in orders share the same monotonic
            # sequence and look consistent on the customer display.
            now = datetime.now()
            order_number = None
            order_prefix = ''
            try:
                prefix_blob = _kv_get(db, 'order_prefix', default=None)
                if isinstance(prefix_blob, dict):
                    order_prefix = (prefix_blob.get('prefix') or '').strip()
                elif isinstance(prefix_blob, str):
                    order_prefix = prefix_blob.strip()
            except Exception:
                order_prefix = ''
            try:
                seq_cur = db.cursor()
                seq_cur.execute("SELECT nextval('order_number_seq')")
                seq_row = seq_cur.fetchone()
                if seq_row:
                    seq_val = seq_row[0] if not isinstance(seq_row, dict) else list(seq_row.values())[0]
                    order_number = f"{order_prefix}{int(seq_val)}"
            except Exception as seq_err:
                logger.info(f"order_number_seq unavailable, using legacy format: {seq_err}")
                try:
                    db.rollback()
                except Exception:
                    pass
            if not order_number:
                # Legacy fallback for un-migrated databases.
                legacy_prefix = "W" if data.get('order_type') == 'walk-in' else "O"
                order_number = f"{legacy_prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Walk-in / API orders can flag VIP via priority=true OR
            # priority='vip' OR vip=true. We canonicalise to a single
            # vip bool here so downstream (price compute, queue) sees
            # the same shape that the SMS flow produces.
            _walkin_vip = bool(
                data.get('vip')
                or data.get('priority') is True
                or str(data.get('priority') or '').lower() == 'vip'
            )
            # The EventsAir rule, by the number on the order (services/vip_rule.py).
            _walkin_vip_reason = ''
            _walkin_vip_station = None
            try:
                from services.vip_rule import resolve as _vip_resolve
                _hit = _vip_resolve(
                    coffee_system.db.cursor(),
                    phone=str(data.get('phone') or data.get('phone_number') or ''),
                    ea_contact_id=str(data.get('ea_contact_id') or ''))
                if _hit.get('vip'):
                    if _hit.get('jump_queue', True):
                        _walkin_vip = True
                    _walkin_vip_reason = _hit.get('reason') or ''
                    _walkin_vip_station = _hit.get('station_id')
            except Exception as _vr:
                logger.warning(f"VIP rule lookup skipped (fail-open): {_vr}")

            # Prepare order details
            order_details = {
                'name': data.get('customer_name'),
                'type': data.get('coffee_type'),
                'milk': data.get('milk_type', 'dairy'),
                'size': data.get('size'),
                'sugar': data.get('sugar', 'No sugar'),
                'notes': data.get('special_instructions') or data.get('notes', ''),
                'payment_method': data.get('payment_method', 'cash'),
                'order_type': data.get('order_type', 'walk-in'),
                'created_by': data.get('created_by', 'barista'),
                # VIP flag is what _compute_order_price reads to apply
                # the vip_free comp; persisting on order_details keeps
                # it visible to the barista UI too.
                'vip': _walkin_vip,
                **({'vip_reason': _walkin_vip_reason} if _walkin_vip_reason else {}),
                # Tea-specific fields from the walk-in dialog. These
                # drive _decrement_stock_for_order (small milk amount,
                # 2 cups when double-cupped) at order completion.
                'is_tea':           bool(data.get('is_tea')) or ('tea' in str(data.get('coffee_type', '')).lower()),
                'tea_strength':     data.get('tea_strength'),
                'tea_double_cup':   bool(data.get('tea_double_cup')),
                'tea_custom_blend': data.get('tea_custom_blend', ''),
                # Milk metadata the barista cards render (colour dot,
                # Alternative Milk / dairy-free badges). This rebuild
                # used to drop them, so walk-in cards lost the badges.
                'milk_type_id':     data.get('milk_type_id'),
                'alternative_milk': bool(data.get('alternative_milk')),
                'dairy_free':       bool(data.get('dairy_free')),
                # Bean choice + shot count from the dialog (usage stats).
                'bean_type':        data.get('bean_type'),
            }
            # Extra hot: every order serializer derives the card badge
            # from order_details['temp'] == 'extra hot' (the shape the
            # SMS flow writes). This rebuild dropped the dialog's
            # extra_hot flag entirely — the checkbox was ticked, the
            # order stored nothing, and the pending/current cards
            # showed a normal-temperature order.
            if data.get('extra_hot') or data.get('extraHot'):
                order_details['extra_hot'] = True
                order_details['temp'] = 'extra hot'
            _shots = data.get('shots')
            if isinstance(_shots, (int, float)) and _shots == _shots and _shots > 0:
                order_details['shots'] = _shots
            # Compute price (honor-system) — same logic as the SMS
            # flow. Stashed on order_details so the barista UI's
            # current-order card knows what to charge. Includes the
            # vip flag so vip_free comping triggers when configured.
            try:
                if hasattr(coffee_system, '_compute_order_price'):
                    pv, pf = coffee_system._compute_order_price({
                        'type': order_details['type'],
                        'milk': order_details['milk'],
                        'size': order_details['size'],
                        'sugar': order_details['sugar'],
                        'vip':  order_details['vip'],
                    })
                    if pv is not None:
                        order_details['price'] = pv
                        order_details['price_formatted'] = pf
            except Exception as price_err:
                logger.warning(f"Walk-in price compute failed (non-fatal): {price_err}")

            # Determine queue priority. Was checking for the string 'vip'
            # but the walk-in frontend sends a boolean — that meant walk-in
            # VIPs never actually got queue priority 1. Honour both shapes.
            priority = 1 if _walkin_vip else 5
            if str(data.get('priority') or '').lower() == 'urgent':
                priority = 2
            
            # Station precedence: explicit collection_station (walk-in
            # dialog's "send to station N for collection" override),
            # then station_id, then default to 1. Without the
            # collection_station fallback here, callers that send only
            # that field landed every order at station 1 — the bug
            # Steve flagged: "the option to assign the order to
            # another station is not working".
            station_id = (
                # The EventsAir rule's station leads for a VIP it recognised;
                # the barista's explicit choice still wins over the default.
                (_walkin_vip_station if _walkin_vip_station and not (
                    data.get('collection_station') or data.get('collectionStation')) else None)
                or data.get('collection_station')
                or data.get('collectionStation')
                or data.get('station_id')
                or data.get('stationId')
                or 1
            )
            try:
                station_id = int(station_id)
            except (TypeError, ValueError):
                station_id = 1

            # Capability gate.
            #
            # Three things to validate before we write the order:
            #
            # (1) The station_id actually exists. Without this, we
            #     happily wrote orders to station 99 — they became
            #     ghost orders that no barista UI could see.
            # (2) The requested milk is in that station's milk_types.
            #     This was the coconut bug: the SMS bot offered Steve's
            #     "usual = coconut latte", no station has coconut, the
            #     order got created anyway, then no barista could
            #     start it because the start handler's capability gate
            #     blocked them. Net effect: customer notified, drink
            #     unmakeable.
            # (3) The requested drink is in catalog OR in the
            #     station's coffee_types. Stops "nuclear chai blast"
            #     from being accepted.
            #
            # Lenient mode: if station_stats has no entry for this
            # station, or capabilities is empty, we don't block —
            # treat it as "no restriction" so brand-new deployments
            # work before the Capabilities editor has been touched.
            try:
                cap_check_cursor = db.cursor()
                # Existence + status check in one query. Before this,
                # POST /api/orders silently accepted orders at:
                #   - station_id=99 (doesn't exist), and
                #   - stations explicitly marked status='inactive'.
                # Reassign properly rejected both. Asymmetric. The
                # fresh-eyes audit reproduced both. Symmetrising here.
                cap_check_cursor.execute(
                    "SELECT status FROM stations WHERE id = %s",
                    (station_id,),
                )
                station_row = cap_check_cursor.fetchone()
                if not station_row:
                    return jsonify({
                        "status": "error",
                        "message": (
                            f"Station {station_id} doesn't exist. "
                            "Pick a valid station from the dropdown."
                        ),
                        "code": "STATION_NOT_FOUND",
                    }), 400
                station_status = (
                    station_row[0] if not isinstance(station_row, dict)
                    else station_row.get('status')
                )
                # Treat NULL/missing status as "active" so brand-new
                # rows don't fail open. Only explicit 'inactive' /
                # 'maintenance' refuse new work.
                if station_status and station_status.lower() in (
                    'inactive', 'maintenance'
                ):
                    return jsonify({
                        "status": "error",
                        "message": (
                            f"Station {station_id} is {station_status} "
                            "and isn't accepting orders right now. "
                            "Pick a different station, or activate this "
                            "one in the Stations tab."
                        ),
                        "code": "STATION_NOT_ACTIVE",
                    }), 400
            except Exception as e:
                # Don't block order creation on a stations-table read
                # failure; log and continue. Worst case: order lands
                # at a fictional station and barista UI surfaces it.
                logger.warning(f"Station existence check failed (continuing): {e}")
                try:
                    db.rollback()
                except Exception:
                    pass

            cap_result = _station_can_make_order(
                db,
                station_id,
                {
                    'type': order_details.get('type'),
                    'milk': order_details.get('milk'),
                },
            )
            if cap_result.get('blocked'):
                logger.warning(
                    f"Refused walk-in order create for station {station_id}: "
                    f"{cap_result.get('reason')}"
                )
                return jsonify({
                    "status": "error",
                    "message": cap_result.get('reason'),
                    "code": "STATION_CAPABILITY_MISMATCH",
                }), 400

            from utils.plan_limits import attendee_cap_message
            _cap_phone = (data.get('phone') or data.get('phone_number') or '').strip()
            _cap_msg = attendee_cap_message(db, _cap_phone)
            if _cap_msg:
                return jsonify({"status": "error", "message": _cap_msg,
                                 "code": "ATTENDEE_CAP_REACHED"}), 400

            # Insert order into database
            cursor = db.cursor()
            # Provenance. This is the barista's own walk-in dialog (the
            # frontend already sends source='walkin'), so the channel is
            # 'barista' unless the caller names a valid one -- the
            # Organiser's bulk/group tools post here too.
            stamp_provenance(
                order_details,
                normalize_channel(data.get('channel')) or 'barista',
                data.get('src') or data.get('source_code'),
                data.get('surface') or 'barista',
            )
            cursor.execute('''
                INSERT INTO orders (
                    order_number, phone, order_details, status, 
                    station_id, created_at, updated_at, queue_priority
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, order_number
            ''', (
                order_number,
                # Accept BOTH `phone` and `phone_number` as the input key.
                # The walk-in dialog and the audit script both send
                # `phone_number`; legacy callers send `phone`. The
                # previous handler only checked `phone`, so any walk-in
                # operator entering a phone got `""` saved, breaking
                # the "send message to customer" feature.
                (data.get('phone') or data.get('phone_number') or '').strip(),
                json.dumps(order_details),
                'pending',
                station_id,
                now,
                now,
                priority
            ))
            
            result = cursor.fetchone()
            db.commit()
            
            if result:
                order_id, order_number = result
                logger.info(f"Created order {order_number} with ID {order_id}")

                # Push WS event so connected Barista UIs see the new
                # order without waiting for the next 15s poll. Steve
                # hit "SMS came back but no order in the app" because
                # the only refresh signal was that poll — and a fresh
                # order looked invisible for up to 15 seconds.
                _emit_new_order({
                    'order_number': order_number,
                    'id': order_number,
                    'status': 'pending',
                    'station_id': station_id,
                    'stationId': station_id,
                    # createdAt / waitTime: without these, the WS-pushed
                    # order on the Barista UI rendered with the JS
                    # client computing wait from a missing field — Steve
                    # saw "571 min" (= 9.5h, the AEST→UTC offset) when
                    # the order had just been placed. Sending UTC "Z"
                    # suffix forces the browser to parse as UTC.
                    'created_at': now.isoformat() + 'Z',
                    'createdAt': now.isoformat() + 'Z',
                    'wait_time': 0,
                    'waitTime': 0,
                    'customer_name': order_details.get('name'),
                    'customerName': order_details.get('name'),
                    'coffee_type': _drink_display_name(order_details, default=None),
                    'coffeeType': _drink_display_name(order_details, default=None),
                    'milk_type': order_details.get('milk'),
                    'milkType': order_details.get('milk'),
                    'sugar': order_details.get('sugar'),
                    'size': order_details.get('size'),
                    'vip': order_details.get('vip', False),
                })

                # Walk-up ticket stub: when the designer's ticket toggle
                # is on, a barista-entered walk-in prints the customer a
                # deli-counter number slip. Fire-and-forget.
                if (order_details.get('source') == 'walkin'
                        or order_details.get('order_type') == 'walk-in'):
                    try:
                        from routes.print_routes import maybe_print_ticket
                        maybe_print_ticket(db, order_number, station_id)
                    except Exception:
                        pass

                return jsonify({
                    'status': 'success',
                    'data': {
                        'id': order_id,
                        'order_number': order_number
                    },
                    'message': 'Order created successfully'
                })
            else:
                raise Exception("Failed to create order - no result returned")
        
        except Exception as e:
            logger.error(f"Error creating order: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Failed to create order: {str(e)}'
            }), 500



@bp.route('/orders/pending', methods=['GET'])
@jwt_required_with_demo()
def get_pending_orders():
    """Get all pending orders, optionally filtered by station.

    `?station_id=N` filters to that station only. The fresh-eyes audit
    found that BEFORE this fix the query param was silently ignored —
    a barista logged in to Station 2 saw Station 1's orders mixed into
    their pending queue. With three baristas at three stations, every
    drink would have shown up in every queue. Goal 2 of the product
    ("each station sees its own orders") was broken.
    """
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Defensive rollback — psycopg2's "current transaction is
        # aborted" error sticks until rolled back, and a previous
        # request's failure could otherwise turn this endpoint into a
        # silent 500 even though the orders themselves are fine.
        try:
            db.rollback()
        except Exception:
            pass

        # Surface due ETA-scheduled orders (lazy promotion — this
        # endpoint is polled by the barista UI).
        try:
            coffee_system.promote_due_scheduled_orders()
        except Exception:
            pass

        # Read optional ?station_id=N filter. Reject anything non-int
        # so a typo like '?station_id=abc' doesn't silently 500.
        station_filter = request.args.get('station_id')
        station_param = None
        if station_filter is not None and station_filter != '':
            try:
                station_param = int(station_filter)
            except (TypeError, ValueError):
                return jsonify({
                    'success': False,
                    'message': "station_id must be an integer if provided",
                }), 400

        # Query database for pending orders
        cursor = db.cursor()
        if station_param is not None:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority, payment_status
                FROM orders
                WHERE status = 'pending' AND station_id = %s
                ORDER BY queue_priority, created_at ASC
            ''', (station_param,))
        else:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority, payment_status
                FROM orders
                WHERE status = 'pending'
                ORDER BY queue_priority, created_at ASC
            ''')
        
        # Process orders
        pending_orders = []
        rows = cursor.fetchall()
        questions_by_phone = _pending_questions_by_phone(cursor)
        _pricing = _pricing_for(coffee_system.db)
        for order in rows:
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority, payment_status = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Calculate wait time
            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
            
            # Get batch group if present in order details
            batch_group = None
            if order_details and 'type' in order_details and 'milk' in order_details:
                # Create a batch group key based on coffee type and milk type
                coffee_type = order_details.get('type', '').lower()
                milk_type = order_details.get('milk', '').lower()
                if coffee_type and milk_type:
                    batch_group = f"{coffee_type}-{milk_type}"
            
            # Format order for frontend
            pending_orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'orderNumber': order_number,  # camelCase alias for FE consistency
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),  # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),  # camelCase
                'sugar': order_details.get('sugar', 'No sugar'),
                'size': order_details.get('size'),
                # Temperature is its own card badge in the barista UI —
                # without this field a pending 'extra hot' order looked
                # normal until it was started (Test Bench matrix modifier).
                'extra_hot': (order_details.get('temp') == 'extra hot'
                              or 'extra hot' in (order_details.get('notes') or '').lower()),
                'extraHot': (order_details.get('temp') == 'extra hot'
                             or 'extra hot' in (order_details.get('notes') or '').lower()),
                'strength': order_details.get('strength', ''),
                # Notes, shots and bean choice. Found by the audit sweep
                # Steve asked for: an edit saved "1/4 strength no lid",
                # shots=2, bean_type=decaf, the API confirmed all three
                # changed -- and this serializer sent none of them, so
                # the pending card showed a plain order. The current-order
                # serializer (line ~560) carries them; this one, built
                # separately, never did. Same two-serializers disease as
                # everything else today.
                'notes': order_details.get('notes', ''),
                'specialInstructions': order_details.get('notes', ''),
                'shots': order_details.get('shots'),
                'bean_type': order_details.get('bean_type'),
                'beanType': order_details.get('bean_type'),
                'service': order_details.get('service'),
                # Order channel + no-SMS flag (EA app orders).
                'orderSource': order_details.get('source') or 'sms',
                'needsContact': bool(order_details.get('needs_contact')),
                # The customer's latest unanswered SMS, shown on the card.
                'customer_message': questions_by_phone.get(str(phone or '')),
                'customerMessage': questions_by_phone.get(str(phone or '')),
                # Barista<->customer per-order thread (the 'out of oat,
                # almond ok?' channel). Both flow through the existing
                # order fetch + poll, so the card updates on its own.
                'barista_ask': order_details.get('_barista_ask'),
                'baristaAsk': order_details.get('_barista_ask'),
                'customer_reply': order_details.get('_customer_reply'),
                'customerReply': order_details.get('_customer_reply'),
                'status': status,
                'created_at': created_at,
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'wait_time': wait_time,
                'waitTime': wait_time,  # camelCase
                # promisedTime is the target completion time for the
                # order, used by the Time Pressure bar in the barista
                # UI. The bar previously sat at 0% on every order
                # because nothing set this field. We use a conservative
                # 5-minute target — beyond that the bar fills and the
                # barista sees urgency.
                'promisedTime': 5,
                'priority': priority == 1,  # Convert 1/0 to True/False
                'vip': priority == 1,  # alias used by some UI filters
                'vipReason': (order_details.get('vip_reason') or '') if isinstance(order_details, dict) else '',
                'paymentStatus': _pay_state(payment_status, order_details, _pricing),
                'paidMethod': (order_details.get('paid_method') or '') if isinstance(order_details, dict) else '',
                'batch_group': batch_group,
                # camelCase alias the Barista UI's PendingOrdersSection
                # actually reads — without this, batch grouping silently
                # never triggered. coffee_type / milk_type also had no
                # camelCase aliases on this endpoint; added above too.
                'batchGroup': batch_group,
                # Frontend filter needs a coffee_type field for display.
                'coffeeType': _drink_display_name(order_details),
                'customerName': order_details.get('name', 'Customer'),
                'phone_number': phone,
                'phoneNumber': phone,
                'station_id': station_id,
                'stationId': station_id,
                # Pricing — null when disabled, otherwise carries the
                # computed total. Barista UI shows this so they know
                # what to charge at collection time.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
            })

        return jsonify({
            'success': True,
            'orders': pending_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching pending orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching pending orders: {str(e)}"
        }), 500



@bp.route('/orders/in-progress', methods=['GET'])
@jwt_required_with_demo()
def get_in_progress_orders():
    """Get all in-progress orders.

    Response format matches /api/orders/pending: every field is also
    returned in camelCase because the Barista UI + Display screen
    filter by `stationId` (camelCase). The previous version returned
    only snake_case AND omitted station_id entirely — so a
    just-started order vanished from both the Barista in-progress
    list and the customer Display (both filter by station). That's
    the "Start an order, it disappears, you can't even complete it"
    bug Steve flagged.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Optional ?station_id=N filter. Same fix as /orders/pending —
        # the param was being silently ignored, so every station saw
        # every other station's in-progress orders.
        station_filter = request.args.get('station_id')
        station_param = None
        if station_filter is not None and station_filter != '':
            try:
                station_param = int(station_filter)
            except (TypeError, ValueError):
                return jsonify({
                    'success': False,
                    'message': "station_id must be an integer if provided",
                }), 400

        cursor = db.cursor()
        if station_param is not None:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority, payment_status
                FROM orders
                WHERE status = 'in-progress' AND station_id = %s
                ORDER BY created_at
            ''', (station_param,))
        else:
            cursor.execute('''
                SELECT id, order_number, status, station_id,
                       created_at, phone, order_details, queue_priority, payment_status
                FROM orders
                WHERE status = 'in-progress'
                ORDER BY created_at
            ''')

        in_progress_orders = []
        rows = cursor.fetchall()
        questions_by_phone = _pending_questions_by_phone(cursor)
        _pricing = _pricing_for(coffee_system.db)
        for order in rows:
            order_id, order_number, status, station_id, created_at, phone, order_details_json, priority, payment_status = order

            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}

            created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
            wait_time = int((datetime.now() - created_dt).total_seconds() / 60)

            extra_hot = (
                order_details.get('temp') == 'extra hot'
                or ('extra hot' in (order_details.get('notes') or '').lower())
            )

            customer_name = order_details.get('name', 'Customer')
            coffee_type = _drink_display_name(order_details)
            milk_type = order_details.get('milk', 'Standard')
            size = order_details.get('size')

            in_progress_orders.append({
                # snake_case (legacy)
                'id': order_number,
                'order_number': order_number,
                'customer_name': customer_name,
                'phone_number': phone,
                'coffee_type': coffee_type,
                'milk_type': milk_type,
                'sugar': order_details.get('sugar', 'No sugar'),
                'extra_hot': extra_hot,
                'priority': priority == 1,
                'created_at': created_at,
                'wait_time': wait_time,
                'station_id': station_id,
                'size': size,
                # Pricing — pulled straight from order_details (set
                # at confirm time by either SMS flow or walk-in
                # endpoint). Null when pricing is disabled.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
                # camelCase aliases — REQUIRED by the React UI for filtering.
                'orderNumber': order_number,
                'customerName': customer_name,
                'phoneNumber': phone,
                'coffeeType': coffee_type,
                'milkType': milk_type,
                'extraHot': extra_hot,
                'strength': order_details.get('strength', '') if isinstance(order_details, dict) else '',
                'service': order_details.get('service') if isinstance(order_details, dict) else None,
                # Team mode: which stages (shots/milk) are already done.
                'stages': order_details.get('stages') or {},
                # Order channel + no-SMS flag (EA app orders).
                'orderSource': order_details.get('source') or 'sms',
                'needsContact': bool(order_details.get('needs_contact')),
                'customer_message': questions_by_phone.get(str(phone or '')),
                'customerMessage': questions_by_phone.get(str(phone or '')),
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'waitTime': wait_time,
                'stationId': station_id,
                'status': status,
                'vip': priority == 1,
                'vipReason': (order_details.get('vip_reason') or '') if isinstance(order_details, dict) else '',
                'paymentStatus': _pay_state(payment_status, order_details, _pricing),
                'paidMethod': (order_details.get('paid_method') or '') if isinstance(order_details, dict) else '',
            })

        return jsonify({
            'success': True,
            'orders': in_progress_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching in-progress orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching in-progress orders: {str(e)}"
        }), 500



@bp.route('/orders/completed', methods=['GET'])
@jwt_required_with_demo()
def get_completed_orders():
    """Get completed orders.

    Optional `?station_id=N` filters to just that station — the
    Barista interface uses this so each station shows only its own
    completed orders rather than every station's. Without the filter
    (e.g. a manager-wide report) every station's completions come
    back. The response now also includes `station_id` so callers can
    label which station completed each order.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        # Defensive rollback — clear any prior aborted transaction
        # state on the shared connection (same pattern as the other
        # read endpoints).
        try:
            db.rollback()
        except Exception:
            pass

        station_filter = request.args.get('station_id', type=int)
        # New: optional recency filter so the customer-facing Display
        # screen can ask for "completed in the last N minutes" rather
        # than every completion ever (which is why Steve saw 30 stale
        # test orders sitting on the display forever).
        recent_minutes = request.args.get('recent_minutes', type=int)
        # New: filter out picked-up orders by default — Display should
        # only show "Ready for Pickup" (still waiting), not orders
        # the customer already collected.
        include_picked_up = request.args.get('include_picked_up', '0').lower() in ('1', 'true', 'yes')
        status_filter = ('completed', 'picked_up') if include_picked_up else ('completed',)
        status_placeholder = ','.join(['%s'] * len(status_filter))

        cursor = db.cursor()
        where = [f"status IN ({status_placeholder})"]
        params = list(status_filter)
        if station_filter is not None:
            where.append("station_id = %s")
            params.append(station_filter)
        if recent_minutes is not None and recent_minutes > 0:
            where.append("updated_at >= (CURRENT_TIMESTAMP - (%s || ' minutes')::interval)")
            params.append(str(recent_minutes))
        sql = f"""
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, phone, order_details, picked_up_at
            FROM orders
            WHERE {' AND '.join(where)}
            ORDER BY updated_at DESC
            LIMIT 50
        """
        cursor.execute(sql, params)

        completed_orders = []
        for order in cursor.fetchall():
            order_id, order_number, status, station_id, created_at, updated_at, phone, order_details_json, picked_up_at = order
            completed_at = updated_at or created_at
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json

            completed_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'phone_number': phone,
                'phoneNumber': phone,                   # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),     # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),     # camelCase
                'service': order_details.get('service'),
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if hasattr(completed_at, 'isoformat') else completed_at,
                'picked_up_at': picked_up_at,
                'pickedUpAt': picked_up_at,
                'status': status,
                # Include station so callers can either filter again
                # client-side or label which station made each one.
                'station_id': station_id,
                'stationId': station_id,
                'ready_for_pickup': status == 'completed',
                # Pricing — completed orders need the price tag for
                # the Ready-for-Pickup column. Mirrors the pattern
                # in /orders/in-progress.
                'price': order_details.get('price'),
                'price_formatted': order_details.get('price_formatted'),
                'priceFormatted': order_details.get('price_formatted'),
            })
        
        return jsonify({
            'success': True,
            'orders': completed_orders
        })
    
    except Exception as e:
        logger.error(f"Error fetching completed orders: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching completed orders: {str(e)}"
        }), 500



@bp.route('/orders/find', methods=['GET'])
def find_my_order_public():
    """Find MY order, from the customer's own phone, by the name it was put
    under. No login: the person holding the phone has no account.

    Steve: "they might not have entered a phone number, might not have a
    badge number... worth it searching for the name people put it under and
    the coffee order. Yes there is a chance another Tom ordered within 30
    minutes at the same station and possibly the same coffee, but for someone
    looking up a beacon that chance is minimal." So: match the name, then let
    them pick from what came back -- the drink, the cart and how long ago are
    what tell two Toms apart.

    Deliberately narrow, because it is public:
      * ACTIVE orders only (waiting, being made, or ready) -- history is not
        searchable, so this cannot be used to trawl the event.
      * the last two hours only.
      * a name of two characters or more, matched from the START of the name,
        so "t" does not return the room.
      * at most eight, newest first.
      * it returns exactly what the pickup board already shows in public --
        first name, drink, cart, how long ago. NEVER a phone number.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'orders': []}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        name = (request.args.get('name') or '').strip()
        if len(name) < 2:
            return jsonify({'success': True, 'orders': [],
                            'message': 'Type at least two letters of the name.'})

        cur = db.cursor()
        cur.execute(
            """
            SELECT order_number, status, station_id, created_at, order_details
              FROM orders
             WHERE status IN ('pending', 'in-progress', 'in_progress', 'completed')
               -- created_at is naive UTC (the app stamps datetime.now()
               -- on a UTC server); NOW() is the DATABASE's local clock, and
               -- on a machine set to Adelaide that made every order look
               -- 9.5 hours old and this search return nothing. Compare
               -- like with like.
               AND created_at > (NOW() AT TIME ZONE 'UTC') - INTERVAL '2 hours'
             ORDER BY created_at DESC
             LIMIT 200
            """)
        wanted = name.lower()
        out = []
        for row in cur.fetchall():
            (num, status, station_id, created_at, details) = (
                (row.get('order_number'), row.get('status'), row.get('station_id'),
                 row.get('created_at'), row.get('order_details'))
                if isinstance(row, dict) else row)
            try:
                d = json.loads(details) if isinstance(details, str) else (details or {})
            except Exception:
                d = {}
            who = str(d.get('name') or '').strip()
            if not who or not who.lower().startswith(wanted):
                continue
            mins = 0
            try:
                mins = max(0, int((datetime.utcnow() - created_at).total_seconds() // 60))
            except Exception:
                pass
            drink = ' '.join(str(x) for x in (d.get('size'), d.get('type')) if x).strip()
            milk = str(d.get('milk') or '').strip()
            out.append({
                'order_number': num,
                'name': who,
                'drink': drink or 'Coffee',
                'milk': milk,
                'status': status,
                'station_id': station_id,
                'minutes_ago': mins,
            })
            if len(out) >= 8:
                break

        # Name the cart, so two Toms with the same drink are still telling.
        try:
            from utils.station_label import station_label
            labels = {}
            for o in out:
                sid = o.get('station_id')
                if sid is not None and sid not in labels:
                    labels[sid] = station_label(db, sid) or f'Station {sid}'
                o['station_name'] = labels.get(sid, '')
        except Exception:
            for o in out:
                o['station_name'] = f"Station {o.get('station_id')}" if o.get('station_id') else ''

        return jsonify({'success': True, 'orders': out})
    except Exception as e:
        logger.error(f"find_my_order_public error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'orders': []}), 200



@bp.route('/orders/search', methods=['GET'])
@jwt_required_with_demo()
def search_orders():
    """Full-text search over recent orders.

    Body of search is matched against customer_name and order_number
    case-insensitively. Optional `?station_id=N` further filters. Used
    by the Barista UI's Completed Orders search box.
    """
    try:
        q = (request.args.get('q') or request.args.get('query') or '').strip().lower()
        station_id = request.args.get('station_id', type=int)
        limit = min(int(request.args.get('limit', 50)), 200)
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        where = ['1=1']
        params: list = []
        if q:
            # Match against order_number OR the JSON 'name' field.
            # Postgres JSONB makes this clean; SQLite path is best-effort.
            where.append("(LOWER(order_number) LIKE %s OR LOWER(COALESCE(order_details->>'name','')) LIKE %s)")
            params.extend([f"%{q}%", f"%{q}%"])
        if station_id is not None:
            where.append("station_id = %s")
            params.append(station_id)
        params.append(limit)
        sql = f"""
            SELECT order_number, status, station_id, created_at, phone, order_details
            FROM orders
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT %s
        """
        cur.execute(sql, params)
        results = []
        for row in cur.fetchall():
            order_number, status, sid, created_at, phone, od = row
            if isinstance(od, str):
                try:
                    od = json.loads(od)
                except Exception:
                    od = {}
            od = od or {}
            results.append({
                'order_number': order_number,
                'orderNumber': order_number,
                'status': status,
                'station_id': sid, 'stationId': sid,
                'created_at': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'customer_name': od.get('name', ''),
                'customerName': od.get('name', ''),
                'coffee_type': _drink_display_name(od, default=''),
                'coffeeType': _drink_display_name(od, default=''),
                'milk_type': od.get('milk', ''),
                'milkType': od.get('milk', ''),
                'phone_number': phone, 'phoneNumber': phone,
            })
        return jsonify({'success': True, 'status': 'success', 'data': results, 'orders': results})
    except Exception as e:
        logger.error(f"search_orders error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/history', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_order_history():
    """Get order history with filtering options"""
    try:
        # Get query parameters for filtering
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        status = request.args.get('status')
        station_id = request.args.get('station_id')
        customer_name = request.args.get('customer_name')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Build dynamic query with filters
        query = '''
            SELECT id, order_number, status, station_id,
                   created_at, updated_at, completed_at, phone, order_details
            FROM orders 
            WHERE 1=1
        '''
        
        params = []
        
        # Date range filter. The dates are LOCAL days where the event is;
        # DATE(created_at) compared them against the UTC date and lost the
        # morning (finding 3). A range over created_at, index-friendly.
        _a = _event_time.parse_date(start_date) if start_date else None
        _b = _event_time.parse_date(end_date) if end_date else None
        if start_date and not _a:
            logger.warning(f"Invalid start_date format: {start_date}")
        if end_date and not _b:
            logger.warning(f"Invalid end_date format: {end_date}")
        _s, _e = _event_time.range_bounds(_a, _b, _event_timezone())
        if _s:
            query += " AND created_at >= %s"
            params.append(_s)
        if _e:
            query += " AND created_at < %s"
            params.append(_e)
        
        # Add status filter
        if status:
            query += " AND status = %s"
            params.append(status)
        
        # Add station filter
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add customer name filter (search in JSON)
        if customer_name:
            # PostgreSQL JSON search using ->> operator
            query += " AND (order_details->>'name' ILIKE %s OR order_details->>'name' ILIKE %s)"
            params.append(f"{customer_name}%")  # Starts with
            params.append(f"% {customer_name}%")  # Contains after space
        
        # Add ordering and pagination
        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.append(limit)
        params.append(offset)
        
        # Execute query
        cursor = db.cursor()
        cursor.execute(query, params)
        
        # Process orders
        orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json
            
            # Format order for frontend
            orders.append({
                'id': order_number,  # Use order_number as id for consistency
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': order_details.get('name', 'Customer'),
                'customerName': order_details.get('name', 'Customer'),  # camelCase
                'phone_number': phone,
                'phoneNumber': phone,                   # camelCase
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),     # camelCase
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),     # camelCase
                'sugar': order_details.get('sugar', 'No sugar'),
                'status': status,
                'station_id': station_id,
                'stationId': station_id,
                'created_at': created_at,
                'createdAt': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'updated_at': updated_at,
                'updatedAt': updated_at.isoformat() if hasattr(updated_at, 'isoformat') else updated_at,
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if (completed_at and hasattr(completed_at, 'isoformat')) else completed_at,
                'notes': order_details.get('notes', '')
            })
        
        # Count total matching records (without pagination)
        count_query = query.split('ORDER BY')[0].replace('SELECT id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details', 'SELECT COUNT(*)')
        cursor.execute(count_query, params[:-2])  # Remove limit and offset params
        total_count = cursor.fetchone()[0]
        
        return jsonify({
            'success': True,
            'orders': orders,
            'pagination': {
                'total': total_count,
                'offset': offset,
                'limit': limit
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching order history: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching order history: {str(e)}"
        }), 500



@bp.route('/orders/statistics', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_order_statistics():
    """Get order statistics"""
    try:
        # Get query parameters for filtering
        time_period = request.args.get('period', 'day')  # day, week, month, year
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        cursor = db.cursor()
        
        # Set default date range based on time period if not provided --
        # "today" on the event's clock (finding 3).
        _now = _event_time.local_now(_event_timezone())
        if not start_date:
            if time_period == 'day':
                start_date = _now.strftime('%Y-%m-%d')
            elif time_period == 'week':
                start_date = (_now - timedelta(days=7)).strftime('%Y-%m-%d')
            elif time_period == 'month':
                start_date = (_now - timedelta(days=30)).strftime('%Y-%m-%d')
            elif time_period == 'year':
                start_date = (_now - timedelta(days=365)).strftime('%Y-%m-%d')
        
        if not end_date:
            end_date = _now.strftime('%Y-%m-%d')
        
        # Validate date parameters
        try:
            start_dt = datetime.strptime(start_date, '%Y-%m-%d')
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')
        except ValueError:
            return jsonify({
                'success': False,
                'message': 'Invalid date format. Use YYYY-MM-DD.'
            }), 400

        # Local days where the event is, as a UTC window (finding 3):
        # DATE(created_at) BETWEEN filed every morning under the day before.
        _tz = _event_timezone()
        _w0, _w1 = _event_time.range_bounds(start_dt.date(), end_dt.date(), _tz)
        _win = (_w0, _w1)
        _day = _event_time.local_date_sql('created_at')
        _hour = _event_time.local_hour_sql('created_at')
        
        # Generate statistics
        
        # 1. Total orders by status
        cursor.execute('''
            SELECT status, COUNT(*) as count
            FROM orders
            WHERE created_at >= %s AND created_at < %s
            GROUP BY status
        ''', _win)
        
        status_counts = {}
        for row in cursor.fetchall():
            status, count = row
            status_counts[status] = count
        
        # 2. Orders by (local) day
        cursor.execute(f'''
            SELECT {_day} as day, COUNT(*) as count
            FROM orders
            WHERE created_at >= %(w0)s AND created_at < %(w1)s
            GROUP BY 1
            ORDER BY day
        ''', {'tz': _tz, 'w0': _w0, 'w1': _w1})
        
        daily_counts = {}
        for row in cursor.fetchall():
            day, count = row
            daily_counts[day.strftime('%Y-%m-%d')] = count
        
        # 3. Orders by coffee type
        cursor.execute('''
            SELECT order_details->>'type' as coffee_type, COUNT(*) as count
            FROM orders
            WHERE created_at >= %s AND created_at < %s
            AND order_details->>'type' IS NOT NULL
            GROUP BY order_details->>'type'
            ORDER BY count DESC
        ''', _win)
        
        coffee_type_counts = {}
        for row in cursor.fetchall():
            coffee_type, count = row
            coffee_type_counts[coffee_type] = count
        
        # 4. Orders by milk type
        cursor.execute('''
            SELECT order_details->>'milk' as milk_type, COUNT(*) as count
            FROM orders
            WHERE created_at >= %s AND created_at < %s
            AND order_details->>'milk' IS NOT NULL
            GROUP BY order_details->>'milk'
            ORDER BY count DESC
        ''', _win)
        
        milk_type_counts = {}
        for row in cursor.fetchall():
            milk_type, count = row
            milk_type_counts[milk_type] = count
        
        # 5. Busiest hours, on the event's clock (1am was never the rush)
        cursor.execute(f'''
            SELECT {_hour} as hour, COUNT(*) as count
            FROM orders
            WHERE created_at >= %(w0)s AND created_at < %(w1)s
            GROUP BY 1
            ORDER BY hour
        ''', {'tz': _tz, 'w0': _w0, 'w1': _w1})
        
        hourly_counts = {}
        for row in cursor.fetchall():
            hour, count = row
            hourly_counts[int(hour)] = count
        
        # Return compiled statistics
        return jsonify({
            'success': True,
            'statistics': {
                'date_range': {
                    'start_date': start_date,
                    'end_date': end_date
                },
                'by_status': status_counts,
                'by_day': daily_counts,
                'by_coffee_type': coffee_type_counts,
                'by_milk_type': milk_type_counts,
                'by_hour': hourly_counts,
                'total_orders': sum(status_counts.values()) if status_counts else 0
            }
        })
    
    except Exception as e:
        logger.error(f"Error generating order statistics: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error generating order statistics: {str(e)}"
        }), 500



@bp.route('/orders/lookup/<order_id>', methods=['GET'])
@jwt_required_with_demo()
def lookup_order(order_id):
    """Look up an order by ID or order number"""
    try:
        # Clean the order ID if needed
        clean_id = clean_order_id(order_id)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query the database for the order
        cursor = db.cursor()
        
        # Try to find by order_number first (most reliable)
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, updated_at, completed_at, 
                   phone, order_details, queue_priority
            FROM orders 
            WHERE order_number = %s
        ''', (clean_id,))
        
        order = cursor.fetchone()
        
        # If not found by order_number, try by ID
        if not order:
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, updated_at, completed_at, 
                       phone, order_details, queue_priority
                FROM orders 
                WHERE id = %s
            ''', (clean_id,))
            
            order = cursor.fetchone()
        
        # A bare round number (336) names no order once a round is lettered
        # (336a/b/c) -- resolve it to the lead drink before giving up.
        if not order:
            try:
                from utils.order_numbering import is_lettered
                if not is_lettered(clean_id):
                    cursor.execute('''
                        SELECT id, order_number, status, station_id,
                               created_at, updated_at, completed_at,
                               phone, order_details, queue_priority
                        FROM orders
                        WHERE order_number = %s
                    ''', (f"{clean_id}a",))
                    order = cursor.fetchone()
            except Exception:
                order = None

        # If still not found, return error
        if not order:
            return jsonify({
                "success": False, 
                "message": f"Order {order_id} not found"
            })
        
        # Extract order details
        order_id, order_number, status, station_id, created_at, updated_at, completed_at, phone, order_details_json, priority = order
        
        # Parse order details
        if isinstance(order_details_json, str):
            order_details = json.loads(order_details_json)
        else:
            order_details = order_details_json
        
        # Format order for response
        order_data = {
            "id": order_number,  # Use order_number as ID for consistency
            "order_number": order_number,
            "status": status,
            "station_id": station_id,
            "customer_name": order_details.get('name', 'Customer'),
            "phone_number": phone,
            "coffee_type": order_details.get('type', 'Coffee'),
            "milk_type": order_details.get('milk', 'Standard'),
            "sugar": order_details.get('sugar', 'No sugar'),
            "size": order_details.get('size', 'Regular'),
            "created_at": created_at,
            "updated_at": updated_at,
            "completed_at": completed_at,
            "priority": priority == 1,
            "details": order_details  # Include full details for reference
        }
        
        return jsonify({
            "success": True,
            "order": order_data
        })
    
    except Exception as e:
        logger.error(f"Error looking up order {order_id}: {str(e)}")
        return jsonify({
            "success": False,
            "message": f"Error looking up order: {str(e)}"
        })



@bp.route('/orders/<order_number>/messages', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def order_message_history(order_number):
    """Every SMS recorded for one order (confirmations, barista messages,
    test_no_send renders). order_messages previously had no per-order
    reader — needed for the barista's context and the bench's
    template-propagation proof."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cur = db.cursor()
        cur.execute("""
            SELECT id, order_number, phone, message, message_sid, sent_at
              FROM order_messages
             WHERE order_number = %s
             ORDER BY sent_at ASC
             LIMIT 50
        """, (clean_order_id(order_number),))
        cols = ['id', 'order_number', 'phone', 'message', 'message_sid', 'sent_at']
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r)) if not isinstance(r, dict) else dict(r)
            if hasattr(d.get('sent_at'), 'isoformat'):
                d['sent_at'] = d['sent_at'].isoformat()
            rows.append(d)
        return jsonify({'success': True, 'messages': rows})
    except Exception as e:
        logger.error(f"order_message_history error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500
