"""
Consolidated API routes for the Expresso Coffee Ordering System.

This module provides a standardized API structure for the entire application,
consolidating endpoints from various modules into a coherent API design.
"""
import logging
import os
import threading
from flask import Blueprint, jsonify, request, current_app, Response
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from auth import current_role, role_allowed, writes_need, MANAGER_ROLES, STAFF_ROLES
from datetime import date, datetime, timedelta
from datetime import timezone as _tz
import json
import re
from auth import jwt_required_with_demo, role_required_with_demo
from utils import event_time as _event_time
from utils.broadcast import (
    BROADCAST_KEY, applies_to as broadcast_applies, build as build_broadcast,
    is_live as broadcast_is_live)
from utils.event_access import (
    ACCESS_SETTING_KEY, check as event_access_check,
    read_settings as event_access_settings,
    password_required as event_password_required)
from utils.notification_hold import (
    HOLD_SETTING_KEY, clear_held, is_held, is_holding, mark_held,
    should_release, summarise as summarise_held,
    HELD_FLAG)
from utils.order_eta import (
    describe as eta_describe, estimate_minutes as eta_estimate_minutes,
    seconds_per_coffee as eta_seconds_per_coffee)
from utils.order_provenance import (
    CHANNELS, SELF_SERVE, SURFACES, channel_label, infer_channel,
    infer_surface, is_estimated as provenance_estimated, normalize_channel,
    normalize_source, normalize_surface, stamp as stamp_provenance,
    surface_label)

# Configure logging
logger = logging.getLogger("expresso.routes.consolidated_api")

# Create blueprint with url_prefix to ensure all routes are under /api
bp = Blueprint('consolidated_api', __name__, url_prefix='/api')

# The PIN pad is the one public endpoint that guards staff screens, so it is
# rate limited per real client (Cloudflare-aware, as for /login).
from security_middleware import limiter as _pin_limiter, _client_ip as _pin_client_ip

# Helper function to handle CORS preflight requests
@bp.route('/<path:path>', methods=['OPTIONS'])
def handle_options(path):
    """Handle OPTIONS requests for CORS preflight"""
    return '', 200

# Helper function to clean order IDs
def clean_order_id(order_id):
    """Remove prefixes like 'order_' from IDs and return the base ID"""
    if not order_id:
        return None
        
    # If it's an order_123 format, extract the numeric part
    if isinstance(order_id, str):
        match = re.match(r'^order_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_in_progress_123 format, extract the numeric part
        match = re.match(r'^order_in_progress_([0-9]+)$', order_id)
        if match:
            return match.group(1)
            
        # If it's order_completed_123 format, extract the numeric part
        match = re.match(r'^order_completed_([0-9]+)$', order_id)
        if match:
            return match.group(1)
    
    # Return as-is if it's already clean or doesn't match patterns
    return order_id

# Role-based access middleware
def role_required(roles):
    """Decorator to check if user has required role"""
    def decorator(fn):
        @jwt_required_with_demo()
        def wrapper(*args, **kwargs):
            # Check if user's role is in the allowed roles
            if not role_allowed(current_role(), roles):
                return jsonify({
                    'success': False, 
                    'message': 'Insufficient permissions'
                }), 403
                
            # Role is valid, proceed with the function
            return fn(*args, **kwargs)
        
        # Preserve original function's name and docstring
        wrapper.__name__ = fn.__name__
        wrapper.__doc__ = fn.__doc__
        
        return wrapper
    return decorator


# ============================================================================
# AUTHENTICATION ENDPOINTS
# ============================================================================

# Not routed (roadmap X7-10): POST /api/auth/login is served by auth.api_login.
def auth_login():
    """Login endpoint that returns JWT tokens"""
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Request must be JSON"}), 400
        
        data = request.json
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({
                'success': False,
                'message': 'Username and password are required'
            }), 400
        
        # Import function to keep consistent with existing code
        from auth import verify_login, generate_tokens
        
        # Verify login directly with the database
        user_data = verify_login(username, password)
        
        if not user_data:
            return jsonify({
                'success': False,
                'message': 'Invalid username or password'
            }), 401
        
        # Generate tokens
        tokens = generate_tokens(user_data)
        
        # Return success response with tokens and user data
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'token': tokens['access_token'],
            'refreshToken': tokens['refresh_token'],
            'expiresIn': tokens['expires_in'],
            'user': user_data
        })
    
    except Exception as e:
        logger.error(f"Error during login: {str(e)}")
        return jsonify({
            'success': False,
            'message': f'Internal server error: {str(e)}'
        }), 500

# Not routed (roadmap X7-10): POST /api/auth/refresh is served by auth.refresh_token.
def auth_refresh():
    """Refresh access token using a refresh token"""
    try:
        if not request.is_json:
            return jsonify({"success": False, "message": "Request must be JSON"}), 400
        
        data = request.json
        refresh_token = data.get('refreshToken')
        
        if not refresh_token:
            return jsonify({
                'success': False,
                'message': 'Refresh token is required'
            }), 400
        
        # Import function to keep consistent with existing code
        from auth import refresh_access_token
        
        # Verify the refresh token and generate a new access token
        result = refresh_access_token(refresh_token)
        
        if not result or 'token' not in result:
            return jsonify({
                'success': False,
                'message': 'Invalid refresh token'
            }), 401
        
        # Return new access token
        return jsonify({
            'success': True,
            'token': result['token'],
            'expiresIn': result['expiresIn']
        })
    
    except Exception as e:
        logger.error(f"Error during token refresh: {str(e)}")
        return jsonify({
            'success': False,
            'message': 'Internal server error'
        }), 500

# ============================================================================
# ORDER MANAGEMENT ENDPOINTS
# ============================================================================

def _pending_questions_by_phone(cursor):
    """Latest PENDING customer question per phone, so a customer's SMS
    ("no sugar thanks", "make it decaf") shows ON their order card — not
    only in the Messages bubble (Steve: "question or additional info via
    SMS should probably appear in the order of that individual")."""
    try:
        cursor.execute("""
            SELECT phone, question FROM customer_questions
            WHERE status = 'pending'
            ORDER BY created_at ASC
        """)
        out = {}
        for r in cursor.fetchall():
            ph = r[0] if not isinstance(r, dict) else r.get('phone')
            q = r[1] if not isinstance(r, dict) else r.get('question')
            if ph and q:
                out[str(ph)] = str(q)  # later rows overwrite = latest wins
        return out
    except Exception as e:
        # Empty means "no unanswered questions", which hides real ones
        # when this read breaks -- say so (sweep 7: fail-open review).
        logger.warning(f"questions_by_phone read failed; cards show none: {e}")
        return {}


def _drink_display_name(order_details, default='Coffee'):
    """Barista-facing drink name WITH the modifiers that change how it's
    made. order_details['type'] is the bare drink ('latte'); decaf and
    strength live in separate keys — a card that shows only 'latte' gets a
    decaf customer a caffeinated coffee (found by the Test Bench's matrix
    modifier check: SMS confirmed 'decaf' but the pending API dropped it)."""
    if not isinstance(order_details, dict):
        return default
    t = order_details.get('type') or default
    strength = str(order_details.get('strength') or '').strip().lower()
    bits = []
    if order_details.get('decaf') or strength == 'decaf':
        bits.append('decaf')
    if strength and strength not in ('decaf', 'normal'):
        bits.append(strength)
    return ' '.join(bits + [str(t)]) if bits else t


def _station_can_make_order(db, station_id, order_details):
    """Return {'blocked': bool, 'reason': str} for whether a station can
    make this drink.

    Capabilities live in station_stats.capabilities (JSONB) — populated
    by the Capabilities editor UI. Shape we honour:

      {
        "coffee_types": ["latte", "cappuccino"],   # optional, list
        "milk_types":   ["full cream", "skim"],    # optional, list
        "alt_milk":     true,                       # boolean flag
        ...
      }

    Only block when the list is explicitly set AND doesn't include the
    requested item. Missing / empty lists are interpreted as "no
    restriction" so the organiser doesn't have to enumerate every
    station's full menu just to enable order claiming.
    """
    try:
        station_id_int = int(station_id)
    except (TypeError, ValueError):
        return {'blocked': False, 'reason': ''}

    requested_type = (order_details.get('type') or '').strip().lower()
    requested_milk = (order_details.get('milk') or '').strip().lower()

    # 'no milk' (black coffee / tea) is ALWAYS makeable — every station
    # can not-add milk. Without this, the canonicaliser below stripped
    # the ' milk' suffix, turned 'no milk' into 'no', found 'no' in no
    # station's milk list, and BLOCKED every long black at every station
    # (full-sweep regression, matrix mx05/07/11/12).
    if requested_milk in ('no milk', 'none', 'black'):
        requested_milk = ''

    # Strip decaf prefix from drink type for the capability check —
    # decaf flat white is still a flat white capability-wise.
    if requested_type.startswith('decaf '):
        requested_type = requested_type[6:].strip()

    try:
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()
        cursor.execute(
            "SELECT capabilities FROM station_stats WHERE station_id = %s",
            (station_id_int,),
        )
        row = cursor.fetchone()
    except Exception as e:
        logger.warning(f"Capabilities lookup failed for station {station_id_int}: {e}")
        return {'blocked': False, 'reason': ''}

    if not row:
        return {'blocked': False, 'reason': ''}

    caps_raw = row[0] if not isinstance(row, dict) else row.get('capabilities')
    if not caps_raw:
        return {'blocked': False, 'reason': ''}
    if isinstance(caps_raw, str):
        try:
            caps_raw = json.loads(caps_raw)
        except Exception:
            return {'blocked': False, 'reason': ''}
    if not isinstance(caps_raw, dict):
        return {'blocked': False, 'reason': ''}

    # Only ESPRESSO drinks are gated by a station's coffee_types capability.
    # Non-espresso drinks (tea, hot chocolate, chai, matcha) are enabled
    # event-wide in inventory and aren't tied to a station's espresso menu —
    # Quick Setup only ever seeds coffee_types with espresso drinks, so
    # blocking on it would make every tea/hot-choc un-startable. Let them pass.
    coffee_types = caps_raw.get('coffee_types') or caps_raw.get('drinks')
    _espresso_set = [d.lower() for d in ESPRESSO_DRINKS]
    _caps_lower = ([str(c).lower() for c in coffee_types]
                   if isinstance(coffee_types, list) else [])
    if (
        requested_type
        and requested_type in _espresso_set
        # 'espresso drinks' is the capabilities editor's family token:
        # a station that claims the family makes ANY espresso drink the
        # event enables, so the explicit list stops being a fence.
        and 'espresso drinks' not in _caps_lower
        and isinstance(coffee_types, list)
        and len(coffee_types) > 0
        and requested_type not in _caps_lower
    ):
        return {
            'blocked': True,
            'reason': (
                f"This station isn't set up to make {requested_type}. "
                f"Available here: {', '.join(c for c in coffee_types if str(c).lower() != 'espresso drinks')}."
            ),
        }

    milk_types = caps_raw.get('milk_types') or caps_raw.get('milks')
    if (
        requested_milk
        and isinstance(milk_types, list)
        and len(milk_types) > 0
    ):
        # Catalog-driven canonicalisation. Build a synonym map at
        # request time by reading catalog_items.properties.synonyms +
        # display_name / short_name / item_id for every milk. Anything
        # the operator or walk-in dialog throws at us — 'Whole Milk',
        # 'full cream', 'oat milk', 'OAT' — collapses to the canonical
        # item_id ('full_cream', 'oat') before comparison.
        #
        # Falls back to a static synonym set if catalog_items is
        # missing (fresh DB before migration ran).
        _STATIC_FALLBACK = {
            'whole milk': 'full_cream', 'whole': 'full_cream',
            'full cream': 'full_cream', 'regular': 'full_cream',
            'standard': 'full_cream', 'dairy': 'full_cream',
            'skim': 'skim', 'skinny': 'skim',
            'low fat': 'skim', 'trim': 'skim',
            'oat': 'oat', 'soy': 'soy', 'soya': 'soy',
            'almond': 'almond', 'coconut': 'coconut',
            'macadamia': 'macadamia', 'rice': 'rice',
            'lactose free': 'lactose_free',
            'lactose-free': 'lactose_free',
        }
        synonym_map = {}
        try:
            c2 = db.cursor()
            c2.execute("""
                SELECT item_id, display_name, short_name, properties
                FROM catalog_items
                WHERE category = 'milk' AND is_active = TRUE
            """)
            for iid, dn, sn, props in c2.fetchall():
                # Self + display + short variants
                for v in (iid, dn, sn):
                    if v:
                        key = v.strip().lower().removesuffix(' milk')
                        synonym_map[key] = iid
                # Explicit synonyms from properties JSONB
                for syn in (props or {}).get('synonyms', []):
                    synonym_map[str(syn).strip().lower()] = iid
        except Exception:
            synonym_map = dict(_STATIC_FALLBACK)

        def _milk_canon(s):
            t = (s or '').strip().lower()
            if t.endswith(' milk'):
                t = t[:-5].strip()
            elif t == 'milk':
                t = ''
            return synonym_map.get(t, t)

        requested_canon = _milk_canon(requested_milk)
        available_canon = {_milk_canon(m) for m in milk_types}
        if requested_canon and requested_canon not in available_canon:
            return {
                'blocked': True,
                'reason': (
                    f"This station doesn't stock {requested_milk}. "
                    f"Available here: {', '.join(milk_types)}."
                ),
            }

    return {'blocked': False, 'reason': ''}


def _emit_order_status_change(order_number, status):
    """Fire-and-forget SocketIO emit so connected clients refresh.

    Forwarded by WebSocketService.js to the 'order_updated' window
    event, which useOrders + DisplayScreen + ReadyForPickupColumn
    all subscribe to. Without this, status changes only became
    visible on the next 15s poll. Steve hit this with Complete:
    "they are not going to the completed column" — the local
    optimistic update fired, but anything looking at the backend's
    canonical view (Ready-for-Pickup column, customer Display) had
    to wait for the poll.
    """
    try:
        socketio = current_app.config.get('socketio')
        if socketio:
            socketio.emit(
                'order_updated',
                {'order_number': order_number, 'status': status},
                room='orders',
            )
    except Exception as e:
        # Never let a WS emit failure break the request.
        logger.debug(f"socketio emit skipped: {e}")


# Default policy for the "started" SMS.
#
# Setting key: sms_started_policy  (settings table, JSON)
# Shape: {"policy": "always" | "queue_only" | "never",
#         "threshold_seconds": 60 }
#
# Default = queue_only at 60s: skip the started SMS for orders that
# were started within 60s of being created (no real queue happened).
# Saves a wasted SMS for instant-fulfilment walk-ins and SMS orders.
_SMS_STARTED_POLICY_DEFAULT = {
    'policy': 'queue_only',
    'threshold_seconds': 60,
}


def _should_send_started_sms(db, created_at):
    """Apply the operator's started-SMS policy.

    Args:
        db: the singleton DB connection (for settings lookup).
        created_at: when the order was created (datetime or naive
                    ISO string from Postgres).

    Returns:
        bool — True if the SMS should fire, False if suppressed.

    Behaviour:
      - policy='always'     → always send.
      - policy='never'      → never send.
      - policy='queue_only' → only send if the order has been
                              waiting > threshold_seconds. Orders
                              started instantly (empty queue) skip
                              the SMS; the ready SMS follows soon
                              enough.

    Soft-fails safely: if the settings read errors, we fall back to
    'queue_only' default (the smart behaviour). Never raises.
    """
    try:
        cfg = _kv_get(db, 'sms_started_policy', default=None)
    except Exception as e:
        logger.debug(f"sms_started_policy read failed (default applied): {e}")
        cfg = None
    if not isinstance(cfg, dict):
        cfg = dict(_SMS_STARTED_POLICY_DEFAULT)
    policy = (cfg.get('policy') or 'queue_only').strip().lower()
    if policy == 'always':
        return True
    if policy == 'never':
        return False
    # queue_only — compute age.
    try:
        threshold = int(cfg.get('threshold_seconds', 60))
    except (TypeError, ValueError):
        threshold = 60
    if not created_at:
        # Unknown age — be safe, send. (Better one extra SMS than
        # silently suppressing a customer who's actually waiting.)
        return True
    try:
        if isinstance(created_at, str):
            ca = datetime.fromisoformat(created_at.replace('Z', ''))
        else:
            ca = created_at
        age_seconds = (datetime.now() - ca).total_seconds()
    except Exception:
        return True
    return age_seconds >= threshold


def _emit_new_order(order_payload):
    """Fire-and-forget SocketIO emit when a NEW order is created.

    Steve hit this in QC: SMS customer placed an order, the order
    appeared in the database, but the Barista UI's Upcoming Orders
    list stayed empty until the next poll (or a manual Refresh tap).
    Reason: POST /api/orders only inserted the row — never emitted
    a 'new_order'/'order_created' event for the WS layer to forward
    to the React UI's listeners.

    Frontend listener is ApiService.js webSocketService.on('order_created').
    We also emit 'new_order' to a station-scoped room so a barista
    UI filtered to one station can show fresh orders without seeing
    every station's traffic.

    Pass a dict containing at minimum order_number, status, and
    station_id; the frontend handler will merge into its local
    queue and re-render.
    """
    try:
        socketio = current_app.config.get('socketio')
        if not socketio:
            return
        socketio.emit('order_created', order_payload, room='orders')
        station_id = order_payload.get('station_id') or order_payload.get('stationId')
        if station_id is not None:
            socketio.emit(
                'new_order', order_payload, room=f'station_{station_id}',
            )
    except Exception as e:
        logger.debug(f"socketio new-order emit skipped: {e}")


