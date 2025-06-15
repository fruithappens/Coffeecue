#!/usr/bin/env python3
"""
Quick check if Twilio webhook needs updating.
Returns exit code 0 if update needed, 1 if not needed.
"""

import os
import sys
import json
import requests
from twilio.rest import Client

def get_ngrok_url():
    """Get the current ngrok public URL"""
    try:
        response = requests.get('http://localhost:4040/api/tunnels', timeout=2)
        tunnels = response.json()['tunnels']
        for tunnel in tunnels:
            if tunnel['proto'] == 'https':
                return tunnel['public_url']
        for tunnel in tunnels:
            if tunnel['proto'] == 'http':
                return tunnel['public_url']
    except:
        return None

def get_twilio_credentials():
    """Get Twilio credentials from environment or config file"""
    account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
    auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
    phone_number_sid = os.environ.get('TWILIO_PHONE_NUMBER_SID')
    
    if not all([account_sid, auth_token, phone_number_sid]):
        config_path = 'twilio-config.json'
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                account_sid = config.get('account_sid')
                auth_token = config.get('auth_token')
                phone_number_sid = config.get('phone_number_sid')
            except:
                pass
    
    return account_sid, auth_token, phone_number_sid

def check_webhook_needs_update():
    """Check if webhook URL needs updating"""
    # Get current ngrok URL
    ngrok_url = get_ngrok_url()
    if not ngrok_url:
        return False  # No ngrok running
    
    # Get Twilio credentials
    account_sid, auth_token, phone_number_sid = get_twilio_credentials()
    if not all([account_sid, auth_token, phone_number_sid]):
        return False  # No credentials
    
    try:
        # Check current webhook URL
        client = Client(account_sid, auth_token)
        phone_number = client.incoming_phone_numbers(phone_number_sid).fetch()
        current_webhook = phone_number.sms_url
        
        # Expected webhook URL
        expected_webhook = f"{ngrok_url}/api/sms/webhook"
        
        # Return True if they don't match
        return current_webhook != expected_webhook
    except:
        return False

if __name__ == "__main__":
    if check_webhook_needs_update():
        sys.exit(0)  # Update needed
    else:
        sys.exit(1)  # No update needed