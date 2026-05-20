"""
WebSocket Event Handlers
Handles real-time communication between frontend and backend.

Auth model
----------
Each socket connection's `auth` payload should include a JWT token
(the frontend passes it in `auth: { token }` — see
`Barista Front End/src/services/WebSocketService.js`). On connect we
decode the token, stash the user's role on the session, and join only
the rooms appropriate for that role:

  - Customer Display / unauthenticated  → `public_updates` only
  - Barista                              → `public_updates`, `orders`,
                                           `station_<id>`, `chat`
  - Staff / Organizer / Admin            → all of the above plus
                                           `all_stations` and
                                           `support_metrics`

If JWT validation fails the connection is rejected — except when
TESTING_MODE is on, in which case the client is allowed through with
the lowest privilege (public_updates only) and a warning is logged.
This preserves the legacy "no auth in dev" behaviour without exposing
operational data on production deploys.

Previously this file unconditionally joined every client to every
room and returned `'authenticated': True` regardless of the
incoming credentials, which leaked order updates and inter-station
chat to any client that could reach the public WebSocket URL.
"""
from datetime import datetime
import logging

from flask import current_app, request
from flask_jwt_extended import decode_token
from flask_socketio import emit, join_room, leave_room

logger = logging.getLogger(__name__)


# Roles that count as "staff" — get full operational room access.
_STAFF_ROLES = {'barista', 'staff', 'organizer', 'admin'}
# Roles that get organizer/admin-only rooms (support metrics, etc.).
_ADMIN_ROLES = {'staff', 'organizer', 'admin'}

# In-memory session → role table. SocketIO assigns request.sid on
# connect; we use that to remember what role this session was granted
# so subsequent join_room calls can be gated by it.
_session_roles: dict[str, str] = {}


def _testing_mode():
    """Return True iff the app is configured to allow unauthenticated
    WebSocket connections (dev/CI). Reads from app config so a single
    env var toggles both this and the demo-token bypass in auth.py."""
    try:
        return bool(current_app.config.get('TESTING_MODE', False))
    except Exception:
        return False


def _extract_role(auth):
    """Decode the JWT in the auth payload and return the user's role.

    Returns one of:
      - the role string ('barista', 'admin', etc.) if the token is valid
      - 'public' if the token is missing/invalid AND TESTING_MODE is on
      - None if the token is missing/invalid in production (caller
        should reject the connection).
    """
    token = None
    if isinstance(auth, dict):
        token = auth.get('token') or auth.get('jwt')

    if not token:
        if _testing_mode():
            logger.warning(
                "WebSocket connect without auth token; allowing as 'public' "
                "because TESTING_MODE is on."
            )
            return 'public'
        logger.info("WebSocket connect rejected — no auth token.")
        return None

    # Strip an optional "Bearer " prefix some clients prepend.
    if token.startswith('Bearer '):
        token = token[7:]

    try:
        decoded = decode_token(token)
        role = (decoded.get('role') or '').lower() or 'public'
        return role
    except Exception as e:
        if _testing_mode():
            logger.warning(
                f"WebSocket token decode failed ({e}); allowing as 'public' "
                f"because TESTING_MODE is on."
            )
            return 'public'
        logger.warning(f"WebSocket connect rejected — bad token: {e}")
        return None


def _is_staff(role):
    return (role or '').lower() in _STAFF_ROLES


def _is_admin(role):
    return (role or '').lower() in _ADMIN_ROLES


