"""
Routes for handling SMS messages from Twilio with PostgreSQL support
"""
from flask import Blueprint, request, jsonify, current_app, Response
from twilio.twiml.messaging_response import MessagingResponse
from flask_jwt_extended import jwt_required, get_jwt_identity

from auth import jwt_required_with_demo, role_required_with_demo
from psycopg2.extras import RealDictCursor
import logging
import json
import os
import time
from twilio.request_validator import RequestValidator

# Create blueprint
bp = Blueprint("sms_routes", __name__)

# Set up logging
logger = logging.getLogger("expresso.routes.sms")

# --- MessageSid idempotency cache -------------------------------------
# Twilio retries a webhook that doesn't answer within ~15s. Without
# dedupe, the retry was processed as a brand-new customer message and
# double-advanced the conversation state machine (a retried "large
# latte" got interpreted as a milk answer). Found by
# tests/sms_scenarios: duplicate_message_sid.
#
# In-process cache is sufficient for the current single-instance
# Railway deploy; if `web` ever scales horizontally, move this to
# Redis/Postgres so replicas share it.
_SID_CACHE = {}
_SID_TTL_SECONDS = 600
_SID_MAX_ENTRIES = 5000


def _sid_cache_get(sid):
    item = _SID_CACHE.get(sid)
    if not item:
        return None
    ts, reply = item
    if time.time() - ts > _SID_TTL_SECONDS:
        _SID_CACHE.pop(sid, None)
        return None
    return reply


