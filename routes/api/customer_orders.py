"""What a customer does with their own order: track, ask, reply, cancel, receipt.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import jwt_required_with_demo, role_required_with_demo
from datetime import datetime
from flask import current_app, jsonify, request
from utils.broadcast import BROADCAST_KEY, applies_to as broadcast_applies, is_live as broadcast_is_live
from utils.order_eta import describe as eta_describe, estimate_minutes as eta_estimate_minutes, seconds_per_coffee as eta_seconds_per_coffee
from routes.consolidated_api_routes import (  # noqa: F401
    _beacon_sound_setting,
    _branding_for_label,
    _dispatch_sms_async,
    _drink_display_name,
    _emit_order_status_change,
    _fetch_order_for_label,
    _get_printer_config,
    _kv_get,
    _owner_key_refused,
    _pay_state,
    _pricing_for,
    _track_full_drink,
    bp,
    clean_order_id,
    logger,
)



@bp.route('/orders/<order_id>/customer-cancel', methods=['POST'])
def customer_cancel_order(order_id):
    """The customer cancels their OWN order from the tracking page -- PUBLIC,
    like /track. Only while it is still PENDING (in the queue, not yet being
    made), mirroring the SMS CANCEL rule: once a barista has started it, it
    is too late by phone and they must see a barista."""
    try:
        clean_id = clean_order_id(order_id)
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({"success": False, "message": "Service unavailable"}), 503
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute('SELECT id, status, station_id, order_details FROM orders WHERE order_number = %s', (clean_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({"success": False, "message": "Order not found"}), 404
        o_id, status, station_id, raw_details = (
            (row[0], row[1], row[2], row[3]) if not isinstance(row, dict)
            else (row['id'], row['status'], row['station_id'], row.get('order_details')))
        refused = _owner_key_refused(clean_id, raw_details)
        if refused:
            return refused
        if status == 'cancelled':
            return jsonify({"success": True, "message": "Already cancelled", "cancelled": True})
        if status != 'pending':
            # in-progress / completed / picked_up: too late by phone.
            return jsonify({"success": False, "too_late": True,
                            "message": "Your order is already being made — please see a barista."}), 409
        # Pending: give the ingredients back (idempotent), cancel, free a load slot.
        try:
            details = raw_details
            if isinstance(details, str):
                details = json.loads(details)
            if isinstance(details, dict) and details.get('_stock_decremented') \
                    and not details.get('_stock_restocked'):
                dbtype = 'sqlite' if 'sqlite3' in str(type(db)).lower() else 'postgres'
                coffee_system._restock_for_order(db, dbtype, station_id, details)
                cur.execute('UPDATE orders SET order_details = %s WHERE id = %s',
                            (json.dumps(details), o_id))
        except Exception as restock_err:
            logger.warning(f"customer-cancel restock skipped (non-fatal): {restock_err}")
            try:
                db.rollback()
            except Exception:
                pass
            cur = db.cursor()
        cur.execute('UPDATE orders SET status = %s, updated_at = %s WHERE id = %s',
                    ('cancelled', datetime.now(), o_id))
        if station_id is not None:
            try:
                cur.execute("UPDATE station_stats SET current_load = GREATEST(0, current_load - 1), "
                            "last_updated = %s WHERE station_id = %s", (datetime.now(), station_id))
            except Exception:
                pass
        db.commit()
        try:
            _emit_order_status_change(clean_id, 'cancelled')
        except Exception:
            pass
        return jsonify({"success": True, "cancelled": True,
                        "message": "Your order has been cancelled."})
    except Exception as e:
        logger.error(f"customer_cancel_order error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": "Could not cancel — please see a barista."}), 500



@bp.route('/orders/<order_id>/collected', methods=['POST'])
def mark_collected_public(order_id):
    """The customer says they have their coffee, from their own phone.

    One less press for the barista, on the busiest surface they have.

    Two guards, because this endpoint is public and an order number is
    guessable:

      1. Only an order that is actually READY can be collected. A
         pending or in-progress coffee cannot be marked collected --
         a mis-tap (or a stranger guessing a number) must not be able
         to clear a card the barista still needs on the bench.
      2. Already-collected is a success, not an error. The page may
         retry on a flaky conference wifi, and a second tap should read
         as "yes, done" rather than an alarming failure.

    It returns nothing about the order beyond the outcome, so it cannot
    be used to enumerate other people's coffees.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cur = db.cursor()
        cur.execute("SELECT status, order_details FROM orders WHERE order_number = %s",
                    (clean_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'message': 'not found'}), 404
        status = str((row[0] if not isinstance(row, dict) else row.get('status'))
                     or '').lower()
        refused = _owner_key_refused(
            clean_id, row[1] if not isinstance(row, dict) else row.get('order_details'))
        if refused:
            return refused

        if status in ('picked_up', 'picked-up'):
            return jsonify({'success': True, 'status': 'picked_up',
                            'message': 'Already collected'})

        if status != 'completed':
            # Not ready yet -- nothing to collect.
            return jsonify({
                'success': False, 'status': status,
                'message': "That order isn't ready yet."}), 409

        now = datetime.now()
        cur.execute(
            "UPDATE orders SET status = 'picked_up', updated_at = %s, "
            "picked_up_at = %s WHERE order_number = %s AND status = 'completed'",
            (now, now, clean_id))
        db.commit()
        logger.info(f"Order {clean_id} marked collected by the customer")
        return jsonify({'success': True, 'status': 'picked_up',
                        'message': 'Thanks - enjoy your coffee!'})
    except Exception as e:
        logger.error(f"mark_collected_public error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/track', methods=['GET'])
def track_order_public(order_id):
    """Public status of ONE order, for the phone that placed it.

    This is how a WiFi-only customer gets their 'ready' notification
    with no SMS at all: the ordering page keeps polling this and shows
    'You're #3' -> 'Being made' -> 'READY - collect from Station 1'.

    Deliberately minimal: status, queue position, first name and where
    to collect. No phone number, no other customers' data — an order
    number is guessable, so nothing sensitive may live here."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        clean_id = clean_order_id(order_id)
        cur = db.cursor()
        cur.execute(
            "SELECT status, station_id, order_details, created_at, payment_status, payment_link FROM orders "
            "WHERE order_number = %s", (clean_id,))
        row = cur.fetchone()
        if not row:
            # A lettered round has no order named by its bare base (336 is
            # the round; 336a/b/c are the drinks). Anything that quotes the
            # round number -- the ready SMS says "order #336" -- resolves to
            # the lead drink instead of a dead end.
            try:
                from utils.order_numbering import is_lettered
                if not is_lettered(clean_id):
                    cur.execute(
                        "SELECT status, station_id, order_details, created_at, payment_status, payment_link FROM orders "
                        "WHERE order_number = %s", (f"{clean_id}a",))
                    row = cur.fetchone()
            except Exception:
                row = None
        if not row:
            return jsonify({'success': False, 'message': 'not found'}), 404
        status, station_id, od_raw, created_at, payment_status, payment_link = (
            row if not isinstance(row, dict)
            else (row.get('status'), row.get('station_id'),
                  row.get('order_details'), row.get('created_at'),
                  row.get('payment_status'), row.get('payment_link')))
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
        # Queue position: how many pending orders at this station are older.
        position = None
        if status == 'pending':
            cur.execute(
                "SELECT COUNT(*) FROM orders WHERE status = 'pending' "
                "AND station_id = %s AND created_at <= %s",
                (station_id, created_at))
            r2 = cur.fetchone()
            position = (r2[0] if not isinstance(r2, dict) else list(r2.values())[0]) if r2 else None
        station_name = f"Station {station_id}" if station_id else ''
        station_location = ''
        try:
            c2 = db.cursor()
            c2.execute("SELECT COALESCE(name,''), COALESCE(location,'') "
                       "FROM station_stats WHERE station_id = %s",
                       (station_id,))
            r3 = c2.fetchone()
            if r3:
                nm, loc = ((r3.get('name'), r3.get('location'))
                           if isinstance(r3, dict) else (r3[0], r3[1]))
                if nm:
                    station_name = nm
                station_location = loc or ''
            # The operator's label lives in notes/equipment_notes on this
            # schema (see station_api_routes) -- prefer it when set.
            c2.execute("SELECT COALESCE(notes,''), COALESCE(equipment_notes,'') "
                       "FROM station_stats WHERE station_id = %s", (station_id,))
            r4 = c2.fetchone()
            if r4:
                nm2, loc2 = ((r4.get('notes'), r4.get('equipment_notes'))
                             if isinstance(r4, dict) else (r4[0], r4[1]))
                if nm2:
                    station_name = nm2
                if loc2:
                    station_location = loc2
        except Exception:
            db.rollback()
        first_name = str(od.get('name') or '').split(' ')[0]

        # How long until it is ready. Measured from this station's own
        # recent pace rather than assumed, and discounted for batching --
        # see utils/order_eta.py for why it always rounds up and never
        # counts past zero.
        eta_minutes = None
        gate = None
        try:
            ahead_details, bench = [], 0
            if status == 'pending':
                c3 = db.cursor()
                c3.execute(
                    "SELECT order_details FROM orders WHERE status = 'pending' "
                    "AND station_id = %s AND created_at < %s",
                    (station_id, created_at))
                for r in (c3.fetchall() or []):
                    raw = r[0] if not isinstance(r, dict) else r.get('order_details')
                    try:
                        ahead_details.append(
                            json.loads(raw) if isinstance(raw, str) else (raw or {}))
                    except Exception:
                        ahead_details.append({})
            if status in ('pending', 'in-progress', 'in_progress'):
                c4 = db.cursor()
                c4.execute(
                    "SELECT COUNT(*) FROM orders WHERE status IN "
                    "('in-progress','in_progress') AND station_id = %s", (station_id,))
                r4 = c4.fetchone()
                bench = (r4[0] if not isinstance(r4, dict) else list(r4.values())[0]) or 0
                # Pace: the gaps BETWEEN this station's recent completions,
                # not a count divided by a window. A quiet cart is not a
                # slow one, and the window method cannot tell them apart --
                # see utils/order_eta.seconds_per_coffee.
                c5 = db.cursor()
                c5.execute(
                    "SELECT EXTRACT(EPOCH FROM COALESCE(completed_at, updated_at)) "
                    "FROM orders WHERE station_id = %s "
                    "AND status IN ('completed','picked_up') "
                    "AND COALESCE(completed_at, updated_at) > NOW() - INTERVAL '2 hours' "
                    "ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 40",
                    (station_id,))
                epochs = []
                for r in (c5.fetchall() or []):
                    v = r[0] if not isinstance(r, dict) else list(r.values())[0]
                    if v is not None:
                        epochs.append(float(v))
                pace = eta_seconds_per_coffee(epochs)
                eta_minutes = eta_estimate_minutes(
                    status, ahead_details, bench, pace)
                # Pre-orders: counted from when coffee starts, not from now
                # (utils/order_gate). Uncapped -- the 30th pre-order is
                # honestly "about 10:58", not "20+ min".
                if status == 'pending':
                    from utils import order_gate as _gate
                    from utils.order_eta import effective_coffee_count as _eff
                    from routes.consolidated_api_routes import _event_timezone as _etz
                    _gcfg = _gate.read(_kv_get(db, _gate.ORDER_GATE_KEY, default={}))
                    if _gcfg['closed']:
                        gate = _gate.view(
                            _gcfg, _gate.now_in(_etz()),
                            _gate.minutes_for_position(_eff(ahead_details) + bench, pace))
        except Exception as eta_err:
            # An estimate is a nicety. Never let it take down the status
            # page a waiting customer is actually reading.
            logger.warning(f"ETA calc failed for order {clean_id}: {eta_err}")
            try:
                db.rollback()
            except Exception:
                pass

        # Incident notice, if one is live and this order is affected.
        # Scoped to UNPRINTED orders by default: a printed order is
        # already on a label in a barista's hand and will be made, so
        # sending its customer to re-confirm manufactures a duplicate.
        notice = ''
        try:
            raw_notice = _kv_get(db, BROADCAST_KEY, default=None)
            if broadcast_is_live(raw_notice, datetime.now(),
                                 lambda v: datetime.fromisoformat(str(v))):
                c6 = db.cursor()
                c6.execute(
                    "SELECT 1 FROM print_jobs WHERE order_id = %s "
                    "AND type = 'label' LIMIT 1", (str(clean_id),))
                printed = bool(c6.fetchone())
                if broadcast_applies(raw_notice, printed):
                    notice = str(raw_notice.get('message') or '')
        except Exception as notice_err:
            # A broken notice must never take down the page a waiting
            # customer is reading.
            logger.warning(f"broadcast check failed for {clean_id}: {notice_err}")
            try:
                db.rollback()
            except Exception:
                pass

        # What the customer owes, if anything, and how the operator wants
        # it paid (services/payments.py). The link is Square's page when
        # the event has one; the beacon shows "Pay $4.50" either way.
        _pricing_t = _pricing_for(current_app.config.get('coffee_system').db)
        _pay_t = _pay_state(payment_status, od, _pricing_t)
        return jsonify({
            'success': True,
            'order_number': clean_id,
            'status': status,
            'position': position,
            'gate': gate,
            'price': (od.get('price_formatted') or (f"${float(od.get('price')):.2f}" if od.get('price') not in (None, '') else '')) if isinstance(od, dict) else '',
            'payment_status': _pay_t,
            'payment_mode': (_pricing_t.get('mode') or 'honour') if _pricing_t.get('enabled') else 'honour',
            'payment_link': (payment_link or '') if _pay_t == 'unpaid' else '',
            'beacon_sound': _beacon_sound_setting(),
            'notice': notice,
            'eta_minutes': eta_minutes,
            'eta_text': eta_describe(eta_minutes),
            'first_name': first_name,
            'drink': _drink_display_name(od, default='Coffee'),
            # THE WHOLE ORDER, not just the drink name.
            #
            # Steve, tracking his own from the kiosk QR: "the qr code on
            # screen only showed hot chockolate so your not confident
            # that the whole order was recieved". He had asked for a
            # medium with almond milk; the page said "hot chocolate" and
            # nothing else, so there was no way to tell whether the rest
            # of it had landed.
            #
            # This is what the printed label already says, in the same
            # order, so the screen and the sticker agree.
            'drink_full': _track_full_drink(od),
            'station_name': station_name,
            'station_location': station_location,
            'collection_note': od.get('collection_note') or '',
            # A barista's question for THIS customer, shown until they
            # answer it (Steve: "we have just run out of oat is almond
            # ok?"). Cleared from view once _customer_reply lands.
            'barista_ask': (od.get('_barista_ask')
                            if isinstance(od, dict) and not od.get('_customer_reply')
                            else None),
            # The customer's answer, so the barista's card can show it
            # without depending on which /orders serializer wins the
            # route (there are two, one shadows the other).
            'customer_reply': (od.get('_customer_reply') if isinstance(od, dict) else None),
        })
    except Exception as e:
        logger.error(f"track_order_public error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/orders/<order_id>/ask', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def ask_customer(order_id):
    """Barista -> ONE customer, tied to this order. Answerable from the
    tracking page, and SMS-notified when a number exists. Steve's
    scenario: 'we have just run out of oat is almond ok?'"""
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    clean_id = clean_order_id(order_id)
    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or '').strip()
    if not message:
        return jsonify({'success': False, 'message': 'message required'}), 400
    options = [str(o).strip() for o in (body.get('options') or []) if str(o).strip()][:5]
    ask = {'message': message[:280], 'options': options,
           'at': datetime.now().isoformat()}
    cur = db.cursor()
    # A new question supersedes any prior reply.
    cur.execute(
        "UPDATE orders SET order_details = "
        "(COALESCE(order_details::jsonb, '{}'::jsonb) - '_customer_reply') || %s::jsonb "
        "WHERE order_number = %s",
        (json.dumps({'_barista_ask': ask}), clean_id))
    if cur.rowcount == 0:
        db.rollback()
        return jsonify({'success': False, 'message': 'order not found'}), 404
    db.commit()
    # SMS notify if there's a real, non-bench number. Async + bench-guarded,
    # so a slow carrier never blocks the barista.
    sms_sent = False
    try:
        cur.execute("SELECT phone, station_id FROM orders WHERE order_number = %s", (clean_id,))
        r = cur.fetchone()
        if isinstance(r, dict):
            phone = r.get('phone'); station_id = r.get('station_id')
        elif r:
            phone = r[0]; station_id = r[1] if len(r) > 1 else None
        else:
            phone = ''; station_id = None
        phone = str(phone or '').strip()
        if phone and not phone.lower().startswith(('walk', 'none')):
            # No "Answer here: <link>" tail — someone getting an SMS knows to
            # just reply, and the reply now routes to the barista (Steve).
            opt = (' Reply: ' + ' / '.join(options)) if options else ''
            sms_body = f"Coffee #{clean_id}: {message}{opt}"
            messaging_service = current_app.config.get('messaging_service')
            if messaging_service:
                _dispatch_sms_async(messaging_service, phone, sms_body, clean_id)
                sms_sent = True
            # Park the conversation so the customer's SMS REPLY routes BACK to
            # the barista (updates this order's _customer_reply + the Messages
            # inbox) instead of being parsed as a brand-new order. Without this
            # a reply to "run out of full cream, is skim ok?" fell into the
            # order bot and answered "Welcome back, Bart!" — the barista never
            # saw it (Steve, live test 2026-09-01). Mirrors the older
            # message path in this file.
            try:
                coffee_system._set_conversation_state(phone, 'awaiting_barista_reply', {
                    'order_number': clean_id,
                    'station_id': station_id,
                    'barista_message': message[:200],
                    'sent_at': datetime.now().isoformat(),
                })
            except Exception as park_err:
                logger.warning(f"ask-customer: could not park reply state (non-fatal): {park_err}")
    except Exception as e:
        logger.warning(f"ask-customer SMS skipped (non-fatal): {e}")
    return jsonify({'success': True, 'sms_sent': sms_sent})



@bp.route('/orders/<order_id>/ack', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def ack_customer(order_id):
    """Barista quick acknowledgement to the customer — a one-way 'got it'
    so they know their reply landed (Steve: 'a thumbs up, that's fine').
    Unlike /ask it does NOT change the order's question/reply state, so the
    answer stays on the card. Plain ASCII (SMS-segment cost)."""
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    clean_id = clean_order_id(order_id)
    body = request.get_json(silent=True) or {}
    message = str(body.get('message') or 'Got it - making your coffee now.').strip()[:160]
    sms_sent = False
    try:
        cur = db.cursor()
        cur.execute("SELECT phone FROM orders WHERE order_number = %s", (clean_id,))
        r = cur.fetchone()
        phone = (r[0] if not isinstance(r, dict) else r.get('phone')) if r else ''
        phone = str(phone or '').strip()
        if phone and not phone.lower().startswith(('walk', 'none')):
            messaging_service = current_app.config.get('messaging_service')
            if messaging_service:
                _dispatch_sms_async(messaging_service, phone, f"Coffee #{clean_id}: {message}", clean_id)
                sms_sent = True
    except Exception as e:
        logger.warning(f"ack-customer SMS skipped (non-fatal): {e}")
    return jsonify({'success': True, 'sms_sent': sms_sent})



@bp.route('/orders/<order_id>/reply', methods=['POST'])
def customer_reply_to_barista(order_id):
    """Customer -> barista: answer the barista's question from the tracking
    page. PUBLIC, like /track (the tracking page carries no auth)."""
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    clean_id = clean_order_id(order_id)
    body = request.get_json(silent=True) or {}
    reply = str(body.get('reply') or '').strip()[:280]
    if not reply:
        return jsonify({'success': False, 'message': 'reply required'}), 400
    cur = db.cursor()
    # Only while the barista has asked something and the order is still
    # live. Public, so without this anyone could write 280 characters onto
    # any order's barista card by guessing its number (public-endpoint
    # probe, 12 Oct 2026).
    cur.execute(
        "UPDATE orders SET order_details = "
        "COALESCE(order_details::jsonb, '{}'::jsonb) || %s::jsonb "
        "WHERE order_number = %s AND COALESCE(order_details::jsonb, '{}'::jsonb) ? '_barista_ask' "
        "AND status IN ('pending', 'in-progress', 'in_progress', 'completed')",
        (json.dumps({'_customer_reply': {'text': reply,
                                         'at': datetime.now().isoformat()}}), clean_id))
    if cur.rowcount == 0:
        db.rollback()
        return jsonify({'success': False, 'message': 'No question to answer on that order.'}), 404
    db.commit()
    return jsonify({'success': True})



@bp.route('/orders/<order_number>/receipt', methods=['GET'])
def order_receipt(order_number):
    """Customer-facing branded receipt for a single order.

    Public (no JWT): the customer reaches this from a link in their
    "order ready" SMS, so it can't require a login. Order numbers are
    short, human-friendly ('C42') — so to stop trivial enumeration we
    require the order to be in a *terminal-ish* state (in-progress,
    completed, or picked up). A pending order's receipt is meaningless
    anyway. No PII beyond the customer's own first name + drink (which
    they already know); phone is NOT shown.

    Pure HTML, browser → Save-as-PDF, no PDF lib — same approach as the
    event summary. Renders the event branding, order details, total
    (if pricing is on), and a pickup QR via the existing track route.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT order_number, order_details, status, station_id,
                   created_at, completed_at, price, for_friend
              FROM orders
             WHERE order_number = %s
             LIMIT 1
        """, (order_number,))
        row = cur.fetchone()
        if not row:
            return ('<h1>Receipt not found</h1>'
                    '<p>We could not find that order.</p>'), 404
        if isinstance(row, dict):
            od = row['order_details'] or {}
            status = row['status']
            station_id = row['station_id']
            created_at = row['created_at']
            completed_at = row['completed_at']
            price = row['price']
            for_friend = row['for_friend']
        else:
            od = row[1] or {}
            status = row[2]
            station_id = row[3]
            created_at = row[4]
            completed_at = row[5]
            price = row[6]
            for_friend = row[7]

        # Guard against pending-order / enumeration peeking.
        if status not in ('in-progress', 'in_progress', 'completed', 'picked_up'):
            return ('<h1>Receipt not ready</h1>'
                    '<p>This receipt becomes available once your order is '
                    'being prepared.</p>'), 403

        # od is JSONB → already a dict on most cursors; tolerate str.
        if isinstance(od, str):
            try:
                od = json.loads(od)
            except Exception:
                od = {}

        # Branding.
        try:
            branding = _kv_get(db, 'branding_settings', default={}) or {}
            event_name = (branding.get('event_name')
                          or branding.get('eventName')
                          or _kv_get(db, 'event_name', default='CupQ')
                          or 'CupQ')
            logo = branding.get('logo') or branding.get('clientLogo') or ''
        except Exception:
            event_name = 'CupQ'
            logo = ''

        # Build a human drink description from order_details.
        name = od.get('name') or od.get('customer_name') or 'Customer'
        drink = od.get('type') or od.get('coffee_type') or 'Coffee'
        size = od.get('size') or ''
        milk = od.get('milk') or od.get('milk_type') or ''
        sugar = od.get('sugar') or ''
        strength = od.get('strength') or ''
        desc_bits = [b for b in [size, drink] if b]
        drink_desc = ' '.join(desc_bits)
        extras = []
        if milk and milk not in ('no milk', 'standard', 'none', 'None'):
            extras.append(f"{milk} milk")
        if strength:
            extras.append(str(strength))
        if sugar and sugar not in ('no sugar', 'none', 'None', '0'):
            extras.append(str(sugar))
        extras_str = (', '.join(extras)) if extras else ''

        # Pricing — only show a total if pricing is enabled AND this
        # order has a non-zero stamped price.
        symbol = '$'
        try:
            pricing_blob = _kv_get(db, 'pricing_settings', default={}) or {}
            symbol = pricing_blob.get('symbol', '$')
        except Exception:
            pass
        try:
            price_val = float(price) if price is not None else 0.0
        except (TypeError, ValueError):
            price_val = 0.0
        from html import escape as _esc
        symbol = _esc(str(symbol))
        price_html = (
            f'<div class="row"><span>Total</span>'
            f'<strong>{symbol}{price_val:.2f}</strong></div>'
            if price_val > 0 else ''
        )

        # Pickup QR — link to the existing track page for this order.
        # The track route resolves /track/<code>; we use the order
        # number as the code so the QR is self-contained.
        host = request.host_url.rstrip('/')
        track_url = f"{host}/track/{order_number}"
        # Reuse MessagingService.generate_qr_code (base64 data URI).
        qr_data_uri = ''
        try:
            from services.messaging import MessagingService
            qr_data_uri = MessagingService.generate_qr_code(track_url, size=6) or ''
        except Exception as e:
            logger.warning(f"receipt QR generation failed: {e}")

        when = ''
        try:
            stamp = completed_at or created_at
            if stamp:
                when = stamp.strftime('%-d %b %Y, %-I:%M %p')
        except Exception:
            pass

        # Everything below goes into HTML, and name, for_friend and the
        # options are free text from a public kiosk or phone: escape it all
        # (31 Oct 2026 audit, SEC-006: a crafted name ran script for staff).
        event_name = _esc(str(event_name))
        order_number = _esc(str(order_number))
        name = _esc(str(name))
        drink_desc = _esc(drink_desc)
        extras_str = _esc(extras_str)
        for_friend = _esc(str(for_friend)) if for_friend else for_friend
        station_id = _esc(str(station_id))
        logo = _esc(str(logo)) if str(logo).startswith(('data:image/', 'https://', '/')) else ''
        logo_html = (f'<img src="{logo}" alt="" style="max-height:54px;margin-bottom:8px"/>'
                     if logo else '')
        qr_html = (f'<img src="{qr_data_uri}" alt="Pickup QR" '
                   f'style="width:140px;height:140px"/>' if qr_data_uri else '')
        friend_html = (f'<div class="row"><span>For</span><span>{for_friend}</span></div>'
                       if for_friend else '')
        extras_html = (f'<div class="row"><span>Options</span><span>{extras_str}</span></div>'
                       if extras_str else '')

        html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{event_name} — Receipt #{order_number}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          max-width: 420px; margin: 24px auto; padding: 0 20px; color: #1a1a1a; }}
  .card {{ border: 1px solid #e5e5e5; border-radius: 12px; padding: 24px; }}
  .head {{ text-align: center; margin-bottom: 16px; }}
  .head h1 {{ font-size: 18px; margin: 4px 0; }}
  .ordernum {{ font-size: 34px; font-weight: 800; letter-spacing: 1px; margin: 8px 0; }}
  .drink {{ font-size: 20px; font-weight: 600; text-align: center; margin: 6px 0 4px; }}
  .row {{ display: flex; justify-content: space-between; padding: 8px 0;
          border-bottom: 1px solid #f0f0f0; font-size: 14px; }}
  .row span:first-child {{ color: #777; }}
  .qr {{ text-align: center; margin-top: 18px; }}
  .foot {{ text-align: center; color: #999; font-size: 12px; margin-top: 16px; }}
  .badge {{ display:inline-block; background:#eafaf0; color:#1a7f4b; border-radius:20px;
            padding:3px 12px; font-size:12px; font-weight:600; }}
  @media print {{ body {{ margin: 0; }} .no-print {{ display:none; }} }}
</style>
</head>
<body>
  <div class="no-print" style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:8px 10px;margin-bottom:14px;font-size:12px;text-align:center;">
    Save this receipt: tap Share → Print → Save as PDF.
  </div>
  <div class="card">
    <div class="head">
      {logo_html}
      <h1>{event_name}</h1>
      <div class="badge">{'Ready for pickup' if status in ('completed','picked_up') else 'Being prepared'}</div>
      <div class="ordernum">#{order_number}</div>
    </div>
    <div class="drink">{drink_desc}</div>
    <div style="margin-top:14px;">
      <div class="row"><span>Name</span><span>{name}</span></div>
      {friend_html}
      {extras_html}
      <div class="row"><span>Station</span><span>#{station_id}</span></div>
      <div class="row"><span>Time</span><span>{when}</span></div>
      {price_html}
    </div>
    <div class="qr">
      {qr_html}
      <div style="font-size:11px;color:#999;margin-top:4px">Scan to track your order</div>
    </div>
  </div>
  <div class="foot">Thank you — enjoy your coffee ☕</div>
</body>
</html>"""
        from flask import Response
        return Response(html, mimetype='text/html')
    except Exception as e:
        logger.error(f"order_receipt error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return f'<h1>Receipt error</h1><pre>{e}</pre>', 500



@bp.route('/orders/<order_number>/label.png', methods=['GET'])
@jwt_required_with_demo()
def order_label_png(order_number):
    """Render the order label as a PNG.

    This is the supported, hardware-free path: open this in a browser
    and Cmd+P to AirPrint to a Brother QL-820NWB (or any AirPrint label
    printer). Also used by the auto-print path to build the bytes.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        order = _fetch_order_for_label(db, order_number)
        if not order:
            return ('order not found', 404)
        branding = _branding_for_label(db)
        host = request.host_url.rstrip('/')
        qr_url = f"{host}/track/{order_number}"
        from services.label_printer import render_label_png
        png = render_label_png(order, branding, qr_url=qr_url)
        from flask import Response
        return Response(png, mimetype='image/png')
    except Exception as e:
        logger.error(f"order_label_png error: {e}")
        return (f'label error: {e}', 500)



@bp.route('/orders/<order_number>/print-label', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def print_order_label(order_number):
    """Send the order label to the station's configured network printer.

    Body (optional): {"station_id": N} to override which station's
    printer config to use (defaults to the order's station).

    Failure mode: printer offline / unconfigured → returns success:false
    with a message, never blocks. The barista UI shows a toast and the
    order proceeds regardless.

    NOTE: the raw-socket transport is hardware-pending (see
    services/label_printer.py). Until validated against the real
    printer, the reliable path is GET .../label.png → AirPrint.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        order = _fetch_order_for_label(db, order_number)
        if not order:
            return jsonify({'success': False, 'error': 'order not found'}), 404

        body = request.get_json(silent=True) or {}
        station_id = body.get('station_id') or order.get('station_id')
        pcfg = _get_printer_config(db, station_id)
        if not pcfg or not pcfg.get('enabled'):
            return jsonify({
                'success': False,
                'printed': False,
                'message': f'No printer configured/enabled for station {station_id}. '
                           f'Use the label.png AirPrint path, or set a printer in Station Settings.',
                'label_url': f'/api/orders/{order_number}/label.png',
            })
        ip = pcfg.get('ip')
        port = int(pcfg.get('port') or 9100)

        branding = _branding_for_label(db)
        host = request.host_url.rstrip('/')
        from services.label_printer import render_label_png, send_png_to_printer
        png = render_label_png(order, branding, qr_url=f"{host}/track/{order_number}")
        ok, detail = send_png_to_printer(ip, port, png)
        return jsonify({
            'success': ok,
            'printed': ok,
            'message': detail,
            'label_url': f'/api/orders/{order_number}/label.png',
            'transport_note': 'raw-socket transport is hardware-pending; '
                              'if the label is blank/garbled use the label.png AirPrint path',
        })
    except Exception as e:
        logger.error(f"print_order_label error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
