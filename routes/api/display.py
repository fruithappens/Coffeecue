"""Boards, kiosk, QR codes and the public status feed.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import jwt_required_with_demo, role_required_with_demo
from datetime import datetime
from flask import Response, current_app, jsonify, request
from security_middleware import _client_ip as _pin_client_ip, limiter as _pin_limiter
from utils.event_access import ACCESS_SETTING_KEY, check as event_access_check
from utils.order_provenance import normalize_channel, normalize_source, stamp as stamp_provenance
from routes.consolidated_api_routes import (  # noqa: F401
    _badge_scan_for_display,
    _clean_bg_video,
    _customer_wording_for_display,
    _drink_display_name,
    _emit_new_order,
    _event_code_for_display,
    _kiosk_menu_data,
    _kv_get,
    _kv_put,
    _powered_by_for_display,
    _pricing_for,
    _revalidating_json,
    _station_can_make_order,
    bp,
    logger,
)


# ============================================================================
# SYSTEM STATUS ENDPOINTS
# ============================================================================

@bp.route('/status', methods=['GET'])
def get_system_status():
    """Get overall system status and health information"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check database connection
        cursor = db.cursor()
        cursor.execute("SELECT 1")
        db_status = cursor.fetchone() is not None
        
        # Get messaging service status
        messaging_service = current_app.config.get('messaging_service')
        if messaging_service:
            sms_status = {
                'available': True,
                'testing_mode': getattr(messaging_service, 'testing_mode', False),
                'phone_number': getattr(messaging_service, 'phone_number', '')
            }
        else:
            sms_status = {'available': False}
        
        # Get active station count
        cursor.execute("SELECT COUNT(*) FROM station_stats WHERE status = 'active'")
        active_stations = cursor.fetchone()[0] or 0
        
        # Get pending orders count
        cursor.execute("SELECT COUNT(*) FROM orders WHERE status = 'pending'")
        pending_orders = cursor.fetchone()[0] or 0
        
        # Get in-progress orders count
        cursor.execute("SELECT COUNT(*) FROM orders WHERE status = 'in-progress'")
        in_progress_orders = cursor.fetchone()[0] or 0
        
        # Get system settings
        cursor.execute("SELECT value FROM settings WHERE key = 'system_name'")
        system_name_result = cursor.fetchone()
        system_name = system_name_result[0] if system_name_result else 'CupQ'
        
        cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else 'Coffee Event'
        
        # Return system status
        return jsonify({
            'success': True,
            'status': {
                'system_name': system_name,
                'event_name': event_name,
                'database': {
                    'connected': db_status,
                    'type': 'PostgreSQL'
                },
                'messaging': sms_status,
                'stations': {
                    'active': active_stations
                },
                'orders': {
                    'pending': pending_orders,
                    'in_progress': in_progress_orders
                },
                'version': current_app.config.get('config', {}).get('APP_VERSION', '1.0.0'),
                'timestamp': datetime.now().isoformat()
            }
        })
    except Exception as e:
        logger.error(f"Error getting system status: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error getting system status: {str(e)}"
        })



@bp.route('/heartbeat', methods=['GET'])
def heartbeat():
    """Connectivity check — used by the React UI to confirm the
    backend is reachable. Intentionally cheap (no DB hit).

    Previously returned 404 because no route existed; the UI
    interpreted the failure as "offline" and dropped into
    fallback-data mode unnecessarily.
    """
    return jsonify({'status': 'ok', 'service': 'expresso'})



