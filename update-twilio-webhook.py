#!/usr/bin/env python3
"""
Automatically update Twilio webhook URL when ngrok starts.
Run this after starting ngrok to update your Twilio phone number's webhook.
"""

import os
import sys
import json
import requests
from twilio.rest import Client

def get_ngrok_url():
    """Get the current ngrok public URL"""
    try:
        # Check ngrok API (default port 4040)
        response = requests.get('http://localhost:4040/api/tunnels')
        tunnels = response.json()['tunnels']
        
        # Find the https tunnel
        for tunnel in tunnels:
            if tunnel['proto'] == 'https':
                return tunnel['public_url']
        
        # If no https, use http
        for tunnel in tunnels:
            if tunnel['proto'] == 'http':
                return tunnel['public_url']
                
    except Exception as e:
        print(f"Error getting ngrok URL: {e}")
        print("Make sure ngrok is running!")
        return None

def get_twilio_credentials():
    """Get Twilio credentials from environment or config file"""
    # First try environment variables
    account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
    auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
    phone_number_sid = os.environ.get('TWILIO_PHONE_NUMBER_SID')
    
    # If not in environment, try config file
    if not all([account_sid, auth_token, phone_number_sid]):
        config_path = 'twilio-config.json'
        if os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                account_sid = config.get('account_sid')
                auth_token = config.get('auth_token')
                phone_number_sid = config.get('phone_number_sid')
                print("📄 Using credentials from twilio-config.json")
            except Exception as e:
                print(f"Error reading config file: {e}")
    
    return account_sid, auth_token, phone_number_sid

def update_twilio_webhook(ngrok_url):
    """Update Twilio phone number webhook"""
    # Get Twilio credentials
    account_sid, auth_token, phone_number_sid = get_twilio_credentials()
    
    if not all([account_sid, auth_token, phone_number_sid]):
        print("\n❌ Twilio credentials not found!")
        print("\nOption 1: Set environment variables:")
        print("export TWILIO_ACCOUNT_SID='your_account_sid'")
        print("export TWILIO_AUTH_TOKEN='your_auth_token'")
        print("export TWILIO_PHONE_NUMBER_SID='your_phone_number_sid'")
        print("\nOption 2: Create twilio-config.json:")
        print("cp twilio-config.example.json twilio-config.json")
        print("# Then edit twilio-config.json with your values")
        print("\nYou can find these in your Twilio console.")
        return False
    
    # Initialize Twilio client
    client = Client(account_sid, auth_token)
    
    # Update the phone number webhook
    webhook_url = f"{ngrok_url}/api/sms/webhook"
    
    try:
        phone_number = client.incoming_phone_numbers(phone_number_sid).update(
            sms_url=webhook_url,
            sms_method='POST'
        )
        
        print(f"✅ Successfully updated Twilio webhook!")
        print(f"   Phone: {phone_number.phone_number}")
        print(f"   Webhook: {webhook_url}")
        return True
        
    except Exception as e:
        print(f"❌ Error updating Twilio webhook: {e}")
        return False

def main():
    print("🔄 Updating Twilio webhook with ngrok URL...")
    
    # Get current ngrok URL
    ngrok_url = get_ngrok_url()
    if not ngrok_url:
        sys.exit(1)
    
    print(f"📡 Found ngrok URL: {ngrok_url}")
    
    # Update Twilio
    if update_twilio_webhook(ngrok_url):
        print("\n✨ All done! Your Twilio webhook is now pointing to ngrok.")
    else:
        print("\n❌ Failed to update Twilio webhook.")
        sys.exit(1)

if __name__ == "__main__":
    main()