def _sid_cache_put(sid, reply):
    if len(_SID_CACHE) >= _SID_MAX_ENTRIES:
        # Evict the oldest ~10% in one sweep to amortise the sort.
        for k in sorted(_SID_CACHE, key=lambda k: _SID_CACHE[k][0])[:_SID_MAX_ENTRIES // 10]:
            _SID_CACHE.pop(k, None)
    _SID_CACHE[sid] = (time.time(), reply)

# --- Carrier-duplicate dedupe (content-based) --------------------------
# The MessageSid cache above only catches TWILIO retries (same sid). A
# CARRIER can also deliver the same customer text multiple times as
# separate messages with DIFFERENT sids — observed live 2026-07-16: one
# "Steve" processed three times, advancing the conversation state machine
# each time ("Hi Steve!" then two "I'm not sure what type of coffee").
# Fix: if the SAME phone sends the EXACT same text within the window,
# replay the previous reply instead of re-processing. Backed by a tiny DB
# table so it survives restarts and any future multi-worker setup.
# WINDOW: carrier duplicates arrive within seconds; a LEGITIMATE repeat of a
# short answer ("YES" to two different questions, e.g. in the FRIEND flow)
# needs a bot reply + human read + reply, which rarely happens inside 15s —
# so 15s catches dupes without swallowing real answers.
_DEDUP_WINDOW_SECONDS = 15
_dedup_table_ready = False


def _ensure_dedup_table(db):
    global _dedup_table_ready
    if _dedup_table_ready:
        return
    try:
        cur = db.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sms_inbound_dedup (
                phone TEXT PRIMARY KEY,
                body TEXT,
                reply TEXT,
                created_at TIMESTAMP
            )
        """)
        db.commit()
        _dedup_table_ready = True
    except Exception as e:
        logger.warning(f"sms dedup table create failed (non-fatal): {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _duplicate_inbound_reply(db, phone, body):
    """Return the previous reply if this exact text from this phone was just
    processed (carrier duplicate); else None."""
    try:
        _ensure_dedup_table(db)
        cur = db.cursor()
        cur.execute("SELECT body, reply, created_at FROM sms_inbound_dedup WHERE phone = %s",
                    (phone,))
        row = cur.fetchone()
        if not row:
            return None
        prev_body, prev_reply, ts = row[0], row[1], row[2]
        if prev_body == body and prev_reply and ts is not None:
            from datetime import datetime as _dt
            age = (_dt.now() - ts).total_seconds()
            if 0 <= age < _DEDUP_WINDOW_SECONDS:
                return prev_reply
        return None
    except Exception as e:
        logger.warning(f"sms dedup lookup failed (fail-open): {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None


def _remember_inbound_reply(db, phone, body, reply):
    try:
        _ensure_dedup_table(db)
        cur = db.cursor()
        cur.execute("""
            INSERT INTO sms_inbound_dedup (phone, body, reply, created_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (phone) DO UPDATE
            SET body = EXCLUDED.body, reply = EXCLUDED.reply,
                created_at = EXCLUDED.created_at
        """, (phone, body, (reply or '')[:1600]))
        db.commit()
    except Exception as e:
        logger.warning(f"sms dedup store failed (non-fatal): {e}")
        try:
            db.rollback()
        except Exception:
            pass


@bp.route('/sms/debug', methods=['GET', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def sms_debug():
    """Debug endpoint to test SMS webhook delivery"""
    logger.info("🔍 SMS DEBUG endpoint called!")
    logger.info(f"Method: {request.method}")
    logger.info(f"Headers: {dict(request.headers)}")
    logger.info(f"Form data: {dict(request.form) if request.form else 'None'}")
    logger.info(f"JSON data: {request.get_json() if request.is_json else 'None'}")
    return {"status": "SMS debug endpoint working", "method": request.method}, 200

@bp.route('/sms', methods=['POST'])
def sms_webhook():
    """Twilio inbound webhook, wrapped with MessageSid idempotency.

    A replayed MessageSid (Twilio retry) gets the SAME reply as the
    original delivery and is NOT re-processed — see _SID_CACHE above.
    Only successful (str TwiML) replies are cached, so auth failures
    and error tuples are never replayed.
    """
    sid = request.values.get('MessageSid', '')
    if sid:
        cached = _sid_cache_get(sid)
        if cached is not None:
            logger.info(f"Duplicate MessageSid {sid} — replaying cached reply (Twilio retry)")
            return Response(cached, mimetype='text/xml')
    result = _sms_webhook_inner()
    if sid:
        # The inner handler returns either a TwiML string or a Flask
        # Response (the main success path uses Response(..., text/xml)).
        # Cache the BODY only — never error tuples / non-200s.
        body = None
        if isinstance(result, str):
            body = result
        elif isinstance(result, Response) and result.status_code == 200:
            body = result.get_data(as_text=True)
        if body is not None:
            _sid_cache_put(sid, body)
    return result


def _sms_webhook_inner():
    """
    Handle incoming SMS messages from Twilio
    This is the main webhook that Twilio will POST to when a new SMS is received
    """
    # FIRST: Log that we received ANY request to this endpoint
    logger.info("🚨 SMS WEBHOOK CALLED! 🚨")
    logger.info(f"Request method: {request.method}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request headers: {dict(request.headers)}")
    logger.info(f"Request form data: {dict(request.form)}")
    logger.info(f"Remote address: {request.remote_addr}")
    
    # Log proxy headers specifically
    logger.info(f"X-Forwarded-Proto: {request.headers.get('X-Forwarded-Proto', 'NOT SET')}")
    logger.info(f"X-Forwarded-Host: {request.headers.get('X-Forwarded-Host', 'NOT SET')}")
    logger.info(f"X-Forwarded-For: {request.headers.get('X-Forwarded-For', 'NOT SET')}")
    
    try:
        # SECURITY: Validate Twilio webhook signature.
        #
        # Previously this branch skipped validation if TWILIO_AUTH_TOKEN
        # was the literal string 'test_token' or missing entirely. That
        # meant any deploy that left the placeholder in .env would
        # silently accept unsigned (forged) webhooks. Now: validation
        # is mandatory unless TESTING_MODE is explicitly enabled, and
        # we fail closed (401) if the auth token is missing in
        # production rather than letting unsigned requests through.
        auth_token = os.getenv('TWILIO_AUTH_TOKEN')
        testing_mode = os.getenv('TESTING_MODE', 'False').lower() == 'true'
        skip_validation = testing_mode and (not auth_token or auth_token == 'test_token')

        if not skip_validation and not auth_token:
            logger.error(
                "Refusing SMS webhook: TWILIO_AUTH_TOKEN is not configured "
                "and TESTING_MODE is off. Set TWILIO_AUTH_TOKEN or enable "
                "TESTING_MODE to accept unsigned requests in dev."
            )
            return "Unauthorized", 401

        if not skip_validation:
            validator = RequestValidator(auth_token)

            # Get the signature from headers
            signature = request.headers.get('X-Twilio-Signature', '')
            
            # Get the full URL - handle Railway HTTPS proxy correctly
            # Check for forwarded headers first
            forwarded_proto = request.headers.get('X-Forwarded-Proto', '')
            forwarded_host = request.headers.get('X-Forwarded-Host', request.host)
            
            if forwarded_proto == 'https':
                # Use the forwarded protocol
                url = f"https://{forwarded_host}{request.path}"
                if request.query_string:
                    url += f"?{request.query_string.decode()}"
                logger.info(f"Using forwarded URL for validation: {url}")
            else:
                # Fallback to request URL
                url = request.url
                # Railway serves HTTPS externally but shows HTTP internally
                if 'railway.app' in url and url.startswith('http://'):
                    url = url.replace('http://', 'https://', 1)
                    logger.info(f"Corrected Railway URL for signature validation: {url}")
            
            # Get POST parameters
            params = request.form.to_dict()
            
            logger.info(f"Validating signature with URL: {url}")
            logger.info(f"Signature received: {signature[:20]}...")
            
            # Validate the request
            if not validator.validate(url, params, signature):
                logger.warning(f"Invalid Twilio webhook signature from {request.remote_addr}")
                logger.warning(f"URL used for validation: {url}")
                logger.warning(f"Parameters: {params}")
                try:
                    from services.logging_utils import event as _event
                    _event(
                        'SMS_WEBHOOK_SIG_FAIL',
                        remote_addr=request.remote_addr,
                        url=url,
                    )
                except Exception:
                    pass
                return "Unauthorized", 403
            else:
                logger.info("✅ Twilio webhook signature validation successful")
        else:
            logger.warning(
                "Twilio signature validation skipped (TESTING_MODE is on "
                "and auth token is unset or 'test_token'). This must NOT "
                "happen in production."
            )
        # Log all request information for debugging
        logger.info(f"SMS webhook called with request method: {request.method}")
        logger.info(f"Request form data: {request.form}")
        logger.info(f"Request values: {request.values}")
        
        # Get POST data
        from_number = request.values.get('From', '')
        body = request.values.get('Body', '')
        
        # Validate required fields
        if not from_number or not body:
            logger.error("Missing required fields in SMS webhook")
            resp = MessagingResponse()
            resp.message("Sorry, we couldn't process your message. Please try again.")
            return str(resp)
        
        # Capture metadata - look for sender name in ProfileName field if available
        sender_name = request.values.get('ProfileName', '')
        
        # Check for station mentions in the message - improved pattern matching
        import re
        station_id = None
        station_pattern = r'(?:(?:for|to|at)\s+)?(?:station|st|station\s*id|station\s*\#)[^0-9]*([0-9]+)'
        station_match = re.search(station_pattern, body.lower())
        if station_match:
            try:
                station_id = int(station_match.group(1))
                logger.info(f"Detected station {station_id} in SMS: '{body}'")
            except (ValueError, TypeError):
                logger.warning(f"Invalid station number format detected in message: '{body}'")
        else:
            # Additional check for common station patterns
            if "station 1" in body.lower() or "station one" in body.lower() or "station#1" in body.lower():
                station_id = 1
                logger.info(f"Detected station 1 from text pattern in SMS: '{body}'")
            elif "station 2" in body.lower() or "station two" in body.lower() or "station#2" in body.lower():
                station_id = 2
                logger.info(f"Detected station 2 from text pattern in SMS: '{body}'")
            elif "station 3" in body.lower() or "station three" in body.lower() or "station#3" in body.lower():
                station_id = 3
                logger.info(f"Detected station 3 from text pattern in SMS: '{body}'")
            else:
                logger.info(f"No station detected in SMS: '{body}'")
        
        logger.info(f"Received SMS from {from_number}: {body}")
        if sender_name:
            logger.info(f"Sender profile name: {sender_name}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            resp = MessagingResponse()
            resp.message("Sorry, our ordering system is currently unavailable. Please try again later.")
            return str(resp)

        # SMS abuse / cost protection — BEFORE any reply work. Every inbound SMS
        # triggers a paid outbound reply, so a flood (or a script) would burn
        # Twilio credit. register_inbound_sms() returns:
        #   blocked → manual blocklist; ignore silently (no reply, no cost)
        #   paused  → cooling down after a burst trip; ignore silently
        #   tripped → JUST crossed the burst threshold; alert a barista + ignore
        #   ok      → normal customer; proceed
        # An empty TwiML <Response/> means "no reply" — no outbound SMS is sent.
        try:
            sms_gate = coffee_system.register_inbound_sms(from_number)
        except Exception as gate_err:
            logger.warning(f"SMS abuse gate errored (failing open): {gate_err}")
            sms_gate = 'ok'
        if sms_gate != 'ok':
            if sms_gate == 'tripped':
                logger.warning(f"SMS burst from {from_number} — auto-paused + alerting baristas")
                try:
                    coffee_system.sms_spam_alert(from_number)
                except Exception as alert_err:
                    logger.error(f"sms_spam_alert failed (non-fatal): {alert_err}")
            else:
                logger.info(f"Ignoring inbound SMS from {from_number} (gate={sms_gate})")
            return str(MessagingResponse())  # empty = no reply, no cost

        # Check for Twilio reserved keywords
        body_upper = body.strip().upper()
        if body_upper == 'STOP':
            # This is handled by Twilio automatically, but we should log it
            logger.info(f"Received STOP command from {from_number}, will be handled by Twilio")
            # We'll just return None and let Twilio handle it
            resp = MessagingResponse()
            # We don't add a message because Twilio will add its own
            return str(resp)
            
        if body_upper == 'START':
            # This is handled by Twilio automatically, but we'll also handle it
            logger.info(f"Received START command from {from_number}")
            
            # Instead of responding directly, we'll reset the conversation state
            try:
                # Get the coffee system to reset the conversation state to a clean state
                coffee_system._set_conversation_state(from_number, 'awaiting_name')
                logger.info(f"Reset conversation state for {from_number} after START command")
            except Exception as reset_err:
                logger.error(f"Failed to reset conversation state: {str(reset_err)}")
            
            resp = MessagingResponse()
            resp.message("You have successfully been re-subscribed to coffee order messages. What's your first name?")
            return str(resp)
            
        if body_upper == 'HELP' or body_upper == 'INFO':
            # HELP is handled by Twilio, but we'll handle INFO ourselves
            if body_upper == 'HELP':
                logger.info(f"Received HELP command from {from_number}, letting Twilio handle it")
                resp = MessagingResponse()
                # We don't add a message because Twilio will add its own
                return str(resp)
            else:
                # For INFO, we'll provide our own custom response
                logger.info(f"Received INFO command from {from_number}")
                # We'll pass this to our system to handle
            
        # Check if this is our own CANCEL keyword, which should be handled differently from Twilio's STOP
        if body_upper == 'CANCEL':
            logger.info(f"Received CANCEL command from {from_number}, will be handled by our system")
            # We need to make sure this goes through our system, not Twilio's opt-out
            body = 'CANCELORDER'  # Change the command to avoid collision with Twilio
            
        # Process message and get response, including sender_name if available
        metadata = {'sender_name': sender_name} if sender_name else {}
        
        # Add the message to the database for debugging and tracking
        message_id = None
        try:
            db = coffee_system.db
            cursor = db.cursor()
            
            # Create sms_messages table if it doesn't exist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sms_messages (
                    id SERIAL PRIMARY KEY,
                    phone_number VARCHAR(20) NOT NULL,
                    message_body TEXT NOT NULL,
                    sender_name VARCHAR(100),
                    station_id INTEGER,
                    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed BOOLEAN DEFAULT FALSE,
                    response_sent TEXT
                )
            """)
            
            # Insert the message with station ID if detected
            cursor.execute("""
                INSERT INTO sms_messages (phone_number, message_body, sender_name, station_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id
            """, (from_number, body, sender_name, station_id))
            
            message_id = cursor.fetchone()[0]
            db.commit()
            
            logger.info(f"Saved SMS message to database with ID: {message_id}, station: {station_id}")
        except Exception as db_err:
            logger.error(f"Failed to save SMS to database: {str(db_err)}")
            # Continue processing even if database save fails
        
        # Add station ID to metadata if detected
        if metadata is None:
            metadata = {}
        
        if station_id:
            metadata['station_id'] = station_id
            logger.info(f"Added station_id={station_id} to SMS metadata")
        
        # Log the message metadata for debugging
        logger.info(f"Processing SMS with metadata: {metadata}")
        
        # Carrier-duplicate guard: the exact same text from the same phone
        # within the window gets the SAME reply, without re-running the
        # conversation state machine (which double-advances it).
        _dup_reply = _duplicate_inbound_reply(db, from_number, body)
        if _dup_reply is not None:
            logger.info(f"Carrier-duplicate inbound from {from_number} — replaying previous reply")
            resp = MessagingResponse()
            resp.message(_dup_reply)
            return Response(str(resp), mimetype='text/xml')

        # Process the message and get a response
        response_message = coffee_system.handle_sms(from_number, body, messaging_service, metadata)
        if isinstance(response_message, str) and response_message:
            _remember_inbound_reply(db, from_number, body, response_message)

        logger.info(f"Coffee system returned message: {response_message}")
        
        # Update the database with the response
        try:
            if message_id is not None:
                cursor = db.cursor()
                cursor.execute("""
                    UPDATE sms_messages 
                    SET processed = TRUE, response_sent = %s
                    WHERE id = %s
                """, (response_message, message_id))
                db.commit()
                logger.info(f"Updated SMS record {message_id} with response")
        except Exception as update_err:
            logger.error(f"Failed to update SMS record: {str(update_err)}")
        
        # Return TwiML response
        response = messaging_service.create_response(response_message)
        logger.info(f"Creating TwiML response: {response}")
        
        # Make sure we're returning the response with correct content type
        from flask import Response
        return Response(response, mimetype='text/xml')
    except Exception as e:
        logger.error(f"Error processing SMS: {str(e)}", exc_info=True)

        # A failure here used to be a DEAD END: "our system is experiencing
        # issues, try again shortly" told the customer nothing about WHAT to
        # send, so a confirmed order became a person who never got coffee.
        #
        # The conversation state lives in its own table and SURVIVES the
        # failure — so the customer is still exactly where they were and
        # only needs to know what to resend. Seen live: a redeploy killed
        # the request mid-order at 04:33; the customer's "Yes" was recorded
        # with processed=false and the reply was a shrug.
        resp = MessagingResponse()
        resp.message(_recovery_prompt(request.values.get('From', '')))
        return str(resp)


# What to tell a customer whose message we failed to process. Keyed on the
# conversation state they are still sitting in, so the reply is an ACTION
# they can take rather than an apology. Plain ASCII only: non-ASCII turns
# the SMS into UCS-2 and doubles the cost of every segment.
_RECOVERY_BY_STATE = {
    'awaiting_name': "Sorry, we dropped that one. What's your first name?",
    'awaiting_coffee_type': "Sorry, we dropped that one. What coffee would you like?",
    'awaiting_milk': "Sorry, we dropped that one. Which milk would you like?",
    'awaiting_size': "Sorry, we dropped that one. What size would you like?",
    'awaiting_sugar': "Sorry, we dropped that one. How many sugars?",
    'awaiting_confirmation': ("Sorry, we dropped that one - your order is still "
                              "waiting. Reply YES to confirm it."),
}
_RECOVERY_DEFAULT = ("Sorry, we dropped that one. Please send your last message "
                     "again and we'll pick up where you left off.")


def _recovery_prompt(phone):
    """State-aware retry instruction, with the generic line as a fallback.

    Wrapped in its own try/except: this runs INSIDE an error handler, so it
    must never be the reason a customer gets no reply at all.
    """
    try:
        if not phone:
            return _RECOVERY_DEFAULT
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return _RECOVERY_DEFAULT
        state = coffee_system._get_conversation_state(phone) or {}
        return _RECOVERY_BY_STATE.get(state.get('state'), _RECOVERY_DEFAULT)
    except Exception as recovery_err:
        logger.warning(f"recovery prompt lookup failed: {recovery_err}")
        return _RECOVERY_DEFAULT

def _process_inbound_via_provider(provider_name: str):
    """Shared handler for non-Twilio inbound webhooks (ClickSend, Cellcast,
    future providers).

    Twilio is special: it replies in-band via TwiML on the webhook response.
    Every other provider expects a 200/204 and replies via a separate
    outbound API call. This helper:
      1. Looks up the provider, verifies the inbound, parses the payload.
      2. Runs the message through the same coffee_system.handle_sms() flow
         the legacy Twilio route uses.
      3. Sends the response back via the SAME provider's send() — that way
         a customer who texted the ClickSend number gets a reply from the
         ClickSend number, not from the Twilio number.

    Returns Flask response tuples.
    """
    from services.sms import get_provider
    provider = get_provider(provider_name)
    if not provider:
        logger.error(f"Unknown SMS provider in webhook: {provider_name!r}")
        return ('', 404)

    if not provider.verify_inbound(request):
        try:
            from services.logging_utils import event as _event
            _event('SMS_WEBHOOK_SIG_FAIL', provider=provider_name,
                   remote_addr=request.remote_addr)
        except Exception:
            pass
        return ('Unauthorized', 403)

    inbound = provider.parse_inbound(request)
    if inbound is None:
        logger.warning(f"{provider_name} inbound payload couldn't be parsed")
        # 200 anyway — most providers DON'T retry on 4xx, and a malformed
        # message isn't actionable. We've already logged it.
        return ('', 200)

    coffee_system = current_app.config.get('coffee_system')
    messaging_service = current_app.config.get('messaging_service')
    if not coffee_system or not messaging_service:
        logger.error(f"{provider_name} inbound: coffee_system/messaging_service unavailable")
        return ('', 503)

    # Persist the inbound — same shape the Twilio path writes.
    try:
        cur = coffee_system.db.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sms_messages (
                id SERIAL PRIMARY KEY,
                phone_number VARCHAR(20) NOT NULL,
                message_body TEXT NOT NULL,
                sender_name VARCHAR(100),
                station_id INTEGER,
                received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed BOOLEAN DEFAULT FALSE,
                response_sent TEXT
            )
        """)
        cur.execute("""
            INSERT INTO sms_messages (phone_number, message_body, sender_name)
            VALUES (%s, %s, %s)
        """, (inbound.from_number, inbound.body, None))
        coffee_system.db.commit()
    except Exception as e:
        logger.error(f"{provider_name} inbound DB save failed: {e}")
        try:
            coffee_system.db.rollback()
        except Exception:
            pass

    # Run NLP / conversation flow.
    metadata = {'sms_provider': provider_name}
    response_text = ''
    try:
        response_text = coffee_system.handle_sms(
            inbound.from_number, inbound.body, messaging_service, metadata,
        ) or ''
    except Exception as e:
        logger.exception(f"{provider_name} handle_sms failed: {e}")
        response_text = (
            "Sorry, our system is having a moment. Please try again."
        )

    # Reply via the same provider that received the message (so the
    # customer's reply chain stays on one number). Out-of-band: this
    # is a separate outbound API call, not an in-band webhook response.
    if response_text:
        result = provider.send(inbound.from_number, response_text)
        if not result.ok:
            logger.error(
                f"{provider_name} outbound reply to {inbound.from_number} failed: %s",
                result.error,
            )

    # Acknowledge the webhook with the provider's expected shape.
    body, status, headers = provider.reply_response('')
    return (body, status, headers)


@bp.route('/sms/clicksend', methods=['POST'])
def sms_webhook_clicksend():
    """Inbound from ClickSend. Auth: shared-secret header.

    Configure ClickSend's inbound webhook to POST here with the custom
    header X-Coffee-Cue-Webhook-Secret matching CLICKSEND_WEBHOOK_SECRET.
    """
    logger.info("ClickSend inbound webhook called")
    return _process_inbound_via_provider('clicksend')


@bp.route('/sms/cellcast', methods=['POST'])
def sms_webhook_cellcast():
    """Inbound from Cellcast. Auth: shared-secret header.

    Configure Cellcast's inbound webhook to POST here with the custom
    header X-Coffee-Cue-Webhook-Secret matching CELLCAST_WEBHOOK_SECRET.
    """
    logger.info("Cellcast inbound webhook called")
    return _process_inbound_via_provider('cellcast')


@bp.route('/sms/test')
def sms_test():
    """Test SMS functionality"""
    try:
        # Get messaging service from app context
        messaging_service = current_app.config.get('messaging_service')
        
        if not messaging_service:
            return jsonify({
                "status": "error", 
                "message": "Messaging service not available"
            })
            
        # Get Twilio phone number to confirm it's configured
        twilio_number = messaging_service.phone_number
        testing_mode = messaging_service.testing_mode
        
        return jsonify({
            "status": "SMS service is operational",
            "phone_number": twilio_number or "Not configured",
            "testing_mode": testing_mode
        })
    except Exception as e:
        logger.error(f"Error testing SMS functionality: {str(e)}")
        return jsonify({
            "status": "error", 
            "message": f"Error testing SMS functionality: {str(e)}"
        })

@bp.route('/sms/templates')
@jwt_required(optional=True)
def sms_templates():
    """List all SMS templates"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        
        if not coffee_system:
            return jsonify({
                "status": "error", 
                "message": "Coffee system not available"
            })
        
        # Get settings from database
        db = coffee_system.db
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Get SMS template settings
        cursor.execute("SELECT key, value FROM settings WHERE key LIKE '%_message'")
        templates = cursor.fetchall()
        
        template_dict = {}
        for template in templates:
            template_dict[template['key']] = template['value']
        
        return jsonify({
            "status": "success",
            "templates": template_dict
        })
    except Exception as e:
        logger.error(f"Error getting SMS templates: {str(e)}")
        return jsonify({
            "status": "error", 
            "message": f"Error getting SMS templates: {str(e)}"
        })

@bp.route('/sms/send-test', methods=['POST'])
@jwt_required(optional=True)
def send_test_sms():
    """
    Send a test SMS message to a specified number
    Used for system testing and verification
    """
    try:
        data = request.json
        to_number = data.get('to')
        message = data.get('message', 'This is a test message from the Expresso Coffee System')
        order_id = data.get('order_id')
        
        # Get messaging service from app context
        messaging_service = current_app.config.get('messaging_service')
        coffee_system = current_app.config.get('coffee_system')
        
        if not messaging_service:
            return jsonify({
                "success": False, 
                "message": "Messaging service not available"
            })
            
        # If order_id is provided, get phone number from the order
        if order_id and not to_number and coffee_system:
            try:
                db = coffee_system.db
                cursor = db.cursor()
                cursor.execute('SELECT phone FROM orders WHERE order_number = %s', (order_id,))
                order = cursor.fetchone()
                
                if order and order[0]:
                    to_number = order[0]
                    logger.info(f"Retrieved phone number {to_number} for order {order_id}")
                else:
                    logger.error(f"Order not found or no phone number: {order_id}")
                    return jsonify({
                        "success": False,
                        "message": f"Order {order_id} not found or has no phone number"
                    })
            except Exception as db_err:
                logger.error(f"Database error retrieving order: {str(db_err)}")
        
        if not to_number:
            return jsonify({
                "success": False, 
                "message": "No recipient phone number provided and no valid order ID"
            })
        
        # Check if the recipient number is the same as the Twilio number
        if to_number == messaging_service.phone_number:
            error_msg = "Cannot send SMS: recipient phone number is the same as the Twilio number"
            logger.error(error_msg)
            return jsonify({
                "success": False,
                "message": error_msg
            })
        
        # Send the test message
        message_sid = messaging_service.send_message(to_number, message)
        
        if message_sid:
            # Log successful message
            logger.info(f"Message sent successfully to {to_number}: {message}")
            
            # If this is order-related, log it in the database
            if order_id and coffee_system:
                try:
                    db = coffee_system.db
                    cursor = db.cursor()
                    
                    # Create order_messages table if it doesn't exist
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
                    
                    # Insert message record
                    cursor.execute("""
                        INSERT INTO order_messages 
                        (order_number, phone, message, message_sid)
                        VALUES (%s, %s, %s, %s)
                    """, (order_id, to_number, message, message_sid))
                    
                    db.commit()
                    logger.info(f"Saved order message to database for order {order_id}")
                except Exception as db_err:
                    logger.error(f"Failed to save order message to database: {str(db_err)}")
            
            return jsonify({
                "success": True,
                "message": f"Message sent to {to_number}",
                "message_sid": message_sid
            })
        else:
            return jsonify({
                "success": False,
                "message": "Failed to send message"
            })
    except Exception as e:
        logger.error(f"Error sending SMS: {str(e)}")
        return jsonify({
            "success": False, 
            "message": f"Error sending SMS: {str(e)}"
        })

@bp.route('/sms/send', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def send_sms():
    """Send an SMS. STAFF ONLY -- this spends real money.

    It took a destination number and a message body from anyone who could
    reach the URL, with no authentication at all, and sent it. Verified:
    an anonymous POST returned {"success": true, "message": "Message sent
    to ..."} and only TESTING_MODE stopped it leaving the building.

    The exposure is not just cost. It is a stranger sending arbitrary
    text FROM the event's number -- to any phone they choose -- which
    lands on the delegate's handset looking exactly like the coffee
    system, and which Twilio would eventually suspend the account over.

    Baristas are included because messaging a waiting customer is part
    of the job; the barista interface and the support dashboard both
    already send a Bearer token here, so nothing changes for them.
    """
    try:
        data = request.json
        to_number = data.get('to')
        message = data.get('message', '')
        order_id = data.get('order_id')
        
        # Get messaging service from app context
        messaging_service = current_app.config.get('messaging_service')
        coffee_system = current_app.config.get('coffee_system')
        
        if not messaging_service:
            return jsonify({
                "success": False, 
                "message": "Messaging service not available"
            })
            
        # If order_id is provided, get phone number from the order
        if order_id and not to_number and coffee_system:
            try:
                db = coffee_system.db
                cursor = db.cursor()
                cursor.execute('SELECT phone FROM orders WHERE order_number = %s', (order_id,))
                order = cursor.fetchone()
                
                if order and order[0]:
                    to_number = order[0]
                    logger.info(f"Retrieved phone number {to_number} for order {order_id}")
                else:
                    logger.error(f"Order not found or no phone number: {order_id}")
                    return jsonify({
                        "success": False,
                        "message": f"Order {order_id} not found or has no phone number"
                    })
            except Exception as db_err:
                logger.error(f"Database error retrieving order: {str(db_err)}")
        
        if not to_number and not order_id:
            return jsonify({
                "success": False, 
                "message": "No recipient phone number or order ID provided"
            })
            
        if not message:
            return jsonify({
                "success": False, 
                "message": "Message content cannot be empty"
            })
            
        # Check if the recipient number is the same as the Twilio number
        if to_number == messaging_service.phone_number:
            error_msg = "Cannot send SMS: recipient phone number is the same as the Twilio number"
            logger.error(error_msg)
            return jsonify({
                "success": False,
                "message": error_msg
            })
        
        # Send the message
        message_sid = messaging_service.send_message(to_number, message)
        
        if message_sid:
            # Log successful message
            logger.info(f"Message sent successfully to {to_number}: {message}")
            
            # If this is order-related, log it in the database
            if order_id and coffee_system:
                try:
                    db = coffee_system.db
                    cursor = db.cursor()
                    
                    # Create order_messages table if it doesn't exist
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
                    
                    # Insert message record
                    cursor.execute("""
                        INSERT INTO order_messages 
                        (order_number, phone, message, message_sid)
                        VALUES (%s, %s, %s, %s)
                    """, (order_id, to_number, message, message_sid))
                    
                    db.commit()
                    logger.info(f"Saved order message to database for order {order_id}")
                except Exception as db_err:
                    logger.error(f"Failed to save order message to database: {str(db_err)}")
            
            return jsonify({
                "success": True,
                "message": f"Message sent to {to_number}",
                "message_sid": message_sid
            })
        else:
            return jsonify({
                "success": False,
                "message": "Failed to send message"
            })
    except Exception as e:
        logger.error(f"Error sending SMS: {str(e)}")
        return jsonify({
            "success": False, 
            "message": f"Error sending SMS: {str(e)}"
        })

@bp.route('/sms/history')
@jwt_required()
def sms_history():
    """Get SMS message history"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        
        if not coffee_system:
            return jsonify({
                "status": "error", 
                "message": "Coffee system not available"
            })
        
        # Get database connection
        db = coffee_system.db
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Check if the table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'sms_messages'
            )
        """)
        table_exists = cursor.fetchone()['exists']
        
        if not table_exists:
            return jsonify({
                "status": "success",
                "messages": [],
                "message": "No SMS history available"
            })
        
        # Get SMS messages
        cursor.execute("""
            SELECT id, phone_number, message_body, sender_name, 
                   received_at, processed, response_sent
            FROM sms_messages
            ORDER BY received_at DESC
            LIMIT 100
        """)
        
        messages = []
        for row in cursor.fetchall():
            messages.append(dict(row))
        
        return jsonify({
            "status": "success",
            "count": len(messages),
            "messages": messages
        })
    except Exception as e:
        logger.error(f"Error getting SMS history: {str(e)}")
        return jsonify({
            "status": "error", 
            "message": f"Error getting SMS history: {str(e)}"
        })

@bp.route('/sms/status-callback', methods=['POST'])
def sms_status_callback():
    """
    Handle SMS delivery status callbacks from Twilio
    This is called by Twilio when the status of a message changes
    """
    try:
        message_sid = request.values.get('MessageSid', '')
        message_status = request.values.get('MessageStatus', '')
        
        logger.info(f"SMS Status Update - SID: {message_sid}, Status: {message_status}")
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        
        if coffee_system and coffee_system.db:
            # Store status update in database for tracking
            db = coffee_system.db
            cursor = db.cursor()
            
            # Check if sms_status_logs table exists, create if not
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sms_status_logs (
                    id SERIAL PRIMARY KEY,
                    message_sid TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Log status update
            cursor.execute(
                "INSERT INTO sms_status_logs (message_sid, status) VALUES (%s, %s)",
                (message_sid, message_status)
            )
            db.commit()
        
        return '', 204  # No content response
    except Exception as e:
        logger.error(f"Error processing SMS status callback: {str(e)}")
        return '', 500  # Internal server error