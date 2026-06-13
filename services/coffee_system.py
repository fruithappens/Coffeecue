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
        # Boot-time fallback. The `event_name` property below reads
        # the LIVE value from branding_settings on each access so
        # operator edits via the Branding panel flow through to SMS
        # responses immediately (no restart needed).
        self._event_name_boot = config.get('EVENT_NAME', 'Coffee Event')

        # Initialize conversation states dictionary
        self.conversation_states = {}

        # Stale conversation timeout — if a customer starts an order
        # ("latte") and the bot is mid-flow asking for milk, but they
        # never reply, the state would otherwise linger forever.
        # When they text again hours later their reply would land in
        # `_handle_awaiting_milk` and confuse them. Reset the state
        # after this many minutes of inactivity so the next message
        # starts a fresh conversation.
        self.stale_conversation_minutes = config.get('STALE_CONVERSATION_MINUTES', 20)
        
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
    
    @property
    def event_name(self):
        """Live event name — reads branding_settings on each access.

        Falls back to the boot-time EVENT_NAME config value if the
        branding row isn't set yet. Cached for a short window to
        avoid hitting the DB on every SMS.
        """
        # Short cache so a high-volume burst doesn't hit DB N times.
        cached = getattr(self, '_event_name_cache', None)
        if cached and (datetime.now() - cached[1]).total_seconds() < 30:
            return cached[0]
        name = self._event_name_boot
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute("SELECT value FROM settings WHERE key = 'branding_settings'")
            row = cursor.fetchone()
            if row and row[0]:
                blob = row[0]
                if isinstance(blob, str):
                    blob = json.loads(blob)
                if isinstance(blob, dict):
                    candidate = (
                        blob.get('event_name')
                        or blob.get('eventName')
                        or blob.get('landingTitle')
                        or blob.get('clientName')
                    )
                    if candidate:
                        name = candidate
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        self._event_name_cache = (name, datetime.now())
        return name

    @event_name.setter
    def event_name(self, value):
        """Allow tests / config to set event_name explicitly."""
        self._event_name_boot = value
        # Invalidate the cache so the next read picks it up.
        self._event_name_cache = None

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
            # IMPORTANT: keep {event_name} as a literal PLACEHOLDER here, not
            # an f-string. An f-string bakes the current event name into the
            # stored row, so renaming the event later never updates the SMS
            # welcome (customers kept getting a previous event's name). The
            # SMS handler substitutes {event_name} with the live event name
            # at send time.
            default_settings = [
                ('sms_welcome_message', "Welcome to {event_name}! I'll take your coffee order. What's your first name?",
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

            # Self-heal databases seeded by the old f-string bug: if the
            # stored welcome message has the event name baked in (no
            # {event_name} placeholder), reset it to the templated default so
            # it tracks the live event again. No UI customises this message,
            # so a placeholder-less value is always the stale seed — safe to
            # restore. This is what fixes "still getting the old event name in
            # the SMS welcome" on existing deployments.
            try:
                cursor.execute("SELECT value FROM settings WHERE key = 'sms_welcome_message'")
                _wm = cursor.fetchone()
                _wm_val = (_wm[0] if _wm else '') or ''
                if _wm_val and '{event_name}' not in _wm_val:
                    cursor.execute(
                        "UPDATE settings SET value = %s WHERE key = 'sms_welcome_message'",
                        ("Welcome to {event_name}! I'll take your coffee order. What's your first name?",),
                    )
                    logger.warning(
                        "Healed sms_welcome_message: stripped baked-in event name, "
                        "restored {event_name} placeholder"
                    )
            except Exception as _heal_err:
                logger.warning(f"sms_welcome_message self-heal skipped: {_heal_err}")

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
            
            # Ensure the station_stats schema has all the columns the
            # rest of the app expects. Historically the rename UI
            # appeared broken because `station_stats.notes` (where the
            # station "name" lives, for legacy reasons) simply didn't
            # exist on freshly-initialised databases — the UPDATE
            # silently failed and the new name was discarded. Same for
            # `equipment_notes` (which holds the location). IF NOT
            # EXISTS makes these safe to run on every boot.
            cursor.execute("""
                ALTER TABLE station_stats
                ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10,
                ADD COLUMN IF NOT EXISTS notes TEXT,
                ADD COLUMN IF NOT EXISTS equipment_notes TEXT,
                ADD COLUMN IF NOT EXISTS name TEXT,
                ADD COLUMN IF NOT EXISTS location TEXT
            """)
            # customer_preferences was missing the is_vip column on
            # most installs — _handle_vip_code crashed with "column
            # does not exist" and customers got "Sorry, we couldn't
            # process your VIP code". Same pattern as the station
            # rename bug. Adding the column for existing DBs here.
            cursor.execute("""
                ALTER TABLE customer_preferences
                ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE
            """)
            # users.is_active is referenced by support_api_routes.py
            # (UserManagement panel and the /api/users CRUD) but was
            # never in the schema — GET /api/users 500'd with
            # "column is_active does not exist" on every Support →
            # Users visit.
            cursor.execute("""
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
            """)
            self.db.commit()

            # Seed default capabilities for stations that don't have
            # them yet — preserves user-customised JSONB across boots.
            cursor.execute("""
                UPDATE station_stats
                SET capabilities = json_build_object(
                    'alt_milk', TRUE,
                    'high_volume', station_id = 1,
                    'vip_service', station_id = 3
                )
                WHERE capabilities IS NULL OR capabilities = '{}'::jsonb
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

        # Defensive: if a previous request left the shared `self.db`
        # connection in an aborted-transaction state (psycopg2 surfaces
        # this as "current transaction is aborted, commands ignored
        # until end of transaction block"), every subsequent read here
        # silently fails — customer says "latte" and gets back "Sorry,
        # we don't offer latte" because the inventory lookup couldn't
        # run. Rolling back at the start of each SMS turn isolates each
        # conversation from a poisoned predecessor.
        try:
            self.db.rollback()
        except Exception:
            pass
        
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

        # BARISTA escape hatch: if the previous message was "BARISTA",
        # we're capturing the customer's question. Their THIS message
        # is the question — not a command. Handle this BEFORE
        # _handle_commands so "STATUS" / "MENU" etc don't intercept.
        if state.get('state') == 'awaiting_barista_question':
            # Pop the state — the bare BARISTA prompt is one-shot.
            # We restore to whatever they were doing before (default
            # to 'completed' so the next message starts fresh).
            prev = (state.get('temp_data') or {}).get('previous_state')
            self._set_conversation_state(
                phone, prev or 'completed', state.get('temp_data') or {},
            )
            return self._forward_question_to_baristas(phone, message_body, state)

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
        # 'menu' deliberately excluded — it's a real command handled
        # by _handle_options_menu_command, not a greeting. Including
        # it here caused MENU to fall through to the welcome message
        # and never show the actual menu.
        help_commands = ['help', 'info', 'how', 'instructions', '?']
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
    
    def _all_available_milks_lowercased(self):
        """Return a set of milk names (lowercase) available at ANY
        currently-active station.

        Used by _get_usual_order_suggestion to gate "your usual"
        proposals against what stations actually serve today. Without
        this, the SMS flow happily suggested a milk no station had
        configured and the customer got an order that no barista
        could fulfil.

        Returns None on read failure — the caller treats that as "no
        restriction" so the bot stays responsive when the stations
        table is briefly unreadable.
        """
        try:
            cursor = self.db.cursor()
            # Read capabilities from EVERY station, not just active —
            # the schema is inconsistent (some installs have stations.active
            # BOOL, some have stations.status TEXT) and we don't want a
            # schema-shape mismatch to silently disable the gate. An
            # inactive station's capabilities still tell us what milks
            # COULD be served, which is the right thing for the SMS
            # "is this even on the menu?" check.
            cursor.execute("SELECT capabilities FROM station_stats")
            rows = cursor.fetchall() or []
        except Exception as e:
            logger.warning(
                "_all_available_milks_lowercased: read failed: %s", e,
            )
            try:
                self.db.rollback()
            except Exception:
                pass
            return None

        milks = set()
        for row in rows:
            caps = row[0] if not isinstance(row, dict) else row.get('capabilities')
            if not caps:
                continue
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    continue
            if not isinstance(caps, dict):
                continue
            for m in (caps.get('milk_types') or caps.get('milks') or []):
                milks.add(str(m).strip().lower())
        return milks

    def _get_usual_order_suggestion(self, phone, name):
        """Get usual order suggestions based on previous orders.

        The previous wording claimed "which you often enjoy around
        this time" but the underlying logic doesn't actually filter
        by hour-of-day — it offers the same usual regardless of when
        the customer texts. Dropped the misleading time claim. Also
        now includes decaf prefix + strength tail so a regular's full
        usual ("strong decaf flat white") replays exactly.
        """
        try:
            # Check for customer preferences. Try the richer SELECT
            # first; fall back if migration #6 hasn't been applied.
            cursor = self.db.cursor()
            strength = None
            decaf = False
            try:
                cursor.execute(
                    "SELECT preferred_drink, preferred_milk, preferred_size, "
                    "preferred_sugar, preferred_strength, preferred_decaf "
                    "FROM customer_preferences WHERE phone = %s",
                    (phone,)
                )
                row = cursor.fetchone()
                if row:
                    if isinstance(row, dict):
                        drink = row.get('preferred_drink')
                        milk = row.get('preferred_milk')
                        size = row.get('preferred_size')
                        sugar = row.get('preferred_sugar')
                        strength = row.get('preferred_strength')
                        decaf = bool(row.get('preferred_decaf'))
                    else:
                        drink, milk, size, sugar, strength, decaf = row
                        decaf = bool(decaf)
                else:
                    drink = milk = size = sugar = None
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass
                cursor = self.db.cursor()
                cursor.execute(
                    "SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar FROM customer_preferences WHERE phone = %s",
                    (phone,)
                )
                row = cursor.fetchone()
                if row:
                    if isinstance(row, dict):
                        drink = row.get('preferred_drink')
                        milk = row.get('preferred_milk')
                        size = row.get('preferred_size')
                        sugar = row.get('preferred_sugar')
                    else:
                        drink, milk, size, sugar = row
                else:
                    drink = milk = size = sugar = None

            # Capability gate: don't offer a usual we can't make.
            #
            # Without this, the SMS bot suggests the customer's saved
            # preferred drink + milk regardless of what stations are
            # actually serving today. Steve hit it with "Your usual
            # medium latte with coconut" when no station had coconut
            # configured — the order was created anyway and then no
            # barista could start it.
            #
            # If the saved milk isn't available at any active station,
            # silently fall back to the "What can I get you today?"
            # opener WITHOUT pre-filling the unavailable milk. The
            # customer types their actual order; the regular validation
            # downstream picks an appropriate station.
            if drink and milk:
                try:
                    available_milks = self._all_available_milks_lowercased()
                except Exception:
                    available_milks = None  # Treat unknown as "no restriction"
                if available_milks is not None and milk:
                    milk_lc = str(milk).strip().lower()
                    # Canonicalise common synonyms before comparing
                    milk_canon = {
                        'whole milk': 'full cream', 'whole': 'full cream',
                        'regular': 'full cream', 'standard': 'full cream',
                        'dairy': 'full cream',
                    }.get(milk_lc, milk_lc)
                    if milk_canon not in available_milks and milk_lc not in available_milks:
                        logger.info(
                            "_get_usual_order_suggestion: preferred milk %r "
                            "is not stocked at any active station; suppressing "
                            "usual suggestion for %s", milk, phone,
                        )
                        return (
                            f"Hi {name}! What can I get you today? "
                            f"(Just letting you know — {milk} isn't on at any "
                            f"station right now.)"
                        )

            if drink:
                # Build a suggestion message with full fidelity
                if all([drink, milk, size]):
                    drink_label = f"decaf {drink}" if decaf else drink
                    sugar_text = f", {sugar}" if sugar else ""
                    strength_text = f" ({strength})" if strength else ""
                    return (
                        f"What can I get you today, {name}? Your usual "
                        f"{size} {drink_label} with {milk} milk{sugar_text}"
                        f"{strength_text}?"
                    )

            # If no preferences, check previous orders
            cursor = self.db.cursor()
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

        # Demo-only "forget me" command.
        #
        # Steve uses one phone for demos. Without this, every demo SMS
        # gets greeted "Hi Steve! Your usual...?" because of the saved
        # preference + order history. That's the right UX for real
        # regulars but wrecks a first-time-customer demo.
        #
        # FORGETME (single word, case-insensitive) wipes:
        #   - customer_preferences row for this phone (name + saved drink)
        #   - all past orders for this phone (so the order-history
        #     fallback in _get_usual_order_suggestion has nothing to
        #     suggest from)
        #   - in-memory conversation state so the next message restarts
        #     from "What's your first name?"
        #
        # Distinctive single word so a real customer is very unlikely
        # to type it by accident.
        elif message_upper == 'FORGETME':
            return self._handle_forgetme_command(phone)

        # BARISTA escape hatch — "I need to talk to a human".
        #
        # Format options:
        #   BARISTA                  → bot asks for the question next
        #   BARISTA is the milk fresh? → question = "is the milk fresh?"
        #   STAFF / HELPME           → aliases (HELP is Twilio-reserved)
        #
        # The question gets queued in customer_questions; the Barista UI
        # sees a badge + modal via WebSocket; first barista to answer
        # SMSes the customer back. After 60s of no answer the timeout
        # sweeper sends the "all busy" fallback.
        elif message_upper == 'BARISTA' or message_upper == 'STAFF' or message_upper == 'HELPME':
            return self._handle_barista_command(phone, message, state, question_text=None)
        elif message_upper.startswith('BARISTA ') or message_upper.startswith('STAFF ') or message_upper.startswith('HELPME '):
            # Extract everything after the keyword as the question.
            for kw in ('BARISTA ', 'STAFF ', 'HELPME '):
                if message_upper.startswith(kw):
                    question_text = message[len(kw):].strip()
                    break
            return self._handle_barista_command(phone, message, state, question_text=question_text)

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
    
    def _handle_barista_command(self, phone, message, state, question_text=None):
        """Customer wants to talk to a real person.

        Two entry shapes:
          1. Bare "BARISTA" → question_text is None → ask the customer
             to type their question. Conversation state switches to
             'awaiting_barista_question'. Their NEXT message becomes the
             question (handled in handle_sms below by checking the state).
          2. "BARISTA <question>" → forward the question immediately.

        Forwarding writes to customer_questions, emits a WebSocket
        event so the Barista UI shows the badge, and tells the customer
        we've sent it. The 60-second timeout sweeper (services/
        question_timeout.py) handles the no-answer fallback.
        """
        if not question_text:
            # Bare command — pivot conversation to capture the question.
            self._set_conversation_state(
                phone, 'awaiting_barista_question',
                {**(state.get('temp_data') or {})},
            )
            return (
                "👋 Sure — type your question and I'll send it straight to the "
                "team. They'll text back within a minute."
            )

        return self._forward_question_to_baristas(phone, question_text, state)

    def _forward_question_to_baristas(self, phone, question_text, state):
        """Insert the question into customer_questions, push a WS event,
        and reply to the customer. Shared between the inline-question
        path and the awaiting_barista_question state handler.

        Never raises — a failure here means the customer gets a soft
        error instead of the bot crashing.
        """
        # Pull the customer's name if we know it (from preferences or
        # the current conversation's temp_data), so the barista UI can
        # show "Steve asked: ..." rather than just a phone number.
        customer_name = ''
        try:
            customer = self.get_customer(phone)
            if customer:
                customer_name = customer.get('name', '') or ''
        except Exception:
            pass
        if not customer_name:
            customer_name = (
                (state.get('temp_data') or {}).get('name', '')
                if isinstance(state, dict) else ''
            )

        question_text = (question_text or '').strip()
        if not question_text:
            return (
                "Didn't catch a question. Just text it again, e.g. "
                "'BARISTA is the milk fresh today?'"
            )

        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute(
                """
                INSERT INTO customer_questions
                  (phone, customer_name, question, status, created_at)
                VALUES (%s, %s, %s, 'pending', %s)
                RETURNING id, created_at
                """,
                (phone, customer_name, question_text, datetime.now()),
            )
            row = cursor.fetchone()
            self.db.commit()
            question_id = row[0] if row else None
            created_at = row[1] if row else datetime.now()
        except Exception as e:
            logger.error(f"_forward_question_to_baristas: insert failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return (
                "Sorry, our system hiccuped sending your question — "
                "try again in a moment, or ask at the counter."
            )

        # Push a WebSocket event so any open Barista UI lights up the
        # badge without waiting for its 15s poll cycle.
        try:
            from flask import current_app as _ca
            socketio = _ca.config.get('socketio') if _ca else None
            if socketio:
                payload = {
                    'id': question_id,
                    'phone': phone,
                    'customer_name': customer_name,
                    'customerName': customer_name,
                    'question': question_text,
                    'created_at': created_at.isoformat() + 'Z' if hasattr(created_at, 'isoformat') else str(created_at),
                    'createdAt': created_at.isoformat() + 'Z' if hasattr(created_at, 'isoformat') else str(created_at),
                    'status': 'pending',
                }
                # Broadcast to all stations — first to answer wins.
                socketio.emit('customer_question', payload, room='orders')
        except Exception as ws_err:
            logger.debug(f"customer_question WS emit skipped: {ws_err}")

        # Acknowledge to the customer. Keep their conversation state as
        # whatever it was BEFORE the BARISTA detour, so their next
        # message picks up where they left off (e.g. they were
        # mid-order). The barista's reply lands as a separate SMS, no
        # state churn needed.
        return (
            "✅ Sent your question to the team. They'll text back within "
            "60 seconds. (If they're slammed, I'll let you know.)"
        )

    def _handle_forgetme_command(self, phone):
        """Handle FORGETME command — wipe this phone's customer record.

        Used for demos. Deletes:
          1. customer_preferences row (name, saved drink, milk, size, etc).
          2. All past orders for this phone (so the order-history fallback
             in _get_usual_order_suggestion has nothing to mine).
          3. In-memory conversation state (so the next message restarts at
             the "What's your first name?" welcome).

        After this returns, the very next SMS from `phone` should be
        treated by the system as if it came from a brand-new number.

        Returns a short confirmation SMS. Never raises — a failure here
        is annoying (customer keeps being recognised) but not blocking.
        """
        try:
            cursor = self.db.cursor()

            # Defensive rollback in case the singleton connection is
            # mid-transaction from a prior failed read.
            try:
                self.db.rollback()
            except Exception:
                pass

            # Count what we're about to delete so the confirmation
            # message can show "wiped 3 orders + 1 preference row".
            try:
                cursor.execute(
                    "SELECT COUNT(*) FROM customer_preferences WHERE phone = %s",
                    (phone,),
                )
                pref_count = (cursor.fetchone() or [0])[0]
            except Exception:
                pref_count = 0
                try:
                    self.db.rollback()
                except Exception:
                    pass

            try:
                cursor.execute(
                    "SELECT COUNT(*) FROM orders WHERE phone = %s",
                    (phone,),
                )
                order_count = (cursor.fetchone() or [0])[0]
            except Exception:
                order_count = 0
                try:
                    self.db.rollback()
                except Exception:
                    pass

            # Delete customer preferences.
            try:
                cursor.execute(
                    "DELETE FROM customer_preferences WHERE phone = %s",
                    (phone,),
                )
            except Exception as e:
                logger.warning(f"FORGETME: pref delete failed for {phone}: {e}")
                try:
                    self.db.rollback()
                except Exception:
                    pass

            # Delete past orders. Foreign-key references (e.g.
            # conversation_history) could in theory block this; we
            # swallow any failure so the user still gets a response.
            try:
                cursor.execute(
                    "DELETE FROM orders WHERE phone = %s",
                    (phone,),
                )
            except Exception as e:
                logger.warning(f"FORGETME: order delete failed for {phone}: {e}")
                try:
                    self.db.rollback()
                except Exception:
                    pass

            self.db.commit()

            # Clear in-memory conversation state.
            try:
                if isinstance(self.conversation_states, dict):
                    self.conversation_states.pop(phone, None)
            except Exception:
                pass

            logger.info(
                "FORGETME: wiped %d pref row(s), %d order(s) for %s",
                pref_count, order_count, phone,
            )

            return (
                "🧹 Forgotten! Your saved name, preferences, and "
                f"{order_count} past order(s) have been wiped. "
                "Text us again to start fresh as a new customer."
            )

        except Exception as e:
            logger.error(f"FORGETME failed for {phone}: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return (
                "Sorry — couldn't fully reset your record right now. "
                "Try again in a moment."
            )

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
        """MENU / OPTIONS command — return the live, current menu so the
        customer knows exactly what to order.

        Old version queried a `stations` table that doesn't exist on
        this schema (capabilities are on station_stats), failed, and
        fell back to a hardcoded list — so the "menu" customers got
        had no relationship to what was actually in stock. Now uses
        the same _get_available_* helpers that the order-validation
        path uses, so the menu always matches what the bot will
        actually accept.

        Also surfaces which milks are only at one station (so a
        customer ordering soy isn't surprised when they're routed
        somewhere specific) and which non-coffee drinks (chai,
        matcha, hot chocolate, tea) are stocked for this event.
        """
        try:
            # Live menu sources — same as order validation
            available_coffees = self._get_available_coffee_types()
            available_milks = self._get_available_milk_types()
            available_sweeteners = self._get_available_sweeteners()
            sizes = self._get_available_sizes('latte') or ['small', 'medium', 'large']

            # Non-coffee drinks the operator has stocked for this event
            # (the Quick Setup wizard adds these to the 'drinks' category).
            extra_drinks = []
            try:
                # Reset any aborted-transaction state before this read.
                self.db.rollback()
            except Exception:
                pass
            try:
                cursor = self.db.cursor()
                cursor.execute("""
                    SELECT name FROM inventory_items
                    WHERE category = 'drinks'
                      AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                    ORDER BY name
                """)
                extra_drinks = [row[0] for row in cursor.fetchall()]
            except Exception as e:
                logger.warning(f"Couldn't read extra drinks: {e}")

            # Which milks are only available at one station? Customers
            # ordering one of those should know they'll be routed.
            milk_station_map = self._milk_to_stations_map() if not self._is_unlimited_stock_mode() else {}
            single_station_milks = [m for m, ids in milk_station_map.items() if len(ids) == 1]

            # Steve's MENU concision request: customers don't need to
            # see "0,1,2,3,4 sugars" enumerated; they don't need every
            # methodology-named espresso variant either. Strip and
            # summarise.
            #
            # 1. Dedup tea/extras out of the Coffee line. _STANDARD_DRINK_MENU
            #    pulls chai latte etc from catalog AND we re-list them
            #    under "Other drinks" — show each once.
            # 2. Coffee: top 5 most-common drinks the customer will
            #    actually recognise; hint that we accept the rest by
            #    name. Avoids "americano, cortado, espresso, flat white,
            #    latte, long black, macchiato, mocha, piccolo" wall of text.
            # 3. Sweetener: collapse consecutive integer sugars to a
            #    range like "0-3 sugars". Customers don't need every
            #    enumeration; they just text the number.

            POPULAR_COFFEE = ['latte', 'flat white', 'cappuccino', 'espresso', 'long black']
            extra_drinks_lower = {(d or '').lower() for d in extra_drinks}
            available_coffees_lower = {(c or '').lower() for c in available_coffees}

            # Filter out anything that's actually a tea or "other drink"
            # to avoid duplication. e.g. "chai latte" lives under "Other".
            coffee_only = [
                c for c in available_coffees
                if (c or '').lower() not in extra_drinks_lower
                and 'tea' not in (c or '').lower()
            ]
            # Pick popular ones first, then add any others the operator
            # has configured but cap at ~6 for readability.
            shown = [c for c in POPULAR_COFFEE if c in available_coffees_lower]
            remaining = [c for c in coffee_only if c.lower() not in {s.lower() for s in shown}]
            extra_count = max(0, len(remaining))
            # Take up to 1 extra "interesting" drink (e.g. mocha) so the
            # operator's customisation isn't completely hidden.
            shown += remaining[:1]
            coffee_line_tail = ''
            if extra_count > 1:
                coffee_line_tail = f" (+{extra_count - 1} more — just text the name)"

            # Build the message
            lines = ['☕ Menu:']
            if shown:
                lines.append(f"Coffee: {', '.join(shown)}{coffee_line_tail}")
            elif available_coffees:
                lines.append(f"Coffee: {', '.join(sorted(available_coffees)[:6])}")
            else:
                lines.append("Coffee: (none in stock — check back soon)")

            # Split out teas as their own line.
            teas = [d for d in extra_drinks if 'tea' in d.lower()]
            other_drinks = [d for d in extra_drinks if 'tea' not in d.lower()]
            if teas:
                # Drop the trailing " tea" since the line is already "Tea:"
                teas_short = [t.lower().replace(' tea', '').strip() or t for t in teas]
                lines.append(f"🍵 Tea: {', '.join(teas_short)}")
            if other_drinks:
                lines.append(f"Other: {', '.join(other_drinks)}")

            if available_milks:
                # Cap at 6 for visual cleanliness; if more configured,
                # hint that we accept others.
                milks_sorted = sorted(available_milks)
                milk_tail = ''
                if len(milks_sorted) > 6:
                    milk_tail = f" (+{len(milks_sorted) - 6} more)"
                    milks_sorted = milks_sorted[:6]
                lines.append(f"🥛 Milk: {', '.join(milks_sorted)}{milk_tail}")
            else:
                lines.append("🥛 Milk: (none in stock)")

            if available_sweeteners:
                lines.append(f"🍯 {self._summarise_sweeteners(available_sweeteners)}")

            lines.append(f"📏 Size: {', '.join(sizes)}")

            if single_station_milks:
                lines.append('')
                lines.append(
                    f"💡 {', '.join(single_station_milks)} only at certain stations — "
                    f"we'll route automatically."
                )

            lines.append('')
            # Build a context-aware example using a real available size+milk.
            example_size = (sizes[0] if sizes else 'medium')
            example_milk = next(
                (m for m in ['oat', 'full cream', 'skim', 'almond', 'lactose free'] if m in available_milks),
                'full cream',
            )
            lines.append(f"Reply with your order, e.g. '{example_size} {example_milk} latte 1 sugar'")
            return '\n'.join(lines)

        except Exception as e:
            logger.error(f"Error building dynamic menu: {str(e)}")
            # Static fallback — only used if the helpers themselves crash.
            return (
                "☕ Coffee: Latte, Cappuccino, Flat White, Long Black, Espresso, Mocha\n"
                "🥛 Milk: Full Cream, Skim, Soy, Almond, Oat\n"
                "🍯 Sugar: None, 1, 2, 3\n"
                "📏 Size: Small, Medium, Large\n\n"
                "Reply with your choice (e.g., 'large oat latte 1 sugar')"
            )

    def _milk_to_stations_map(self):
        """Build a {milk_name: [station_ids]} map from station_stats.

        Used by the MENU handler to flag specialty milks that are only
        carried at one station. Returns {} on error or empty config.
        """
        try:
            self.db.rollback()
        except Exception:
            pass
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT station_id, COALESCE(capabilities, '{}'::jsonb) AS caps
                FROM station_stats
                WHERE COALESCE(status, 'active') IN ('active', 'open')
            """)
            mapping = {}
            for row in cursor.fetchall():
                station_id = row[0] if not isinstance(row, dict) else row['station_id']
                caps = row[1] if not isinstance(row, dict) else row['caps']
                if isinstance(caps, str):
                    import json as _json
                    try:
                        caps = _json.loads(caps)
                    except (TypeError, ValueError):
                        caps = {}
                if not isinstance(caps, dict):
                    continue
                for milk in caps.get('milk_types', []) or []:
                    mapping.setdefault(milk, []).append(station_id)
            return mapping
        except Exception as e:
            logger.warning(f"_milk_to_stations_map failed: {e}")
            return {}
    
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
            # Suggest usual order if they have one. Include decaf
            # prefix and strength tail so a regular's full usual
            # ("strong decaf flat white") replays exactly.
            usual_order = self._get_usual_order_details(phone)
            if usual_order:
                coffee_type = usual_order.get('type', 'coffee')
                milk = usual_order.get('milk', 'milk')
                size = usual_order.get('size', 'regular')
                strength = usual_order.get('strength')
                decaf = usual_order.get('decaf')
                drink_label = f"decaf {coffee_type}" if decaf else coffee_type
                strength_text = f" ({strength})" if strength else ""

                # Save name and set suggestion context
                self._set_conversation_state(phone, 'awaiting_coffee_type', {
                    'name': name,
                    'suggestion_context': 'usual_order'  # Mark that we've suggested their usual order
                })

                return (
                    f"Nice to meet you, {name}! Would you like your usual "
                    f"{size} {drink_label} with {milk}{strength_text}? "
                    f"Reply YES or tell me what you'd like."
                )
        
        # For new customers or those without usual orders
        self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
        # Previously this said "Default: medium, full cream, no sugar"
        # which advertised behaviour the bot doesn't actually do — the
        # state machine asks for each missing field (apply_defaults=False).
        # Replaced with a more honest example.
        #
        # The "large oat latte" example was hardcoded — but if the
        # operator only configured Medium in Quick Setup (Steve's case),
        # the example invited customers to order a size we don't have.
        # Build the example from what's actually available.
        try:
            sizes = self._get_available_sizes() or ['medium']
            milks = self._get_available_milk_types() or ['full cream']
            example_size = sizes[0]
            example_milk = next(
                (m for m in ['oat', 'full cream', 'skim', 'almond', 'lactose free']
                 if m in milks),
                milks[0] if milks else 'full cream',
            )
        except Exception:
            example_size, example_milk = 'medium', 'full cream'

        return (
            f"Hi {name}! What can I get you?\n"
            f"Examples: \"{example_size} {example_milk} latte 1 sugar\", "
            f"\"flat white\", \"earl grey tea\"\n"
            f"Reply MENU to see what's on offer."
        )
    
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
        """Get the customer's usual order details.

        Reads strength + decaf as well as the core type/milk/size/sugar
        fields so a regular's "usual" replay actually reflects how they
        actually order. preferred_strength + preferred_decaf are
        tolerated-missing (older DBs without migration #6 just return
        None for those fields).
        """
        try:
            cursor = self.db.cursor()
            # Try the richer SELECT first. If the columns don't exist
            # (migration #6 hasn't been applied), fall back.
            try:
                cursor.execute("""
                    SELECT preferred_drink, preferred_milk, preferred_size,
                           preferred_sugar, preferred_notes,
                           preferred_strength, preferred_decaf
                    FROM customer_preferences
                    WHERE phone = %s
                """, (phone,))
                result = cursor.fetchone()
                has_strength_cols = True
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass
                cursor = self.db.cursor()
                cursor.execute("""
                    SELECT preferred_drink, preferred_milk, preferred_size,
                           preferred_sugar, preferred_notes
                    FROM customer_preferences
                    WHERE phone = %s
                """, (phone,))
                result = cursor.fetchone()
                has_strength_cols = False

            if result:
                if has_strength_cols:
                    if isinstance(result, dict):
                        coffee_type = result.get('preferred_drink')
                        milk = result.get('preferred_milk')
                        size = result.get('preferred_size')
                        sugar = result.get('preferred_sugar')
                        notes = result.get('preferred_notes')
                        strength = result.get('preferred_strength')
                        decaf = result.get('preferred_decaf')
                    else:
                        coffee_type, milk, size, sugar, notes, strength, decaf = result
                else:
                    if isinstance(result, dict):
                        coffee_type = result.get('preferred_drink')
                        milk = result.get('preferred_milk')
                        size = result.get('preferred_size')
                        sugar = result.get('preferred_sugar')
                        notes = result.get('preferred_notes')
                    else:
                        coffee_type, milk, size, sugar, notes = result
                    strength, decaf = None, False

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

                    if strength:
                        order_details['strength'] = strength

                    if decaf:
                        order_details['decaf'] = True

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
            
            # Format order summary — include decaf prefix and strength
            # tail so a regular's full usual ("strong decaf double-shot
            # flat white") replays exactly, not collapsed to "flat white".
            coffee_type = usual_order.get('type', 'coffee')
            milk = usual_order.get('milk', 'milk')
            size = usual_order.get('size', 'medium')
            sugar = usual_order.get('sugar', 'no sugar')
            strength = usual_order.get('strength')
            decaf = usual_order.get('decaf')

            drink_label = f"decaf {coffee_type}" if decaf else coffee_type
            summary = f"{size} {drink_label} with {milk}, {sugar}"
            if strength:
                summary += f" ({strength})"

            return (
                f"Great, {name}! Here's your usual order: {summary}"
                f"{self._format_price_tail(usual_order)}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )
        else:
            # No usual order found
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return f"You don't have a saved usual order yet. What type of coffee would you like, {name}?"
    
    # The standard espresso-based drink menu — returned when coffee
    # beans are in stock OR when unlimited-stock mode is on.
    #
    # Was previously a hardcoded list — adding a new drink (e.g.
    # 'cold brew') required a code edit. Now reads from
    # catalog_items WHERE category='drink' AND subcategory='espresso',
    # so adding a drink in the catalog (or via /api/catalog POST)
    # propagates to SMS recognition without redeploy.
    #
    # Kept as a static fallback constant for when the DB is
    # unreachable (booting before the catalog exists, demo mode).
    _STANDARD_DRINK_MENU_FALLBACK = ["latte", "cappuccino", "flat white",
                                     "long black", "espresso", "mocha"]

    def _get_espresso_drink_menu(self):
        """Return the espresso-based drink menu from catalog_items.

        Cached for the lifetime of the CoffeeOrderSystem instance —
        a new drink added at runtime requires a restart to pick up
        (acceptable since adding drinks is a rare operator action).
        Falls back to the hardcoded list if catalog_items is empty
        or unreachable.
        """
        if hasattr(self, '_espresso_menu_cache'):
            return self._espresso_menu_cache
        try:
            cur = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cur.execute("""
                SELECT short_name, display_name
                FROM catalog_items
                WHERE category = 'drink'
                  AND subcategory = 'espresso'
                  AND is_active = TRUE
                ORDER BY sort_order
            """)
            rows = cur.fetchall()
            if rows:
                # Prefer short_name (lowercase, no parens) — matches
                # what the SMS conversation pattern matchers expect.
                menu = [r[0] or (r[1] or '').lower() for r in rows]
                self._espresso_menu_cache = menu
                return menu
        except Exception as e:
            logger.warning(f"catalog espresso menu read failed, using fallback: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
        self._espresso_menu_cache = list(self._STANDARD_DRINK_MENU_FALLBACK)
        return self._espresso_menu_cache

    # Back-compat shim: existing code references self._STANDARD_DRINK_MENU
    # as if it were a list. Make it a property that calls the getter so
    # we don't have to find-and-replace every callsite in one go.
    @property
    def _STANDARD_DRINK_MENU(self):
        return self._get_espresso_drink_menu()

    def _get_event_enabled_coffees(self):
        """Lowercased names of coffees ENABLED in the Organiser's
        event-inventory store (settings KV 'event_inventory'), or None
        when that store is absent/empty — None means "no filter".

        Fix for: organiser disables a coffee (e.g. americano) but SMS
        kept selling it. The espresso menu comes from catalog_items;
        the per-EVENT on/off switches live in event_inventory['coffee'].
        The two were never intersected.
        (tests/persistence FINDINGS, task #44)

        Reads the settings TABLE directly — _get_setting() caches values
        for the process lifetime, which would make an Organiser toggle
        invisible until restart. This must be live on the next SMS turn.
        """
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'event_inventory'")
            row = cursor.fetchone()
            raw = row[0] if row and row[0] else None
            if not raw:
                return None
            data = json.loads(raw) if isinstance(raw, str) else raw
            coffees = data.get('coffee') or []
            names = {
                str(c.get('name', '')).strip().lower()
                for c in coffees
                if isinstance(c, dict) and c.get('enabled', True)
            }
            return names or None
        except Exception as e:
            logger.debug(f"_get_event_enabled_coffees: {e}")
            return None

    def _is_unlimited_stock_mode(self):
        """When the Quick Setup wizard sets 'unlimited_stock', the
        operator isn't tracking stock for this event — skip the
        "we're out of X" branches so customers don't get spurious
        rejections. Cached at first call to avoid hitting the DB on
        every conversation turn.
        """
        if hasattr(self, '_unlimited_stock_cache'):
            return self._unlimited_stock_cache
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute(
                "SELECT value FROM settings WHERE key = 'unlimited_stock_mode'"
            )
            row = cursor.fetchone()
            if row and row[0]:
                import json as _json
                try:
                    parsed = _json.loads(row[0])
                    self._unlimited_stock_cache = bool(parsed.get('enabled'))
                    return self._unlimited_stock_cache
                except (TypeError, ValueError):
                    pass
        except Exception as e:
            logger.error(f"Error reading unlimited_stock_mode: {e}")
        self._unlimited_stock_cache = False
        return False

    def _invalidate_unlimited_stock_cache(self):
        """Called after Quick Setup so the next conversation turn
        picks up the new mode without a process restart."""
        if hasattr(self, '_unlimited_stock_cache'):
            del self._unlimited_stock_cache

    # --- Routing rules ---------------------------------------------
    # The Barista → Queue AI tab now persists its load-balancing
    # preferences to the `routing_rules` row in `settings` (via
    # /api/routing-rules). _assign_station consults them to shape
    # the assignment algorithm. Cached at first call; invalidated by
    # the PUT endpoint.
    _ROUTING_DEFAULTS = {
        'prioritizeEfficiency': True,
        'balanceWorkload':      True,
        'considerCapabilities': True,
        'emergencyMode':        False,
    }

    def _get_routing_rules(self):
        if hasattr(self, '_routing_rules_cache'):
            return self._routing_rules_cache
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute(
                "SELECT value FROM settings WHERE key = 'routing_rules'"
            )
            row = cursor.fetchone()
            if row and row[0]:
                import json as _json
                try:
                    parsed = _json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    if isinstance(parsed, dict):
                        merged = {**self._ROUTING_DEFAULTS, **parsed}
                        self._routing_rules_cache = merged
                        return merged
                except (TypeError, ValueError):
                    pass
        except Exception as e:
            logger.error(f"Error reading routing_rules: {e}")
        self._routing_rules_cache = dict(self._ROUTING_DEFAULTS)
        return self._routing_rules_cache

    def _invalidate_routing_rules_cache(self):
        if hasattr(self, '_routing_rules_cache'):
            del self._routing_rules_cache

    # --- Pricing (honor-system) ----------------------------------
    # When pricing_settings.enabled is true, the SMS confirmation
    # message embeds the computed total and asks the customer to
    # pay at the counter at collection time. See ARCHITECTURE.md
    # section 11 for the pricing model.
    def _get_pricing_settings(self):
        if hasattr(self, '_pricing_cache'):
            return self._pricing_cache
        defaults = {
            'enabled': False,
            'currency': 'AUD',
            'symbol': '$',
            'per_drink': {},
            'unknown_drink_price': 4.50,
            'milk_surcharge': {},
            'size_surcharge': {'small': -0.50, 'medium': 0.00, 'large': 0.50},
            'sugar_surcharge_per_sachet': 0.00,
            'show_in_sms': True,
            # When True AND pricing is enabled, VIP orders are free.
            # Used at paid events where the host comps drinks for
            # sponsors / staff / press — they get tagged VIP (via SMS
            # VIP code, or marked on a walk-in) and the price compute
            # returns 0 with a "VIP — no charge" label rather than a
            # dollar amount, so neither the SMS confirmation nor the
            # barista card mistakenly asks them to pay.
            'vip_free': False,
        }
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute("SELECT value FROM settings WHERE key = 'pricing_settings'")
            row = cursor.fetchone()
            if row and row[0]:
                import json as _json
                try:
                    parsed = _json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    if isinstance(parsed, dict):
                        merged = {**defaults, **parsed}
                        # Deep-merge the sub-dicts so partial saves
                        # don't blow away the defaults.
                        for k in ('per_drink', 'milk_surcharge', 'size_surcharge'):
                            if isinstance(parsed.get(k), dict):
                                merged[k] = {**defaults.get(k, {}), **parsed[k]}
                        self._pricing_cache = merged
                        return merged
                except (TypeError, ValueError):
                    pass
        except Exception as e:
            logger.error(f"Error reading pricing_settings: {e}")
        self._pricing_cache = defaults
        return defaults

    def _invalidate_pricing_cache(self):
        if hasattr(self, '_pricing_cache'):
            del self._pricing_cache

    def _apply_targeted_edit(self, message, order_details):
        """Parse an "edit <field> [to] <value>" message and return
        (updated_order_details, change_summary) or None if the message
        wasn't actually a targeted edit (caller falls back to the
        legacy "restart from coffee type" behaviour).

        Supports:
          - edit milk to oat / change milk oat
          - edit size large / change size to large
          - edit sugar 2 / change sugar to no sugar
          - edit strength strong / change to double shot
          - edit decaf / change to decaf / make it decaf / no decaf
          - edit drink flat white / change drink to latte

        Validates values against the NLP vocab (self.nlp.milks etc.)
        so we don't accept gibberish.
        """
        if not isinstance(order_details, dict):
            return None

        text = (message or '').strip().lower()
        # Strip the EDIT/CHANGE prefix
        for prefix in ('edit ', 'change ', 'edit', 'change'):
            if text.startswith(prefix):
                text = text[len(prefix):].strip()
                break
        # Allow optional "to": "edit milk TO oat" / "change size TO large"
        text = re.sub(r'\bto\b', ' ', text).strip()
        text = re.sub(r'\s+', ' ', text)
        if not text:
            return None

        updated = dict(order_details)

        # Helper: try to match a value against an NLP vocab dict
        # (canonical -> [variations]). Returns the canonical form.
        def _match_vocab(value, vocab):
            value = value.strip().lower()
            if not value:
                return None
            if value in vocab:
                return value
            for canonical, variations in vocab.items():
                if value == canonical:
                    return canonical
                for v in variations:
                    if value == v:
                        return canonical
            return None

        # Special toggles for decaf
        if text in ('decaf', 'make it decaf', 'to decaf'):
            current_type = updated.get('type', '') or ''
            if not current_type.lower().startswith('decaf'):
                updated['type'] = f"decaf {current_type}".strip()
            return updated, "made it decaf"
        if text in ('no decaf', 'regular', 'not decaf', 'undecaf'):
            current_type = updated.get('type', '') or ''
            lower = current_type.lower()
            if lower.startswith('decaf '):
                updated['type'] = current_type[6:].strip()
                return updated, "removed decaf"
            return updated, "kept it regular"

        # Field-then-value form: "milk oat", "size large", "sugar 2"
        parts = text.split(' ', 1)
        if len(parts) >= 2:
            field, value = parts[0], parts[1].strip()
            field_aliases = {
                'milk': 'milk', 'milks': 'milk',
                'size': 'size', 'sizes': 'size',
                'sugar': 'sugar', 'sugars': 'sugar', 'sweetener': 'sugar', 'sweetness': 'sugar',
                'strength': 'strength', 'shot': 'strength', 'shots': 'strength',
                'drink': 'type', 'coffee': 'type', 'type': 'type',
            }
            canonical_field = field_aliases.get(field)
            if canonical_field == 'milk':
                match = _match_vocab(value, self.nlp.milks)
                if match:
                    updated['milk'] = match
                    return updated, f"milk → {match}"
                return updated, f"sorry, \"{value}\" isn't a milk we recognise"
            if canonical_field == 'size':
                match = _match_vocab(value, self.nlp.sizes)
                if match:
                    updated['size'] = match
                    return updated, f"size → {match}"
                return updated, f"sorry, \"{value}\" isn't a size we recognise"
            if canonical_field == 'sugar':
                match = _match_vocab(value, self.nlp.sugars)
                if match:
                    updated['sugar'] = match
                    return updated, f"sugar → {match}"
                return updated, f"sorry, \"{value}\" isn't a sugar amount we recognise"
            if canonical_field == 'strength':
                match = _match_vocab(value, self.nlp.strengths)
                if match:
                    updated['strength'] = match
                    return updated, f"strength → {match}"
                # Allow free-form ("2 shots") to pass through verbatim
                updated['strength'] = value
                return updated, f"strength → {value}"
            if canonical_field == 'type':
                # Use full NLP parse to canonicalise the drink type
                parsed = self.nlp.parse_order(value, apply_defaults=False)
                if parsed.get('type'):
                    updated['type'] = parsed['type']
                    return updated, f"drink → {parsed['type']}"
                return updated, f"sorry, \"{value}\" isn't a drink we recognise"

        # Single-word form: "milk", "size", "sugar" → not enough info
        if text in ('milk', 'size', 'sugar', 'strength', 'drink', 'coffee'):
            return None

        # Fall-through: treat whole text as a candidate value across
        # all vocabs — e.g. customer just says "EDIT oat" or "CHANGE large".
        for vocab, field, label in (
            (self.nlp.milks, 'milk', 'milk'),
            (self.nlp.sizes, 'size', 'size'),
            (self.nlp.sugars, 'sugar', 'sugar'),
        ):
            match = _match_vocab(text, vocab)
            if match:
                updated[field] = match
                return updated, f"{label} → {match}"

        # Couldn't interpret — let the caller fall back to legacy EDIT.
        return None

    def _format_price_tail(self, order_details):
        """Return a one-line "\nTotal: $5.50 — pay at the counter on
        collection." suffix if pricing is enabled and show_in_sms is
        true. Empty string otherwise. Callers concatenate this onto
        the confirmation message; centralizing the format means
        the three SMS confirmation flows stay consistent.
        """
        pricing = self._get_pricing_settings()
        if not pricing.get('enabled') or not pricing.get('show_in_sms', True):
            return ''
        try:
            price_value, formatted = self._compute_order_price(order_details)
            if formatted is None:
                return ''
            # VIP comp: no "pay at the counter" — they're not paying.
            # Keep the message warm; this is usually a sponsor/staff
            # comp and a brusque "$0.00 owed" would feel off.
            if price_value == 0.0:
                return "\nYour drink is complimentary today — enjoy!"
            return f"\nTotal: {formatted} — pay at the counter when you collect."
        except Exception as e:
            logger.warning(f"_format_price_tail failed (non-fatal): {e}")
            return ''

    def _compute_order_price(self, order_details):
        """Compute the total price for an order.

        Returns (price_float, formatted_string) e.g. (5.50, "$5.50").
        Returns (None, None) when pricing is disabled — callers should
        skip price-related logic in that case.

        Honor-system: this is just the AMOUNT to mention in the SMS
        confirmation. No payment processing.

        VIP-free: when pricing_settings.vip_free is True AND the order
        is flagged vip, returns (0.0, "VIP — no charge"). The string
        is the badge the barista card / SMS will show instead of a
        dollar amount — so neither the customer nor the barista
        mistakenly thinks a sponsor / staff member owes money.
        """
        pricing = self._get_pricing_settings()
        if not pricing.get('enabled'):
            return None, None

        # VIP comp short-circuits BEFORE any price math. Cheaper and
        # avoids the "0.50 + -0.50 = $0.00" coincidence looking like
        # a free drink for non-VIPs.
        if pricing.get('vip_free') and order_details.get('vip'):
            return 0.0, "VIP — no charge"

        # Flat-fee mode: a fixed price regardless of drink and milk
        # (alt milk is free). Two shapes, checked in order:
        #   1. flat_price_by_size — a per-size table, e.g. {small: 2.00,
        #      medium: 2.50}. The event default Steve asked for.
        #   2. flat_price — a single price for everything.
        # Either ignores per-drink prices + all surcharges. Editable in the
        # Pricing UI any time. Malformed values fall through to itemised.
        symbol = pricing.get('symbol', '$')
        flat_size = (order_details.get('size') or 'medium').strip().lower()
        by_size = pricing.get('flat_price_by_size') or {}
        if isinstance(by_size, dict) and by_size.get(flat_size) not in (None, ''):
            try:
                total = round(float(by_size[flat_size]), 2)
                return total, f"{symbol}{total:.2f}"
            except (ValueError, TypeError):
                pass
        flat = pricing.get('flat_price')
        if flat not in (None, ''):
            try:
                total = round(float(flat), 2)
                return total, f"{symbol}{total:.2f}"
            except (ValueError, TypeError):
                pass  # malformed flat_price → fall through to itemised pricing

        drink = (order_details.get('type') or '').strip().lower()
        milk = (order_details.get('milk') or '').strip().lower()
        size = (order_details.get('size') or 'medium').strip().lower()

        # Strip "decaf " prefix if present — same price as regular.
        if drink.startswith('decaf '):
            drink = drink[6:].strip()

        per_drink = pricing.get('per_drink', {}) or {}
        base = per_drink.get(drink)
        if base is None:
            base = float(pricing.get('unknown_drink_price', 4.50))
        else:
            base = float(base)

        milk_surcharge = float(
            (pricing.get('milk_surcharge', {}) or {}).get(milk, 0.0)
        )

        size_surcharge = float(
            (pricing.get('size_surcharge', {}) or {}).get(size, 0.0)
        )

        # Sugar surcharge — only counts the sachets the customer asked for.
        try:
            sachets = self._sugar_sachets_from_text(order_details.get('sugar') or '')
        except Exception:
            sachets = 0
        sugar_total = float(pricing.get('sugar_surcharge_per_sachet', 0.0)) * sachets

        total = max(0.0, base + milk_surcharge + size_surcharge + sugar_total)
        # Round to 2dp; the format string handles trailing zeros.
        total = round(total, 2)
        symbol = pricing.get('symbol', '$')
        formatted = f"{symbol}{total:.2f}"
        return total, formatted

    def _get_available_coffee_types(self):
        """Get list of available drink types — espresso drinks (gated
        on coffee bean stock) PLUS every row in the inventory `drinks`
        category (teas, hot chocolate, chai, matcha, etc.).

        Without the drinks-category pull, a customer ordering "earl
        grey" would always get "Sorry, we don't offer earl grey"
        because the function only returned espresso drinks. Steve
        flagged: SMS should know tea exists even when the menu
        offers it.
        """
        # Unlimited-stock mode: skip the inventory check but STILL
        # pull configured tea/drinks rows so the menu is honest.
        extras = self._get_available_extra_drinks()

        # Respect the Organiser's per-event on/off switches: intersect the
        # catalogue espresso menu with event_inventory['coffee'] enabled
        # names. Guarded so a naming mismatch can never empty the menu —
        # if nothing intersects, serve the full catalogue menu (and the
        # operator sees the drift in the persistence matrix instead of
        # customers losing every drink).
        espresso = list(self._STANDARD_DRINK_MENU)
        enabled = self._get_event_enabled_coffees()
        if enabled is not None:
            filtered = [d for d in espresso if d.lower() in enabled]
            if filtered:
                espresso = filtered

        if self._is_unlimited_stock_mode():
            return espresso + extras
        try:
            cursor = self.db.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM inventory_items
                WHERE category = 'coffee'
                AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
            """)
            coffee_available = cursor.fetchone()[0] > 0

            base = espresso if coffee_available else []
            return base + extras
        except Exception as e:
            logger.error(f"Error checking coffee availability: {str(e)}")
            return espresso + extras

    def _get_available_extra_drinks(self):
        """Return the lowercased names of stocked drinks-category
        items (tea flavours, hot chocolate, chai latte, matcha latte,
        etc.). Empty list if the table doesn't exist or no rows
        are present.
        """
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute("""
                SELECT LOWER(name) FROM inventory_items
                WHERE category = 'drinks'
                  AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                ORDER BY name
            """)
            return [row[0] for row in cursor.fetchall() if row and row[0]]
        except Exception as e:
            logger.debug(f"_get_available_extra_drinks: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return []

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

    _STANDARD_MILK_MENU = ["full cream", "skim", "oat", "almond",
                           "lactose free", "soy"]

    def _get_available_milk_types(self):
        """Get list of available milk types from inventory management.

        Unlimited-stock mode still respects what the operator
        CONFIGURED. Quick Setup with only "full cream, skim, oat" ticked
        means the bot offers only those three even in unlimited mode.
        The previous early-return to _STANDARD_MILK_MENU was the bug
        Steve hit on the demo (coconut suggested when no station
        configured had it).
        """
        unlimited = self._is_unlimited_stock_mode()
        # Recover the connection from any prior aborted transaction. If we
        # don't do this, an unrelated upstream error silently changes the
        # customer's available milk options to the hard-coded
        # ["full cream", "skim"] fallback below — they'd then be told
        # "we don't have oat milk" even with oat in stock.
        try:
            self.db.rollback()
        except Exception:
            pass

        try:
            cursor = self.db.cursor()
            if unlimited:
                cursor.execute("""
                    SELECT name FROM inventory_items
                    WHERE category = 'milk'
                    ORDER BY name
                """)
            else:
                cursor.execute("""
                    SELECT name FROM inventory_items
                    WHERE category = 'milk'
                    AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                    ORDER BY name
                """)
            milk_types = [row[0].lower() for row in cursor.fetchall()]

            if not milk_types:
                # No milks configured yet — only happens on a brand-new
                # deploy before Quick Setup runs. Return canonical
                # defaults so the bot doesn't refuse all orders.
                logger.warning("No milk types found in inventory_items table, using defaults")
                return ["full cream", "skim"]

            logger.info(f"Available milk types: {milk_types}")
            return milk_types
        except Exception as e:
            logger.error(f"Error getting available milk types: {str(e)}")
            try:
                self.db.rollback()
            except Exception:
                pass
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

    _STANDARD_SWEETENER_MENU = [("no sugar", "sugar"), ("1 sugar", "sugar"),
                                ("2 sugar", "sugar"), ("3 sugar", "sugar"),
                                ("half sugar", "sugar")]

    def _summarise_sweeteners(self, sweeteners):
        """Compact one-line description of available sweeteners.

        Steve flagged the verbose MENU: "0, 1, 2, 3 sugars" enumerated
        feels overwrought when the customer just wants to know "how
        do I ask for sugar". Collapse consecutive integer sugars to a
        range ("0-3 sugars"), preserve quirks (half sugar, artificial
        sweetener names).

        Input: list of (name, category) tuples from
        _get_available_sweeteners.
        Output: e.g. "Sugar: 0-3 (just text the number)"
        """
        if not sweeteners:
            return "Sweetener: none"

        names = [s[0] for s in sweeteners if s and s[0]]
        # Pull out the "N sugar" variants — extract the integer.
        sugar_ints = []
        non_sugar_names = []
        has_no_sugar = False
        has_half_sugar = False
        for n in names:
            nl = (n or '').strip().lower()
            if nl == 'no sugar':
                has_no_sugar = True
                continue
            if nl == 'half sugar':
                has_half_sugar = True
                continue
            # "1 sugar", "2 sugar", etc.
            parts = nl.split()
            if len(parts) >= 2 and parts[0].isdigit() and 'sugar' in parts[1]:
                sugar_ints.append(int(parts[0]))
                continue
            non_sugar_names.append(n)

        # Build the sugar range string.
        sugar_part = ''
        if sugar_ints or has_no_sugar:
            ints = sorted(set(sugar_ints))
            lo = 0 if has_no_sugar else (ints[0] if ints else 0)
            hi = ints[-1] if ints else lo
            if lo == hi:
                sugar_part = f"{lo} sugar"
            else:
                sugar_part = f"{lo}-{hi} sugars"
            if has_half_sugar:
                sugar_part += " or half"

        bits = []
        if sugar_part:
            bits.append(sugar_part)
        if non_sugar_names:
            bits.append(', '.join(non_sugar_names))

        return f"Sugar: {', '.join(bits)} (just text the number)" if bits else "Sweetener: none"

    def _get_available_sweeteners(self):
        """Get list of available sweeteners from inventory management.

        Unlimited-stock mode still respects what the operator
        CONFIGURED — if Quick Setup only ticked "no sugar, 1 sugar,
        2 sugar", the bot only offers those three. The previous
        early-return to _STANDARD_SWEETENER_MENU was the bug Steve
        flagged: MENU listed "0,1,2,3,4 sugars" even though Quick
        Setup excluded 3-sugar and half-sugar.
        """
        unlimited = self._is_unlimited_stock_mode()
        try:
            cursor = self.db.cursor()
            if unlimited:
                cursor.execute("""
                    SELECT name, category FROM inventory_items
                    WHERE category IN ('sweetener', 'sugar', 'artificial_sweetener')
                    ORDER BY category, name
                """)
            else:
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

    # Map cup names as the operator writes them (in inventory_items) to
    # the canonical sizes the NLP/order layer uses. Customers say
    # "medium" but the operator's cup category is "Regular"; we treat
    # those as the same thing rather than rejecting the customer's word.
    _SIZE_NAME_NORMALIZATION = {
        # canonical → variants seen in inventory_items.name
        'small':  ['small', 'sm', 's', '8oz', '8 oz'],
        'medium': ['medium', 'regular', 'med', 'reg', 'm', '12oz', '12 oz'],
        'large':  ['large', 'lg', 'l', '16oz', '16 oz', 'extra large', 'xl'],
    }

    def _get_available_sizes(self, coffee_type=None):
        """Return the list of cup sizes currently in stock.

        Previously queried `size_options` — a table that doesn't exist
        on this schema — and silently fell back to defaults while logging
        an error on every MENU / awaiting_size turn. Now reads the real
        source of truth: inventory_items rows in the 'cups' category
        (which the Quick Setup wizard and the Organiser inventory UI
        both write to).

        The coffee_type parameter is kept for API compatibility but
        ignored — cup stock isn't per-drink in this system.

        Normalizes operator-facing names ("Regular") to customer-facing
        canonical names ("medium") so the bot's reply matches the
        vocabulary in services/nlp.py.

        Unlimited-stock mode: still respects what the operator
        CONFIGURED in Quick Setup / Inventory — just skips the
        stock-level check. So if you only ticked Medium in Quick
        Setup, the bot still only offers Medium even though
        "unlimited stock" is on. Bug Steve hit on the demo: only
        Medium was ticked but the SMS bot accepted "Large oat latte".
        """
        unlimited = self._is_unlimited_stock_mode()
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            if unlimited:
                cursor.execute("""
                    SELECT name FROM inventory_items
                    WHERE category = 'cups'
                """)
            else:
                cursor.execute("""
                    SELECT name FROM inventory_items
                    WHERE category = 'cups'
                      AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                """)
            raw_names = [row[0] for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error getting available sizes: {e}")
            return ['small', 'medium', 'large']

        if not raw_names:
            # No cups defined yet — return canonical defaults so the
            # bot doesn't refuse to take orders during initial setup.
            return ['small', 'medium', 'large']

        # Normalize: map each operator-defined cup name back to one of
        # the three canonical sizes the NLP understands.
        canonical = []
        for raw in raw_names:
            key = (raw or '').strip().lower()
            matched = None
            for canon, variants in self._SIZE_NAME_NORMALIZATION.items():
                if key == canon or key in variants:
                    matched = canon
                    break
            if matched and matched not in canonical:
                canonical.append(matched)

        # Preserve the conventional small → medium → large order even
        # if the DB returned them in a different sequence.
        order = {'small': 0, 'medium': 1, 'large': 2}
        canonical.sort(key=lambda s: order.get(s, 99))
        return canonical or ['small', 'medium', 'large']

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

        # Parse message with NLP. apply_defaults=False so we can tell which
        # fields the customer actually specified vs. fields that are missing
        # and need to be asked for. (See nlp.py parse_order docstring.)
        order_details = self.nlp.parse_order(message, apply_defaults=False)
        coffee_type = order_details.get('type', '').lower()

        # All three rejection messages below append "Reply MENU for
        # the full list" — discoverability for customers who don't
        # know they can ask. Operators reported customers giving up
        # when they got "we don't have coconut milk" without knowing
        # what they DO have.

        # Check if the requested coffee type is available. When the
        # NLP parser recognises a tea / alt-drink (chai, matcha, hot
        # chocolate, etc.) we can give a much friendlier "we don't
        # have X today" response with the available menu, rather than
        # the old "I'm not sure what coffee you want" confusion.
        if coffee_type and not self._is_valid_coffee_type(coffee_type, available_coffee_types):
            # Split teas and coffees so the response reads naturally.
            teas = [c for c in (available_coffee_types or [])
                    if 'tea' in c.lower()]
            non_teas = [c for c in (available_coffee_types or [])
                        if 'tea' not in c.lower()]
            parts = []
            if non_teas:
                parts.append(f"Coffee: {', '.join(sorted(non_teas))}")
            if teas:
                parts.append(f"Tea: {', '.join(sorted(teas))}")
            available_line = ' · '.join(parts) if parts else 'see MENU'
            return (
                f"Sorry, we don't have {coffee_type} today. Available: "
                f"{available_line}.\n"
                f"Reply MENU for the full list."
            )

        # Validate milk type if specified
        milk_type = order_details.get('milk', '')
        if milk_type:
            available_milk_types = self._get_available_milk_types()
            if not self._is_valid_milk_type(milk_type, available_milk_types):
                return (
                    f"Sorry, we don't have {milk_type} milk. Available milks: "
                    f"{', '.join(available_milk_types)}.\n"
                    f"Reply MENU for the full list."
                )

        # Validate sweetener if specified
        sweetener = order_details.get('sugar', '')
        if sweetener:
            available_sweeteners = self._get_available_sweeteners()
            if not self._is_valid_sweetener(sweetener, available_sweeteners):
                sweetener_names = [s[0] for s in available_sweeteners]
                return (
                    f"Sorry, we don't have {sweetener}. Available sweeteners: "
                    f"{', '.join(sweetener_names)}.\n"
                    f"Reply MENU for the full list."
                )

        # Get customer's name from state
        name = state.get('temp_data', {}).get('name', '')

        # If no coffee type found, prompt again
        if 'type' not in order_details:
            return f"I'm not sure what type of coffee you'd like, {name}. Please specify a coffee type like latte, cappuccino, flat white, etc."

        # For black coffees, milk is implicitly "no milk"
        if self.nlp.is_black_coffee(order_details['type']):
            order_details['milk'] = 'no milk'

        # Propagate the VIP flag from conversation state into the
        # order details. _handle_vip_code stores it on temp_data but
        # nothing copied it onto order_details, so _confirm_order's
        # `if order_details.get('vip'): queue_priority = 1` branch
        # never fired and VIP orders ended up at normal priority.
        if state.get('temp_data', {}).get('vip'):
            order_details['vip'] = True

        # Walk through missing fields one at a time so customers know what
        # we understood vs. what we're still asking about. Previously the
        # system silently defaulted missing fields and skipped to "Confirm?",
        # which made customers feel their SMS was ignored.
        state_data = {'name': name, 'order_details': order_details}
        # Keep the VIP flag on temp_data too so it survives the
        # subsequent milk → size → sugar state transitions.
        if state.get('temp_data', {}).get('vip'):
            state_data['vip'] = True

        if 'milk' not in order_details:
            self._set_conversation_state(phone, 'awaiting_milk', state_data)
            return (
                f"Got it — {order_details['type']} for {name}. "
                f"What milk would you like? (full cream, skim, soy, almond, oat, lactose free, or 'no milk')"
            )

        # Phrase the read-back differently for black coffees so we don't say
        # "with no milk milk".
        milk = order_details['milk']
        milk_phrase = '' if milk == 'no milk' else f" with {milk} milk"

        # Size note is set (not returned) when there's exactly one size, so
        # we FALL THROUGH to the sugar/confirm checks. The bug this fixes
        # (caught in the live prod e2e, 2026-06-13): a one-size event jumped
        # straight to "How much sugar?" even when the customer had ALREADY
        # said it in the same message ("skim flat white 1 sugar"), dropping
        # their answer and asking again.
        size_note = ''
        if 'size' not in order_details:
            available_sizes = self._get_available_sizes(
                order_details.get('type', '')) or ['small', 'medium', 'large']
            if len(available_sizes) == 1:
                order_details['size'] = available_sizes[0]
                size_note = f" (all drinks are {available_sizes[0]} today)"
                # fall through — do NOT return; sugar may already be known
            else:
                self._set_conversation_state(phone, 'awaiting_size', state_data)
                return (
                    f"Got it — {order_details['type']}{milk_phrase}. "
                    f"What size? ({', '.join(available_sizes)})"
                )

        if 'sugar' not in order_details:
            self._set_conversation_state(phone, 'awaiting_sugar', state_data)
            return (
                f"Got it — {order_details.get('size', '')} {order_details['type']}{milk_phrase}"
                f"{size_note}. "
                f"How much sugar? (none, 1, 2, 3, etc.)"
            )

        # All fields present in one message — go straight to confirmation,
        # but read back exactly what we understood so the customer can
        # correct mistakes before the order is placed.
        self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
        order_summary = self.nlp.format_order_summary(order_details)
        return (
            f"Just to confirm — {order_summary}."
            f"{self._format_price_tail(order_details)}\n"
            f"Reply YES to send to the barista, EDIT to change something, or NO to cancel."
        )
    
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
            state_data = {
                'name': name,
                'order_details': order_details
            }

            # Don't re-ask for fields the customer already gave in their
            # first message — "large latte" used to get asked "what size?"
            # anyway because this handler unconditionally moved to
            # awaiting_size (and its prompt hardcoded "(small, medium,
            # large)" regardless of what cups the event actually stocks).
            # Found by tests/sms_scenarios: size_in_first_message_respected.
            # One-size events set the size and FALL THROUGH (don't return)
            # so an already-known sugar isn't re-asked. See the matching
            # fix + rationale in _handle_awaiting_coffee_type.
            size_note = ''
            if 'size' not in order_details:
                available_sizes = self._get_available_sizes(
                    order_details.get('type', '')) or ['small', 'medium', 'large']
                if len(available_sizes) == 1:
                    order_details['size'] = available_sizes[0]
                    size_note = f"All drinks are {available_sizes[0]} today. "
                else:
                    self._set_conversation_state(phone, 'awaiting_size', state_data)
                    return (
                        f"What size {order_details.get('type', 'coffee')} would you like? "
                        f"({', '.join(available_sizes)})"
                    )

            if 'sugar' not in order_details:
                self._set_conversation_state(phone, 'awaiting_sugar', state_data)
                return (
                    f"{size_note}How much sugar in your {order_details.get('type', 'coffee')}? (none, 1, 2, etc.)"
                )

            # Everything known — read back and confirm.
            self._set_conversation_state(phone, 'awaiting_confirmation', state_data)
            order_summary = self.nlp.format_order_summary(order_details)
            return (
                f"Just to confirm — {order_summary}."
                f"{self._format_price_tail(order_details)}\n"
                f"Reply YES to send to the barista, EDIT to change something, or NO to cancel."
            )
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
        
        # If only one size is available, select it — but NEVER silently.
        # Previously this branch ignored whatever the customer just typed:
        # they answered "medium" and the confirmation read "small latte"
        # (the only configured cup), i.e. the wrong cup at pickup with no
        # warning. Found by tests/sms_scenarios: size_answer_respected.
        # Now: if their answer differs from the only size, say so.
        if len(available_sizes) == 1:
            only_size = available_sizes[0]
            requested = self.nlp.parse_order(message).get('size')
            order_details['size'] = only_size

            state_data = {
                'name': name,
                'order_details': order_details
            }
            self._set_conversation_state(phone, 'awaiting_sugar', state_data)

            note = ''
            if requested and requested.lower() != only_size.lower():
                note = f"We only have {only_size} cups today, so I've made it {only_size}. "
            return f"{note}How much sugar would you like in your {order_details.get('type', 'coffee')}? (none, 1, 2, etc.)"
        
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
        elif message_lower in ['3', 'three', 'three sugar', '3 sugar']:
            sugar = '3 sugar'
        else:
            # Try NLP. apply_defaults=False so we get None (not 'no sugar')
            # when the customer's reply doesn't match a known sugar pattern,
            # and can ask them again instead of silently dropping their input.
            new_details = self.nlp.parse_order(message, apply_defaults=False)
            sugar = new_details.get('sugar')

        if not sugar:
            return (
                "Sorry, I didn't catch that. How much sugar? "
                "Reply 'none', '1', '2', '3', or 'half'."
            )

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
            f"Great! Here's your order: {order_summary}"
            f"{self._format_price_tail(order_details)}\n"
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
        
        elif message_upper.startswith('EDIT') or message_upper.startswith('CHANGE'):
            # Targeted edit ("edit milk to oat") modifies only that
            # field and keeps the rest. Bare EDIT/CHANGE falls back
            # to the legacy "restart from coffee type" behaviour.
            edit_result = self._apply_targeted_edit(message, order_details)
            if edit_result is not None:
                updated_details, change_summary = edit_result
                # Save back and re-prompt confirmation
                temp_data = dict(state.get('temp_data', {}))
                temp_data['order_details'] = updated_details
                self._set_conversation_state(phone, 'awaiting_confirmation', temp_data)
                order_summary = self.nlp.format_order_summary(updated_details)
                return (
                    f"Updated — {change_summary}.\n"
                    f"Here's your order now: {order_summary}"
                    f"{self._format_price_tail(updated_details)}\n"
                    f"Reply YES to confirm, NO to cancel, or EDIT to change something else."
                )
            # Bare EDIT — restart from coffee type
            self._set_conversation_state(phone, 'awaiting_coffee_type', {'name': name})
            return (
                f"Let's change that order, {name}. What type of coffee would you like?\n"
                f"Tip: you can also say e.g. \"edit milk to oat\" to change just one thing."
            )

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

        # Parse message; do not silently default missing fields.
        order_details = self.nlp.parse_order(message, apply_defaults=False)

        if 'type' not in order_details:
            return f"I'm not sure what coffee {friend_name} would like. Please specify a coffee type like latte, cappuccino, flat white, etc."

        # Black coffees don't need milk
        if self.nlp.is_black_coffee(order_details['type']):
            order_details['milk'] = 'no milk'

        if station_id:
            order_details['station_id'] = station_id
            order_details['stationId'] = station_id

        shared_state = {
            'primary_name': primary_name,
            'primary_order': primary_order,
            'friend_name': friend_name,
            'friend_order': order_details,
            'group_orders': group_orders,
            'station_id': station_id,
        }

        # Step through missing fields one at a time (same as the primary
        # ordering flow) so customers can correct typos before the order
        # is committed.
        if 'milk' not in order_details:
            self._set_conversation_state(phone, 'awaiting_friend_milk', shared_state)
            return f"Got it — {order_details['type']} for {friend_name}. What milk? (full cream, skim, soy, almond, oat, lactose free, or 'no milk')"

        milk = order_details['milk']
        milk_phrase = '' if milk == 'no milk' else f" with {milk} milk"

        if 'size' not in order_details:
            self._set_conversation_state(phone, 'awaiting_friend_size', shared_state)
            return f"Got it — {order_details['type']}{milk_phrase} for {friend_name}. What size? (small, medium, large)"

        if 'sugar' not in order_details:
            self._set_conversation_state(phone, 'awaiting_friend_sugar', shared_state)
            return f"Got it — {order_details['size']} {order_details['type']}{milk_phrase} for {friend_name}. How much sugar? (none, 1, 2, 3)"

        # Order is complete — confirm
        updated_group_orders = group_orders.copy()
        updated_group_orders.append(order_details)
        shared_state['group_orders'] = updated_group_orders
        self._set_conversation_state(phone, 'awaiting_friend_confirmation', shared_state)
        order_summary = self.nlp.format_order_summary(order_details)
        return (
            f"For {friend_name}: {order_summary}.\n"
            f"Reply YES to confirm, EDIT to change, or NO to cancel."
        )
    
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
        elif message_lower in ['3', 'three', 'three sugar', '3 sugar']:
            sugar = '3 sugar'
        else:
            new_details = self.nlp.parse_order(message, apply_defaults=False)
            sugar = new_details.get('sugar')

        if not sugar:
            return f"Sorry, I didn't catch how much sugar for {friend_name}. Reply 'none', '1', '2', '3', or 'half'."

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
        # Stash the computed price on the order_details blob so the
        # barista UI can show "what to charge" without having to
        # re-compute. No-op when pricing is disabled.
        try:
            price_value, price_formatted = self._compute_order_price(order_details)
            if price_value is not None:
                order_details['price'] = price_value
                order_details['price_formatted'] = price_formatted
        except Exception as e:
            logger.warning(f"price compute on confirm failed (non-fatal): {e}")

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
            
            # Generate order number.
            # Preferred: a per-event running counter (e.g. "42") sourced
            # from a Postgres sequence — short, human-friendly, easy to
            # shout across a noisy café. The `#` is added at display time
            # only, so the stored value stays a plain identifier.
            # Falls back to the legacy AM/PM timestamp format
            # ("A1402153") if the sequence isn't installed, so this code
            # stays compatible with un-migrated databases and with the
            # SQLite test path.
            now = datetime.now()
            order_number = None
            # Read the operator-configurable event prefix (e.g. "C")
            # from settings so both SMS and walk-in orders look like
            # "C1", "C2", … This is a UX request from Steve: long
            # timestamp-based codes are hard to read out at the bar.
            event_prefix = ''
            try:
                prefix_cur = fresh_conn.cursor()
                prefix_cur.execute("SELECT value FROM settings WHERE key = 'order_prefix'")
                prefix_row = prefix_cur.fetchone()
                prefix_cur.close()
                if prefix_row and prefix_row[0]:
                    import json as _json
                    try:
                        parsed = _json.loads(prefix_row[0]) if isinstance(prefix_row[0], str) else prefix_row[0]
                        if isinstance(parsed, dict):
                            event_prefix = (parsed.get('prefix') or '').strip()
                        elif isinstance(parsed, str):
                            event_prefix = parsed.strip()
                    except Exception:
                        event_prefix = ''
            except Exception:
                event_prefix = ''

            if db_type != "sqlite":
                try:
                    seq_cursor = fresh_conn.cursor()
                    seq_cursor.execute("SELECT nextval('order_number_seq')")
                    seq_row = seq_cursor.fetchone()
                    seq_cursor.close()
                    if seq_row:
                        seq_val = seq_row[0] if not isinstance(seq_row, dict) else list(seq_row.values())[0]
                        order_number = f"{event_prefix}{int(seq_val)}"
                except Exception as seq_err:
                    logger.info(f"order_number_seq unavailable, using legacy format: {seq_err}")
                    try:
                        fresh_conn.rollback()
                    except Exception:
                        pass

            if not order_number:
                # Legacy fallback — keeps SQLite test path working.
                legacy_prefix = "A" if now.hour < 12 else "P"
                order_number = f"{legacy_prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
            
            # Check for station assignment in the order details
            specified_station = order_details.get('station_id') or order_details.get('stationId')

            # Assign station based on available information
            is_vip = order_details.get('vip', False)
            milk_type = order_details.get('milk')

            # Track whether the customer's chosen station got changed so we
            # can tell them in the confirmation message instead of silently
            # routing the order somewhere else.
            requested_station_id = None
            station_was_reassigned = False

            if specified_station:
                try:
                    requested_station_id = int(specified_station)
                    station_id = requested_station_id
                    is_delayed = False
                    logger.info(f"Using specified station {station_id} from order details")
                except (ValueError, TypeError):
                    requested_station_id = specified_station
                    station_id, is_delayed = self._assign_station(is_vip, milk_type)
                    if station_id is None:
                        logger.error("No stations available to assign order")
                        return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                    station_was_reassigned = True
                    logger.info(f"Invalid station {requested_station_id} specified, reassigned to station {station_id}")
            else:
                # Use advanced station assignment if no station specified
                station_id, is_delayed = self._assign_station(is_vip, milk_type)
                if station_id is None:
                    logger.error("No stations available to assign order")
                    return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                logger.info(f"No station specified, using intelligent assignment to station {station_id}")

            # Sanity-check required fields. If anything is missing at this
            # point, the conversation state machine has a bug — fail loudly
            # rather than silently filling in defaults that the customer
            # never agreed to.
            missing_required = [f for f in ('type', 'milk', 'size', 'sugar') if f not in order_details]
            if missing_required:
                logger.error(
                    f"_confirm_order called with missing fields {missing_required} for {phone}: {order_details}"
                )
                return (
                    "Sorry, your order is missing some details ("
                    + ", ".join(missing_required)
                    + "). Reply MENU to start over."
                )

            processed_details = {
                'name': name,
                'type': order_details['type'],
                'milk': order_details['milk'],
                'size': order_details['size'],
                'sugar': order_details['sugar'],
                'station_id': station_id,
                'stationId': station_id,
                'assigned_to_station': station_id,
                'assignedStation': station_id,
            }
            if station_was_reassigned:
                processed_details['requested_station_id'] = requested_station_id
                processed_details['station_was_reassigned'] = True
            
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

                # Push WS event so Barista UI shows the SMS order
                # in real time. Without this, an SMS order sat
                # invisible in the queue until the next 15s poll —
                # Steve hit this in QC: "SMS came back but no order
                # in the app" because the poll hadn't fired yet.
                # Inline rather than importing the route helper to
                # avoid a circular import (route already imports
                # this module).
                try:
                    from flask import current_app as _ca
                    socketio = _ca.config.get('socketio') if _ca else None
                    if socketio:
                        new_order_payload = {
                            'order_number': order_number,
                            'id': order_number,
                            'status': 'pending',
                            'station_id': station_id,
                            'stationId': station_id,
                            # See identical comment in consolidated_api_routes:
                            # 'Z' suffix forces browser to parse as UTC,
                            # avoiding the 9.5h AEST offset Steve hit.
                            'created_at': now.isoformat() + 'Z' if hasattr(now, 'isoformat') else str(now),
                            'createdAt':  now.isoformat() + 'Z' if hasattr(now, 'isoformat') else str(now),
                            'wait_time':  0,
                            'waitTime':   0,
                            'customer_name': processed_details.get('name'),
                            'customerName': processed_details.get('name'),
                            'coffee_type': processed_details.get('type'),
                            'coffeeType': processed_details.get('type'),
                            'milk_type': processed_details.get('milk'),
                            'milkType': processed_details.get('milk'),
                            'sugar': processed_details.get('sugar'),
                            'size': processed_details.get('size'),
                            'vip': processed_details.get('vip', False),
                        }
                        socketio.emit('order_created', new_order_payload, room='orders')
                        if station_id is not None:
                            socketio.emit(
                                'new_order', new_order_payload,
                                room=f'station_{station_id}',
                            )
                except Exception as ws_err:
                    # Never let WS failures break the order flow.
                    logger.debug(f"WS new-order emit skipped (SMS path): {ws_err}")
                    
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
                    # Extract decaf-ness from the drink type so "decaf flat white"
                    # is stored as type="flat white" with decaf=True. Without
                    # this, the next visit drops the decaf and a regular has
                    # to re-specify every time.
                    raw_type = (processed_details.get('type') or '').strip()
                    decaf_flag = False
                    bare_type = raw_type
                    lower_type = raw_type.lower()
                    if lower_type.startswith('decaf '):
                        decaf_flag = True
                        bare_type = raw_type[6:].strip()
                    elif lower_type.startswith('decaffeinated '):
                        decaf_flag = True
                        bare_type = raw_type[14:].strip()
                    preferred_strength = processed_details.get('strength')

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
                                    preferred_strength = ?,
                                    preferred_decaf = ?,
                                    last_order_date = ?,
                                    total_orders = total_orders + 1
                                WHERE phone = ?
                            """, (
                                bare_type,
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                preferred_strength,
                                1 if decaf_flag else 0,
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
                                    preferred_strength = %s,
                                    preferred_decaf = %s,
                                    last_order_date = %s,
                                    total_orders = total_orders + 1
                                WHERE phone = %s
                            """, (
                                bare_type,
                                processed_details.get('milk'),
                                processed_details.get('size'),
                                processed_details.get('sugar'),
                                preferred_strength,
                                decaf_flag,
                                now,
                                phone
                            ))
                    else:
                        # Create new customer
                        if db_type == "sqlite":
                            cursor.execute("""
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar,
                             preferred_strength, preferred_decaf,
                             first_order_date, last_order_date, total_orders)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            phone,
                            name,
                            bare_type,
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            preferred_strength,
                            1 if decaf_flag else 0,
                            now,
                            now,
                            1
                        ))
                        else:
                            cursor.execute("""
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar,
                             preferred_strength, preferred_decaf,
                             first_order_date, last_order_date, total_orders)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (
                            phone,
                            name,
                            bare_type,
                            processed_details.get('milk'),
                            processed_details.get('size'),
                            processed_details.get('sugar'),
                            preferred_strength,
                            decaf_flag,
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
            
            # Step 3: Update station stats (increment load).
            #
            # Historical bug: the Postgres upsert lived inside the
            # except-branch of the SQLite path, so on Postgres NOTHING
            # ran — current_load stayed at 0 forever — and the
            # load-balancing assignment in _assign_station() always
            # picked station 1 (lowest id wins on a 0/0/0 tie). That
            # broke load balancing for every Postgres deployment.
            try:
                if db_type == "sqlite":
                    try:
                        cursor.execute(
                            """
                            INSERT INTO station_stats (station_id, current_load, last_updated)
                            VALUES (?, 1, ?)
                            ON CONFLICT(station_id) DO UPDATE SET
                                current_load = station_stats.current_load + 1,
                                last_updated = ?
                            """,
                            (station_id, now, now),
                        )
                    except Exception as sqlite_error:
                        # Fallback for older SQLite versions without ON CONFLICT
                        logger.warning(
                            f"SQLite upsert unsupported, using manual approach: {sqlite_error}"
                        )
                        cursor.execute(
                            "SELECT station_id FROM station_stats WHERE station_id = ?",
                            (station_id,),
                        )
                        if cursor.fetchone():
                            cursor.execute(
                                "UPDATE station_stats SET current_load = current_load + 1, "
                                "last_updated = ? WHERE station_id = ?",
                                (now, station_id),
                            )
                        else:
                            cursor.execute(
                                "INSERT INTO station_stats (station_id, current_load, last_updated) "
                                "VALUES (?, 1, ?)",
                                (station_id, now),
                            )
                else:
                    # Postgres path — must run on every order, not only
                    # as an except-handler fallback.
                    cursor.execute(
                        """
                        INSERT INTO station_stats (station_id, current_load, last_updated)
                        VALUES (%s, 1, %s)
                        ON CONFLICT (station_id) DO UPDATE SET
                            current_load = station_stats.current_load + 1,
                            last_updated = %s
                        """,
                        (station_id, now, now),
                    )

                try:
                    fresh_conn.commit()
                    logger.info(f"Updated station {station_id} load")
                except Exception as commit_err:
                    logger.error(f"Error committing station stats update: {commit_err}")
            except Exception as stats_error:
                logger.error(f"Error updating station stats: {stats_error}")
                # Non-critical — preserve the order even if load tracking fails.

            # Step 3b: Decrement inventory for the things this order
            # consumed. Without this, organisers can't see real-time
            # stock levels and run out mid-event without warning.
            #
            # Per-drink amounts are conservative defaults — operators
            # can refine them later via the inventory UI. We decrement
            # both station-scoped stock (if a station_id-tagged row
            # exists for that item) and event-wide stock (the row with
            # station_id IS NULL) so reports at either scope stay
            # accurate.
            try:
                self._decrement_stock_for_order(
                    fresh_conn, db_type, station_id, processed_details
                )
                # Persist the "stock already decremented" flag back to
                # the orders row so the /complete endpoint (which also
                # calls _decrement_stock_for_order for walk-in orders)
                # doesn't double-count this same SMS order when the
                # barista taps Complete.
                processed_details['_stock_decremented'] = True
                try:
                    upd = fresh_conn.cursor()
                    if db_type == 'sqlite':
                        upd.execute(
                            "UPDATE orders SET order_details = ? WHERE id = ?",
                            (json.dumps(processed_details), order_id),
                        )
                    else:
                        upd.execute(
                            "UPDATE orders SET order_details = %s WHERE id = %s",
                            (json.dumps(processed_details), order_id),
                        )
                    fresh_conn.commit()
                except Exception as upd_err:
                    logger.warning(f"Could not persist _stock_decremented flag: {upd_err}")
            except Exception as inv_err:
                # Order must not fail because of inventory accounting.
                logger.error(f"Stock decrement failed (non-fatal): {inv_err}")

            # Get wait time - use separate try block to ensure failures don't affect order
            wait_time = 10  # Default wait time
            try:
                wait_time = self._get_station_wait_time(station_id)
            except Exception as wait_err:
                logger.error(f"Error getting wait time: {str(wait_err)}")

            # Get this customer's queue position at their station so we can
            # tell them up-front "you're #3 in line". Failure here is
            # non-critical; we just omit the position from the SMS.
            queue_position = None
            try:
                queue_position = self._get_queue_position(station_id, order_number)
            except Exception as qp_err:
                logger.error(f"Error getting queue position: {str(qp_err)}")
            
            # Set conversation to completed - use separate try block to ensure failures don't affect order
            try:
                self._set_conversation_state(phone, 'completed')
            except Exception as conv_err:
                logger.error(f"Error setting conversation state: {str(conv_err)}")
            
            # Check if this milk type is only available at one station.
            # Historical bug: this used to query a `stations` table that
            # doesn't exist in this schema (the table is `station_stats`
            # — capabilities live there as a JSONB column). The failing
            # query left the connection in an aborted-transaction state,
            # which poisoned every subsequent read on `self.db` (orders
            # list, customer lookup, milk inventory). Now we point at the
            # right table AND wrap the whole probe in a SAVEPOINT so any
            # future schema drift can't cascade either.
            milk_is_unique = False
            unique_station_info = None
            requested_milk = (processed_details.get('milk') or '').lower()

            if requested_milk and requested_milk != 'no milk' and db_type != "sqlite":
                try:
                    cursor.execute("SAVEPOINT milk_uniq_probe")
                    cursor.execute("""
                        SELECT COUNT(DISTINCT station_id) AS station_count
                        FROM station_stats
                        WHERE capabilities IS NOT NULL
                          AND (capabilities->'milk_types') ? %s
                    """, (requested_milk,))

                    result = cursor.fetchone()
                    if result:
                        count_val = result[0] if not isinstance(result, dict) else \
                                    (result.get('station_count') or list(result.values())[0])
                        if count_val == 1:
                            milk_is_unique = True
                            unique_station_info = (station_id, wait_time)
                    cursor.execute("RELEASE SAVEPOINT milk_uniq_probe")
                except Exception as milk_check_err:
                    logger.warning(
                        f"Milk uniqueness probe failed (non-fatal): {milk_check_err}"
                    )
                    try:
                        cursor.execute("ROLLBACK TO SAVEPOINT milk_uniq_probe")
                    except Exception:
                        pass
            
            # Build the queue-position string once for reuse.
            if queue_position is not None and queue_position > 0:
                position_line = (
                    f"You're #1 in line — your barista will start it shortly."
                    if queue_position == 1
                    else f"You're #{queue_position} in line (~{wait_time} min wait)."
                )
            else:
                position_line = f"Estimated wait time: {wait_time} minutes."

            # Build the confirmation message
            if milk_is_unique and unique_station_info:
                # Show station immediately if it's the only one with this milk
                confirmation_message = (
                    f"✅ Order #{order_number} confirmed!\n"
                    f"{processed_details.get('milk').title()} is available at Station {station_id} only.\n"
                    f"{position_line}"
                )
            else:
                # Standard message - don't show station immediately
                confirmation_message = (
                    f"✅ Order #{order_number} confirmed!\n"
                    f"{position_line}\n"
                    f"You'll get an SMS when ready with pickup location."
                )

            # If the customer asked for a specific station but we had to
            # reassign (invalid station number, capacity, etc.) let them know
            # — silently routing the order elsewhere has caused confusion.
            if station_was_reassigned:
                confirmation_message += (
                    f"\n\nNote: Station {requested_station_id} isn't available right now, "
                    f"so your order was routed to Station {station_id}."
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

                # event_breaks.start_time / end_time are TIME columns,
                # which psycopg2 surfaces as datetime.time objects — not
                # the "HH:MM" strings this code originally assumed. The
                # bare .split() call used to throw AttributeError, the
                # outer except handler caught it, and the function
                # silently fell back to "least loaded station" —
                # bypassing ALL the milk-specific routing. Handle both
                # shapes defensively.
                def _hours(value):
                    if hasattr(value, 'hour') and hasattr(value, 'minute'):
                        return int(value.hour), int(value.minute)
                    return tuple(int(p) for p in str(value).split(':')[:2])

                start_hour, start_minute = _hours(start_str)
                end_hour, end_minute = _hours(end_str)
                
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
                        # event_breaks.stations is JSONB; psycopg2
                        # already deserialises to a list, so don't
                        # double-parse.
                        'stations': stations_json if isinstance(stations_json, list)
                                    else (json.loads(stations_json) if stations_json else [])
                    }
                    break
                
                # Check if this is the next upcoming break
                if (current_hour < start_hour) or \
                   (current_hour == start_hour and current_minute < start_minute):
                    next_break = {
                        'id': break_id,
                        'start': (start_hour, start_minute),
                        'end': (end_hour, end_minute),
                        # event_breaks.stations is JSONB; psycopg2
                        # already deserialises to a list, so don't
                        # double-parse.
                        'stations': stations_json if isinstance(stations_json, list)
                                    else (json.loads(stations_json) if stations_json else [])
                    }
                    break
            
            # Get all stations with their current load and capabilities.
            # Historical bug: this read from `equipment_notes` (which is
            # not a column on station_stats) — capabilities are stored in
            # the JSONB column literally named `capabilities`. The bad
            # column name returned NULL → fell through to the
            # hard-coded "full cream + skim" default → so every soy /
            # oat / almond order ignored station capabilities and got
            # routed by load only.
            cursor.execute("""
                SELECT station_id, COALESCE(current_load, 0),
                       COALESCE(capabilities, '{}'::jsonb) AS capabilities,
                       COALESCE(status, 'active') AS current_status
                FROM station_stats
                WHERE status IN ('active', 'open') OR status IS NULL
                ORDER BY COALESCE(current_load, 0)
            """)

            stations = []
            stations_with_milk = {}  # Track which stations have specific milk types

            for station_data in cursor.fetchall():
                station_id, load, capabilities_value, status = station_data
                # capabilities_value may already be a dict (psycopg2's
                # JSONB adapter) or a string (older driver / SQLite).
                if isinstance(capabilities_value, dict):
                    capabilities = capabilities_value
                else:
                    try:
                        capabilities = json.loads(capabilities_value) if capabilities_value and capabilities_value != '{}' else {}
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
            
            # Pull the operator's load-balancing preferences. These come
            # from Barista → Queue AI (or admin can override via
            # /api/routing-rules). They shape the algorithm below
            # without changing its overall structure.
            routing = self._get_routing_rules()
            consider_capabilities = bool(routing.get('considerCapabilities', True))
            balance_workload      = bool(routing.get('balanceWorkload', True))
            prioritize_efficiency = bool(routing.get('prioritizeEfficiency', True))
            emergency_mode        = bool(routing.get('emergencyMode', False))

            # Special handling for specific milk type orders. In
            # emergency mode (or with considerCapabilities turned off),
            # we don't refuse the order if no station has that milk —
            # we just assign it to the least-busy station and let the
            # barista improvise. Closes the gap where the operator
            # turned off oat mid-event but the wizard hadn't caught up.
            if milk_type_normalized:
                milk_capable_stations = [s for s in active_stations if milk_type_normalized in s['milk_types']]
                if milk_capable_stations:
                    # Sort by load to find the least busy station with this milk
                    milk_capable_stations.sort(key=lambda s: s['load'])
                    logger.info(f"Assigned {milk_type} order to station {milk_capable_stations[0]['id']} "
                                f"(milk-capability match)")
                    return milk_capable_stations[0]['id'], False
                else:
                    if not consider_capabilities or emergency_mode:
                        logger.warning(f"No active stations have {milk_type}, but "
                                       f"considerCapabilities={consider_capabilities} / "
                                       f"emergencyMode={emergency_mode}; falling through to "
                                       f"normal load-balancing.")
                        # Fall through to the general weighted selection below.
                    else:
                        logger.warning(f"No active stations have {milk_type}, cannot fulfill order")
                        return 1, False  # Default fallback

            # Calculate weights for station selection based on load and capacity.
            # The exact mix is driven by the routing rules:
            #   balanceWorkload=False       → ignore load score (use capacity only)
            #   prioritizeEfficiency=False  → ignore capacity bonus (use load only)
            #   both False                  → uniform random; not what you want, but
            #                                 we let the operator do it
            weighted_stations = []
            for station in active_stations:
                norm_load = min(1.0, station['load'] / station['capacity']) if station['capacity'] > 0 else 1.0
                load_score = 1.0 - norm_load
                capacity_weight = station['capacity'] / 10.0

                load_term = load_score if balance_workload else 1.0
                cap_term  = capacity_weight if prioritize_efficiency else 1.0
                final_weight = load_term * cap_term
                weighted_stations.append((station['id'], max(0.01, final_weight)))

            # If only one station, use it
            if len(weighted_stations) == 1:
                return weighted_stations[0][0], False

            # If balanceWorkload is OFF but prioritizeEfficiency is ON,
            # the operator wants deterministic "send to the biggest free
            # station". Skip the random draw and just pick the highest.
            if not balance_workload:
                weighted_stations.sort(key=lambda t: t[1], reverse=True)
                logger.info(f"Assigned order to station {weighted_stations[0][0]} "
                            f"(balanceWorkload=False → deterministic pick)")
                return weighted_stations[0][0], False

            # Otherwise do weighted random selection (the existing behavior).
            station_ids, weights = zip(*weighted_stations)
            total_weight = sum(weights)
            norm_weights = [w/total_weight for w in weights]

            rand = random.random()
            cumulative = 0
            for i, weight in enumerate(norm_weights):
                cumulative += weight
                if rand <= cumulative:
                    logger.info(f"Assigned order to station {station_ids[i]} using weighted selection "
                                f"(rules: balance={balance_workload}, eff={prioritize_efficiency})")
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
    
    # Per-drink consumption defaults. Tweak per event in the inventory
    # UI later; these are the "if I don't know better" values.
    _SIZE_TO_ML = {'small': 150, 'medium': 200, 'large': 280}
    _COFFEE_SHOTS_BY_TYPE = {
        'espresso': 1, 'long black': 1, 'short black': 1, 'americano': 1,
        'flat white': 1, 'latte': 1, 'cappuccino': 1, 'mocha': 1,
        'piccolo': 1, 'macchiato': 1, 'cortado': 1,
    }

    def _decrement_stock_for_order(self, conn, db_type, station_id, processed_details):
        """Decrement the milk and coffee an order consumed.

        Tries the station-specific row first (station_id = X) and falls
        back to the event-wide row (station_id IS NULL) so reports at
        either scope stay accurate without requiring operators to track
        both.

        Quantities are deliberately conservative defaults the operator
        can override later via the inventory UI:
          - milk:   size-dependent (small=150, medium=200, large=280 mL),
                    converted to L (the unit milk inventory uses)
                    BUT tea-with-milk only uses ~30 mL (a splash).
          - coffee: 1 shot per drink for everything except double-shot
                    espresso, etc. (we don't currently model strength)
          - cups:   1 per order normally, 2 when tea-double-cup is on.

        Skips items not in stock so an empty `oat` row doesn't go
        negative on a customer who somehow placed an oat order anyway.

        Returns a result dict so callers (and the `/complete` endpoint)
        can surface what actually got decremented vs. what was skipped
        because no inventory row matched. Previously this was a
        fire-and-forget that swallowed missing-row errors silently —
        baristas had no way to know if the oat milk counter actually
        ticked down.

        Shape:
          {
            'decremented': ['milk:oat', 'coffee:latte', 'cups:medium'],
            'skipped':     [{'category': 'cups', 'name': 'medium',
                              'reason': 'no matching inventory row'}],
          }
        """
        result = {'decremented': [], 'skipped': []}
        # Idempotency guard. The SMS confirmation flow calls this on
        # order confirm; the new /complete endpoint also calls it for
        # walk-in orders. If both fire on the same order we'd
        # double-decrement. Caller is expected to set/check a
        # `_stock_decremented` flag on processed_details to mark
        # completion, but as a backstop we no-op here when we see it.
        if processed_details.get('_stock_decremented'):
            return result
        cursor = conn.cursor()
        size = (processed_details.get('size') or 'medium').lower()
        milk = (processed_details.get('milk') or '').lower()
        coffee_type = (processed_details.get('type') or '').lower()
        # Tea detection: any drink with "tea" in the type name, OR an
        # explicit is_tea flag set by the walk-in dialog.
        is_tea = bool(processed_details.get('is_tea')) or ('tea' in coffee_type)
        tea_double_cup = bool(processed_details.get('tea_double_cup'))

        # --- milk ---------------------------------------------------
        if milk and milk != 'no milk':
            if is_tea:
                # Tea milk is a splash — most customers want barely any.
                # 30 mL keeps the decrement honest without overstating
                # consumption.
                liters = 30 / 1000.0
            else:
                ml = self._SIZE_TO_ML.get(size, 200)
                liters = ml / 1000.0
            if self._decrement_inventory_item(
                cursor, db_type, category='milk', name=milk,
                amount=liters, station_id=station_id,
            ):
                result['decremented'].append(f"milk:{milk}")
            else:
                result['skipped'].append({
                    'category': 'milk', 'name': milk,
                    'reason': 'no matching inventory row',
                })

        # --- coffee shots -------------------------------------------
        # Tea uses no coffee beans. Skip the shot decrement entirely.
        if not is_tea:
            shots = self._COFFEE_SHOTS_BY_TYPE.get(coffee_type, 1)
            # A "strong" or "double" order adds a shot — best effort.
            if (processed_details.get('strength') or '').lower() in ('strong', 'double', 'extra shot'):
                shots += 1
            if shots > 0 and coffee_type:
                if self._decrement_inventory_item(
                    cursor, db_type, category='coffee', name=coffee_type,
                    amount=shots, station_id=station_id,
                ):
                    result['decremented'].append(f"coffee:{coffee_type}")
                else:
                    result['skipped'].append({
                        'category': 'coffee', 'name': coffee_type,
                        'reason': 'no matching inventory row',
                    })

        # --- cups ---------------------------------------------------
        # Tea is typically double-cupped because the cup gets too hot
        # to hold; the walk-in dialog defaults the toggle to ON. We
        # don't know the exact cup name the operator is using so we
        # try a few common matches.
        cups_used = 2 if (is_tea and tea_double_cup) else 1
        size_label = (processed_details.get('size') or 'medium').lower()
        cup_candidates = [
            size_label,                                  # 'medium'
            f"{size_label} (12oz)" if size_label == 'medium' else '',
            f"{size_label} (8oz)"  if size_label == 'small'  else '',
            f"{size_label} (16oz)" if size_label == 'large'  else '',
            f"takeaway cup {size_label}",
            'cup', 'cups',
        ]
        cup_decremented = False
        for cup_name in [c for c in cup_candidates if c]:
            if self._decrement_inventory_item(
                cursor, db_type, category='cups', name=cup_name,
                amount=cups_used, station_id=station_id,
            ):
                result['decremented'].append(f"cups:{cup_name}")
                cup_decremented = True
                break
        if not cup_decremented:
            result['skipped'].append({
                'category': 'cups', 'name': size_label,
                'reason': 'no matching inventory row',
            })

        # --- sugar / sweeteners -------------------------------------
        # Sugar is tracked in *sachets* (or grams) — never in
        # kilograms. We bill 1 sachet per "1 sugar", 2 per "2 sugar",
        # etc. "no sugar" decrements nothing. The category check is
        # broad so "sugar" / "sweetener" / "artificial_sweetener" all
        # match — the inventory data model still mixes these up.
        sugar = (processed_details.get('sugar') or '').lower()
        sachets = self._sugar_sachets_from_text(sugar)
        if sachets > 0:
            sugar_decremented = False
            for cat in ('sweetener', 'sugar', 'artificial_sweetener'):
                if self._decrement_inventory_item(
                    cursor, db_type, category=cat, name=sugar,
                    amount=sachets, station_id=station_id,
                ):
                    result['decremented'].append(f"{cat}:{sugar}")
                    sugar_decremented = True
                    break
            if not sugar_decremented:
                result['skipped'].append({
                    'category': 'sweetener', 'name': sugar,
                    'reason': 'no matching inventory row',
                })

        conn.commit()
        return result

    @staticmethod
    def _sugar_sachets_from_text(sugar_text):
        """Translate '1 sugar' / 'two sugar' / '3 sugar' → integer count.

        Returns 0 for 'no sugar' or unparseable values.
        """
        if not sugar_text or 'no' in sugar_text or sugar_text == 'none':
            return 0
        if 'half' in sugar_text:
            return 1  # round up — half-sachets aren't a thing
        import re as _re
        m = _re.match(r'(\d+)', sugar_text)
        if m:
            return max(0, min(10, int(m.group(1))))
        # Handle "one", "two", "three"
        words = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5}
        for w, n in words.items():
            if w in sugar_text:
                return n
        return 0

    def _decrement_inventory_item(self, cursor, db_type, *, category, name, amount, station_id):
        """Decrement a single inventory row, preferring station scope.

        Match cascade — each step gets progressively more forgiving so
        a perfectly normal order doesn't trip 'no matching row':

          1. Exact LOWER(name) match at station scope
          2. Same, event-wide (station_id IS NULL)
          3. Partial match — LIKE '%token%' both ways. Handles:
               * 'oat'        ↔ DB 'Oat Milk'
               * 'oat milk'   ↔ DB 'Oat'
               * 'small (8oz)' ↔ DB 'Small'
               * '1 white sugar' ↔ DB 'White Sugar'
          4. Category fallback — for `coffee`, any item in the category
             (since beans aren't typed per-drink and the whole category
             is what gets consumed).

        Returns True if a row was actually updated, False otherwise.
        """
        ph = '?' if db_type == 'sqlite' else '%s'
        name_norm = (name or '').strip().lower()
        if not name_norm:
            return False

        def _exact(sql_extra, params):
            cursor.execute(
                f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, amount - {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE category = {ph} AND LOWER(name) = {ph}
                  AND amount IS NOT NULL
                  {sql_extra}
                """,
                (amount, category, name_norm, *params),
            )
            return cursor.rowcount or 0

        # Step 1: exact match at station scope.
        if _exact(f"AND station_id = {ph}", (station_id,)) > 0:
            return True
        # Step 2: exact match event-wide.
        if _exact("AND station_id IS NULL", ()) > 0:
            return True

        # Step 3: partial-match cascade. Build the candidate tokens by
        # stripping noise that often differs between order text and
        # inventory row name (' milk' suffix, parenthetical sizes,
        # leading count words like '1 ').
        import re as _re
        candidates = {name_norm}
        # Strip a trailing ' milk' for milk-category names so
        # 'oat milk' matches 'oat' and vice versa.
        if name_norm.endswith(' milk'):
            candidates.add(name_norm[:-5].strip())
        # Strip parenthetical content for cups: 'small (8oz)' → 'small'.
        no_paren = _re.sub(r'\s*\([^)]*\)\s*', '', name_norm).strip()
        if no_paren:
            candidates.add(no_paren)
        # Strip a leading numeric count for sweeteners: '1 white sugar' → 'white sugar'.
        no_count = _re.sub(r'^\d+\s+', '', name_norm).strip()
        if no_count:
            candidates.add(no_count)

        # For each candidate try a substring match (both directions —
        # row name contains candidate OR candidate contains row name).
        for cand in candidates:
            if not cand:
                continue
            cursor.execute(
                f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, amount - {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT id FROM inventory_items
                    WHERE category = {ph}
                      AND amount IS NOT NULL
                      AND (LOWER(name) LIKE {ph} OR {ph} LIKE '%' || LOWER(name) || '%')
                      AND (station_id = {ph} OR station_id IS NULL)
                    ORDER BY (station_id = {ph}) DESC NULLS LAST
                    LIMIT 1
                )
                """,
                (amount, category, f"%{cand}%", cand, station_id, station_id),
            )
            if (cursor.rowcount or 0) > 0:
                logger.debug(
                    f"Stock decrement matched via partial: requested='{name}', "
                    f"category={category}, candidate='{cand}'"
                )
                return True

        # Step 4: category fallback for fungible categories. Coffee
        # beans aren't typed per drink, and sweetener / sugar
        # inventory rows are typically by-count ('1 sugar') while
        # order text combines count + type ('1 White Sugar') — both
        # cases mean "decrement any row in this category".
        if category in ('coffee', 'sugar', 'sweetener', 'artificial_sweetener'):
            cursor.execute(
                f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, amount - {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT id FROM inventory_items
                    WHERE category = {ph}
                      AND amount IS NOT NULL
                      AND (station_id = {ph} OR station_id IS NULL)
                    ORDER BY (station_id = {ph}) DESC NULLS LAST,
                             LOWER(name) ASC
                    LIMIT 1
                )
                """,
                (amount, category, station_id, station_id),
            )
            if (cursor.rowcount or 0) > 0:
                logger.debug(
                    f"Stock decrement matched via category fallback: "
                    f"requested='{name}', category={category}"
                )
                return True

        logger.info(
            f"No inventory row to decrement: category={category} name={name}"
        )
        return False

    def _get_queue_position(self, station_id, order_number):
        """Return this order's 1-based position in the station queue.

        Counts non-completed, non-cancelled orders at the same station that
        were created at or before the given order. Used to tell the
        customer "you're #3 in line" in their confirmation SMS so they
        don't think the bot just dropped their order into the void.

        Returns None if the order isn't found yet (race) or on error —
        the caller treats None as "skip the position line".
        """
        try:
            is_sqlite = isinstance(self.db, sqlite3.Connection)
            cursor = self.db.cursor()
            placeholder = '?' if is_sqlite else '%s'
            cursor.execute(
                f"""
                SELECT COUNT(*)
                FROM orders
                WHERE station_id = {placeholder}
                  AND status IN ('pending', 'in-progress')
                  AND created_at <= (
                      SELECT created_at FROM orders WHERE order_number = {placeholder}
                  )
                """,
                (station_id, order_number),
            )
            row = cursor.fetchone()
            if not row:
                return None
            count = row[0] if not isinstance(row, dict) else list(row.values())[0]
            return int(count) if count is not None else None
        except Exception as e:
            logger.error(f"Error computing queue position: {str(e)}")
            return None

    def _get_recent_completion_avg_minutes(self, station_id, window_minutes=60, sample_size=20):
        """Compute a moving-average prep time from real recent orders.

        Looks at orders completed at this station within the last
        `window_minutes`, takes up to `sample_size` of them, and
        averages the delta from created_at → updated_at. Returns None
        if there's not enough data (caller falls back to a heuristic).

        Used by _get_station_wait_time() — gives a much more honest
        "your drink in ~7 min" estimate than the static 10-minute
        default that was previously displayed.
        """
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) / 60.0 AS minutes
                FROM orders
                WHERE station_id = %s
                  AND status IN ('completed', 'picked_up')
                  AND updated_at >= NOW() - (%s || ' minutes')::interval
                  AND created_at IS NOT NULL
                  AND updated_at IS NOT NULL
                ORDER BY updated_at DESC
                LIMIT %s
                """,
                (station_id, str(window_minutes), sample_size),
            )
            rows = cursor.fetchall()
            if not rows:
                return None
            # Clamp individual samples to [0.5, 30] min so a single
            # outlier (e.g. an order someone left to ferment in
            # "in-progress" for hours) doesn't poison the average.
            samples = []
            for row in rows:
                v = row[0] if not isinstance(row, dict) else list(row.values())[0]
                try:
                    m = float(v)
                except (TypeError, ValueError):
                    continue
                if 0.5 <= m <= 30:
                    samples.append(m)
            if not samples:
                return None
            return sum(samples) / len(samples)
        except Exception as e:
            logger.warning(f"_get_recent_completion_avg_minutes failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return None

    def _get_station_pending_count(self, station_id):
        """How many orders are queued/in-progress at this station right now."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT COUNT(*) FROM orders "
                "WHERE station_id = %s AND status IN ('pending', 'in-progress')",
                (station_id,),
            )
            row = cursor.fetchone()
            return int(row[0]) if row else 0
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
            return 0

    def _get_station_wait_time(self, station_id):
        """Get estimated wait time for a station.

        Updated May 2026: now uses a moving-average prep time
        (last hour, up to 20 orders) × queue depth to produce a
        realistic "your drink should be ready in ~X minutes" number,
        rather than the static 10-minute default that was previously
        shown to every customer.

        Order of precedence:
          1. Moving average × queue depth (best — real data)
          2. station_stats.avg_completion_time × current_load (legacy)
          3. station_stats.wait_time (operator override)
          4. waitTime from `stations` table (older schema)
          5. Static fallback (10 min)
        """
        try:
            # 1. Best signal: real recent completions × queue depth.
            avg_min = self._get_recent_completion_avg_minutes(station_id)
            if avg_min is not None:
                queue = self._get_station_pending_count(station_id)
                # +1 for "the order we're about to place"; if the
                # station has spare capacity (queue <= 1), the wait is
                # just the prep time. Otherwise scale by queue depth.
                wait = avg_min * max(1, queue)
                # Clamp to a reasonable range.
                return max(1, min(int(round(wait)), 45))
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
    
    def _is_state_stale(self, state_obj):
        """Return True if this conversation has been idle too long.

        We treat a state as stale if `last_interaction` is older than
        `self.stale_conversation_minutes`. Customers who get
        interrupted mid-flow ("latte" -> bot asks "what milk?" ->
        crickets) shouldn't have their reply hours/days later land
        in the milk handler. Once stale, the state is reset so the
        next message starts a fresh conversation.
        """
        try:
            minutes = int(self.stale_conversation_minutes or 0)
        except (TypeError, ValueError):
            minutes = 0
        if minutes <= 0:
            return False
        last = state_obj.get('last_interaction') if isinstance(state_obj, dict) else None
        if not last:
            return False
        # last_interaction may come back as datetime (psycopg2) or
        # string (sqlite or some driver configs). Coerce to datetime.
        if isinstance(last, str):
            try:
                # Strip fractional seconds and timezone for fromisoformat
                # compatibility on older Pythons.
                last = datetime.fromisoformat(last)
            except Exception:
                try:
                    last = datetime.strptime(last.split('.')[0], '%Y-%m-%d %H:%M:%S')
                except Exception:
                    return False
        try:
            return (datetime.now() - last) > timedelta(minutes=minutes)
        except Exception:
            return False

    def _reset_conversation_state(self, phone):
        """Wipe the conversation state for a phone, in cache + DB.

        Used when a state has gone stale (see `_is_state_stale`) so
        the next message starts cleanly.
        """
        self.conversation_states.pop(phone, None)
        try:
            is_sqlite = isinstance(self.db, sqlite3.Connection)
            from utils.database import get_db_connection, close_connection
            conn = get_db_connection()
            cursor = conn.cursor()
            if is_sqlite:
                cursor.execute(
                    "DELETE FROM conversation_states WHERE phone = ?",
                    (phone,),
                )
            else:
                cursor.execute(
                    "DELETE FROM conversation_states WHERE phone = %s",
                    (phone,),
                )
            conn.commit()
            close_connection(conn)
        except Exception as e:
            logger.warning(f"Could not clear stale conversation state for {phone}: {e}")

    def _get_conversation_state(self, phone):
        """Get the conversation state for a phone number"""
        # Check in-memory cache first
        if phone in self.conversation_states:
            cached = self.conversation_states[phone]
            if self._is_state_stale(cached):
                logger.info(
                    f"Conversation state for {phone} is stale "
                    f"(idle > {self.stale_conversation_minutes} min). "
                    f"Resetting to fresh greeting flow."
                )
                self._reset_conversation_state(phone)
                return {'state': None, 'temp_data': {}, 'message_count': 0}
            return cached

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

                # If the state has gone stale since the last message,
                # wipe it so the customer's new message starts fresh
                # instead of being routed to a mid-order handler.
                if self._is_state_stale(state_obj):
                    logger.info(
                        f"Conversation state for {phone} is stale "
                        f"(idle > {self.stale_conversation_minutes} min). "
                        f"Resetting to fresh greeting flow."
                    )
                    self._reset_conversation_state(phone)
                    return {'state': None, 'temp_data': {}, 'message_count': 0}

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