def _render_sms_template(template, context, default_body):
    """Fill {placeholders} in an operator-edited SMS template, safely.

    Uses literal replace (not str.format) so a stray brace in a template
    can never crash a send. Unknown placeholders are left visible so the
    operator can SEE the typo in their test message. Falls back to the
    default when the template is empty/blank. Warns (but still sends)
    when the result leaves single-segment GSM-7 territory — emoji or
    length mistakes double per-SMS cost silently otherwise.
    """
    tpl = (template or '').strip()
    if not tpl:
        return default_body
    body = tpl
    for key, value in context.items():
        body = body.replace('{' + key + '}', str(value if value is not None else ''))
    if len(body) > 160 or any(ord(ch) > 127 for ch in body):
        logger.warning(
            f"SMS template renders outside single-segment GSM-7 "
            f"(len={len(body)}, non-ascii={any(ord(c) > 127 for c in body)}) — "
            f"this doubles per-message cost. Template: {tpl[:80]!r}")
    return body


def _sms_description(order_details):
    """Short warm drink description: 'large oat latte'."""
    parts = []
    if order_details.get('size'):
        parts.append(order_details.get('size'))
    milk = order_details.get('milk')
    if milk and milk != 'no milk':
        parts.append(f"{milk}")
    parts.append(order_details.get('type') or 'coffee')
    return ' '.join(parts)


def _render_started_message(order_number, order_details):
    """The 'being made now' SMS body — template-driven via the
    sms_started_message setting (placeholders: {name} {drink}
    {order_number} {station}); hardcoded default when unset."""
    description = _sms_description(order_details)
    default_body = (
        f"Your {description} (order #{order_number}) is being made now "
        f"- we'll text you when it's ready."
    )
    try:
        cs = current_app.config.get('coffee_system')
        tpl = cs._get_setting('sms_started_message', '') if cs else ''
    except Exception:
        tpl = ''
    return _render_sms_template(tpl, {
        'name': order_details.get('name') or 'there',
        'drink': description,
        'order_number': order_number,
        'station': order_details.get('station_id') or '',
    }, default_body)


def _is_textable_phone(phone):
    """True only for something we can actually SMS — at least 8 digits.

    Walk-in orders with no number entered were stored with the literal
    phone "Walk-in" (frontend fallback). The only guard here used to be
    `if not phone`, which "Walk-in" passes — so every ready/started SMS
    for those orders was dispatched to "Walk-in" and Twilio failed it (93
    failed sends in the logs, incl. real opt-ins at Treenet). Anything
    that isn't a real number must be treated as "no phone".
    """
    digits = ''.join(ch for ch in str(phone or '') if ch.isdigit())
    return len(digits) >= 8


def _notify_customer_order_started(phone, order_number, order_details):
    """Send a brief 'your drink is being made now' SMS.

    Never raises — the order has already been started in the DB by the
    time we get here, so a messaging failure must not roll that back.
    """
    if not _is_textable_phone(phone):
        return
    try:
        messaging_service = current_app.config.get('messaging_service')
        if not messaging_service:
            logger.warning("No messaging_service configured; skipping start notification")
            return

        # THE HOLD APPLIES HERE TOO -- and this was missed when the hold
        # shipped. Its whole purpose is pre-orders: take them beforehand,
        # make them during a session, tell nobody until the break. With
        # only the READY path held, starting each coffee still texted the
        # customer, so a hold that was supposed to keep 400 phones quiet
        # let the first half of the messages straight through.
        #
        # DROPPED, not queued. A "your drink is being made now" released
        # forty minutes later, next to a "ready" from the same batch, is
        # worse than never sending it -- it is stale and it is confusing.
        # The ready message is the one worth keeping; this one only has
        # value in the moment it would have been sent.
        try:
            _db_h = current_app.config.get('coffee_system').db
            if is_holding(_kv_get(_db_h, HOLD_SETTING_KEY, default=None)):
                logger.info(f"Order {order_number}: started-SMS skipped (hold is on)")
                return
        except Exception as _h_err:
            # A broken hold must never silence a customer: fall through
            # and send, which is the behaviour without the feature.
            logger.warning(f"hold check failed on started-SMS, sending: {_h_err}")
            try:
                current_app.config.get('coffee_system').db.rollback()
            except Exception:
                pass

        # order_details may be a JSON string (depending on cursor type)
        # or a dict. Normalise.
        if isinstance(order_details, str):
            try:
                import json as _json
                order_details = _json.loads(order_details)
            except Exception:
                order_details = {}

        if not isinstance(order_details, dict):
            order_details = {}

        # ONE "being made" text per round. Starting cup b or c of a round
        # says nothing; the first cup started sends "your 3 coffees are
        # being made", guarded by a flag on the lead (same lead resolution
        # as the ready text: a lettered round's lead is <base>a). Steve:
        # a 15-coffee round must not be 15 texts.
        _group_id = order_details.get('group_id')
        if _group_id:
            try:
                _gdb = current_app.config.get('coffee_system').db
                _gcur = _gdb.cursor()
                _gcur.execute(
                    "SELECT order_number, order_details FROM orders "
                    "WHERE order_number IN (%s, %s) ORDER BY order_number LIMIT 1",
                    (str(_group_id), f"{_group_id}a"))
                _lr = _gcur.fetchone()
                _lead_num = ((_lr[0] if not isinstance(_lr, dict) else _lr.get('order_number'))
                             if _lr else str(_group_id))
                _lraw = ((_lr[1] if not isinstance(_lr, dict) else _lr.get('order_details'))
                         if _lr else None)
                _lod = json.loads(_lraw) if isinstance(_lraw, str) else (_lraw or {})
                if not isinstance(_lod, dict):
                    _lod = {}
                if _lod.get('_group_started_sent'):
                    logger.info(f"Order {order_number}: started-SMS skipped "
                                f"(round {_group_id} already told)")
                    return
                _lod['_group_started_sent'] = True
                _gcur.execute("UPDATE orders SET order_details = %s WHERE order_number = %s",
                              (json.dumps(_lod), str(_lead_num)))
                _gcur.execute(
                    "SELECT COUNT(*) FROM orders WHERE "
                    "COALESCE(order_details::jsonb, '{}'::jsonb)->>'group_id' = %s "
                    "AND status <> 'cancelled'", (str(_group_id),))
                _cr = _gcur.fetchone()
                _n = int(((_cr[0] if not isinstance(_cr, dict) else list(_cr.values())[0]) or 0)
                         if _cr else 0)
                _gdb.commit()
                body = _render_group_started_message(
                    order_details.get('name'), _n, str(_group_id))
                messaging_service.send_message(phone, body, kind='started')
                _record_order_message(str(_lead_num), phone, body, 'sent')
                return
            except Exception as _gs_err:
                # Never let the round logic silence a customer: fall back to
                # the plain per-cup text, exactly the pre-round behaviour.
                logger.warning(f"group started-SMS failed, sending per-cup: {_gs_err}")
                try:
                    current_app.config.get('coffee_system').db.rollback()
                except Exception:
                    pass

        body = _render_started_message(order_number, order_details)
        messaging_service.send_message(phone, body, kind='started')
        _record_order_message(str(order_number), phone, body, 'sent')
    except Exception as exc:
        logger.error(f"Error sending start-notification SMS: {exc}")


def _notify_customer_order_ready(phone, order_number, order_details, station_id):
    """Send the customer a 'your drink is ready' SMS.

    Mirror of _notify_customer_order_started for the pending →
    in-progress transition. Called from /complete; safe to call with
    a blank phone (no-op). Also a no-op for a non-number like the
    "Walk-in" placeholder — see _is_textable_phone.
    """
    if not _is_textable_phone(phone):
        return
    try:
        messaging_service = current_app.config.get('messaging_service')
        if not messaging_service:
            logger.warning("No messaging_service configured; skipping ready notification")
            return

        if isinstance(order_details, str):
            try:
                import json as _json
                order_details = _json.loads(order_details)
            except Exception:
                order_details = {}
        if not isinstance(order_details, dict):
            order_details = {}

        # GROUP-AWARE READY. A round ordered together shares a group_id. Tell
        # the customer to collect only when EVERY drink is done -- otherwise
        # they get a "come collect" per drink and walk up to a half-made round
        # (Steve). Non-final drinks stay silent; the LAST one sends ONE message
        # for the whole group. Solo orders (no group_id) are unaffected.
        _group_final = None
        _group_id = order_details.get('group_id')
        if _group_id:
            try:
                _dbg = current_app.config.get('coffee_system').db
                _gc = _dbg.cursor()
                _gc.execute(
                    "SELECT COUNT(*) AS total, "
                    "COUNT(*) FILTER (WHERE status NOT IN "
                    "('completed','picked_up','cancelled')) AS remaining "
                    "FROM orders WHERE "
                    "COALESCE(order_details::jsonb, '{}'::jsonb)->>'group_id' = %s",
                    (str(_group_id),))
                _row = _gc.fetchone()
                _total, _remaining = 0, 0
                if _row:
                    if isinstance(_row, dict):
                        _total = _row.get('total') or 0
                        _remaining = _row.get('remaining') or 0
                    else:
                        _total, _remaining = (_row[0] or 0), (_row[1] or 0)
                if _remaining > 0:
                    logger.info(f"Order {order_number}: group {_group_id} ready-SMS held "
                                f"({_remaining} of {_total} still being made)")
                    return
                # Last drink done. Guard on a flag on the lead order so a rare
                # simultaneous completion can't fire the group text twice.
                # The lead order carries the flag. group_id is the ROUND's
                # number: for a legacy round that IS the lead order's number,
                # but a lettered round (336a/b/c) has no order named by its
                # bare base -- its lead is "<base>a". Try both; the bare one
                # sorts first so a legacy round still resolves to itself.
                # Writing the flag to a name no order has would silently
                # defeat this guard.
                _gc.execute(
                    "SELECT order_number, order_details FROM orders "
                    "WHERE order_number IN (%s, %s) ORDER BY order_number LIMIT 1",
                    (str(_group_id), f"{_group_id}a"))
                _lr = _gc.fetchone()
                if _lr:
                    _lead_num = _lr[0] if not isinstance(_lr, dict) else _lr.get('order_number')
                    _lraw = _lr[1] if not isinstance(_lr, dict) else _lr.get('order_details')
                else:
                    _lead_num, _lraw = str(_group_id), None
                _lod = json.loads(_lraw) if isinstance(_lraw, str) else (_lraw or {})
                if not isinstance(_lod, dict):
                    _lod = {}
                if _lod.get('_group_ready_sent'):
                    return
                _lod['_group_ready_sent'] = True
                _gc.execute("UPDATE orders SET order_details = %s WHERE order_number = %s",
                            (json.dumps(_lod), str(_lead_num)))
                _dbg.commit()
                _group_final = (str(_group_id), _total)
            except Exception as _grp_err:
                logger.warning(f"group-ready check failed, sending single: {_grp_err}")
                try:
                    current_app.config.get('coffee_system').db.rollback()
                except Exception:
                    pass
                _group_final = None

        # HOLD -- checked before anything else, because holding is a
        # decision about WHEN to tell the customer, not about how to send.
        # Putting it after the bench wall meant a bench order was never
        # marked held and the release flow could not be exercised on the
        # Test Bench at all.
        #
        # During pre-orders the coffees are made while a session is
        # running. Sending each "ready" text as it finishes puts 400
        # phones on the buzz through a plenary, and charges for every one.
        # While the hold is on the order still completes, still prints,
        # still shows ready on the board; only the text waits.
        try:
            _db_hold = current_app.config.get('coffee_system').db
            if is_holding(_kv_get(_db_hold, HOLD_SETTING_KEY, default=None)):
                _c = _db_hold.cursor()
                _c.execute("SELECT order_details FROM orders WHERE order_number = %s",
                           (order_number,))
                _r = _c.fetchone()
                if _r:
                    _raw = _r[0] if not isinstance(_r, dict) else _r.get('order_details')
                    _od = json.loads(_raw) if isinstance(_raw, str) else (_raw or {})
                    mark_held(_od)
                    _c.execute(
                        "UPDATE orders SET order_details = %s WHERE order_number = %s",
                        (json.dumps(_od), order_number))
                    _db_hold.commit()
                logger.info(f"Order {order_number}: ready-SMS held (hold is on)")
                return
        except Exception as _hold_err:
            # A broken hold must never silence a customer. Fall through and
            # send, which is exactly the behaviour without this feature.
            logger.warning(f"notification hold check failed, sending anyway: {_hold_err}")
            try:
                current_app.config.get('coffee_system').db.rollback()
            except Exception:
                pass

        if _group_final:
            body = _render_group_ready_message(
                order_details.get('name'), _group_final[1], station_id,
                order_details, _group_final[0])
        else:
            body = _render_ready_message(order_number, order_details, station_id)

        # BENCH WALL: the Test Bench's simulator phones all share the
        # +6140000 prefix (never a real customer). A bench-created order
        # completed WITHOUT the test_no_send flag used to fall through
        # to a REAL Twilio attempt here — caught 2026-08-01 when the
        # express-batch guard's ready-SMS never recorded. Record the
        # rendered message instead of sending, so template propagation
        # stays provable and the zero-real-SMS rule holds structurally,
        # whatever the caller forgot.
        # Demo numbers (0400 009 9xx) are inside that range: show the text
        # in the Demo Room's Messages pane first (services/demo_texts.py).
        from services import demo_texts
        if demo_texts.is_demo(phone):
            demo_texts.add(phone, body, 'ready')
        if str(phone).startswith('+6140000'):
            try:
                _bc = current_app.config.get('coffee_system').db.cursor()
                _bc.execute("""
                    INSERT INTO order_messages (order_number, phone, message, message_sid)
                    VALUES (%s, %s, %s, %s)
                """, (order_number, phone, body, 'bench_guard'))
                current_app.config.get('coffee_system').db.commit()
            except Exception as _bg_err:
                logger.warning(f"bench-guard message record skipped: {_bg_err}")
            return

        # OFF THE REQUEST. Everything above - reading settings, rendering the
        # template, the bench wall - stays inline, because it touches the
        # database and the app context and is fast. Only the network call to
        # Twilio moves, because that is the part that can hang.
        #
        # Why it matters: this runs inside /complete, so the barista's tap did
        # not return until Twilio answered. app.py imports eventlet but never
        # calls monkey_patch(), so a blocking socket read stalls the whole hub
        # rather than one greenlet - and the server is single-threaded. On
        # 23 Aug that turned one slow SMS into 25 minutes of downtime, with
        # CPU at 0.0 vCPU throughout.
        #
        # A real OS thread is deliberate: un-patched eventlet means
        # threading.Thread is a genuine thread, so the blocking call happens
        # off the hub entirely. daemon=True so it can never hold shutdown.
        # File it where the barista's per-order Messages view looks
        # (order_messages). Real sends never wrote there -- only the bench
        # guard and test_no_send did -- so the view showed no ready texts at
        # all. A round's text is filed against its LEAD cup, the order the
        # customer was sent to track. Steve: "yes, good idea".
        _msg_order = str(_lead_num) if _group_final else str(order_number)
        # Past the event's text cap the ready text is HELD, not sent -- the
        # customer still has the board and their phone page. Say so in the
        # barista's per-order Messages view instead of claiming 'sent'.
        from services import sms_meter
        _ok, _why = sms_meter.decide('ready', body)
        if not _ok:
            logger.info(f"Order {order_number}: ready text {_why}")
            _record_order_message(_msg_order, phone, body, 'held_text_limit')
            sms_meter.record(phone, body, 'ready', sms_meter.HELD)
            return
        _record_order_message(_msg_order, phone, body, 'sent')
        _dispatch_sms_async(messaging_service, phone, body, order_number)
    except Exception as exc:
        logger.error(f"Error sending ready-notification SMS: {exc}")


def _dispatch_sms_async(messaging_service, phone, body, order_number):
    """Send one SMS without holding the request.

    Falls back to sending inline if a thread cannot be started - a missed
    text is worse than a slow one, and the timeout on the Twilio client
    bounds how slow that can get.
    """
    def _send():
        try:
            messaging_service.send_message(phone, body, kind='ready')
        except Exception as exc:
            logger.error("Async ready-SMS failed for order %s: %s",
                         order_number, exc)

    try:
        threading.Thread(target=_send, name=f"sms-{order_number}",
                         daemon=True).start()
    except Exception as exc:
        logger.warning("Could not start SMS thread (%s); sending inline", exc)
        _send()


