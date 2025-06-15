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
