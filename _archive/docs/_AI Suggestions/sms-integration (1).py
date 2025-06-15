"""
SMS Integration Module for Coffee Cue System

This module shows how to integrate the enhanced SMS handler with the existing system.
"""
import logging
from flask import Blueprint, request, jsonify, current_app
from twilio.twiml.messaging_response import MessagingResponse

from services.sms_handler import SMSConversationHandler

# Create blueprint
bp = Blueprint("sms_integration", __name__)

# Set up logging
logger = logging.getLogger("expresso.sms_integration")

@bp.route('/sms', methods=['POST'])
def sms_webhook():
    """
    Handle incoming SMS messages from Twilio
    This is the main webhook that Twilio will POST to when a new SMS is received
    """
    try:
        # Log request information
        logger.info(f"SMS webhook called with request method: {request.method}")
        logger.info(f"Request form data: {request.form}")
        
        # Get POST data
        from_number = request.values.get('From', '')
        body = request.values.get('Body', '')
        
        # Validate required fields
        if not from_number or not body:
            logger.error("Missing required fields in SMS webhook")
            resp = MessagingResponse()
            resp.message("Sorry, we couldn't process your message. Please try again.")
            return str(resp)
        
        # Get additional metadata
        sender_name = request.values.get('ProfileName', '')
        
        # Get coffee system and messaging service from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            resp = MessagingResponse()
            resp.message("Sorry, our ordering system is currently unavailable. Please try again later.")
            return str(resp)
        
        # Check if we have an existing SMS handler in app config
        sms_handler = current_app.config.get('sms_handler')
        
        # If not, create a new one
        if not sms_handler:
            sms_handler = SMSConversationHandler(coffee_system, coffee_system.db, current_app.config.get('config'))
            # Store it for future use
            current_app.config['sms_handler'] = sms_handler
        
        # Handle the message
        response_message = sms_handler.handle_sms(from_number, body, messaging_service)
        
        # Add the message and response to our logs/database
        try:
            # Record the message in our database for analysis
            cursor = coffee_system.db.cursor()
            
            # Make sure sms_messages table exists
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sms_messages (
                    id SERIAL PRIMARY KEY,
                    phone_number VARCHAR(20) NOT NULL,
                    message_body TEXT NOT NULL,
                    sender_name VARCHAR(100),
                    station_id INTEGER,
                    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed BOOLEAN DEFAULT TRUE,
                    response_sent TEXT
                )
            """)
            
            # Extract station ID if present in the message
            station_id = None
            import re
            station_pattern = r'(?:(?:for|to|at)\s+)?(?:station|st|station\s*id|station\s*\#)[^0-9]*([0-9]+)'
            station_match = re.search(station_pattern, body.lower())
            if station_match:
                try:
                    station_id = int(station_match.group(1))
                except (ValueError, TypeError):
                    pass
                    
            # Insert the message with response
            cursor.execute("""
                INSERT INTO sms_messages (phone_number, message_body, sender_name, station_id, response_sent)
                VALUES (%s, %s, %s, %s, %s)
            """, (from_number, body, sender_name, station_id, response_message))
            
            coffee_system.db.commit()
            logger.info(f"Recorded SMS conversation to database")
            
        except Exception as db_err:
            logger.error(f"Error recording SMS conversation: {str(db_err)}")
            # Continue even if this fails (non-critical)
        
        # Return TwiML response
        response = messaging_service.create_response(response_message)
        logger.info(f"Sending response: {response_message[:100]}...")
        return response
        
    except Exception as e:
        logger.error(f"Error processing SMS: {str(e)}", exc_info=True)
        
        # Create a simple response for error cases
        resp = MessagingResponse()
        resp.message("Sorry, our system is experiencing issues. Please try again shortly.")
        return str(resp)

@bp.route('/sms/test', methods=['GET'])
def test_sms():
    """Test endpoint to verify SMS system is working"""
    try:
        # Get messaging service from app context
        messaging_service = current_app.config.get('messaging_service')
        
        if not messaging_service:
            return jsonify({
                "status": "error",
                "message": "Messaging service not available"
            })
        
        # Get Twilio configuration
        twilio_number = messaging_service.phone_number
        testing_mode = messaging_service.testing_mode
        
        # Check if our SMS handler is configured
        sms_handler = current_app.config.get('sms_handler')
        
        return jsonify({
            "status": "success",
            "message": "SMS system is operational",
            "phone_number": twilio_number or "Not configured",
            "testing_mode": testing_mode,
            "sms_handler_configured": sms_handler is not None,
            "nlp_available": sms_handler and sms_handler.nlp is not None if sms_handler else False,
            "advanced_nlp_available": sms_handler and sms_handler.advanced_nlp is not None if sms_handler else False
        })
    except Exception as e:
        logger.error(f"Error testing SMS system: {str(e)}")
        return jsonify({
            "status": "error",
            "message": f"Error testing SMS system: {str(e)}"
        })

def register_sms_handler(app):
    """
    Register the SMS handler with the Flask app
    
    Args:
        app: Flask application instance
    """
    # Register the blueprint
    app.register_blueprint(bp, url_prefix='/api')
    
    # Add SMS handler to app config
    with app.app_context():
        coffee_system = app.config.get('coffee_system')
        config = app.config.get('config')
        
        if coffee_system and coffee_system.db and config:
            sms_handler = SMSConversationHandler(coffee_system, coffee_system.db, config)
            app.config['sms_handler'] = sms_handler
            logger.info("SMS conversation handler registered with application")
            
            # Log NLP availability
            if sms_handler.nlp:
                logger.info("NLP service available for SMS processing")
            else:
                logger.warning("NLP service not available, using basic text parsing")
                
            if sms_handler.advanced_nlp:
                logger.info("Advanced NLP service available for SMS processing")
            else:
                logger.info("Advanced NLP service not available")
        else:
            logger.error("Failed to register SMS handler - missing dependencies")
    
    return app
"""
SMS Integration Module for Coffee Cue System

