"""Event reports.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import MANAGER_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import datetime
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from utils import event_time as _event_time
from utils.order_provenance import CHANNELS, SELF_SERVE, SURFACES, channel_label, infer_channel, infer_surface, is_estimated as provenance_estimated, surface_label
from routes.consolidated_api_routes import (  # noqa: F401
    _event_timezone,
    _kv_get,
    _kv_put,
    _pricing_for,
    _report_window,
    _today_bounds,
    bp,
    logger,
)


# ---------------------------------------------------------------------------
# Per-event reporting
# ---------------------------------------------------------------------------
# Operators kept asking "how many orders have we done today?", "what's our
# revenue?", "which station is busiest?" — there was no answer surface, so
# the data sat unused in `orders`. /api/reports/today rolls it all up so
# the Support tab Reports panel can render today's metrics live.
@bp.route('/reports/cup-reconciliation', methods=['GET', 'PUT'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def cup_reconciliation():
    """The venue counts cups; we count orders. This is where the two
    tallies meet (venue config doc section 4).

    The Wine Centre counts physical cups at start and end of day, per
    station -- they do NOT tally orders. Our order count is an
    independent number that WILL differ (staff coffees, remakes,
    spills), and reporting credibility means showing the variance and
    owning it, not hiding it.

    PUT  {"station_id": 1, "start": 500, "end": 213}  (either count
         may arrive alone -- start gets typed in the morning, end at
         pack-down)
    GET  -> per-station: the venue's start/end/used, our completed-
         order count for today, and the variance, plus event totals.

    One source, every surface: the Organiser card and the post-event
    report both read THIS.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        if request.method == 'PUT':
            data = request.get_json() or {}
            try:
                sid = str(int(data.get('station_id')))
            except (TypeError, ValueError):
                return jsonify({'success': False,
                                'message': 'station_id required'}), 400
            counts = _kv_get(db, 'cup_counts', default={}) or {}
            row = counts.get(sid, {})
            for field in ('start', 'end'):
                if field not in data:
                    continue
                if data.get(field) is None:
                    # Explicit null CLEARS a mistyped count. Without this,
                    # a fat-fingered morning entry was permanent and the
                    # reconciliation carried it into the client report.
                    row.pop(field, None)
                    continue
                try:
                    row[field] = int(data[field])
                except (TypeError, ValueError):
                    return jsonify({'success': False,
                                    'message': f'{field} must be a whole number'}), 400
            try:
                row['updated_by'] = str(get_jwt_identity() or '')
            except Exception:
                pass
            row['updated_at'] = datetime.now().isoformat()
            counts[sid] = row
            _kv_put(db, 'cup_counts', counts)

        from utils.station_label import station_label
        counts = _kv_get(db, 'cup_counts', default={}) or {}
        cur = db.cursor()
        # Our tally: today's completed/picked-up orders per station.
        # Walk-ins and kiosk orders are orders like any other, so the
        # main drift sources the venue doc names are already inside.
        # "Today" is the event's day: CURRENT_DATE (UTC) started it at
        # 09:30 Adelaide and the morning's cups went missing (finding 3).
        _t0, _t1 = _today_bounds()
        cur.execute(
            """
            SELECT station_id, COUNT(*) FROM orders
            WHERE status IN ('completed', 'picked_up')
              AND created_at >= %s AND created_at < %s
            GROUP BY station_id
            """, (_t0, _t1)
        )
        system_by_station = {}
        for r in cur.fetchall():
            sid, n = (r[0], r[1]) if not isinstance(r, dict) else (r['station_id'], r['count'])
            system_by_station[str(sid if sid is not None else 'unassigned')] = int(n)

        stations = sorted(set(list(counts.keys()) + list(system_by_station.keys())))
        rows, totals = [], {'venue_used': 0, 'system_orders': 0}
        for sid in stations:
            c = counts.get(sid, {})
            start, end = c.get('start'), c.get('end')
            venue_used = (start - end) if (
                isinstance(start, int) and isinstance(end, int)) else None
            system = system_by_station.get(sid, 0)
            variance = (venue_used - system) if venue_used is not None else None
            if venue_used:
                totals['venue_used'] += venue_used
            totals['system_orders'] += system
            rows.append({
                'station_id': sid,
                'start': start, 'end': end,
                'venue_used': venue_used,
                'system_orders': system,
                'variance': variance,
                'station_name': station_label(db, sid) if str(sid).isdigit() else sid,
                'updated_by': c.get('updated_by'),
                'updated_at': c.get('updated_at'),
            })
        totals['variance'] = (totals['venue_used'] - totals['system_orders']
                              if totals['venue_used'] else None)
        return jsonify({'success': True, 'stations': rows, 'totals': totals})
    except Exception as e:
        logger.error(f"cup_reconciliation error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/reports/days', methods=['GET'])
@role_required_with_demo(['admin', 'staff'])
def report_days():
    """Which days have orders, newest first, with the count on each.

    Deliberately NOT grouped into "events". I tried: chain consecutive days
    into one run. On real data it swallowed a 2-day event into a 14-day block,
    because a handful of test orders on the quiet days in between bridged every
    gap. There is no honest way to tell a 6-order test afternoon from a small
    event, so the report does not pretend to -- it shows the days and their
    volumes, and the person who was there picks. 314 orders on the 3rd is
    obvious to a human and unguessable to a heuristic.
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
            SELECT (created_at AT TIME ZONE 'UTC'
                    AT TIME ZONE %(tz)s)::date AS d, COUNT(*) AS n
            FROM orders
            GROUP BY 1
            ORDER BY 1 DESC
            LIMIT 120
        """, {'tz': _event_timezone()})
        days = [{'date': r[0].isoformat(), 'orders': int(r[1])}
                for r in cur.fetchall()]
        cur.close()
        return jsonify({'success': True, 'days': days})
    except Exception as e:
        logger.error(f"report_days error: {e}")
        return jsonify({'success': False, 'error': str(e), 'days': []}), 500



