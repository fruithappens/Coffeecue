"""
Routes for handling SMS messages from Twilio with PostgreSQL support
"""
from flask import Blueprint, request, jsonify, current_app
from twilio.twiml.messaging_response import MessagingResponse
from flask_jwt_extended import jwt_required, get_jwt_identity
from psycopg2.extras import RealDictCursor
import logging
import json
import os
from twilio.request_validator import RequestValidator

# Create blueprint
bp = Blueprint("sms_routes", __name__)

# Set up logging
logger = logging.getLogger("expresso.routes.sms")

@bp.route('/sms/debug', methods=['GET', 'POST'])
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
    
    try:
        # SECURITY: Validate Twilio webhook signature
        auth_token = os.getenv('TWILIO_AUTH_TOKEN')
        if auth_token and auth_token != 'test_token':  # Skip validation if using test token
            validator = RequestValidator(auth_token)
            
            # Get the signature from headers
            signature = request.headers.get('X-Twilio-Signature', '')
            
            # Get the full URL (including protocol and domain)
            url = request.url
            
            # Get POST parameters
            params = request.form.to_dict()
            
            # Validate the request
            if not validator.validate(url, params, signature):
                logger.warning(f"Invalid Twilio webhook signature from {request.remote_addr}")
                return "Unauthorized", 403
        else:
            logger.warning("Twilio auth token not configured or in test mode, skipping webhook validation")
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
        
        # Process the message and get a response
        response_message = coffee_system.handle_sms(from_number, body, messaging_service, metadata)
        
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
        except Exception as update_err:
            logger.error(f"Failed to update SMS record: {str(update_err)}")
        
        # Return TwiML response
        response = messaging_service.create_response(response_message)
        logger.info(f"Sending response: {response}")
        return response
    except Exception as e:
        logger.error(f"Error processing SMS: {str(e)}", exc_info=True)
        
        # Create a simple response for error cases
        resp = MessagingResponse()
        resp.message("Sorry, our system is experiencing issues. Please try again shortly.")
        return str(resp)

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
def send_sms():
    """
    Send an SMS message
    Used for direct SMS sending from frontend
    This endpoint supports both phone numbers and order IDs
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