"""Square: the operator's own account, connected once, paying per order.

Payments level 2 (services/payments.py). A coffee cart that already runs
Square wants the ordering system to talk to *their* Square. So:

  - the operator connects THEIR account with Square OAuth from Runner >
    Settings (never Steve's account -- each event links its own);
  - when an order is placed, the server asks Square for a hosted Payment
    Link and keeps it on the order; the beacon shows "Pay $4.50 now", the
    ready text carries the link;
  - Square's webhook, signature-verified and fail-closed like the Twilio
    one, marks the order paid.

Nothing here runs unless three things exist: SQUARE_APPLICATION_ID and
SQUARE_APPLICATION_SECRET in the environment (a free Square developer app,
registered once by Steve), and a connection the operator made. Without
them every route answers "not configured" and the honour system carries
on exactly as before.

Tokens live in the settings KV under `square_connection`, written only by
the OAuth callback and the disconnect route. Square access tokens expire
after 30 days; the refresh token renews them here on demand.
"""

import json
import logging
import os
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, redirect, request

from auth import jwt_required_with_demo, role_required_with_demo
from services.payments import (SQUARE_KEY, OAUTH_SCOPES, SquareClient, is_connected,
                               mark_paid, order_number_from_webhook, read_connection,
                               square_base, verify_webhook_signature, webhook_is_completed)

logger = logging.getLogger("expresso.square")

bp = Blueprint('square', __name__, url_prefix='/api/square')

STATE_KEY = 'square_oauth_state'


def _db():
    return current_app.config.get('coffee_system').db


def _kv():
    from routes.consolidated_api_routes import _kv_get, _kv_put
    return _kv_get, _kv_put


def app_config():
    """Square app credentials from the environment. Missing = not configured."""
    return {
        'application_id': (os.getenv('SQUARE_APPLICATION_ID') or '').strip(),
        'application_secret': (os.getenv('SQUARE_APPLICATION_SECRET') or '').strip(),
        'env': (os.getenv('SQUARE_ENV') or 'sandbox').strip().lower(),
        'webhook_signature_key': (os.getenv('SQUARE_WEBHOOK_SIGNATURE_KEY') or '').strip(),
    }


def configured():
    c = app_config()
    return bool(c['application_id'] and c['application_secret'])