def init_websocket_handlers(socketio):
    """Initialize WebSocket event handlers with JWT-based room scoping."""

    @socketio.on('connect')
    def handle_connect(auth=None):
        """Authenticate and join role-appropriate rooms."""
        try:
            role = _extract_role(auth)
            if role is None:
                # Reject — flask-socketio interprets a False return as
                # "refuse the connection".
                emit('error', {'message': 'Authentication required'})
                return False

            sid = request.sid
            _session_roles[sid] = role

            # Everyone can see public updates (Display screen lives off these).
            join_room('public_updates')

            if _is_staff(role):
                join_room('orders')
                join_room('chat')

            if _is_admin(role):
                join_room('all_stations')
                join_room('support_metrics')

            logger.info(
                f"WebSocket client connected (sid={sid}, role={role}); "
                f"joined rooms accordingly."
            )

            emit('connected', {
                'status': 'connected',
                'authenticated': role != 'public',
                'role': role,
                'message': 'Connected successfully',
            })
        except Exception as e:
            logger.error(f"Error in connect handler: {e}")
            emit('error', {'message': str(e)})
            return False

    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection — clean up session state."""
        sid = getattr(request, 'sid', None)
        if sid and sid in _session_roles:
            _session_roles.pop(sid, None)
        logger.info(f"WebSocket client disconnected (sid={sid})")

    @socketio.on('join_station')
    def handle_join_station(data):
        """Join a station-specific room. Staff only."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_staff(role):
                logger.warning(
                    f"Refused join_station from sid={request.sid} (role={role})"
                )
                emit('error', {'message': 'Insufficient privileges'})
                return

            station_id = data.get('station_id')
            if station_id:
                room = f'station_{station_id}'
                join_room(room)
                logger.info(f"sid={request.sid} joined room: {room}")
                emit('joined_station', {
                    'station_id': station_id,
                    'room': room,
                })
        except Exception as e:
            logger.error(f"Error joining station: {e}")

    @socketio.on('leave_station')
    def handle_leave_station(data):
        """Leave a station-specific room."""
        try:
            station_id = data.get('station_id')
            if station_id:
                room = f'station_{station_id}'
                leave_room(room)
                logger.info(f"sid={request.sid} left room: {room}")
                emit('left_station', {
                    'station_id': station_id,
                    'room': room,
                })
        except Exception as e:
            logger.error(f"Error leaving station: {e}")

    @socketio.on('join_role')
    def handle_join_role(data):
        """Join a role-specific room (organizers, baristas).

        Gated: the client can only join a role room they actually
        belong to (claimed role must match JWT role).
        """
        try:
            requested = (data.get('role') or '').lower()
            actual = _session_roles.get(request.sid, 'public')
            if requested not in {'organizers', 'baristas', 'admins'}:
                return
            allowed = (
                (requested == 'baristas' and _is_staff(actual)) or
                (requested == 'organizers' and _is_admin(actual)) or
                (requested == 'admins' and actual == 'admin')
            )
            if not allowed:
                logger.warning(
                    f"Refused join_role={requested} from sid={request.sid} "
                    f"(actual role={actual})"
                )
                emit('error', {'message': 'Insufficient privileges'})
                return
            join_room(requested)
            logger.info(f"sid={request.sid} joined role room: {requested}")
            emit('joined_role', {'role': requested})
        except Exception as e:
            logger.error(f"Error joining role: {e}")

    @socketio.on('join_room')
    def handle_join_room(data):
        """Generic join_room handler — used by the frontend's
        post-connect 'join orders' call. Gated by role.
        """
        try:
            room = data.get('room')
            role = _session_roles.get(request.sid, 'public')

            # Public room — anyone can join.
            if room == 'public_updates':
                join_room(room)
                return

            # Staff-only rooms.
            if room in ('orders', 'chat') and _is_staff(role):
                join_room(room)
                return

            # Admin-only rooms.
            if room in ('all_stations', 'support_metrics') and _is_admin(role):
                join_room(room)
                return

            # Station-specific rooms via this generic handler — staff only.
            if room and room.startswith('station_') and _is_staff(role):
                join_room(room)
                return

            logger.warning(
                f"Refused join_room={room!r} from sid={request.sid} (role={role})"
            )
        except Exception as e:
            logger.error(f"Error in generic join_room: {e}")

    @socketio.on('order_update')
    def handle_order_update(data):
        """Broadcast order updates to staff rooms (not public)."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_staff(role):
                return  # Silently drop — public clients can't emit ops events.

            order_id = data.get('order_id')
            station_id = data.get('station_id')
            status = data.get('status')

            # Emit to the 'orders' room only — public Display clients
            # don't subscribe to per-order updates with full details.
            emit('order_updated', {
                'order_id': order_id,
                'status': status,
                'station_id': station_id,
                'data': data,
                'timestamp': datetime.utcnow().isoformat(),
            }, room='orders')

            logger.info(f"Order {order_id} updated to {status}")
        except Exception as e:
            logger.error(f"Error updating order: {e}")

    @socketio.on('station_update')
    def handle_station_update(data):
        """Broadcast station updates to staff rooms."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_staff(role):
                return
            station_id = data.get('station_id')
            status = data.get('status')

            emit('station_updated', {
                'station_id': station_id,
                'status': status,
                'data': data,
                'timestamp': datetime.utcnow().isoformat(),
            }, room='all_stations')

            logger.info(f"Station {station_id} updated")
        except Exception as e:
            logger.error(f"Error updating station: {e}")

    @socketio.on('inventory_update')
    def handle_inventory_update(data):
        """Broadcast inventory updates — staff only."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_staff(role):
                return
            item_id = data.get('item_id')
            quantity = data.get('quantity')

            emit('inventory_updated', {
                'item_id': item_id,
                'quantity': quantity,
                'data': data,
                'timestamp': datetime.utcnow().isoformat(),
            }, room='orders')

            logger.info(f"Inventory updated for item {item_id}")
        except Exception as e:
            logger.error(f"Error updating inventory: {e}")

    @socketio.on('chat_message')
    def handle_chat_message(data):
        """Inter-station chat — staff only."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_staff(role):
                return
            message = data.get('message')
            sender = data.get('sender', 'Unknown')

            emit('chat_message', {
                'message': message,
                'sender': sender,
                'timestamp': datetime.utcnow().isoformat(),
            }, room='chat')

            logger.info(f"Chat message from {sender}")
        except Exception as e:
            logger.error(f"Error in chat: {e}")

    @socketio.on('metric_update')
    def handle_metric_update(data):
        """Support-dashboard metric updates — admin/staff only."""
        try:
            role = _session_roles.get(request.sid, 'public')
            if not _is_admin(role):
                return
            metric_type = data.get('type')
            value = data.get('value')

            emit('support:metric_update', {
                'type': metric_type,
                'value': value,
                'timestamp': datetime.utcnow().isoformat(),
            }, room='support_metrics')

            logger.info(f"Metric update: {metric_type} = {value}")
        except Exception as e:
            logger.error(f"Error updating metric: {e}")

    @socketio.on('request_sync')
    def handle_request_sync(data):
        """Sync requests — return to the requesting client only (no broadcast)."""
        try:
            sync_type = data.get('type')
            emit('sync_' + sync_type, {
                'type': sync_type,
                'timestamp': datetime.utcnow().isoformat(),
            })
            logger.info(f"Sync requested: {sync_type}")
        except Exception as e:
            logger.error(f"Error in sync request: {e}")

    logger.info("WebSocket handlers initialized (JWT auth + room scoping)")