This module shows how to integrate the enhanced SMS handler with the existing system.
"""
import logging
from flask import Blueprint, request, jsonify, current_app
from twilio.twiml.messaging_response import MessagingResponse

from services.sms_handler import SMSConversationHandler

# Create blueprint
bp = Blueprint("sms_integration", __name__)

# Set up logging
logger = logging.getLogger("expresso.sms_integration")

@bp.route('/sms', methods=['POST'])
def sms_webhook():
    """
    Handle incoming SMS messages from Twilio
    This is the main webhook that Twilio will POST to when a new SMS is received
    """
    try:
        # Log request information
        logger.info(f"SMS webhook called with request method: {request.method}")
        logger.info(f"Request form data: {request.form}")
        
        # Get POST data
        from_number = request.values.get('From', '')
        body = request.values.get('Body', '')
        
        # Validate required fields
        if not from_number or not body:
            logger.error("Missing required fields in SMS webhook")
            resp = MessagingResponse()
            resp.message("Sorry, we couldn't process your message. Please try again.")
            return str(resp)
        
        # Get additional metadata
        sender_name = request.values.get('ProfileName', '')
        
        # Get coffee system and messaging service from app context
        coffee_system = current_app.config.get('coffee_system')
        messaging_service = current_app.config.get('messaging_service')
        
        if not coffee_system or not messaging_service:
            logger.error("Coffee system or messaging service not available")
            resp = MessagingResponse()
            resp.message("Sorry, our ordering system is currently unavailable. Please try again later.")
            return str(resp)
        
        # Initialize SMS conversation handler
        sms_handler = SMSConversationHandler(coffee_system, coffee_system.db, current_app.config.get('config'))
        
        # Handle the message
        response_message = sms_handler.handle_sms(from_number, body, messaging_service)
        
        # Return TwiML response
        response = messaging_service.create_response(response_message)
        logger.info(f"Sending response: {response_message[:100]}...")
        return response
        
    except Exception as e:
        logger.error(f"Error processing SMS: {str(e)}", exc_info=True)
        
        # Create a simple response for error cases
        resp = MessagingResponse()
        resp.message("Sorry, our system is experiencing issues. Please try again shortly.")
        return str(resp)

def register_sms_handler(app):
    """
    Register the SMS handler with the Flask app
    
    Args:
        app: Flask application instance
    """
    # Register the blueprint
    app.register_blueprint(bp)
    
    # Add SMS handler to app config
    with app.app_context():
        coffee_system = app.config.get('coffee_system')
        config = app.config.get('config')
        
        if coffee_system and coffee_system.db and config:
            sms_handler = SMSConversationHandler(coffee_system, coffee_system.db, config)
            app.config['sms_handler'] = sms_handler
            logger.info("SMS conversation handler registered with application")
        else:
            logger.error("Failed to register SMS handler - missing dependencies")
    
    return app