def public_base_url():
    """Where Square should send the customer back and the webhook to.
    PUBLIC_BASE_URL wins; else Railway's domain; else this request's host."""
    for var in ('PUBLIC_BASE_URL', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_STATIC_URL'):
        v = (os.getenv(var) or '').strip()
        if v:
            return v if v.startswith('http') else f"https://{v.strip('/')}"
    try:
        return request.url_root.rstrip('/')
    except Exception:
        return 'https://cupq.app'


def connection(db=None):
    """The stored connection, or {}."""
    _kv_get, _ = _kv()
    return read_connection(_kv_get(db or _db(), SQUARE_KEY, default=None))


def _save_connection(db, conn):
    _, _kv_put = _kv()
    _kv_put(db, SQUARE_KEY, conn or {})


def _refresh_if_needed(db, conn):
    """Square access tokens live 30 days. Renew when within 3 days of
    expiry; on failure keep the old token (it may still work today)."""
    try:
        exp = conn.get('expires_at')
        if not exp or not conn.get('refresh_token'):
            return conn
        when = datetime.fromisoformat(str(exp).replace('Z', ''))
        if when - datetime.utcnow() > timedelta(days=3):
            return conn
        cfg = app_config()
        import requests
        r = requests.post(square_base(cfg['env']) + '/oauth2/token', json={
            'client_id': cfg['application_id'], 'client_secret': cfg['application_secret'],
            'grant_type': 'refresh_token', 'refresh_token': conn['refresh_token'],
        }, timeout=6)
        if r.status_code == 200:
            data = r.json()
            conn = {**conn, 'access_token': data.get('access_token') or conn['access_token'],
                    'refresh_token': data.get('refresh_token') or conn['refresh_token'],
                    'expires_at': data.get('expires_at') or conn.get('expires_at')}
            _save_connection(db, conn)
            logger.info("square: access token refreshed")
        else:
            logger.warning(f"square: token refresh failed ({r.status_code})")
    except Exception as e:
        logger.warning(f"square: token refresh error: {e}")
    return conn


def client_for(db):
    """A SquareClient for the connected account, or None. Never raises."""
    try:
        if not configured():
            return None
        conn = connection(db)
        if not is_connected(conn):
            return None
        conn = _refresh_if_needed(db, conn)
        return SquareClient(env=conn.get('env') or app_config()['env'],
                            access_token=conn['access_token']), conn
    except Exception as e:
        logger.warning(f"square client unavailable: {e}")
        return None


def attach_payment_link(db, order_number, amount, name):
    """Ask Square for a link for this order and store it. Returns the URL
    or None. Called inside an order being placed, so it must be quick and
    must never fail the order: no Square, no link, counter payment."""
    try:
        got = client_for(db)
        if not got or not amount or float(amount) <= 0:
            return None
        client, conn = got
        redirect_url = f"{public_base_url()}/order?order={order_number}"
        url, link_id = client.create_payment_link(order_number, float(amount), conn.get('currency') or 'AUD',
                                                  conn['location_id'], name, redirect_url)
        if not url:
            return None
        cur = db.cursor()
        cur.execute("UPDATE orders SET payment_link = %s WHERE order_number = %s", (url, str(order_number)))
        db.commit()
        logger.info(f"square: payment link attached to #{order_number}")
        return url
    except Exception as e:
        logger.warning(f"square: attach link failed for #{order_number}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------

@bp.route('/status', methods=['GET'])
@jwt_required_with_demo()
def square_status():
    """What Runner > Settings shows: configured? connected? where?"""
    cfg = app_config()
    conn = connection()
    return jsonify({
        'success': True,
        'configured': configured(),
        'env': cfg['env'],
        'connected': is_connected(conn),
        'merchant_id': conn.get('merchant_id') or '',
        'location_id': conn.get('location_id') or '',
        'location_name': conn.get('location_name') or '',
        'currency': conn.get('currency') or 'AUD',
        'connected_at': conn.get('connected_at') or '',
        'webhook_url': f"{public_base_url()}/api/square/webhook",
        'webhook_key_set': bool(cfg['webhook_signature_key']),
    })


@bp.route('/connect-url', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def square_connect_url():
    """The Square authorize page for THIS operator, with a one-time state.
    The Runner opens it in a new tab; Square sends the operator back to
    /api/square/callback."""
    if not configured():
        return jsonify({'success': False, 'message': 'Square is not set up on this server (SQUARE_APPLICATION_ID / SECRET)'}), 400
    cfg = app_config()
    state = secrets.token_urlsafe(24)
    _, _kv_put = _kv()
    _kv_put(_db(), STATE_KEY, {'state': state, 'expires': (datetime.utcnow() + timedelta(minutes=15)).isoformat()})
    base = square_base(cfg['env'])
    from urllib.parse import urlencode
    url = base + '/oauth2/authorize?' + urlencode({
        'client_id': cfg['application_id'], 'scope': OAUTH_SCOPES, 'session': 'false',
        'state': state, 'redirect_uri': f"{public_base_url()}/api/square/callback"})
    return jsonify({'success': True, 'url': url})


@bp.route('/callback', methods=['GET'])
def square_callback():
    """Square sends the operator here with a code. Exchange it, pick the
    first location, store the connection, send them back to Settings."""
    back = f"{public_base_url()}/run#settings"
    code = (request.args.get('code') or '').strip()
    state = (request.args.get('state') or '').strip()
    err = (request.args.get('error') or '').strip()
    if err or not code:
        logger.warning(f"square oauth declined or failed: {err or 'no code'}")
        return redirect(back + '?square=declined')
    try:
        _kv_get, _kv_put = _kv()
        db = _db()
        saved = _kv_get(db, STATE_KEY, default=None) or {}
        if not state or state != saved.get('state') or datetime.utcnow() > datetime.fromisoformat(saved.get('expires', '1970-01-01')):
            logger.warning("square oauth: state mismatch or expired")
            return redirect(back + '?square=state')
        _kv_put(db, STATE_KEY, {})
        cfg = app_config()
        import requests
        r = requests.post(square_base(cfg['env']) + '/oauth2/token', json={
            'client_id': cfg['application_id'], 'client_secret': cfg['application_secret'],
            'code': code, 'grant_type': 'authorization_code',
            'redirect_uri': f"{public_base_url()}/api/square/callback",
        }, timeout=8)
        if r.status_code != 200:
            logger.warning(f"square oauth token exchange failed ({r.status_code}): {r.text[:200]}")
            return redirect(back + '?square=failed')
        data = r.json()
        conn = {
            'access_token': data.get('access_token'), 'refresh_token': data.get('refresh_token'),
            'expires_at': data.get('expires_at'), 'merchant_id': data.get('merchant_id'),
            'env': cfg['env'], 'connected_at': datetime.utcnow().isoformat() + 'Z',
            'location_id': '', 'location_name': '', 'currency': 'AUD',
        }
        locs = SquareClient(env=cfg['env'], access_token=conn['access_token']).locations()
        if locs:
            conn.update({'location_id': locs[0]['id'], 'location_name': locs[0]['name'],
                         'currency': locs[0].get('currency') or 'AUD'})
        _save_connection(db, conn)
        logger.warning(f"SQUARE CONNECTED: merchant {conn.get('merchant_id')} location {conn.get('location_name') or '(none)'} ({cfg['env']})")
        return redirect(back + '?square=connected')
    except Exception as e:
        logger.error(f"square oauth callback error: {e}")
        return redirect(back + '?square=failed')


@bp.route('/locations', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def square_locations():
    got = client_for(_db())
    if not got:
        return jsonify({'success': False, 'message': 'not connected'}), 400
    client, _ = got
    return jsonify({'success': True, 'locations': client.locations()})


@bp.route('/location', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def square_set_location():
    body = request.get_json(silent=True) or {}
    lid = str(body.get('location_id') or '').strip()
    got = client_for(_db())
    if not got:
        return jsonify({'success': False, 'message': 'not connected'}), 400
    client, conn = got
    match = next((l for l in client.locations() if l['id'] == lid), None)
    if not match:
        return jsonify({'success': False, 'message': 'unknown location'}), 400
    conn.update({'location_id': match['id'], 'location_name': match['name'], 'currency': match.get('currency') or 'AUD'})
    _save_connection(_db(), conn)
    return jsonify({'success': True, 'location_id': match['id'], 'location_name': match['name']})


@bp.route('/disconnect', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def square_disconnect():
    """Forget the connection. Best-effort revoke at Square, then clear."""
    db = _db()
    conn = connection(db)
    try:
        cfg = app_config()
        if configured() and conn.get('access_token'):
            import requests
            requests.post(square_base(cfg['env']) + '/oauth2/revoke',
                          json={'client_id': cfg['application_id'], 'access_token': conn['access_token']},
                          headers={'Authorization': f"Client {cfg['application_secret']}"}, timeout=6)
    except Exception as e:
        logger.debug(f"square revoke skipped: {e}")
    _save_connection(db, {})
    logger.warning("SQUARE DISCONNECTED")
    return jsonify({'success': True})


@bp.route('/webhook', methods=['POST'])
def square_webhook():
    """Square tells us a payment completed. Signature-verified against the
    notification URL and the raw body; anything that does not verify is
    dropped with a 401 and nothing is marked. Idempotent: Square retries."""
    cfg = app_config()
    body = request.get_data() or b''
    sig = request.headers.get('x-square-hmacsha256-signature') or request.headers.get('X-Square-Hmacsha256-Signature') or ''
    url = f"{public_base_url()}/api/square/webhook"
    if not cfg['webhook_signature_key']:
        logger.warning("square webhook received but SQUARE_WEBHOOK_SIGNATURE_KEY is not set; refusing")
        return jsonify({'success': False, 'message': 'webhook not configured'}), 401
    if not verify_webhook_signature(cfg['webhook_signature_key'], url, body, sig):
        logger.warning("square webhook signature FAILED; dropped")
        return jsonify({'success': False, 'message': 'bad signature'}), 401
    try:
        event = json.loads(body.decode('utf-8') or '{}')
    except Exception:
        return jsonify({'success': False, 'message': 'bad body'}), 400
    if not webhook_is_completed(event):
        return jsonify({'success': True, 'ignored': event.get('type')})
    order_number = order_number_from_webhook(event)
    if not order_number:
        logger.warning("square webhook: completed payment with no order reference")
        return jsonify({'success': True, 'ignored': 'no reference'})
    db = _db()
    pay = (((event.get('data') or {}).get('object') or {}).get('payment') or {})
    od = mark_paid(db, order_number, 'square', by='square', reference=pay.get('id'))
    if od is None:
        logger.warning(f"square webhook: order #{order_number} not found")
        return jsonify({'success': True, 'ignored': 'unknown order'})
    # Pay-to-order: the payment is what places the order.
    try:
        cur = db.cursor()
        cur.execute("UPDATE orders SET status = 'pending', updated_at = %s "
                    "WHERE order_number = %s AND status = 'awaiting_payment'", (datetime.now(), str(order_number)))
        placed = cur.rowcount
        db.commit()
        socketio = current_app.config.get('socketio')
        if socketio:
            socketio.emit('order_updated', {'id': str(order_number), 'orderId': str(order_number),
                                            'paymentStatus': 'paid', 'paidMethod': 'square'}, room='orders')
            if placed:
                socketio.emit('order_created', {'id': str(order_number), 'orderNumber': str(order_number)}, room='orders')
    except Exception as e:
        logger.debug(f"square webhook follow-up skipped: {e}")
    logger.info(f"square webhook: #{order_number} paid")
    return jsonify({'success': True, 'order_number': order_number})
