#!/usr/bin/env python
"""
Simple test script to verify Twilio SMS functionality
"""
import os
from dotenv import load_dotenv
from twilio.rest import Client
import logging

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("twilio_test")

# Load environment variables
load_dotenv()

# Twilio configuration
account_sid = os.getenv('TWILIO_ACCOUNT_SID')
auth_token = os.getenv('TWILIO_AUTH_TOKEN')
phone_number = os.getenv('TWILIO_PHONE_NUMBER')
test_recipient = "+61400123456"  # Changed to a different test phone number

def test_twilio_credentials():
    """Test if the Twilio credentials are valid"""
    logger.info(f"Testing Twilio credentials (SID: {account_sid[:5]}...)")
    try:
        client = Client(account_sid, auth_token)
        # Just getting the account info will test if the credentials work
        account = client.api.accounts(account_sid).fetch()
        logger.info(f"Twilio credentials are valid! Account type: {account.type}")
        return True
    except Exception as e:
        logger.error(f"Twilio credential validation failed: {str(e)}")
        return False

def test_send_sms():
    """Test sending an SMS message"""
    logger.info(f"Testing SMS sending to {test_recipient}")
    try:
        client = Client(account_sid, auth_token)
        message = client.messages.create(
            body="This is a test message from the Coffee Cue system",
            from_=phone_number,
            to=test_recipient
        )
        logger.info(f"SMS sent successfully! Message SID: {message.sid}")
        return True
    except Exception as e:
        logger.error(f"SMS sending failed: {str(e)}")
        return False

if __name__ == "__main__":
    logger.info("=== Twilio Integration Test ===")
    logger.info(f"Account SID: {account_sid}")
    logger.info(f"Auth Token: {'*' * len(auth_token) if auth_token else 'Not set'}")
    logger.info(f"Phone Number: {phone_number}")
    
    if not account_sid or not auth_token:
        logger.error("Twilio credentials are not set in the .env file")
        exit(1)
        
    if not phone_number:
        logger.error("Twilio phone number is not set in the .env file")
        exit(1)
    
    creds_valid = test_twilio_credentials()
    
    if creds_valid:
        sms_sent = test_send_sms()
        
        if sms_sent:
            logger.info("All tests PASSED! Twilio integration is working correctly.")
        else:
            logger.error("SMS sending test FAILED. Check the error logs above.")
    else:
        logger.error("Credential validation FAILED. Check the error logs above.")