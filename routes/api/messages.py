"""Texts, chat, notifications and customer questions.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import STAFF_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import datetime
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity
from utils.notification_hold import HELD_FLAG, HOLD_SETTING_KEY, clear_held, is_holding, should_release, summarise as summarise_held
from routes.consolidated_api_routes import (  # noqa: F401
    _held_rows,
    _kv_get,
    _kv_put,
    _notify_customer_order_ready,
    bp,
    logger,
)


# ---------------------------------------------------------------------------
# Customer-question escape hatch ("BARISTA" SMS command)
# ---------------------------------------------------------------------------
# Customer texts BARISTA → coffee_system.py inserts a row in
# customer_questions → these endpoints let the Barista UI list pending
# rows and reply (which SMSes the response back to the customer).
# Background timeout sweeper lives in services/question_timeout.py.

@bp.route('/customer-questions', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def list_customer_questions():
    """List customer questions. Default = pending only (what the
    Barista UI's badge polls). Pass ?status=all for the full history."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        wanted = (request.args.get('status') or 'pending').strip().lower()
        cursor = db.cursor()
        if wanted == 'all':
            cursor.execute(
                "SELECT id, phone, customer_name, question, status, response, "
                "responded_by, created_at, responded_at "
                "FROM customer_questions ORDER BY created_at DESC LIMIT 100"
            )
        else:
            cursor.execute(
                "SELECT id, phone, customer_name, question, status, response, "
                "responded_by, created_at, responded_at "
                "FROM customer_questions WHERE status = %s "
                "ORDER BY created_at ASC LIMIT 50",
                (wanted,),
            )
        rows = cursor.fetchall() or []
        items = []
        for r in rows:
            if isinstance(r, dict):
                items.append({
                    **r,
                    'created_at': r['created_at'].isoformat() + 'Z' if hasattr(r.get('created_at'), 'isoformat') else r.get('created_at'),
                    'createdAt': r['created_at'].isoformat() + 'Z' if hasattr(r.get('created_at'), 'isoformat') else r.get('created_at'),
                    'customerName': r.get('customer_name'),
                })
            else:
                (rid, phone, name, question, status, response,
                 responded_by, created_at, responded_at) = r
                ca_iso = created_at.isoformat() + 'Z' if hasattr(created_at, 'isoformat') else (created_at or '')
                ra_iso = responded_at.isoformat() + 'Z' if hasattr(responded_at, 'isoformat') else (responded_at or '')
                items.append({
                    'id': rid,
                    'phone': phone,
                    'customer_name': name,
                    'customerName': name,
                    'question': question,
                    'status': status,
                    'response': response,
                    'responded_by': responded_by,
                    'respondedBy': responded_by,
                    'created_at': ca_iso,
                    'createdAt': ca_iso,
                    'responded_at': ra_iso,
                    'respondedAt': ra_iso,
                })
        return jsonify({
            'success': True,
            'data': items,
            'count': len(items),
        })
    except Exception as e:
        logger.error(f"list_customer_questions error: {e}")
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route('/customer-questions/<int:qid>/reply', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def reply_to_customer_question(qid):
    """Barista answers the customer's question. Marks the row
    'answered' AND sends the response as an SMS to the customer.

    Body: { "response": "yes, our beans are organic single-origin" }
    Optional: { "responded_by": "Station 1" }  (defaults to JWT user)
    """
    try:
        data = request.get_json(silent=True) or {}
        response_text = (data.get('response') or '').strip()
        if not response_text:
            return jsonify({
                "success": False,
                "message": "response text is required",
            }), 400

        responded_by = (
            data.get('responded_by')
            or data.get('respondedBy')
            or 'barista'
        )

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cursor = db.cursor()

        # Race-safe: only flip from 'pending' → 'answered'. If the row
        # already timed out OR another barista answered first, the
        # UPDATE matches 0 rows and we surface a clean message.
        cursor.execute(
            """
            UPDATE customer_questions
               SET status = 'answered',
                   response = %s,
                   responded_by = %s,
                   responded_at = %s
             WHERE id = %s
               AND status = 'pending'
            RETURNING phone, customer_name, question
            """,
            (response_text, responded_by, datetime.now(), qid),
        )
        row = cursor.fetchone()
        db.commit()

        if not row:
            return jsonify({
                "success": False,
                "message": (
                    "This question is no longer pending — it was already "
                    "answered, timed out, or doesn't exist."
                ),
                "code": "QUESTION_NOT_PENDING",
            }), 409

        if isinstance(row, dict):
            phone = row.get('phone')
        else:
            phone, _name, _question = row

        # Send SMS reply.
        messaging_service = current_app.config.get('messaging_service')
        if messaging_service and phone:
            try:
                # Plain text — no template wrapping. The barista's words
                # are the customer's answer.
                messaging_service.send_message(phone, response_text, kind='question_reply')
            except Exception as sms_err:
                logger.error(f"Failed to SMS reply for q{qid}: {sms_err}")

        # Push a WS event so OTHER baristas' UIs remove the row from
        # their pending list (it's now answered).
        try:
            socketio = current_app.config.get('socketio')
            if socketio:
                socketio.emit(
                    'customer_question_answered',
                    {'id': qid, 'status': 'answered', 'responded_by': responded_by},
                    room='orders',
                )
        except Exception as ws_err:
            logger.debug(f"customer_question_answered WS emit skipped: {ws_err}")

        return jsonify({
            "success": True,
            "message": "Reply sent to customer",
        })
    except Exception as e:
        logger.error(f"reply_to_customer_question error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({"success": False, "message": str(e)}), 500


@bp.route('/sms/simulate', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def simulate_sms():
    """ADMIN TEST HARNESS — run an inbound message through the EXACT same
    handle_sms() pipeline a real Twilio SMS uses, but without Twilio (no
    credits, no webhook signature). Returns the bot's reply so QA can verify
    routing / load-balancing / VIP / group / friend behaviour. Order creation
    happens normally; any outbound notification still respects TESTING_MODE
    (and creation itself sends none)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        data = request.get_json() or {}
        frm = (data.get('from') or data.get('phone') or '').strip()
        body = (data.get('body') or data.get('message') or '').strip()
        if not frm or not body:
            return jsonify({'success': False, 'message': "Provide 'from' and 'body'."}), 400
        # Opt-in fidelity: check_gate=true runs the SAME abuse gate the real
        # webhook applies (blocklist + burst throttle) and reports its verdict
        # instead of a bot reply when it trips. Off by default so rapid-fire
        # test conversations (a group order is 15+ messages in a minute)
        # don't trip the throttle mid-suite.
        gate = 'ok'
        if data.get('check_gate'):
            try:
                gate = coffee_system.register_inbound_sms(frm)
            except Exception as gate_err:
                logger.warning(f"simulate_sms gate errored (failing open): {gate_err}")
                gate = 'ok'
            if gate != 'ok':
                return jsonify({
                    'success': True, 'from': frm, 'body': body,
                    'reply': '', 'gate': gate,
                })
        reply = coffee_system.handle_sms(frm, body, messaging_service)
        return jsonify({
            'success': True,
            'from': frm,
            'body': body,
            'reply': reply,
            'gate': gate,
            'testing_mode': bool(getattr(messaging_service, 'testing_mode', False)) if messaging_service else None,
        })
    except Exception as e:
        logger.error(f"simulate_sms error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/health', methods=['GET'])
@jwt_required_with_demo()
def sms_health():
    """Answers "is SMS working?" without anyone having to text the system.

    Built after the National Wine Centre demo, where SMS was dead on
    arrival, recovered on its own, and nobody could say why. On the day,
    someone needs that answer in one glance — and needs it to distinguish
    the three failures that all look identical from the floor:

      * we are in test mode         -> messages swallowed, never sent
      * Twilio cannot reach us      -> webhook hits stay at zero
      * Twilio reaches us, refused  -> hits climb, rejects climb with them

    The third was invisible before this endpoint existed, because the
    signature check rejects a webhook BEFORE anything is written down.
    """
    try:
        from services import sms_health as health
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db if coffee_system else None
        messaging_service = current_app.config.get('messaging_service')
        snap = health.snapshot(db=db, messaging_service=messaging_service)
        # Fire the admin alert (email/SMS) the moment outbound goes dark. Done
        # HERE, not in the low-level sms_health module, because this handler has
        # the DB + settings context to read the configured recipient — and the
        # barista banner polls this endpoint every ~30s, so it trips within
        # ~30s of an outage. send_admin_alert self-throttles per code (cooldown),
        # so repeated polls don't spam. Never let it break the health read.
        if snap.get('outbound_down'):
            try:
                from services.admin_alerts import send_admin_alert
                send_admin_alert(
                    'SMS_OUTBOUND_DOWN', 'critical',
                    (snap.get('problems') or ['Outbound SMS is failing.'])[0],
                    db=db,
                )
            except Exception as _ae:
                logger.warning(f"outbound-down admin alert skipped: {_ae}")
        return jsonify({'success': True, 'health': snap})
    except Exception as e:
        logger.error(f"sms_health error: {e}")
        # A health check that 500s tells the reader nothing except that
        # something else is also broken. Say so plainly instead.
        return jsonify({
            'success': False,
            'health': {'status': 'unknown', 'problems': [f'Health check failed: {e}']},
        }), 200


# ============================================================================
# SMS ENDPOINTS
# ============================================================================

@bp.route('/sms/send', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def send_sms():
    """Send an SMS message directly.

    Locked down after the fresh-eyes audit caught it as a Twilio-bill
    abuse vector:
      - role_required: was admin/staff/barista; now admin/staff only.
        Baristas don't need direct SMS-send; they have the per-order
        Message button which goes through a separate validated path.
      - audit log: every call is logged with WHO sent WHAT to WHICH
        number. (Logger writes to api_access; ops can grep.)
      - rate limit: 10 sends per minute per user. A real operator
        broadcasting an outage stays under it; a runaway loop or
        compromised token hits the wall fast.

    Doesn't validate the recipient number against a list — operators
    legitimately text customers whose phone is in the orders table —
    but the audit log + rate limit make abuse traceable and bounded.
    """
    import time

    try:
        data = request.json or {}
        to_number = (data.get('to') or '').strip()
        message = (data.get('message') or '').strip()

        if not to_number or not message:
            return jsonify({
                'success': False,
                'message': "Both 'to' and 'message' are required",
            }), 400

        # Rate limit per user — in-memory window, sufficient for a
        # single-container Railway deploy. Reset hourly via process
        # restart. Move to Redis if we ever scale horizontally.
        try:
            from flask_jwt_extended import get_jwt_identity
            actor = get_jwt_identity() or 'unknown'
        except Exception:
            actor = 'unknown'

        global _SMS_SEND_WINDOW
        if '_SMS_SEND_WINDOW' not in globals():
            _SMS_SEND_WINDOW = {}
        now_ts = int(time.time())
        window_start = now_ts - 60
        # Prune old entries opportunistically.
        if len(_SMS_SEND_WINDOW) > 1000:
            _SMS_SEND_WINDOW = {
                k: [t for t in v if t >= window_start]
                for k, v in _SMS_SEND_WINDOW.items()
            }
        actor_sends = [t for t in _SMS_SEND_WINDOW.get(actor, []) if t >= window_start]
        if len(actor_sends) >= 10:
            logger.warning(
                f"sms/send rate-limit hit: actor={actor!r}, "
                f"{len(actor_sends)} sends in last 60s"
            )
            return jsonify({
                'success': False,
                'message': "Rate limit: max 10 SMS per minute per user.",
                'code': 'RATE_LIMITED',
            }), 429
        actor_sends.append(now_ts)
        _SMS_SEND_WINDOW[actor] = actor_sends

        # Audit log — always, before the send. Even a failure to send
        # tells ops there was an attempt.
        logger.info(
            f"AUDIT sms/send: actor={actor!r} to={to_number!r} "
            f"msg_len={len(message)} msg_preview={message[:40]!r}"
        )

        # Forward to the actual implementation
        from routes.sms_routes import send_sms as sms_handler
        return sms_handler()

    except Exception as e:
        logger.error(f"Error sending SMS: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error sending SMS: {str(e)}"
        }), 500


@bp.route('/sms/dropped', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_dropped():
    """Inbound messages we accepted but never finished processing.

    A row stays processed=false when handling threw part-way — a redeploy
    mid-request, a database blip, an unhandled edge case. That is a real
    customer whose order did not land, and until now nothing surfaced it:
    the row simply sat there. Found the hard way when a confirmed order was
    lost at 04:33 during a deploy and the only trace was processed=false.

    Deliberately excludes the last `grace` seconds (default 60) so a message
    being processed right now is not reported as dropped.

    Params: grace=<seconds>, hours=<lookback, default 6>, limit (<=200).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        grace = max(0, min(int(request.args.get('grace', 60)), 3600))
        hours = max(1, min(int(request.args.get('hours', 6)), 168))
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
        cur = coffee_system.db.cursor()
        cur.execute(
            """
            SELECT id, phone_number, message_body, received_at
            FROM sms_messages
            WHERE processed = FALSE
              AND received_at < NOW() - (%s * INTERVAL '1 second')
              AND received_at > NOW() - (%s * INTERVAL '1 hour')
            ORDER BY received_at DESC
            LIMIT %s
            """,
            (grace, hours, limit))
        rows = cur.fetchall()
        dropped = []
        for r in rows:
            rid, phone, body, at = (
                (r['id'], r['phone_number'], r['message_body'], r['received_at'])
                if isinstance(r, dict) else (r[0], r[1], r[2], r[3]))
            dropped.append({
                'id': rid,
                'phone': phone,
                'message': body,
                'received_at': at.isoformat() if hasattr(at, 'isoformat') else str(at),
            })
        return jsonify({
            'success': True,
            'count': len(dropped),
            'dropped': dropped,
            'window_hours': hours,
        })
    except Exception as e:
        logger.error(f"sms_dropped error: {e}")
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/log', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_log():
    """Inbound SMS log with the bot's replies — the raw material for
    reviewing a live group test (sms_messages had no reader endpoint).

    Params: since=<ISO timestamp> (default: last 2 hours), limit (<=500).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        since = request.args.get('since')
        try:
            limit = min(500, int(request.args.get('limit') or 300))
        except (TypeError, ValueError):
            limit = 300
        cur = db.cursor()
        if since:
            cur.execute("""
                SELECT id, phone_number, message_body, sender_name, station_id,
                       received_at, processed, response_sent
                  FROM sms_messages
                 WHERE received_at >= %s
                 ORDER BY received_at ASC
                 LIMIT %s
            """, (since, limit))
        else:
            cur.execute("""
                SELECT id, phone_number, message_body, sender_name, station_id,
                       received_at, processed, response_sent
                  FROM sms_messages
                 WHERE received_at >= NOW() - INTERVAL '2 hours'
                 ORDER BY received_at ASC
                 LIMIT %s
            """, (limit,))
        cols = ['id', 'phone_number', 'message_body', 'sender_name', 'station_id',
                'received_at', 'processed', 'response_sent']
        rows = []
        for r in cur.fetchall():
            d = dict(zip(cols, r)) if not isinstance(r, dict) else dict(r)
            if hasattr(d.get('received_at'), 'isoformat'):
                d['received_at'] = d['received_at'].isoformat()
            rows.append(d)
        return jsonify({'success': True, 'count': len(rows), 'messages': rows})
    except Exception as e:
        logger.error(f"sms_log error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/sms/blocklist', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_blocklist_get():
    """List numbers currently blocked from SMS ordering (no reply = no cost)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        return jsonify({'success': True, 'status': 'success',
                        'data': {'blocked': coffee_system.get_sms_blocklist()}})
    except Exception as e:
        logger.error(f"sms_blocklist_get failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/block', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_block_number():
    """Block a phone number from SMS ordering. The bot stops replying to it
    entirely (zero outbound cost) until it's unblocked."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        body = request.json or {}
        phone = (body.get('phone') or body.get('number') or '').strip()
        if not phone:
            return jsonify({'success': False, 'message': "A 'phone' is required."}), 400
        try:
            actor = get_jwt_identity() or ''
        except Exception:
            actor = ''
        blocked = coffee_system.block_sms_number(phone, reason=(body.get('reason') or ''), by=actor)
        return jsonify({'success': True, 'status': 'success',
                        'message': f"Blocked {blocked}.", 'data': {'phone': blocked}})
    except Exception as e:
        logger.error(f"sms_block_number failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/unblock', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def sms_unblock_number():
    """Remove a phone number from the SMS blocklist (it can order again)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({'success': False, 'message': 'System unavailable'}), 503
        body = request.json or {}
        phone = (body.get('phone') or body.get('number') or '').strip()
        if not phone:
            return jsonify({'success': False, 'message': "A 'phone' is required."}), 400
        ok = coffee_system.unblock_sms_number(phone)
        return jsonify({'success': True, 'status': 'success',
                        'message': "Unblocked." if ok else "That number wasn't blocked.",
                        'data': {'unblocked': ok}})
    except Exception as e:
        logger.error(f"sms_unblock_number failed: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


# ============================================================================
# CHAT ENDPOINTS
# ============================================================================

@bp.route('/chat/messages', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_messages():
    """Get chat messages"""
    try:
        # Get query parameters
        limit = request.args.get('limit', 50, type=int)
        station_id = request.args.get('station_id')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if chat_messages table exists
        cursor = db.cursor()
        cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
        table_exists = cursor.fetchone()[0]
        
        if table_exists:
            # Build query based on parameters
            query = '''
                SELECT id, sender, content, is_urgent, station_id, created_at
                FROM chat_messages
            '''
            params = []
            
            # Add station filter if provided
            if station_id:
                query += " WHERE station_id = %s"
                params.append(station_id)
            
            # Add ordering and limit
            query += " ORDER BY created_at DESC LIMIT %s"
            params.append(limit)
            
            # Execute query
            cursor.execute(query, params)
            
            messages = []
            for msg in cursor.fetchall():
                msg_id, sender, content, is_urgent, station_id, created_at = msg
                messages.append({
                    'id': msg_id,
                    'sender': sender,
                    'content': content,
                    'station_id': station_id,
                    'created_at': created_at,
                    'is_urgent': bool(is_urgent)
                })
            
            return jsonify({
                'success': True,
                'messages': messages
            })
        else:
            # If table doesn't exist, return empty list
            logger.warning("chat_messages table not found")
            return jsonify({
                'success': True,
                'messages': []
            })
    
    except Exception as e:
        logger.error(f"Error fetching chat messages: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching chat messages: {str(e)}"
        }), 500


@bp.route('/chat/messages', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def create_chat_message():
    """Create a new chat message"""
    try:
        data = request.json
        sender = data.get('sender', '')
        content = data.get('content', '')
        is_urgent = data.get('is_urgent', False)
        station_id = data.get('station_id')
        
        if not sender or not content:
            return jsonify({
                'success': False,
                'message': 'Sender and content are required'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create chat_messages table if it doesn't exist
        cursor = db.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                is_urgent BOOLEAN DEFAULT FALSE,
                station_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Insert message
        cursor.execute('''
            INSERT INTO chat_messages (sender, content, is_urgent, station_id)
            VALUES (%s, %s, %s, %s)
            RETURNING id, created_at
        ''', (sender, content, is_urgent, station_id))
        
        result = cursor.fetchone()
        db.commit()
        
        # Return created message
        return jsonify({
            'success': True,
            'message': {
                'id': result[0],
                'sender': sender,
                'content': content,
                'is_urgent': is_urgent,
                'station_id': station_id,
                'created_at': result[1]
            }
        })
    
    except Exception as e:
        logger.error(f"Error creating chat message: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating chat message: {str(e)}"
        }), 500


@bp.route('/chat/messages/<message_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_message(message_id):
    """Get a specific chat message by ID"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for the specific message
        cursor = db.cursor()
        cursor.execute('''
            SELECT id, sender, content, is_urgent, station_id, created_at
            FROM chat_messages
            WHERE id = %s
        ''', (message_id,))
        
        msg = cursor.fetchone()
        
        if not msg:
            return jsonify({
                'success': False,
                'message': f'Message with ID {message_id} not found'
            }), 404
        
        # Format message
        msg_id, sender, content, is_urgent, station_id, created_at = msg
        message = {
            'id': msg_id,
            'sender': sender,
            'content': content,
            'station_id': station_id,
            'created_at': created_at,
            'is_urgent': bool(is_urgent)
        }
        
        return jsonify({
            'success': True,
            'message': message
        })
    
    except Exception as e:
        logger.error(f"Error fetching chat message {message_id}: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error fetching chat message: {str(e)}"
        }), 500


@bp.route('/chat/stations', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_chat_stations():
    """Get active stations for chat"""
    try:
        # Forward to the stations endpoint but filter for active stations only
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Query database for active stations
        cursor = db.cursor()
        try:
            cursor.execute('''
                SELECT station_id, name, location, status, barista_name
                FROM station_stats
                WHERE status = 'active'
                ORDER BY station_id
            ''')
        except Exception as e:
            logger.warning(f"Error with primary station query: {str(e)}")
            # Fallback to simpler query
            cursor.execute('''
                SELECT id, name, location, status, NULL as barista_name
                FROM stations
                WHERE status = 'active'
                ORDER BY id
            ''')
        
        # Process stations
        stations = []
        for station in cursor.fetchall():
            station_id, name, location, status, barista_name = station
            
            # Format station for frontend
            stations.append({
                'id': station_id,
                'name': name or f"Station #{station_id}",
                'location': location or "Main Venue",
                'status': status or "active",
                'barista': barista_name or "Unassigned"
            })
        
        return jsonify({
            'success': True,
            'stations': stations
        })
    
    except Exception as e:
        logger.error(f"Error fetching chat stations: {str(e)}")
        # Fallback to hardcoded stations for development
        return jsonify({
            'success': True,
            'stations': [
                {
                    'id': 1,
                    'name': 'Station #1',
                    'location': 'Main Hall',
                    'status': 'active',
                    'barista': 'Barista 1'
                },
                {
                    'id': 2,
                    'name': 'Station #2',
                    'location': 'Exhibition Hall',
                    'status': 'active',
                    'barista': 'Barista 2'
                },
                {
                    'id': 3,
                    'name': 'Station #3',
                    'location': 'Registration Area',
                    'status': 'active',
                    'barista': 'Barista 3'
                }
            ]
        })


@bp.route('/notifications/hold', methods=['GET', 'PUT'])
@jwt_required_with_demo()
@writes_need(STAFF_ROLES)
def notification_hold():
    """The switch, and what is waiting behind it.

    GET  -> {holding, held, will_send, no_phone, already_collected}
    PUT  -> {"holding": true|false}

    The counts matter as much as the switch. A barista about to press
    release should be able to see it is 87 texts, not 3, before they do
    it -- that is the difference between a considered action and a
    surprise on the phone bill.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        if request.method == 'PUT':
            body = request.get_json(silent=True) or {}
            wanted = bool(body.get('holding'))
            _kv_put(db, HOLD_SETTING_KEY, wanted)
            logger.info(f"Notification hold {'ON' if wanted else 'OFF'}")

        holding = is_holding(_kv_get(db, HOLD_SETTING_KEY, default=None))
        rows = _held_rows(db)
        counts = summarise_held(rows)
        return jsonify({'success': True, 'holding': holding, **counts})
    except Exception as e:
        logger.error(f"notification_hold error: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/notifications/hold/discard', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def discard_held_notifications():
    """Clear every held "ready" flag WITHOUT sending, and turn the hold off.

    The hold exists for a session that has not started yet. Releasing it
    days later is never right: on 7 Sep 2026 the hold was found ON after
    the event, with 23 Treenet customers queued to be told "your coffee is
    ready" three days late. Release would have sent them; turning the hold
    off alone leaves the flags in place for a future Release to find. This
    empties the queue for good. Nothing else changes -- no phone number,
    order or status is touched.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        # jsonb: drop the key from every row that carries it.
        cur.execute(
            "UPDATE orders SET order_details = order_details - %s "
            "WHERE jsonb_exists(order_details, %s)",
            (HELD_FLAG, HELD_FLAG))
        cleared = cur.rowcount
        # Commit the row update BEFORE touching the KV switch: _kv_put
        # opens with a defensive rollback, which silently undid the
        # UPDATE on the first live run (reported cleared=148, queue
        # unchanged).
        db.commit()
        _kv_put(db, HOLD_SETTING_KEY, False)
        db.commit()
        logger.info(f"Discarded {cleared} held notifications (no texts sent); hold OFF")
        counts = summarise_held(_held_rows(db))
        return jsonify({'success': True, 'cleared': cleared, 'holding': False, **counts})
    except Exception as e:
        logger.error(f"discard_held_notifications error: {e}")
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/notifications/release', methods=['POST'])
@jwt_required_with_demo()
@writes_need(STAFF_ROLES)
def release_notifications():
    """Send every held notification, then turn the hold off.

    Turning the hold off is part of releasing on purpose. Releasing but
    staying held is a state nobody wants and everybody forgets they are
    in -- the next order finishes, its text is silently held, and the
    customer waits for a message that is not coming. If someone wants to
    keep holding, they simply do not press this.

    Orders that no longer need a text -- collected already, or no phone
    number -- have the flag cleared without a send, so the queue does not
    accumulate debts that can never be paid.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        rows = _held_rows(db)

        # Work out what to send BEFORE touching the database, then clear
        # every flag in one committed pass, and only then dispatch.
        #
        # The order matters. Clearing flags one at a time while starting
        # send threads meant those threads -- which share this one
        # database connection, the singleton from services/coffee_system
        # -- committed in the middle of the loop and a flag update was
        # lost. Testing caught it: three held, "2 sent, 1 skipped", and
        # one order still flagged afterwards.
        #
        # Clearing before sending also means a Twilio failure cannot
        # leave a debt that gets re-sent on every future release. A lost
        # message is recoverable (the barista can resend from the order);
        # a customer texted the same thing five times is not.
        to_send, skipped = [], 0
        for details, status, phone in rows:
            number = details.get('_order_number')
            station = details.get('_station_id')
            clean = {k: v for k, v in details.items() if not k.startswith('_')}
            clear_held(clean)
            if should_release(details, status, phone):
                to_send.append((number, phone, clean, station))
            else:
                skipped += 1
            try:
                cur = db.cursor()
                cur.execute(
                    "UPDATE orders SET order_details = %s WHERE order_number = %s",
                    (json.dumps(clean), number))
            except Exception as upd_err:
                logger.error(f"release: order {number} flag not cleared: {upd_err}")
        db.commit()

        # Turn the hold OFF before dispatching, not after. The send path
        # now checks the hold as its first act, so releasing while still
        # held would quietly re-hold every message and the release would
        # silently do nothing at all.
        _kv_put(db, HOLD_SETTING_KEY, False)

        sent = 0
        for number, phone, clean, station in to_send:
            try:
                # Through the SAME guarded path a normal completion uses,
                # so the bench wall still applies. Dispatching straight to
                # Twilio here would have sent real messages to the Test
                # Bench's +6140000 simulator numbers.
                _notify_customer_order_ready(phone, number, clean, station)
                sent += 1
            except Exception as send_err:
                logger.error(f"release: order {number} failed to send: {send_err}")

        logger.info(f"Released notifications: {sent} sent, {skipped} skipped")
        return jsonify({'success': True, 'sent': sent, 'skipped': skipped,
                        'holding': False})
    except Exception as e:
        logger.error(f"release_notifications error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': str(e)}), 500


@bp.route('/sms/templates', methods=['GET'])
@jwt_required_with_demo()
def get_sms_templates_api():
    """Mirror of routes/sms_routes.py /sms/templates under the /api prefix.

    The frontend calls /api/sms/templates; the existing sms_routes.py
    handler lives at /sms/templates (no /api). Frontend was 404ing
    on every Communications-tab visit.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("SELECT key, value FROM settings WHERE key LIKE %s", ('%_message',))
        rows = cur.fetchall() or []
        templates = {}
        for row in rows:
            if isinstance(row, dict):
                templates[row['key']] = row['value']
            else:
                templates[row[0]] = row[1]
        return jsonify({'status': 'success', 'templates': templates})
    except Exception as e:
        logger.error(f"get_sms_templates_api error: {e}")
        return jsonify({'status': 'success', 'templates': {}})
