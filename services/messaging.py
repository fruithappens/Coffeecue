"""
Messaging service for handling SMS communications
"""
import logging
from twilio.rest import Client
from twilio.http.http_client import TwilioHttpClient
from utils.station_label import station_label
from utils.database import get_db_connection
from twilio.twiml.messaging_response import MessagingResponse
import os
import time
from datetime import datetime
import qrcode
import base64
from io import BytesIO

logger = logging.getLogger("expresso.services.messaging")

# Test Bench simulator phones. Not an allocatable Australian mobile range,
# so a number with this prefix is never a real person. Kept here rather
# than in a route module because the wall belongs in the sender.
BENCH_PHONE_PREFIX = '+6140000'

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

class MessagingService:
    """Service for sending and receiving SMS messages"""
    

    def _station_label(self, station_id):
        """Station NAME for customer text, or the old wording if unavailable.

        This class holds no db handle of its own, and a name lookup must
        never be able to stop a ready-message going out - so it opens one
        defensively and falls back on any failure.
        """
        try:
            return station_label(get_db_connection(), station_id)
        except Exception as e:
            logger.warning(f"station name lookup failed, using id: {e}")
            return f"Station {station_id}"

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
                # A TIMEOUT, explicitly. Twilio's default client has none, and
                # this call is made INSIDE the request that marks a coffee
                # complete - so an unanswered socket does not just delay one
                # text, it holds the worker. Production runs a single-threaded
                # server, so everything else queues behind it: on 23 Aug that
                # produced 25 minutes of "Application failed to respond" with
                # CPU at 0.0 vCPU and memory flat, the signature of a process
                # waiting rather than working.
                #
                # 10s connect / 10s read. A ready-SMS that cannot be sent in
                # ten seconds should fail and be logged, not stop service.
                timeout = float(os.environ.get('TWILIO_HTTP_TIMEOUT', '10'))
                self.client = Client(
                    account_sid, auth_token,
                    http_client=TwilioHttpClient(timeout=timeout),
                )
                logger.info("Twilio client initialized (timeout=%ss)", timeout)
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
        Send an SMS message.

        Outbound provider selection:
        - If SMS_USE_PROVIDER_FACTORY=true (opt-in for now), delegate
          to services.sms.get_outbound_provider() which respects
          SMS_PROVIDER=twilio|clicksend|cellcast. This is how Steve
          swaps to ClickSend/Cellcast — set the env vars, flip
          SMS_PROVIDER, redeploy. No code change.
        - Otherwise the legacy Twilio code path runs (current default,
          lowest risk). Once we've shaken down the factory in staging,
          this opt-in flips to default-on.

        Args:
            to: Recipient phone number
            body: Message body

        Returns:
            Message SID if successful, None otherwise
        """
        # BENCH WALL, in the one place every send has to pass through.
        #
        # There was already a wall like this, but it sat at ONE call site
        # (the ready-SMS in consolidated_api_routes). Its own comment says
        # the point is that "the zero-real-SMS rule holds structurally,
        # whatever the caller forgot" -- which it cannot do from a call
        # site, because the next caller forgets again. Every other path
        # (pickup reminders, batch complete, broadcast, the SMS
        # conversation itself) reached Twilio unguarded.
        #
        # That matters because production runs in LIVE SMS mode. A load
        # test against production would otherwise attempt a real send per
        # simulated customer.
        #
        # +6140000xxxx is not an allocatable Australian mobile range, so
        # nothing here can ever be a real person.
        if str(to or '').startswith(BENCH_PHONE_PREFIX):
            logger.info("BENCH NUMBER %s - not sent: %s", to, body)
            return "bench_blocked"

        # Opt-in to the provider factory. Default off — preserves the
        # exact behaviour every production deploy has today.
        if os.getenv('SMS_USE_PROVIDER_FACTORY', 'false').lower() == 'true':
            try:
                from services.sms import get_outbound_provider
                provider = get_outbound_provider()
                result = provider.send(to, body)
                if result.ok:
                    logger.info("Sent SMS to %s via %s", to, result.provider)
                    return result.message_id
                logger.error("SMS via %s failed: %s", result.provider, result.error)
                return None
            except Exception as e:
                logger.error(
                    "SMS provider factory crashed: %s — falling back to legacy Twilio path",
                    e,
                )
                # Fall through to legacy below.

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
        order_details = None
        try:
            from flask import current_app
            if hasattr(current_app, 'config'):
                coffee_system = current_app.config.get('coffee_system')
                if coffee_system:
                    order = coffee_system.get_order_by_number(order_number)
                    if order and 'order_details' in order:
                        details = order['order_details']
                        order_details = details
                        if 'type' in details:
                            coffee_type = details['type']
        except:
            pass

        # EventsAir push (alongside SMS): if this order came from the
        # EventsAir app, also push the "ready" status to the attendee's
        # EA device. Best-effort — never blocks the SMS or the order.
        try:
            self._maybe_push_eventsair(order_details, order_number, station_id, coffee_type)
        except Exception as ea_err:
            logger.warning(f"EventsAir push (ready) failed, non-fatal: {ea_err}")

        # Plain ASCII on purpose. The bell and cup emoji forced this into
        # UCS-2, which caps a segment at 70 characters instead of 160 - so
        # this message cost TWO segments where one would do, on every
        # ready-notification of every event.
        message = (
            f"YOUR COFFEE IS READY!\n\n"
            f"Your {coffee_type} (order #{order_number}){friend_text} is now ready "
            f"for collection from {self._station_label(station_id)}.\n\n"
            f"Enjoy!"
        )

        # Optional branded receipt link. Only appended when PUBLIC_BASE_URL
        # is configured — background reminder threads have no request
        # context to derive a host, and a localhost link is useless to a
        # customer. Adds one short line; for corporate/VIP events the
        # customer can Save-as-PDF for reimbursement.
        receipt_link = self._receipt_link(order_number)
        if receipt_link:
            message += f"\n\nReceipt: {receipt_link}"

        # Send the message
        return self.send_message(to, message)

    @staticmethod
    def _maybe_push_eventsair(order_details, order_number, station_id, coffee_type):
        """If the order originated from EventsAir AND the integration is
        enabled, push a 'ready' notification to the attendee's EA device.

        order_details carries eventsair_contact_id (stamped by the
        inbound order endpoint). No-op when the order isn't from EA, the
        integration is off, or there's no contact id. Currently the EA
        client is stubbed (logs) until a real API key exists.
        """
        if not isinstance(order_details, dict):
            return
        if (order_details.get('source') != 'eventsair'
                and not order_details.get('eventsair_contact_id')):
            return
        contact_id = order_details.get('eventsair_contact_id')
        if not contact_id:
            return
        try:
            from flask import current_app
            coffee_system = current_app.config.get('coffee_system')
            if not coffee_system:
                return
            from services.eventsair import get_client, is_enabled
            if not is_enabled(coffee_system.db):
                return
            client = get_client(coffee_system.db)
            client.push_notification(
                str(contact_id),
                title='Your coffee is ready ☕',
                body=f"Order #{order_number} ({coffee_type}) is ready at Station {station_id}.",
            )
        except Exception as e:
            logger.warning(f"EventsAir push_notification error (non-fatal): {e}")

    @staticmethod
    def _receipt_link(order_number):
        """Build the public receipt URL if PUBLIC_BASE_URL is set, else ''.

        PUBLIC_BASE_URL should be the externally-reachable origin
        (https://coffee-cue.up.railway.app or the ngrok URL), no
        trailing slash required.
        """
        base = (os.getenv('PUBLIC_BASE_URL', '') or '').strip().rstrip('/')
        if not base:
            return ''
        return f"{base}/api/orders/{order_number}/receipt"
    
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
        
        # Same reasoning as the ready message: ASCII keeps it to one segment.
        message = (
            f"REMINDER: Your {coffee_type} (order #{order_number}) has been ready "
            f"for {wait_time} minutes.\n\n"
            f"Please collect it from {self._station_label(station_id)} soon!"
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