def _render_ready_message(order_number, order_details, station_id):
    """The 'ready for pickup' SMS body — template-driven via the
    sms_ready_message setting (placeholders: {name} {drink} {order_number}
    {station}); hardcoded default when unset. The sponsor credit is
    appended to either path.

    No emoji in the default: an emoji forces UCS-2 encoding, which cuts
    the per-segment limit from 160 to 70 chars — doubling the cost. The
    template renderer warns if an operator's template does that.
    """
    name = order_details.get('name') or 'there'
    description = _sms_description(order_details)
    # Express-batch orders carry a collection note ("the FLAT WHITE
    # table at Coffee Station 1") that replaces the plain station text —
    # riding the existing {station} placeholder, so custom templates
    # keep working untouched.
    # Friendly station NAME + LOCATION ("Coffee Station 2 - Ferguson Room")
    # instead of a bare "Station 2" a guest can't place on the floor (Steve).
    # collection_note (express-batch table) still wins; the helper itself
    # falls back to "Station N", and stays SMS-cost-aware (length-capped).
    from utils.station_label import station_label as _pretty_station
    _cs_sl = current_app.config.get('coffee_system')
    _db_sl = getattr(_cs_sl, 'db', None) if _cs_sl else None
    station_label = (str(order_details.get('collection_note') or '').strip()
                     or (_pretty_station(_db_sl, station_id) if (_db_sl and station_id) else '')
                     or (f"Station {station_id}" if station_id else "the counter"))
    sponsor = ''
    try:
        cs = current_app.config.get('coffee_system')
        if cs and getattr(cs, 'db', None):
            sponsor = _sms_sponsor_tag(cs.db)
    except Exception:
        sponsor = ''
    # Pay-to-collect (services/payments.py): the ready text says so, with
    # the amount, and the Square link when the event has one. Plain ASCII
    # on purpose -- a text is billed by the segment.
    pay_line = ''
    try:
        _cs_p = current_app.config.get('coffee_system')
        if _cs_p and getattr(_cs_p, 'db', None):
            _pr = _pricing_for(_cs_p.db)
            if _pr.get('enabled') and (_pr.get('mode') or 'honour') != 'honour' and order_details.get('price'):
                _cur_p = _cs_p.db.cursor()
                _cur_p.execute("SELECT payment_status, payment_link FROM orders WHERE order_number = %s", (str(order_number),))
                _rp = _cur_p.fetchone()
                _ps, _pl = ((_rp[0], _rp[1]) if _rp and not isinstance(_rp, dict)
                            else ((_rp or {}).get('payment_status'), (_rp or {}).get('payment_link')))
                if str(_ps or '').lower() != 'paid':
                    _amt = f"${float(order_details.get('price')):.2f}"
                    pay_line = (f" Pay {_amt} here: {_pl}" if _pl
                                else f" Please pay {_amt} at the counter when you collect.")
    except Exception as _pe:
        logger.debug(f"ready text pay line skipped: {_pe}")
    default_body = (
        f"Hi {name}, your {description} (order #{order_number}) "
        f"is ready at {station_label}. Enjoy!{pay_line}"
    )
    try:
        cs = current_app.config.get('coffee_system')
        tpl = cs._get_setting('sms_ready_message', '') if cs else ''
    except Exception:
        tpl = ''
    body = _render_sms_template(tpl, {
        'name': name,
        'drink': description,
        'order_number': order_number,
        'station': station_label,
    }, default_body)
    return f"{body}{sponsor}"


def _record_order_message(order_number, phone, body, sid='sent'):
    """File an outbound customer text in order_messages, the table the
    barista's per-order Messages view reads. Never raises: a failed log
    line must not stop the text."""
    try:
        _db = current_app.config.get('coffee_system').db
        _c = _db.cursor()
        _c.execute(
            "INSERT INTO order_messages (order_number, phone, message, message_sid) "
            "VALUES (%s, %s, %s, %s)",
            (str(order_number), phone, body, sid))
        _db.commit()
    except Exception as _rec_err:
        logger.debug(f"order_messages record skipped: {_rec_err}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass


def _render_group_started_message(name, count, group_number):
    """One 'your round is being made' SMS for a group order -- sent when the
    FIRST cup starts, never again for that round. Plain ASCII (no emoji:
    UCS-2 doubles the per-segment cost)."""
    name = name or 'there'
    try:
        n = int(count or 0)
    except Exception:
        n = 0
    drinks = f"{n} coffees" if n and n != 1 else "coffee"
    verb = 'are' if n != 1 else 'is'
    ready = "they're" if n != 1 else "it's"
    return (f"Hi {name}, your {drinks} (order #{group_number}) {verb} being made "
            f"now - we'll text you when {ready} ready.")


def _render_group_ready_message(name, count, station_id, order_details, group_number):
    """One 'your whole round is ready' SMS for a group order — sent only once
    every drink in it is done (see _notify_customer_order_ready). Plain ASCII
    (no emoji: UCS-2 doubles the per-segment cost)."""
    name = name or 'there'
    from utils.station_label import station_label as _pretty_station
    _cs_sl = current_app.config.get('coffee_system')
    _db_sl = getattr(_cs_sl, 'db', None) if _cs_sl else None
    station_label = (str((order_details or {}).get('collection_note') or '').strip()
                     or (_pretty_station(_db_sl, station_id) if (_db_sl and station_id) else '')
                     or (f"Station {station_id}" if station_id else "the counter"))
    sponsor = ''
    try:
        cs = current_app.config.get('coffee_system')
        if cs and getattr(cs, 'db', None):
            sponsor = _sms_sponsor_tag(cs.db)
    except Exception:
        sponsor = ''
    try:
        n = int(count or 0)
    except Exception:
        n = 0
    drinks = f"{n} coffees" if n and n != 1 else "coffee"
    verb = 'are' if n != 1 else 'is'
    body = (f"Hi {name}, your {drinks} (order #{group_number}) "
            f"{verb} ready at {station_label}. Enjoy!")
    return f"{body}{sponsor}"


def _sms_sponsor_tag(db):
    """Optional sponsor credit appended to the customer's 'ready' SMS, e.g.
    ' Brought to you by Platinum Sponsor XYZ.' Empty unless the operator has a
    sponsor configured AND sponsor display enabled (branding_settings
    showSponsor + sponsorName) — the same toggle that shows the sponsor on the
    Display. Lets a sponsor's name reach every customer's phone, which can
    offset event-hire cost in exchange for the airtime."""
    try:
        b = _kv_get(db, 'branding_settings', default={}) or {}
        if not (b.get('showSponsor') or b.get('sponsorEnabled')):
            return ''
        name = (b.get('sponsorName') or '').strip()
        if not name:
            return ''
        return f" Brought to you by {name}."
    except Exception:
        return ''


def _emit_order_updated(order_id, extra):
    """Tell open screens an order changed, without a reload. Best effort."""
    try:
        socketio = current_app.config.get('socketio')
        if socketio:
            socketio.emit('order_updated', {'id': str(order_id), 'orderId': str(order_id), **(extra or {})},
                          room='orders')
    except Exception as e:
        logger.debug(f"order_updated emit skipped: {e}")


def _owner_key_refused(order_number, raw_details):
    """None if the request carries this order's owner key (or its round's),
    else the 403 to return. See utils/order_owner.py."""
    from utils.order_owner import key_ok, supplied_key
    details = raw_details
    if isinstance(details, str):
        try:
            details = json.loads(details)
        except Exception:
            details = {}
    group_id = details.get('group_id') if isinstance(details, dict) else None
    if key_ok(supplied_key(request), order_number, group_id):
        return None
    return jsonify({'success': False, 'not_yours': True,
                    'message': 'Please see a barista about this order.'}), 403


# ============================================================================
# DISPLAY ENDPOINTS (PUBLIC FACING)
# ============================================================================

def _event_code_for_display(db):
    """This event's ordering code, or '' if it has none.

    Never raises: the display config is a public, load-bearing endpoint
    and an unstamped poster is a far smaller problem than a config
    endpoint that 500s.
    """
    if db is None:
        return ''
    try:
        return event_access_settings(_kv_get(db, ACCESS_SETTING_KEY, default=None))['code']
    except Exception:
        return ''


def _pay_state(payment_status, order_details, pricing):
    """'paid' | 'unpaid' | 'none' -- services/payments.state_of, never raising."""
    try:
        from services.payments import state_of
        return state_of(payment_status, order_details, pricing)
    except Exception:
        return 'none'


def _pricing_for(db):
    """The merged pricing settings, for the serialisers that need to say
    whether an order is paid. One KV read; never raises."""
    try:
        saved = _kv_get(db, 'pricing_settings', default=None) or {}
        return {**DEFAULT_PRICING, **saved}
    except Exception:
        return dict(DEFAULT_PRICING)


def _powered_by_for_display(db):
    """True when guest screens should sign "powered by CupQ". Never raises;
    shows it when anything goes wrong."""
    try:
        from utils.plan_limits import shows_powered_by
        return shows_powered_by(db)
    except Exception:
        return True


def _badge_scan_for_display(db):
    """True when the kiosk/phone may offer to scan an EventsAir badge.
    The same operator switch that gates /api/ea/hello, read the same way,
    ANDed with the event's plan tier."""
    if db is None:
        return False
    try:
        from utils.plan_limits import feature_allowed
        if not feature_allowed(db, "badge_scan"):
            return False
        from routes.ea_survey_routes import attendee_lookup_enabled
        return bool(attendee_lookup_enabled(db))
    except Exception:
        return False


def _beacon_sound_setting():
    """The operator's pick for the phone beacon's ready sound (barista
    Settings > Sounds), carried on /track and /api/ea/me so a phone needs
    no extra request. Default: the CupQ signature. Never raises."""
    try:
        cs = current_app.config.get('coffee_system')
        cur = cs.db.cursor()
        cur.execute("SELECT value FROM settings WHERE key = 'beaconReadySound'")
        row = cur.fetchone()
        v = (row[0] if row and not isinstance(row, dict) else (row.get('value') if row else None))
        v = str(v or '').strip()
        return v or 'cupq_signature'
    except Exception:
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return 'cupq_signature'


def _revalidating_json(payload):
    """jsonify() plus a content ETag, so a client that re-polls an UNCHANGED
    payload gets a 304 with no body.

    The display config and the sponsor payload embed their images as base64
    (~150 KB each), and every display, kiosk and phone re-polls them every
    30 s. At Treenet that was the 1.5 GB/hour egress peaks on Railway's
    chart -- and attendees' mobile data -- almost all of it identical bytes.
    Clients fetch these with cache:'no-cache' (revalidate) rather than
    'no-store' (bypass), so the browser sends If-None-Match and a match
    costs ~200 bytes. Cloudflare may weaken the tag (W/"..."); compare on
    the value, not the prefix.
    """
    import hashlib
    resp = jsonify(payload)
    etag = '"' + hashlib.sha1(resp.get_data()).hexdigest()[:20] + '"'
    inm = request.headers.get('If-None-Match', '') or ''
    seen = [t.strip()[2:] if t.strip().startswith('W/') else t.strip() for t in inm.split(',')]
    if etag in seen:
        r = current_app.response_class(status=304)
        r.headers['ETag'] = etag
        r.headers['Cache-Control'] = 'no-cache'
        return r
    resp.headers['ETag'] = etag
    resp.headers['Cache-Control'] = 'no-cache'
    return resp


def _customer_wording_for_display(db):
    from routes.customer_wording_routes import for_display

    return for_display(db)


def _station_eta_minutes(db, station_id):
    """Queue-aware wait for a NEW order at this station, using the SAME model
    as the customer's waiting beacon (utils/order_eta). This is what makes the
    station-picker number agree with the number shown while waiting: both count
    the real orders ahead (pending + in-progress) at the station's measured
    pace. Previously the picker used a separate, more optimistic calc, so a
    station could offer "~2 min" and the beacon then say "18 min" (Steve).
    Returns int minutes, or None on error so the caller keeps its fallback."""
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT order_details FROM orders WHERE station_id = %s "
            "AND status = 'pending'", (station_id,))
        ahead = []
        for r in (cur.fetchall() or []):
            raw = r[0] if not isinstance(r, dict) else r.get('order_details')
            try:
                ahead.append(json.loads(raw) if isinstance(raw, str) else (raw or {}))
            except Exception:
                ahead.append({})
        cur.execute(
            "SELECT COUNT(*) FROM orders WHERE station_id = %s "
            "AND status IN ('in-progress','in_progress')", (station_id,))
        r2 = cur.fetchone()
        bench = (r2[0] if not isinstance(r2, dict) else list(r2.values())[0]) or 0
        cur.execute(
            "SELECT EXTRACT(EPOCH FROM COALESCE(completed_at, updated_at)) "
            "FROM orders WHERE station_id = %s "
            "AND status IN ('completed','picked_up') "
            "AND COALESCE(completed_at, updated_at) > NOW() - INTERVAL '2 hours' "
            "ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 40",
            (station_id,))
        epochs = []
        for r in (cur.fetchall() or []):
            v = r[0] if not isinstance(r, dict) else list(r.values())[0]
            if v is not None:
                epochs.append(float(v))
        pace = eta_seconds_per_coffee(epochs)
        # A brand-new order: 'pending', everything currently active is ahead.
        return eta_estimate_minutes('pending', ahead, bench, pace)
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