@bp.route('/display/config', methods=['GET'])
def get_display_config():
    """Get display screen configuration including event details, sponsor info, and SMS details.

    Previously this read EVENT_NAME from Flask app config (an env
    var set at boot), so changing the event name via the Branding
    panel did NOTHING on the Display screen — Steve renamed the
    event and it didn't update. Now reads from the live branding
    settings KV (the same row /api/settings/branding writes to).
    """
    try:
        config = current_app.config.get('config', {})
        coffee_system = current_app.config.get('coffee_system')

        # Pull branding from the settings KV — what the Branding
        # panel actually writes to.
        branding = {}
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                branding = _kv_get(coffee_system.db, 'branding_settings', default={}) or {}
        except Exception as e:
            logger.warning(f"display/config: could not read branding settings: {e}")

        # Event name precedence: branding setting → env var → static fallback.
        event_name = (
            branding.get('eventName')
            or branding.get('event_name')
            or branding.get('landingPageTitle')
            or branding.get('clientName')          # operator's "Client Name" works as a fallback
            or config.get('EVENT_NAME')
            or 'Coffee Event'
        )

        # System/company name — same precedence pattern.
        system_name = (
            branding.get('systemName')
            or branding.get('system_name')
            or 'CupQ'
        )
        from services.coffee_system import is_old_product_name
        if is_old_product_name(system_name):
            system_name = 'CupQ'

        # Sponsor block — operator may not have set this; default off.
        sponsor = {
            "enabled": bool(branding.get('showSponsor') or branding.get('sponsorEnabled')),
            "name":    branding.get('sponsorName') or '',
            "message": branding.get('sponsorMessage') or '',
        }

        # Pull real stations from station_stats so the Display
        # selector reflects the operator's actual setup rather than
        # the old hardcoded 1/2/3.
        stations = []
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                cur = coffee_system.db.cursor()
                cur.execute(
                    "SELECT station_id, COALESCE(name, ''), COALESCE(location, ''), "
                    "COALESCE(status, 'active'), COALESCE(barista_name, '') "
                    "FROM station_stats ORDER BY station_id"
                )
                for row in cur.fetchall():
                    sid, name, location, status, barista = row
                    stations.append({
                        "id": sid,
                        "name": name or f"Station #{sid}",
                        "location": location or 'Main Hall',
                        "status": status or 'active',
                        "barista": barista or 'Unassigned',
                    })
        except Exception as e:
            logger.warning(f"display/config: could not enumerate stations: {e}")

        # Display content + appearance settings live in the settings KV table
        # (set from the barista Notification/Display settings). The PUBLIC
        # display has no auth to hit /api/settings, so surface them here.
        # Defaults mirror the app defaults so a fresh install looks complete.
        disp = {
            'show_customer_name': True,
            'show_order_details': True,
            'show_completed': True,
            'show_wait_times': True,
            'display_theme': 'light',
            'display_font_size': 'large',
            'display_zoom': 100,
            'display_rotation': 0,
            'display_mode': 'auto',
            # Board overflow controls (barista Display tab): seconds per
            # page flip, fixed cards-per-page (0 = auto-measure, 3..8 =
            # scale cards to fit), and 'flip' vs continuous 'scroll'.
            'display_flip_seconds': 10,
            'display_cards_per_page': 0,
            'display_overflow_mode': 'flip',
            # Touchscreen? On: tap-to-order kiosk button. Off (wall TV):
            # SMS is promoted as the primary way to order.
            'display_touch_ordering': True,
            # Sounds chosen in the barista Settings > Sounds for the OTHER screens.
            'ready_sound': 'chime_up',
            'beacon_sound': 'cupq_signature',
        }
        try:
            if coffee_system and getattr(coffee_system, 'db', None):
                scur = coffee_system.db.cursor()
                scur.execute(
                    "SELECT key, value FROM settings WHERE key IN ("
                    "'showNameOnDisplay','showOrderDetails','showCompletedOrders',"
                    "'showWaitTimes','displayTheme','displayFontSize','displayZoom',"
                    "'displayRotation','displayMode','displayCustomMessage',"
                    "'displayFlipSeconds','displayCardsPerPage','displayOverflowMode',"
                    "'displayTouchOrdering','displayReadySound','beaconReadySound')"
                )
                _rows = {k: v for k, v in scur.fetchall()}

                def _as_bool(key, default):
                    v = _rows.get(key)
                    return (str(v).strip().lower() == 'true') if v is not None else default

                def _as_int(key, default):
                    v = _rows.get(key)
                    try:
                        return int(float(v)) if v is not None and str(v).strip() != '' else default
                    except (TypeError, ValueError):
                        return default

                def _as_str(key, default):
                    v = _rows.get(key)
                    return str(v) if v is not None and str(v).strip() != '' else default

                disp['show_customer_name'] = _as_bool('showNameOnDisplay', True)
                disp['show_order_details'] = _as_bool('showOrderDetails', True)
                disp['show_completed'] = _as_bool('showCompletedOrders', True)
                disp['show_wait_times'] = _as_bool('showWaitTimes', True)
                disp['display_theme'] = _as_str('displayTheme', 'light')
                disp['display_font_size'] = _as_str('displayFontSize', 'large')
                disp['display_zoom'] = _as_int('displayZoom', 100)
                disp['display_rotation'] = _as_int('displayRotation', 0)
                disp['display_mode'] = _as_str('displayMode', 'auto')
                # Barista Display tab's Custom Message (settings KV) —
                # previously the field saved nowhere while the display
                # read only the organiser branding blob.
                disp['custom_message'] = _as_str('displayCustomMessage', '')
                disp['display_flip_seconds'] = _as_int('displayFlipSeconds', 10)
                disp['display_cards_per_page'] = _as_int('displayCardsPerPage', 0)
                disp['display_overflow_mode'] = _as_str('displayOverflowMode', 'flip')
                disp['display_touch_ordering'] = _as_bool('displayTouchOrdering', True)
                disp['ready_sound'] = _as_str('displayReadySound', 'chime_up')
                disp['beacon_sound'] = _as_str('beaconReadySound', 'cupq_signature')
        except Exception as e:
            logger.warning(f"display/config: could not read display settings: {e}")
            try:
                coffee_system.db.rollback()
            except Exception:
                pass

        return _revalidating_json({
            "success": True,
            "config": {
                "system_name": system_name,
                "event_name": event_name,
                "show_customer_name": disp['show_customer_name'],
                "show_order_details": disp['show_order_details'],
                "show_completed": disp['show_completed'],
                "show_wait_times": disp['show_wait_times'],
                "display_theme": disp['display_theme'],
                "display_font_size": disp['display_font_size'],
                "display_zoom": disp['display_zoom'],
                "display_rotation": disp['display_rotation'],
                "display_mode": disp['display_mode'],
                "display_flip_seconds": disp['display_flip_seconds'],
                "display_cards_per_page": disp['display_cards_per_page'],
                "display_overflow_mode": disp['display_overflow_mode'],
                "display_touch_ordering": disp['display_touch_ordering'],
                "ready_sound": disp['ready_sound'],
                "beacon_sound": disp['beacon_sound'],
                "sms_number": config.get('TWILIO_PHONE_NUMBER', '') or branding.get('smsNumber', ''),
                # The event's ordering code, so the poster page can stamp
                # it into the QR it prints. Public because it is printed
                # on a poster -- it identifies an event, it does not
                # authorise anything.
                # coffee_system.db, not a bare `db` -- there is no local
                # `db` in this function and referencing one took the whole
                # endpoint down with a NameError. Guarded, because this
                # config drives the Display's branding and must not fail
                # over a poster code.
                "event_code": _event_code_for_display(
                    getattr(coffee_system, 'db', None) if coffee_system else None),
                # Whether a phone may offer "Scan your badge": only when the
                # operator has switched attendee lookup on for this event.
                # Never raises -- this endpoint is public and load-bearing.
                "badge_scan": _badge_scan_for_display(coffee_system.db if coffee_system else None),
                "sponsor": sponsor,
                # Logo for the display screen header. Uploaded via the
                # Branding panel as a data URI (clientLogo). 'logo' is the
                # legacy key; accept either.
                "logo": branding.get('clientLogo') or branding.get('logo') or '',
                # Full-screen Display backgrounds — one per orientation so a
                # vertical OR horizontal screen gets a correctly-framed image.
                # Uploaded via the Branding panel as data URIs.
                "background_landscape": branding.get('bgLandscape') or branding.get('background_landscape') or '',
                "background_portrait": branding.get('bgPortrait') or branding.get('background_portrait') or '',
                "wait_time": branding.get('waitTime', '10-15'),
                # CupQ house dark, from the logo. Was a generic blue that
                # belonged to nothing. A client's own branding still wins:
                # this is only the fallback when nothing is configured.
                # "powered by CupQ" on guest screens: by plan tier (Pro and
                # Urn are white-label). utils/plan_limits.shows_powered_by.
                "powered_by": _powered_by_for_display(coffee_system.db),
                "header_color": (branding.get('headerColor')
                                 or branding.get('primaryColor') or '#C08552'),
                "custom_message": disp.get('custom_message') or branding.get('customMessage') or branding.get('footerText') or '',
                # How the CUSTOMER screens wear the event at the top.
                # Steve: "might have to have an option -- if it's just text,
                # and colour of that text, or text and logo at the top, or a
                # specific logo/image for the top of the iPhone beacon."
                #   mode  'logo_name' (default) | 'name' | 'image'
                #   image an image just for the customer header, when the
                #         event's main logo is the wrong shape for a phone
                #   color the text colour; falls back to the header colour
                "customer_header": {
                    "mode": branding.get('customerHeaderMode') or 'logo_name',
                    "image": branding.get('customerHeaderImage') or '',
                    "color": branding.get('customerHeaderColor') or '',
                },
                # The organiser's own words for each stage on the phone
                # (Runner > Branding > Phone wording, X7-5). Empty = CupQ's.
                "customer_wording": _customer_wording_for_display(coffee_system.db),
                "stations": stations,
                "app_version": config.get('APP_VERSION', '1.0.0'),
            }
        })
    except Exception as e:
        logger.error(f"Error getting display config: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })



@bp.route('/display/menu', methods=['GET'])
def get_display_menu():
    """Public self-service kiosk menu — what each station can make. No JWT;
    the Display is a public screen."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'error': 'unavailable'}), 503
        # Feature flags ride along on the menu because /my already fetches
        # it — the customer page needs to know which identification methods
        # to OFFER, and a second request on a phone at an event is a cost
        # for no benefit. Badge lookup defaults off; see
        # attendee_lookup_enabled() for why that default is the safe one.
        try:
            from routes.ea_survey_routes import attendee_lookup_enabled
            badge_ok = attendee_lookup_enabled(coffee_system.db)
        except Exception as e:
            logger.warning(f"display/menu: badge flag read failed: {e}")
            badge_ok = False
        return jsonify({'success': True,
                        'menu': _kiosk_menu_data(coffee_system),
                        'features': {'attendee_lookup': badge_ok}})
    except Exception as e:
        logger.error(f"display/menu error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/display/order', methods=['POST'])
def create_kiosk_order():
    """Public self-service order placed from the Display kiosk. No JWT — the
    Display is a public screen (same trust model as SMS ordering). Only accepts
    items some station can make; routes to the chosen station if it can make
    the whole order, otherwise to a station that can, and returns where to
    collect."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        db = coffee_system.db

        # Intake gate — the kiosk is a customer-facing order path, so it
        # closes when Stop All Operations or Lock System is active. Staff
        # order creation (POST /api/orders, walk-ins) stays open.
        from utils.order_intake import intake_blocked_reason
        _blocked = intake_blocked_reason(db)
        if _blocked:
            return jsonify({'success': False, 'ordering_closed': True,
                            'message': _blocked}), 503

        data = request.json or {}

        name = (data.get('name') or data.get('customer_name') or '').strip()
        coffee_type = (data.get('coffee_type') or data.get('type') or '').strip()
        milk = (data.get('milk') or data.get('milk_type') or '').strip()
        size = (data.get('size') or '').strip()
        sugar = data.get('sugar')
        if sugar is None or sugar == '':
            sugar = 'No sugar'
        # Self-serve sugar venues: baristas never add it, so no order may
        # carry it (the kiosk UI also skips the question; this guards the
        # API too).
        try:
            if coffee_system._sugar_self_serve():
                sugar = 'No sugar'
        except Exception:
            pass
        note = (data.get('note') or data.get('notes') or '').strip()
        # The notes box doubles as the VIP code box, with nothing saying
        # so. There is no field for a code on the kiosk or the QR app, and
        # Steve does not want one -- "not give it away to others that
        # there is even such a hack". Typing the event's code among your
        # notes promotes the order; the code is stripped before storage so
        # it never reaches the label, the barista card or the board.
        kiosk_vip = False
        try:
            note, kiosk_vip = coffee_system.extract_vip_from_text(note)
        except Exception as _vip_err:
            logger.warning(f"vip-in-notes check skipped: {_vip_err}")
        # Strength and temperature are first-class on SMS orders (the NLP
        # service extracts "double shot", "half strength", "extra hot"),
        # but this endpoint used to drop them, so the same words saved as
        # someone's usual produced a plain drink. The barista list already
        # renders extraHot off order_details['temp'].
        strength = str(data.get('strength') or '').strip().lower()
        temp = str(data.get('temp') or data.get('temperature') or '').strip().lower()
        # Decaf. Stocked at the venue, orderable by SMS and at the walk-in
        # screen, but this endpoint dropped it -- so the touchscreen and
        # the phone-QR flow were the only two ways to order that could not
        # ask for it. Same key the walk-in path writes, so the barista card
        # and the label read it without knowing where the order came from.
        bean_type = str(data.get('bean_type') or '').strip().lower()
        # Dine in or take away (the lounge's quick order asks). Only the two
        # known words are kept; anything else is "not asked" (None).
        service = str(data.get('service') or '').strip().lower()
        service = service if service in ('here', 'takeaway') else None

        # EventsAir pre-identification (research Phase 4.8): the EA app
        # links here with ?cid={ContactID}; the kiosk passes it through.
        # Name and phone come from the SERVER-side attendee mirror — the
        # browser never sees the number. Unknown/absent cid changes
        # nothing.
        ea_contact_id = str(data.get('ea_contact_id') or '').strip()
        # Provenance. /my posts through this same endpoint, so the caller
        # must say which it is -- the server cannot tell them apart. An
        # absent or bogus channel falls back to 'kiosk', which is what
        # this endpoint was before /my started borrowing it.
        req_channel = normalize_channel(data.get('channel')) or 'kiosk'
        req_source = normalize_source(data.get('src') or data.get('source_code'))

        # Event gate. A QR from a previous event must not put a coffee on
        # a barista's screen here -- see utils/event_access.py. Fails
        # OPEN on any ambiguity: an event that never configured this, or
        # that requires a code without having set one, keeps taking
        # orders. A system that quietly stops accepting coffee is a worse
        # outage than the stray order it was guarding against.
        try:
            allowed, gate_msg = event_access_check(
                _kv_get(db, ACCESS_SETTING_KEY, default=None),
                data.get('e') or data.get('event_code') or request.args.get('e'),
                data.get('event_password') or data.get('password'))
            if not allowed:
                logger.info("Order refused: event code mismatch")
                return jsonify({'success': False, 'message': gate_msg,
                                'wrong_event': True}), 403
        except Exception as gate_err:
            logger.warning(f"event gate check failed, allowing: {gate_err}")
        ea_phone = ''
        if ea_contact_id:
            try:
                cur0 = db.cursor()
                cur0.execute("SELECT to_regclass('ea_attendees') IS NOT NULL")
                _r0 = cur0.fetchone()
                if _r0 and (_r0[0] if not isinstance(_r0, dict) else list(_r0.values())[0]):
                    cur0.execute(
                        "SELECT first_name, last_name, mobile_e164 FROM ea_attendees "
                        "WHERE ea_contact_id = %s", (ea_contact_id,))
                    att = cur0.fetchone()
                    if att:
                        fn, ln, mob = ((att.get('first_name'), att.get('last_name'),
                                        att.get('mobile_e164'))
                                       if isinstance(att, dict) else att)
                        if not name:
                            name = ' '.join(p for p in ((fn or '').strip(),
                                                        (ln or '').strip()[:1]) if p)
                        ea_phone = (mob or '').strip()
                    else:
                        ea_contact_id = ''  # unknown cid — behave as anonymous
            except Exception as ea_err:
                logger.warning(f"kiosk EA lookup skipped (fail-open): {ea_err}")
                ea_contact_id = ''

        # A typed name with a typed number is an IDENTITY, not just an
        # order field. Steve ordered as "Sam", quit the app, searched his
        # number -- Bart and Steve appeared, Sam did not, and Sam's order
        # was unfindable by anything. Orders now mint (or reuse) a local
        # attendee row per (number, name) -- the same kind /api/ea/guest
        # makes -- so the name joins that number's candidate list and the
        # order is recoverable by identity. lookup_phone arrives even when
        # SMS was declined: it is for FINDING, never texting; the order's
        # own phone field stays governed by the opt-in.
        if not ea_contact_id:
            lookup_phone = str(data.get('lookup_phone') or '').strip()
            if lookup_phone and name and len(name) >= 2:
                try:
                    from routes.ea_survey_routes import (
                        GUEST_ID_PREFIX, _ensure_tables, normalize_phone_e164)
                    e164 = normalize_phone_e164(lookup_phone)
                    if e164:
                        _ensure_tables(db)
                        first = name.split()[0]
                        cur0 = db.cursor()
                        # One row per (number, name): Bart, Steve and Sam
                        # can share a mobile. Deliberately NOT /guest's
                        # one-row-per-number upsert, which would RENAME
                        # the previous person.
                        cur0.execute(
                            "SELECT ea_contact_id FROM ea_attendees "
                            "WHERE (mobile_e164 = %s OR mobile_alt_e164 = %s) "
                            "AND LOWER(first_name) = LOWER(%s) LIMIT 1",
                            (e164, e164, first))
                        row0 = cur0.fetchone()
                        if row0:
                            ea_contact_id = (row0.get('ea_contact_id')
                                             if isinstance(row0, dict) else row0[0])
                        else:
                            import secrets as _secrets
                            ea_contact_id = GUEST_ID_PREFIX + _secrets.token_hex(6)
                            cur0.execute(
                                "INSERT INTO ea_attendees (ea_contact_id, first_name, "
                                "display_name_local, mobile_e164, synced_at) "
                                "VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)",
                                (ea_contact_id, first, first, e164))
                            db.commit()
                except Exception as mint_err:
                    logger.warning(f"guest identity mint skipped: {mint_err}")
                    try:
                        db.rollback()
                    except Exception:
                        pass
                    ea_contact_id = ''

        if not name or len(name) < 2:
            return jsonify({'success': False, 'message': 'Please enter your name.'}), 400
        if not coffee_type:
            return jsonify({'success': False, 'message': 'Please choose a drink.'}), 400

        # Validate the milk against the MENU (single source: event list ∩
        # station capabilities via _kiosk_menu_data). Found by the Test Bench:
        # this public endpoint accepted 'macadamia' — a milk nothing offers —
        # because the only gate was per-station capability, and an
        # unconfigured/wildcard station passes anything (#165 class). The
        # kiosk UI only shows menu milks, but the API must refuse too.
        if milk and milk.lower() not in ('no milk', 'none', 'black'):
            try:
                menu_milks = [str(m.get('value') or m.get('name') or m).lower()
                              for m in (_kiosk_menu_data(coffee_system).get('milks') or [])]
                req = milk.lower().replace(' milk', '').strip()
                offered = {mm.replace(' milk', '').strip() for mm in menu_milks}
                if offered and req not in offered:
                    return jsonify({
                        'success': False,
                        'message': f"Sorry, we don't have {milk} today. "
                                   f"Available milks: {', '.join(sorted(offered))}.",
                    }), 400
            except Exception as vm_err:
                logger.warning(f"kiosk milk validation skipped (fail-open): {vm_err}")

        try:
            requested_station = int(data.get('station_id') or data.get('stationId') or 0) or None
        except (TypeError, ValueError):
            requested_station = None
        try:
            preferred_station = int(data.get('preferred_station') or data.get('collect_station') or 0) or None
        except (TypeError, ValueError):
            preferred_station = None

        # Phone is OPTIONAL for everyone. Some customers have no phone or are on
        # international roaming and must still be able to order — if they don't
        # leave a number they watch the board for their name (the collect-from
        # station is shown on the kiosk review + the order board). A number just
        # opts them into a ready-SMS. Normalise to E.164 so SMS actually sends.
        raw_phone = (data.get('phone') or data.get('phone_number') or '').strip()

        phone = ''
        if raw_phone:
            try:
                phone = coffee_system._normalize_phone(raw_phone)
            except Exception:
                phone = raw_phone
        # EA-identified and no number typed: the registration mobile is
        # attached ONLY when the customer tapped the opt-in (Steve's
        # flow: "we have xx name and number on record is this correct?
        # opt in for sms reminder"). It used to attach automatically --
        # a text nobody asked for, to a number nobody confirmed. The
        # number stays server-side either way; the browser only ever
        # learns has_phone.
        if not phone and ea_phone and data.get('use_registered_phone'):
            phone = ea_phone

        from utils.plan_limits import attendee_cap_message, feature_allowed
        _cap_msg = attendee_cap_message(db, phone)
        if _cap_msg:
            return jsonify({'success': False, 'message': _cap_msg}), 503

        # The EventsAir rule (services/vip_rule.py): a speaker or a tagged
        # VIP jumps the queue and/or goes to the organiser's chosen station
        # without typing anything. Looked up by the contact id when the
        # badge or the EA app supplied one, else by any number we know --
        # the typed one, or the registration mobile (used here only to
        # RECOGNISE the person; it is never attached to the order by this).
        vip_reason = ''
        vip_station = None
        try:
            from services.vip_rule import resolve as _vip_resolve
            _hit = _vip_resolve(db.cursor(), phone=(phone or ea_phone or ''),
                                ea_contact_id=ea_contact_id)
            if _hit.get('vip'):
                if _hit.get('jump_queue', True):
                    kiosk_vip = True
                vip_reason = _hit.get('reason') or ''
                vip_station = _hit.get('station_id')
                logger.info(f"kiosk order flagged VIP by the EventsAir rule ({vip_reason})")
        except Exception as _vr:
            logger.warning(f"VIP rule lookup skipped (fail-open): {_vr}")

        try:
            db.rollback()
        except Exception:
            pass
        active = []
        cur = db.cursor()
        cur.execute("SELECT station_id, COALESCE(status,'active') FROM station_stats ORDER BY station_id")
        for row in cur.fetchall():
            sid = row[0] if not isinstance(row, dict) else row.get('station_id')
            st = (row[1] if not isinstance(row, dict) else row.get('status')) or 'active'
            if str(st).lower() not in ('inactive', 'maintenance'):
                active.append(sid)

        def can_make(sid):
            return not _station_can_make_order(
                db, sid, {'type': coffee_type, 'milk': milk}
            ).get('blocked')

        # A sponsor's VIP-only cart is invisible to everyone else.
        try:
            from services.vip_rule import allowed_stations as _vip_allowed
            active = _vip_allowed(db.cursor(), active, bool(kiosk_vip))
        except Exception as _vo:
            logger.warning(f"VIP-only station filter skipped: {_vo}")

        # Station precedence: the rule's station for a VIP, else the customer's
        # chosen collection point, else this display's own station, else the
        # first active station that can make the drink+milk (so the barista
        # can actually start it).
        target = None
        if vip_station and vip_station in active and can_make(vip_station):
            target = vip_station
        if target is None and preferred_station and preferred_station in active and can_make(preferred_station):
            target = preferred_station
        if target is None and requested_station and requested_station in active and can_make(requested_station):
            target = requested_station
        if target is None:
            # Auto-assign the way the SMS path does: _assign_station knows
            # BREAK WINDOWS and real per-station load. The old fallback here
            # was "first active station that can make it" — so during a break
            # with one station open, kiosk orders piled onto a CLOSED station
            # (Test Bench breaks suite, first run: 3 orders → station 1 while
            # only station 4 was open).
            try:
                cs_target, _delayed = coffee_system._assign_station(
                    bool(kiosk_vip),
                    None if (milk or '').lower() in ('', 'no milk', 'none', 'black') else milk,
                    coffee_type, size)
                if cs_target in active and can_make(cs_target):
                    target = cs_target
            except Exception as _ae:
                logger.warning(f"kiosk _assign_station failed, using capability loop: {_ae}")
        if target is None:
            for sid in active:
                if can_make(sid):
                    target = sid
                    break
        if target is None:
            return jsonify({
                'success': False,
                'message': "Sorry, that combination isn't available right now. "
                           "Please pick different options or see a barista.",
            }), 400

        expected = preferred_station or requested_station
        reassigned = bool(expected and target != expected)

        # One station per round. The group endpoint pins every later cup to
        # the station the round's FIRST cup landed on and asks for it to be
        # locked: a drink this station can't make is REFUSED with a reason,
        # not quietly routed elsewhere. Steve: stations can be 500 m apart
        # at a conference, so a round split across two is worse than one
        # cup declined. Solo orders never set this and reassign as before.
        if reassigned and data.get('lock_station'):
            try:
                from utils.station_label import station_label as _lock_label
                _where = _lock_label(db, expected) or f"Station {expected}"
            except Exception:
                _where = f"Station {expected}"
            return jsonify({
                'success': False, 'station_locked': True,
                'message': (f"Sorry, {coffee_type} with {milk or 'no milk'} isn't "
                            f"available at {_where} right now - please choose "
                            f"something else for this cup."),
            }), 409

        # No phone requirement — an order without a number is fine (the customer
        # watches the board). When a number IS given for a collect-elsewhere
        # order, the ready-SMS will tell them where to collect.
        now = datetime.now()
        order_prefix = ''
        try:
            blob = _kv_get(db, 'order_prefix', default=None)
            if isinstance(blob, dict):
                order_prefix = (blob.get('prefix') or '').strip()
            elif isinstance(blob, str):
                order_prefix = blob.strip()
        except Exception:
            order_prefix = ''
        order_number = None
        # Group lettering (336a/336b/336c). The group endpoint reserves ONE
        # base for the round and hands each drink its lettered number here,
        # BEFORE the insert, so the board broadcast and any arrival-print
        # already carry the final number (renaming after would ghost a
        # "336" card). This endpoint is PUBLIC, so a number is honoured
        # only if the group endpoint authorised that exact value moments
        # ago -- a body carrying an unauthorised number is simply ignored.
        try:
            from utils.order_numbering import consume_preassigned
            _pre = str(data.get('_order_number') or '').strip()
            if _pre and consume_preassigned(_pre):
                order_number = _pre
        except Exception as _pre_err:
            logger.warning(f"preassigned number check skipped: {_pre_err}")
        if not order_number:
            try:
                seqc = db.cursor()
                seqc.execute("SELECT nextval('order_number_seq')")
                srow = seqc.fetchone()
                if srow:
                    sval = srow[0] if not isinstance(srow, dict) else list(srow.values())[0]
                    order_number = f"{order_prefix}{int(sval)}"
            except Exception:
                try:
                    db.rollback()
                except Exception:
                    pass
        if not order_number:
            order_number = f"K{now.strftime('%H%M%S')}{now.microsecond // 10000}"

        order_details = {
            'name': name,
            'type': coffee_type.lower(),
            'milk': (milk or 'no milk').lower(),
            'size': (size or 'medium').lower(),
            'sugar': sugar,
            'notes': note,
            'strength': strength,
            'temp': temp,
            'bean_type': bean_type or None,
            'service': service,
            # The barista's walk-up form posts here too (channel 'walkin' ->
            # 'barista'); keep the legacy order_type honest for it.
            'order_type': 'walk-in' if req_channel == 'barista' else 'kiosk',
            'created_by': 'barista' if req_channel == 'barista' else 'kiosk',
            # Explicit 'chose texts' flag from the kiosk/app/phone flows (None
            # when the caller predates it) -- reportable without inference.
            'sms_opt_in': (bool(data.get('sms_opt_in')) if 'sms_opt_in' in data else None),
            # How they told us who they were: badge / app / remembered /
            # number / name (see KioskOrder identifiedBy). A report line, so
            # the next client can be told what people actually choose.
            'identified_by': (str(data.get('identified_by'))[:20]
                              if data.get('identified_by') in ('badge', 'app', 'remembered', 'number', 'name') else None),
            # Set from the notes-box VIP code. Was hardcoded False, which
            # is what a kiosk order used to be before a code could redeem
            # one -- and which, as a SECOND 'vip' key in this same dict,
            # would silently beat any value added above it.
            'vip': kiosk_vip,
            # Why, when the EventsAir rule made them one -- "Speaker" on the
            # barista card beside the Priority pill, so staff can see it.
            **({'vip_reason': vip_reason} if vip_reason else {}),
            # Placed inside the Demo Room (cupq.app/demo): Wipe demo removes
            # it and nothing else. See routes/demo_routes.py.
            **({'demo': True} if data.get('demo') is True else {}),
            'station_id': target,
            'stationId': target,
        }
        # Gate 2, same check SMS runs: the resolved recipe's tracked
        # ingredients must be available (strict mode). A customer at the
        # touchscreen must not be able to order a mocha the SMS channel
        # is already refusing for lack of chocolate powder -- one gate,
        # every door.
        try:
            _mk_ok, _mk_msg = coffee_system.check_order_makeable(order_details)
        except Exception:
            _mk_ok, _mk_msg = True, ''
        if not _mk_ok:
            # Counted, so the report can say what we could not serve
            # (finding 4). The customer's message is unchanged.
            try:
                coffee_system._count_refusal(req_channel or 'web', order_details, message=_mk_msg)
            except Exception:
                pass
            return jsonify({'success': False, 'message': _mk_msg}), 409

        stamp_provenance(order_details, req_channel, req_source, data.get('surface'))
        if ea_contact_id:
            # EA-linked kiosk order: carries the contact id so Phase-2
            # write-back (and future EA notifications) can find them.
            order_details['ea_contact_id'] = ea_contact_id
        try:
            if hasattr(coffee_system, '_compute_order_price'):
                pv, pf = coffee_system._compute_order_price({
                    'type': order_details['type'], 'milk': order_details['milk'],
                    'size': order_details['size'], 'sugar': order_details['sugar'],
                    'vip': kiosk_vip,
                })
                if pv is not None:
                    order_details['price'] = pv
                    order_details['price_formatted'] = pf
        except Exception as e:
            logger.warning(f"kiosk price compute failed (non-fatal): {e}")

        # Pay-to-order (services/payments.py): the order is not placed until
        # the phone payment lands -- it waits as awaiting_payment, which no
        # queue shows, and Square's webhook turns it pending. Only when
        # Square can actually give us a link; otherwise the order goes
        # through as pay-to-collect would, because a coffee must never be
        # held on a payment system that is not there.
        _initial_status = 'pending'
        _pay_mode = 'honour'
        try:
            _pr0 = _pricing_for(db)
            _pay_mode = (_pr0.get('mode') or 'honour') if _pr0.get('enabled') else 'honour'
            if _pay_mode == 'pay_to_order' and order_details.get('price') \
                    and feature_allowed(db, 'square'):
                from routes.square_routes import client_for as _sq_client
                if _sq_client(db):
                    _initial_status = 'awaiting_payment'
        except Exception as _pm:
            logger.debug(f"pay mode check skipped: {_pm}")
        ins = db.cursor()
        ins.execute('''
            INSERT INTO orders (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, order_number
        ''', (order_number, phone, json.dumps(order_details), _initial_status, target, now, now,
              1 if kiosk_vip else 5))
        res = ins.fetchone()
        db.commit()
        order_id = res[0] if res else None
        order_number = res[1] if (res and len(res) > 1) else order_number
        logger.info(f"Kiosk order {order_number} created at station {target} (id {order_id})")

        # A Square Payment Link for the beacon and the ready text, when the
        # operator wants the phone to pay. Quick, and never fails the order.
        payment_link = ''
        if _pay_mode != 'honour' and order_details.get('price') and feature_allowed(db, 'square'):
            try:
                from routes.square_routes import attach_payment_link as _attach_link
                payment_link = _attach_link(db, order_number, order_details.get('price'),
                                            f"{_drink_display_name(order_details)} for {name or 'you'}") or ''
            except Exception as _pl:
                logger.debug(f"square link skipped: {_pl}")

        try:
          if _initial_status == 'pending':
            _emit_new_order({
                'order_number': order_number, 'id': order_number, 'status': 'pending',
                'station_id': target, 'stationId': target,
                'created_at': now.isoformat() + 'Z', 'createdAt': now.isoformat() + 'Z',
                'wait_time': 0, 'waitTime': 0,
                'customer_name': name, 'customerName': name,
                'coffee_type': _drink_display_name(order_details), 'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details['milk'], 'milkType': order_details['milk'],
                'sugar': order_details['sugar'], 'size': order_details['size'],
                'vip': kiosk_vip,
            })
        except Exception as e:
            logger.debug(f"kiosk WS emit skipped: {e}")

        try:
            dbtype = 'sqlite' if 'sqlite3' in str(type(db)).lower() else 'postgres'
            if hasattr(coffee_system, '_decrement_stock_for_order'):
                stock_result = coffee_system._decrement_stock_for_order(db, dbtype, target, order_details)
                # Persist the "stock taken" flag on the STORED order so a later
                # cancel can give it back (the row was inserted before this
                # decrement ran, so its order_details didn't carry the flag).
                order_details['_stock_decremented'] = True
                try:
                    db.cursor().execute(
                        'UPDATE orders SET order_details = %s WHERE order_number = %s',
                        (json.dumps(order_details), order_number),
                    )
                except Exception as _pf:
                    logger.warning(f"could not persist _stock_decremented on kiosk order: {_pf}")
                db.commit()
        except Exception as e:
            stock_result = {'decremented': [], 'skipped': [], 'errors': [str(e)]}
            logger.warning(f"kiosk stock decrement failed (non-fatal): {e}")
            try:
                db.rollback()
            except Exception:
                pass

        station_name = f"Station {target}"
        station_location = ''
        try:
            nc = db.cursor()
            # Operator labels live in notes/equipment_notes on this schema
            # (see station_api_routes); name holds seed defaults.
            nc.execute("SELECT COALESCE(notes,''), COALESCE(equipment_notes,''), "
                       "COALESCE(name,'') FROM station_stats WHERE station_id = %s",
                       (target,))
            nr = nc.fetchone()
            if nr:
                _n, _loc, _nm = ((nr.get('notes'), nr.get('equipment_notes'), nr.get('name'))
                                 if isinstance(nr, dict) else (nr[0], nr[1], nr[2]))
                station_name = _n or _nm or station_name
                station_location = _loc or ''
        except Exception:
            pass

        # Kiosk ticket stub: self-entry customers get the same
        # deli-counter number slip as barista walk-ups when the
        # designer's ticket toggle is on. Fire-and-forget.
        try:
            from routes.print_routes import maybe_print_ticket
            maybe_print_ticket(db, order_number, target)
        except Exception:
            pass

        from utils.order_owner import order_key
        resp_payload = {
            'success': True,
            'order_number': order_number,
            # Proof of ownership for cancel / "got it" (utils/order_owner.py).
            'order_key': order_key(order_number),
            'payment_link': payment_link,
            'awaiting_payment': _initial_status == 'awaiting_payment',
            'station_id': target,
            'station_name': station_name,
            'station_location': station_location,
            'reassigned': reassigned,
            # The notes AS STORED -- with any VIP code already removed.
            #
            # The kiosk confirmation screen shows a summary of the order so
            # the customer can see it all arrived. It was showing what they
            # TYPED, which still contains the code, in large text, on the
            # cart's shared screen, for fifteen seconds, with the next
            # person in the queue standing behind them. Steve caught it on
            # an iPad: "Full Cream - no sugar - strong - Treenetvip".
            #
            # The client cannot strip it itself -- it does not know the
            # codes, and it must not, or they would ship in the bundle. So
            # the server hands back the cleaned text and the screen shows
            # that instead.
            'notes': note,
        }
        # Test/diagnostic aid: when the caller asks (debug_stock: true), echo
        # what the stock decrement actually did — decremented rows, skipped
        # items with reasons, and any swallowed SQL errors. Lets the Test
        # Bench show WHY a counter didn't move instead of guessing.
        if data.get('debug_stock'):
            try:
                resp_payload['stock_debug'] = stock_result
            except NameError:
                resp_payload['stock_debug'] = {'error': 'decrement not reached'}
        return jsonify(resp_payload)
    except Exception as e:
        logger.error(f"create_kiosk_order error: {e}")
        try:
            cs = current_app.config.get('coffee_system')
            if cs and getattr(cs, 'db', None):
                cs.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': 'Could not place your order. Please see a barista.'}), 500



@bp.route('/display/order-group', methods=['POST'])
def create_kiosk_order_group():
    """Place several drinks as ONE collected group from the app / QR.

    Each item runs through the SAME single-order path (recipe resolve,
    stock gate, provenance stamp) so a group can never sneak an
    unmakeable drink past the gate. Then they are linked by a shared
    group_id (the lead order's number) + position, so the barista serves
    them together and each cup labels as <lead>-<pos> Name. This is the
    app-side of the SMS FRIEND flow Steve wanted on /my + QR.
    """
    coffee_system = current_app.config.get('coffee_system')
    if not coffee_system or not getattr(coffee_system, 'db', None):
        return jsonify({'success': False, 'message': 'Service unavailable'}), 503
    db = coffee_system.db
    body = request.get_json(silent=True) or {}
    items = body.get('items') or []
    if not isinstance(items, list) or not items:
        return jsonify({'success': False, 'message': 'No drinks in the group'}), 400
    items = items[:10]

    if len(items) > 1:
        from utils.plan_limits import feature_allowed, GROUP_ORDER_DISABLED_MESSAGE
        if not feature_allowed(db, 'group_orders'):
            return jsonify({'success': False, 'message': GROUP_ORDER_DISABLED_MESSAGE}), 403

    shared = {k: body.get(k) for k in (
        'phone', 'use_registered_phone', 'ea_contact_id', 'station_id',
        'preferred_station', 'channel', 'src', 'e', 'lookup_phone',
        'event_password', 'sms_opt_in', 'surface', 'identified_by', 'demo') if k in body}

    # Letter the round: reserve ONE base (336) and pre-assign 336a/336b/336c
    # so the sequence advances once per round (no gaps) and every surface
    # sees the final number from the start. Only for 2+ drinks -- a single
    # drink is never "336a". If the sequence is unavailable, fall back to
    # today's per-drink numbering rather than refuse the order.
    from utils.order_numbering import (
        reserve_order_base, lettered, authorise_preassigned, discard_preassigned)
    _base = reserve_order_base(db) if len(items) >= 2 else None
    _letters = [lettered(_base, i) for i in range(1, len(items) + 1)] if _base else []
    if _letters:
        authorise_preassigned(_letters)

    placed, failed = [], []
    # One station per round: whatever station the FIRST cup lands on (the
    # caller's choice, or wherever load-balancing put it), every later cup
    # is pinned there and locked -- see lock_station in create_kiosk_order.
    _round_station = None
    with current_app.test_client() as c:
        for _i, it in enumerate(items, start=1):
            payload = dict(shared)
            if _letters:
                payload['_order_number'] = _letters[_i - 1]
            if _round_station is not None:
                payload['station_id'] = _round_station
                payload['preferred_station'] = _round_station
                payload['lock_station'] = True
            payload.update({
                'name': (it.get('name') or shared.get('name') or 'Guest'),
                'coffee_type': it.get('coffee_type') or it.get('drink'),
                'milk': it.get('milk') or 'no milk',
                'size': it.get('size') or 'medium',
                'sugar': it.get('sugar') or 'No sugar',
                'strength': it.get('strength') or '',
                'temp': it.get('temp') or '',
                'bean_type': it.get('bean_type') or '',
                'notes': it.get('notes') or '',
            })
            try:
                r = c.post('/api/display/order', json=payload)
                jb = r.get_json() or {}
                if r.status_code == 200 and jb.get('success'):
                    placed.append((jb.get('order_number'), payload['name']))
                    if _round_station is None and jb.get('station_id') is not None:
                        _round_station = jb.get('station_id')
                else:
                    failed.append((payload['name'], jb.get('message') or 'unavailable'))
            except Exception as e:
                failed.append((payload.get('name'), str(e)[:80]))

    # Any letter a failed drink never consumed must not linger in the
    # allow-list (a later request could not use it anyway -- the value is
    # unique to this round -- but keep the set from growing).
    if _letters:
        discard_preassigned(_letters)

    if not placed:
        return jsonify({'success': False,
                        'message': 'None of the drinks could be placed',
                        'failed': [{'name': n, 'reason': r} for n, r in failed]}), 409

    # group_id is the ROUND's number: the reserved base ("336") when the
    # drinks were lettered, else (fallback path) the lead drink's number as
    # before. The one-per-round ready SMS says "order #<group_id>" and the
    # label/beacon derive the round from it.
    group_id = str(_base) if (_letters and placed) else str(placed[0][0])
    from utils.order_owner import order_key as _order_key
    try:
        cur = db.cursor()
        for pos, (num, _nm) in enumerate(placed, start=1):
            cur.execute(
                "UPDATE orders SET order_details = "
                "COALESCE(order_details::jsonb, '{}'::jsonb) || %s::jsonb "
                "WHERE order_number = %s",
                (json.dumps({'group_id': group_id, 'group_position': pos,
                             'group_size': len(placed)}), str(num)))
        db.commit()
    except Exception as e:
        logger.warning(f"group link failed (orders still placed): {e}")
        try:
            db.rollback()
        except Exception:
            pass

    return jsonify({
        'success': True,
        'group_id': group_id,
        # order_number is what the kiosk hands to the beacon redirect and
        # remembers as the live order, so it must be a REAL order: the lead
        # drink (336a). The bare round number (336) is no order's name once
        # a round is lettered; it is returned separately as group_number.
        'order_number': str(placed[0][0]),
        # The round's key: good for every drink in it (utils/order_owner.py).
        'order_key': _order_key(group_id),
        'group_number': group_id,
        'orders': [{'order_number': n, 'name': nm} for n, nm in placed],
        'count': len(placed),
        'failed': [{'name': n, 'reason': r} for n, r in failed],
    })



@bp.route('/kiosk/verify-pin', methods=['POST'])
@_pin_limiter.limit("15 per minute; 120 per hour", key_func=_pin_client_ip)
def kiosk_verify_pin():
    """Gate for the hidden device admin panel (demo findings A3).

    Public by necessity -- a locked kiosk has no JWT -- so the PIN is
    verified HERE, never shipped to the client. The panel this guards
    is the escape hatch from iOS standalone mode (no browser chrome,
    no way out) and the device-failover path: display -> barista
    terminal in twenty seconds.

    Two kinds of PIN open it (utils/pins.py): a person's own PIN, set in
    Runner > People, or the shared event PIN (settings.kiosk_pin, default
    1234) unless an organiser has switched that off. Every attempt is
    logged with who it was, so the reply names them too. Wrong attempts
    pay a small delay; the reply says whether the default event PIN is
    still in use so the panel can nag.
    """
    import time as _time
    try:
        from utils.pins import verify as _verify_pin
        try:
            from security_middleware import _client_ip
            ip = _client_ip()
        except Exception:
            ip = request.remote_addr
        data = request.get_json(silent=True) or {}
        coffee_system = current_app.config.get('coffee_system')
        res = _verify_pin(coffee_system.db, data.get('pin'),
                          surface=str(data.get('surface') or ''), ip=ip)
        if not res['ok']:
            _time.sleep(0.4)  # brute-force tax
            try:
                from services.logging_utils import event as _event
                _event('KIOSK_PIN_FAIL', remote_addr=ip)
            except Exception:
                pass
            return jsonify({'success': False}), 401
        return jsonify({'success': True, 'default_pin': res['default_pin'],
                        'who': res['who']})
    except Exception as e:
        logger.error(f"kiosk_verify_pin error: {e}")
        return jsonify({'success': False}), 500



@bp.route('/qr', methods=['GET'])
def generate_qr():
    """Public QR PNG generator: /api/qr?data=<urlencoded>&size=10

    Powers the scan-to-order posters and the delegate splash screen —
    both the WEB ordering link and the pre-filled SMS link. Public
    because the things it encodes are public (an ordering URL, the
    event's own SMS number); it encodes whatever it's given and reads
    nothing from the database."""
    data = request.args.get('data') or ''
    if not data or len(data) > 512:
        return jsonify({'success': False,
                        'message': 'data required (max 512 chars)'}), 400
    try:
        box = max(4, min(20, int(request.args.get('size') or 10)))
    except (TypeError, ValueError):
        box = 10
    try:
        import io as _io
        import qrcode
        qr = qrcode.QRCode(border=2, box_size=box,
                           error_correction=qrcode.constants.ERROR_CORRECT_M)
        qr.add_data(data)
        qr.make(fit=True)
        img = qr.make_image(fill_color='black', back_color='white')
        buf = _io.BytesIO()
        img.save(buf, format='PNG')
        return Response(buf.getvalue(), mimetype='image/png',
                        headers={'Cache-Control': 'public, max-age=300'})
    except Exception as e:
        logger.error(f"generate_qr error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500



@bp.route('/display/orders', methods=['GET'])
def get_display_orders():
    """Get orders for the display screen"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for in-progress orders (limited to most recent 10)
        cursor = db.cursor()
        
        # Get in-progress orders
        cursor.execute('''
            SELECT id, order_number, status, station_id, 
                   created_at, phone, order_details
            FROM orders 
            WHERE status = 'in-progress'
            ORDER BY created_at DESC
            LIMIT 10
        ''')
        
        # Process in-progress orders
        in_progress_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                try:
                    order_details = json.loads(order_details_json)
                except Exception:
                    order_details = {}
            else:
                order_details = order_details_json
            if not isinstance(order_details, dict):
                order_details = {}

            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            # Format order for display
            in_progress_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': customer_name,
                'customerName': customer_name,
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),
                'status': status,
                'stationId': station_id,
                'station_id': station_id,
            })
        
        # Get completed orders that are ready for pickup (limited to most recent 10)
        # NOTE: picked_up_at is a TIMESTAMP — comparing it to '' is a
        # Postgres ERROR, which made this whole endpoint throw and serve
        # the demo fallback (fake "John D."/"Sarah M." orders) on every
        # single call in production. IS NULL is the only empty-check.
        cursor.execute('''
            SELECT id, order_number, status, station_id,
                   created_at, completed_at, phone, order_details
            FROM orders
            WHERE status = 'completed' AND picked_up_at IS NULL
            ORDER BY completed_at DESC
            LIMIT 10
        ''')
        
        # Process ready orders
        ready_orders = []
        for order in cursor.fetchall():
            # Extract order details
            order_id, order_number, status, station_id, created_at, completed_at, phone, order_details_json = order
            
            # Parse order details
            if isinstance(order_details_json, str):
                try:
                    order_details = json.loads(order_details_json)
                except Exception:
                    order_details = {}
            else:
                order_details = order_details_json
            if not isinstance(order_details, dict):
                order_details = {}

            # Extract customer name
            customer_name = order_details.get('name', 'Customer')
            
            
            # Format order for display
            ready_orders.append({
                'id': order_number,
                'order_number': order_number,
                'orderNumber': order_number,            # camelCase
                'customer_name': customer_name,
                'customerName': customer_name,
                'coffee_type': _drink_display_name(order_details),
                'coffeeType': _drink_display_name(order_details),
                'milk_type': order_details.get('milk', 'Standard'),
                'milkType': order_details.get('milk', 'Standard'),
                'status': status,
                'stationId': station_id,
                'station_id': station_id,
                'completed_at': completed_at,
                'completedAt': completed_at.isoformat() if (completed_at and hasattr(completed_at, 'isoformat')) else completed_at,
            })
        
        # Return real order data
        return jsonify({
            "success": True,
            "orders": {
                "inProgress": in_progress_orders,
                "ready": ready_orders
            },
            "timestamp": datetime.now().isoformat()
        })
    
    except Exception as e:
        logger.error(f"Error getting display orders: {str(e)}")
        try:
            coffee_system = current_app.config.get('coffee_system')
            if coffee_system:
                coffee_system.db.rollback()
        except Exception:
            pass
        # An EMPTY board, never fake orders. This fallback used to return
        # demo customers ("John D.", "Sarah M.") — and because the ready
        # query above compared a TIMESTAMP to '', it errored on EVERY call,
        # so the public pickup display served those fake names in
        # production. An empty board is always safe; fake names are not.
        return jsonify({
            "success": True,
            "orders": {"inProgress": [], "ready": []},
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        })



@bp.route('/display/bg-video', methods=['GET'])
def get_display_bg_video():
    """Display background video (portrait + landscape). PUBLIC — the display
    screens read it with no login."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        d = _kv_get(coffee_system.db, 'display_bg_video', default={}) or {}
        return jsonify({
            'success': True,
            'portrait': d.get('portrait') or '',
            'landscape': d.get('landscape') or '',
        })
    except Exception as e:
        logger.error(f"get_display_bg_video error: {e}")
        return jsonify({'success': True, 'portrait': '', 'landscape': ''}), 200



@bp.route('/display/bg-video', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_display_bg_video():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json(silent=True) or {}
        payload = data.get('settings') if isinstance(data.get('settings'), dict) else data
        out = {
            'portrait': _clean_bg_video(payload.get('portrait')),
            'landscape': _clean_bg_video(payload.get('landscape')),
        }
        _kv_put(coffee_system.db, 'display_bg_video', out, merge=False)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_display_bg_video error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
