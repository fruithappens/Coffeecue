"""
Messaging service for handling SMS communications
"""
import logging
from twilio.rest import Client
from twilio.twiml.messaging_response import MessagingResponse
import os
import time
from datetime import datetime
import qrcode
import base64
from io import BytesIO

logger = logging.getLogger("expresso.services.messaging")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

class MessagingService:
    """Service for sending and receiving SMS messages"""
    
    def __init__(self, account_sid=None, auth_token=None, phone_number=None, testing_mode=False):
        """
        Initialize the messaging service
        
        Args:
            account_sid: Twilio account SID
            auth_token: Twilio auth token
            phone_number: Twilio phone number
            testing_mode: Whether to operate in testing mode (no actual SMS sent)
        """
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.phone_number = phone_number
        self.testing_mode = testing_mode
        self.client = None
        
        if account_sid and auth_token and not testing_mode:
            try:
                self.client = Client(account_sid, auth_token)
                logger.info("Twilio client initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Twilio client: {str(e)}")
    
    def create_response(self, message_body):
        """
        Create a TwiML response for an incoming SMS
        
        Args:
            message_body: Message body to send
            
        Returns:
            TwiML response string
        """
        resp = MessagingResponse()
        resp.message(message_body)
        return str(resp)
    
    def send_message(self, to, body):
        """
        Send an SMS message
        
        Args:
            to: Recipient phone number
            body: Message body
            
        Returns:
            Message SID if successful, None otherwise
        """
        if self.testing_mode:
            logger.info(f"TESTING MODE - Would send to {to}: {body}")
            return "testing_mode_message_sid"
        
        if not self.client:
            logger.warning("No Twilio client available, skipping SMS notification")
            return None
        
        try:
            message = self.client.messages.create(
                body=body,
                from_=self.phone_number,
                to=to
            )
            logger.info(f"Sent SMS to {to}")
            return message.sid
        except Exception as e:
            logger.error(f"Error sending SMS to {to}: {str(e)}")
            return None
    
    def send_order_confirmation(self, to, order_number, station_id, order_details, wait_time=15, 
                              is_vip=False, for_friend=None, is_group=False):
        """
        Send an order confirmation SMS with venue map link and QR code
        
        Args:
            to: Recipient phone number
            order_number: Order number
            station_id: Station ID
            order_details: Order details dictionary
            wait_time: Estimated wait time in minutes
            is_vip: Whether this is a VIP order
            for_friend: Optional friend name
            is_group: Whether this is a group order
            
        Returns:
            Message SID if successful, None otherwise
        """
        # Format the order details for the message
        coffee_type = order_details.get('type', 'Coffee')
        size = order_details.get('size', 'Regular')
        milk = order_details.get('milk', '')
        barista_name = order_details.get('barista_name', '')
        
        # Build personalized order description
        coffee_desc = f"{size} {coffee_type}"
        if milk and milk != "no milk" and milk != "standard":
            coffee_desc += f" with {milk} milk"
        
        if order_details.get('strength'):
            coffee_desc += f", {order_details.get('strength')}"
            
        if order_details.get('temp'):
            coffee_desc += f", {order_details.get('temp')}"
            
        if order_details.get('sugar') and order_details.get('sugar') != 'no sugar':
            coffee_desc += f", {order_details.get('sugar')}"
        
        # Build message components
        vip_msg = " (VIP - Front of queue!)" if is_vip else ""
        friend_msg = f" for {for_friend}" if for_friend else ""
        group_msg = " (Group order)" if is_group else ""
        
        # Try to get venue map URL from settings
        venue_map_url = None
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system:
                    cursor = coffee_system.db.cursor()
                    cursor.execute("SELECT value FROM settings WHERE key = 'venue_map_url'")
                    result = cursor.fetchone()
                    venue_map_url = result[0] if result else None
        except Exception as e:
            logger.error(f"Error retrieving venue map URL: {str(e)}")
        
        # Create a tiny URL with station, ETA, order details
        station_detail_url = ""
        if venue_map_url:
            try:
                # Create a personalized URL with order details
                order_url_params = f"?order={order_number}&station={station_id}&eta={wait_time}&coffee={coffee_type}"
                if barista_name:
                    order_url_params += f"&barista={barista_name}"
                
                # If we have a URL shortening service configured, use it
                short_url_enabled = False
                try:
                    cursor = coffee_system.db.cursor()
                    cursor.execute("SELECT value FROM settings WHERE key = 'short_url_service'")
                    result = cursor.fetchone()
                    short_url_enabled = result[0].lower() in ('true', 'yes', 't', 'y', '1') if result else False
                except Exception as e:
                    logger.error(f"Error checking short URL setting: {str(e)}")
                
                if short_url_enabled:
                    # Implementation for URL shortening would go here
                    # For now, use the full URL
                    station_detail_url = f"\n\nFind your station here: {venue_map_url}{order_url_params}"
                else:
                    station_detail_url = f"\n\nFind your station here: {venue_map_url}{order_url_params}"
                
                # Generate QR code for order details if enabled
                try:
                    cursor = coffee_system.db.cursor()
                    cursor.execute("SELECT value FROM settings WHERE key = 'include_qr_code'")
                    include_qr = result[0].lower() in ('true', 'yes', 't', 'y', '1') if result else False
                    
                    if include_qr:
                        # For SMS, we don't include the actual QR code, but let the user know it's available
                        station_detail_url += "\n\nA QR code for your order is available in the venue app."
                except Exception as e:
                    logger.error(f"Error checking QR code setting: {str(e)}")
                
            except Exception as e:
                logger.error(f"Error creating station detail URL: {str(e)}")
                
        # Base confirmation message with improved formatting and more compact command options
        message = (
            f"Thank you{friend_msg}! Your order #{order_number} has been confirmed and sent to Station {station_id}. " 
            f"Approximate wait time: {wait_time} minutes.{station_detail_url}\n\n"
            f"We will send you a SMS when it's ready for collection.\n\n"
            f"(To order same next time SMS USUAL, if you want to order for a friend SMS FRIEND. " 
            f"You can also check STATUS, CANCEL order, or MENU to see what's on offer.)"
        )
        
        # Add sponsor message if available
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system:
                    sponsor_info = coffee_system.get_sponsor_info()
                    if sponsor_info and sponsor_info.get('message'):
                        message += f"\n\n{sponsor_info['message']}"
        except (ImportError, AttributeError):
            pass
        
        # Send the message
        return self.send_message(to, message)
    
    def send_order_ready_notification(self, to, order_number, station_id, for_friend=None):
        """
        Send notification when an order is ready
        
        Args:
            to: Recipient phone number
            order_number: Order number
            station_id: Station ID
            for_friend: Optional friend name
            
        Returns:
            Message SID if successful, None otherwise
        """
        # Create message with customization
        friend_text = f" for {for_friend}" if for_friend else ""
        
        # Get order details to make the message more specific
        coffee_type = "coffee"
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system:
                    order = coffee_system.get_order_by_number(order_number)
                    if order and 'order_details' in order:
                        details = order['order_details']
                        if 'type' in details:
                            coffee_type = details['type']
        except:
            pass
        
        message = (
            f"🔔 YOUR COFFEE IS READY! 🔔\n\n"
            f"Your {coffee_type} (order #{order_number}){friend_text} is now ready "
            f"for collection from Station {station_id}.\n\n"
            f"Enjoy! ☕"
        )
        
        # Send the message
        return self.send_message(to, message)
    
    def send_reminder(self, to, order_number, station_id, wait_time):
        """
        Send a reminder for uncollected orders
        
        Args:
            to: Recipient phone number
            order_number: Order number
            station_id: Station ID
            wait_time: How long the order has been waiting in minutes
            
        Returns:
            Message SID if successful, None otherwise
        """
        # Get order details to make the message more specific
        coffee_type = "coffee"
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system:
                    order = coffee_system.get_order_by_number(order_number)
                    if order and 'order_details' in order:
                        details = order['order_details']
                        if 'type' in details:
                            coffee_type = details['type']
        except:
            pass
        
        message = (
            f"⏰ REMINDER: Your {coffee_type} (order #{order_number}) has been ready "
            f"for {wait_time} minutes.\n\n"
            f"Please collect it from Station {station_id} soon!"
        )
        
        return self.send_message(to, message)
    
    @staticmethod
    def generate_qr_code(data, size=10):
        """
        Generate a QR code as a base64 encoded image
        
        Args:
            data: Data to encode in the QR code
            size: Size of the QR code (box size in pixels)
            
        Returns:
            Base64 encoded PNG image
        """
        try:
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=size,
                border=4,
            )
            qr.add_data(data)
            qr.make(fit=True)
            
            # Create an image
            img = qr.make_image(fill_color="black", back_color="white")
            
            # Save to BytesIO
            buffer = BytesIO()
            img.save(buffer, format="PNG")
            
            # Convert to base64
            img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
            return f"data:image/png;base64,{img_str}"
        except Exception as e:
            logger.error(f"QR code generation failed: {str(e)}")
            return None
    
    def generate_order_qr_code(self, order_number, url_prefix=""):
        """
        Generate a QR code for an order
        
        Args:
            order_number: Order number
            url_prefix: Optional URL prefix
            
        Returns:
            QR code image as base64 string or None if generation fails
        """
        try:
            # Create a URL or data string
            if url_prefix:
                data = f"{url_prefix}/order/{order_number}"
            else:
                data = f"ORDER:{order_number}"
            
            return self.generate_qr_code(data)
        except Exception as e:
            logger.error(f"Order QR code generation failed: {str(e)}")
            return None