def _kiosk_menu_data(coffee_system):
    """Build the self-service kiosk menu. For each orderable item (coffee type,
    milk, size) return the station IDs that can make it — so the Display kiosk
    can grey out items only available at OTHER stations and tell the customer
    where to collect. A station whose capability list is empty is treated as
    "makes everything" (matches _station_can_make_order's lenient rule)."""
    db = coffee_system.db
    try:
        db.rollback()
    except Exception:
        pass
    stations = []
    caps_by_station = {}
    cur = db.cursor()
    # The operator's labels ("Coffee Station 1", "Concourse") live in the
    # STATIONS table; station_stats often carries only a bare default
    # name and no location. Read both, prefer the richer value.
    # station_api_routes spells the schema out: "Database uses 'notes'
    # for station name and 'equipment_notes' for location". The name and
    # location COLUMNS hold stale defaults on this schema.
    labels = {}
    try:
        cur.execute("SELECT station_id, COALESCE(notes,''), "
                    "COALESCE(equipment_notes,'') FROM station_stats")
        for r in cur.fetchall():
            _id, _nm, _loc = ((r.get('station_id'), r.get('notes'),
                               r.get('equipment_notes'))
                              if isinstance(r, dict) else (r[0], r[1], r[2]))
            labels[_id] = (_nm or '', _loc or '')
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    cur.execute(
        "SELECT station_id, COALESCE(name,''), COALESCE(status,'active'), capabilities, "
        "COALESCE(wait_time, 0), COALESCE(current_load, 0), COALESCE(location,'') "
        "FROM station_stats ORDER BY station_id"
    )
    for row in cur.fetchall():
        is_d = isinstance(row, dict)
        sid = row.get('station_id') if is_d else row[0]
        _lab = labels.get(sid, ('', ''))
        # The operator's label (notes) BEATS the bare column: the column
        # holds seed defaults like 'Station 1'.
        name = _lab[0] or (row.get('name') if is_d else row[1]) or f"Station {sid}"
        # The room, not just the number: "Station 1" means nothing to a
        # delegate; "Station 1 · Concourse" is somewhere to walk to.
        location = (_lab[1] or (row.get('location') if is_d else row[6]) or '')
        status = (row.get('status') if is_d else row[2]) or 'active'
        caps_raw = row.get('capabilities') if is_d else row[3]
        wait = (row.get('wait_time') if is_d else row[4]) or 0
        load = (row.get('current_load') if is_d else row[5]) or 0
        if str(status).lower() in ('inactive', 'maintenance'):
            continue
        caps = caps_raw
        if isinstance(caps, str):
            try:
                caps = json.loads(caps)
            except Exception:
                caps = {}
        if not isinstance(caps, dict):
            caps = {}
        # 'espresso drinks' is a GROUP TOKEN from the station
        # capabilities editor -- one checkbox meaning "makes the
        # espresso family". It is a capability fact, not a drink: left
        # in this list it surfaced on the kiosk and the 86 board as an
        # orderable tile literally named "Espresso Drinks" (Steve:
        # "what does espresso drinks mean"), and tapping it would have
        # ordered a drink no recipe knows. The individual drinks ride
        # alongside it in caps, so dropping the token loses nothing.
        _GROUP_TOKENS = {'espresso drinks'}
        _raw_drinks = [str(x).lower() for x in (caps.get('coffee_types') or caps.get('drinks') or [])]
        caps_by_station[sid] = {
            # The token itself is dropped (it is not a drink) but its
            # MEANING is kept: this station makes the espresso family,
            # so event-enabled espresso drinks beyond its explicit list
            # (ristretto, magic, cortado...) are still its to make.
            'espresso_family': any(t in _GROUP_TOKENS for t in _raw_drinks),
            'coffee_types': [x for x in _raw_drinks if x not in _GROUP_TOKENS],
            'milk_types':   [str(x).lower() for x in (caps.get('milk_types') or caps.get('milks') or [])],
            'sizes':        [str(x).lower() for x in (caps.get('sizes') or [])],
        }
        # wait/load let the kiosk show "~5 min" per station and pick the
        # fastest collection point.
        #
        # LIVE estimate, not the static wait_time column. This sent the
        # configured default (a constant -- 15 on one of Steve's
        # stations) while SMS and the stations panel computed the real
        # queue-based number, so the kiosk's "fastest station" badge
        # said 15 min next to stations everything else called 2 min.
        # _get_station_wait_time is the shared calc whose own comment
        # says it exists "so the barista header and what customers are
        # told finally agree" -- this was the surface that never joined.
        # Static column stays as the fallback if the calc errors.
        # Queue-aware wait using the SAME order_eta model as the customer's
        # waiting beacon, so the picker number and the beacon agree (Steve:
        # picker said 2 min, beacon said 18). Falls back to the live station
        # calc, then the static column, on any error.
        try:
            eta = _station_eta_minutes(db, sid)
            if eta is not None:
                wait = eta
            else:
                live_wait = coffee_system._get_station_wait_time(sid)
                if live_wait is not None:
                    wait = live_wait
        except Exception:
            pass
        stations.append({'id': sid, 'name': name, 'location': location,
                         'wait': int(wait or 0), 'load': int(load or 0)})

    universe = {'coffee_types': {}, 'milk_types': {}, 'sizes': {}}
    for _sid, caps in caps_by_station.items():
        for dim in universe:
            for item in caps[dim]:
                universe[dim].setdefault(item, item)
    # Fall back to the event catalog for any dimension nobody configured, so a
    # brand-new setup (no capabilities entered) still shows a usable menu.
    try:
        if not universe['coffee_types']:
            for c in (coffee_system._get_available_coffee_types() or []):
                universe['coffee_types'].setdefault(str(c).lower(), str(c))
        if not universe['milk_types']:
            for m in (coffee_system._get_available_milk_types() or []):
                universe['milk_types'].setdefault(str(m).lower(), str(m))
        if not universe['sizes']:
            for s in (coffee_system._get_available_sizes() or []):
                universe['sizes'].setdefault(str(s).lower(), str(s))
    except Exception as e:
        logger.warning(f"kiosk menu catalog fallback failed: {e}")

    # SINGLE SOURCE OF TRUTH for milks: intersect the capability-derived
    # universe with the EVENT's configured milk list. Found by the Test Bench:
    # station 2's capabilities listed soy, so the kiosk sold soy — while the
    # SMS bot (which reads the event inventory) refused it. A milk is offered
    # only if the event stocks it AND some active station can make it. If the
    # event list is empty/unavailable, keep the capability universe unchanged.
    try:
        event_milks = [str(m).lower() for m in
                       (coffee_system._get_available_milk_types() or [])]
        if event_milks and universe['milk_types']:
            def _norm(m):
                return m.replace(' milk', '').strip()
            ev = {_norm(m) for m in event_milks}
            universe['milk_types'] = {
                k: v for k, v in universe['milk_types'].items()
                if _norm(k) in ev
            }
    except Exception as e:
        logger.warning(f"kiosk milk/event intersection failed (menu unchanged): {e}")

    # COLLAPSE "skim" and "skim milk" INTO ONE CHOICE.
    #
    # Steve, from a phone, looking at the milk step: "skim and skim milk oat
    # and oat milk etc". Nine tiles where there are five milks, because
    # stations spell the same milk two ways and the universe is keyed on the
    # raw string. Every customer sees this on every order.
    #
    # Fold on the same rule the event intersection above already uses --
    # strip a trailing " milk" -- and keep BOTH spellings as aliases, so a
    # station that only ever declared "skim milk" is still matched as making
    # the folded "Skim". Dropping the aliases here would quietly remove
    # milks from stations, which is far worse than a duplicate tile.
    milk_aliases = {}
    try:
        def _milk_fold(m):
            n = str(m).strip().lower()
            base = n[:-5].strip() if n.endswith(' milk') else n
            return base or n

        folded = {}
        for raw_key, raw_label in universe['milk_types'].items():
            canon = _milk_fold(raw_key)
            milk_aliases.setdefault(canon, set()).add(raw_key)
            # Prefer the bare spelling as the label source: "Skim" reads
            # better on a tile than "Skim Milk", and mixing the two is what
            # made the list look duplicated in the first place.
            if canon not in folded or len(str(raw_key)) < len(str(folded[canon][0])):
                folded[canon] = (raw_key, raw_label)
        if folded:
            universe['milk_types'] = {c: _milk_fold(v[1]) for c, v in folded.items()}
    except Exception as e:
        logger.warning(f"milk fold skipped (menu unchanged): {e}")
        milk_aliases = {}

    # SAME TREATMENT FOR SIZES. Milks above are intersected with the event's
    # configured list; sizes were not, so they came purely from station
    # capabilities and the operator's cup choices were ignored. With only
    # Medium ticked in Inventory, the kiosk and the attendee app still
    # offered Small — station capabilities said 'medium','small' and nothing
    # checked that against the event. Empty or unavailable event list leaves
    # the capability universe alone.
    try:
        event_sizes = [str(s).lower() for s in
                       (coffee_system._get_available_sizes() or [])]
        if event_sizes and universe['sizes']:
            filtered = {k: v for k, v in universe['sizes'].items()
                        if k in event_sizes}
            if filtered:
                universe['sizes'] = filtered
    except Exception as e:
        logger.warning(f"kiosk size/event intersection failed (menu unchanged): {e}")

    # Fold in event-enabled non-espresso drinks (tea, hot chocolate, chai,
    # matcha…). They aren't espresso-gated, so the capability-only universe
    # (espresso drinks) was hiding them. A station makes an extra unless some
    # station has explicitly claimed it.
    #
    # ...MINUS anything every active station has switched off. At most events
    # the barista makes coffee and the tea/cold drinks are self-serve from
    # another table, and without this the kiosk and the attendee app invited
    # delegates to order drinks nobody was going to make. The gate lives on
    # coffee_system so this path and the SMS path agree; it only removes an
    # EXPLICIT off and leaves the list alone on any error.
    extras = []
    try:
        extras = [str(x).lower() for x in
                  (coffee_system._drop_extras_no_station_makes(
                      coffee_system._get_available_extra_drinks() or []) or [])]
    except Exception as e:
        logger.warning(f"kiosk extras pull failed: {e}")
    for ex in extras:
        universe['coffee_types'].setdefault(ex, ex)
    extra_set = set(extras)
    # Union event-enabled ESPRESSO drinks into the universe. The tea fold
    # above covers the 'drinks' category; espresso extras enabled in the
    # Organiser (ristretto, magic, cortado...) never joined -- SMS sold
    # them while the kiosk had never heard of them (Steve: "ristretto is
    # currently in the event avalabilites... pretty sure magic is there
    # also"). Same accessor SMS uses, so the surfaces cannot disagree.
    event_espresso = set()
    try:
        raw_extras = {str(x).lower() for x in
                      (coffee_system._get_available_extra_drinks() or [])}
        for d in (coffee_system._get_available_coffee_types() or []):
            dl = str(d).lower()
            if dl not in raw_extras:
                event_espresso.add(dl)
                universe['coffee_types'].setdefault(dl, dl)
    except Exception as e:
        logger.warning(f"kiosk event espresso union failed: {e}")
    claimed_coffee = set()
    for caps in caps_by_station.values():
        for c in caps['coffee_types']:
            claimed_coffee.add(c)

    def stations_for(dim, item_lower):
        # A folded milk is made by a station that declared ANY of its
        # spellings.
        names = ({item_lower} | milk_aliases.get(item_lower, set())
                 if dim == 'milk_types' else {item_lower})
        out = []
        for sid, caps in caps_by_station.items():
            lst = caps[dim]
            if (not lst) or (names & set(lst)):
                out.append(sid)
            elif dim == 'coffee_types' and item_lower in extra_set and item_lower not in claimed_coffee:
                out.append(sid)  # enabled extra nobody claims → made everywhere
            elif (dim == 'coffee_types' and item_lower in event_espresso
                  and caps.get('espresso_family')):
                out.append(sid)  # espresso-family station makes the family
        return out

    def title(s):
        return ' '.join(w.capitalize() for w in str(s).split())

    def categorize(n):
        if 'chai' in n:
            return 'Chai'
        if 'hot choc' in n:
            return 'Hot Chocolate'
        if any(k in n for k in ('juice', 'smoothie', 'iced', 'frappe', 'frappé', 'cold brew')):
            return 'Cold Drinks'
        if any(k in n for k in ('tea', 'matcha', 'earl grey', 'english breakfast',
                                'chamomile', 'peppermint', 'green', 'rooibos')):
            return 'Tea'
        return 'Coffee'

    def build(dim):
        out = []
        for item_lower in sorted(universe[dim].keys()):
            entry = {
                'name': title(universe[dim][item_lower]),
                'value': item_lower,
                'stations': stations_for(dim, item_lower),
            }
            if dim == 'coffee_types':
                entry['category'] = categorize(item_lower)
                # The kiosk shows featured drinks as the main grid and
                # folds the rest behind a "Something else" tile.
                try:
                    # The FALLBACK constant is the classic six, which is
                    # what "main grid" means. The full catalog menu
                    # (_STANDARD_DRINK_MENU) also carries macchiato,
                    # cortado, piccolo... -- using it made eight tiles
                    # "featured" and folded almost nothing.
                    entry['featured'] = item_lower in {
                        str(x).lower()
                        for x in coffee_system._STANDARD_DRINK_MENU_FALLBACK}
                except Exception:
                    entry['featured'] = True
            out.append(entry)
        return out

    sugar_self_serve = False
    try:
        sugar_self_serve = coffee_system._sugar_self_serve()
    except Exception:
        pass
    # Bean choices with stock behind them. Steve, on finding my hardcoded
    # House blend / Decaf tiles: "the 'house blend' must be hard coded?
    # and decaf must be unable to turn off? not sure how this would track
    # stock then". Right on all three counts. The kiosk and the order
    # editor now read this list; an empty list means the event has no
    # bean rows, and the choice is simply not offered.
    beans = []
    try:
        beans = coffee_system._get_available_bean_types()
    except Exception:
        pass
    milks_built = build('milk_types')
    # Milks the event configured but switched OFF ride along, marked
    # unavailable: an oat drinker should SEE oat greyed out, not wonder
    # whether the app forgot it exists (Steve, from the walk-up
    # dialog's greyed list). Only what the Organiser actually listed --
    # this invents nothing.
    try:
        inv = _kv_get(coffee_system.db, 'event_inventory', default=None) or {}
        have = {e['value'] for e in milks_built}
        for it in (inv.get('milk') or []):
            if not isinstance(it, dict) or it.get('enabled', True):
                continue
            nm = str(it.get('name') or '').strip()
            base = nm[:-5].strip() if nm.lower().endswith(' milk') else nm
            v = base.lower()
            if v and v not in have:
                milks_built.append({'name': base.title(), 'value': v,
                                    'stations': [], 'unavailable': True})
    except Exception as e:
        logger.warning(f"kiosk greyed-milk ride-along failed: {e}")

    # And the same for anything a barista has just 86'd.
    #
    # Steve: "not sure if the 86 menu achieves the same thing -- if it was a
    # hard ran out of something for the event the 86 menu hopefully would
    # show not available today, greyed out but in the list." It did not. An
    # 86 dropped the item out of this menu entirely, so a customer who
    # wanted oat saw no oat at all and went to ask -- the exact question the
    # greyed row exists to prevent. (The ORDER was still refused server-side
    # with a clear message, so nothing was ever made wrongly; it was the
    # screen that stayed silent.)
    try:
        cur86 = db.cursor()
        cur86.execute("SELECT category, item_name FROM stock_overrides WHERE state = '86'")
        have = {e['value'] for e in milks_built}
        for row in cur86.fetchall():
            cat, nm = ((row.get('category'), row.get('item_name'))
                       if isinstance(row, dict) else (row[0], row[1]))
            if str(cat or '').lower() != 'milk':
                continue
            nm = str(nm or '').strip()
            base = nm[:-5].strip() if nm.lower().endswith(' milk') else nm
            v = base.lower()
            if not v:
                continue
            for e in milks_built:
                if e.get('value') == v:
                    e['unavailable'] = True
                    break
            else:
                milks_built.append({'name': base.title(), 'value': v,
                                    'stations': [], 'unavailable': True})
                have.add(v)
    except Exception as e:
        logger.warning(f"kiosk 86 ride-along failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass

    # What this event is NOT carrying today.
    #
    # Steve, from the floor at Treenet: the only two questions asked all
    # event were "is there hot chocolate?" and "is there decaf?" -- and both
    # are things that were not on the screen AT ALL. Nobody asked about oat,
    # because oat was right there, marked unavailable. An item you can see
    # crossed out answers its own question; an item that is simply absent
    # sends someone to the counter.
    #
    # So say what is off the menu as well as what is on it. The catalogue is
    # the list of drinks the system knows; anything in it that this event
    # has not enabled is named here, and the customer screens print it small
    # and last.
    not_today = []
    try:
        offered = {str(c.get('name', c) if isinstance(c, dict) else c).strip().lower()
                   for c in build('coffee_types')}
        cur2 = db.cursor()
        cur2.execute("SELECT display_name FROM catalog_items "
                     "WHERE category = 'drink' ORDER BY sort_order, display_name")
        seen_tea = False
        for row in cur2.fetchall():
            nm = (row.get('display_name') if isinstance(row, dict) else row[0]) or ''
            nm = nm.strip()
            if not nm or nm.lower() in offered:
                continue
            # Seven kinds of tea nobody is serving is seven lines of noise
            # on a phone. If no tea at all is on today, say "Tea" once.
            if nm.lower().endswith('tea'):
                if seen_tea:
                    continue
                seen_tea = True
                nm = 'Tea'
            not_today.append(nm)
    except Exception as _e:
        logger.warning(f"kiosk menu: off-menu drink list unavailable: {_e}")
        try:
            db.rollback()
        except Exception:
            pass
        not_today = []

    coffee_built = build('coffee_types')
    sizes_built = build('sizes')
    # The organiser's one-tap drinks, checked against this exact menu so a
    # pick is only offered while everything in it can be made.
    quick_picks = []
    try:
        from utils.quick_picks import resolve_picks
        quick_picks = resolve_picks(
            _kv_get(db, 'quick_picks', default=None),
            {'coffee_types': coffee_built, 'milks': milks_built, 'sizes': sizes_built})
    except Exception as e:
        logger.warning(f"kiosk menu: quick picks skipped: {e}")
        try:
            db.rollback()
        except Exception:
            pass

    return {
        'stations': stations,
        'coffee_types': coffee_built,
        'milks': milks_built,
        'sizes': sizes_built,
        'quick_picks': quick_picks,
        'beans': beans,
        # Named so a customer screen can answer "is there hot chocolate?"
        # without anyone having to ask a barista.
        'not_today': not_today,
        # Kiosk skips its sugar question when the venue runs
        # help-yourself sugar (baristas never add it).
        'sugar_self_serve': sugar_self_serve,
    }


def _build_commit():
    from utils.build_info import commit

    return commit()


def _track_full_drink(od):
    """Size, drink, milk, sugar and extras, the way the label reads.

    Built here rather than reusing _drink_display_name because that one
    is deliberately terse -- the board and the WS payload want a short
    name. A customer checking their order got through wants the details.
    """
    od = od or {}

    def val(*keys):
        for k in keys:
            v = od.get(k)
            if v not in (None, '', 'None'):
                return str(v).strip()
        return ''

    head = ' '.join(x for x in (val('size'), val('type', 'coffee_type', 'drink')) if x)
    bits = [head] if head else []
    milk = val('milk', 'milk_type', 'milkType')
    if milk and milk.lower() not in ('no milk', 'none', 'no_milk'):
        bits.append(milk if milk.lower().endswith('milk') else f'{milk} milk')
    elif milk:
        bits.append('no milk')
    sugar = val('sugar', 'sweetener')
    if sugar:
        # At a help-yourself-sugar venue, "No sugar" on the customer's
        # own status page reads like a mistake in their order. Tell them
        # where the sugar actually is (Steve's wording request). The
        # stored value stays 'No sugar' -- barista labels want it short.
        if sugar.strip().lower() in ('no sugar', 'none', '0'):
            try:
                cs = current_app.config.get('coffee_system')
                if cs and cs._sugar_self_serve():
                    sugar = 'add your own sugar at pickup'
            except Exception:
                pass
        bits.append(sugar)
    strength = val('strength')
    if strength:
        bits.append(strength)
    if str(od.get('temp') or '').lower() == 'extra hot' or od.get('extraHot'):
        bits.append('extra hot')
    notes = val('notes')
    if notes:
        bits.append(notes)
    return ', '.join(b for b in bits if b) or 'Coffee'


# _display_phone used to live here: last-4 masking for the public
# board. Steve's later call: a public screen shows NO digits of a
# phone number at all -- the order number disambiguates, and it is
# already the biggest thing on the card. The masked field and its
# helper are gone rather than unused, so nothing can quietly start
# sending it again.


# ============================================================================
# STATION ENDPOINTS
# ============================================================================

# Not routed (roadmap X7-10): GET /api/stations is served by station_api.get_stations.
@jwt_required_with_demo()
def get_stations():
    """Get all coffee stations"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for stations
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT station_id, name, location, status, barista_name, 
                       wait_time, last_updated
                FROM station_stats
                ORDER BY station_id
            ''')
        except Exception as e:
            logger.warning(f"Error with primary station query: {str(e)}")
            # Fallback to simpler query
            cursor.execute('''
                SELECT id, name, location, status, NULL as barista_name,
                       NULL as wait_time, NULL as last_updated
                FROM stations
                ORDER BY id
            ''')
        
        # Process stations
        stations = []
        for station in cursor.fetchall():
            station_id, name, location, status, barista_name, wait_time, last_updated = station
            
            # Format station for frontend
            stations.append({
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status or "active",
                'barista': barista_name or "Unassigned",
                'wait_time': wait_time or 10,
                'last_updated': last_updated or datetime.now().isoformat()
            })
        
        return jsonify({
            'success': True,
            'stations': stations
        })
    
    except Exception as e:
        logger.error(f"Error fetching stations: {str(e)}")
        # Fallback to hardcoded stations for development
        return jsonify({
            'success': True,
            'stations': [
                {
                    'id': 1,
                    'name': 'Station #1',
                    'location': 'Main Hall',
                    'status': 'active',
                    'barista': 'Barista 1',
                    'wait_time': 10,
                    'last_updated': datetime.now().isoformat()
                },
                {
                    'id': 2,
                    'name': 'Station #2',
                    'location': 'Exhibition Hall',
                    'status': 'active',
                    'barista': 'Barista 2',
                    'wait_time': 15,
                    'last_updated': datetime.now().isoformat()
                },
                {
                    'id': 3,
                    'name': 'Station #3',
                    'location': 'Registration Area',
                    'status': 'active',
                    'barista': 'Barista 3',
                    'wait_time': 8,
                    'last_updated': datetime.now().isoformat()
                }
            ]
        })


# Not routed (roadmap X7-10): POST /api/stations is served by station_api.create_station.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def create_station():
    """Create a new station"""
    try:
        # Get request data
        data = request.json
        name = data.get('name')
        location = data.get('location')
        
        if not name:
            return jsonify({
                'success': False,
                'message': "Station name is required"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert new station
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO stations (name, location, status)
            VALUES (%s, %s, 'active')
            RETURNING id, name, location, status
        ''', (name, location))
        
        station = cursor.fetchone()
        db.commit()
        
        if not station:
            return jsonify({
                'success': False,
                'message': "Failed to create station"
            }), 500
        
        # Extract station details
        station_id, name, location, status = station
        
        # Format station for response
        station_data = {
            'id': station_id,
            'name': name or f"Station #{station_id}",
            'location': location or "Main Venue",
            'status': status or "active",
            'barista': "Unassigned",
            'wait_time': 10,
            'last_updated': datetime.now().isoformat()
        }
        
        return jsonify({
            'success': True,
            'message': "Station created successfully",
            'station': station_data
        }), 201
    
    except Exception as e:
        logger.error(f"Error creating station: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating station: {str(e)}"
        }), 500

# ============================================================================
# INVENTORY ENDPOINTS
# ============================================================================

# Low stock notifications and restock requests tables creation
def ensure_inventory_management_tables(db):
    """Ensure inventory management related tables exist"""
    try:
        cursor = db.cursor()
        
        # Create low stock reports table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_low_stock_reports (
                id SERIAL PRIMARY KEY,
                item_id INTEGER REFERENCES inventory_items(id),
                reporter_id INTEGER,
                reporter_name VARCHAR(100),
                report_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                urgency VARCHAR(20) DEFAULT 'normal',
                notes TEXT,
                status VARCHAR(20) DEFAULT 'open'
            )
        ''')
        
        # Create restock requests table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_restock_requests (
                id SERIAL PRIMARY KEY,
                request_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                requester_id INTEGER,
                requester_name VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                notes TEXT,
                delivery_expected_date DATE
            )
        ''')
        
        # Create restock request items table (many-to-many relationship)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS inventory_restock_request_items (
                id SERIAL PRIMARY KEY,
                request_id INTEGER REFERENCES inventory_restock_requests(id),
                item_id INTEGER REFERENCES inventory_items(id),
                quantity_requested DECIMAL(10, 2) NOT NULL,
                quantity_received DECIMAL(10, 2) DEFAULT 0
            )
        ''')
        
        db.commit()
        return True
    except Exception as e:
        logger.error(f"Error creating inventory management tables: {str(e)}")
        return False

# Not routed (roadmap X7-10): GET /api/inventory is served by inventory.get_inventory.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_items():
    """Get all inventory items, optionally filtered by category or station"""
    try:
        # Get query parameters
        category = request.args.get('category')
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create inventory tables if they don't exist
        cursor = db.cursor()
        try:
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_items (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    current_quantity DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    unit VARCHAR(20) NOT NULL,
                    station_id INTEGER,
                    minimum_threshold DECIMAL(10, 2) NOT NULL DEFAULT 0,
                    status VARCHAR(20) DEFAULT 'in_stock',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS inventory_adjustments (
                    id SERIAL PRIMARY KEY,
                    item_id INTEGER REFERENCES inventory_items(id),
                    previous_quantity DECIMAL(10, 2) NOT NULL,
                    new_quantity DECIMAL(10, 2) NOT NULL,
                    adjustment_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reason VARCHAR(50) NOT NULL,
                    notes TEXT,
                    user_id INTEGER
                )
            ''')
            
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating inventory tables: {str(e)}")
        
        # Check if there are any inventory items
        cursor.execute("SELECT COUNT(*) FROM inventory_items")
        count = cursor.fetchone()[0]
        
        # If no items exist, insert some sample data
        if count == 0:
            try:
                # Insert sample inventory items
                cursor.execute('''
                    INSERT INTO inventory_items 
                    (name, category, current_quantity, unit, station_id, minimum_threshold, status) 
                    VALUES 
                    ('Full Cream Milk', 'milk', 15, 'liters', 1, 5, 'in_stock'),
                    ('Almond Milk', 'milk', 8, 'liters', 1, 3, 'in_stock'),
                    ('Oat Milk', 'milk', 2, 'liters', 1, 3, 'low_stock'),
                    ('Soy Milk', 'milk', 6, 'liters', 1, 2, 'in_stock'),
                    ('Coffee Beans - House Blend', 'coffee', 5, 'kg', 1, 2, 'in_stock'),
                    ('Coffee Beans - Dark Roast', 'coffee', 3, 'kg', 1, 2, 'in_stock'),
                    ('Coffee Beans - Decaf', 'coffee', 1, 'kg', 1, 2, 'low_stock'),
                    ('Paper Cups - Regular', 'cups', 200, 'pieces', 1, 50, 'in_stock'),
                    ('Paper Cups - Large', 'cups', 150, 'pieces', 1, 50, 'in_stock'),
                    ('Sugar Packets', 'other', 300, 'pieces', 1, 100, 'in_stock'),
                    ('Stirrers', 'other', 80, 'pieces', 1, 50, 'in_stock')
                ''')
                
                db.commit()
            except Exception as e:
                logger.warning(f"Error inserting sample inventory data: {str(e)}")
                db.rollback()
        
        # Base query
        query = "SELECT * FROM inventory_items WHERE 1=1"
        params = []
        
        # Add filters if provided
        if category:
            query += " AND category = %s"
            params.append(category)
        
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add ordering
        query += " ORDER BY category, name"
        
        # Execute query
        cursor = db.cursor()
        try:
            cursor.execute(query, params if params else None)
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Format inventory items
            items = []
            for row in cursor.fetchall():
                item = dict(zip(columns, row))
                
                # Convert datetime objects to ISO format strings
                for key, value in item.items():
                    if isinstance(value, (datetime, date)):
                        item[key] = value.isoformat()
                
                items.append(item)
            
            return jsonify({
                'success': True,
                'items': items
            })
        except Exception as e:
            logger.warning(f"Error fetching inventory items: {str(e)}")
            # Return sample data for development
            return jsonify({
                'success': True,
                'items': [
                    {
                        'id': 1,
                        'name': 'Full Cream Milk',
                        'category': 'milk',
                        'current_quantity': 15,
                        'unit': 'liters',
                        'station_id': 1,
                        'minimum_threshold': 5,
                        'status': 'in_stock'
                    },
                    {
                        'id': 2,
                        'name': 'Almond Milk',
                        'category': 'milk',
                        'current_quantity': 8,
                        'unit': 'liters',
                        'station_id': 1,
                        'minimum_threshold': 3,
                        'status': 'in_stock'
                    },
                    {
                        'id': 3,
                        'name': 'Coffee Beans - House Blend',
                        'category': 'coffee',
                        'current_quantity': 5,
                        'unit': 'kg',
                        'station_id': 1,
                        'minimum_threshold': 2,
                        'status': 'in_stock'
                    },
                    {
                        'id': 4,
                        'name': 'Paper Cups - Regular',
                        'category': 'cups',
                        'current_quantity': 200,
                        'unit': 'pieces',
                        'station_id': 1,
                        'minimum_threshold': 50,
                        'status': 'in_stock'
                    }
                ]
            })
    
    except Exception as e:
        logger.error(f"Error fetching inventory items: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching inventory items: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): GET /api/inventory/categories is served by inventory.get_categories.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_inventory_categories():
    """Get all inventory categories"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query distinct categories
        cursor = db.cursor()
        try:
            cursor.execute("SELECT DISTINCT category FROM inventory_items ORDER BY category")
            
            # Extract categories
            categories = [row[0] for row in cursor.fetchall()]
            
            if not categories:
                # Return default categories if none found
                categories = ['milk', 'coffee', 'cups', 'syrups', 'other']
            
            return jsonify({
                'success': True,
                'categories': categories
            })
        except Exception as e:
            logger.warning(f"Error fetching inventory categories: {str(e)}")
            # Return default categories for development
            return jsonify({
                'success': True,
                'categories': ['milk', 'coffee', 'cups', 'syrups', 'other']
            })
    
    except Exception as e:
        logger.error(f"Error fetching inventory categories: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching inventory categories: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): GET /api/inventory/low-stock is served by inventory.get_low_stock.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_low_stock_items():
    """Get low stock inventory items"""
    try:
        # Get station ID from query params (optional)
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Base query
        query = """
            SELECT * FROM inventory_items 
            WHERE current_quantity <= minimum_threshold
        """
        params = []
        
        # Add station filter if provided
        if station_id:
            query += " AND station_id = %s"
            params.append(station_id)
        
        # Add ordering
        query += " ORDER BY current_quantity / minimum_threshold ASC"
        
        # Execute query
        cursor = db.cursor()
        try:
            cursor.execute(query, params if params else None)
            
            # Get column names
            columns = [desc[0] for desc in cursor.description]
            
            # Format inventory items
            items = []
            for row in cursor.fetchall():
                item = dict(zip(columns, row))
                items.append(item)
            
            return jsonify({
                'success': True,
                'items': items
            })
        except Exception as e:
            logger.warning(f"Error fetching low stock items: {str(e)}")
            # Return sample data for development
            return jsonify({
                'success': True,
                'items': [
                    {
                        'id': 3,
                        'name': 'Coffee Beans - House Blend',
                        'category': 'coffee',
                        'current_quantity': 1,
                        'unit': 'kg',
                        'station_id': 1,
                        'minimum_threshold': 2,
                        'status': 'low_stock'
                    },
                    {
                        'id': 5,
                        'name': 'Oat Milk',
                        'category': 'milk',
                        'current_quantity': 1,
                        'unit': 'liters',
                        'station_id': 2,
                        'minimum_threshold': 3,
                        'status': 'low_stock'
                    }
                ]
            })
    
    except Exception as e:
        logger.error(f"Error fetching low stock items: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching low stock items: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): POST /api/inventory/restock-request is served by inventory.create_restock_request.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def create_restock_request():
    """Create a restock request for multiple items"""
    try:
        # Get request data
        data = request.json
        items = data.get('items', [])
        notes = data.get('notes', '')
        
        if not items or not isinstance(items, list) or len(items) == 0:
            return jsonify({
                'success': False,
                'message': "At least one item is required for a restock request"
            }), 400
        
        # Validate each item has the required fields
        for item in items:
            if 'id' not in item or 'quantity' not in item:
                return jsonify({
                    'success': False,
                    'message': "Each item must have id and quantity fields"
                }), 400
            
            try:
                float(item['quantity'])
            except (ValueError, TypeError):
                return jsonify({
                    'success': False,
                    'message': "Item quantities must be numbers"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Start a transaction
        cursor = db.cursor()
        
        try:
            # Get user info from JWT
            user_id = get_jwt_identity()
            claims = get_jwt()
            user_name = claims.get('full_name', 'Unknown User')
            
            # Create restock request
            cursor.execute("""
                INSERT INTO inventory_restock_requests
                (requester_id, requester_name, status, notes)
                VALUES (%s, %s, 'pending', %s)
                RETURNING id, request_time
            """, (user_id, user_name, notes))
            
            request_result = cursor.fetchone()
            request_id = request_result[0]
            
            # Add items to the request
            for item in items:
                item_id = item['id']
                quantity = item['quantity']
                
                # Verify item exists
                cursor.execute("SELECT id FROM inventory_items WHERE id = %s", (item_id,))
                if not cursor.fetchone():
                    # Skip invalid items
                    continue
                
                cursor.execute("""
                    INSERT INTO inventory_restock_request_items
                    (request_id, item_id, quantity_requested)
                    VALUES (%s, %s, %s)
                """, (request_id, item_id, quantity))
            
            # Commit transaction
            db.commit()
            
            # Format response
            request_time = request_result[1].isoformat() if isinstance(request_result[1], datetime) else request_result[1]
            
            return jsonify({
                'success': True,
                'message': "Restock request created successfully",
                'requestId': request_id,
                'request_time': request_time,
                'item_count': len(items)
            })
        except Exception as e:
            # Rollback transaction on error
            db.rollback()
            raise e
    
    except Exception as e:
        logger.error(f"Error creating restock request: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating restock request: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): GET /api/inventory/restock-requests is served by inventory.get_restock_requests.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_restock_requests():
    """Get list of restock requests"""
    try:
        # Get query parameters
        status = request.args.get('status')
        limit = request.args.get('limit', 20, type=int)
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Ensure inventory management tables exist
        ensure_inventory_management_tables(db)
        
        # Build query
        query = "SELECT * FROM inventory_restock_requests"
        params = []
        
        if status:
            query += " WHERE status = %s"
            params.append(status)
        
        query += " ORDER BY request_time DESC LIMIT %s"
        params.append(limit)
        
        # Execute query
        cursor = db.cursor()
        cursor.execute(query, params)
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        # Format results
        requests = []
        for row in cursor.fetchall():
            request_data = dict(zip(columns, row))
            
            # Convert datetime objects to ISO format strings
            for key, value in request_data.items():
                if isinstance(value, (datetime, date)):
                    request_data[key] = value.isoformat()
            
            # Get items for this request
            cursor.execute("""
                SELECT i.id, i.name, i.category, i.unit, ri.quantity_requested, ri.quantity_received
                FROM inventory_restock_request_items ri
                JOIN inventory_items i ON ri.item_id = i.id
                WHERE ri.request_id = %s
            """, (request_data['id'],))
            
            # Format items
            items = []
            for item_row in cursor.fetchall():
                items.append({
                    'id': item_row[0],
                    'name': item_row[1],
                    'category': item_row[2],
                    'unit': item_row[3],
                    'quantity_requested': item_row[4],
                    'quantity_received': item_row[5]
                })
            
            request_data['items'] = items
            requests.append(request_data)
        
        return jsonify({
            'success': True,
            'requests': requests
        })
    
    except Exception as e:
        logger.error(f"Error fetching restock requests: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching restock requests: {str(e)}"
        }), 500


# /sms/send-test lived here and let barista logins text any number; it
# forwarded to a handler that no longer exists, so it only ever answered 500
# (audit SEC-017). The organiser's test text is POST /api/sms/test
# (readiness_api.py, managers only).


# ============================================================================
# SCHEDULE ENDPOINTS
# ============================================================================

# Not routed (roadmap X7-10): GET /api/schedule/today is served by station_api.get_todays_schedule.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_today_schedule():
    """Get schedule for today"""
    try:
        # Optional station filter
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create schedule tables if they don't exist
        cursor = db.cursor()
        try:
            # Create shifts table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_shifts (
                    id SERIAL PRIMARY KEY,
                    barista_id INTEGER,
                    barista_name VARCHAR(100),
                    station_id INTEGER,
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    status VARCHAR(20) DEFAULT 'upcoming',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create breaks table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_breaks (
                    id SERIAL PRIMARY KEY,
                    barista_id INTEGER,
                    barista_name VARCHAR(100),
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    break_type VARCHAR(20),
                    status VARCHAR(20) DEFAULT 'upcoming',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # Create rush periods table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS schedule_rush_periods (
                    id SERIAL PRIMARY KEY,
                    date DATE,
                    start_time TIME,
                    end_time TIME,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            db.commit()
        except Exception as e:
            logger.warning(f"Error creating schedule tables: {str(e)}")
        
        # Today where the event is (finding 3): datetime.now() on a TZ=UTC
        # server is yesterday until 09:30 Adelaide.
        today = _event_time.local_today(_event_timezone())
        
        # Query shifts
        shifts_query = "SELECT * FROM schedule_shifts WHERE date = %s"
        shifts_params = [today]
        
        if station_id:
            shifts_query += " AND station_id = %s"
            shifts_params.append(station_id)
        
        shifts_query += " ORDER BY start_time"
        
        try:
            cursor.execute(shifts_query, shifts_params)
            shifts_columns = [desc[0] for desc in cursor.description]
            shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching shifts: {str(e)}")
            shifts = []
        
        # Query breaks
        breaks_query = "SELECT * FROM schedule_breaks WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(breaks_query, [today])
            breaks_columns = [desc[0] for desc in cursor.description]
            breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching breaks: {str(e)}")
            breaks = []
        
        # Query rush periods
        rush_query = "SELECT * FROM schedule_rush_periods WHERE date = %s ORDER BY start_time"
        
        try:
            cursor.execute(rush_query, [today])
            rush_columns = [desc[0] for desc in cursor.description]
            rush_periods = [dict(zip(rush_columns, row)) for row in cursor.fetchall()]
        except Exception as e:
            logger.warning(f"Error fetching rush periods: {str(e)}")
            rush_periods = []
        
        # DISABLED: don't fabricate sample shifts/breaks when there's no
        # real schedule (showed fake data forever — see station_api_routes
        # get_todays_schedule). Empty stays empty; the UI shows an honest
        # "no shifts" state. (This endpoint is shadowed by station_api's
        # /api/schedule/today anyway, but disabled here too for consistency.)
        if False:  # was: if len(shifts)==0 and len(breaks)==0 and len(rush_periods)==0
            # Create sample shifts and breaks
            try:
                cursor.execute('''
                    INSERT INTO schedule_shifts 
                    (barista_id, barista_name, station_id, date, start_time, end_time, status, notes) 
                    VALUES 
                    (1, 'Alex Smith', 1, %s, '08:00:00', '12:00:00', 'active', 'Morning shift'),
                    (2, 'Jamie Lee', 2, %s, '08:00:00', '16:00:00', 'active', 'Full day shift'),
                    (3, 'Taylor Johnson', 3, %s, '12:00:00', '20:00:00', 'upcoming', 'Afternoon shift')
                ''', (today, today, today))
                
                cursor.execute('''
                    INSERT INTO schedule_breaks 
                    (barista_id, barista_name, date, start_time, end_time, break_type, status, notes) 
                    VALUES 
                    (1, 'Alex Smith', %s, '10:00:00', '10:15:00', 'coffee', 'active', 'Short break'),
                    (2, 'Jamie Lee', %s, '12:00:00', '12:30:00', 'lunch', 'upcoming', 'Lunch break')
                ''', (today, today))
                
                cursor.execute('''
                    INSERT INTO schedule_rush_periods 
                    (date, start_time, end_time, description) 
                    VALUES 
                    (%s, '08:30:00', '09:30:00', 'Morning rush'),
                    (%s, '12:00:00', '13:30:00', 'Lunch rush')
                ''', (today, today))
                
                db.commit()
                
                # Re-query to get the new data
                cursor.execute(shifts_query, shifts_params)
                shifts_columns = [desc[0] for desc in cursor.description]
                shifts = [dict(zip(shifts_columns, row)) for row in cursor.fetchall()]
                
                cursor.execute(breaks_query, [today])
                breaks_columns = [desc[0] for desc in cursor.description]
                breaks = [dict(zip(breaks_columns, row)) for row in cursor.fetchall()]
                
                cursor.execute(rush_query, [today])
                rush_columns = [desc[0] for desc in cursor.description]
                rush_periods = [dict(zip(rush_columns, row)) for row in cursor.fetchall()]
            except Exception as e:
                logger.warning(f"Error creating sample schedule data: {str(e)}")
        
        # Convert datetime objects to ISO format strings for JSON serialization
        for shift in shifts:
            for key, value in shift.items():
                if isinstance(value, (datetime, date)):
                    shift[key] = value.isoformat()
                elif isinstance(value, time):
                    shift[key] = value.strftime('%H:%M:%S')
        
        for break_item in breaks:
            for key, value in break_item.items():
                if isinstance(value, (datetime, date)):
                    break_item[key] = value.isoformat()
                elif isinstance(value, time):
                    break_item[key] = value.strftime('%H:%M:%S')
        
        for rush in rush_periods:
            for key, value in rush.items():
                if isinstance(value, (datetime, date)):
                    rush[key] = value.isoformat()
                elif isinstance(value, time):
                    rush[key] = value.strftime('%H:%M:%S')
        
        return jsonify({
            'success': True,
            'schedule': {
                'shifts': shifts,
                'breaks': breaks,
                'rushPeriods': rush_periods,
                'date': today.isoformat()
            }
        })
    
    except Exception as e:
        logger.error(f"Error fetching schedule: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching schedule: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): POST /api/schedule/shifts is served by station_api.add_shift.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_shift():
    """Add a new shift to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['barista_id', 'barista_name', 'station_id', 'date', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert shift
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_shifts
            (barista_id, barista_name, station_id, date, start_time, end_time, status, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        ''', (
            data['barista_id'],
            data['barista_name'],
            data['station_id'],
            data['date'],
            data['start_time'],
            data['end_time'],
            data.get('status', 'upcoming'),
            data.get('notes', '')
        ))
        
        db.commit()
        
        # Get created shift
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        shift = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'shift': shift,
            'message': 'Shift added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding shift: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding shift: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): POST /api/schedule/breaks is served by station_api.add_break.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_break():
    """Add a new break to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['barista_id', 'barista_name', 'date', 'start_time', 'end_time', 'break_type']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert break
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_breaks
            (barista_id, barista_name, date, start_time, end_time, break_type, status, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        ''', (
            data['barista_id'],
            data['barista_name'],
            data['date'],
            data['start_time'],
            data['end_time'],
            data['break_type'],
            data.get('status', 'upcoming'),
            data.get('notes', '')
        ))
        
        db.commit()
        
        # Get created break
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        break_data = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'break': break_data,
            'message': 'Break added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding break: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding break: {str(e)}"
        }), 500

# Not routed (roadmap X7-10): POST /api/schedule/rush-periods is served by station_api.add_rush_period.
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_rush_period():
    """Add a new rush period to the schedule"""
    try:
        data = request.json
        
        # Validate required fields
        required_fields = ['date', 'start_time', 'end_time', 'description']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'message': f"Missing required field: {field}"
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert rush period
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO schedule_rush_periods
            (date, start_time, end_time, description)
            VALUES (%s, %s, %s, %s)
            RETURNING *
        ''', (
            data['date'],
            data['start_time'],
            data['end_time'],
            data['description']
        ))
        
        db.commit()
        
        # Get created rush period
        result = cursor.fetchone()
        columns = [desc[0] for desc in cursor.description]
        rush_period = dict(zip(columns, result))
        
        return jsonify({
            'success': True,
            'rushPeriod': rush_period,
            'message': 'Rush period added successfully'
        }), 201
    
    except Exception as e:
        logger.error(f"Error adding rush period: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error adding rush period: {str(e)}"
        }), 500


# -------------------------------------------------------------------
# Stub endpoints for two routes the frontend calls on load that
# previously 404'd, flooding the console with errors and triggering
# the smoke test. They both store JSON under a `settings` row so
# operators get real persistence without a schema change.
# -------------------------------------------------------------------

def _kv_get(db, key, default=None):
    cur = db.cursor()
    try:
        db.rollback()
    except Exception:
        pass
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    if not row:
        return default
    raw = row[0] if not isinstance(row, dict) else row.get('value')
    try:
        return json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return raw if raw is not None else default


def _kv_put(db, key, value, merge=False):
    """Write a settings blob.

    Default is REPLACE, and that is deliberate: most callers here pass
    complete state, where a key that has gone away must actually go away.
    Merging `station_inventory_configs` would resurrect a station you just
    deleted.

    merge=True is for PARTIAL saves — a screen that owns three fields of a
    twenty-field blob. Without it, saving "just the SMS number" onto
    branding_settings takes the base64 logos with it, because they were
    simply not in the payload.

    Merge semantics: keys present in `value` always win, INCLUDING empty
    ones. Only keys absent from `value` survive from what was stored. So
    clearing a logo still works — send '' for it; don't omit it.

    Only dict-on-dict merges. A list, a bool or a scalar replaces, because
    there is no sensible merge of those and silently concatenating lists
    would be worse than replacing them.

    The read happens under SELECT ... FOR UPDATE so a concurrent save
    cannot land between the read and the write. Callers used to do this
    merge client-side with a GET then a PUT, which had exactly that gap.
    """
    cur = db.cursor()
    try:
        db.rollback()
    except Exception:
        pass

    if merge and isinstance(value, dict):
        cur.execute("SELECT value FROM settings WHERE key = %s FOR UPDATE",
                    (key,))
        row = cur.fetchone()
        if row:
            raw = row['value'] if isinstance(row, dict) else row[0]
            try:
                existing = json.loads(raw)
            except (TypeError, ValueError):
                # Not JSON — some rows hold plain strings (sponsor_name and
                # friends). Nothing to merge with; the new value stands.
                existing = None
            if isinstance(existing, dict):
                value = {**existing, **value}

    payload = json.dumps(value)
    cur.execute("""
        INSERT INTO settings (key, value, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_at = NOW()
    """, (key, payload))
    db.commit()


# ----------------------------------------------------------------------
# Sponsor logo ticker (Steve, last-minute for Treenet): a horizontally
# scrolling strip of sponsor logos on the public display, above OR below
# the Brewing/Ready sections. Logos are stored as data URLs in the
# settings KV 'sponsor_ticker' (same pattern as the branding logo), so
# the Organiser Sponsors panel can add/remove/reorder them with no
# redeploy. Kept SEPARATE from the single SMS-sponsor line (that lives in
# branding_settings.sponsorName/Message) — this is the visual logo reel.
# ----------------------------------------------------------------------
# Tiers are user-defined (Steve: "might be diamond sponsor for a event and
# platinum for another"), ordered (rank = list order), each with a dwell
# time used by the wall's scroll mode ("10 seconds for platinums and 6 for
# gold and 3 for silver"). These are only SEED defaults for a fresh event;
# the operator renames/reorders/re-times them freely.
_DEFAULT_TIERS = [
    {'id': 'platinum', 'name': 'Platinum', 'dwell': 10},
    {'id': 'gold', 'name': 'Gold', 'dwell': 6},
    {'id': 'silver', 'name': 'Silver', 'dwell': 4},
    {'id': 'bronze', 'name': 'Bronze', 'dwell': 3},
]


def _clamp_num(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def _norm_tiers(raw):
    tiers = []
    for i, t in enumerate((raw or [])[:20]):
        if not isinstance(t, dict):
            continue
        name = (t.get('name') or '').strip()[:40]
        if not name:
            continue
        tiers.append({
            'id': str(t.get('id') or name.lower().replace(' ', '-') or i),
            'name': name,
            'dwell': _clamp_num(t.get('dwell'), 1, 60, 5),
            # 'compact' tiers sit side-by-side in the grid wall (Steve: the
            # coffee/dinner single-logo tiers can share a row and go wider).
            'compact': bool(t.get('compact')),
        })
    return tiers


def _norm_wall(raw):
    raw = raw if isinstance(raw, dict) else {}
    bg = raw.get('background')
    gs = raw.get('gridSize')
    return {
        'enabled': bool(raw.get('enabled')),
        'layout': 'grid' if raw.get('layout') == 'grid' else 'scroll',
        # Grid logo size: 'small' packs more logos per row (wider), 'large'
        # shows a few big ones, 'medium' is the original look. Only affects
        # the grid layout. Must be whitelisted here or it is dropped on save.
        'gridSize': gs if gs in ('small', 'medium', 'large') else 'medium',
        # Backdrop: 'tint' (soft green wash, default), 'white' (clean, logos
        # pop), or 'branded' (reuse the display's uploaded background image).
        'background': bg if bg in ('tint', 'white', 'branded') else 'tint',
        'takeover': bool(raw.get('takeover')),
        'everySec': _clamp_num(raw.get('everySec'), 15, 3600, 180),
        'forSec': _clamp_num(raw.get('forSec'), 3, 600, 20),
    }


def _sponsor_ticker_read(db):
    data = _kv_get(db, 'sponsor_ticker', default={}) or {}
    tiers = _norm_tiers(data.get('tiers'))
    if not tiers:
        tiers = [dict(t) for t in _DEFAULT_TIERS]
    return {
        'enabled': bool(data.get('enabled')),
        'position': 'top' if data.get('position') == 'top' else 'bottom',
        'size': data.get('size') if data.get('size') in ('small', 'medium', 'large') else 'small',
        'tiers': tiers,
        'wall': _norm_wall(data.get('wall')),
        'sponsors': [
            {
                'id': str(s.get('id') or i),
                'name': (s.get('name') or '').strip()[:80],
                'image': s.get('image') or '',
                'tier': (s.get('tier') or '').strip()[:40],
            }
            for i, s in enumerate(data.get('sponsors') or [])
            if isinstance(s, dict) and s.get('image')
        ],
    }


def _sponsor_ticker_clean(payload):
    """The sponsor wall as stored: capped list, capped logo size, known
    options only. Shared by the Sponsors panel's save and by a saved event
    being loaded (_apply_event_extras)."""
    payload = payload if isinstance(payload, dict) else {}
    sponsors = []
    for i, s in enumerate((payload.get('sponsors') or [])[:30]):  # sane cap on count
        if not isinstance(s, dict):
            continue
        img = s.get('image') or ''
        # ~600KB cap per logo data URL (the panel downscales first).
        if not img or len(img) > 600_000:
            continue
        sponsors.append({
            'id': str(s.get('id') or i),
            'name': (s.get('name') or '').strip()[:80],
            'image': img,
            'tier': (s.get('tier') or '').strip()[:40],
        })
    return {
        'enabled': bool(payload.get('enabled')),
        'position': 'top' if payload.get('position') == 'top' else 'bottom',
        'size': payload.get('size') if payload.get('size') in ('small', 'medium', 'large') else 'small',
        'tiers': _norm_tiers(payload.get('tiers')),
        'wall': _norm_wall(payload.get('wall')),
        'sponsors': sponsors,
    }


# ----------------------------------------------------------------------
# Display background VIDEO (Steve): a gentle looping animation behind the
# board, most visible when there are no orders. Portrait (9:16) and
# landscape (16:9) versions, the display picks by its own orientation.
# A value is either a hosted URL (best for HD) or a data: URL (short
# compressed clips). Kept in its OWN KV, not branding — these blobs are
# big and must not ride along on every branding/display-config read.
# ----------------------------------------------------------------------
_BG_VIDEO_MAX = 12_000_000  # ~9MB clip as base64; bigger should be a URL


def _clean_bg_video(v):
    if not isinstance(v, str) or not v:
        return ''
    if v.startswith('data:'):
        return v if len(v) <= _BG_VIDEO_MAX else ''
    # A plain URL — keep it short and sane.
    return v[:2000]


# ----------------------------------------------------------------------
# Quick Setup — single-call "café in 30 seconds" wizard.
#
# Operators ran into a wall the first time they set up an event: every
# milk type, cup size, drink category and station capability had to be
# configured by hand across multiple panels. This endpoint takes a
# single preset object and applies the whole config in one shot.
# ----------------------------------------------------------------------

DEFAULT_QUICK_PRESET = {
    'milks': ['full cream', 'skim', 'oat', 'almond', 'lactose free'],
    'sizes': ['medium'],
    'sweeteners': ['no sugar', '1 sugar', '2 sugar'],
    'drinks': {
        'espresso_drinks': True,   # latte, cappuccino, flat white, espresso, long black, mocha
        'hot_chocolate': False,
        'chai': False,
        'matcha': False,
    },
    'teas': {
        # Each per-flavor checkbox. All off by default — operator
        # opts in to whichever teas they're stocking.
        'english_breakfast': False,
        'earl_grey':         False,
        'green':             False,
        'peppermint':        False,
        'chamomile':         False,
        'lemon_ginger':      False,
        'rooibos':           False,
        'generic':           False,
    },
    # Free-text custom blends entered by the operator, comma-separated.
    'custom_teas': '',
    'unlimited_stock': True,
    'all_stations_same_capabilities': True,
    'always_open_schedule': True,
    # 'VIP' is a memorable demo code — operator can change it. When
    # provided (non-empty), Quick Setup writes to settings.vip_code so
    # SMS customers texting this string get marked VIP. Set to ''
    # (empty) to skip — preserves whatever vip_code is already saved.
    'vip_code': 'VIP',
    # Mark every existing station status='active' on apply. Useful for
    # demos / fresh events where the operator wants the stack ready
    # to take orders without manually flipping every station.
    'activate_all_stations': True,
}

ESPRESSO_DRINKS = ['latte', 'cappuccino', 'flat white', 'espresso', 'long black', 'mocha']
EXTRA_DRINKS = {
    'hot_chocolate': [('hot chocolate', 'drinks')],
    'chai':          [('chai latte', 'drinks')],
    'matcha':        [('matcha latte', 'drinks')],
}

# Tea flavors — keyed the same way the QuickSetup wizard sends them.
# Each tea is a separate drinks-category inventory row so the
# operator (or SMS bot) can refer to them individually.
TEA_FLAVORS = {
    'english_breakfast': 'english breakfast tea',
    'earl_grey':         'earl grey tea',
    'green':             'green tea',
    'peppermint':        'peppermint tea',
    'chamomile':         'chamomile tea',
    'lemon_ginger':      'lemon & ginger tea',
    'rooibos':           'rooibos tea',
    'generic':           'hot tea',
}


def _milk_default_amount(name):
    """Reasonable starting amounts so the new event isn't immediately
    "out of stock". 20 L for primary milks, 10 L for niche ones."""
    primary = {'full cream', 'skim', 'oat', 'soy'}
    return 30 if name in primary else 15


def _coffee_default_kg():
    return 5  # 5 kg of coffee beans is a small-event starting point


def _apply_quick_setup(coffee_system, preset):
    """Returns a list of summary strings describing what was applied."""
    db = coffee_system.db
    cur = db.cursor()
    summary = []

    # Make sure BOTH quantity columns exist before the seeds below write them
    # (heals the amount/current_quantity split-brain on older tables).
    try:
        coffee_system._ensure_inventory_quantity_columns(cur)
    except Exception:
        pass

    # 1. Wipe-and-rebuild inventory items. The operator can refine
    # individual rows after this initial setup.
    cur.execute("DELETE FROM inventory_items")

    # Milks
    for milk in preset.get('milks', []):
        amount = _milk_default_amount(milk)
        cur.execute("""
            INSERT INTO inventory_items
            (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('milk', %s, %s, %s, 'L', %s, 2)
        """, (milk, amount, amount, amount * 2))
    summary.append(f"{len(preset.get('milks', []))} milk types")

    # Coffee beans (always: house blend; never the drinks-as-stock
    # confusion the operator flagged). Decaf as a second SKU so the
    # SMS flow can route decaf orders to a station that has decaf.
    cur.execute("""
        INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
        VALUES ('coffee', 'house blend beans', %s, %s, 'kg', %s, 1),
               ('coffee', 'decaf beans', %s, %s, 'kg', %s, 1)
    """, (_coffee_default_kg(), _coffee_default_kg(), _coffee_default_kg() * 2,
          _coffee_default_kg() / 2, _coffee_default_kg() / 2, _coffee_default_kg()))
    summary.append("2 coffee bean SKUs (house + decaf)")

    # Cup sizes
    for size in preset.get('sizes', []):
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('cups', %s, 200, 200, 'units', 500, 50)
        """, (size,))
    summary.append(f"{len(preset.get('sizes', []))} cup size(s)")

    # Sweeteners. The count-style labels ('no sugar', '1 sugar', ...) are
    # PREFERENCES, not products — seeding one stock row per label gave
    # events five parallel 200-sachet counters ("feels like there's a
    # 5-teaspoon sachet", Steve). Collapse them to ONE 'sugar' row in
    # sachets; real named sweeteners (honey, stevia, ...) keep their own
    # rows. A bare 'sugar' row also lets the SMS gate accept any count
    # ("5 sugars") instead of only the enumerated ones.
    _sugar_labels, _named_sweeteners = [], []
    for s in preset.get('sweeteners', []):
        if re.match(r'^(no|half|\d+)\s*sugars?$', str(s).strip().lower()):
            _sugar_labels.append(s)
        else:
            _named_sweeteners.append(s)
    if _sugar_labels:
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('sugar', 'sugar', 500, 500, 'sachets', 1000, 50)
        """)
    for s in _named_sweeteners:
        cur.execute("""
            INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
            VALUES ('sugar', %s, 200, 200, 'sachets', 500, 20)
        """, (s,))
    summary.append(
        f"{(1 if _sugar_labels else 0) + len(_named_sweeteners)} sweetener stock row(s)"
    )

    # Drink categories: enable espresso-based drinks; optionally
    # add the non-coffee drinks the operator wants. We seed these as
    # rows in the existing `drinks` category so the walk-in dialog
    # picks them up (it already scans for "chai", "matcha" etc.).
    drinks_cfg = preset.get('drinks', {})
    if drinks_cfg.get('espresso_drinks', True):
        # Espresso drinks don't need to be in inventory — the
        # backend's _get_available_coffee_types returns the standard
        # list when coffee beans are in stock. So no rows needed.
        pass
    extras_added = 0
    for key, rows in EXTRA_DRINKS.items():
        if drinks_cfg.get(key):
            for name, category in rows:
                cur.execute("""
                    INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                    VALUES (%s, %s, 50, 50, 'units', 100, 10)
                """, (category, name))
                extras_added += 1
    if extras_added:
        summary.append(f"{extras_added} extra non-coffee drink(s)")

    # Teas — each ticked flavor becomes a drinks-category row so it
    # shows up in the menu and walk-in dialog. The `is_tea` flag
    # would normally be a schema column; we encode it in the name
    # ("... Tea") which is what the rest of the system already
    # checks for tea-specific behavior (smaller milk decrement etc).
    teas_cfg = preset.get('teas', {}) or {}
    teas_added = 0
    for key, name in TEA_FLAVORS.items():
        if teas_cfg.get(key):
            cur.execute("""
                INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                VALUES ('drinks', %s, 100, 100, 'units', 200, 20)
            """, (name,))
            teas_added += 1

    # Custom tea blends — split the operator's free-text string,
    # ensure each ends in "Tea" so downstream tea detection works,
    # and seed a row per blend.
    custom_raw = (preset.get('custom_teas') or '').strip()
    if custom_raw:
        parts = []
        for chunk in custom_raw.replace('\n', ',').split(','):
            t = chunk.strip()
            if not t:
                continue
            if 'tea' not in t.lower():
                t = f"{t} Tea"
            parts.append(t)
        for blend in parts:
            cur.execute("""
                INSERT INTO inventory_items (category, name, amount, current_quantity, unit, capacity, minimum_threshold)
                VALUES ('drinks', %s, 100, 100, 'units', 200, 20)
            """, (blend.lower(),))
            teas_added += 1

    if teas_added:
        summary.append(f"{teas_added} tea flavor(s)")

    db.commit()

    # 2. Unlimited stock mode — the conversation flow can check this
    # flag to skip "you're out of X" responses for organisers who
    # aren't tracking stock at the event.
    unlimited = bool(preset.get('unlimited_stock'))
    _kv_put(db, 'unlimited_stock_mode', {'enabled': unlimited})
    if unlimited:
        summary.append("unlimited-stock mode ON")

    # 3. All stations same capabilities — copy the first station's
    # capabilities (or build a default) to every station.
    if preset.get('all_stations_same_capabilities'):
        capabilities = {
            'milk_types': preset.get('milks', []),
            'coffee_types': ESPRESSO_DRINKS,
            'sizes': preset.get('sizes', []),
            'alt_milk': True,
        }
        cur.execute(
            "UPDATE station_stats SET capabilities = %s::jsonb",
            (json.dumps(capabilities),),
        )
        db.commit()
        summary.append("all stations given the same capabilities")

    # 4. Always-open schedule — clear event_breaks so the
    # break-window logic in _assign_station can't accidentally
    # narrow routing during the event.
    if preset.get('always_open_schedule'):
        try:
            cur.execute("DELETE FROM event_breaks")
            db.commit()
            summary.append("schedule set to always open (no breaks)")
        except Exception:
            db.rollback()

    # 5. VIP code. Stored in settings.vip_code — when a customer texts
    # this string the SMS handler flips their customer_preferences.is_vip
    # to true. Skipped when blank so existing vip_code is preserved.
    _vip_code = (preset.get('vip_code') or '').strip()
    if _vip_code:
        try:
            cur.execute("""
                INSERT INTO settings(key, value) VALUES('vip_code', %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (_vip_code,))
            db.commit()
            summary.append(f"VIP code set to '{_vip_code}'")
        except Exception as e:
            logger.warning(f"quick-setup vip_code save failed: {e}")
            db.rollback()

    # 6. Activate all stations — flip status='active' across the board.
    # Convenience for fresh setups / demos where the operator wants the
    # whole stack ready to take orders without manually toggling each.
    if preset.get('activate_all_stations'):
        try:
            cur.execute("UPDATE station_stats SET status = 'active' WHERE status != 'active'")
            n = cur.rowcount or 0
            db.commit()
            if n > 0:
                summary.append(f"activated {n} station(s)")
        except Exception as e:
            logger.warning(f"quick-setup activate_all_stations failed: {e}")
            db.rollback()

    # 7-10. A saved EVENT, not just a menu: a template may also carry the
    # look, the one-tap drinks, the sugar rule and how many stations run
    # (Steve: "save events and recall"). Each is applied only when the
    # template has the key, so every older template behaves as before.
    summary.extend(_apply_event_extras(coffee_system, preset))

    return summary


# What "the look" of an event is, inside branding_settings: cleared when a
# saved event is loaded (see _apply_event_extras). Deliberately a list of
# what to CLEAR, not what to keep, so a key nobody listed here (the SMS
# number, the system name) survives.
EVENT_LOOK_KEYS = frozenset({
    'logo', 'clientLogo', 'clientName', 'companyName',
    'eventName', 'event_name', 'landingTitle', 'landingPageTitle',
    'headerColor', 'primaryColor', 'secondaryColor', 'accentColor',
    'backgroundColor', 'textColor',
    'customerHeaderColor', 'customerHeaderMode', 'customerHeaderImage',
    'background_landscape', 'background_portrait', 'bgLandscape', 'bgPortrait',
    'customMessage', 'footerText',
    # The cup sticker's logo is part of the event too: left behind, the
    # last event's sponsor printed on the next event's cups (16 Oct 2026).
    'labelLogo',
    'sponsorEnabled', 'showSponsor', 'sponsorName', 'sponsorMessage', 'sponsorLogo',
})


def _apply_event_extras(coffee_system, preset):
    """Branding, quick picks, self-serve sugar and active-station count
    from a recalled event template. Returns summary lines; never raises."""
    db = coffee_system.db
    summary = []

    branding = preset.get('branding')
    if preset.get('_replace_look'):
        # LOADING A SAVED EVENT REPLACES THE LOOK (Steve, 12 Oct). Merging
        # left the previous event's logo, colours, backgrounds and quick
        # picks on screen whenever the event being loaded didn't carry its
        # own (a menu-only saved event) -- the Virgin demo would have stayed
        # Virgin-red under the next client's name. Only the look keys are
        # cleared; the rest of the blob (SMS number, system name) stays.
        # Running Quick Setup by hand does not send _replace_look, so adding
        # a milk mid-event still keeps the branding.
        try:
            current = _kv_get(db, 'branding_settings', default={}) or {}
            if not isinstance(current, dict):
                current = {}
            kept = {k: v for k, v in current.items() if k not in EVENT_LOOK_KEYS}
            fresh = {**kept, **(branding if isinstance(branding, dict) else {})}
            _kv_put(db, 'branding_settings', fresh)
            _kv_put(db, 'display_bg_video', {})
            try:
                coffee_system._event_name_cache = None
            except Exception:
                pass
            if not isinstance(preset.get('quick_picks'), list):
                _kv_put(db, 'quick_picks', [])
            summary.append('look replaced' + (f" ({len(branding)} field(s))" if isinstance(branding, dict) and branding else ' (reset to plain)'))
        except Exception as e:
            logger.warning(f"event template look reset failed: {e}")
            try:
                db.rollback()
            except Exception:
                pass
    elif isinstance(branding, dict) and branding:
        try:
            # Merge, like the Branding screen: keys the template leaves out
            # (an uploaded logo, say) are kept rather than wiped.
            _kv_put(db, 'branding_settings', branding, merge=True)
            summary.append(f"branding set ({len(branding)} field(s))")
        except Exception as e:
            logger.warning(f"event template branding failed: {e}")
            try:
                db.rollback()
            except Exception:
                pass

    # The sponsor wall is part of the event too (Steve, 16 Oct: flick between
    # the CupQ demo event and the Virgin one). A saved event that carries
    # sponsors puts them back; loading one that doesn't clears the last
    # event's, so Virgin's screens never show the CupQ demo's sponsors.
    sponsors = preset.get('sponsors')
    if isinstance(sponsors, dict) or preset.get('_replace_look'):
        try:
            _kv_put(db, 'sponsor_ticker', _sponsor_ticker_clean(sponsors if isinstance(sponsors, dict) else {}), merge=False)
            n = len((sponsors or {}).get('sponsors') or []) if isinstance(sponsors, dict) else 0
            summary.append(f"sponsors set ({n})" if n else 'sponsors cleared')
        except Exception as e:
            logger.warning(f"event template sponsors failed: {e}")
            try:
                db.rollback()
            except Exception:
                pass

    # The Organiser's Event Inventory is the other half of the menu: Quick
    # Setup writes stock and capabilities, but what the kiosk and SMS OFFER
    # is also filtered by this list. Without it a recalled event kept the
    # previous event's extras switched on. A template holds the complete
    # list, so it REPLACES (a merge would resurrect items it switched off).
    inv = preset.get('event_inventory')
    if isinstance(inv, dict) and inv:
        try:
            _kv_put(db, 'event_inventory', inv)
            on = sum(1 for items in inv.values() if isinstance(items, list)
                     for it in items if isinstance(it, dict) and it.get('enabled', True))
            summary.append(f"event inventory set ({on} item(s) on)")
        except Exception as e:
            logger.warning(f"event template event_inventory failed: {e}")
            try:
                db.rollback()
            except Exception:
                pass

    if isinstance(preset.get('quick_picks'), list):
        try:
            from utils.quick_picks import normalize_picks
            picks = normalize_picks(preset['quick_picks'])
            _kv_put(db, 'quick_picks', picks)
            summary.append(f"{len(picks)} quick pick(s)")
        except Exception as e:
            logger.warning(f"event template quick picks failed: {e}")
            try:
                db.rollback()
            except Exception:
                pass

    if 'sugar_self_serve' in preset:
        val = 'true' if preset.get('sugar_self_serve') else 'false'
        try:
            cur = db.cursor()
            cur.execute("""
                INSERT INTO settings(key, value) VALUES('sugar_self_serve', %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (val,))
            db.commit()
            cache = getattr(coffee_system, 'settings_cache', None)
            if isinstance(cache, dict):
                cache.pop('sugar_self_serve', None)
            summary.append('sugar is self-serve' if val == 'true' else 'sugar asked at order')
        except Exception as e:
            logger.warning(f"event template sugar_self_serve failed: {e}")
            db.rollback()

    n = preset.get('active_stations')
    if isinstance(n, int) and not isinstance(n, bool) and n >= 1:
        # The first N stations by id run; the rest are switched off. A
        # lounge is one station; an event template can say three.
        try:
            cur = db.cursor()
            cur.execute("SELECT station_id FROM station_stats ORDER BY station_id")
            ids = [r['station_id'] if isinstance(r, dict) else r[0] for r in cur.fetchall()]
            on, off = ids[:n], ids[n:]
            if on:
                cur.execute("UPDATE station_stats SET status = 'active' WHERE station_id = ANY(%s)", (on,))
            if off:
                cur.execute("UPDATE station_stats SET status = 'inactive' WHERE station_id = ANY(%s)", (off,))
            db.commit()
            summary.append(f"{len(on)} station(s) on" + (f", {len(off)} off" if off else ''))
        except Exception as e:
            logger.warning(f"event template active_stations failed: {e}")
            db.rollback()

    return summary


# What Quick Setup last applied, kept so the screen (and "Save current as
# template") can show what is RUNNING. Before this the form fell back to
# the café defaults after every Apply, and saving "the current event"
# saved those defaults: a saved Virgin lost soy, small cups, hot
# chocolate and chai (found on demo.cupq.app, 16 Oct 2026).
QS_CURRENT_KEY = 'quick_setup_current'
# Never kept: the look and sponsors are read live when saving, and the
# event password is a credential.
_QS_NOT_KEPT = frozenset({'branding', 'sponsors', 'event_inventory', '_replace_look',
                          '_saved_event', 'event_password'})


def _qs_remember(db, merged):
    try:
        _kv_put(db, QS_CURRENT_KEY, {k: v for k, v in merged.items() if k not in _QS_NOT_KEPT})
    except Exception as e:
        logger.warning(f"quick setup: could not remember the applied preset: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _qs_live_menu(db):
    """The menu as it is now, read from inventory_items: Quick Setup's
    own rows plus anything changed on the Menu screen since."""
    try:
        cur = db.cursor()
        cur.execute("SELECT category, name FROM inventory_items ORDER BY id")
        rows = [((r['category'] if isinstance(r, dict) else r[0]) or '',
                 (r['name'] if isinstance(r, dict) else r[1]) or '') for r in cur.fetchall()]
    except Exception as e:
        logger.warning(f"quick setup: live menu read failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None
    if not rows:
        return None
    by_cat = {}
    for cat, name in rows:
        by_cat.setdefault(cat.strip().lower(), []).append(name.strip())
    drink_names = [n.lower() for n in by_cat.get('drinks', [])]
    known = {name for rows_ in EXTRA_DRINKS.values() for name, _c in rows_} | set(TEA_FLAVORS.values())
    return {
        'milks': by_cat.get('milk', []),
        'sizes': by_cat.get('cups', []),
        'drinks': {'espresso_drinks': True,
                   **{k: any(name in drink_names for name, _c in v) for k, v in EXTRA_DRINKS.items()}},
        'teas': {k: v in drink_names for k, v in TEA_FLAVORS.items()},
        'custom_teas': ', '.join(n for n in drink_names if n not in known and 'tea' in n),
    }


def _qs_current(db):
    """(preset, recorded): what is running, in Quick Setup's own shape."""
    saved = _kv_get(db, QS_CURRENT_KEY, default=None)
    preset = json.loads(json.dumps(DEFAULT_QUICK_PRESET))
    if isinstance(saved, dict):
        preset.update(saved)
    live = _qs_live_menu(db)
    if live:
        preset.update(live)
    try:
        cur = db.cursor()
        cur.execute("SELECT value FROM settings WHERE key = 'vip_code'")
        row = cur.fetchone()
        preset['vip_code'] = ((row['value'] if isinstance(row, dict) else row[0]) or '') if row else ''
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
    return preset, isinstance(saved, dict) or bool(live)


def _compute_proposed_inventory(preset):
    """Compute the inventory_items rows that _apply_quick_setup WOULD
    insert, given the preset. Mirrors the INSERT logic above; if this
    drifts from _apply_quick_setup, the dry-run lies. Keep them in sync.

    Returns list of (category, name) tuples, lowercased for comparison.
    """
    rows = []
    for milk in preset.get('milks', []) or []:
        rows.append(('milk', str(milk).lower().strip()))
    rows.append(('coffee', 'house blend beans'))
    rows.append(('coffee', 'decaf beans'))
    for size in preset.get('sizes', []) or []:
        rows.append(('cups', str(size).lower().strip()))
    # Mirror of _apply_quick_setup's sweetener collapse: count-style
    # labels become ONE 'sugar' row; named sweeteners keep their own.
    _dr_sugar = False
    for s in preset.get('sweeteners', []) or []:
        if re.match(r'^(no|half|\d+)\s*sugars?$', str(s).strip().lower()):
            _dr_sugar = True
        else:
            rows.append(('sugar', str(s).lower().strip()))
    if _dr_sugar:
        rows.append(('sugar', 'sugar'))
    drinks_cfg = preset.get('drinks', {}) or {}
    for key, drink_rows in EXTRA_DRINKS.items():
        if drinks_cfg.get(key):
            for name, category in drink_rows:
                rows.append((category, name.lower().strip()))
    teas_cfg = preset.get('teas', {}) or {}
    for key, name in TEA_FLAVORS.items():
        if teas_cfg.get(key):
            rows.append(('drinks', name.lower().strip()))
    custom_raw = (preset.get('custom_teas') or '').strip()
    if custom_raw:
        for chunk in custom_raw.replace('\n', ',').split(','):
            t = chunk.strip()
            if not t:
                continue
            if 'tea' not in t.lower():
                t = f"{t} Tea"
            rows.append(('drinks', t.lower()))
    return rows


def _event_timezone():
    """Where the event actually is, as an IANA zone (utils/event_time.py).

    The server stores UTC (it runs TZ=UTC to match Railway) and every report
    grouped by the UTC date, which for an Australian coffee cart is simply the
    wrong day. Adelaide is UTC+9:30, so a 7am start is 21:30 UTC the PREVIOUS
    day: on the Treenet event that put 144 of the first morning's orders on
    the 2nd, and the two-day total read 463 instead of 577. A quarter of the
    event, filed under a day it did not happen on.

    Settable per event; defaults to Steve's own zone rather than UTC, because
    a default of UTC is the bug. Every "today" in the app resolves through
    this same clock now, not just the report (finding 3).
    """
    getter = None
    try:
        coffee_system = current_app.config.get('coffee_system')
        if coffee_system:
            getter = coffee_system._get_setting
    except Exception:
        getter = None
    return _event_time.resolve_zone(getter)


def _today_bounds():
    """(start, end) naive UTC for today where the event is; end EXCLUSIVE."""
    return _event_time.today_bounds(_event_timezone())


def _report_window():
    """The window a report covers, as UTC instants. Returns (start, end, label,
    tz) where end is EXCLUSIVE.

    The dates in the URL are LOCAL dates -- the day the event happened, as the
    person who was there would name it -- and they are converted to the UTC
    instants that bracket that local day. The SQL then stays a plain range over
    created_at, which is both simple and index-friendly.

    ?date=YYYY-MM-DD   one local day
    ?from=&to=         a range, both ends inclusive (an event runs over days)
    nothing            today, where the event is

    Bad dates fall back to today rather than erroring: a mistyped URL should
    show today's numbers, not a stack trace.
    """
    tz = _event_timezone()
    today = _event_time.local_today(tz)
    one = _event_time.parse_date(request.args.get('date'))
    a = _event_time.parse_date(request.args.get('from'))
    b = _event_time.parse_date(request.args.get('to'))
    if one:
        a = b = one
    elif a and b:
        if b < a:
            a, b = b, a
    elif a:
        b = a
    else:
        a = b = today
    label = a.isoformat() if a == b else f'{a.isoformat()} to {b.isoformat()}'
    start, end = _event_time.range_bounds(a, b, tz)
    return start, end, label, tz


def _held_rows(db):
    """(order_details, status, phone) for every order owing a notification."""
    out = []
    try:
        cur = db.cursor()
        cur.execute(
            "SELECT order_details, status, phone, order_number, station_id "
            "FROM orders WHERE order_details::text LIKE %s",
            ('%"notification_held"%',))
        for r in (cur.fetchall() or []):
            raw = r[0] if not isinstance(r, dict) else r.get('order_details')
            try:
                details = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except Exception:
                details = {}
            status = r[1] if not isinstance(r, dict) else r.get('status')
            phone = r[2] if not isinstance(r, dict) else r.get('phone')
            number = r[3] if not isinstance(r, dict) else r.get('order_number')
            station = r[4] if not isinstance(r, dict) else r.get('station_id')
            details['_order_number'] = number
            details['_station_id'] = station
            out.append((details, status, phone))
    except Exception as e:
        logger.warning(f"held rows query failed: {e}")
        try:
            db.rollback()
        except Exception:
            pass
    return out


# ----------------------------------------------------------------------
# Thermal label printing (network printer path)
# ----------------------------------------------------------------------
# Per-station printer config lives in settings KV under 'printer_config'
# as {"<station_id>": {"ip","port","enabled","auto_print"}}. No schema
# migration needed.

def _get_printer_config(db, station_id=None):
    cfg = _kv_get(db, 'printer_config', default={}) or {}
    if station_id is not None:
        return cfg.get(str(station_id), {})
    return cfg


def _fetch_order_for_label(db, order_number):
    cur = db.cursor()
    cur.execute("""
        SELECT id, order_number, order_details, status, station_id
          FROM orders WHERE order_number = %s LIMIT 1
    """, (order_number,))
    row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        return {
            'id': row['id'], 'order_number': row['order_number'],
            'order_details': row['order_details'], 'status': row['status'],
            'station_id': row['station_id'],
        }
    return {
        'id': row[0], 'order_number': row[1], 'order_details': row[2],
        'status': row[3], 'station_id': row[4],
    }


def _branding_for_label(db):
    try:
        b = _kv_get(db, 'branding_settings', default={}) or {}
        return {
            'event_name': (b.get('event_name') or b.get('eventName')
                           or _kv_get(db, 'event_name', default='') or ''),
            # The renderer prints this as the label footer. Without it the
            # footer falls back to the product name baked into the code,
            # which is wrong the moment an operator renames the system.
            'systemName': (b.get('systemName') or b.get('system_name') or ''),
        }
    except Exception as e:
        logger.warning(f"label branding read failed; footer uses defaults: {e}")
        return {}


DEFAULT_PRICING = {
    'enabled': False,
    'currency': 'AUD',
    'symbol': '$',
    # Base price per drink type. The bot is tolerant to missing keys —
    # any drink not listed defaults to `unknown_drink_price` so a
    # newly-added drink doesn't crash the SMS confirmation.
    'per_drink': {
        'latte': 4.50, 'cappuccino': 4.50, 'flat white': 4.50,
        'long black': 4.00, 'espresso': 3.50, 'mocha': 5.00,
        'macchiato': 4.00, 'cortado': 4.00, 'piccolo': 4.00,
        'americano': 4.00,
        'hot chocolate': 4.50, 'chai latte': 4.50, 'matcha latte': 5.00,
        'golden latte': 5.00,
        'hot tea': 3.50, 'english breakfast tea': 3.50, 'earl grey tea': 3.50,
        'green tea': 3.50, 'peppermint tea': 3.50, 'chamomile tea': 3.50,
        'lemon & ginger tea': 3.50, 'rooibos tea': 3.50,
    },
    'unknown_drink_price': 4.50,   # fallback for drinks not in per_drink
    'milk_surcharge': {
        'full cream': 0.00, 'skim': 0.00, 'dairy': 0.00, 'no milk': 0.00,
        'oat': 0.50, 'almond': 0.50, 'soy': 0.50, 'coconut': 0.50,
        'lactose free': 0.50, 'macadamia': 0.50, 'rice': 0.50,
    },
    'size_surcharge': {'small': -0.50, 'medium': 0.00, 'large': 0.50},
    'sugar_surcharge_per_sachet': 0.00,
    # VIP comp: when True AND a customer is flagged VIP (via SMS VIP
    # code, or marked VIP on a walk-in), their drink is free. The
    # price-compute returns 0 with "VIP — no charge" instead of a
    # dollar amount. Staff can be treated the same way by issuing
    # them a VIP code — no separate "staff_free" flag needed.
    'vip_free': False,
    # How the customer is asked to pay (services/payments.py):
    #   honour          order goes through, pay whenever (today)
    #   pay_to_collect  made regardless, UNPAID until paid, "pay at the
    #                   counter to collect" on the ready text and beacon
    #   pay_to_order    not placed until the phone payment succeeds
    #                   (needs a connected Square)
    'mode': 'honour',
    # Display options
    'show_in_sms': True,            # embed total in SMS confirmation
    'show_in_walkin': True,         # show total at bottom of walk-in dialog
    'show_in_barista': True,        # show total on the order card in barista UI
    'show_on_display': False,       # NOT shown on customer Display by default
}


# ============================================================================
# CATALOG (single source of truth for option lists)
# ============================================================================
# All UIs (walk-in dialog, capability editor, inventory editor) read
# their option lists from here. Replaces DEFAULT_MILK_TYPES, hardcoded
# drink lists, etc. — see services/migrations.py _m009_catalog_items
# for the design rationale.

VALID_CATALOG_CATEGORIES = {'milk', 'drink', 'size', 'sweetener'}


# The catalogue and the event menu name their categories differently
# ('milk' vs 'milk', but 'size' vs 'cups') -- and catalogue 'drink' SPANS
# TWO event categories: espresso drinks live under the event's 'coffee'
# list while teas/chai/hot chocolate live under 'drinks'. Checking only
# one of them marked every espresso drink as off-menu (or, with the
# all-greyed guard, flipped everything back on -- which is how the order
# editor offered Rooibos Tea at a coffee-only event).
_CATALOG_TO_EVENT_CATEGORY = {
    'milk': ['milk'],
    'drink': ['drinks', 'coffee'],
    'coffee': ['coffee'],
    'size': ['cups'],
    'sweetener': ['sweeteners'],
    'syrup': ['syrups'],
}


def _event_enabled_for_catalog(coffee_system, category):
    """Enabled names for a catalogue category, unioned across every event
    category it spans. Three states, kept distinct on purpose:
      None -> NO spanned category is configured (no opinion; fall back)
      []   -> configured, and everything is switched off (an instruction)
      [..] -> exactly these
    Collapsing [] into None is the bug this replaces: 'all drinks off'
    was read as 'never configured' and the whole tea list came back."""
    cats = _CATALOG_TO_EVENT_CATEGORY.get(category, [category])
    union, saw_any = [], False
    for c in cats:
        got = coffee_system._event_enabled(c)
        if got is None:
            continue
        saw_any = True
        union.extend(got)
    return union if saw_any else None


# ============================================================================
# WALK-IN DEFAULTS
# ============================================================================
# When the operator opens the walk-in dialog, what should already be filled
# in so they only need to confirm the customer name and Submit? This blob
# moves a pile of hardcoded literals out of WalkInOrderDialog.js (default
# coffee type, default size, milk preference order) into a single
# event-configurable setting. Edited via QuickSetup → Walk-in Defaults.
#
# Stored in settings KV under 'walkin_defaults'.

DEFAULT_WALKIN_DEFAULTS = {
    # The drink the dialog opens with. Australian default is Flat White;
    # US events might prefer Latte. Has to be a string that matches one
    # of the items in the station's drinks menu — invalid values fall
    # back to the first available drink at render time.
    'default_coffee_type': 'Flat White',

    # Size that's pre-selected. 'Small (8oz)' is the most-common
    # walk-in drink at events.
    'default_size': 'Small (8oz)',

    # Espresso shots default. Mostly 1 except for double-shot crowds.
    'default_shots': '1',

    # Milk preference order — the dialog picks the FIRST one in this
    # list that's actually stocked at the station. Australian events
    # set 'full cream' first; US events 'whole milk'; oat-heavy
    # crowds can lead with 'oat'. Tokens are matched case-insensitive
    # against the milk's id and name. Falls back to whatever's
    # available if none of the preferences are stocked.
    'default_milk_preference_order': [
        'whole milk', 'full cream', 'regular', 'standard',
        'dairy', 'milk', 'skim', 'low fat',
    ],

    # When the customer doesn't ask for sugar, the dialog still has
    # to send SOME sweetener quantity. 0 = silent default; the
    # 'No sugar' string is built at submit time when qty=0.
    'default_sweetener_qty': 0,
}


DEFAULT_ROUTING_RULES = {
    # Mirror the keys QueueIntelligence.js stores in localStorage.
    # Each toggle nudges _assign_station's behavior:
    #
    # prioritizeEfficiency   — prefer high-throughput stations (capacity_weight wins ties)
    # balanceWorkload        — keep load balanced across stations (default behavior)
    # considerCapabilities   — refuse to assign a milk an active station can't make
    # emergencyMode          — ignore capability gating in a pinch
    'prioritizeEfficiency': True,
    'balanceWorkload':      True,
    'considerCapabilities': True,
    'emergencyMode':        False,
}


# ======================================================================
# EventsAir integration (scaffold — see EVENTSAIR_INTEGRATION.md)
# ----------------------------------------------------------------------
# Bidirectional: attendees order coffee from the EventsAir app → orders
# land in Coffee Cue's normal pipeline (+ stock control); status updates
# push back to attendees via EventsAir notifications (alongside SMS).
#
# Phase 0 (this scaffold): the inbound order endpoint reuses the EXISTING
# /api/orders pipeline via an internal self-call — zero duplication of
# the validated order path (price, station checks, capability, stock).
# The EventsAir client is stubbed until a real API key exists.
# ======================================================================

def _eventsair_secret_ok(db):
    """Shared-secret gate for EventsAir inbound webhooks. Same pattern
    as the ClickSend/Cellcast SMS webhooks. Returns (ok, reason)."""
    import os  # not imported at module top in this file
    try:
        from services.eventsair import load_config
        cfg = load_config(db)
    except Exception as e:
        return False, f'config load failed: {e}'
    if not cfg.get('enabled'):
        return False, 'EventsAir integration is disabled'
    secret = (cfg.get('webhook_secret') or '').strip()
    from auth import unsigned_webhooks_allowed
    testing = unsigned_webhooks_allowed()  # TESTING_MODE on a laptop copy only
    if not secret:
        # No secret configured: accept only in TESTING_MODE. In prod this
        # FAILS CLOSED -- the integration was live on cupq.app with
        # enabled=true and no webhook_secret, so this branch was accepting
        # anonymous POSTs. Harmless while Phase 0 only logs; not once it
        # writes attendees. Set webhook_secret in Organiser > EventsAir.
        if testing:
            return True, 'testing-mode, no secret'
        logger.warning("EventsAir inbound REJECTED: webhook_secret not set (set one in Organiser > EventsAir)")
        return False, 'webhook_secret not set'
    provided = request.headers.get('X-Coffee-Cue-Webhook-Secret', '')
    import hmac  # constant-time: a plain != leaks how much of the secret matched
    if not hmac.compare_digest(provided.encode(), secret.encode()):
        return False, 'secret mismatch'
    return True, 'ok'


def _normalize_eventsair_order(payload):
    """Map an EventsAir order payload into the canonical /api/orders body.

    The exact EA payload shape is an open question (see the design doc) —
    this accepts the most likely field names and falls back gracefully.
    Keeps the EA-specific quirks isolated to this one function.
    """
    od = payload or {}
    # Attendee block may be nested or flat.
    att = od.get('attendee') or od.get('contact') or {}
    name = (od.get('customer_name') or att.get('name')
            or f"{att.get('firstName','')} {att.get('lastName','')}".strip()
            or 'EA Attendee')
    return {
        'customer_name': name,
        'coffee_type': od.get('coffee_type') or od.get('drink') or od.get('type'),
        'milk_type': od.get('milk_type') or od.get('milk') or 'full cream',
        'size': od.get('size') or 'medium',
        'sugar': od.get('sugar') or 'no sugar',
        'notes': od.get('notes') or od.get('special_instructions') or 'Ordered via EventsAir',
        'phone': od.get('phone') or att.get('mobile') or att.get('phone') or '',
        'station_id': od.get('station_id') or od.get('collection_station'),
        'priority': bool(od.get('vip') or od.get('priority')),
        # Carry the EA identifiers so the outbound notifier can push back.
        'source': 'eventsair',
        'eventsair_order_id': od.get('id') or od.get('order_id'),
        'eventsair_contact_id': att.get('id') or od.get('contact_id'),
    }


# ---------------------------------------------------------------------------
# NOTICES -- one message, every surface
#
# Steve, watching a broadcast go out: "wondering how this works for non-SMS
# beacon watching and even display watching... can they see this message via
# sms, via beacon etc?" They could not. broadcast/customers is SMS and only
# SMS, and a phone number is optional at every ordering door, so the people
# most likely to be standing there staring at the board were the ones least
# likely to be told.
#
# A notice is one row read by three surfaces: the public board, the beacon
# page on a customer's own phone, and (only if asked for) a text. It expires
# on its own, because nobody remembers to clear the board.
# ---------------------------------------------------------------------------

def _notice_db():
    """The one shared connection this file uses everywhere else. Rolled back
    first: a poisoned transaction from an earlier request would otherwise make
    every notice query fail for reasons that have nothing to do with notices."""
    coffee_system = current_app.config.get('coffee_system')
    db = getattr(coffee_system, 'db', None) if coffee_system else None
    if db is None:
        raise RuntimeError('database is not available')
    try:
        db.rollback()
    except Exception:
        pass
    return db


NOTICE_MAX_LEN = 280
NOTICE_LEVELS = {'info', 'warning'}


def _notice_row_to_dict(row):
    return {
        'id': row[0],
        'message': row[1],
        'level': row[2] or 'info',
        'onScreens': bool(row[3]),
        'onPhones': bool(row[4]),
        'bySms': bool(row[5]),
        'smsSent': row[6] or 0,
        'stationId': row[7],
        'createdBy': row[8],
        'createdAt': row[9].isoformat() if row[9] else None,
        'expiresAt': row[10].isoformat() if row[10] else None,
        'clearedAt': row[11].isoformat() if row[11] else None,
    }


_NOTICE_COLS = ("id, message, level, on_screens, on_phones, by_sms, sms_sent, "
                "station_id, created_by, created_at, expires_at, cleared_at")


def _notice_actor():
    try:
        ident = get_jwt_identity()
        return str(ident)[:120] if ident else None
    except Exception:
        return None


def _notice_send_sms(message, audience):
    """Fire the notice as a text through the existing broadcast path.

    Returns (sent_count, error_string_or_None). A failed text must never stop
    the notice reaching the board -- half a room told beats nobody told.
    """
    try:
        from routes.support_api_routes import (_broadcast_recipients,
                                               BROADCAST_MAX_RECIPIENTS)
        conn = _notice_db()
        cur = conn.cursor()
        recipients = _broadcast_recipients(cur, audience)
        cur.close()
        recipients = recipients[:BROADCAST_MAX_RECIPIENTS]
        svc = current_app.config.get('messaging_service')
        if not svc:
            return 0, 'Texts are not switched on for this event'
        sent = 0
        for phone in recipients:
            try:
                if svc.send_message(phone, message, kind='notice'):
                    sent += 1
            except Exception as send_err:
                logger.error(f"notice sms failed for {phone}: {send_err}")
        return sent, None
    except Exception as e:
        logger.error(f"_notice_send_sms error: {e}")
        return 0, str(e)


def _notice_broadcast(row, cleared=False):
    """Push it live so a board that is already open changes within the second,
    instead of waiting out its polling interval."""
    try:
        socketio = current_app.config.get('socketio')
        if socketio:
            socketio.emit('notice_update',
                          {'notice': row, 'cleared': cleared})
    except Exception as e:
        logger.warning(f"notice socket emit failed: {e}")


# The endpoints themselves live in routes/api/, one file per area
# (roadmap X7-11). Importing them here registers them on bp. Done by
# module path so no area name (stations, settings...) lands in this
# module's namespace.
import importlib as _importlib  # noqa: E402

for _area in (
    "order_queue",
    "customer_orders",
    "order_actions",
    "display",
    "reports",
    "stations",
    "inventory",
    "messages",
    "event_setup",
    "settings",
    "system",
):
    _importlib.import_module("routes.api." + _area)
