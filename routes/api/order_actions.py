"""What staff do to an order: start, ready, pick up, batch, reassign, cancel.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import jwt_required_with_demo, role_required_with_demo
from datetime import datetime
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from routes.consolidated_api_routes import (  # noqa: F401
    _emit_order_status_change,
    _emit_order_updated,
    _notify_customer_order_ready,
    _notify_customer_order_started,
    _render_ready_message,
    _should_send_started_sms,
    _station_can_make_order,
    bp,
    clean_order_id,
    logger,
)



@bp.route('/orders/batch/process', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def process_order_batch():
    """Move a list of pending orders to in-progress in one call.

    Body: { "order_ids": ["W123", "W124", ...] }

    The Barista UI's "Batch Process" button selects multiple
    related orders (same milk + coffee type) and starts them
    together. Without this endpoint the button silently no-op'd.
    Returns the new statuses and a per-order success flag.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        order_ids = data.get('order_ids') or data.get('orderIds') or []
        if not isinstance(order_ids, list) or not order_ids:
            return jsonify({'success': False, 'message': 'order_ids must be a non-empty array'}), 400
        results = []
        cur = db.cursor()
        for oid in order_ids:
            clean = clean_order_id(str(oid))
            try:
                _now_b = datetime.now().isoformat()
                cur.execute(
                    "UPDATE orders SET status = 'in-progress', updated_at = %s, started_at = %s "
                    "WHERE order_number = %s AND status = 'pending' RETURNING order_number",
                    (_now_b, _now_b, clean),
                )
                row = cur.fetchone()
                results.append({'order_id': clean, 'success': bool(row),
                                'new_status': 'in-progress' if row else None})
            except Exception as e:
                results.append({'order_id': clean, 'success': False, 'error': str(e)})
                try: db.rollback()
                except Exception: pass
        db.commit()
        return jsonify({'success': True, 'results': results,
                        'count': sum(1 for r in results if r['success'])})
    except Exception as e:
        logger.error(f"process_order_batch error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/start', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def start_order(order_id):
    """Start an order.

    Also notifies the customer by SMS so they know their drink is being
    made now — closes the silent gap between order-confirmed and
    order-ready that previously made customers wander up to the station
    asking if they'd been forgotten.
    """
    try:
        logger.info(f"Received request to start order: {order_id}")

        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})

        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # The barista's currently-selected station is sent in the body
        # so we can check whether that station can actually make this
        # drink — without it, a barista at Station 2 could tap Start on
        # an oat-milk order routed to Station 1 (which has oat) and
        # nothing would stop them from making it on a station that
        # doesn't stock oat. The check is best-effort and only blocks
        # when capabilities are definitively wrong; missing/empty
        # capabilities mean "no restriction".
        payload = request.get_json(silent=True) or {}
        claiming_station_id = payload.get('station_id') or payload.get('stationId')

        # Fetch the row up-front: we want phone + details + created_at
        # *before* we change status, so the notification has the right
        # context AND the started-SMS policy can compute order age.
        cursor = db.cursor()
        cursor.execute(
            'SELECT id, phone, order_details, status, created_at '
            'FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        # Tolerate both tuple and dict cursors.
        if isinstance(order_row, dict):
            order_phone = order_row.get('phone')
            order_details = order_row.get('order_details') or {}
            current_status = order_row.get('status')
            order_created_at = order_row.get('created_at')
        else:
            _, order_phone, order_details, current_status, order_created_at = order_row

        # State machine guard. Without this, /start on a picked_up order
        # pulled it BACK into in-progress — the collected coffee
        # re-appeared on the barista queue. Bug Steve hit in QC.
        #
        # Treat these as terminal: refusing further state changes.
        #   - picked_up  → already collected, don't resurrect.
        #   - cancelled  → customer cancelled, don't restart.
        if current_status in ('picked_up', 'cancelled'):
            return jsonify({
                "success": False,
                "message": (
                    f"Cannot start order {clean_id}: already {current_status}."
                ),
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent: already in-progress is a no-op success (don't
        # re-fire the started SMS or re-emit the WS event).
        if current_status == 'in-progress':
            return jsonify({
                "success": True,
                "message": "Order already in progress",
                "current_status": current_status,
                "noop": True,
            })

        # Parse order_details if it came back as JSON text.
        parsed_details = order_details
        if isinstance(parsed_details, str):
            try:
                parsed_details = json.loads(parsed_details)
            except Exception:
                parsed_details = {}
        if not isinstance(parsed_details, dict):
            parsed_details = {}

        # Capability gate: if the barista's station can't make this drink,
        # refuse to start it and tell them why. Routing already picked
        # the right station at order time, so this only fires when a
        # barista at the wrong station tries to claim.
        if claiming_station_id:
            capability_check = _station_can_make_order(
                db, claiming_station_id, parsed_details
            )
            if capability_check.get('blocked'):
                logger.warning(
                    f"Refused start of order {clean_id} at station "
                    f"{claiming_station_id}: {capability_check.get('reason')}"
                )
                return jsonify({
                    "success": False,
                    "message": capability_check.get('reason'),
                    "code": "STATION_CAPABILITY_MISMATCH",
                }), 400

        # started_at powers the TRUE make-time average (start→complete).
        # The old average measured created→completed — the whole lifetime
        # including queue-sitting time — so three test orders that sat 30
        # minutes made an EMPTY station claim a 10-minute walk-up wait.
        #
        # This used to run the ALTER unconditionally, on EVERY start —
        # once per drink, 400+ times at an event. ADD COLUMN takes
        # ACCESS EXCLUSIVE on `orders` BEFORE it checks whether the
        # column exists, so a "no-op" still queued behind any reader,
        # and a waiting exclusive lock stalls every reader behind IT.
        # Same mechanism as the boot-time convoy, on the hottest path we
        # have. ensure_column asks the catalogue first and only reaches
        # for DDL on a database that genuinely lacks the column.
        from utils.schema_guard import ensure_column
        ensure_column(
            db, "orders", "started_at",
            "ALTER TABLE orders ADD COLUMN IF NOT EXISTS started_at TIMESTAMP")
        _now_s = datetime.now().isoformat()
        cursor.execute(
            '''
            UPDATE orders
            SET status = 'in-progress', updated_at = %s, started_at = %s
            WHERE order_number = %s
            ''',
            (_now_s, _now_s, clean_id),
        )
        db.commit()
        rows_affected = cursor.rowcount

        if rows_affected <= 0:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} found but could not be updated",
            })

        logger.info(f"Successfully started order: {clean_id}")

        # Send the "your barista just started your X" SMS. We only do this
        # on the pending → in-progress transition (not on re-starts) to
        # avoid double-notifying the customer if a barista taps Start more
        # than once. AND we apply the policy gate: at small events with no
        # queue, the "started" SMS just adds noise between confirm and
        # ready — see _should_send_started_sms for the rules.
        # test_no_send (Test Bench): perform the full transition but skip the
        # real SMS — same escape hatch the message endpoint has, needed
        # because prod TESTING_MODE is off and lifecycle tests on
        # phone-bearing orders would text real numbers.
        _no_send = bool((request.get_json(silent=True) or {}).get('test_no_send')
                        or (request.get_json(silent=True) or {}).get('dry_run'))
        if current_status == 'pending' and not _no_send \
                and _should_send_started_sms(db, order_created_at):
            _notify_customer_order_started(order_phone, clean_id, order_details)

        # Push a WS event so any open Barista UI / Display refreshes
        # immediately instead of waiting for the next 15s poll. The
        # forwarded window event 'order_updated' is what useOrders +
        # the customer Display + the Ready-for-Pickup column listen to.
        _emit_order_status_change(clean_id, 'in-progress')

        return jsonify({"success": True, "message": "Order started successfully"})

    except Exception as e:
        logger.error(f"Error starting order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/orders/<order_id>/complete', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def complete_order(order_id):
    """Complete an order"""
    try:
        # Log incoming request
        logger.info(f"Received request to complete order: {order_id}")

        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})

        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")

        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db

        # Check if order exists — fetch details + phone + status too so we
        # can decrement stock at completion AND send the customer a
        # "your drink is ready" SMS once the status flip succeeds, AND
        # so we can guard against re-completing an already-completed
        # order (which would re-fire the SMS, the bug Steve hit on
        # triple-tap during QC).
        cursor = db.cursor()
        cursor.execute(
            'SELECT id, station_id, order_details, phone, status FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        if isinstance(order_row, dict):
            station_id_for_stock = order_row.get('station_id') or 1
            order_details_raw = order_row.get('order_details') or {}
            order_phone = order_row.get('phone') or ''
            current_status = order_row.get('status')
        else:
            _, station_id_for_stock, order_details_raw, order_phone, current_status = order_row
            station_id_for_stock = station_id_for_stock or 1
            order_phone = order_phone or ''

        # State guards (same shape as /start). picked_up is terminal —
        # don't fire ready SMS for an order that's already collected.
        if current_status == 'cancelled':
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} was cancelled.",
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent: already completed → no-op success. CRITICAL: do
        # NOT re-send the ready SMS or re-decrement stock. This was the
        # source of duplicate "your coffee is ready" texts on misclick.
        if current_status in ('completed', 'picked_up'):
            return jsonify({
                "success": True,
                "message": f"Order already {current_status}",
                "current_status": current_status,
                "noop": True,
            })

        # Get current time
        completed_at = datetime.now().isoformat()

        # Update order status
        cursor.execute('''
            UPDATE orders
            SET status = 'completed', updated_at = %s, completed_at = %s
            WHERE order_number = %s
        ''', (completed_at, completed_at, clean_id))

        db.commit()
        rows_affected = cursor.rowcount

        # Decrement inventory at the moment the drink is actually
        # made. Tea-aware decrement (small milk volume, 2 cups when
        # double-cupped) lives in coffee_system._decrement_stock_for_order.
        # Failure here is non-fatal — the order is already marked
        # complete and we don't want to roll that back over inventory
        # accounting — but we surface skipped items so the barista
        # gets a toast warning instead of silently consuming stock
        # that the system thinks they have.
        stock_result = {'decremented': [], 'skipped': []}
        try:
            order_details_parsed = order_details_raw
            if isinstance(order_details_parsed, str):
                try:
                    order_details_parsed = json.loads(order_details_parsed)
                except Exception:
                    order_details_parsed = {}
            if isinstance(order_details_parsed, dict) and order_details_parsed:
                db_type = 'sqlite' if 'sqlite' in str(type(db)).lower() else 'postgres'
                stock_result = coffee_system._decrement_stock_for_order(
                    db, db_type, station_id_for_stock, order_details_parsed,
                ) or stock_result
                # Commit the inventory UPDATEs.
                #
                # CRITICAL BUG without this: _decrement_stock_for_order
                # runs UPDATE inventory_items SET amount = amount - X
                # against the cursor, but never commits. The order-status
                # commit at line 2217 happened BEFORE this — those
                # inventory UPDATEs sat in an uncommitted transaction
                # and disappeared on the next request's defensive
                # rollback. Net effect: stock NEVER decremented in
                # production (audit verified). Goal 3 of the product
                # was silently broken since launch.
                try:
                    db.commit()
                except Exception as commit_err:
                    logger.error(
                        "Stock-decrement commit failed for order "
                        f"{clean_id}: {commit_err}"
                    )
                if stock_result.get('skipped'):
                    logger.warning(
                        f"Stock decrement on complete: skipped items for "
                        f"order {clean_id} → {stock_result['skipped']}"
                    )
        except Exception as inv_err:
            logger.error(f"Stock decrement on complete failed (non-fatal): {inv_err}")
            try:
                db.rollback()
            except Exception:
                pass
        
        if rows_affected > 0:
            logger.info(f"Successfully completed order: {clean_id}")
            _emit_order_status_change(clean_id, 'completed')

            # Send the customer a "your drink is ready" SMS. This was
            # the biggest gap in the SMS UX audit — the legacy PUT
            # /status path sent this, but the new /complete endpoint
            # (which the Barista UI now uses) didn't. Customers had
            # no signal their order was ready unless they were
            # watching the customer Display screen.
            #
            # Never raises — the order is already marked complete by
            # the time we get here, so a messaging failure must not
            # roll that back.
            # test_no_send (Test Bench): full transition, no real SMS — but
            # RECORD the message that would have gone out, so template
            # propagation is provable end to end without a send.
            if not ((request.get_json(silent=True) or {}).get('test_no_send')
                    or (request.get_json(silent=True) or {}).get('dry_run')):
                _notify_customer_order_ready(
                    order_phone,
                    clean_id,
                    order_details_parsed if isinstance(order_details_parsed, dict) else {},
                    station_id_for_stock,
                )
            elif order_phone:
                try:
                    _body = _render_ready_message(
                        clean_id,
                        order_details_parsed if isinstance(order_details_parsed, dict) else {},
                        station_id_for_stock)
                    _mc = db.cursor()
                    _mc.execute("""
                        INSERT INTO order_messages (order_number, phone, message, message_sid)
                        VALUES (%s, %s, %s, %s)
                    """, (clean_id, order_phone, _body, 'test_no_send'))
                    db.commit()
                except Exception as _rec_err:
                    logger.warning(f"test_no_send message record skipped: {_rec_err}")

            # Surface stock-decrement skipped items in the response so
            # the barista UI can toast a warning. `stock_warnings` is a
            # human-readable summary, frontend renders it conditionally.
            response = {"success": True, "message": "Order completed successfully"}
            if stock_result.get('skipped'):
                names = [
                    f"{s.get('category', '?')}:{s.get('name', '?')}"
                    for s in stock_result['skipped']
                ]
                response['stock_warnings'] = (
                    f"Order completed, but stock wasn't decremented for: "
                    f"{', '.join(names)} (no matching inventory row)."
                )
                response['stock_skipped'] = stock_result['skipped']
            return jsonify(response)
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})

    except Exception as e:
        logger.error(f"Error completing order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/orders/batch-complete', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def batch_complete_orders():
    """Express batch (the big-event 'flat white table' flow): complete a
    tray of same-kind orders in ONE action. Each order is stamped with a
    collection note first ('the FLAT WHITE table at Coffee Station 1'),
    which the ready-SMS renders via its {station} placeholder, then
    completed through the REAL complete endpoint one by one — stock,
    WebSocket, SMS and the display all behave exactly as for individual
    completes. Per-order results returned; one failure never aborts the
    tray (Steve: orders must not be lost to the bulk process)."""
    try:
        data = request.get_json(silent=True) or {}
        order_ids = [str(o) for o in (data.get('order_ids') or []) if o]
        collection_label = str(data.get('collection_label') or '').strip()[:80]
        if not order_ids:
            return jsonify({'success': False, 'message': 'order_ids required'}), 400
        if len(order_ids) > 60:
            return jsonify({'success': False,
                            'message': 'batch too large (max 60)'}), 400
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        # Stamp the collection note on every order BEFORE completing —
        # the SMS renders during the complete call.
        if collection_label:
            cursor = db.cursor()
            for oid in order_ids:
                cursor.execute(
                    "UPDATE orders SET order_details = order_details || %s::jsonb "
                    "WHERE order_number = %s",
                    (json.dumps({'collection_note': collection_label}),
                     clean_order_id(oid)))
            db.commit()
        from flask_jwt_extended import create_access_token
        service_token = create_access_token(
            identity='express-batch',
            additional_claims={'role': 'staff', 'source': 'batch-complete'})
        client = current_app.test_client()
        # Forward the test flags so a bench tray records its SMSes
        # instead of sending, same as individual completes.
        inner_body = {}
        for flag in ('test_no_send', 'dry_run'):
            if data.get(flag):
                inner_body[flag] = True
        completed, failed = [], []
        for oid in order_ids:
            try:
                resp = client.post(
                    f'/api/orders/{clean_order_id(oid)}/complete',
                    json=inner_body,
                    headers={'Authorization': f'Bearer {service_token}'})
                body = resp.get_json(silent=True) or {}
                if resp.status_code == 200 and body.get('success', True):
                    completed.append(oid)
                else:
                    failed.append({'order': oid,
                                   'error': body.get('message') or f'HTTP {resp.status_code}'})
            except Exception as one_err:
                failed.append({'order': oid, 'error': str(one_err)})
        return jsonify({'success': len(failed) == 0,
                        'completed': completed, 'failed': failed,
                        'collection_label': collection_label})
    except Exception as e:
        logger.error(f"batch_complete_orders error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/stage', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def set_order_stage(order_id):
    """Team mode: tick (or untick) one stage of an in-progress order —
    'shots' or 'milk' — so two-plus baristas sharing a station's iPad can
    divide the work and see each other's progress. Stamps a timestamp
    into order_details.stages.<stage>; COMPLETE stays a separate,
    explicit action (an accidental tap must never fire the ready-SMS)."""
    try:
        data = request.get_json(silent=True) or {}
        stage = str(data.get('stage') or '').strip().lower()
        done = data.get('done', True)
        if stage not in ('shots', 'milk'):
            return jsonify({'success': False,
                            'message': "stage must be 'shots' or 'milk'"}), 400
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cursor = db.cursor()
        cursor.execute("SELECT order_details FROM orders WHERE order_number = %s",
                       (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': False,
                            'message': f'Order {clean_id} not found'}), 404
        od_raw = row[0] if not isinstance(row, dict) else row.get('order_details')
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
        stages = od.get('stages') or {}
        if done:
            stages[stage] = datetime.now().isoformat()
        else:
            stages.pop(stage, None)
        cursor.execute(
            "UPDATE orders SET order_details = order_details || %s::jsonb "
            "WHERE order_number = %s",
            (json.dumps({'stages': stages}), clean_id))
        db.commit()
        return jsonify({'success': True, 'stages': stages})
    except Exception as e:
        logger.error(f"set_order_stage error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/paid', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def order_mark_paid(order_id):
    """The Paid tap on the barista card. Body: {method: cash|card|square|other}.

    Level 1 of payments (services/payments.py): the counter took the money
    however it likes, and the card should say so. Idempotent -- a second
    tap changes nothing. Emits order_updated so every open screen sees the
    pill turn."""
    try:
        from services.payments import mark_paid
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json(silent=True) or {}
        try:
            who = get_jwt_identity()
        except Exception:
            who = None
        od = mark_paid(coffee_system.db, order_id, body.get('method') or 'cash', by=who)
        if od is None:
            return jsonify({'success': False, 'message': 'order not found'}), 404
        _emit_order_updated(order_id, {'paymentStatus': 'paid', 'paidMethod': od.get('paid_method')})
        return jsonify({'success': True, 'paymentStatus': 'paid', 'paidMethod': od.get('paid_method')})
    except Exception as e:
        logger.error(f"order_mark_paid error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/unpaid', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def order_mark_unpaid(order_id):
    """Undo a Paid tap made by mistake."""
    try:
        from services.payments import mark_unpaid
        coffee_system = current_app.config.get('coffee_system')
        try:
            who = get_jwt_identity()
        except Exception:
            who = None
        od = mark_unpaid(coffee_system.db, order_id, by=who)
        if od is None:
            return jsonify({'success': False, 'message': 'order not found'}), 404
        _emit_order_updated(order_id, {'paymentStatus': 'unpaid', 'paidMethod': ''})
        return jsonify({'success': True, 'paymentStatus': 'unpaid'})
    except Exception as e:
        logger.error(f"order_mark_unpaid error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/pickup', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def pickup_order(order_id):
    """Mark an order as picked up"""
    try:
        # Log incoming request
        logger.info(f"Received request to mark order as picked up: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if order exists + fetch current status so we can be
        # idempotent: a second /pickup tap on an already-picked-up
        # order shouldn't error, but it also shouldn't re-emit WS or
        # re-update timestamps (which would mask "when was this
        # actually collected" in the audit history).
        cursor = db.cursor()
        # Pull station_id too so we can decrement station_stats.current_load
        # on a successful pickup. Was: orders incremented current_load on
        # confirm but nothing ever decremented it on the way out (the
        # audit found Station 1 reporting current_load=3 after 10+ orders
        # had been processed and picked up). Pickup is the right place
        # for the decrement — that's when the cup leaves the station.
        cursor.execute(
            'SELECT id, status, station_id FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        order_row = cursor.fetchone()

        if not order_row:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})

        if isinstance(order_row, dict):
            current_status = order_row.get('status')
            pickup_station_id = order_row.get('station_id')
        else:
            _, current_status, pickup_station_id = order_row

        # State guards.
        if current_status == 'cancelled':
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} was cancelled.",
                "code": "STATE_TERMINAL",
                "current_status": current_status,
            }), 409
        # Idempotent — already picked up. No DB change, no WS emit.
        if current_status == 'picked_up':
            return jsonify({
                "success": True,
                "message": "Order already picked up",
                "current_status": current_status,
                "noop": True,
            })

        # Get current time
        pickup_at = datetime.now().isoformat()

        # Update order: status → 'picked_up' AND set timestamps.
        # The status change is critical: without it the order stays
        # as status='completed' forever, so the customer Display
        # keeps showing it in "Ready for Pickup" even after the
        # barista taps Collected. (Bug Steve hit on Station 4.)
        try:
            cursor.execute('''
                UPDATE orders
                SET status = 'picked_up',
                    picked_up_at = %s,
                    updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, pickup_at, clean_id))
        except Exception as e:
            # picked_up_at column missing on this DB — best-effort
            # without the timestamp, but still flip the status so the
            # Display knows to drop the order.
            logger.warning(f"picked_up_at column may not exist, using simpler update: {str(e)}")
            try:
                db.rollback()
            except Exception:
                pass
            cursor.execute('''
                UPDATE orders
                SET status = 'picked_up', updated_at = %s
                WHERE order_number = %s
            ''', (pickup_at, clean_id))
        
        db.commit()
        rows_affected = cursor.rowcount
        
        if rows_affected > 0:
            logger.info(f"Successfully marked order as picked up: {clean_id}")

            # Decrement station_stats.current_load.
            # See SELECT comment above for the rationale.
            if pickup_station_id:
                try:
                    cursor.execute("""
                        UPDATE station_stats
                        SET current_load = GREATEST(0, current_load - 1),
                            last_updated = CURRENT_TIMESTAMP
                        WHERE station_id = %s
                    """, (pickup_station_id,))
                    db.commit()
                except Exception as load_err:
                    logger.warning(
                        f"current_load decrement failed (non-fatal) for "
                        f"order {clean_id}, station {pickup_station_id}: {load_err}"
                    )
                    try:
                        db.rollback()
                    except Exception:
                        pass

            _emit_order_status_change(clean_id, 'picked_up')

            # EA Phase-2 write-back: EA-linked orders push a summary line
            # onto the attendee's EventsAir custom field. Daemon thread,
            # gated on the channel + writeback toggles — zero impact when
            # off, and never on the pickup response either way.
            try:
                from routes.ea_survey_routes import maybe_writeback_order
                maybe_writeback_order(current_app._get_current_object(), clean_id)
            except Exception:
                pass

            return jsonify({"success": True, "message": "Order marked as picked up successfully"})
        else:
            logger.error(f"Failed to update order: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} found but could not be updated"})
    
    except Exception as e:
        logger.error(f"Error marking order as picked up {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/orders/batch', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def batch_process_orders():
    """Process a batch of orders"""
    try:
        data = request.json
        order_ids = data.get('order_ids', [])
        action = data.get('action', 'start')
        
        if not order_ids:
            return jsonify({"success": False, "message": "No order IDs provided"})
        
        logger.info(f"Processing {len(order_ids)} orders in batch, action: {action}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Clean all IDs if needed
        clean_ids = [clean_order_id(order_id) for order_id in order_ids]
        logger.info(f"Cleaned order IDs: {clean_ids}")
        
        # Update orders
        cursor = db.cursor()
        current_time = datetime.now().isoformat()
        
        success_count = 0
        for order_id in clean_ids:
            try:
                if action == 'start':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'in-progress', updated_at = %s, started_at = %s
                        WHERE order_number = %s
                    ''', (current_time, current_time, order_id))
                elif action == 'complete':
                    cursor.execute('''
                        UPDATE orders
                        SET status = 'completed', updated_at = %s, completed_at = %s
                        WHERE order_number = %s
                    ''', (current_time, current_time, order_id))
                
                if cursor.rowcount > 0:
                    success_count += 1
                    logger.info(f"Successfully processed order {order_id} in batch")
                else:
                    logger.warning(f"Order {order_id} not found or not updated")
            except Exception as e:
                logger.error(f"Error processing order {order_id}: {str(e)}")
        
        db.commit()
        
        return jsonify({
            "success": True, 
            "processed": success_count,
            "total": len(order_ids)
        })
    
    except Exception as e:
        logger.error(f"Error batch processing orders: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/orders/<order_id>/message', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def send_message(order_id):
    """Send a message to a customer about their order"""
    try:
        # Log incoming request
        logger.info(f"Received request to send message for order: {order_id}")
        
        if not order_id or order_id == 'undefined':
            logger.error(f"Invalid order ID: {order_id}")
            return jsonify({"success": False, "message": "Invalid order ID"})
        
        # Clean the ID if needed
        clean_id = clean_order_id(order_id)
        logger.info(f"Cleaned order ID: {clean_id}")
        
        # Get message content from request
        data = request.json
        message = data.get('message', '')
        
        if not message:
            logger.error("No message content provided")
            return jsonify({"success": False, "message": "No message content provided"})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            return jsonify({"success": False, "message": "Service unavailable"})
        
        # Debug messaging service configuration
        logger.info(f"Messaging service config - Client: {messaging_service.client is not None}")
        logger.info(f"Messaging service config - Testing mode: {messaging_service.testing_mode}")
        logger.info(f"Messaging service config - Phone number: {messaging_service.phone_number}")
        
        # Get order details to send message
        db = coffee_system.db
        cursor = db.cursor()
        cursor.execute('SELECT phone FROM orders WHERE order_number = %s', (clean_id,))
        order = cursor.fetchone()
        
        if not order:
            logger.error(f"Order not found: {clean_id}")
            return jsonify({"success": False, "message": f"Order {clean_id} not found"})
        
        phone_number = order[0]
        
        if not phone_number:
            logger.error(f"No phone number for order: {clean_id}")
            return jsonify({"success": False, "message": f"No phone number for order {clean_id}"})
            
        logger.info(f"Found phone number {phone_number} for order {clean_id}")
        
        # Check if the phone number is the same as the Twilio phone number
        if phone_number == messaging_service.phone_number:
            error_msg = "Cannot send SMS: recipient phone number is the same as the Twilio number"
            logger.error(error_msg)
            return jsonify({
                "success": False,
                "message": error_msg
            })
        
        # Create order_messages table if it doesn't exist
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS order_messages (
                    id SERIAL PRIMARY KEY,
                    order_number VARCHAR(50) NOT NULL,
                    phone VARCHAR(50) NOT NULL,
                    message TEXT NOT NULL,
                    message_sid VARCHAR(100),
                    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            db.commit()
        except Exception as e:
            logger.warning(f"Could not create order_messages table: {str(e)}")
            # Continue anyway
        
        # Send the message using messaging service.
        # dry_run (admin/staff test aid, e.g. the Test Bench journey suite):
        # do everything EXCEPT the real Twilio send, so the reply-routing link
        # can be exercised end-to-end without spending SMS credit / texting a
        # fake number. Mirrors the debug_stock pattern.
        dry_run = bool(data.get('dry_run') or data.get('test_no_send'))
        try:
            if dry_run:
                result = 'DRYRUN'
                logger.info(f"[dry_run] skipping real SMS send for order {clean_id}")
            else:
                result = messaging_service.send_message(phone_number, message, kind='manual')
                logger.info(f"Message sent to {phone_number} for order {clean_id}, result: {result}")
                logger.info(f"Result type: {type(result)}, Result value: {repr(result)}")

            # Check if message sending actually succeeded
            if result is None:
                logger.error("Messaging service returned None - message sending failed")
                return jsonify({
                    "success": False,
                    "message": "Failed to send SMS - messaging service returned no result"
                })
            
            # Log the message in the database
            try:
                cursor.execute("""
                    INSERT INTO order_messages
                    (order_number, phone, message, message_sid)
                    VALUES (%s, %s, %s, %s)
                """, (clean_id, phone_number, message, result))
                db.commit()
                logger.info(f"Saved message to database for order {clean_id}")
            except Exception as db_err:
                logger.warning(f"Could not save message to database: {str(db_err)}")
                # Continue anyway

            # Route the customer's REPLY back to the barista: park the
            # conversation in awaiting_barista_reply (with order + station
            # context) so the next inbound from this phone is forwarded to
            # the barista Messages inbox instead of being parsed as a brand
            # new order ("What's your first name?" after "did you want
            # sugar" — found live 2026-07-16).
            try:
                cursor.execute('SELECT station_id FROM orders WHERE order_number = %s', (clean_id,))
                _row = cursor.fetchone()
                coffee_system._set_conversation_state(phone_number, 'awaiting_barista_reply', {
                    'order_number': clean_id,
                    'station_id': _row[0] if _row else None,
                    'barista_message': message[:200],
                    'sent_at': datetime.now().isoformat(),
                })
                logger.info(f"Parked awaiting_barista_reply for {phone_number} (order {clean_id})")
            except Exception as park_err:
                logger.warning(f"Could not park barista-reply state (non-fatal): {park_err}")
            
            return jsonify({
                "success": True,
                "message": "Message sent successfully" if not dry_run else "Message recorded (dry run — no SMS sent)",
                "message_sid": result,
                "dry_run": dry_run,
            })
        except Exception as e:
            logger.error(f"Error sending message: {str(e)}")
            return jsonify({"success": False, "message": f"Error sending message: {str(e)}"})
    
    except Exception as e:
        logger.error(f"Error sending message for order {order_id}: {str(e)}")
        return jsonify({"success": False, "message": f"Error processing request: {str(e)}"})



@bp.route('/orders/<order_id>/reassign', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def reassign_order(order_id):
    """Move an order to a different station.

    Use case: Station 1 runs out of oat milk / has a machine fault mid-event.
    The barista takes the station offline (status=maintenance) — that stops
    NEW orders from being routed there — but the 3 oat lattes already in
    its queue need to be pushed to Station 2 so the customers don't end up
    forgotten. This endpoint is the "push" half of that handoff.

    Body: {"target_station_id": <int>}

    Refuses to:
      - reassign a completed / picked-up order (it's already done — no
        point re-queueing it)
      - reassign to a station that doesn't exist, or one that isn't
        currently active
      - reassign to a station that can't make the drink (uses the same
        capability check Start uses, so we don't punt an oat order to
        a station that doesn't stock oat)
    """
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400

        clean_id = clean_order_id(order_id)
        payload = request.get_json(silent=True) or {}
        target_raw = payload.get('target_station_id') or payload.get('targetStationId')

        try:
            target_station_id = int(target_raw)
        except (TypeError, ValueError):
            return jsonify({
                "success": False,
                "message": "target_station_id is required (integer)",
            }), 400

        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503

        db = coffee_system.db
        try:
            db.rollback()  # clear any prior aborted txn
        except Exception:
            pass

        cursor = db.cursor()

        # 1. Fetch the order. We need its current status + details for the
        # capability check.
        cursor.execute(
            'SELECT id, status, station_id, order_details '
            'FROM orders WHERE order_number = %s',
            (clean_id,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({
                "success": False,
                "message": f"Order {clean_id} not found",
            }), 404

        order_pk, current_status, current_station_id, order_details_raw = (
            row if not isinstance(row, dict)
            else (row['id'], row['status'], row['station_id'], row['order_details'])
        )

        # 2. Status gate. Completed/picked-up orders are done — no point
        # moving them. Allow both pending and in-progress (in-progress
        # might happen if barista realises mid-pour they're out of milk).
        if current_status in ('completed', 'picked_up'):
            return jsonify({
                "success": False,
                "message": f"Order is already {current_status}; can't reassign.",
            }), 400

        # No-op when already at the target.
        if current_station_id == target_station_id:
            return jsonify({
                "success": True,
                "message": "Order is already at that station.",
                "no_change": True,
            })

        # 3. Validate target station exists + is active.
        cursor.execute(
            "SELECT status FROM station_stats WHERE station_id = %s",
            (target_station_id,),
        )
        target_row = cursor.fetchone()
        if not target_row:
            return jsonify({
                "success": False,
                "message": f"Station {target_station_id} doesn't exist.",
            }), 404
        target_status = target_row[0] if not isinstance(target_row, dict) else target_row.get('status')
        if target_status != 'active':
            return jsonify({
                "success": False,
                "message": (
                    f"Station {target_station_id} is {target_status}, not active. "
                    "Pick a different station."
                ),
            }), 400

        # 4. Capability check — same one /start uses, so we never push
        # an oat order to a station with no oat capability.
        parsed_details = order_details_raw
        if isinstance(parsed_details, str):
            try:
                parsed_details = json.loads(parsed_details)
            except Exception:
                parsed_details = {}
        if not isinstance(parsed_details, dict):
            parsed_details = {}

        cap = _station_can_make_order(db, target_station_id, parsed_details)
        if cap.get('blocked'):
            return jsonify({
                "success": False,
                "message": cap.get('reason') or (
                    f"Station {target_station_id} can't make this drink."
                ),
                "code": "STATION_CAPABILITY_MISMATCH",
            }), 400

        # 5. Do the move.
        cursor.execute(
            'UPDATE orders SET station_id = %s, updated_at = %s '
            'WHERE order_number = %s',
            (target_station_id, datetime.now(), clean_id),
        )
        db.commit()

        logger.info(
            f"Reassigned order {clean_id}: station "
            f"{current_station_id} → {target_station_id}"
        )

        # 6. Tell connected clients so both stations' queues refresh.
        _emit_order_status_change(clean_id, current_status)

        return jsonify({
            "success": True,
            "message": f"Order {clean_id} moved to station {target_station_id}.",
            "data": {
                "order_number": clean_id,
                "from_station_id": current_station_id,
                "to_station_id": target_station_id,
            },
        })

    except Exception as e:
        logger.error(f"reassign_order failed for {order_id}: {e}")
        logger.exception(e)
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({
            "success": False,
            "message": f"Error reassigning order: {e}",
        }), 500



@bp.route('/orders/<order_id>', methods=['PATCH'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def edit_order(order_id):
    """Barista override: edit an order's drink/milk/size/sugar/notes when it
    was taken down wrong. Only pending or in-progress orders can be edited —
    a completed/picked-up/cancelled order is done."""
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400
        clean_id = clean_order_id(order_id)
        payload = request.get_json(silent=True) or {}
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute('SELECT id, status, order_details FROM orders WHERE order_number = %s', (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": f"Order {clean_id} not found"}), 404
        o_id = row[0] if not isinstance(row, dict) else row['id']
        status = row[1] if not isinstance(row, dict) else row['status']
        details_raw = row[2] if not isinstance(row, dict) else row['order_details']
        if status in ('completed', 'picked_up', 'cancelled'):
            return jsonify({"success": False, "message": f"Can't edit a {status} order"}), 400
        details = details_raw
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except Exception:
                details = {}
        if not isinstance(details, dict):
            details = {}
        # Map the various field aliases the frontend may send onto the
        # canonical order_details keys the rest of the pipeline reads.
        field_map = {
            'type': 'type', 'drink': 'type', 'coffee_type': 'type', 'coffeeType': 'type',
            'milk': 'milk', 'milk_type': 'milk', 'milkType': 'milk',
            'size': 'size',
            'sugar': 'sugar',
            'notes': 'notes', 'special_instructions': 'notes', 'specialInstructions': 'notes',
            # The rest of what the walk-in form can set. Editing an order
            # could only ever change drink/milk/size/sugar, so a barista
            # who took "double shot decaf, extra hot" down wrong had to
            # cancel the order and re-enter it. All of these already live
            # in order_details; nothing new is being invented here.
            'shots': 'shots',
            'bean_type': 'bean_type', 'beanType': 'bean_type',
            # NOT 'extra_hot' -> 'extra_hot'. Every reader in the system
            # derives extra hot from order_details['temp'] == 'extra hot'
            # (see the serializers around lines 530 and 1076, and the
            # label renderer). Writing an 'extra_hot' key would save
            # cleanly, report itself as changed, and then read back False
            # everywhere -- which is exactly what it did until this was
            # caught by editing a real order and looking at the result.
            # Handled explicitly below so both shapes stay in step.
            'extra_hot': '_extra_hot', 'extraHot': '_extra_hot',
            'vip': 'vip', 'priority': 'vip',
        }
        changed = {}
        for k, v in payload.items():
            key = field_map.get(k)
            if key and v is not None:
                details[key] = v
                changed[key] = v
        # Phone edits update the orders.phone COLUMN (what SMS sends and
        # the listing serializers read), not order_details. Lets the
        # barista add a number after the fact — "actually, can you text
        # me when it's ready?" — which previously wasn't possible.
        phone_val = None
        for pk in ('phone', 'phone_number', 'phoneNumber'):
            if pk in payload and payload[pk] is not None:
                phone_val = str(payload[pk]).strip()
                break
        if phone_val is not None:
            changed['phone'] = phone_val
        if not changed:
            return jsonify({"success": False, "message": "No editable fields provided"}), 400
        # VIP is TWO facts: the flag on order_details (what the label and
        # the SMS read) and queue_priority (what the queue actually sorts
        # by). Writing only the flag would show the badge while the order
        # stayed exactly where it was -- the badge would be a lie, and the
        # barista would believe it.
        # Translate the edit-form shape onto the canonical one. 'temp' is
        # what every reader looks at; 'extra_hot' is kept alongside it so
        # anything reading that key directly agrees rather than
        # contradicting.
        if '_extra_hot' in changed:
            wants_hot = bool(changed.pop('_extra_hot'))
            details.pop('_extra_hot', None)
            if wants_hot:
                details['temp'] = 'extra hot'
            elif details.get('temp') == 'extra hot':
                details['temp'] = ''
            details['extra_hot'] = wants_hot
            changed['extra_hot'] = wants_hot

        vip_priority = None
        if 'vip' in changed:
            vip_priority = 1 if changed['vip'] else 5

        if phone_val is not None and vip_priority is not None:
            cursor.execute(
                'UPDATE orders SET order_details = %s, phone = %s, '
                'queue_priority = %s, updated_at = %s WHERE id = %s',
                (json.dumps(details), phone_val, vip_priority, datetime.now(), o_id))
        elif phone_val is not None:
            cursor.execute('UPDATE orders SET order_details = %s, phone = %s, updated_at = %s WHERE id = %s',
                           (json.dumps(details), phone_val, datetime.now(), o_id))
        elif vip_priority is not None:
            cursor.execute(
                'UPDATE orders SET order_details = %s, queue_priority = %s, '
                'updated_at = %s WHERE id = %s',
                (json.dumps(details), vip_priority, datetime.now(), o_id))
        else:
            cursor.execute('UPDATE orders SET order_details = %s, updated_at = %s WHERE id = %s',
                           (json.dumps(details), datetime.now(), o_id))
        db.commit()
        return jsonify({"success": True, "message": f"Order {clean_id} updated", "changed": changed})
    except Exception as e:
        logger.error(f"edit_order error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": f"Error editing order: {e}"}), 500



@bp.route('/orders/<order_id>/cancel', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def cancel_order_barista(order_id):
    """Cancel an order from the barista screen (status='cancelled'). Drops it
    from the active queue but keeps the record for reporting/revenue. Refuses
    to cancel an already completed/picked-up order."""
    try:
        if not order_id or order_id == 'undefined':
            return jsonify({"success": False, "message": "Invalid order ID"}), 400
        clean_id = clean_order_id(order_id)
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute('SELECT id, status, station_id, order_details FROM orders WHERE order_number = %s', (clean_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({"success": False, "message": f"Order {clean_id} not found"}), 404
        o_id = row[0] if not isinstance(row, dict) else row['id']
        status = row[1] if not isinstance(row, dict) else row['status']
        station_id = row[2] if not isinstance(row, dict) else row['station_id']
        raw_details = row[3] if not isinstance(row, dict) else row.get('order_details')
        if status in ('completed', 'picked_up'):
            return jsonify({"success": False, "message": f"Order already {status} — can't cancel"}), 400
        if status == 'cancelled':
            return jsonify({"success": True, "message": "Order already cancelled"})

        # Give the ingredients back: a cancelled order was never made, so its
        # milk/coffee/cups/sugar should return to stock — otherwise counters
        # drift low over an event with cancellations (Test Bench "cancel
        # restocks" warn). Idempotent + only fires if the order decremented;
        # non-fatal so a stock hiccup never blocks the cancel itself.
        try:
            details = raw_details
            if isinstance(details, str):
                details = json.loads(details)
            if isinstance(details, dict) and details.get('_stock_decremented') \
                    and not details.get('_stock_restocked'):
                dbtype = 'sqlite' if 'sqlite3' in str(type(db)).lower() else 'postgres'
                coffee_system._restock_for_order(db, dbtype, station_id, details)
                cursor.execute('UPDATE orders SET order_details = %s WHERE id = %s',
                               (json.dumps(details), o_id))
        except Exception as restock_err:
            logger.warning(f"cancel restock skipped (non-fatal): {restock_err}")
            try:
                db.rollback()
            except Exception:
                pass
            cursor = db.cursor()

        cursor.execute('UPDATE orders SET status = %s, updated_at = %s WHERE id = %s',
                       ('cancelled', datetime.now(), o_id))
        if station_id is not None:
            try:
                cursor.execute(
                    "UPDATE station_stats SET current_load = GREATEST(0, current_load - 1), last_updated = %s "
                    "WHERE station_id = %s",
                    (datetime.now(), station_id),
                )
            except Exception:
                pass
        db.commit()
        return jsonify({"success": True, "message": f"Order {clean_id} cancelled"})
    except Exception as e:
        logger.error(f"cancel_order_barista error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": f"Error cancelling order: {e}"}), 500