@bp.route('/reports/today', methods=['GET'])
@jwt_required_with_demo()
def get_today_report():
    """Return today's event metrics:
      - total orders + breakdown by status
      - average wait time (created → completed) in minutes
      - total revenue (if pricing is enabled and orders have a price stamp)
      - per-station breakdown
      - top 5 drinks by order count
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()

        # WHICH DAY. The whole report used to say CURRENT_DATE in sixteen
        # places, so it could only ever describe today. Steve's Treenet event
        # ran on the 3rd and 4th; asking for its report on the 5th returned a
        # page of zeros, and the only way to see the event you had just run
        # was to have run it today. A report you cannot open after the event
        # is not a report.
        #
        # ?date=YYYY-MM-DD for one day, or ?from=&?to= for a whole event
        # (inclusive of both ends). No arguments still means today, so every
        # existing caller keeps working untouched.
        d0, d1, window_label, tzname = _report_window()
        W = {'d0': d0, 'd1': d1, 'tz': tzname}

        def _ex(sql, extra=None):
            """Every query in this report is bound to the same window."""
            cur.execute(sql, {**W, **(extra or {})})

        # Status breakdown for today
        _ex("""
            SELECT status, COUNT(*) AS n
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
            GROUP BY status
        """)
        status_counts = {row[0]: int(row[1]) for row in cur.fetchall()}
        total = sum(status_counts.values())

        # Average wait (created → completed) for completed/picked_up orders today
        _ex("""
            SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0)
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
              AND completed_at IS NOT NULL
              AND created_at IS NOT NULL
        """)
        row = cur.fetchone()
        avg_wait_min = float(row[0]) if row and row[0] is not None else None

        # Revenue from stamped prices (works when pricing was enabled
        # when the order was confirmed — see ARCHITECTURE.md §11).
        _ex("""
            SELECT COALESCE(SUM((order_details->>'price')::numeric), 0)
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
              AND order_details ? 'price'
        """)
        row = cur.fetchone()
        revenue_total = float(row[0]) if row and row[0] is not None else 0.0

        # Per-station breakdown. `done` + the active time span give a MEASURED
        # orders/hour — the real throughput, which the team can use as the
        # baseline ("expected throughput") for the next event.
        _ex("""
            SELECT station_id, COUNT(*) AS n,
                   AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) / 60.0)
                     FILTER (WHERE completed_at IS NOT NULL) AS avg_min,
                   COUNT(*) FILTER (WHERE status IN ('completed', 'picked_up')) AS done,
                   EXTRACT(EPOCH FROM (MAX(updated_at) - MIN(created_at))) / 3600.0 AS span_hours
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
            GROUP BY station_id
            ORDER BY station_id
        """)
        per_station = []
        for row in cur.fetchall():
            sid, n, avg_min, done, span_hours = row
            # orders/hour = completed ÷ active span (floored at 30 min so a
            # couple of orders in the first minutes don't read as "200/hour").
            oph = None
            if done and span_hours is not None:
                oph = round(int(done) / max(0.5, float(span_hours)), 1)
            per_station.append({
                'station_id': sid,
                'orders': int(n),
                'avg_wait_min': round(float(avg_min), 1) if avg_min is not None else None,
                'completed': int(done or 0),
                'orders_per_hour': oph,
            })

        # Top 5 drinks today
        _ex("""
            SELECT LOWER(order_details->>'type') AS drink, COUNT(*) AS n
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
              AND order_details ? 'type'
            GROUP BY drink
            ORDER BY n DESC
            LIMIT 5
        """)
        top_drinks = [{'drink': r[0], 'orders': int(r[1])} for r in cur.fetchall()]

        # Milk breakdown. The reason it exists: CTN26 stocked coconut and
        # not one order used it, while 41% of the event was some other
        # alternative milk. That is a stocking decision worth thousands
        # over a season, and nobody could see it without exporting rows.
        #
        # Normalised in SQL the same way the reporting code does it --
        # lower-cased with a trailing " milk" stripped -- because the
        # database genuinely holds both "Oat Milk" and "oat" for the same
        # drink and counting them apart understates every alternative.
        _ex("""
            SELECT COALESCE(NULLIF(regexp_replace(
                       lower(trim(order_details->>'milk')), '\\s*milk$', ''), ''),
                   'no milk') AS m,
                   COUNT(*) AS n
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
            GROUP BY m
            ORDER BY n DESC
        """)
        milk_rows = [{'milk': r[0], 'orders': int(r[1])} for r in cur.fetchall()]
        _ALT = {'skim', 'oat', 'soy', 'almond', 'lactose free', 'coconut',
                'macadamia', 'rice', 'a2'}
        milk_breakdown = {
            'by_milk': milk_rows,
            'dairy': sum(r['orders'] for r in milk_rows
                         if r['milk'] in ('full cream', 'whole', 'regular', 'dairy')),
            'alternative': sum(r['orders'] for r in milk_rows if r['milk'] in _ALT),
            'none': sum(r['orders'] for r in milk_rows
                        if r['milk'] in ('no milk', 'none', '')),
        }
        # Milks the event is carrying that nobody ordered today. The
        # actionable half of the breakdown -- what to stop buying.
        unused_milks = []
        try:
            ev = _kv_get(db, 'event_inventory', default={}) or {}
            stocked = ev.get('milk') if isinstance(ev, dict) else None
            if isinstance(stocked, list):
                ordered = {r['milk'] for r in milk_rows}
                for item in stocked:
                    nm = item.get('name') if isinstance(item, dict) else item
                    key = str(nm or '').strip().lower()
                    key = key[:-5].strip() if key.endswith(' milk') else key
                    if key and key not in ordered:
                        unused_milks.append(nm)
        except Exception as _um_err:
            logger.debug(f"unused milk calc skipped: {_um_err}")

        # Peak hour — which hour of the day had the most orders. The
        # post-event summary leans on this ("you handled 47 orders in
        # the 10am hour"), and it's a one-liner aggregate.
        _ex("""
            SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'UTC'
                                      AT TIME ZONE %(tz)s))::int AS hour, COUNT(*) AS n
            FROM orders
            WHERE created_at >= %(d0)s AND created_at < %(d1)s
            GROUP BY hour
            ORDER BY n DESC
            LIMIT 1
        """)
        peak_row = cur.fetchone()
        peak_hour = None
        if peak_row:
            peak_hour = {
                'hour': int(peak_row[0]) if peak_row[0] is not None else None,
                'orders': int(peak_row[1]),
            }

        # Busiest station — most orders today. Convenience field so the
        # printable doesn't have to sort per_station to find it.
        busiest_station_id = None
        if per_station:
            busiest = max(per_station, key=lambda ps: ps['orders'])
            busiest_station_id = busiest['station_id']

        # Pricing currency (for nicer formatting client-side)
        currency_symbol = '$'
        try:
            pricing_blob = _kv_get(coffee_system.db, 'pricing_settings', default={}) or {}
            currency_symbol = pricing_blob.get('symbol', '$')
        except Exception:
            pass

        # --- SMS side -------------------------------------------------------
        # Outbound = order_messages (confirmation/ready/reminder texts, logged
        # with a Twilio SID when accepted). Inbound = sms_messages (customer
        # texts received). Each query is defensive so a missing table or SQLite
        # fallback never breaks the whole report.
        sms = {'outbound': 0, 'outbound_with_provider_id': 0,
               'inbound': 0, 'inbound_unanswered': 0, 'est_segments': 0}
        try:
            _ex("SELECT COUNT(*), COUNT(message_sid) FROM order_messages "
                        "WHERE sent_at >= %(d0)s AND sent_at < %(d1)s")
            r = cur.fetchone()
            if r:
                sms['outbound'] = int(r[0] or 0)
                sms['outbound_with_provider_id'] = int(r[1] or 0)
            _ex("SELECT COALESCE(SUM(CEIL(GREATEST(LENGTH(message),1)/160.0)),0) "
                        "FROM order_messages WHERE sent_at >= %(d0)s AND sent_at < %(d1)s")
            r = cur.fetchone()
            sms['est_segments'] = int(r[0]) if r and r[0] is not None else sms['outbound']
        except Exception as _e:
            logger.warning(f"report: outbound SMS query failed: {_e}")
            try: db.rollback()
            except Exception: pass
        try:
            _ex("SELECT COUNT(*), "
                        "COUNT(*) FILTER (WHERE response_sent IS NULL OR response_sent = '') "
                        "FROM sms_messages WHERE received_at >= %(d0)s AND received_at < %(d1)s")
            r = cur.fetchone()
            if r:
                sms['inbound'] = int(r[0] or 0)
                sms['inbound_unanswered'] = int(r[1] or 0)
        except Exception as _e:
            logger.warning(f"report: inbound SMS query failed: {_e}")
            try: db.rollback()
            except Exception: pass

        # --- UI / client errors --------------------------------------------
        errors = {'count': 0, 'recent': []}
        try:
            # The column is occurred_at (migration 11), not created_at, so
            # both queries threw, were swallowed, and the report always said
            # ZERO user-facing errors.
            _ex("SELECT COUNT(*) FROM client_errors WHERE occurred_at >= %(d0)s AND occurred_at < %(d1)s")
            r = cur.fetchone()
            errors['count'] = int(r[0]) if r and r[0] is not None else 0
            _ex("SELECT message, COUNT(*) AS n FROM client_errors "
                        "WHERE occurred_at >= %(d0)s AND occurred_at < %(d1)s "
                        "GROUP BY message ORDER BY n DESC LIMIT 5")
            errors['recent'] = [{'message': (row[0] or '')[:160], 'count': int(row[1])}
                                for row in cur.fetchall()]
        except Exception as _e:
            logger.warning(f"report: client_errors query failed: {_e}")
            try: db.rollback()
            except Exception: pass

        # --- Issues & improvements (auto-detected) -------------------------
        # Each is a single COUNT; missing tables degrade to 0 rather than
        # breaking the report. severity drives the UI colour.
        issues = []

        def _count(sql):
            try:
                _ex(sql)
                r = cur.fetchone()
                return int(r[0]) if r and r[0] is not None else 0
            except Exception as _e:
                logger.warning(f"report: issue query failed: {_e}")
                try: db.rollback()
                except Exception: pass
                return 0

        n = _count("SELECT COUNT(*) FROM orders WHERE created_at >= %(d0)s AND created_at < %(d1)s "
                   "AND status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'")
        if n:
            issues.append({'key': 'stuck_pending', 'severity': 'warning', 'count': n,
                           'title': f"{n} order(s) stuck pending over 15 min",
                           'hint': 'Were these missed, or was a station under-staffed at peak?'})
        n = _count("SELECT COUNT(*) FROM orders o JOIN station_stats s ON o.station_id = s.station_id "
                   "WHERE o.created_at >= %(d0)s AND o.created_at < %(d1)s AND COALESCE(s.status,'active') <> 'active' "
                   "AND o.status IN ('pending','in-progress','in_progress')")
        if n:
            issues.append({'key': 'orders_on_closed_station', 'severity': 'danger', 'count': n,
                           'title': f"{n} active order(s) on a closed/maintenance station",
                           'hint': 'These may never be made — reassign them to an open station.'})
        # TIME TO MAKE, not time until someone tapped "collected". Measured
        # on updated_at this said 136 orders at Treenet; measured on
        # completed_at it is 7. The other 129 were made in minutes and then
        # sat on the shelf, which is a different problem with a different fix.
        n = _count("SELECT COUNT(*) FROM orders WHERE created_at >= %(d0)s AND created_at < %(d1)s "
                   "AND completed_at IS NOT NULL "
                   "AND EXTRACT(EPOCH FROM (completed_at - created_at))/60.0 > 20")
        if n:
            issues.append({'key': 'long_waits', 'severity': 'warning', 'count': n,
                           'title': f"{n} order(s) took over 20 minutes to make",
                           'hint': 'Long waits hurt satisfaction — consider more staff at peak.'})
        n = _count("SELECT COUNT(*) FROM orders WHERE created_at >= %(d0)s AND created_at < %(d1)s AND status = 'cancelled'")
        if n:
            issues.append({'key': 'cancellations', 'severity': 'info', 'count': n,
                           'title': f"{n} order(s) cancelled",
                           'hint': 'Check for duplicates or out-of-stock items.'})
        if sms.get('inbound_unanswered'):
            issues.append({'key': 'unanswered_sms', 'severity': 'warning', 'count': sms['inbound_unanswered'],
                           'title': f"{sms['inbound_unanswered']} customer text(s) with no reply",
                           'hint': 'Customers who texted a question may not have received an answer.'})
        if errors.get('count'):
            issues.append({'key': 'app_errors', 'severity': 'warning', 'count': errors['count'],
                           'title': f"{errors['count']} app error(s) logged on devices",
                           'hint': 'See the App errors section — a barista screen may have glitched.'})


        # --- WHAT WE COULD NOT SERVE ---------------------------------
        # Steve: "requests that could not be met". The report counted what we
        # sold and was silent about what we turned away, which is the half a
        # publican would actually act on.
        #
        # The ordering screen has been logging UNAVAILABLE_TAP all along --
        # someone tapping a drink or milk that is switched off, with the item
        # and, for a milk, the drink they were building. Nobody ever looked at
        # it. That tap IS the question people were asking at the cart ("is
        # there decaf?", "do you have oat?"), already counted.
        unmet = {'taps': [], 'tap_total': 0, 'questions_unanswered': 0,
                 'cancelled': 0}
        try:
            _ex("""
                SELECT COALESCE(payload->>'kind', 'item') AS kind,
                       COALESCE(payload->>'item', '?')    AS item,
                       COUNT(*)                           AS n
                FROM client_events
                WHERE code = 'UNAVAILABLE_TAP'
                  AND occurred_at >= %(d0)s AND occurred_at < %(d1)s
                GROUP BY 1, 2
                ORDER BY n DESC
                LIMIT 12
            """)
            unmet['taps'] = [{'kind': r[0], 'item': r[1], 'count': int(r[2])}
                             for r in cur.fetchall()]
            unmet['tap_total'] = sum(t['count'] for t in unmet['taps'])
        except Exception as e:
            logger.warning(f"report unavailable taps failed: {e}")
        try:
            _ex("""
                SELECT COUNT(*) FROM customer_questions
                WHERE created_at >= %(d0)s AND created_at < %(d1)s
                  AND (response IS NULL OR response = '')
            """)
            r = cur.fetchone()
            unmet['questions_unanswered'] = int(r[0]) if r else 0
        except Exception as e:
            logger.warning(f"report unanswered questions failed: {e}")
        unmet['cancelled'] = int(status_counts.get('cancelled', 0))
        # Orders actually REFUSED -- a text that said "we've run out of oat",
        # a touchscreen 409 for a mocha with no chocolate. Until finding 4
        # these were a log line; now they are rows (utils/refusals.py).
        try:
            from utils.refusals import summary as _refused_summary, LABELS as _refused_labels
            _rf = _refused_summary(cur, d0, d1)
            for it in _rf['items']:
                it['label'] = _refused_labels.get(it['reason'], it['reason'])
            unmet['refused'] = _rf['items']
            unmet['refused_total'] = _rf['total']
            unmet['refused_by_channel'] = _rf['by_channel']
        except Exception as e:
            logger.warning(f"report refusals failed: {e}")
            unmet['refused'], unmet['refused_total'], unmet['refused_by_channel'] = [], 0, {}

        # --- TIMES ----------------------------------------------------
        # "Average wait" alone hides the tail: a 13 minute mean with a 40
        # minute worst case is a very different day from a flat 13, and the
        # person who waited 40 is the one who remembers it.
        times = {'first': None, 'last': None, 'span_hours': None, 'days': 0,
                 'wait_median': None, 'wait_p90': None, 'wait_worst': None,
                 'shelf_median': None, 'shelf_worst': None,
                 'per_day': []}
        try:
            # Per LOCAL day, then summed. Taking MIN and MAX across the whole
            # window gave a two-day event a 32.7 hour "service span", which is
            # the wall clock from the first coffee on Thursday to the last on
            # Friday -- including the night. Hours actually serving is the
            # number that means something.
            _ex("""
                SELECT d, MIN(t) AS first_t, MAX(t) AS last_t
                FROM (
                    SELECT (created_at AT TIME ZONE 'UTC'
                            AT TIME ZONE %(tz)s) AS t,
                           (created_at AT TIME ZONE 'UTC'
                            AT TIME ZONE %(tz)s)::date AS d
                    FROM orders
                    WHERE created_at >= %(d0)s AND created_at < %(d1)s
                ) q
                GROUP BY d ORDER BY d
            """)
            rows = cur.fetchall()
            if rows:
                times['first'] = rows[0][1].strftime('%H:%M')
                times['last'] = rows[-1][2].strftime('%H:%M')
                times['span_hours'] = round(sum(
                    (r[2] - r[1]).total_seconds() / 3600.0 for r in rows), 1)
                times['days'] = len(rows)
                # Per day as well as summed: Treenet's day one ran 06:35 to
                # 22:50 on the back of four stragglers after 6pm, and a single
                # "24.4 hours serving" hides that completely.
                times['per_day'] = [
                    {'date': r[0].isoformat(),
                     'first': r[1].strftime('%H:%M'),
                     'last': r[2].strftime('%H:%M')} for r in rows]
            _ex("""
                SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY w),
                       percentile_cont(0.9) WITHIN GROUP (ORDER BY w),
                       MAX(w)
                FROM (
                    SELECT EXTRACT(EPOCH FROM (completed_at - created_at))/60.0 AS w
                    FROM orders
                    WHERE created_at >= %(d0)s AND created_at < %(d1)s
                      AND completed_at IS NOT NULL
                ) q
            """)
            r = cur.fetchone()
            if r and r[0] is not None:
                times['wait_median'] = round(float(r[0]), 1)
                times['wait_p90'] = round(float(r[1]), 1)
                times['wait_worst'] = round(float(r[2]), 1)
            # TIME ON THE SHELF is its own measurement, not part of the wait.
            # Steve, on a 138 minute figure: "I think they would not have
            # stayed for 2 hours, may have been a test or just an error, maybe
            # just take out the outlier." It was neither, and nothing needed
            # removing: that coffee was MADE in 5 minutes and then sat for 133.
            # Deleting the row would have hidden a real signal -- whether people
            # are hearing that their coffee is ready -- behind a tidier average.
            _ex("""
                SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s),
                       MAX(s)
                FROM (
                    SELECT EXTRACT(EPOCH FROM (picked_up_at - completed_at))/60.0 AS s
                    FROM orders
                    WHERE created_at >= %(d0)s AND created_at < %(d1)s
                      AND picked_up_at IS NOT NULL AND completed_at IS NOT NULL
                ) q
            """)
            r = cur.fetchone()
            if r and r[0] is not None:
                times['shelf_median'] = round(float(r[0]), 1)
                times['shelf_worst'] = round(float(r[1]), 1)
        except Exception as e:
            logger.warning(f"report times failed: {e}")

        # --- HOW THEY ORDERED -----------------------------------------
        # Worth knowing before deciding whether the text line earns its cost.
        channels = []
        try:
            _ex("""
                SELECT COALESCE(order_details::jsonb->>'channel', 'unknown') AS ch,
                       COUNT(*) AS n
                FROM orders
                WHERE created_at >= %(d0)s AND created_at < %(d1)s
                GROUP BY 1 ORDER BY n DESC
            """)
            channels = [{'channel': r[0], 'orders': int(r[1])}
                        for r in cur.fetchall()]
        except Exception as e:
            logger.warning(f"report channels failed: {e}")

        # --- WHO THEY WERE, HOW THEY WANTED TO BE TOLD ----------------
        # Steve: "how many people generally choose what option, how many opt
        # in for SMS" -- for the next client, and for sizing the text
        # allowance. identified_by and sms_opt_in are stamped at order time
        # (both arrived after Treenet, so older days show 'unknown').
        people = {'orders': 0, 'gave_mobile': 0, 'chose_texts': 0, 'watched_screen': 0,
                  'identified': {}, 'texts_per_order_if_on': 2}
        try:
            _ex("""
                SELECT
                  COUNT(*),
                  COUNT(*) FILTER (WHERE (phone IS NOT NULL AND phone <> ''
                                     AND phone NOT ILIKE 'walk%%' AND phone NOT IN ('na', 'n/a'))
                                     OR (order_details::jsonb->>'identified_by') = 'number'),
                  -- A number is only ATTACHED to an order when texts were
                  -- chosen (the opt-in toggle, a registered number said yes
                  -- to, or an SMS order), so 'has a phone' IS 'chose texts'.
                  COUNT(*) FILTER (WHERE phone IS NOT NULL AND phone <> ''
                                     AND phone NOT ILIKE 'walk%%' AND phone NOT IN ('na', 'n/a'))
                FROM orders
                WHERE created_at >= %(d0)s AND created_at < %(d1)s
            """)
            r = cur.fetchone()
            if r:
                people['orders'], people['gave_mobile'], people['chose_texts'] = int(r[0]), int(r[1]), int(r[2])
                people['watched_screen'] = people['orders'] - people['chose_texts']
            _ex("""
                SELECT COALESCE(order_details::jsonb->>'identified_by',
                                -- Before identified_by existed, a contact id on the
                                -- order only says they were found on the list (by
                                -- number or the app link); do not guess which.
                                CASE WHEN order_details::jsonb ? 'ea_contact_id' THEN 'registration'
                                     ELSE 'unknown' END) AS how, COUNT(*)
                FROM orders
                WHERE created_at >= %(d0)s AND created_at < %(d1)s
                GROUP BY 1 ORDER BY 2 DESC
            """)
            people['identified'] = {r[0]: int(r[1]) for r in cur.fetchall()}
        except Exception as e:
            logger.warning(f"report people failed: {e}")

        # --- BEANS ---------------------------------------------------
        # The report described the milk in detail and never once mentioned
        # coffee, which is the thing you actually have to order more of.
        #
        # SHOTS are the honest unit: two shots is two shots whatever the
        # grinder is set to, and it is the number that captures "standard vs
        # double" without arguing about dose. Kilograms then follow from the
        # CURRENT beans_grams_per_shot setting, which is stated on the report
        # so nobody has to guess which dose produced the figure.
        #
        # Deliberately RE-RESOLVED rather than summed from each order's
        # _resolved_lines stamp. The stamp is what the ledger moved on the
        # day, and on Treenet that was computed at 22 g per shot -- double the
        # real dose -- so summing the stamps would faithfully reproduce a
        # number we now know was wrong. Re-resolving answers the question
        # actually being asked: how much coffee does an event like this one
        # take, at the dose I use now.
        beans = {'shots': 0.0, 'kg': 0.0, 'by_bean': {}, 'grams_per_shot': None,
                 'strength_mix': {'as_recipe': 0, 'extra': 0, 'lighter': 0},
                 'kg_per_100': None, 'orders_counted': 0, 'no_recipe': 0}
        # Only when asked. resolve_order runs recipe queries per call and the
        # report calls it twice per order; /reports/today is polled every
        # 30 s by every barista tablet, the dashboard and the ops board, and
        # none of them show beans. On a 577-order day that was thousands of
        # extra queries per poll. The Report screen asks with ?beans=1.
        _want_beans = request.args.get('beans') in ('1', 'true', 'yes')
        if _want_beans:
            try:
                from services.recipes import resolve_order as _resolve_for_report
                gps = float(coffee_system._get_setting('beans_grams_per_shot', '22') or 22)
                beans['grams_per_shot'] = gps
                _ex("""
                    SELECT order_details FROM orders
                    WHERE created_at >= %(d0)s AND created_at < %(d1)s
                      AND status <> 'cancelled'
                """)
                for r in cur.fetchall():
                    od = r[0] if not isinstance(r, dict) else r.get('order_details')
                    if isinstance(od, str):
                        try:
                            od = json.loads(od)
                        except (ValueError, TypeError):
                            continue
                    if not isinstance(od, dict):
                        continue
                    try:
                        lines, _m = _resolve_for_report(
                            db, od, coffee_system._get_setting,
                            requested_bean=coffee_system._requested_bean(od))
                    except Exception:
                        lines = None
                    if not lines:
                        beans['no_recipe'] += 1
                        continue
                    grams = sum(float(ln['qty']) for ln in lines
                                if ln.get('category') == 'coffee')
                    if grams <= 0:
                        continue          # tea, hot chocolate: no beans, not a miss
                    beans['orders_counted'] += 1
                    shots = grams / gps if gps else 0
                    beans['shots'] += shots
                    for ln in lines:
                        if ln.get('category') == 'coffee':
                            nm = str(ln.get('name') or 'house blend')
                            beans['by_bean'][nm] = round(
                                beans['by_bean'].get(nm, 0.0) + float(ln['qty']) / 1000.0, 4)
                    # Measured against what THIS drink's own recipe gives at plain
                    # strength -- a large IS a double, so counting "2 shots" as
                    # extra would be wrong. Called 'lighter' rather than 'half'
                    # because 14 of Treenet's orders carried an explicit shot
                    # count below their recipe: genuinely less coffee, but nobody
                    # asked for a half strength.
                    try:
                        base_lines, _bm = _resolve_for_report(
                            db, {**od, 'strength': '', 'shots': None},
                            coffee_system._get_setting,
                            requested_bean=coffee_system._requested_bean(od))
                        base_g = sum(float(ln['qty']) for ln in (base_lines or [])
                                     if ln.get('category') == 'coffee') or grams
                    except Exception:
                        base_g = grams
                    if grams > base_g + 0.01:
                        beans['strength_mix']['extra'] += 1
                    elif grams < base_g - 0.01:
                        beans['strength_mix']['lighter'] += 1
                    else:
                        beans['strength_mix']['as_recipe'] += 1
                beans['shots'] = round(beans['shots'], 1)
                beans['kg'] = round(sum(beans['by_bean'].values()), 3)
                if beans['orders_counted']:
                    beans['kg_per_100'] = round(
                        beans['kg'] / beans['orders_counted'] * 100, 2)
            except Exception as _be:
                logger.warning(f"report bean maths failed: {_be}")

        # What was owed and what was paid (services/payments.py). Empty
        # unless the event prices its coffee.
        payments = {'enabled': False}
        try:
            from services.payments import summary as _pay_summary
            payments = _pay_summary(coffee_system.db.cursor(), d0, d1, _pricing_for(coffee_system.db))
        except Exception as _pay_e:
            logger.warning(f"report payments block failed: {_pay_e}")

        return jsonify({
            'success': True,
            'window': window_label,
            'timezone': tzname,
            'beans': beans,
            'unmet': unmet,
            'payments': payments,
            'times': times,
            'channels': channels,
            'people': people,
            'date': _event_time.local_today(_event_timezone()).isoformat(),
            'total_orders': total,
            'status_breakdown': status_counts,
            'avg_wait_min': round(avg_wait_min, 1) if avg_wait_min is not None else None,
            'revenue_total': round(revenue_total, 2),
            'currency_symbol': currency_symbol,
            'per_station': per_station,
            'top_drinks': top_drinks,
            'milk': milk_breakdown,
            'unused_milks': unused_milks,
            'peak_hour': peak_hour,
            'busiest_station_id': busiest_station_id,
            'sms': sms,
            'errors': errors,
            'issues': issues,
        })
    except Exception as e:
        logger.error(f"get_today_report error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/reports/channels', methods=['GET'])
@jwt_required_with_demo()
def report_channels():
    """Where orders came from, over any date range.

    The client-facing question this answers: "is anyone still using SMS?"
    You cannot retire a channel on a hunch, and CTN26 could not answer it
    because the touchscreen and /my wrote identical rows.

    Orders placed before provenance stamping are still counted, with the
    channel inferred from the old markers -- but they are reported in
    `estimated` as well, so nobody reads a reconstruction as a
    measurement. Once an event runs entirely on stamped orders, estimated
    is 0 and the numbers are exact.

    GET /api/reports/channels?start_date=2026-08-23&end_date=2026-08-23
    Both dates optional; default is everything.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        sql = ("SELECT order_details, status, station_id, created_at "
               "FROM orders WHERE 1=1")
        params = []
        # The dates are local days where the event is (finding 3):
        # created_at::date compared them against the UTC date.
        _bounds = {}
        for arg in ('start_date', 'end_date'):
            val = request.args.get(arg)
            if val:
                d = _event_time.parse_date(val)
                if not d or len(str(val).strip()) != 10:
                    return jsonify({'success': False,
                                    'message': f'{arg} must be YYYY-MM-DD'}), 400
                _bounds[arg] = d
        _s, _e = _event_time.range_bounds(_bounds.get('start_date'), _bounds.get('end_date'),
                                          _event_timezone())
        if _s:
            sql += " AND created_at >= %s"
            params.append(_s)
        if _e:
            sql += " AND created_at < %s"
            params.append(_e)
        cur = db.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall() or []

        by_channel, by_source, by_station, by_surface = {}, {}, {}, {}
        total = served = estimated = 0
        for row in rows:
            raw = row[0] if not isinstance(row, dict) else row.get('order_details')
            status = row[1] if not isinstance(row, dict) else row.get('status')
            station = row[2] if not isinstance(row, dict) else row.get('station_id')
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except Exception:
                    raw = {}
            details = raw if isinstance(raw, dict) else {}

            total += 1
            if str(status or '').lower() in ('completed', 'picked_up'):
                served += 1
            ch = infer_channel(details)
            est = provenance_estimated(details)
            if est:
                estimated += 1
            slot = by_channel.setdefault(
                ch, {'channel': ch, 'label': channel_label(ch),
                     'orders': 0, 'estimated': 0})
            slot['orders'] += 1
            slot['estimated'] += 1 if est else 0

            sf = infer_surface(details)
            sfslot = by_surface.setdefault(
                sf, {'surface': sf, 'label': surface_label(sf), 'orders': 0})
            sfslot['orders'] += 1

            src = details.get('source_code')
            if src:
                sslot = by_source.setdefault(
                    src, {'source': src, 'orders': 0, 'channels': {}})
                sslot['orders'] += 1
                sslot['channels'][ch] = sslot['channels'].get(ch, 0) + 1
            by_station[str(station)] = by_station.get(str(station), 0) + 1

        def pct(n):
            return round(100.0 * n / total, 1) if total else 0.0

        channels = sorted(by_channel.values(), key=lambda c: -c['orders'])
        for c in channels:
            c['share_pct'] = pct(c['orders'])
        sources = sorted(by_source.values(), key=lambda x: -x['orders'])
        for x in sources:
            x['share_pct'] = pct(x['orders'])
        surfaces = sorted(by_surface.values(), key=lambda s: -s['orders'])
        for s in surfaces:
            s['share_pct'] = pct(s['orders'])

        self_serve = sum(c['orders'] for c in channels
                         if c['channel'] in SELF_SERVE)
        sms_orders = by_channel.get('sms', {}).get('orders', 0)

        return jsonify({
            'success': True,
            'total_orders': total,
            'served': served,
            'by_channel': channels,
            'by_source': sources,
            'by_surface': surfaces,
            'by_station': by_station,
            'self_service': {'orders': self_serve, 'share_pct': pct(self_serve)},
            'sms': {'orders': sms_orders, 'share_pct': pct(sms_orders)},
            # How much of the above is reconstruction rather than record.
            # A client-facing chart should footnote this whenever it is
            # non-zero, and no channel should be retired while it is high.
            'estimated_orders': estimated,
            'estimated_pct': pct(estimated),
            'channel_vocabulary': CHANNELS,
            'surface_vocabulary': SURFACES,
            'start_date': request.args.get('start_date'),
            'end_date': request.args.get('end_date'),
        })
    except Exception as e:
        logger.error(f"report_channels error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/reports/today/print', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def print_today_report():
    """Browser-printable event summary. Pure HTML — no PDF lib needed,
    operator hits Cmd+P → "Save as PDF" → emails the file to the client.

    Why HTML instead of a real PDF library:
      1. No new backend dep. reportlab is 25MB; we don't need 25MB
         to render six numbers and a table.
      2. The browser's PDF engine handles fonts, margins, page breaks
         consistently across platforms — better than anything we'd
         hand-roll.
      3. Operator can tweak before saving (e.g. delete a station that
         was for testing) — a PDF can't be edited.
    """
    try:
        from flask import request as _flask_request
        is_post_event = (_flask_request.args.get('view') == 'post')
        html, err = _render_event_summary_html(is_post_event=is_post_event)
        if err:
            return (f'<h1>Report failed</h1><p>{err}</p>'), 500
        from flask import Response
        return Response(html, mimetype='text/html')
    except Exception as e:
        logger.error(f"print_today_report error: {e}")
        return f'<h1>Report failed</h1><pre>{e}</pre>', 500



def _render_event_summary_html(is_post_event: bool = False):
    """Build the event-summary HTML. Returns (html, error_or_None).

    For the printable page (/api/reports/today/print). The emailed report is
    services/client_report.py. is_post_event flips the heading and adds the
    share-with-client CTA.
    """
    from html import escape as _h
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        # Re-use the same query logic by calling the JSON endpoint
        # function directly. One source of truth for the metrics.
        report_resp = get_today_report()
        if hasattr(report_resp, 'get_json'):
            data = report_resp.get_json() or {}
        else:
            data = report_resp[0].get_json() or {}
        if not data.get('success'):
            return None, data.get('error', 'unknown')

        # Pull branding for the header. Falls back to "CupQ" so
        # an event with no name set still renders sensibly.
        try:
            branding = _kv_get(db, 'branding_settings', default={}) or {}
            event_name = (branding.get('event_name')
                          or _kv_get(db, 'event_name', default='CupQ')
                          or 'CupQ')
            logo = branding.get('logo') or branding.get('clientLogo') or ''
        except Exception:
            event_name = 'CupQ'
            logo = ''

        event_name = _h(str(event_name))

        # Build the HTML. Inline CSS so the operator can open the file
        # offline and have it still look right.
        symbol = data.get('currency_symbol', '$')
        per_station_rows = ''.join(
            f"<tr><td>Station {ps['station_id']}</td>"
            f"<td>{ps['orders']}</td>"
            f"<td>{ps['avg_wait_min'] if ps['avg_wait_min'] is not None else '—'}</td>"
            f"<td>{ps.get('orders_per_hour') if ps.get('orders_per_hour') is not None else '—'}</td></tr>"
            for ps in data.get('per_station', [])
        ) or '<tr><td colspan="4" style="text-align:center;color:#888">No orders yet</td></tr>'

        top_drinks_rows = ''.join(
            f"<tr><td>{_h(str(td['drink']).title())}</td><td>{td['orders']}</td></tr>"
            for td in data.get('top_drinks', [])
        ) or '<tr><td colspan="2" style="text-align:center;color:#888">No orders yet</td></tr>'

        status = data.get('status_breakdown') or {}
        status_rows = ''.join(
            f"<tr><td>{_h(s.replace('_', ' ').title())}</td><td>{n}</td></tr>"
            for s, n in status.items()
        ) or '<tr><td colspan="2" style="text-align:center;color:#888">No orders yet</td></tr>'

        avg_wait = data.get('avg_wait_min')
        avg_wait_display = f"{avg_wait} min" if avg_wait is not None else '—'

        # Post-event summary additions — peak hour + busiest station,
        # formatted for the headline row.
        peak = data.get('peak_hour') or {}
        if peak.get('hour') is not None:
            h = peak['hour']
            am_pm = 'am' if h < 12 else 'pm'
            h12 = h if 1 <= h <= 12 else (12 if h == 0 else h - 12)
            peak_display = f"{h12}{am_pm} ({peak.get('orders', 0)})"
        else:
            peak_display = '—'

        busiest_id = data.get('busiest_station_id')
        busiest_display = f"Station {busiest_id}" if busiest_id else '—'

        # SMS section — the customer-comms side of the event.
        sms = data.get('sms') or {}
        sms_html = (
            "<h2>SMS</h2><div class=\"stat-grid\">"
            f"<div class=\"stat\"><div class=\"stat-label\">Texts sent</div><div class=\"stat-value\">{sms.get('outbound', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Customer texts in</div><div class=\"stat-value\">{sms.get('inbound', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Unanswered</div><div class=\"stat-value\">{sms.get('inbound_unanswered', 0)}</div></div>"
            f"<div class=\"stat\"><div class=\"stat-label\">Est. SMS segments</div><div class=\"stat-value\">{sms.get('est_segments', 0)}</div></div>"
            "</div>"
        )

        # Issues & improvements — the review-and-improve section.
        issues = data.get('issues') or []
        if issues:
            _irows = ''.join(
                f"<tr><td>{_h(str(i.get('title', '')))}</td>"
                f"<td style=\"text-align:left\">{_h(str(i.get('hint', '')))}</td></tr>"
                for i in issues
            )
            issues_html = ("<h2>Issues &amp; improvements</h2>"
                           "<table><thead><tr><th>What happened</th><th>Suggestion</th></tr></thead>"
                           f"<tbody>{_irows}</tbody></table>")
        else:
            issues_html = ("<h2>Issues &amp; improvements</h2>"
                           "<p style=\"color:#0f6e56\">No issues detected — clean run.</p>")

        # App errors — anything devices reported during the event.
        errors = data.get('errors') or {}
        _ec = errors.get('count', 0)
        if _ec:
            _erows = ''.join(
                f"<tr><td>{_h(str(e.get('message', '')))}</td><td>{e.get('count', 0)}</td></tr>"
                for e in errors.get('recent', [])
            )
            errors_html = (f"<h2>App errors logged ({_ec})</h2>"
                           "<table><thead><tr><th>Error</th><th>Times</th></tr></thead>"
                           f"<tbody>{_erows}</tbody></table>")
        else:
            errors_html = ("<h2>App errors</h2>"
                           "<p style=\"color:#0f6e56\">None logged.</p>")

        # The post-event framing changes the heading and adds a CTA
        # block — controlled by the is_post_event param.
        heading_kind = 'Post-event summary' if is_post_event else 'Event summary'
        post_event_cta = (
            '<div style="margin-top:32px;background:#f0f7ff;border:1px solid #c7dffd;'
            'border-radius:8px;padding:16px 20px;">'
            '<strong>Share with the client.</strong> Email this page as a PDF '
            '(Cmd+P → Save as PDF) so they see the numbers from the event you '
            'just ran for them. Repeat clients are the cheapest ones to win.'
            '</div>'
        ) if is_post_event else ''

        logo_html = (f'<img src="{_h(str(logo))}" alt="" style="max-height:60px;margin-bottom:10px"/>'
                     if logo else '')

        # The body. Browser's print stylesheet handles page breaks.
        html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{event_name} — {heading_kind} {data.get('date', '')}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          max-width: 720px; margin: 40px auto; padding: 0 24px; color: #222; }}
  h1 {{ margin: 0 0 4px 0; }}
  .subtitle {{ color: #666; margin-bottom: 24px; }}
  .stat-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 24px 0; }}
  .stat {{ background: #f7f5f0; border-radius: 8px; padding: 16px; }}
  .stat-label {{ font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }}
  .stat-value {{ font-size: 28px; font-weight: bold; margin-top: 4px; }}
  h2 {{ font-size: 16px; margin-top: 32px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 8px 0 16px 0; }}
  th, td {{ text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }}
  th {{ background: #f7f5f0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }}
  td:nth-child(2), th:nth-child(2), td:nth-child(3), th:nth-child(3),
  td:nth-child(4), th:nth-child(4) {{ text-align: right; }}
  .footer {{ margin-top: 40px; color: #888; font-size: 12px; text-align: center; }}
  @media print {{ body {{ margin: 0; }} .no-print {{ display: none; }} }}
</style>
</head>
<body>
  <div class="no-print" style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px 12px;margin-bottom:20px;font-size:13px;">
    <strong>Tip:</strong> hit Cmd+P (Mac) or Ctrl+P (Win) → "Save as PDF" → email the file to the client.
  </div>
  {logo_html}
  <h1>{event_name}</h1>
  <p class="subtitle">{heading_kind} — {data.get('date', '')}</p>

  <div class="stat-grid">
    <div class="stat">
      <div class="stat-label">Total orders</div>
      <div class="stat-value">{data.get('total_orders', 0)}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Avg wait</div>
      <div class="stat-value">{avg_wait_display}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Revenue</div>
      <div class="stat-value">{symbol}{data.get('revenue_total', 0):.2f}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Peak hour</div>
      <div class="stat-value" style="font-size:22px">{peak_display}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Busiest station</div>
      <div class="stat-value" style="font-size:22px">{busiest_display}</div>
    </div>
  </div>
  {post_event_cta}

  <h2>By status</h2>
  <table><thead><tr><th>Status</th><th>Orders</th></tr></thead>
  <tbody>{status_rows}</tbody></table>

  <h2>By station</h2>
  <table><thead><tr><th>Station</th><th>Orders</th><th>Avg wait (min)</th><th>Orders/hour</th></tr></thead>
  <tbody>{per_station_rows}</tbody></table>

  <h2>Top drinks</h2>
  <table><thead><tr><th>Drink</th><th>Orders</th></tr></thead>
  <tbody>{top_drinks_rows}</tbody></table>

  {sms_html}

  {issues_html}

  {errors_html}

  <div class="footer">
    Generated by Coffee Cue. To regenerate, visit Support → Operations → Print summary.
  </div>
</body>
</html>"""
        return html, None
    except Exception as e:
        logger.error(f"_render_event_summary_html error: {e}")
        return None, str(e)



@bp.route('/reports/post-event/email', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def email_post_event_summary():
    """Email the event report to the client now.

    Body: {"to": "client@example.com", "from": first day, "to_day": last day,
    "subject": optional}. No days = today. The client's version
    (services/client_report.py), with the feedback link. With email not set
    up, success and sent:false, so the screen can say to save the PDF.
    """
    from routes.account_recovery_routes import _base_url
    from routes.client_report_routes import EMAIL_RE
    from services import client_report
    from services.email_utils import email_enabled
    from utils.database import close_connection, get_db_connection

    body = request.get_json(silent=True) or {}
    to = str(body.get('to') or '').strip()
    if not EMAIL_RE.match(to):
        return jsonify({'success': False,
                        'error': 'A valid recipient email is required.'}), 400
    today = _event_time.local_today(_event_timezone())
    first = _event_time.parse_date(body.get('from')) or today
    last = _event_time.parse_date(body.get('to_day')) or first
    if last < first:
        first, last = last, first
    conn = get_db_connection()
    try:
        result = client_report.send(
            current_app._get_current_object(), conn, to, first.isoformat(),
            last.isoformat(), _base_url(), (body.get('subject') or '').strip()[:150] or None)
        return jsonify({
            'success': result.ok,
            'sent': result.sent,
            'email_enabled': email_enabled(),
            'message': result.detail,
            'to': to,
        })
    except Exception as e:
        conn.rollback()
        logger.error(f"email_post_event_summary error: {e}")
        return jsonify({'success': False,
                        'error': 'The report could not be emailed. Please try again.'}), 500
    finally:
        close_connection(conn)
