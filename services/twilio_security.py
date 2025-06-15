"""
Secure Twilio service with environment variable handling
"""
import os
import hmac
import hashlib
from twilio.rest import Client
from twilio.request_validator import RequestValidator

class SecureTwilioService:
    """Secure wrapper for Twilio with environment variable handling"""
    
    def __init__(self):
        self.account_sid = os.getenv('TWILIO_ACCOUNT_SID')
        self.auth_token = os.getenv('TWILIO_AUTH_TOKEN')
        self.phone_number = os.getenv('TWILIO_PHONE_NUMBER')
        
        # Check if credentials are available
        self.is_configured = all([self.account_sid, self.auth_token, self.phone_number])
        
        if self.is_configured:
            self.client = Client(self.account_sid, self.auth_token)
            self.validator = RequestValidator(self.auth_token)
        else:
            self.client = None
            self.validator = None
            print("⚠️  WARNING: Twilio credentials not configured. SMS features disabled.")
    
    def send_sms(self, to_number, message):
        """Send SMS if Twilio is configured"""
        if not self.is_configured:
            print(f"SMS (disabled): Would send to {to_number}: {message}")
            return None
            
        try:
            message = self.client.messages.create(
                body=message,
                from_=self.phone_number,
                to=to_number
            )
            return message.sid
        except Exception as e:
            print(f"Error sending SMS: {e}")
            return None
    
    def validate_webhook(self, url, params, signature):
        """Validate Twilio webhook signature"""
        if not self.is_configured:
            print("⚠️  WARNING: Cannot validate webhook without Twilio credentials")
            return False
            
        return self.validator.validate(url, params, signature)
    
    def get_webhook_signature(self, auth_token, url, params):
        """Generate expected webhook signature for validation"""
        # Sort parameters by key
        sorted_params = sorted(params.items())
        
        # Build the validation string
        validation_string = url
        for key, value in sorted_params:
            validation_string += key + str(value)
        
        # Calculate signature
        signature = hmac.new(
            auth_token.encode(),
            validation_string.encode(),
            hashlib.sha1
        ).digest()
        
        # Return base64 encoded signature
        import base64
        return base64.b64encode(signature).decode()

# Singleton instance
twilio_service = SecureTwilioService()