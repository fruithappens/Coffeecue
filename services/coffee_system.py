"""
Enhanced Coffee Ordering System with improved SMS conversation handling
"""
import logging
import json
import re
import random
import os
import time
from datetime import datetime, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor
import sqlite3

from models.orders import Order, CustomerPreference
from models.stations import Station
from services.nlp import NLPService

logger = logging.getLogger("expresso.services.coffee_system")

class CoffeeOrderSystem:
    """Main service class for Coffee Ordering System"""
    
    def __init__(self, db, config):
        """
        Initialize the coffee ordering system
        
        Args:
            db: Database connection
            config: Configuration dictionary
        """
        self.db = db
        self.config = config
        self.nlp = NLPService()
        self.event_name = config.get('EVENT_NAME', 'ANZCA ASM 2025 Cairns')
        
        # Initialize conversation states dictionary
        self.conversation_states = {}
        
        # Initialize settings cache
        self.settings_cache = {}
        
        # Load sponsor information
        self._load_sponsor_info()
        
        # Initialize station information
        self._init_stations()
        
        # Initialize default stations
        self._initialize_stations()
        
        # Initialize default settings if they don't exist
        self._init_settings()
        
        logger.info("Coffee Order System initialized")
    
    def _load_sponsor_info(self):
        """Load sponsor information from database"""
        try:
            cursor = self.db.cursor()
            
            # Get sponsor settings
            cursor.execute("SELECT key, value FROM settings WHERE key IN ('sponsor_display_enabled', 'sponsor_name', 'sponsor_message')")
            settings = cursor.fetchall()
            
            sponsor_info = {}
            for key, value in settings:
                if key == 'sponsor_display_enabled':
                    sponsor_info['enabled'] = value.lower() in ('true', 'yes', '1', 't', 'y')
                elif key == 'sponsor_name':
                    sponsor_info['name'] = value
                elif key == 'sponsor_message':
                    sponsor_info['message'] = value
            
            # Format message if needed
            if sponsor_info.get('enabled', False) and sponsor_info.get('name') and '{sponsor}' in sponsor_info.get('message', ''):
                sponsor_info['message'] = sponsor_info['message'].replace('{sponsor}', sponsor_info['name'])
            
            self.sponsor_info = sponsor_info
        except Exception as e:
            logger.error(f"Error loading sponsor info: {str(e)}")
            self.sponsor_info = {'enabled': False}
    
    def _initialize_stations(self):
        """Check if any stations exist, log warning if none found"""
        try:
            cursor = self.db.cursor()
            
            # Just check if we have any stations
            cursor.execute("SELECT COUNT(*) FROM station_stats")
            station_count = cursor.fetchone()[0]
            
            if station_count == 0:
                logger.warning("No stations found in database. Please create stations through the Organizer interface.")
            else:
                logger.info(f"Found {station_count} stations in database")
            
        except Exception as e:
            logger.error(f"Error checking stations: {str(e)}")
    
    def _init_settings(self):
        """Initialize default system settings"""
        try:
            cursor = self.db.cursor()
            
            # Create settings table if needed
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Define default settings
            default_settings = [
                ('sms_welcome_message', f"Welcome to {self.event_name}! I'll take your coffee order. What's your first name?", 
                 'Welcome message for SMS conversations'),
                ('enable_web_tracking', 'false', 'Enable web tracking URLs for orders'),
                ('web_tracking_url', 'https://coffee.example.com/order/', 'Base URL for order tracking web page'),
                ('default_wait_time', '10', 'Default wait time in minutes for new orders'),
                ('show_friend_orders', 'true', 'Show related friend orders in status updates'),
                ('max_group_size', '5', 'Maximum number of orders in a group'),
                ('short_url_service', 'false', 'Enable short URL generation for tracking links')
            ]
            
            # Insert default settings if they don't exist
            for key, value, description in default_settings:
                cursor.execute("SELECT key FROM settings WHERE key = %s", (key,))
                if not cursor.fetchone():
                    cursor.execute("""
                        INSERT INTO settings (key, value, description) 
                        VALUES (%s, %s, %s)
                    """, (key, value, description))
                    logger.info(f"Created default setting: {key}")
            
            self.db.commit()
            
            # Clear and reload settings cache
            self.settings_cache = {}
            
        except Exception as e:
            logger.error(f"Error initializing settings: {str(e)}")
    
    def _init_stations(self):
        """Initialize coffee stations and event scheduling"""
        try:
            num_stations = self.config.get('NUM_STATIONS', 3)
            
            # Initialize stations in the database
            Station.initialize_stations(self.db, num_stations)
            
            # Initialize event breaks and scheduling
            self._init_event_scheduling()
            
            logger.info(f"Initialized {num_stations} coffee stations with scheduling")
        except Exception as e:
            logger.error(f"Error initializing stations: {str(e)}")
    
    def _init_event_scheduling(self):
        """Initialize event scheduling tables and data"""
        try:
            cursor = self.db.cursor()
            
            # Create event_breaks table if it doesn't exist
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS event_breaks (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(100) NOT NULL,
                    day_of_week INTEGER NOT NULL,
                    start_time TIME NOT NULL,
                    end_time TIME NOT NULL,
                    stations JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Check if we have any breaks defined
            cursor.execute("SELECT COUNT(*) FROM event_breaks")
            count = cursor.fetchone()[0]
            
            if count == 0:
                # Insert some default breaks for demonstration
                default_breaks = [
                    ('Morning Coffee', 0, '08:30', '10:00', json.dumps([1, 2, 3])),  # Monday morning
                    ('Morning Break', 0, '10:30', '11:30', json.dumps([1, 2])),      # Monday morning break
                    ('Lunch Break', 0, '12:30', '14:00', json.dumps([1, 2, 3])),     # Monday lunch
                    ('Afternoon Break', 0, '15:30', '16:30', json.dumps([2, 3])),    # Monday afternoon
                    ('Morning Coffee', 1, '08:30', '10:00', json.dumps([1, 2, 3])),  # Tuesday morning
                    ('Morning Break', 1, '10:30', '11:30', json.dumps([1, 2])),      # Tuesday morning break
                    ('Lunch Break', 1, '12:30', '14:00', json.dumps([1, 2, 3])),     # Tuesday lunch
                    ('Afternoon Break', 1, '15:30', '16:30', json.dumps([2, 3]))     # Tuesday afternoon
                ]
                
                for title, day, start, end, stations in default_breaks:
                    cursor.execute("""
                        INSERT INTO event_breaks (title, day_of_week, start_time, end_time, stations)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (title, day, start, end, stations))
                
                self.db.commit()
                logger.info("Created default event breaks schedule")
            
            # Update station_stats table to include capabilities field if needed
            cursor.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='station_stats' AND column_name='capabilities'
            """)
            
            if cursor.fetchone() is None:
                # Add capabilities field to station_stats
                cursor.execute("""
                    ALTER TABLE station_stats 
                    ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}',
                    ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10
                """)
                
                # Update defaults for existing stations
                cursor.execute("""
                    UPDATE station_stats
                    SET capabilities = json_build_object(
                        'alt_milk', TRUE,
                        'high_volume', station_id = 1,  -- Make station 1 high volume by default
                        'vip_service', station_id = 3   -- Make station 3 VIP service by default
                    )
                    WHERE capabilities IS NULL OR capabilities = '{}'
                """)
                
                self.db.commit()
                logger.info("Updated station stats with capabilities information")
            
        except Exception as e:
            logger.error(f"Error initializing event scheduling: {str(e)}")
    
    def get_sponsor_info(self):
        """Get sponsor information for public display"""
        if not self.sponsor_info.get('enabled', False):
            return None
        
        return {
            'name': self.sponsor_info.get('name', ''),
            'message': self.sponsor_info.get('message', '')
        }

    def handle_sms(self, phone_number, message_body, messaging_service, metadata=None):
        """
        Process incoming SMS and generate appropriate response
        
        Args:
            phone_number: Sender's phone number
            message_body: SMS message content
            messaging_service: MessagingService instance
            metadata: Additional metadata (e.g., sender name)
            
        Returns:
            Response message to send back
        """
        # Normalize phone number
        phone = self._normalize_phone(phone_number)
        
        # Log incoming message
        logger.info(f"SMS received from {phone}: {message_body}")
        
        # Check for station mentions in the message
        station_id = None
        station_pattern = r'(?:for\s+)?(?:station|st)[^0-9]*([0-9]+)'
        station_match = re.search(station_pattern, message_body.lower())
        if station_match:
            try:
                station_id = int(station_match.group(1))
                logger.info(f"Detected station {station_id} in SMS message")
            except (ValueError, TypeError):
                logger.warning(f"Invalid station number format detected in message")
        
        # Get current conversation state for this number
        state = self._get_conversation_state(phone)
        
        # Check for station ID in metadata as well
        if metadata and 'station_id' in metadata:
            station_id_from_metadata = metadata['station_id']
            logger.info(f"Station ID {station_id_from_metadata} found in metadata")
            if not station_id:  # Only use metadata if not already detected in message
                station_id = station_id_from_metadata
        
        # Add station ID to conversation state if detected
        if station_id and state.get('temp_data'):
            if not state['temp_data'].get('order_details'):
                state['temp_data']['order_details'] = {}
            # Add station ID in all possible formats for maximum compatibility
            state['temp_data']['order_details']['station_id'] = station_id
            state['temp_data']['order_details']['stationId'] = station_id
            state['temp_data']['order_details']['assigned_to_station'] = station_id
            state['temp_data']['order_details']['assignedStation'] = station_id
            state['temp_data']['order_details']['barista_station'] = station_id
            # Update state
            self._set_conversation_state(phone, state.get('state'), state.get('temp_data'))
            logger.info(f"Added station_id={station_id} to conversation state for {phone}")
        
        # Check if this is a greeting or help command
        if self._is_greeting_or_help(message_body):
            return self._handle_greeting(phone, message_body, state)
        
        # Check for special commands like STATUS, CANCEL, etc.
        command_response = self._handle_commands(phone, message_body, state)
        if command_response:
            return command_response
        
        # Process based on current conversation state
        if state.get('state') == 'awaiting_name':
            return self._handle_awaiting_name(phone, message_body, state)
        elif state.get('state') == 'awaiting_coffee_type':
            return self._handle_awaiting_coffee_type(phone, message_body, state)
        elif state.get('state') == 'awaiting_milk':
            return self._handle_awaiting_milk(phone, message_body, state)
        elif state.get('state') == 'awaiting_size':
            return self._handle_awaiting_size(phone, message_body, state)
        elif state.get('state') == 'awaiting_sugar':
            return self._handle_awaiting_sugar(phone, message_body, state)
        elif state.get('state') == 'awaiting_confirmation':
            return self._handle_awaiting_confirmation(phone, message_body, state)
        # Group/friend ordering states
        elif state.get('state') == 'awaiting_friend_name':
            return self._handle_awaiting_friend_name(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_suggestion_response':
            return self._handle_awaiting_friend_suggestion_response(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_coffee_type':
            return self._handle_awaiting_friend_coffee_type(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_milk':
            return self._handle_awaiting_friend_milk(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_size':
            return self._handle_awaiting_friend_size(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_sugar':
            return self._handle_awaiting_friend_sugar(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_confirmation':
            return self._handle_awaiting_friend_confirmation(phone, message_body, state)
        elif state.get('state') == 'awaiting_friend_decision':
            return self._handle_awaiting_friend_decision(phone, message_body, state)
        elif state.get('state') == 'awaiting_deletion_confirmation':
            return self._handle_awaiting_deletion_confirmation(phone, message_body, state)
        elif state.get('state') == 'completed':
            # This is a new order after completing the previous one
            return self._restart_conversation(phone, message_body)
        
        # If no state or unknown state, start from beginning
        return self._restart_conversation(phone, message_body)
    
    def _is_greeting_or_help(self, message):
        """Check if message is a greeting or help request"""
        message_lower = message.lower().strip()
        
        # Check for common greetings
        if self.nlp.is_greeting(message_lower):
            return True
        
        # Check for help commands
        help_commands = ['help', 'info', 'menu', 'how', 'instructions', '?']
        return any(cmd == message_lower or message_lower.startswith(cmd + ' ') for cmd in help_commands)
    
    def _handle_greeting(self, phone, message, state):
        """Handle greeting messages or help requests"""
        # Get customer info
        customer = self.get_customer(phone)
        
        if customer and customer.get('name'):
            # Welcome back returning customer
            name = customer.get('name')
            
            usual_suggestions = self._get_usual_order_suggestion(phone, name)
            if usual_suggestions:
                # Start a new conversation state with suggestion context
                self._set_conversation_state(phone, 'awaiting_coffee_type', {
                    'name': name,
                    'suggestion_context': 'usual_order'  # Mark that we've suggested their usual order
                })
                return f"Welcome back, {name}! {usual_suggestions}"
            else:
                # Start a new conversation state without suggestion context
                self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                return f"Welcome back, {name}! What type of coffee would you like today?"
        else:
            # New customer - ask for name
            self._set_conversation_state(phone, 'awaiting_name')
            
            # Get welcome message from settings or use default if not available
            welcome_message = self._get_setting('sms_welcome_message', f"Welcome to {{event_name}}! ☕\nWhat's your first name?")
            # Replace event_name placeholder with actual event name
            return welcome_message.replace('{event_name}', self.event_name)
    
    def _get_usual_order_suggestion(self, phone, name):
        """Get usual order suggestions based on previous orders"""
        try:
            # Check for customer preferences
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar FROM customer_preferences WHERE phone = %s",
                (phone,)
            )
            result = cursor.fetchone()
            
            if result and result[0]:
                drink, milk, size, sugar = result
                
                # Build a suggestion message
                if all([drink, milk, size]):
                    sugar_text = f", {sugar}" if sugar else ""
                    return f"What type of coffee would you like today? Your usual {drink} or perhaps a {size} {drink} with {milk} milk{sugar_text}, which you often enjoy around this time?"
            
            # If no preferences, check previous orders
            cursor.execute("""
                SELECT o.order_details
                FROM orders o
                WHERE o.phone = %s
                ORDER BY o.created_at DESC
                LIMIT 5
            """, (phone,))
            
            recent_orders = cursor.fetchall()
            if recent_orders:
                # Process recent orders
                order_types = []
                for order_data in recent_orders:
                    if order_data[0]:
                        try:
                            details = json.loads(order_data[0]) if isinstance(order_data[0], str) else order_data[0]
                            if 'type' in details:
                                order_types.append(details['type'])
                        except (json.JSONDecodeError, TypeError):
                            continue
                
                # Count occurrences
                if order_types:
                    # Get top 2 most common
                    counter = {}
                    for ot in order_types:
                        counter[ot] = counter.get(ot, 0) + 1
                    
                    most_common = sorted(counter.items(), key=lambda x: x[1], reverse=True)[:2]
                    
                    if len(most_common) == 1:
                        return f"What type of coffee would you like today? Your usual {most_common[0][0]}?"
                    elif len(most_common) == 2:
                        return f"What type of coffee would you like today? Your usual {most_common[0][0]} or perhaps a {most_common[1][0]}?"
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting usual order suggestions: {str(e)}")
            return None
    
    def _handle_commands(self, phone, message, state):
        """Handle special commands like STATUS, CANCEL, INFO, etc."""
        message_upper = message.upper().strip()
        
        # Check for status command
        if message_upper == 'STATUS':
            return self._handle_status_command(phone)
        
        # Check for cancel command (both versions, regular and the special one to avoid Twilio collision)
        elif message_upper == 'CANCEL' or message_upper == 'CANCELORDER':
            return self._handle_cancel_command(phone)
        
        # Check for help/info command (avoiding HELP due to Twilio opt-out)
        elif message_upper == 'INFO' or message_upper == '?':
            return self._handle_help_command()
        
        # Check for options/menu command
        elif message_upper == 'OPTIONS' or message_upper == 'MENU' or message_upper == 'COMMANDS':
            return self._handle_options_menu_command()
        
        # Check for USUAL command to order the usual
        elif message_upper == 'USUAL':
            # Get customer name
            customer = self.get_customer(phone)
            name = customer.get('name', '') if customer else ''
            return self._process_usual_order(phone, name)
        
        # Check for FRIEND command to add a friend order
        elif message_upper == 'FRIEND':
            return self._handle_friend_command(phone, state)
        
        # Check for VIP code
        elif self._is_vip_code(message_upper):
            return self._handle_vip_code(phone, message_upper)
        
        # Privacy commands
        elif message_upper == 'MYDATA':
            return self._handle_mydata_command(phone)
        
        elif message_upper.startswith('CHANGENAME '):
            new_name = message[11:].strip()  # Get everything after "CHANGENAME "
            return self._handle_changename_command(phone, new_name)
        
        elif message_upper == 'RESET':
            return self._handle_reset_command(phone)
        
        elif message_upper in ['DELETE', 'FORGET ME', 'STOP']:
            return self._handle_delete_command(phone, state)
        
        # No special command detected
        return None
    
    def _handle_status_command(self, phone):
        """Handle STATUS command - check order status"""
        try:
            # For logging
            logger.info(f"Handling STATUS command for phone: {phone}")
            
            # Get most recent pending or in-progress order
            cursor = self.db.cursor()
            
            # Log the query we'll execute
            status_query = """
                SELECT id, order_number, status, created_at, station_id, order_details
                FROM orders 
                WHERE phone = %s AND status IN ('pending', 'in-progress', 'completed') 
                ORDER BY created_at DESC 
                LIMIT 1
            """
            logger.info(f"Executing status query with phone: {phone}")
            
            cursor.execute(status_query, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                logger.info(f"No active orders found for phone: {phone}")
                return "You don't have any active orders. Text us your coffee order to get started!"
            
            logger.info(f"Found order for phone: {phone}")
            order_id, order_number, status, created_at, station_id, order_details_json = result
            
            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}
                
            # Get customer name
            name = order_details.get('name', 'Customer')
            
            # Format coffee order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            # Calculate wait time
            current_time = datetime.now()
            wait_time_minutes = int((current_time - created_at).total_seconds() / 60)
            
            # Check for any friend/group orders linked to this order
            friend_orders = []
            try:
                cursor.execute("""
                    SELECT order_number, order_details
                    FROM orders 
                    WHERE related_to_order_id = %s OR reference_number = %s
                    ORDER BY created_at ASC
                """, (order_id, order_number))
                
                for friend_result in cursor.fetchall():
                    friend_order_number, friend_details_json = friend_result
                    
                    if isinstance(friend_details_json, str):
                        friend_details = json.loads(friend_details_json)
                    else:
                        friend_details = friend_details_json or {}
                        
                    friend_name = friend_details.get('name', 'Friend')
                    friend_summary = self.nlp.format_order_summary(friend_details)
                    friend_orders.append(f"#{friend_order_number} for {friend_name}: {friend_summary}")
            except Exception as friend_err:
                logger.error(f"Error getting friend orders: {str(friend_err)}")
                # Continue without friend orders - not critical
            
            # Build the status response
            status_messages = {
                'pending': f"Your order #{order_number} ({order_summary}) is pending at Station {station_id}. You've been waiting {wait_time_minutes} minutes.",
                'in-progress': f"Your order #{order_number} ({order_summary}) is being made at Station {station_id}. You've been waiting {wait_time_minutes} minutes.",
                'completed': f"Your order #{order_number} ({order_summary}) is ready for pickup at Station {station_id}!"
            }
            
            response = status_messages.get(status, f"Your order #{order_number} ({order_summary}) is {status} at Station {station_id}.")
            
            # Add estimated time for pending orders
            if status == 'pending':
                # Get station estimated wait time
                cursor.execute("SELECT wait_time FROM station_stats WHERE station_id = %s", (station_id,))
                station_result = cursor.fetchone()
                
                if station_result:
                    estimated_wait = station_result[0]
                else:
                    estimated_wait = 15  # Default
                
                time_left = max(0, estimated_wait - wait_time_minutes)
                response += f" Estimated completion in {time_left} more minutes."
            
            # Add linked order info if any
            if friend_orders:
                response += "\n\nRelated orders:\n" + "\n".join(friend_orders)
                
            # Add URL for web tracking if enabled
            if self._get_setting('enable_web_tracking', 'false').lower() in ('true', 'yes', '1'):
                base_url = self._get_setting('web_tracking_url', 'https://coffee.example.com/track/')
                tracking_url = f"{base_url}?id={order_number}"
                response += f"\n\nTrack your order here: {tracking_url}"
            
            return response
            
        except Exception as e:
            logger.error(f"Error processing STATUS command: {str(e)}")
            return "Sorry, we couldn't retrieve your order status. Please try again later."
    
    def _handle_cancel_command(self, phone):
        """Handle CANCEL command - cancel the most recent order"""
        try:
            # Get most recent pending order
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, station_id
                FROM orders 
                WHERE phone = %s AND status = 'pending' 
                ORDER BY created_at DESC 
                LIMIT 1
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return "You don't have any pending orders to cancel."
            
            order_id, order_number, station_id = result
            
            # Update order status to cancelled
            cursor.execute("""
                UPDATE orders 
                SET status = 'cancelled', updated_at = %s 
                WHERE id = %s
            """, (datetime.now(), order_id))
            
            # Update station load
            cursor.execute("""
                UPDATE station_stats
                SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                WHERE station_id = %s
            """, (datetime.now(), station_id))
            
            self.db.commit()
            
            # Reset conversation state
            self._set_conversation_state(phone, 'completed')
            
            return f"Your order #{order_number} has been cancelled. Text us when you'd like to place a new order."
            
        except Exception as e:
            logger.error(f"Error cancelling order: {str(e)}")
            return "Sorry, we couldn't cancel your order. Please try again or contact the coffee station directly."
    
    def _handle_help_command(self):
        """Handle INFO command - provide instructions (avoiding HELP as Twilio uses it for opt-out)"""
        return (
            "Coffee Ordering Instructions:\n"
            "- Text your coffee order (e.g., 'large latte with oat milk')\n"
            "- STATUS: Check your order status\n"
            "- FRIEND: Add a coffee for a friend\n"
            "- CANCEL: Cancel your pending order\n"
            "- MENU: See available coffee options\n"
            "- USUAL: Order your usual coffee\n"
            "- OPTIONS: See all available commands\n"
            "Need more help? Visit the help desk or any coffee station."
        )
    
    def _handle_options_command(self):
        """Handle OPTIONS command - list all available commands"""
        return (
            "Available Commands:\n"
            "☕ Ordering:\n"
            "- STATUS: Check order status\n"
            "- FRIEND: Add coffee for a friend\n"
            "- CANCEL: Cancel pending order\n"
            "- MENU: See coffee options\n"
            "- USUAL: Order your usual\n"
            "\n🔐 Privacy:\n"
            "- MYDATA: View your info\n"
            "- CHANGENAME [name]: Update name\n"
            "- RESET: Clear preferences\n"
            "- DELETE: Remove all data"
        )
    
    def _handle_options_menu_command(self):
        """Handle OPTIONS/MENU command - show dynamic coffee menu based on station capabilities"""
        try:
            cursor = self.db.cursor()
            
            # Get active stations and their capabilities
            cursor.execute("""
                SELECT id, name, capabilities, current_status
                FROM stations
                WHERE current_status IN ('active', 'open')
            """)
            active_stations = cursor.fetchall()
            
            if not active_stations:
                return "☕ Sorry, no coffee stations are currently open. Please check back later."
            
            # Collect all available options across all stations
            all_coffee_types = set()
            all_milk_types = set()
            milk_station_map = {}  # Track which stations have which milk
            
            for station_id, station_name, capabilities, status in active_stations:
                if capabilities:
                    try:
                        import json
                        cap_data = json.loads(capabilities) if isinstance(capabilities, str) else capabilities
                        
                        # Add coffee types
                        coffee_types = cap_data.get('coffee_types', [])
                        all_coffee_types.update(coffee_types)
                        
                        # Add milk types and track which stations have them
                        milk_types = cap_data.get('milk_types', [])
                        for milk in milk_types:
                            all_milk_types.add(milk)
                            if milk not in milk_station_map:
                                milk_station_map[milk] = []
                            milk_station_map[milk].append((station_id, station_name))
                            
                    except (json.JSONDecodeError, TypeError) as e:
                        logger.error(f"Error parsing station {station_id} capabilities: {str(e)}")
            
            # Check event-specific settings
            cursor.execute("SELECT value FROM settings WHERE key = 'available_coffee_types'")
            event_coffee_setting = cursor.fetchone()
            if event_coffee_setting:
                try:
                    import json
                    event_coffees = json.loads(event_coffee_setting[0]) if event_coffee_setting[0] else []
                    # Filter to only include coffee types that are both in event settings AND station capabilities
                    all_coffee_types = all_coffee_types.intersection(event_coffees) if event_coffees else all_coffee_types
                except:
                    pass
            
            cursor.execute("SELECT value FROM settings WHERE key = 'available_milk_types'")
            event_milk_setting = cursor.fetchone()
            if event_milk_setting:
                try:
                    import json
                    event_milks = json.loads(event_milk_setting[0]) if event_milk_setting[0] else []
                    # Filter to only include milk types that are both in event settings AND station capabilities
                    all_milk_types = all_milk_types.intersection(event_milks) if event_milks else all_milk_types
                except:
                    pass
            
            # Build the menu message
            menu_parts = ["☕ Available Options:"]
            
            # Coffee types
            if all_coffee_types:
                coffee_list = sorted(list(all_coffee_types))
                menu_parts.append(f"Coffee: {', '.join(coffee_list)}")
            else:
                menu_parts.append("Coffee: Latte, Cappuccino, Flat White")
            
            # Milk types with availability info
            if all_milk_types:
                milk_info = []
                for milk in sorted(list(all_milk_types)):
                    if milk in milk_station_map:
                        stations_with_milk = milk_station_map[milk]
                        if len(stations_with_milk) == 1:
                            # Only one station has this milk
                            station_id, station_name = stations_with_milk[0]
                            milk_info.append(f"{milk} (Station {station_id} only)")
                        else:
                            milk_info.append(milk)
                menu_parts.append(f"🥛 Milk: {', '.join(milk_info)}")
            else:
                menu_parts.append("🥛 Milk: Full Cream, Skim")
            
            # Standard options
            menu_parts.append("🍯 Sugar: None, 1, 2, 3+")
            menu_parts.append("📏 Size: Small, Medium, Large")
            
            # Add note about specialty milk
            specialty_milks = [milk for milk in all_milk_types if milk in milk_station_map and len(milk_station_map[milk]) == 1]
            if specialty_milks:
                menu_parts.append(f"\n💡 Note: {', '.join(specialty_milks)} available at specific stations only")
            
            menu_parts.append("\nReply with your choice (e.g., \"large oat latte 1 sugar\")")
            
            return '\n'.join(menu_parts)
            
        except Exception as e:
            logger.error(f"Error building dynamic menu: {str(e)}")
            # Fallback to simple menu
            return (
                "☕ Coffee: Latte, Cappuccino, Flat White, Long Black, Espresso\n"
                "🥛 Milk: Full Cream, Skim, Soy, Almond, Oat\n"
                "🍯 Sugar: None, 1, 2, 3+\n"
                "📏 Size: Small, Medium, Large\n\n"
                "Reply with your choice (e.g., \"large oat latte 1 sugar\")"
            )
    
    def _handle_menu_command(self):
        """Handle MENU command - show coffee options"""
        try:
            # Get available menu items from inventory
            cursor = self.db.cursor()
            
            # Check if inventory_items table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'inventory_items'
                )
            """)
            
            has_inventory_table = cursor.fetchone()[0]
            
            if has_inventory_table:
                # Get available drink types based on ingredient availability
                coffee_types = self._get_available_coffee_types()
                
                # Get milk types from inventory with stock validation
                cursor.execute("""
                    SELECT name FROM inventory_items 
                    WHERE category = 'milk' 
                    AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                    ORDER BY name
                """)
                milk_types = [row[0] for row in cursor.fetchall()]
                
                # Use dynamic data if available
                if coffee_types and milk_types:
                    return (
                        "Coffee Menu:\n"
                        f"Types: {', '.join(coffee_types)}\n"
                        f"Milk: {', '.join(milk_types)}\n"
                        "Size: Small, Medium, Large\n"
                        "Extras: Extra Shot, Decaf, Extra Hot\n"
                        "Simply text your order, e.g. 'Large cappuccino with soy milk'"
                    )
        except Exception as e:
            logger.error(f"Error fetching menu items: {str(e)}")
            
        # Fallback to static menu if database query fails
        return (
            "Coffee Menu:\n"
            "Types: Latte, Cappuccino, Flat White, Long Black, Espresso, Mocha, Hot Chocolate, Chai Latte\n"
            "Milk: Full Cream, Skim, Soy, Almond, Oat, Lactose Free\n"
            "Size: Small, Medium, Large\n"
            "Extras: Extra Shot, Decaf, Extra Hot\n"
            "Simply text your order, e.g. 'Large cappuccino with soy milk'"
        )
    
    def _is_vip_code(self, code):
        """Check if this is a valid VIP code"""
        try:
            # First check for default VIP code
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            result = cursor.fetchone()
            
            if result and (code == result[0] or code == 'VIP'):
                return True
                
            # Next check for custom VIP codes from vip_codes setting
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_codes'")
            result = cursor.fetchone()
            
            if result:
                try:
                    # Value should be a JSON array of objects with code and enabled properties
                    import json
                    vip_codes = json.loads(result[0])
                    
                    if isinstance(vip_codes, list):
                        # Check if the provided code matches any enabled VIP code
                        for vip_code_entry in vip_codes:
                            if (vip_code_entry.get('enabled', True) and 
                                vip_code_entry.get('code') and 
                                code.upper() == vip_code_entry['code'].upper()):
                                logger.info(f"Matched custom VIP code: {code}")
                                return True
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.error(f"Error parsing VIP codes: {str(e)}")
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking VIP code: {str(e)}")
            return False
    
    def _handle_vip_code(self, phone, code):
        """Handle VIP code entry"""
        try:
            # Mark this customer as VIP in their preferences
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT phone FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            if result:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences 
                    SET is_vip = TRUE 
                    WHERE phone = %s
                """, (phone,))
            else:
                # Create new customer record
                cursor.execute("""
                    INSERT INTO customer_preferences 
                    (phone, is_vip, first_order_date, last_order_date) 
                    VALUES (%s, TRUE, %s, %s)
                """, (phone, datetime.now(), datetime.now()))
            
            self.db.commit()
            
            # Get customer name
            customer = self.get_customer(phone)
            name = customer.get('name', '')
            name_greeting = f", {name}" if name else ""
            
            # Update conversation state
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'vip': True})
            
            return f"VIP status activated{name_greeting}! Your orders will now be prioritized. What would you like to order?"
            
        except Exception as e:
            logger.error(f"Error processing VIP code: {str(e)}")
            return "Sorry, we couldn't process your VIP code. Please try again or contact the help desk."
    
    def _handle_awaiting_name(self, phone, message, state):
        """Handle name input during conversation"""
        # Extract name from message
        name = message.strip()
        
        # Basic validation
        if len(name) < 2 or len(name) > 50:
            return "Please enter a valid name (2-50 characters)."
        
        # Check if this is a usual order
        if self.nlp.is_asking_for_usual(message):
            # Update state before processing
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return self._process_usual_order(phone, name)
        
        # Get customer info to check if they have a usual order
        customer = self.get_customer(phone)
        
        if customer and self._has_usual_order(phone):
            # Suggest usual order if they have one
            usual_order = self._get_usual_order_details(phone)
            if usual_order:
                coffee_type = usual_order.get('type', 'coffee')
                milk = usual_order.get('milk', 'milk')
                size = usual_order.get('size', 'regular')
                
                # Save name and set suggestion context
                self._set_conversation_state(phone, 'awaiting_coffee_type', {
                    'name': name,
                    'suggestion_context': 'usual_order'  # Mark that we've suggested their usual order
                })
                
                return f"Nice to meet you, {name}! Would you like your usual {size} {coffee_type} with {milk}? Reply YES or tell me what you'd like."
        
        # For new customers or those without usual orders
        self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
        return f"Hi {name}! What are the details for your coffee?\n(e.g., \"cap 1 sugar skim\" or just \"latte\")\nDefault: medium, full cream, no sugar\nReply OPTIONS for full menu"
    
    def _has_usual_order(self, phone):
        """Check if customer has a usual order"""
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT preferred_drink, preferred_milk 
                FROM customer_preferences 
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result and result[0] and result[1]:
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking for usual order: {str(e)}")
            return False
    
    def _get_usual_order_details(self, phone):
        """Get the customer's usual order details"""
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar, preferred_notes
                FROM customer_preferences 
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if result:
                coffee_type, milk, size, sugar, notes = result
                
                # Only return if we have at least a coffee type
                if coffee_type:
                    order_details = {
                        'type': coffee_type,
                        'milk': milk or 'full cream',
                        'size': size or 'medium'
                    }
                    
                    if sugar:
                        order_details['sugar'] = sugar
                    
                    if notes:
                        order_details['notes'] = notes
                    
                    return order_details
            
            return None
            
        except Exception as e:
            logger.error(f"Error getting usual order: {str(e)}")
            return None
    
    def _process_usual_order(self, phone, name):
        """Process a request for the usual order"""
        # Get customer information if name not provided
        if not name:
            customer = self.get_customer(phone)
            name = customer.get('name', '') if customer else ''
            
            # If still no name, we need to ask for it
            if not name:
                self._set_conversation_state(phone, 'awaiting_name')
                return "I don't have your name yet. What's your first name?"
        
        # Get usual order
        usual_order = self._get_usual_order_details(phone)
        
        if usual_order:
            # Make sure the name is included in the order details
            usual_order['name'] = name
            
            # Update conversation state with usual order
            state_data = {
                'name': name,
                'order_details': usual_order,
                'order_type': 'usual'
            }
            self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
            
            # Format order summary
            coffee_type = usual_order.get('type', 'coffee')
            milk = usual_order.get('milk', 'milk')
            size = usual_order.get('size', 'medium')
            sugar = usual_order.get('sugar', 'no sugar')
            
            return (
                f"Great, {name}! Here's your usual order: {size} {coffee_type} with {milk}, {sugar}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        else:
            # No usual order found
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"You don't have a saved usual order yet. What type of coffee would you like, {name}?"
    
    def _get_available_coffee_types(self):
        """Get list of available coffee drink types based on ingredient availability"""
        try:
            cursor = self.db.cursor()
            
            # Check if we have coffee beans available
            cursor.execute("""
                SELECT COUNT(*) FROM inventory_items 
                WHERE category = 'coffee' 
                AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
            """)
            coffee_available = cursor.fetchone()[0] > 0
            
            # Standard drink menu - only return if we have coffee beans
            if coffee_available:
                drink_types = ["latte", "cappuccino", "flat white", "long black", "espresso", "mocha"]
                logger.info(f"Coffee beans available, offering drink types: {drink_types}")
                return drink_types
            else:
                logger.warning("No coffee beans in stock, cannot offer coffee drinks")
                return []
            
        except Exception as e:
            logger.error(f"Error checking coffee availability: {str(e)}")
            # Return basic menu if there's an error
            return ["latte", "cappuccino", "flat white", "long black", "espresso"]

    def _is_valid_coffee_type(self, requested_type, available_types):
        """Check if the requested coffee type is valid"""
        requested_type = requested_type.lower()
        
        # Direct match
        if requested_type in available_types:
            return True
        
        # Check for partial matches
        for coffee_type in available_types:
            if coffee_type in requested_type or requested_type in coffee_type:
                return True
        
        return False

    def _get_available_milk_types(self):
        """Get list of available milk types from inventory management"""
        try:
            cursor = self.db.cursor()
            # Use correct table name and check stock levels
            cursor.execute("""
                SELECT name FROM inventory_items 
                WHERE category = 'milk' 
                AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                ORDER BY name
            """)
            milk_types = [row[0].lower() for row in cursor.fetchall()]
            
            # If no milk types defined, return basic default list
            if not milk_types:
                logger.warning("No milk types found in inventory_items table, using defaults")
                return ["full cream", "skim"]
            
            logger.info(f"Available milk types: {milk_types}")
            return milk_types
        except Exception as e:
            logger.error(f"Error getting available milk types: {str(e)}")
            # Return basic default list if there's an error
            return ["full cream", "skim"]

    def _is_valid_milk_type(self, requested_milk, available_milks):
        """Check if the requested milk type is valid and in stock"""
        if not requested_milk:
            return True  # No milk requested is valid
        
        requested_milk = requested_milk.lower().replace(' milk', '').strip()
        
        # Direct match
        for available_milk in available_milks:
            available_clean = available_milk.lower().replace(' milk', '').strip()
            if requested_milk == available_clean:
                return True
            
            # Check for partial matches (e.g., "oat" matches "oat milk")
            if requested_milk in available_clean or available_clean in requested_milk:
                return True
        
        return False

    def _get_available_sweeteners(self):
        """Get list of available sweeteners from inventory management"""
        try:
            cursor = self.db.cursor()
            # Check for both 'sweetener' and 'sugar' categories
            cursor.execute("""
                SELECT name, category FROM inventory_items 
                WHERE category IN ('sweetener', 'sugar', 'artificial_sweetener') 
                AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                ORDER BY category, name
            """)
            sweeteners = [(row[0].lower(), row[1]) for row in cursor.fetchall()]
            
            # If no sweeteners defined, return basic defaults
            if not sweeteners:
                logger.warning("No sweeteners found in inventory_items table, using defaults")
                return [("sugar", "sugar"), ("no sugar", "sugar")]
            
            logger.info(f"Available sweeteners: {sweeteners}")
            return sweeteners
        except Exception as e:
            logger.error(f"Error getting available sweeteners: {str(e)}")
            # Return basic defaults if there's an error
            return [("sugar", "sugar"), ("no sugar", "sugar")]

    def _is_valid_sweetener(self, requested_sweetener, available_sweeteners):
        """Check if the requested sweetener is valid and properly categorized"""
        if not requested_sweetener:
            return True  # No sweetener requested is valid
        
        requested_sweetener = requested_sweetener.lower().strip()
        
        # Check against available sweeteners
        for sweetener_name, category in available_sweeteners:
            if requested_sweetener == sweetener_name:
                return True
            
            # Special handling for "Equal" - should be artificial sweetener, not sugar
            if requested_sweetener == "equal" and category == "sugar":
                logger.warning("Equal sweetener incorrectly categorized as sugar instead of artificial_sweetener")
                return False  # Reject if miscategorized
            
            # Check for partial matches
            if requested_sweetener in sweetener_name or sweetener_name in requested_sweetener:
                return True
        
        return False

    def _get_available_sizes(self, coffee_type):
        """Get available sizes for a specific coffee type"""
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT DISTINCT size FROM size_options 
                WHERE coffee_type = %s AND is_active = TRUE
                ORDER BY size
            """, (coffee_type,))
            sizes = [row[0].lower() for row in cursor.fetchall()]
            
            # If no sizes defined, return default list
            if not sizes:
                return ["small", "medium", "large"]
            
            return sizes
        except Exception as e:
            logger.error(f"Error getting available sizes: {str(e)}")
            # Return default list if there's an error
            return ["small", "medium", "large"]

    def _handle_awaiting_coffee_type(self, phone, message, state):
        """Handle coffee type input"""
        # Check if this is a usual order request
        if self.nlp.is_asking_for_usual(message):
            name = state.get('temp_data', {}).get('name', '')
            return self._process_usual_order(phone, name)
        
        # Check if this is an affirmative response to a suggestion of their usual order
        if self.nlp.is_affirmative_response(message):
            # Check if we previously suggested their usual order
            suggestion_context = state.get('temp_data', {}).get('suggestion_context')
            name = state.get('temp_data', {}).get('name', '')
            
            if suggestion_context == 'usual_order':
                # They've said "Yes" to our suggestion of their usual order
                return self._process_usual_order(phone, name)
        
        # Check available coffee types from the inventory
        available_coffee_types = self._get_available_coffee_types()
        
        # Parse message with NLP
        order_details = self.nlp.parse_order(message)
        coffee_type = order_details.get('type', '').lower()
        
        # Check if the requested coffee type is available
        if coffee_type and not self._is_valid_coffee_type(coffee_type, available_coffee_types):
            return f"Sorry, we don't offer {coffee_type}. Available options are: {', '.join(available_coffee_types)}. Please select one of these."
        
        # Validate milk type if specified
        milk_type = order_details.get('milk', '')
        if milk_type:
            available_milk_types = self._get_available_milk_types()
            if not self._is_valid_milk_type(milk_type, available_milk_types):
                return f"Sorry, we don't have {milk_type} milk. Available options are: {', '.join(available_milk_types)}. Please try again."
        
        # Validate sweetener if specified
        sweetener = order_details.get('sugar', '')
        if sweetener:
            available_sweeteners = self._get_available_sweeteners()
            if not self._is_valid_sweetener(sweetener, available_sweeteners):
                sweetener_names = [s[0] for s in available_sweeteners]
                return f"Sorry, we don't have {sweetener}. Available options are: {', '.join(sweetener_names)}. Please try again."
        
        # Get customer's name from state
        name = state.get('temp_data', {}).get('name', '')
        
        # If NLP found a complete order, we can skip to confirmation
        if len(order_details) >= 2 and 'type' in order_details:
            # Save order details to state
            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            return (
                f"Great! Here's your order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # If only coffee type was provided, ask for milk next
        if 'type' in order_details:
            # Save coffee type and continue conversation
            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_milk', state_data)
            
            # Check if this is a black coffee
            if self.nlp.is_black_coffee(order_details['type']):
                # Skip milk question for black coffee
                return self._handle_awaiting_milk(phone, "no milk", state)
            else:
                return f"What type of milk would you like with your {order_details['type']}? (full cream, skim, soy, almond, oat, etc.)"
        
        # If no coffee type found, prompt again
        return f"I'm not sure what type of coffee you'd like. Please specify a coffee type like latte, cappuccino, flat white, etc."
    
    def _handle_awaiting_milk(self, phone, message, state):
        """Handle milk type input"""
        # Get current order details from state
        order_details = state.get('temp_data', {}).get('order_details', {})
        name = state.get('temp_data', {}).get('name', '')
        
        # Parse milk preference
        if message.lower() == "no milk" or message.lower() == "black":
            milk_type = "no milk"
        else:
            # Use NLP to extract milk type
            new_details = self.nlp.parse_order(message)
            milk_type = new_details.get('milk', None)
        
        # If milk type was provided, update order details
        if milk_type:
            order_details['milk'] = milk_type
            
            # Update state and move to size
            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_size', state_data)
            
            return f"What size {order_details.get('type', 'coffee')} would you like? (small, medium, large)"
        else:
            # If no milk type was found, prompt again
            return "I didn't recognize that milk type. Please choose from: full cream, skim, soy, almond, oat, lactose free, or no milk."
    
    def _handle_awaiting_size(self, phone, message, state):
        """Handle size input"""
        # Get current order details from state
        order_details = state.get('temp_data', {}).get('order_details', {})
        name = state.get('temp_data', {}).get('name', '')
        
        # Get available sizes for this coffee type
        available_sizes = self._get_available_sizes(order_details.get('type', ''))
        
        # If only one size is available, automatically select it
        if len(available_sizes) == 1:
            order_details['size'] = available_sizes[0]
            
            # Update state and move to sugar
            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_sugar', state_data)
            
            return f"How much sugar would you like in your {order_details.get('type', 'coffee')}? (none, 1, 2, etc.)"
        
        # Use NLP to extract size
        new_details = self.nlp.parse_order(message)
        size = new_details.get('size')
        
        # Also check for simple size indicators
        if not size:
            message_lower = message.lower().strip()
            if message_lower in ['s', 'small', 'sm']:
                size = 'small'
            elif message_lower in ['m', 'medium', 'med', 'regular', 'standard']:
                size = 'medium'
            elif message_lower in ['l', 'large', 'lg', 'big']:
                size = 'large'
        
        # If size was provided, check if it's available and update order details
        if size:
            # Convert to lowercase for comparison
            size_lower = size.lower()
            available_sizes_lower = [s.lower() for s in available_sizes]
            
            # Check if requested size is available
            if size_lower in available_sizes_lower:
                # Use the case from the available_sizes list
                order_details['size'] = available_sizes[available_sizes_lower.index(size_lower)]
                
                # Update state and move to sugar
                state_data = {
                    'name': name,
                    'order_details': order_details
                }
                self._set_conversation_state(phone, 'awaiting_sugar', state_data)
                
                return f"How much sugar would you like in your {order_details.get('type', 'coffee')}? (none, 1, 2, etc.)"
            else:
                # If size is not available, show available options
                return f"Sorry, we don't offer size '{size}' for {order_details.get('type', 'coffee')}. Available sizes are: {', '.join(available_sizes)}. Please select one of these."
        else:
            # If no size was found, prompt again with available options
            return f"I didn't recognize that size. Please choose from: {', '.join(available_sizes)}."
    
    def _handle_awaiting_sugar(self, phone, message, state):
        """Handle sugar input"""
        # Get current order details from state
        order_details = state.get('temp_data', {}).get('order_details', {})
        name = state.get('temp_data', {}).get('name', '')
        
        # Check for usual order request again (sometimes users get confused)
        if self.nlp.is_asking_for_usual(message):
            return self._process_usual_order(phone, name)
        
        # Handle common "no sugar" responses
        message_lower = message.lower().strip()
        if message_lower in ['no', 'none', 'zero', '0', 'n', 'no sugar', 'without sugar']:
            sugar = 'no sugar'
        elif message_lower in ['1', 'one', 'one sugar', '1 sugar']:
            sugar = '1 sugar'
        elif message_lower in ['2', 'two', 'two sugar', '2 sugar']:
            sugar = '2 sugar'
        else:
            # Use NLP to extract sugar
            new_details = self.nlp.parse_order(message)
            sugar = new_details.get('sugar', 'no sugar')
        
        # Update order details
        order_details['sugar'] = sugar
        
        # Update state and move to confirmation
        state_data = {
            'name': name,
            'order_details': order_details
        }
        self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
        
        # Format order summary
        order_summary = self.nlp.format_order_summary(order_details)
        
        return (
            f"Great! Here's your order: {order_summary}\n"
            f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
        )
    
    def _handle_awaiting_confirmation(self, phone, message, state):
        """Handle order confirmation"""
        message_upper = message.upper().strip()
        
        # Get order details from state
        order_details = state.get('temp_data', {}).get('order_details', {})
        name = state.get('temp_data', {}).get('name', '')
        
        if message_upper == 'YES' or message_upper == 'Y':
            # Confirm the order
            order_response = self._confirm_order(phone, order_details, name)
            
            # Order is complete - end the conversation
            self._set_conversation_state(phone, 'completed')
            
            return (
                f"{order_response}\n\n"
                f"💡 Tip: You can add coffees for friends anytime by texting FRIEND"
            )
        
        elif message_upper == 'NO' or message_upper == 'N' or message_upper == 'CANCEL':
            # Cancel the order
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Order cancelled. What type of coffee would you like instead, {name}?"
        
        elif message_upper == 'EDIT' or message_upper == 'CHANGE':
            # Allow editing the order - go back to coffee type
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"Let's change that order. What type of coffee would you like, {name}?"
        
        elif message_upper == 'FRIEND' or message_upper == 'GROUP' or 'FRIEND' in message_upper:
            # Start an order for a friend - keep the same phone number but ask for friend's name
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': name,
                'primary_order': order_details,
                'group_orders': state.get('temp_data', {}).get('group_orders', []),
                'station_id': order_details.get('station_id')  # Keep same station for group orders
            })
            return "Great! Let's add a coffee for your friend. What's your friend's name?"
            
        elif message_upper == 'NO FRIEND' or message_upper == 'NO FRIENDS' or message_upper == 'DONE' or message_upper == 'FINISH':
            # User wants to end the conversation
            self._set_conversation_state(phone, 'completed')
            total_orders = 1  # Just this order
            return f"Thanks, {name}! Your order has been confirmed. It will be ready for pickup at Station {order_details.get('station_id', 1)}."
            
        else:
            # Unrecognized response - prompt again
            return "Please reply YES to confirm your order, NO to cancel, or EDIT to change it."
    
    def _handle_awaiting_friend_name(self, phone, message, state):
        """Handle friend name input during group ordering"""
        # Extract name from message
        friend_name = message.strip()
        
        # Basic validation
        if len(friend_name) < 2 or len(friend_name) > 50:
            return "Please enter a valid name for your friend (2-50 characters)."
        
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Check if we have a previous order for this friend
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
                FROM customer_preferences
                WHERE phone = %s AND name = %s
            """, (f"{phone}_{friend_name}", friend_name))
            
            previous_order = cursor.fetchone()
            
            if previous_order and previous_order[0]:
                # We have a previous order for this friend
                coffee_type, milk, size, sugar = previous_order
                
                # Create a suggested order
                friend_order = {
                    'name': friend_name,
                    'type': coffee_type,
                    'milk': milk,
                    'size': size,
                    'sugar': sugar
                }
                
                if station_id:
                    friend_order['station_id'] = station_id
                    friend_order['stationId'] = station_id
                
                # Format order summary for display
                order_summary = self.nlp.format_order_summary(friend_order)
                
                # Move to friend confirmation with suggested order
                self._set_conversation_state(phone, 'awaiting_friend_suggestion_response', {
                    'primary_name': primary_name,
                    'primary_order': primary_order,
                    'friend_name': friend_name,
                    'friend_order': friend_order,
                    'group_orders': group_orders,
                    'station_id': station_id
                })
                
                return (
                    f"I see {friend_name} usually orders: {order_summary}\n"
                    f"Would you like to order this again? (Reply YES or tell me what {friend_name} would like instead)"
                )
                
        except Exception as e:
            logger.error(f"Error checking for previous friend order: {str(e)}")
            # Continue as if no previous order was found - not critical
        
        # If no previous order or error occurred, move to coffee type state for friend's order
        self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
            'primary_name': primary_name,
            'primary_order': primary_order,
            'friend_name': friend_name,
            'group_orders': group_orders,
            'station_id': station_id
        })
        
        return f"Thanks! What type of coffee would {friend_name} like?"
    
    def _handle_awaiting_friend_suggestion_response(self, phone, message, state):
        """Handle response to friend's suggested previous order"""
        message_upper = message.upper().strip()
        
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        friend_order = state.get('temp_data', {}).get('friend_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Check if this is an affirmative response (YES to suggested order)
        if self.nlp.is_affirmative_response(message):
            # They want to use the suggested order - proceed to confirmation
            updated_group_orders = group_orders.copy()
            updated_group_orders.append(friend_order)
            
            self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'group_orders': updated_group_orders,
                'station_id': station_id
            })
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(friend_order)
            
            return (
                f"Great! Here's the order for {friend_name}: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
            
        else:
            # They want to specify a different order
            # Treat the response as a coffee type and continue the normal flow
            self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'group_orders': group_orders,
                'station_id': station_id
            })
            
            # Process their message as a coffee type
            return self._handle_awaiting_friend_coffee_type(phone, message, state)
    
    def _handle_awaiting_friend_coffee_type(self, phone, message, state):
        """Handle friend's coffee type during group ordering"""
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Parse message with NLP
        order_details = self.nlp.parse_order(message)
        
        # If NLP found a complete order, we can skip to confirmation
        if len(order_details) >= 2 and 'type' in order_details:
            # Add friend's name and station ID
            order_details['name'] = friend_name
            if station_id:
                order_details['station_id'] = station_id
                order_details['stationId'] = station_id
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            # Add friend's order to the group orders
            updated_group_orders = group_orders.copy()
            updated_group_orders.append(order_details)
            
            # Save friend's order to state and move to friend order confirmation
            self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': order_details,
                'group_orders': updated_group_orders,
                'station_id': station_id
            })
            
            return (
                f"Great! Here's the order for {friend_name}: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # If only coffee type, ask for milk next
        if 'type' in order_details:
            # Update state with coffee type and continue
            self._set_conversation_state(phone, 'awaiting_friend_milk', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': order_details,
                'group_orders': group_orders,
                'station_id': station_id
            })
            
            # Check if this is a black coffee
            if self.nlp.is_black_coffee(order_details['type']):
                # Skip milk question for black coffee
                return self._handle_awaiting_friend_milk(phone, "no milk", state)
            else:
                return f"What type of milk would {friend_name} like with their {order_details['type']}? (full cream, skim, soy, almond, oat, etc.)"
        
        # If no coffee type found, prompt again
        return f"I'm not sure what type of coffee {friend_name} would like. Please specify a coffee type like latte, cappuccino, flat white, etc."
    
    def _handle_awaiting_friend_milk(self, phone, message, state):
        """Handle friend's milk type during group ordering"""
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        friend_order = state.get('temp_data', {}).get('friend_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Parse milk preference
        if message.lower() == "no milk" or message.lower() == "black":
            milk_type = "no milk"
        else:
            # Use NLP to extract milk type
            new_details = self.nlp.parse_order(message)
            milk_type = new_details.get('milk', None)
        
        # If milk type was provided, update order details
        if milk_type:
            friend_order['milk'] = milk_type
            
            # Update state and move to size
            self._set_conversation_state(phone, 'awaiting_friend_size', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            
            return f"What size {friend_order.get('type', 'coffee')} would {friend_name} like? (small, medium, large)"
        else:
            # If no milk type was found, prompt again
            return f"I didn't recognize that milk type. Please choose from: full cream, skim, soy, almond, oat, lactose free, or no milk."
    
    def _handle_awaiting_friend_size(self, phone, message, state):
        """Handle friend's size preference during group ordering"""
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        friend_order = state.get('temp_data', {}).get('friend_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Use NLP to extract size
        new_details = self.nlp.parse_order(message)
        size = new_details.get('size')
        
        # Also check for simple size indicators
        if not size:
            message_lower = message.lower().strip()
            if message_lower in ['s', 'small', 'sm']:
                size = 'small'
            elif message_lower in ['m', 'medium', 'med', 'regular', 'standard']:
                size = 'medium'
            elif message_lower in ['l', 'large', 'lg', 'big']:
                size = 'large'
        
        # If size was provided, update order details
        if size:
            friend_order['size'] = size
            
            # Update state and move to sugar
            self._set_conversation_state(phone, 'awaiting_friend_sugar', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'friend_order': friend_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            
            return f"How much sugar would {friend_name} like in their {friend_order.get('type', 'coffee')}? (none, 1, 2, etc.)"
        else:
            # If no size was found, prompt again
            return f"I didn't recognize that size. Please choose small, medium, or large for {friend_name}'s coffee."
    
    def _handle_awaiting_friend_sugar(self, phone, message, state):
        """Handle friend's sugar preference during group ordering"""
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        friend_order = state.get('temp_data', {}).get('friend_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        # Handle common "no sugar" responses
        message_lower = message.lower().strip()
        if message_lower in ['no', 'none', 'zero', '0', 'n', 'no sugar', 'without sugar']:
            sugar = 'no sugar'
        elif message_lower in ['1', 'one', 'one sugar', '1 sugar']:
            sugar = '1 sugar'
        elif message_lower in ['2', 'two', 'two sugar', '2 sugar']:
            sugar = '2 sugar'
        else:
            # Use NLP to extract sugar
            new_details = self.nlp.parse_order(message)
            sugar = new_details.get('sugar', 'no sugar')
        
        # Update order details
        friend_order['sugar'] = sugar
        
        # Add friend's order to the group
        updated_group_orders = group_orders.copy()
        updated_group_orders.append(friend_order)
        
        # Update state and move to confirmation
        self._set_conversation_state(phone, 'awaiting_friend_confirmation', {
            'primary_name': primary_name,
            'primary_order': primary_order,
            'friend_name': friend_name,
            'friend_order': friend_order,
            'group_orders': updated_group_orders,
            'station_id': station_id
        })
        
        # Format order summary
        order_summary = self.nlp.format_order_summary(friend_order)
        
        return (
            f"Great! Here's the order for {friend_name}: {order_summary}\n"
            f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
        )
    
    def _handle_awaiting_friend_decision(self, phone, message, state):
        """Handle the user's response after being asked if they want to order for another friend"""
        message_upper = message.upper().strip()
        
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id', 1)  # Default to station 1 if not set

        # Handle different responses
        if message_upper == 'NO' or message_upper == 'N' or message_upper == 'FINISH' or message_upper == 'DONE' or message_upper == 'END':
            # User wants to end the conversation
            total_orders = len(group_orders) + 1  # +1 for the primary order
            self._set_conversation_state(phone, 'completed')
            if total_orders > 1:
                return f"Thanks, {primary_name}! Your group order of {total_orders} coffees has been confirmed.\nThey'll be ready together - we'll SMS you the pickup location."
            else:
                return f"Thanks, {primary_name}! Your order has been confirmed.\nWe'll SMS you when it's ready with the pickup location."
        
        elif message_upper == 'FRIEND' or message_upper == 'YES' or message_upper == 'Y' or 'FRIEND' in message_upper or message_upper == 'ANOTHER':
            # Start another order for a different friend
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            return "Great! Let's add another coffee. What's your friend's name?"
        
        else:
            # Unrecognized response - prompt again
            return "Please reply FRIEND to order for another friend, or NO to finish."
    
    def _handle_awaiting_friend_confirmation(self, phone, message, state):
        """Handle friend order confirmation during group ordering"""
        message_upper = message.upper().strip()
        
        # Get data from state
        primary_name = state.get('temp_data', {}).get('primary_name', '')
        primary_order = state.get('temp_data', {}).get('primary_order', {})
        friend_name = state.get('temp_data', {}).get('friend_name', '')
        friend_order = state.get('temp_data', {}).get('friend_order', {})
        group_orders = state.get('temp_data', {}).get('group_orders', [])
        station_id = state.get('temp_data', {}).get('station_id')
        
        if message_upper == 'YES' or message_upper == 'Y':
            # Confirm the order for the friend (mark it as a friend order)
            order_response = self._confirm_order(phone, friend_order, friend_name, is_friend_order=True)
            
            # Store friend's order preferences for future ordering
            try:
                cursor = self.db.cursor()
                cursor.execute("""
                    INSERT INTO customer_preferences
                    (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, last_order_date, is_friend_of, friend_phone)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (phone, name) DO UPDATE SET
                        preferred_drink = EXCLUDED.preferred_drink,
                        preferred_milk = EXCLUDED.preferred_milk,
                        preferred_size = EXCLUDED.preferred_size,
                        preferred_sugar = EXCLUDED.preferred_sugar,
                        last_order_date = EXCLUDED.last_order_date
                """, (
                    f"{phone}_{friend_name}", # Use a composite key to store friend orders
                    friend_name,
                    friend_order.get('type'),
                    friend_order.get('milk'),
                    friend_order.get('size'),
                    friend_order.get('sugar'),
                    datetime.now(),
                    primary_name,
                    phone
                ))
                self.db.commit()
                logger.info(f"Stored friend preferences for {friend_name}")
            except Exception as e:
                logger.error(f"Error storing friend preferences: {str(e)}")
                # Continue even if this fails - it's non-critical
            
            # Ask if they want to order for another friend
            # Set state to a special "awaiting_friend_decision" state to handle the response
            self._set_conversation_state(phone, 'awaiting_friend_decision', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            total_so_far = len(group_orders) + 1  # +1 for the primary order
            return (
                f"{order_response}\n\n"
                f"That's {total_so_far} coffees in your group order.\n"
                f"Reply FRIEND to add another or NO to finish."
            )
        
        elif message_upper == 'NO' or message_upper == 'N' or message_upper == 'CANCEL':
            # Cancel the friend's order but keep the group context
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            return f"Order for {friend_name} cancelled. What's the name of another friend you'd like to order for? (or type DONE to finish)"
        
        elif message_upper == 'EDIT' or message_upper == 'CHANGE':
            # Allow editing the friend's order - go back to coffee type
            self._set_conversation_state(phone, 'awaiting_friend_coffee_type', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'friend_name': friend_name,
                'group_orders': group_orders,
                'station_id': station_id
            })
            return f"Let's change {friend_name}'s order. What type of coffee would {friend_name} like?"
        
        elif message_upper == 'FRIEND' or message_upper == 'ANOTHER' or 'FRIEND' in message_upper:
            # Start another order for a different friend
            self._set_conversation_state(phone, 'awaiting_friend_name', {
                'primary_name': primary_name,
                'primary_order': primary_order,
                'group_orders': group_orders,
                'station_id': station_id
            })
            return "Great! Let's add another coffee. What's your friend's name?"
        
        elif message_upper == 'DONE' or message_upper == 'FINISH' or message_upper == 'END':
            # Finish the group ordering process
            total_orders = len(group_orders) + 1  # +1 for the primary order
            self._set_conversation_state(phone, 'completed')
            return f"Thanks, {primary_name}! Your group order of {total_orders} coffees has been confirmed.\nThey'll be ready together - we'll SMS you the pickup location."
        
        else:
            # Unrecognized response - prompt again
            return f"Please reply YES to confirm {friend_name}'s order, NO to cancel, EDIT to change it, or DONE to finish the group order."
    
    def _confirm_order(self, phone, order_details, name, is_friend_order=False):
        """Confirm and process the order"""
        # Create a completely fresh connection to avoid transaction isolation issues
        fresh_conn = None
        cursor = None
        
        try:
            # For maximum reliability, get a fresh DB connection from the pool
            # This prevents issues with aborted transactions and isolation levels
            from utils.database import get_db_connection, close_connection
            fresh_conn = get_db_connection()
            
            # Check if we're using SQLite or PostgreSQL
            db_type = "sqlite" if isinstance(fresh_conn, sqlite3.Connection) else "postgres"
            logger.info(f"Using database type: {db_type} for order confirmation")
            
            # Generate order number
            now = datetime.now()
            prefix = "A" if now.hour < 12 else "P"
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Check for station assignment in the order details
            specified_station = order_details.get('station_id') or order_details.get('stationId')
            
            # Assign station based on available information
            is_vip = order_details.get('vip', False)
            milk_type = order_details.get('milk')
            
            if specified_station:
                try:
                    station_id = int(specified_station)
                    is_delayed = False
                    logger.info(f"Using specified station {station_id} from order details")
                except (ValueError, TypeError):
                    # If conversion fails, use the advanced assignment
                    station_id, is_delayed = self._assign_station(is_vip, milk_type)
                    if station_id is None:
                        logger.error("No stations available to assign order")
                        return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                    logger.info(f"Invalid station specified, using intelligent assignment to station {station_id}")
            else:
                # Use advanced station assignment if no station specified
                station_id, is_delayed = self._assign_station(is_vip, milk_type)
                if station_id is None:
                    logger.error("No stations available to assign order")
                    return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                logger.info(f"No station specified, using intelligent assignment to station {station_id}")
                
            # Parse order details to ensure they're in the right format
            processed_details = {
                'name': name,
                'type': order_details.get('type', 'coffee'),
                'milk': order_details.get('milk', 'full cream'),
                'size': order_details.get('size', 'medium'),
                'sugar': order_details.get('sugar', 'no sugar'),
                # Add station ID in all formats for maximum compatibility
                'station_id': station_id,
                'stationId': station_id,
                'assigned_to_station': station_id,
                'assignedStation': station_id
            }
            
            if 'strength' in order_details:
                processed_details['strength'] = order_details['strength']
            
            if 'temp' in order_details:
                processed_details['temp'] = order_details['temp']
            
            if 'notes' in order_details:
                processed_details['notes'] = order_details['notes']
                
            # Handle delayed orders (scheduled for next break)
            if is_delayed:
                processed_details['delayed'] = True
                processed_details['scheduled_for_next_break'] = True
                logger.info(f"Order for {name} will be delayed until next break")
            
            # Check if this is a VIP order and set appropriate priority
            # Priority 1: VIP orders
            # Priority 5-9: Regular orders (with time-based priority to ensure older orders stay ahead)
            if order_details.get('vip', False):
                queue_priority = 1  # VIP orders always get highest priority
            else:
                # For non-VIP orders, use a time-based priority system
                # This ensures older orders have higher priority than newer orders
                hour = datetime.now().hour
                minute = datetime.now().minute
                
                # Convert time to a priority score between 5-9
                # Higher numbers = lower priority, so newer orders get higher numbers
                # This calculation will "roll over" each hour
                queue_priority = 5 + (minute // 15)  # Changes priority every 15 minutes
                
                logger.info(f"Assigned queue priority {queue_priority} to non-VIP order at {hour}:{minute:02d}")
            
            # Get cursor based on database type
            if db_type == "sqlite":
                cursor = fresh_conn.cursor()
            else:
                try:
                    # Use RealDictCursor for PostgreSQL to get dictionary-like results
                    from psycopg2.extras import RealDictCursor
                    cursor = fresh_conn.cursor(cursor_factory=RealDictCursor)
                except Exception:
                    # Fallback if RealDictCursor is not available
                    cursor = fresh_conn.cursor()
            
            # Step 1: Create the order record
            order_id = None
            try:
                # SQLite doesn't support the RETURNING clause, so need different approaches
                if db_type == "sqlite":
                    cursor.execute("""
                        INSERT INTO orders 
                        (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        order_number,
                        phone,
                        json.dumps(processed_details),
                        'pending',
                        station_id,
                        now,
                        now,
                        queue_priority
                    ))
                    fresh_conn.commit()
                    
                    # Get the ID of the inserted row
                    cursor.execute("SELECT last_insert_rowid()")
                    order_id = cursor.fetchone()[0]
                else:
                    cursor.execute("""
                        INSERT INTO orders 
                        (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id
                    """, (
                        order_number,
                        phone,
                        json.dumps(processed_details),
                        'pending',
                        station_id,
                        now,
                        now,
                        queue_priority
                    ))
                    result = cursor.fetchone()
                    
                    # Handle different result formats
                    if isinstance(result, dict):
                        order_id = result.get('id')
                    elif isinstance(result, (list, tuple)) and len(result) > 0:
                        order_id = result[0]
                    
                    fresh_conn.commit()
                
                logger.info(f"Created order {order_number} with ID {order_id}")
                
                # Verify order was created correctly
                if not order_id:
                    raise ValueError("Failed to get order ID after insertion")
                    
            except Exception as order_error:
                logger.error(f"Error creating order: {str(order_error)}")
                try:
                    fresh_conn.rollback()
                except Exception as rollback_error:
                    logger.error(f"Error rolling back after order creation failure: {str(rollback_error)}")
                return "Sorry, we encountered an error processing your order. Please try again or visit the coffee station directly."
            
            # Step 2: Update customer preferences ONLY if this is NOT a friend order
            # When ordering for a friend, don't overwrite the customer's own preferences
            if not is_friend_order:
                try:
                    # Check if customer exists
                    if db_type == "sqlite":
                        cursor.execute("SELECT name FROM customer_preferences WHERE phone = ?", (phone,))
                    else:
                        cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                    
                    # Get result based on cursor type
                    if db_type == "sqlite":
                        result = cursor.fetchone()
                    else:
                        result = cursor.fetchone()
                        
                    if result:
                        # Update existing customer but DON'T change their name
                        # Only update their drink preferences with their own order
                        if db_type == "sqlite":
                            cursor.execute("""
                                UPDATE customer_preferences
                                SET preferred_drink = ?,
                                    preferred_milk = ?,
                                    preferred_size = ?,
                                    preferred_sugar = ?,
                                    last_order_date = ?,
                                    total_orders = total_orders + 1
                                WHERE phone = ?
                            """, (
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                phone
                            ))
                        else:
                            cursor.execute("""
                                UPDATE customer_preferences
                                SET preferred_drink = %s,
                                    preferred_milk = %s,
                                    preferred_size = %s,
                                    preferred_sugar = %s,
                                    last_order_date = %s,
                                    total_orders = total_orders + 1
                                WHERE phone = %s
                            """, (
                                processed_details.get('type'),
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                now,
                                phone
                            ))
                    else:
                        # Create new customer
                        if db_type == "sqlite":
                            cursor.execute("""
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                             first_order_date, last_order_date, total_orders)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            phone,
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            now,
                            1
                        ))
                        else:
                            cursor.execute("""
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                             first_order_date, last_order_date, total_orders)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            phone,
                            name,
                            processed_details.get('type'),
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            now,
                            now,
                            1
                        ))
                
                    fresh_conn.commit()
                    logger.info(f"Updated customer preferences for {name}")
                except Exception as e:
                    logger.error(f"Error saving customer preferences: {str(e)}")
                    # It's OK if this fails, we can continue
                    try:
                        fresh_conn.rollback()
                    except:
                        pass
            
            # Step 3: Update station stats (increment load)
            try:
                if db_type == "sqlite":
                    cursor.execute("""
                        INSERT INTO station_stats (station_id, current_load, last_updated)
                        VALUES (?, 1, ?)
                        ON CONFLICT(station_id) DO UPDATE SET
                            current_load = station_stats.current_load + 1,
                            last_updated = ?
                    """, (station_id, now, now))
            except Exception as sqlite_error:
                # Fallback for older SQLite versions that don't support ON CONFLICT
                logger.warning(f"Advanced SQLite upsert failed, trying basic approach: {str(sqlite_error)}")
                try:
                    # Check if stats record exists
                    cursor.execute("SELECT station_id FROM station_stats WHERE station_id = ?", (station_id,))
                    if cursor.fetchone():
                        # Update existing record
                        cursor.execute("""
                            UPDATE station_stats 
                            SET current_load = current_load + 1, last_updated = ?
                            WHERE station_id = ?
                        """, (now, station_id))
                    else:
                        # Insert new record
                        cursor.execute("""
                            INSERT INTO station_stats (station_id, current_load, last_updated)
                            VALUES (?, 1, ?)
                        """, (station_id, now))
                except Exception as e:
                    logger.error(f"Error updating station stats in SQLite (fallback): {str(e)}")
                    # Continue despite this error
                if db_type != "sqlite":
                    # For PostgreSQL
                    cursor.execute("""
                        INSERT INTO station_stats (station_id, current_load, last_updated)
                        VALUES (%s, 1, %s)
                        ON CONFLICT (station_id) DO UPDATE SET
                            current_load = station_stats.current_load + 1,
                            last_updated = %s
                    """, (station_id, now, now))
                
                # Try to commit, but continue if it fails
                try:
                    fresh_conn.commit()
                    logger.info(f"Updated station {station_id} load")
                except Exception as commit_err:
                    logger.error(f"Error committing station stats update: {str(commit_err)}")
                    # No rollback here - we want to preserve the order creation
            except Exception as stats_error:
                logger.error(f"Error updating station stats: {str(stats_error)}")
                # Continue despite this error - it's non-critical
            
            # Get wait time - use separate try block to ensure failures don't affect order
            wait_time = 10  # Default wait time
            try:
                wait_time = self._get_station_wait_time(station_id)
            except Exception as wait_err:
                logger.error(f"Error getting wait time: {str(wait_err)}")
            
            # Set conversation to completed - use separate try block to ensure failures don't affect order
            try:
                self._set_conversation_state(phone, 'completed')
            except Exception as conv_err:
                logger.error(f"Error setting conversation state: {str(conv_err)}")
            
            # Check if this milk type is only available at one station
            milk_is_unique = False
            unique_station_info = None
            
            try:
                # Check if milk type is only available at this specific station
                cursor.execute("""
                    SELECT COUNT(DISTINCT s.id) as station_count
                    FROM stations s
                    WHERE s.current_status IN ('active', 'open')
                    AND s.capabilities::jsonb -> 'milk_types' ? %s
                """, (processed_details.get('milk'),))
                
                result = cursor.fetchone()
                if result and result[0] == 1:
                    milk_is_unique = True
                    unique_station_info = (station_id, wait_time)
            except Exception as milk_check_err:
                logger.error(f"Error checking milk uniqueness: {str(milk_check_err)}")
            
            # Build the confirmation message
            if milk_is_unique and unique_station_info:
                # Show station immediately if it's the only one with this milk
                confirmation_message = (
                    f"✅ Order #{order_number} confirmed!\n"
                    f"{processed_details.get('milk').title()} is available at Station {station_id} only.\n"
                    f"Estimated wait time: {wait_time} minutes."
                )
            else:
                # Standard message - don't show station immediately
                confirmation_message = (
                    f"✅ Order #{order_number} confirmed!\n"
                    f"We're finding the shortest queue for you.\n"
                    f"You'll get an SMS when ready with pickup location."
                )
            
            # Add tracking URL if enabled
            if self._get_setting('enable_web_tracking', 'false').lower() in ('true', 'yes', '1'):
                try:
                    base_url = self._get_setting('web_tracking_url', 'https://coffee.example.com/track/')
                    tracking_url = f"{base_url}?id={order_number}"
                    confirmation_message += f"\n\nTrack your order here: {tracking_url}"
                except Exception as url_err:
                    logger.error(f"Error adding tracking URL: {str(url_err)}")
            
            # Return the success message
            return confirmation_message
            
        except Exception as e:
            # Catch-all error handling
            logger.error(f"Error confirming order (outer try block): {str(e)}")
            try:
                if fresh_conn:
                    fresh_conn.rollback()
            except Exception as rollback_error:
                logger.error(f"Error rolling back transaction: {str(rollback_error)}")
                
            return "Sorry, we encountered an error processing your order. Please try again or visit the coffee station directly."
        finally:
            # Always clean up resources
            try:
                if cursor:
                    cursor.close()
            except:
                pass
                
            # Close the fresh connection we created
            if fresh_conn:
                try:
                    from utils.database import close_connection
                    close_connection(fresh_conn)
                except Exception as close_err:
                    logger.error(f"Error closing connection: {str(close_err)}")
    
    def _assign_station(self, is_vip=False, milk_type=None):
        """
        Assign order to a station based on current load, station capabilities, and scheduling
        
        Args:
            is_vip (bool): Whether this is a VIP order
            milk_type (str): Type of milk requested, for specialized station routing
            
        Returns:
            int: ID of the assigned station
            bool: Whether this order will be delayed until next break
        """
        try:
            cursor = self.db.cursor()
            
            # Log station assignment request
            logger.info(f"Station assignment requested: VIP={is_vip}, milk_type={milk_type}")
            
            # First check if we're in a break period or not
            current_time = datetime.now()
            current_hour = current_time.hour
            current_minute = current_time.minute
            current_day = current_time.weekday()  # 0=Monday, 6=Sunday
            
            # Check for any scheduled breaks that include the current time
            cursor.execute("""
                SELECT id, start_time, end_time, stations 
                FROM event_breaks 
                WHERE day_of_week = %s
                ORDER BY start_time
            """, (current_day,))
            
            current_break = None
            next_break = None
            
            for break_info in cursor.fetchall():
                break_id, start_str, end_str, stations_json = break_info
                
                # Parse the time strings (format: "HH:MM")
                start_hour, start_minute = map(int, start_str.split(':'))
                end_hour, end_minute = map(int, end_str.split(':'))
                
                # Check if current time is within the break
                if ((current_hour > start_hour) or 
                    (current_hour == start_hour and current_minute >= start_minute)) and \
                   ((current_hour < end_hour) or 
                    (current_hour == end_hour and current_minute <= end_minute)):
                    # We're in a break period now
                    current_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
                
                # Check if this is the next upcoming break
                if (current_hour < start_hour) or \
                   (current_hour == start_hour and current_minute < start_minute):
                    next_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        'stations': json.loads(stations_json) if stations_json else []
                    }
                    break
            
            # Get all stations with their current load and capabilities
            cursor.execute("""
                SELECT station_id, COALESCE(current_load, 0), 
                       COALESCE(equipment_notes, '{}') as capabilities, 
                       COALESCE(status, 'active') as current_status
                FROM station_stats
                WHERE status IN ('active', 'open') OR status IS NULL
                ORDER BY COALESCE(current_load, 0)
            """)
            
            stations = []
            stations_with_milk = {}  # Track which stations have specific milk types
            
            for station_data in cursor.fetchall():
                station_id, load, capabilities_json, status = station_data
                try:
                    capabilities = json.loads(capabilities_json) if capabilities_json and capabilities_json != '{}' else {}
                except (json.JSONDecodeError, TypeError):
                    capabilities = {}
                
                # Set minimal default capabilities for stations that don't have them configured
                if not capabilities:
                    # Use minimal defaults - organizer should configure these properly
                    capabilities = {
                        'milk_types': ['full cream', 'skim'],
                        'coffee_types': ['espresso', 'latte', 'cappuccino'],
                        'capacity': 10,
                        'high_volume': False,
                        'vip_service': False
                    }
                    logger.warning(f"Station {station_id} has no capabilities configured. Using minimal defaults.")
                
                # Extract milk types for this station
                milk_types = capabilities.get('milk_types', ['full cream', 'skim'])
                
                # Track which stations have this milk
                for milk in milk_types:
                    if milk not in stations_with_milk:
                        stations_with_milk[milk] = []
                    stations_with_milk[milk].append(station_id)
                
                stations.append({
                    'id': station_id,
                    'load': load,
                    'capacity': capabilities.get('capacity', 10),  # Default capacity if none set
                    'status': status,
                    'capabilities': capabilities,
                    'milk_types': milk_types,
                    'coffee_types': capabilities.get('coffee_types', []),
                    'alt_milk_available': any(m in milk_types for m in ['soy', 'almond', 'oat', 'lactose free', 'coconut']),
                    'high_volume': capabilities.get('high_volume', False),
                    'vip_service': capabilities.get('vip_service', False)
                })
            
            if not stations:
                # No stations found
                logger.error("No active stations found in database. Orders cannot be assigned.")
                logger.error("Please create stations through the Organizer interface before accepting orders.")
                # Return None to indicate no station available
                return None, False
            
            # First handle VIP logic
            if is_vip:
                # For VIPs, prefer stations with VIP service capability
                vip_stations = [s for s in stations if s['vip_service'] and s['status'] == 'active']
                
                if vip_stations:
                    # Use the least busy VIP-capable station
                    vip_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned VIP order to dedicated VIP station {vip_stations[0]['id']}")
                    return vip_stations[0]['id'], False
                
                # If no VIP stations, use the least busy regular station
                active_stations = [s for s in stations if s['status'] == 'active']
                if active_stations:
                    active_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned VIP order to regular station {active_stations[0]['id']}")
                    return active_stations[0]['id'], False
            
            # Check if the requested milk type requires specific station
            milk_type_normalized = milk_type.lower().replace(' milk', '') if milk_type else None
            stations_for_milk = stations_with_milk.get(milk_type_normalized, []) if milk_type_normalized else []
            
            # If only one station has this milk type, we must use that station
            if milk_type_normalized and len(stations_for_milk) == 1:
                station_id = stations_for_milk[0]
                station = next((s for s in stations if s['id'] == station_id), None)
                if station:
                    wait_time = self._get_station_wait_time(station_id)
                    logger.info(f"Only station {station_id} has {milk_type}, assigning order there (wait: {wait_time} min)")
                    return station_id, False
            
            # Check if this is alternative milk
            is_alt_milk = milk_type_normalized and milk_type_normalized in ['soy', 'almond', 'oat', 'lactose free', 'coconut', 'macadamia']
            
            # During a break period, use open stations based on capabilities
            if current_break:
                # Get the stations that are open during this break
                open_station_ids = current_break['stations']
                open_stations = [s for s in stations if s['id'] in open_station_ids and s['status'] == 'active']
                
                if not open_stations:
                    logger.warning(f"No stations open during current break, using all active stations")
                    open_stations = [s for s in stations if s['status'] == 'active']
                
                # Find the best station based on milk type and load
                if milk_type_normalized:
                    # Find stations that have this specific milk type
                    milk_capable_stations = [s for s in open_stations if milk_type_normalized in s['milk_types']]
                    if milk_capable_stations:
                        milk_capable_stations.sort(key=lambda s: s['load'])
                        logger.info(f"Assigned {milk_type} order to station {milk_capable_stations[0]['id']} during break")
                        return milk_capable_stations[0]['id'], False
                    else:
                        logger.warning(f"No open stations have {milk_type} during break, using default station")
                        # Fall through to standard assignment
                
                # If we reached here, use standard load balancing among open stations
                if open_stations:
                    # Weighted random assignment based on load and capacity
                    weights = []
                    for station in open_stations:
                        # Higher weight for stations with more capacity and less load
                        capacity_factor = station['capacity'] / 10.0  # Normalize capacity
                        load_factor = max(0.1, 1.0 - (station['load'] / station['capacity']))
                        weight = capacity_factor * load_factor
                        weights.append(weight)
                    
                    # Select a station based on weights
                    total_weight = sum(weights) or 1.0  # Avoid division by zero
                    normalized_weights = [w/total_weight for w in weights]
                    
                    rand = random.random()
                    cumulative = 0
                    selected_station = open_stations[0]['id']  # Default
                    
                    for i, weight in enumerate(normalized_weights):
                        cumulative += weight
                        if rand <= cumulative:
                            selected_station = open_stations[i]['id']
                            break
                    
                    logger.info(f"Assigned order to station {selected_station} during break")
                    return selected_station, False
            
            # If not during a break and we have a next break, check if we should delay the order
            if not current_break and next_break:
                # Get all active stations
                active_stations = [s for s in stations if s['status'] == 'active']
                
                # Check if all active stations are nearly at capacity
                if active_stations and all(s['load'] >= 0.8 * s['capacity'] for s in active_stations):
                    # Stations are busy, so delay until next break
                    # Choose a station from those that will be open during the next break
                    next_break_station_ids = next_break['stations']
                    next_break_stations = [s for s in stations if s['id'] in next_break_station_ids]
                    
                    if next_break_stations:
                        # Choose a high-capacity station for the next break if possible
                        high_volume_stations = [s for s in next_break_stations if s['high_volume']]
                        if high_volume_stations:
                            station_choice = high_volume_stations[0]['id']
                        else:
                            station_choice = next_break_stations[0]['id']
                        
                        logger.info(f"Stations busy, delaying order until next break at {next_break['start']} using station {station_choice}")
                        return station_choice, True
            
            # Standard station assignment logic for normal operations
            active_stations = [s for s in stations if s['status'] == 'active']
            
            if not active_stations:
                logger.warning("No active stations found, defaulting to station 1")
                return 1, False
            
            # Special handling for specific milk type orders
            if milk_type_normalized:
                # Find stations that have this specific milk type
                milk_capable_stations = [s for s in active_stations if milk_type_normalized in s['milk_types']]
                if milk_capable_stations:
                    # Sort by load to find the least busy station with this milk
                    milk_capable_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned {milk_type} order to station {milk_capable_stations[0]['id']}")
                    return milk_capable_stations[0]['id'], False
                else:
                    logger.warning(f"No active stations have {milk_type}, cannot fulfill order")
                    # You might want to handle this case differently - maybe return an error
                    return 1, False  # Default fallback
            
            # Calculate weights for station selection based on load and capacity
            # Higher capacity stations should handle more orders
            weighted_stations = []
            for station in active_stations:
                # Normalized load (0-1 range, lower is better)
                norm_load = min(1.0, station['load'] / station['capacity']) if station['capacity'] > 0 else 1.0
                
                # Load score: 1.0 = empty, 0.0 = full
                load_score = 1.0 - norm_load
                
                # Capacity weight (higher capacity stations get more weight)
                capacity_weight = station['capacity'] / 10.0  # Normalize to a reasonable range
                
                # Final weight combines both factors
                final_weight = load_score * capacity_weight
                
                weighted_stations.append((station['id'], max(0.01, final_weight)))  # Ensure positive weight
            
            # If only one station, use it
            if len(weighted_stations) == 1:
                return weighted_stations[0][0], False
            
            # Otherwise do weighted selection
            station_ids, weights = zip(*weighted_stations)
            total_weight = sum(weights)
            norm_weights = [w/total_weight for w in weights]
            
            rand = random.random()
            cumulative = 0
            for i, weight in enumerate(norm_weights):
                cumulative += weight
                if rand <= cumulative:
                    logger.info(f"Assigned order to station {station_ids[i]} using weighted selection")
                    return station_ids[i], False
            
            # Fallback to the least busy active station
            active_stations.sort(key=lambda s: s['load'])
            selected_station = active_stations[0]['id']
            logger.warning(f"Selection algorithm failed, using least busy station {selected_station}")
            return selected_station, False
            
        except Exception as e:
            logger.error(f"Error in advanced station assignment: {str(e)}")
            logger.exception(e)
            
            # Try to find any active station instead of defaulting to station 1
            try:
                cursor = self.db.cursor()
                cursor.execute('''
                    SELECT station_id, current_load 
                    FROM station_stats 
                    WHERE status = 'active' 
                    ORDER BY current_load ASC
                    LIMIT 1
                ''')
                result = cursor.fetchone()
                if result and result[0]:
                    station_id = result[0]
                    logger.info(f"Found least loaded station {station_id} as fallback")
                    return station_id, False
            except Exception as fallback_err:
                logger.error(f"Error finding fallback station: {str(fallback_err)}")
            
            # Only default to station 1 as last resort
            logger.warning("Could not find any active station, defaulting to station 1")
            return 1, False
    
    def _update_station_load(self, station_id, increment=True):
        """Update station load count"""
        try:
            cursor = self.db.cursor()
            
            if increment:
                cursor.execute("""
                    UPDATE station_stats
                    SET current_load = current_load + 1, last_updated = %s
                    WHERE station_id = %s
                """, (datetime.now(), station_id))
            else:
                cursor.execute("""
                    UPDATE station_stats
                    SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                    WHERE station_id = %s
                """, (datetime.now(), station_id))
            
            self.db.commit()
            
        except Exception as e:
            logger.error(f"Error updating station load: {str(e)}")
    
    def _get_station_wait_time(self, station_id):
        """Get estimated wait time for a station"""
        try:
            db_type = "sqlite" if isinstance(self.db, sqlite3.Connection) else "postgres"
            cursor = self.db.cursor()
            
            # First check if the station_stats table exists
            if db_type == "sqlite":
                cursor.execute("""
                    SELECT 1 FROM sqlite_master WHERE type='table' AND name='station_stats'
                """)
            else:
                cursor.execute("""
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'station_stats'
                """)
            
            if cursor.fetchone() is None:
                # Table doesn't exist, return default wait time
                logger.info("station_stats table doesn't exist, using default wait time")
                return 10  # Default wait time
            
            # Get station wait time
            if db_type == "sqlite":
                cursor.execute("""
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = ?
                """, (station_id,))
            else:
                cursor.execute("""
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = %s
                """, (station_id,))
            
            result = cursor.fetchone()
            
            if not result:
                # No statistics for this station, check if it has a configured wait time in stations table
                try:
                    # Check if the stations table exists
                    if db_type == "sqlite":
                        cursor.execute("""
                            SELECT 1 FROM sqlite_master WHERE type='table' AND name='stations'
                        """)
                    else:
                        cursor.execute("""
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = 'public' AND table_name = 'stations'
                        """)
                    
                    if cursor.fetchone() is not None:
                        # Try to get waitTime from stations table
                        if db_type == "sqlite":
                            cursor.execute("""
                                SELECT waitTime FROM stations WHERE id = ?
                            """, (station_id,))
                        else:
                            cursor.execute("""
                                SELECT waitTime FROM stations WHERE id = %s
                            """, (station_id,))
                        
                        wait_time_result = cursor.fetchone()
                        if wait_time_result and wait_time_result[0]:
                            return wait_time_result[0]
                except Exception as e:
                    logger.error(f"Error getting wait time from stations table: {str(e)}")
                
                # If we couldn't get a wait time from the stations table either, use default
                return 10  # Default wait time
            
            current_load, avg_completion_time, wait_time = result
            
            # If station has set a specific wait time, use that
            if wait_time:
                return wait_time
            
            # Otherwise calculate based on load and avg completion time
            if avg_completion_time:
                # Calculate wait time in minutes
                calculated_wait = max(1, (current_load * avg_completion_time) // 60)
                return min(calculated_wait, 30)  # Cap at 30 minutes
            
            # Default fallback
            return max(5, min(current_load * 2, 20))
            
        except Exception as e:
            logger.error(f"Error getting station wait time: {str(e)}")
            return 10  # Default wait time
    
    def _save_customer_preferences(self, phone, name, order_details):
        """Save customer preferences for future use"""
        try:
            # If name wasn't provided directly, check if it's in order details
            if not name and order_details and 'name' in order_details:
                name = order_details['name']
                
            # Skip if we still don't have a name or phone
            if not name or not phone:
                logger.warning(f"Cannot save customer preferences without name and phone: name={name}, phone={phone}")
                return
                
            db_type = "sqlite" if isinstance(self.db, sqlite3.Connection) else "postgres"
            cursor = self.db.cursor()
            
            # Check if customer exists
            if db_type == "sqlite":
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = ?", (phone,))
            else:
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                
            result = cursor.fetchone()
            
            now = datetime.now()
            
            if result:
                # Update existing customer
                if db_type == "sqlite":
                    cursor.execute("""
                        UPDATE customer_preferences
                        SET name = ?,
                            preferred_drink = ?,
                            preferred_milk = ?,
                            preferred_size = ?,
                            preferred_sugar = ?,
                            last_order_date = ?,
                            total_orders = total_orders + 1
                        WHERE phone = ?
                    """, (
                        name,
                        order_details.get('type'),
                        order_details.get('milk'),
                        order_details.get('size'),
                        order_details.get('sugar'),
                        now,
                        phone
                    ))
                else:
                    cursor.execute("""
                        UPDATE customer_preferences
                        SET name = %s,
                            preferred_drink = %s,
                            preferred_milk = %s,
                            preferred_size = %s,
                            preferred_sugar = %s,
                            last_order_date = %s,
                            total_orders = total_orders + 1
                        WHERE phone = %s
                    """, (
                        name,
                        order_details.get('type'),
                        order_details.get('milk'),
                        order_details.get('size'),
                        order_details.get('sugar'),
                        now,
                        phone
                    ))
            else:
                # Create new customer
                if db_type == "sqlite":
                    cursor.execute("""
                        INSERT INTO customer_preferences
                        (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                         first_order_date, last_order_date, total_orders)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        phone,
                        name,
                        order_details.get('type'),
                        order_details.get('milk'),
                        order_details.get('size'),
                        order_details.get('sugar'),
                        now,
                        now,
                        1
                    ))
                else:
                    cursor.execute("""
                        INSERT INTO customer_preferences
                        (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                         first_order_date, last_order_date, total_orders)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        phone,
                        name,
                        order_details.get('type'),
                        order_details.get('milk'),
                        order_details.get('size'),
                        order_details.get('sugar'),
                        now,
                        now,
                        1
                    ))
            
            self.db.commit()
            
        except Exception as e:
            logger.error(f"Error saving customer preferences: {str(e)}")
            try:
                self.db.rollback()
            except Exception as rollback_error:
                logger.error(f"Error rolling back transaction: {str(rollback_error)}")
    
    def _restart_conversation(self, phone, message):
        """Restart a conversation from the beginning"""
        # For logging
        logger.info(f"Restarting conversation for {phone} with message: {message}")
        
        # Check if this is a special command - if so, don't restart but handle normally
        message_upper = message.upper().strip()
        if message_upper in ['MENU', 'STATUS', 'INFO', 'OPTIONS', 'COMMANDS', 'USUAL', 'CANCEL', 'CANCELORDER']:
            # Don't restart, handle as a command (recursive call to handle_sms)
            logger.info(f"Detected command {message_upper} during restart, handling as command")
            return self.handle_sms(phone, message, None, None)
        
        # Check if this is a usual order request
        if self.nlp.is_asking_for_usual(message):
            # Get customer info
            customer = self.get_customer(phone)
            name = customer.get('name', '') if customer else ''
            
            if name:
                return self._process_usual_order(phone, name)
            else:
                # We don't know their name yet
                self._set_conversation_state(phone, 'awaiting_name')
                
                # Get welcome message from settings or use default if not available
                welcome_message = self._get_setting('sms_welcome_message', f"Welcome to {{event_name}}! I'll take your coffee order. What's your first name?")
                # Replace event_name placeholder with actual event name  
                return welcome_message.replace('{event_name}', self.event_name)
        
        # Check if this is an affirmative response
        if self.nlp.is_affirmative_response(message):
            # This might be a yes to a previous suggestion, but we can't be sure
            # since we're restarting the conversation, so we'll handle it as a new request
            pass
        
        # Check if NLP can parse a complete order
        order_details = self.nlp.parse_order(message)
        
        # Validate the order if it contains any specific components
        if order_details:
            # Validate coffee type
            coffee_type = order_details.get('type', '')
            if coffee_type:
                available_coffee_types = self._get_available_coffee_types()
                if not self._is_valid_coffee_type(coffee_type, available_coffee_types):
                    return f"Sorry, we don't offer {coffee_type}. Available options are: {', '.join(available_coffee_types)}. Please text MENU for full options."
            
            # Validate milk type
            milk_type = order_details.get('milk', '')
            if milk_type:
                available_milk_types = self._get_available_milk_types()
                if not self._is_valid_milk_type(milk_type, available_milk_types):
                    return f"Sorry, we don't have {milk_type} milk. Available options are: {', '.join(available_milk_types)}. Please text MENU for full options."
            
            # Validate sweetener
            sweetener = order_details.get('sugar', '')
            if sweetener:
                available_sweeteners = self._get_available_sweeteners()
                if not self._is_valid_sweetener(sweetener, available_sweeteners):
                    sweetener_names = [s[0] for s in available_sweeteners]
                    return f"Sorry, we don't have {sweetener}. Available options are: {', '.join(sweetener_names)}. Please text MENU for full options."
        
        # Get customer info
        customer = self.get_customer(phone)
        name = customer.get('name', '') if customer else ''
        
        # If we have a complete order and know the customer name
        if len(order_details) >= 3 and 'type' in order_details and name:
            # Add name to order details
            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
            
            # Format order summary
            order_summary = self.nlp.format_order_summary(order_details)
            
            return (
                f"Welcome back, {name}! Here's your order: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        
        # If we have customer name but not a complete order
        if name:
            # Check if message contains coffee type
            if 'type' in order_details:
                # Save coffee type and continue conversation
                state_data = {
                    'name': name,
                    'order_details': order_details
                }
                self._set_conversation_state(phone, 'awaiting_milk', state_data)
                
                return f"Welcome back, {name}! What type of milk would you like with your {order_details['type']}?"
            else:
                # Get usual order suggestions
                usual_suggestions = self._get_usual_order_suggestion(phone, name)
                if usual_suggestions:
                    # Set state with suggestion context
                    self._set_conversation_state(phone, 'awaiting_coffee_type', {
                        'name': name,
                        'suggestion_context': 'usual_order'
                    })
                    return f"Welcome back, {name}! {usual_suggestions}"
                else:
                    # Just welcome them back and ask for coffee
                    self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
                    return f"Welcome back, {name}! What type of coffee would you like today?"
        
        # For new customers or incomplete messages
        self._set_conversation_state(phone, 'awaiting_name')
        
        # Get welcome message from settings or use default if not available
        welcome_message = self._get_setting('sms_welcome_message', f"Welcome to {{event_name}}! I'll take your coffee order. What's your first name?")
        # Replace event_name placeholder with actual event name
        return welcome_message.replace('{event_name}', self.event_name)
    
    def _get_setting(self, key, default_value=None):
        """Get a setting from the database
        
        Args:
            key: Setting key
            default_value: Default value if setting not found
            
        Returns:
            Setting value or default value if not found
        """
        # Check cache first if available
        if hasattr(self, 'settings_cache') and key in self.settings_cache:
            return self.settings_cache[key]
            
        try:
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            result = cursor.fetchone()
            
            if result and result[0]:
                # Cache the result if cache exists
                if hasattr(self, 'settings_cache'):
                    self.settings_cache[key] = result[0]
                return result[0]
            else:
                # Cache the default if cache exists
                if hasattr(self, 'settings_cache'):
                    self.settings_cache[key] = default_value
                return default_value
        except Exception as e:
            logger.error(f"Error getting setting {key}: {str(e)}")
            return default_value
    
    def _set_setting(self, key, value):
        """Save a setting to the database and update the cache
        
        Args:
            key: Setting key
            value: Setting value
            
        Returns:
            bool: Success or failure
        """
        try:
            cursor = self.db.cursor()
            
            # Check if setting exists
            cursor.execute("SELECT key FROM settings WHERE key = %s", (key,))
            exists = cursor.fetchone() is not None
            
            if exists:
                # Update existing setting
                cursor.execute("UPDATE settings SET value = %s WHERE key = %s", (value, key))
            else:
                # Insert new setting
                cursor.execute("INSERT INTO settings (key, value) VALUES (%s, %s)", (key, value))
                
            self.db.commit()
            
            # Update cache if it exists
            if hasattr(self, 'settings_cache'):
                self.settings_cache[key] = value
                
            return True
            
        except Exception as e:
            logger.error(f"Error saving setting '{key}': {str(e)}")
            return False
    
    def _normalize_phone(self, phone):
        """Normalize phone number format"""
        # Remove any non-digit characters
        digits = re.sub(r'\D', '', phone)
        
        # For Australian numbers, ensure they start with +61
        if digits.startswith('0'):
            return '+61' + digits[1:]
        elif not digits.startswith('+'):
            return '+' + digits
        
        return phone
    
    def _get_conversation_state(self, phone):
        """Get the conversation state for a phone number"""
        # Check in-memory cache first
        if phone in self.conversation_states:
            return self.conversation_states[phone]
        
        # Check if we're using SQLite or PostgreSQL
        is_sqlite = isinstance(self.db, sqlite3.Connection)
        db_type = "sqlite" if is_sqlite else "postgres"
        
        # Otherwise, check database
        try:
            cursor = self.db.cursor()
            
            # Use the appropriate parameter style for the database type
            if is_sqlite:
                cursor.execute("""
                    SELECT state, temp_data, last_interaction, message_count
                    FROM conversation_states
                    WHERE phone = ?
                """, (phone,))
            else:
                cursor.execute("""
                    SELECT state, temp_data, last_interaction, message_count
                    FROM conversation_states
                    WHERE phone = %s
                """, (phone,))
            
            result = cursor.fetchone()
            
            if result:
                # Get values from result - may be a tuple or a dict depending on cursor type
                if isinstance(result, dict):
                    state = result.get('state')
                    temp_data_str = result.get('temp_data')
                    last_interaction = result.get('last_interaction')
                    message_count = result.get('message_count', 0)
                else:
                    state, temp_data_str, last_interaction, message_count = result
                
                # Parse JSON temp data
                try:
                    temp_data = json.loads(temp_data_str) if temp_data_str else {}
                except Exception as json_err:
                    logger.error(f"Error parsing JSON in conversation state: {str(json_err)}")
                    temp_data = {}
                
                # Create state object
                state_obj = {
                    'state': state,
                    'temp_data': temp_data,
                    'last_interaction': last_interaction,
                    'message_count': int(message_count) if message_count else 0
                }
                
                # Cache in memory
                self.conversation_states[phone] = state_obj
                
                return state_obj
            
            # No state found - return empty state
            return {'state': None, 'temp_data': {}, 'message_count': 0}
            
        except Exception as e:
            logger.error(f"Error getting conversation state: {str(e)}")
            return {'state': None, 'temp_data': {}, 'message_count': 0}
    
    def _set_conversation_state(self, phone, state, temp_data=None):
        """Update the conversation state for a phone number"""
        # Update in-memory cache
        now = datetime.now()
        
        # Get existing state to update message count
        existing = self._get_conversation_state(phone)
        message_count = existing.get('message_count', 0) + 1
        
        # Create state object
        state_obj = {
            'state': state,
            'temp_data': temp_data or {},
            'last_interaction': now,
            'message_count': message_count
        }
        
        # Update in-memory cache
        self.conversation_states[phone] = state_obj
        
        # Check if we're using SQLite or PostgreSQL
        is_sqlite = isinstance(self.db, sqlite3.Connection)
        db_type = "sqlite" if is_sqlite else "postgres"
        
        # Use a separate connection to update the state to avoid transaction isolation issues
        try:
            # Get a fresh connection from the pool
            from utils.database import get_db_connection, close_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Convert temp_data to JSON
            temp_data_json = json.dumps(temp_data) if temp_data else None
            
            # Check if state exists - use database-appropriate paramstyle
            if is_sqlite:
                cursor.execute("SELECT phone FROM conversation_states WHERE phone = ?", (phone,))
            else:
                cursor.execute("SELECT phone FROM conversation_states WHERE phone = %s", (phone,))
                
            result = cursor.fetchone()
            
            if result:
                # Update existing state
                if is_sqlite:
                    cursor.execute("""
                        UPDATE conversation_states
                        SET state = ?, temp_data = ?, last_interaction = ?, message_count = ?
                        WHERE phone = ?
                    """, (state, temp_data_json, now, message_count, phone))
                else:
                    cursor.execute("""
                        UPDATE conversation_states
                        SET state = %s, temp_data = %s, last_interaction = %s, message_count = %s
                        WHERE phone = %s
                    """, (state, temp_data_json, now, message_count, phone))
            else:
                # Insert new state
                if is_sqlite:
                    cursor.execute("""
                        INSERT INTO conversation_states
                        (phone, state, temp_data, last_interaction, message_count)
                        VALUES (?, ?, ?, ?, ?)
                    """, (phone, state, temp_data_json, now, message_count))
                else:
                    cursor.execute("""
                        INSERT INTO conversation_states
                        (phone, state, temp_data, last_interaction, message_count)
                        VALUES (%s, %s, %s, %s, %s)
                    """, (phone, state, temp_data_json, now, message_count))
            
            conn.commit()
            logger.info(f"Updated conversation state for {phone} to '{state}'")
            
        except Exception as e:
            logger.error(f"Error setting conversation state: {str(e)}")
            
        finally:
            # Always clean up resources
            try:
                if cursor:
                    cursor.close()
                if conn:
                    close_connection(conn)
            except Exception as close_err:
                logger.error(f"Error closing connection: {str(close_err)}")

    # ==== Order Management Methods ====
    
    def get_pending_orders(self, station_id=None):
        """
        Get pending orders
        
        Args:
            station_id: Optional station ID filter
            
        Returns:
            List of pending orders
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            
            if station_id:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'pending' AND station_id = %s
                    ORDER BY queue_priority, created_at
                """, (station_id,))
            else:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'pending'
                    ORDER BY queue_priority, created_at
                """)
            
            orders = cursor.fetchall()
            
            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order['order_details'] and isinstance(order['order_details'], str):
                    order['order_details'] = json.loads(order['order_details'])
                
                # Calculate wait time
                if order['created_at']:
                    created_at = order['created_at']
                    order['wait_time'] = int((datetime.now() - created_at).total_seconds() / 60)
                
                result.append(dict(order))
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting pending orders: {str(e)}")
            return []
    
    def get_in_progress_orders(self, station_id=None):
        """
        Get in-progress orders
        
        Args:
            station_id: Optional station ID filter
            
        Returns:
            List of in-progress orders
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            
            if station_id:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'in-progress' AND station_id = %s
                    ORDER BY created_at
                """, (station_id,))
            else:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'in-progress'
                    ORDER BY created_at
                """)
            
            orders = cursor.fetchall()
            
            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order['order_details'] and isinstance(order['order_details'], str):
                    order['order_details'] = json.loads(order['order_details'])
                
                # Calculate wait time
                if order['created_at']:
                    created_at = order['created_at']
                    order['wait_time'] = int((datetime.now() - created_at).total_seconds() / 60)
                
                result.append(dict(order))
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting in-progress orders: {str(e)}")
            return []
    
    def get_completed_orders(self, station_id=None, limit=20):
        """
        Get completed orders
        
        Args:
            station_id: Optional station ID filter
            limit: Maximum number of orders to return
            
        Returns:
            List of completed orders
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            
            if station_id:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'completed' AND station_id = %s
                    ORDER BY updated_at DESC
                    LIMIT %s
                """, (station_id, limit))
            else:
                cursor.execute("""
                    SELECT * FROM orders 
                    WHERE status = 'completed'
                    ORDER BY updated_at DESC
                    LIMIT %s
                """, (limit,))
            
            orders = cursor.fetchall()
            
            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order['order_details'] and isinstance(order['order_details'], str):
                    order['order_details'] = json.loads(order['order_details'])
                
                result.append(dict(order))
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting completed orders: {str(e)}")
            return []
    
    def get_order_by_id(self, order_id):
        """
        Get order by ID
        
        Args:
            order_id: Order ID
            
        Returns:
            Order dictionary if found, None otherwise
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
            order = cursor.fetchone()
            
            if not order:
                return None
            
            # Parse order details
            if order['order_details'] and isinstance(order['order_details'], str):
                order['order_details'] = json.loads(order['order_details'])
            
            return dict(order)
            
        except Exception as e:
            logger.error(f"Error getting order by ID: {str(e)}")
            return None
    
    def get_order_by_number(self, order_number):
        """
        Get order by order number
        
        Args:
            order_number: Order number string
            
        Returns:
            Order dictionary if found, None otherwise
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT * FROM orders WHERE order_number = %s", (order_number,))
            order = cursor.fetchone()
            
            if not order:
                return None
            
            # Parse order details
            if order['order_details'] and isinstance(order['order_details'], str):
                order['order_details'] = json.loads(order['order_details'])
            
            return dict(order)
            
        except Exception as e:
            logger.error(f"Error getting order by number: {str(e)}")
            return None
    
    def update_order_status(self, order_id, status, editor=None):
        """
        Update order status
        
        Args:
            order_id: Order ID
            status: New status (pending, in-progress, completed, cancelled)
            editor: Who made the change
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Get current order state
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT status, station_id, created_at 
                FROM orders 
                WHERE id = %s
            """, (order_id,))
            
            result = cursor.fetchone()
            
            if not result:
                logger.error(f"Order {order_id} not found")
                return False
            
            current_status, station_id, created_at = result
            
            # Calculate completion time if completing
            completion_time = None
            if status == 'completed' and current_status != 'completed':
                completion_time = int((datetime.now() - created_at).total_seconds())
            
            # Update order status
            cursor.execute("""
                UPDATE orders 
                SET status = %s, 
                    updated_at = %s, 
                    last_modified_by = %s
                WHERE id = %s
            """, (status, datetime.now(), editor or 'system', order_id))
            
            # If completing order, update completion time and completion date
            if completion_time:
                cursor.execute("""
                    UPDATE orders 
                    SET completion_time = %s, 
                        completed_at = %s
                    WHERE id = %s
                """, (completion_time, datetime.now(), order_id))
            
            # Update station load
            if status in ['completed', 'cancelled'] and current_status not in ['completed', 'cancelled']:
                self._update_station_load(station_id, increment=False)
            elif status == 'in-progress' and current_status == 'pending':
                # No need to update load when moving from pending to in-progress
                pass
            
            self.db.commit()
            return True
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error updating order status: {str(e)}")
            return False
    
    def create_walk_in_order(self, order_data):
        """
        Create a walk-in order
        
        Args:
            order_data: Dictionary with order details
            
        Returns:
            Created order ID if successful, None otherwise
        """
        try:
            # Generate order number
            now = datetime.now()
            prefix = "W" if now.hour < 12 else "E"  # W for Walk-in Morning, E for walk-in Evening
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Assign to a station
            station_id = order_data.get('station_id', None)
            if not station_id:
                station_result = self._assign_station(order_data.get('vip', False))
                if isinstance(station_result, tuple):
                    station_id, is_delayed = station_result
                else:
                    station_id = station_result
                
                if station_id is None:
                    logger.error("No stations available for walk-in order")
                    raise Exception("No coffee stations are currently available. Please create stations through the Organizer interface.")
            
            # Process and validate order details
            if 'order_details' not in order_data:
                order_data['order_details'] = {}
            
            # Ensure order_details is a dictionary
            if isinstance(order_data['order_details'], str):
                order_data['order_details'] = json.loads(order_data['order_details'])
            
            # Add basic details if not present
            if 'name' not in order_data['order_details']:
                order_data['order_details']['name'] = order_data.get('customer_name', 'Walk-in Customer')
            
            # Add order number
            order_data['order_number'] = order_number
            
            # Set timestamps
            order_data['created_at'] = now
            order_data['updated_at'] = now
            
            # Set status
            order_data['status'] = 'pending'
            
            # Insert into database
            cursor = self.db.cursor()
            
            # Prepare data for insertion
            fields = []
            placeholders = []
            values = []
            
            for key, value in order_data.items():
                if key == 'order_details':
                    # JSON encode order details
                    fields.append(key)
                    placeholders.append('%s')
                    values.append(json.dumps(value))
                elif key not in ['id']:  # Skip fields that shouldn't be inserted
                    fields.append(key)
                    placeholders.append('%s')
                    values.append(value)
            
            # Create SQL query
            query = f"""
                INSERT INTO orders ({', '.join(fields)})
                VALUES ({', '.join(placeholders)})
                RETURNING id
            """
            
            # Execute query
            cursor.execute(query, values)
            order_id = cursor.fetchone()[0]
            
            # Update station load
            self._update_station_load(station_id, increment=True)
            
            self.db.commit()
            return order_id
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error creating walk-in order: {str(e)}")
            return None
    
    def get_customer(self, phone):
        """
        Get customer information
        
        Args:
            phone: Phone number
            
        Returns:
            Customer dictionary if found, None otherwise
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("""
                SELECT * FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            customer = cursor.fetchone()
            
            if not customer:
                return None
            
            return dict(customer)
            
        except Exception as e:
            logger.error(f"Error getting customer: {str(e)}")
            return None
    
    def get_customers(self, search=None, limit=50):
        """
        Get customers with optional search filter
        
        Args:
            search: Optional search term
            limit: Maximum number of customers to return
            
        Returns:
            List of customer dictionaries
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            
            if search:
                # Search by name or phone
                cursor.execute("""
                    SELECT * FROM customer_preferences
                    WHERE name ILIKE %s OR phone ILIKE %s
                    ORDER BY last_order_date DESC
                    LIMIT %s
                """, (f'%{search}%', f'%{search}%', limit))
            else:
                # Get all customers
                cursor.execute("""
                    SELECT * FROM customer_preferences
                    ORDER BY last_order_date DESC
                    LIMIT %s
                """, (limit,))
            
            customers = cursor.fetchall()
            
            result = []
            for customer in customers:
                result.append(dict(customer))
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting customers: {str(e)}")
            return []
    
    def get_station_stats(self, station_id=None):
        """
        Get station statistics
        
        Args:
            station_id: Optional station ID filter
            
        Returns:
            Station statistics dictionary or list of dictionaries
        """
        try:
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            
            if station_id:
                # Get specific station
                cursor.execute("""
                    SELECT * FROM station_stats
                    WHERE station_id = %s
                """, (station_id,))
                
                stats = cursor.fetchone()
                
                if not stats:
                    return None
                
                return dict(stats)
            else:
                # Get all stations
                cursor.execute("""
                    SELECT * FROM station_stats
                    ORDER BY station_id
                """)
                
                stats = cursor.fetchall()
                
                result = []
                for stat in stats:
                    result.append(dict(stat))
                
                return result
            
        except Exception as e:
            logger.error(f"Error getting station stats: {str(e)}")
            return None
    
    def update_station_wait_time(self, station_id, wait_time):
        """
        Update station wait time
        
        Args:
            station_id: Station ID
            wait_time: New wait time in minutes
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                UPDATE station_stats
                SET wait_time = %s, last_updated = %s
                WHERE station_id = %s
            """, (wait_time, datetime.now(), station_id))
            
            self.db.commit()
            return True
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error updating wait time: {str(e)}")
            return False

    def add_loyalty_points(self, phone, points, order_id=None, transaction_type='earned', notes=None):
        """
        Add loyalty points to customer account
        
        Args:
            phone: Customer phone number
            points: Number of points to add
            order_id: Optional order ID
            transaction_type: Transaction type (earned, redemption, bonus)
            notes: Optional notes
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT loyalty_points FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            now = datetime.now()
            
            if result:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences
                    SET loyalty_points = loyalty_points + %s,
                        last_order_date = %s
                    WHERE phone = %s
                """, (points, now, phone))
            else:
                # Create new customer
                cursor.execute("""
                    INSERT INTO customer_preferences
                    (phone, loyalty_points, first_order_date, last_order_date)
                    VALUES (%s, %s, %s, %s)
                """, (phone, points, now, now))
            
            # Record transaction
            cursor.execute("""
                INSERT INTO loyalty_transactions
                (phone, points, transaction_type, order_id, created_at, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (phone, points, transaction_type, order_id, now, notes))
            
            self.db.commit()
            return True
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error adding loyalty points: {str(e)}")
            return False
    
    def get_loyalty_status(self, phone):
        """
        Get customer loyalty status
        
        Args:
            phone: Customer phone number
            
        Returns:
            Loyalty status dictionary
        """
        try:
            cursor = self.db.cursor()
            
            # Get customer loyalty information
            cursor.execute("""
                SELECT loyalty_points, loyalty_free_drinks, total_orders
                FROM customer_preferences
                WHERE phone = %s
            """, (phone,))
            
            result = cursor.fetchone()
            
            if not result:
                return {
                    'points': 0,
                    'free_coffees': 0,
                    'progress': 0
                }
            
            loyalty_points, free_drinks, total_orders = result
            
            # Get points needed from config
            points_needed = self.config.get('LOYALTY_POINTS_FOR_FREE_COFFEE', 100)
            
            # Calculate free coffees and progress
            free_coffees = loyalty_points // points_needed
            progress = (loyalty_points % points_needed) / points_needed * 100
            
            return {
                'points': loyalty_points,
                'free_coffees': free_coffees,
                'progress': progress,
                'free_drinks': free_drinks or 0,
                'total_orders': total_orders or 0
            }
            
        except Exception as e:
            logger.error(f"Error getting loyalty status: {str(e)}")
            return {
                'points': 0,
                'free_coffees': 0,
                'progress': 0,
                'error': str(e)
            }
    
    def batch_process_orders(self, order_ids, action='start'):
        """
        Process a batch of orders
        
        Args:
            order_ids: List of order IDs
            action: Action to perform ('start' or 'complete')
            
        Returns:
            Number of successfully processed orders
        """
        success_count = 0
        
        for order_id in order_ids:
            try:
                if action == 'start':
                    if self.update_order_status(order_id, 'in-progress', 'batch_process'):
                        success_count += 1
                elif action == 'complete':
                    if self.update_order_status(order_id, 'completed', 'batch_process'):
                        success_count += 1
            except Exception as e:
                logger.error(f"Error processing order {order_id} in batch: {str(e)}")
        
        return success_count
    
    def send_sms_notification(self, phone, message, messaging_service=None):
        """
        Send SMS notification to customer
        
        Args:
            phone: Phone number
            message: Message text
            messaging_service: Optional MessagingService instance
            
        Returns:
            True if successful, False otherwise
        """
        # Skip if no messaging service
        if not messaging_service:
            logger.warning(f"No messaging service available to send SMS to {phone}")
            return False
        
        try:
            # Normalize phone number
            normalized_phone = self._normalize_phone(phone)
            
            # Send message
            message_sid = messaging_service.send_message(normalized_phone, message)
            
            if message_sid:
                logger.info(f"Sent SMS to {normalized_phone}: {message}")
                return True
            
            logger.warning(f"Failed to send SMS to {normalized_phone}")
            return False
            
        except Exception as e:
            logger.error(f"Error sending SMS: {str(e)}")
            return False
    
    def edit_order(self, order_id, updated_details, editor=None):
        """
        Edit an existing order
        
        Args:
            order_id: Order ID
            updated_details: Dictionary with updated details
            editor: Who made the changes
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Get current order
            cursor = self.db.cursor()
            cursor.execute("SELECT order_details, edit_history FROM orders WHERE id = %s", (order_id,))
            result = cursor.fetchone()
            
            if not result:
                logger.error(f"Order {order_id} not found")
                return False
            
            current_details_str, edit_history_str = result
            
            # Parse current details
            if isinstance(current_details_str, str):
                current_details = json.loads(current_details_str)
            else:
                current_details = current_details_str or {}
            
            # Parse edit history
            edit_history = []
            if edit_history_str:
                if isinstance(edit_history_str, str):
                    edit_history = json.loads(edit_history_str)
                else:
                    edit_history = edit_history_str
            
            # Create edit record
            edit_record = {
                'timestamp': datetime.now().isoformat(),
                'editor': editor or 'system',
                'previous': current_details.copy(),
                'changes': updated_details
            }
            
            # Add to history
            edit_history.append(edit_record)
            
            # Update order details
            for key, value in updated_details.items():
                current_details[key] = value
            
            # Save to database
            cursor.execute("""
                UPDATE orders
                SET order_details = %s,
                    edit_history = %s,
                    updated_at = %s,
                    last_modified_by = %s
                WHERE id = %s
            """, (
                json.dumps(current_details),
                json.dumps(edit_history),
                datetime.now(),
                editor or 'system',
                order_id
            ))
            
            self.db.commit()
            return True
            
        except Exception as e:
            self.db.rollback()
            logger.error(f"Error editing order: {str(e)}")
            return False
    
    def get_system_stats(self):
        """
        Get system statistics
        
        Returns:
            System statistics dictionary
        """
        try:
            cursor = self.db.cursor()
            
            # Get order counts
            cursor.execute("""
                SELECT
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                    SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_count,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                    AVG(completion_time) as avg_completion_time
                FROM orders
            """)
            
            order_stats = cursor.fetchone()
            
            # Get customer count
            cursor.execute("SELECT COUNT(*) FROM customer_preferences")
            customer_count = cursor.fetchone()[0]
            
            # Get today's orders
            today = datetime.now().date()
            cursor.execute("""
                SELECT COUNT(*) 
                FROM orders 
                WHERE DATE(created_at) = %s
            """, (today,))
            
            todays_orders = cursor.fetchone()[0]
            
            # Get active stations
            cursor.execute("""
                SELECT COUNT(*) 
                FROM station_stats 
                WHERE status = 'active'
            """)
            
            active_stations = cursor.fetchone()[0]
            
            return {
                'total_orders': order_stats[0] or 0,
                'pending_count': order_stats[1] or 0,
                'in_progress_count': order_stats[2] or 0,
                'completed_count': order_stats[3] or 0,
                'avg_completion_time': order_stats[4] or 0,
                'customer_count': customer_count or 0,
                'todays_orders': todays_orders or 0,
                'active_stations': active_stations or 0
            }
            
        except Exception as e:
            logger.error(f"Error getting system stats: {str(e)}")
            return {
                'error': str(e)
            }
    # Privacy Command Handlers
    def _handle_mydata_command(self, phone):
        """Handle MYDATA command - show customer their stored data"""
        try:
            customer = self.get_customer(phone)
            
            if not customer:
                return "No data found for your phone number. Start your first order to get personalized service!"
            
            # Format the response
            name = customer.get('name', 'Unknown')
            drink = customer.get('preferred_drink', 'Not set')
            milk = customer.get('preferred_milk', 'Not set')
            size = customer.get('preferred_size', 'Not set')
            sugar = customer.get('preferred_sugar', 'Not set')
            total_orders = customer.get('total_orders', 0)
            first_order = customer.get('first_order_date', 'Unknown')
            
            # Format date nicely
            if first_order != 'Unknown':
                try:
                    first_order_date = datetime.strptime(str(first_order), '%Y-%m-%d %H:%M:%S')
                    first_order = first_order_date.strftime('%b %Y')
                except:
                    pass
            
            response = f"""Your Coffee Cue Profile:
Name: {name}
Favorite: {drink} with {milk} milk ({size})
Sugar: {sugar}
Orders: {total_orders} total
Member since: {first_order}

Text RESET to clear preferences or DELETE to remove all data."""
            
            return response
            
        except Exception as e:
            logger.error(f"Error in MYDATA command: {str(e)}")
            return "Sorry, couldn't retrieve your data. Please try again later."
    
    def _handle_changename_command(self, phone, new_name):
        """Handle CHANGENAME command - update customer's name"""
        try:
            if not new_name:
                return "Please provide a name. Example: CHANGENAME Stephen"
            
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            if result:
                # Update existing customer
                cursor.execute("""
                    UPDATE customer_preferences
                    SET name = %s
                    WHERE phone = %s
                """, (new_name, phone))
            else:
                # Create new customer with just name
                cursor.execute("""
                    INSERT INTO customer_preferences
                    (phone, name, first_order_date, last_order_date, total_orders)
                    VALUES (%s, %s, %s, %s, 0)
                """, (phone, new_name, datetime.now(), datetime.now()))
            
            self.db.commit()
            
            return f"✅ Name updated to: {new_name}\nYour next order will use this name."
            
        except Exception as e:
            logger.error(f"Error in CHANGENAME command: {str(e)}")
            self.db.rollback()
            return "Sorry, couldn't update your name. Please try again."
    
    def _handle_reset_command(self, phone):
        """Handle RESET command - clear customer preferences but keep name"""
        try:
            cursor = self.db.cursor()
            
            # Check if customer exists
            cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
            result = cursor.fetchone()
            
            if not result:
                return "No preferences found to reset."
            
            name = result[0]
            
            # Reset preferences but keep name
            cursor.execute("""
                UPDATE customer_preferences
                SET preferred_drink = NULL,
                    preferred_milk = NULL,
                    preferred_size = NULL,
                    preferred_sugar = NULL
                WHERE phone = %s
            """, (phone,))
            
            self.db.commit()
            
            return f"✅ Preferences cleared!\nWe'll ask for your order details next time.\nYour name ({name}) is still saved."
            
        except Exception as e:
            logger.error(f"Error in RESET command: {str(e)}")
            self.db.rollback()
            return "Sorry, couldn't reset your preferences. Please try again."
    
    def _handle_delete_command(self, phone, state):
        """Handle DELETE command - request to delete all customer data"""
        # Check if we're already in deletion confirmation state
        if state.get('state') == 'awaiting_deletion_confirmation':
            return None  # Let the normal state handler deal with YES/NO
        
        # Set state to await confirmation
        self._set_conversation_state(phone, 'awaiting_deletion_confirmation')
        
        return "⚠️ This will delete all your data including order history.\nReply YES to confirm deletion or NO to cancel."
    
    def _handle_awaiting_deletion_confirmation(self, phone, message, state):
        """Handle deletion confirmation"""
        message_upper = message.upper().strip()
        
        if message_upper == 'YES':
            try:
                cursor = self.db.cursor()
                
                # Delete customer preferences
                cursor.execute("DELETE FROM customer_preferences WHERE phone = %s", (phone,))
                deleted_count = cursor.rowcount
                
                # Note: We keep order history for business records, but it's no longer linked to preferences
                
                self.db.commit()
                
                # Clear conversation state
                self._set_conversation_state(phone, 'completed')
                
                if deleted_count > 0:
                    return "✅ Your data has been deleted. Thank you for using Coffee Cue!"
                else:
                    return "No data found to delete."
                    
            except Exception as e:
                logger.error(f"Error deleting customer data: {str(e)}")
                self.db.rollback()
                return "Sorry, couldn't delete your data. Please contact support."
        
        elif message_upper == 'NO':
            # Cancel deletion
            self._set_conversation_state(phone, 'completed')
            return "Deletion cancelled. Your data is safe. How can we help you today?"
        
        else:
            return "Please reply YES to confirm deletion or NO to cancel."
    def _handle_friend_command(self, phone, state):
        """Handle FRIEND command - add a coffee for a friend"""
        try:
            # Get customer info
            customer = self.get_customer(phone)
            if not customer or not customer.get("name"):
                return "Please start with your own order first. Text us your coffee order to begin!"
            
            primary_name = customer.get("name")
            
            # Check if they have a recent order (within last hour)
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT id, order_number, order_details, station_id, created_at
                FROM orders
                WHERE phone = %s 
                AND created_at > %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (phone, datetime.now() - timedelta(hours=1)))
            
            recent_order = cursor.fetchone()
            
            if not recent_order:
                return f"Hi {primary_name}! Please place your own order first, then you can add coffees for friends."
            
            # Parse the recent order details
            order_id, order_number, order_details_json, station_id, created_at = recent_order
            
            if isinstance(order_details_json, str):
                primary_order = json.loads(order_details_json)
            else:
                primary_order = order_details_json or {}
            
            # Start friend order flow
            self._set_conversation_state(phone, "awaiting_friend_name", {
                "primary_name": primary_name,
                "primary_order": primary_order,
                "group_orders": [],
                "station_id": station_id,
                "reference_order": order_number
            })
            
            return f"Great! Let's add a coffee for your friend. What's their name?"
            
        except Exception as e:
            logger.error(f"Error in FRIEND command: {str(e)}")
            return "Sorry, couldn't process your request. Please try again."

