"""
Enhanced Coffee Ordering System with improved SMS conversation handling
"""
import logging
from utils.station_label import station_label
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
from utils.order_provenance import stamp as stamp_provenance

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
        self._db = db
        self.config = config
        self.nlp = NLPService()
        # Boot-time fallback. The `event_name` property below reads
        # the LIVE value from branding_settings on each access so
        # operator edits via the Branding panel flow through to SMS
        # responses immediately (no restart needed).
        self._event_name_boot = config.get("EVENT_NAME", "Coffee Event")

        # Initialize conversation states dictionary
        self.conversation_states = {}

        # Stale conversation timeout — if a customer starts an order
        # ("latte") and the bot is mid-flow asking for milk, but they
        # never reply, the state would otherwise linger forever.
        # When they text again hours later their reply would land in
        # `_handle_awaiting_milk` and confuse them. Reset the state
        # after this many minutes of inactivity so the next message
        # starts a fresh conversation.
        self.stale_conversation_minutes = config.get("STALE_CONVERSATION_MINUTES", 20)

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

    def _end_read_transaction(self):
        """Finish the implicit transaction a read-only check opened.

        psycopg2 is not autocommit, so even a bare SELECT starts a
        transaction that holds ACCESS SHARE on every table it touched
        until someone ends it. `self.db` is the process-lifetime
        singleton connection, so a boot-time check that reads and
        returns pins those locks for as long as the server runs.

        The cost only shows up later: ALTER TABLE needs ACCESS
        EXCLUSIVE and queues behind the idle transaction, and a queued
        ACCESS EXCLUSIVE blocks every reader that arrives after it. One
        forgotten rollback in a startup check is enough to hang login
        across the whole system, with no crash to restart.

        Call this in a `finally` from any init path that only reads.
        """
        try:
            self.db.rollback()
        except Exception as e:  # pragma: no cover - cleanup only
            logger.debug(f"Could not end read transaction: {e}")

    @property
    def event_name(self):
        """Live event name — reads branding_settings on each access.

        Falls back to the boot-time EVENT_NAME config value if the
        branding row isn't set yet. Cached for a short window to
        avoid hitting the DB on every SMS.
        """
        # Short cache so a high-volume burst doesn't hit DB N times.
        cached = getattr(self, "_event_name_cache", None)
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
                        blob.get("event_name")
                        or blob.get("eventName")
                        or blob.get("landingTitle")
                        or blob.get("clientName")
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

    @property
    def system_name(self):
        """Live product name -- what the system calls ITSELF in SMS.

        Separate from `event_name`: the event is "Treenet 2026", the
        system is "CupQ". Both appear in messages to customers and the
        operator can rename either from the Branding panel, so neither
        may be hardcoded in a string a customer reads.

        Same short cache and same rollback discipline as `event_name` --
        see `_end_read_transaction` for why an un-ended read matters on
        the singleton connection.
        """
        cached = getattr(self, "_system_name_cache", None)
        if cached and (datetime.now() - cached[1]).total_seconds() < 30:
            return cached[0]
        name = "CupQ"
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
                    candidate = blob.get("systemName") or blob.get("system_name")
                    if candidate:
                        name = candidate
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        self._system_name_cache = (name, datetime.now())
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
            cursor.execute(
                "SELECT key, value FROM settings WHERE key IN ('sponsor_display_enabled', 'sponsor_name', 'sponsor_message')"
            )
            settings = cursor.fetchall()

            sponsor_info = {}
            for key, value in settings:
                if key == "sponsor_display_enabled":
                    sponsor_info["enabled"] = value.lower() in (
                        "true",
                        "yes",
                        "1",
                        "t",
                        "y",
                    )
                elif key == "sponsor_name":
                    sponsor_info["name"] = value
                elif key == "sponsor_message":
                    sponsor_info["message"] = value

            # Format message if needed
            if (
                sponsor_info.get("enabled", False)
                and sponsor_info.get("name")
                and "{sponsor}" in sponsor_info.get("message", "")
            ):
                sponsor_info["message"] = sponsor_info["message"].replace(
                    "{sponsor}", sponsor_info["name"]
                )

            self.sponsor_info = sponsor_info
        except Exception as e:
            logger.error(f"Error loading sponsor info: {str(e)}")
            self.sponsor_info = {"enabled": False}
        finally:
            # Read-only check — must not leave the singleton connection
            # idle in transaction. See _end_read_transaction.
            self._end_read_transaction()

    def _initialize_stations(self):
        """Check if any stations exist, log warning if none found"""
        try:
            cursor = self.db.cursor()

            # Just check if we have any stations
            cursor.execute("SELECT COUNT(*) FROM station_stats")
            station_count = cursor.fetchone()[0]

            if station_count == 0:
                logger.warning(
                    "No stations found in database. Please create stations through the Organizer interface."
                )
            else:
                logger.info(f"Found {station_count} stations in database")

        except Exception as e:
            logger.error(f"Error checking stations: {str(e)}")
        finally:
            # Read-only check — must not leave the singleton connection
            # idle in transaction. See _end_read_transaction.
            self._end_read_transaction()

    def _init_settings(self):
        """Initialize default system settings"""
        try:
            cursor = self.db.cursor()

            # Create settings table if needed
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    description TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Define default settings
            # IMPORTANT: keep {event_name} as a literal PLACEHOLDER here, not
            # an f-string. An f-string bakes the current event name into the
            # stored row, so renaming the event later never updates the SMS
            # welcome (customers kept getting a previous event's name). The
            # SMS handler substitutes {event_name} with the live event name
            # at send time.
            default_settings = [
                (
                    "sms_welcome_message",
                    "Welcome to {event_name}! I'll take your coffee order. What's your first name?",
                    "Welcome message for SMS conversations",
                ),
                ("enable_web_tracking", "false", "Enable web tracking URLs for orders"),
                (
                    "web_tracking_url",
                    "https://coffee.example.com/order/",
                    "Base URL for order tracking web page",
                ),
                (
                    "default_wait_time",
                    "10",
                    "Default wait time in minutes for new orders",
                ),
                (
                    "show_friend_orders",
                    "true",
                    "Show related friend orders in status updates",
                ),
                ("max_group_size", "5", "Maximum number of orders in a group"),
                (
                    "short_url_service",
                    "false",
                    "Enable short URL generation for tracking links",
                ),
            ]

            # Insert default settings if they don't exist
            for key, value, description in default_settings:
                cursor.execute("SELECT key FROM settings WHERE key = %s", (key,))
                if not cursor.fetchone():
                    cursor.execute(
                        """
                        INSERT INTO settings (key, value, description) 
                        VALUES (%s, %s, %s)
                    """,
                        (key, value, description),
                    )
                    logger.info(f"Created default setting: {key}")

            # Self-heal databases seeded by the old f-string bug: if the
            # stored welcome message has the event name baked in (no
            # {event_name} placeholder), reset it to the templated default so
            # it tracks the live event again. No UI customises this message,
            # so a placeholder-less value is always the stale seed — safe to
            # restore. This is what fixes "still getting the old event name in
            # the SMS welcome" on existing deployments.
            try:
                cursor.execute(
                    "SELECT value FROM settings WHERE key = 'sms_welcome_message'"
                )
                _wm = cursor.fetchone()
                _wm_val = (_wm[0] if _wm else "") or ""
                if _wm_val and "{event_name}" not in _wm_val:
                    cursor.execute(
                        "UPDATE settings SET value = %s WHERE key = 'sms_welcome_message'",
                        (
                            "Welcome to {event_name}! I'll take your coffee order. What's your first name?",
                        ),
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
            # Swallowed so boot continues — roll back so the connection
            # is not handed on in an aborted transaction.
            self._end_read_transaction()

    def _init_stations(self):
        """Initialize coffee stations and event scheduling"""
        try:
            num_stations = self.config.get("NUM_STATIONS", 3)

            # Initialize stations in the database
            Station.initialize_stations(self.db, num_stations)

            # Initialize event breaks and scheduling
            self._init_event_scheduling()

            logger.info(f"Initialized {num_stations} coffee stations with scheduling")
        except Exception as e:
            logger.error(f"Error initializing stations: {str(e)}")
            # Swallowed so boot continues — roll back so the connection
            # is not handed on in an aborted transaction.
            self._end_read_transaction()

    def _init_event_scheduling(self):
        """Initialize event scheduling tables and data"""
        try:
            cursor = self.db.cursor()

            # Create event_breaks table if it doesn't exist
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS event_breaks (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(100) NOT NULL,
                    day_of_week INTEGER NOT NULL,
                    start_time TIME NOT NULL,
                    end_time TIME NOT NULL,
                    stations JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Check if we have any breaks defined
            cursor.execute("SELECT COUNT(*) FROM event_breaks")
            count = cursor.fetchone()[0]

            if count == 0:
                # Insert some default breaks for demonstration
                default_breaks = [
                    (
                        "Morning Coffee",
                        0,
                        "08:30",
                        "10:00",
                        json.dumps([1, 2, 3]),
                    ),  # Monday morning
                    (
                        "Morning Break",
                        0,
                        "10:30",
                        "11:30",
                        json.dumps([1, 2]),
                    ),  # Monday morning break
                    (
                        "Lunch Break",
                        0,
                        "12:30",
                        "14:00",
                        json.dumps([1, 2, 3]),
                    ),  # Monday lunch
                    (
                        "Afternoon Break",
                        0,
                        "15:30",
                        "16:30",
                        json.dumps([2, 3]),
                    ),  # Monday afternoon
                    (
                        "Morning Coffee",
                        1,
                        "08:30",
                        "10:00",
                        json.dumps([1, 2, 3]),
                    ),  # Tuesday morning
                    (
                        "Morning Break",
                        1,
                        "10:30",
                        "11:30",
                        json.dumps([1, 2]),
                    ),  # Tuesday morning break
                    (
                        "Lunch Break",
                        1,
                        "12:30",
                        "14:00",
                        json.dumps([1, 2, 3]),
                    ),  # Tuesday lunch
                    (
                        "Afternoon Break",
                        1,
                        "15:30",
                        "16:30",
                        json.dumps([2, 3]),
                    ),  # Tuesday afternoon
                ]

                for title, day, start, end, stations in default_breaks:
                    cursor.execute(
                        """
                        INSERT INTO event_breaks (title, day_of_week, start_time, end_time, stations)
                        VALUES (%s, %s, %s, %s, %s)
                    """,
                        (title, day, start, end, stations),
                    )

                self.db.commit()
                logger.info("Created default event breaks schedule")

            # The schema-patching ALTER TABLEs that used to live here
            # have MOVED to services/migrations.py (migrations #1
            # station_stats_extras, #2 customer_preferences_is_vip,
            # #3 users_is_active). They are gone from this function on
            # purpose — do not add ALTER TABLE back to a boot path.
            #
            # They were written as "ADD COLUMN IF NOT EXISTS", which
            # reads like a harmless no-op once the column exists. It is
            # not. Postgres takes ACCESS EXCLUSIVE on the table BEFORE
            # it checks whether the column is already there, so every
            # boot took the strongest possible lock on `users`,
            # `station_stats` and `customer_preferences` — for nothing.
            #
            # With one instance that is invisible. With two on the same
            # database — an overlapping Railway deploy, or a second
            # local server — the booting instance's ALTER queues behind
            # whatever the running instance holds, and a queued ACCESS
            # EXCLUSIVE blocks every reader that arrives afterwards.
            # Login hangs everywhere, nothing crashes, nothing restarts.
            # Reproduced five times out of five on 2026-08-24.
            #
            # Under the migrations runner these run ONCE per database,
            # recorded in schema_migrations, under a lock_timeout. A
            # steady-state boot now issues no DDL at all.

            # Seed default capabilities for stations that don't have
            # them yet — preserves user-customised JSONB across boots.
            cursor.execute(
                """
                UPDATE station_stats
                SET capabilities = json_build_object(
                    'alt_milk', TRUE,
                    'high_volume', station_id = 1,
                    'vip_service', station_id = 3
                )
                WHERE capabilities IS NULL OR capabilities = '{}'::jsonb
            """
            )
            self.db.commit()
            logger.info("Updated station stats with capabilities information")

        except Exception as e:
            logger.error(f"Error initializing event scheduling: {str(e)}")
            # This except swallows the error so boot continues, which
            # means without an explicit rollback the connection is left
            # in an ABORTED transaction — every later query on it fails
            # with "current transaction is aborted" until something ends
            # it. Roll back so a non-fatal init failure stays non-fatal.
            self._end_read_transaction()

    def get_sponsor_info(self):
        """Get sponsor information for public display"""
        if not self.sponsor_info.get("enabled", False):
            return None

        return {
            "name": self.sponsor_info.get("name", ""),
            "message": self.sponsor_info.get("message", ""),
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
        station_pattern = r"(?:for\s+)?(?:station|st)[^0-9]*([0-9]+)"
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
        if metadata and "station_id" in metadata:
            station_id_from_metadata = metadata["station_id"]
            logger.info(f"Station ID {station_id_from_metadata} found in metadata")
            if not station_id:  # Only use metadata if not already detected in message
                station_id = station_id_from_metadata

        # Add station ID to conversation state if detected
        if station_id and state.get("temp_data"):
            if not state["temp_data"].get("order_details"):
                state["temp_data"]["order_details"] = {}
            # Add station ID in all possible formats for maximum compatibility
            state["temp_data"]["order_details"]["station_id"] = station_id
            state["temp_data"]["order_details"]["stationId"] = station_id
            state["temp_data"]["order_details"]["assigned_to_station"] = station_id
            state["temp_data"]["order_details"]["assignedStation"] = station_id
            state["temp_data"]["order_details"]["barista_station"] = station_id
            # Update state
            self._set_conversation_state(
                phone, state.get("state"), state.get("temp_data")
            )
            logger.info(
                f"Added station_id={station_id} to conversation state for {phone}"
            )

        # Check if this is a greeting or help command
        if self._is_greeting_or_help(message_body):
            return self._handle_greeting(phone, message_body, state)

        # BARISTA escape hatch: if the previous message was "BARISTA",
        # we're capturing the customer's question. Their THIS message
        # is the question — not a command. Handle this BEFORE
        # _handle_commands so "STATUS" / "MENU" etc don't intercept.
        if state.get("state") == "awaiting_barista_question":
            # Pop the state — the bare BARISTA prompt is one-shot.
            # We restore to whatever they were doing before (default
            # to 'completed' so the next message starts fresh).
            prev = (state.get("temp_data") or {}).get("previous_state")
            self._set_conversation_state(
                phone,
                prev or "completed",
                state.get("temp_data") or {},
            )
            return self._forward_question_to_baristas(phone, message_body, state)

        # Check for special commands like STATUS, CANCEL, etc.
        command_response = self._handle_commands(phone, message_body, state)
        if command_response:
            return command_response

        # A barista just messaged this customer about their order (via the
        # barista "Message Customer" button) — this inbound is the customer's
        # REPLY. Forward it to the barista Messages inbox instead of parsing
        # it as a new order. (Found live: a barista asked "did you want
        # sugar", the customer's "No sugar" fell into the order bot, which
        # replied "What's your first name?" — and the barista never saw the
        # answer.) Commands above still work, so CANCEL etc. behave normally.
        if state.get("state") == "awaiting_barista_reply":
            return self._handle_barista_reply(phone, message_body, state)

        # Multi-drink in a single text ("1 oat latte and 1 flat white"): only
        # consider it when we're at the START of an order, so we never
        # mis-split a single answer to a mid-order question. Returns None when
        # the message isn't really multi-drink, so we fall through normally.
        if state.get("state") in (
            None,
            "",
            "completed",
            "awaiting_name",
            "awaiting_coffee_type",
        ):
            multi_response = self._handle_multi_drink_order(phone, message_body, state)
            if multi_response:
                return multi_response

        # Process based on current conversation state
        if state.get("state") == "awaiting_name":
            return self._handle_awaiting_name(phone, message_body, state)
        elif state.get("state") == "awaiting_coffee_type":
            return self._handle_awaiting_coffee_type(phone, message_body, state)
        elif state.get("state") == "awaiting_milk":
            return self._handle_awaiting_milk(phone, message_body, state)
        elif state.get("state") == "awaiting_size":
            return self._handle_awaiting_size(phone, message_body, state)
        elif state.get("state") == "awaiting_sugar":
            return self._handle_awaiting_sugar(phone, message_body, state)
        elif state.get("state") == "awaiting_confirmation":
            return self._handle_awaiting_confirmation(phone, message_body, state)
        # Group/friend ordering states
        elif state.get("state") == "awaiting_friend_name":
            return self._handle_awaiting_friend_name(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_suggestion_response":
            return self._handle_awaiting_friend_suggestion_response(
                phone, message_body, state
            )
        elif state.get("state") == "awaiting_friend_coffee_type":
            return self._handle_awaiting_friend_coffee_type(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_milk":
            return self._handle_awaiting_friend_milk(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_size":
            return self._handle_awaiting_friend_size(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_sugar":
            return self._handle_awaiting_friend_sugar(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_confirmation":
            return self._handle_awaiting_friend_confirmation(phone, message_body, state)
        elif state.get("state") == "awaiting_friend_decision":
            return self._handle_awaiting_friend_decision(phone, message_body, state)
        elif state.get("state") == "awaiting_deletion_confirmation":
            return self._handle_awaiting_deletion_confirmation(
                phone, message_body, state
            )
        elif state.get("state") == "completed":
            # Courtesy replies after the ready/pickup SMS ("coming now,
            # thanks!") should be absorbed silently, not answered with the
            # new-customer interview (noise, and a paid outbound SMS for
            # nothing). Empty return → empty TwiML → no reply, no cost.
            if self._is_courtesy_reply(message_body):
                return ""
            # This is a new order after completing the previous one
            return self._restart_conversation(phone, message_body)

        # If no state or unknown state, start from beginning
        return self._restart_conversation(phone, message_body)

    @staticmethod
    def _is_courtesy_reply(message):
        """A short thanks/acknowledgement, not an order or command. Only
        consulted in the 'completed' state, so absorbing these can never
        eat a real order mid-conversation."""
        m = (message or "").lower().strip().rstrip("!. ")
        if len(m) > 30:
            return False
        courtesy = (
            "thanks",
            "thank you",
            "thankyou",
            "ty",
            "thx",
            "cheers",
            "coming",
            "on my way",
            "omw",
            "coming now",
            "got it",
            "ok",
            "okay",
            "great",
            "awesome",
            "perfect",
            "all good",
            "no worries",
            "sweet",
            "legend",
            "see you soon",
        )
        return (
            any(
                m == c or m.startswith(c + " ") or m.endswith(" " + c) for c in courtesy
            )
            or ("thank" in m and len(m) <= 30)
            or ("coming" in m and len(m) <= 30)
        )

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
        help_commands = ["help", "info", "how", "instructions", "?"]
        return any(
            cmd == message_lower or message_lower.startswith(cmd + " ")
            for cmd in help_commands
        )

    def _sms_first_message_hint(self):
        """One-line footer on the welcome so new customers know the commands
        available — see the menu, order for friends, or cancel."""
        return (
            "\n\n(Tips: reply MENU to see the menu / FRIEND to add a "
            "friend's coffee / OOPS to scrap an order)"
        )

    def _handle_greeting(self, phone, message, state):
        """Handle greeting messages or help requests"""
        # Get customer info
        customer = self.get_customer(phone)

        if customer and customer.get("name"):
            # Welcome back returning customer
            name = customer.get("name")

            # EA registration match, first contact ever: "Welcome back"
            # would be wrong (they've never texted us) and they can have
            # no usual yet — greet by name off the registration list.
            # Plain ASCII only (SMS segment cost).
            if customer.get("ea_matched"):
                self._set_conversation_state(
                    phone, "awaiting_coffee_type", {"name": name}
                )
                return (
                    f"Hi {name}! You're registered for {self.event_name} - "
                    "what coffee would you like?"
                )

            usual_suggestions = self._get_usual_order_suggestion(phone, name)
            if usual_suggestions:
                # Start a new conversation state with suggestion context
                self._set_conversation_state(
                    phone,
                    "awaiting_coffee_type",
                    {
                        "name": name,
                        "suggestion_context": "usual_order",  # Mark that we've suggested their usual order
                    },
                )
                return f"Welcome back, {name}! {usual_suggestions}"
            else:
                # Start a new conversation state without suggestion context
                self._set_conversation_state(
                    phone, "awaiting_coffee_type", {"name": name}
                )
                return (
                    f"Welcome back, {name}! What type of coffee would you like today?"
                )
        else:
            # New customer. They may have crammed name + order into the
            # greeting ("Hi I'm Sarah, large flat white") — if there's a drink,
            # pull both out and skip ahead so they don't start over. Only act
            # on a drink signal; a chatty bare greeting still just asks the name
            # (avoids guessing "How" out of "hi how are you").
            extracted_name, parsed_order = self._extract_name_and_order(message)
            if parsed_order.get("type"):
                if extracted_name:
                    return self._next_order_step(
                        phone,
                        extracted_name,
                        parsed_order,
                        prefix=f"Thanks {extracted_name}! ",
                    )
                self._set_conversation_state(
                    phone, "awaiting_name", {"order_details": parsed_order}
                )
                return "Got it! And what's your first name?"

            # New customer - ask for name
            self._set_conversation_state(phone, "awaiting_name")

            # Get welcome message from settings or use default if not available
            welcome_message = self._get_setting(
                "sms_welcome_message",
                "Welcome to {event_name}! What's your first name?",
            )
            # Replace event_name placeholder with actual event name
            return (
                welcome_message.replace("{event_name}", self.event_name)
                + self._sms_first_message_hint()
            )

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
                "_all_available_milks_lowercased: read failed: %s",
                e,
            )
            try:
                self.db.rollback()
            except Exception:
                pass
            return None

        milks = set()
        for row in rows:
            caps = row[0] if not isinstance(row, dict) else row.get("capabilities")
            if not caps:
                continue
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    continue
            if not isinstance(caps, dict):
                continue
            for m in caps.get("milk_types") or caps.get("milks") or []:
                milks.add(str(m).strip().lower())
        return milks

    def _milk_is_makeable(self, milk_type):
        """True if at least one station can make this milk. Tolerant match so
        naming variants line up ('oat' ↔ 'oat milk'). Safe fallback: if no
        station defines milk capabilities, everything is allowed (don't block
        orders on a misconfig). 'no milk' / black is always allowed."""
        mt = (milk_type or "").strip().lower()
        if mt in ("", "no milk", "none", "black"):
            return True
        # Use only ACTIVE stations' milks — same source as the menu
        # (_get_available_milk_types). Previously this read EVERY station
        # incl. inactive, so a milk whose only station was offline still
        # passed validation and the order was accepted then routed to a
        # station that couldn't make it. Now an offline station's milks
        # drop out of validation too, matching the menu.
        makeable = self._active_station_capability_set("milk_types")
        if not makeable:  # None or empty → no restriction
            return True
        for cap in makeable:
            if mt == cap or mt in cap or cap in mt:
                return True
        return False

    def _station_can_make(self, station_id, milk_type=None, size=None):
        """True if THIS specific station can make the order's milk + size.
        Mirrors the milk/size half of order_capable() inside _assign_station.
        An unset/empty capability dimension means 'no restriction'. Fail-OPEN
        on a query error so a glitch never blocks an order. (Coffee-type isn't
        gated here — stations rarely restrict drink types, and the barista
        Start check is the backstop; milk is the case that strands orders.)"""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            row = cursor.fetchone()
            caps = row[0] if row else None
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    caps = {}
            if not isinstance(caps, dict):
                return True
            req_milk = (milk_type or "").lower().replace(" milk", "").strip()
            if req_milk and req_milk not in ("no milk", "none", "black", ""):
                mt = [
                    str(m).lower().replace(" milk", "")
                    for m in (caps.get("milk_types") or [])
                ]
                if mt and req_milk not in mt:
                    return False
            req_size = (size or "").lower().strip()
            sz = [str(z).lower() for z in (caps.get("sizes") or [])]
            if req_size and sz and req_size not in sz:
                return False
            return True
        except Exception as e:
            logger.warning(f"_station_can_make({station_id}) failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return True

    def _has_active_station(self):
        """True if at least one station is currently active. Used to tell apart
        'no stations at all' from 'stations exist but none can make this milk'
        so the customer gets the right message."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cur = self.db.cursor()
            cur.execute("SELECT COUNT(*) FROM station_stats WHERE status = 'active'")
            row = cur.fetchone()
            return bool(row and row[0])
        except Exception as e:
            logger.warning(f"_has_active_station failed: {e}")
            return False

    def _no_capable_milk_message(self, phone, name, order_details):
        """No active station can make this order's milk. Instead of silently
        confirming it onto a station that can't make it (the bug behind 'why
        didn't the SMS tell me?'), ask the customer for a milk we CAN make and
        park the conversation at awaiting_milk so their next reply continues the
        SAME order. Never substitutes a milk on their behalf."""
        milk = order_details.get("milk")
        makeable = self._get_available_milk_types() or []
        od = {
            k: v
            for k, v in (order_details or {}).items()
            if k not in ("milk", "station_id", "stationId")
        }
        try:
            self._set_conversation_state(
                phone, "awaiting_milk", {"name": name, "order_details": od}
            )
        except Exception as e:
            logger.warning(f"could not park awaiting_milk state (non-fatal): {e}")
        opts = ", ".join(makeable) if makeable else "full cream, skim"
        who = f"{name}, " if name else ""
        if milk:
            return (
                f"Sorry {who}none of our stations can make {milk} right now. "
                f"What milk would you like instead? ({opts}, or 'no milk')"
            )
        return (
            f"Sorry {who}we can't make that one right now. "
            f"What milk would you like? ({opts}, or 'no milk')"
        )

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
                    (phone,),
                )
                row = cursor.fetchone()
                if row:
                    if isinstance(row, dict):
                        drink = row.get("preferred_drink")
                        milk = row.get("preferred_milk")
                        size = row.get("preferred_size")
                        sugar = row.get("preferred_sugar")
                        strength = row.get("preferred_strength")
                        decaf = bool(row.get("preferred_decaf"))
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
                    (phone,),
                )
                row = cursor.fetchone()
                if row:
                    if isinstance(row, dict):
                        drink = row.get("preferred_drink")
                        milk = row.get("preferred_milk")
                        size = row.get("preferred_size")
                        sugar = row.get("preferred_sugar")
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
                        "whole milk": "full cream",
                        "whole": "full cream",
                        "regular": "full cream",
                        "standard": "full cream",
                        "dairy": "full cream",
                    }.get(milk_lc, milk_lc)
                    if (
                        milk_canon not in available_milks
                        and milk_lc not in available_milks
                    ):
                        logger.info(
                            "_get_usual_order_suggestion: preferred milk %r "
                            "is not stocked at any active station; suppressing "
                            "usual suggestion for %s",
                            milk,
                            phone,
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
            cursor.execute(
                """
                SELECT o.order_details
                FROM orders o
                WHERE o.phone = %s
                ORDER BY o.created_at DESC
                LIMIT 5
            """,
                (phone,),
            )

            recent_orders = cursor.fetchall()
            if recent_orders:
                # Process recent orders
                order_types = []
                for order_data in recent_orders:
                    if order_data[0]:
                        try:
                            details = (
                                json.loads(order_data[0])
                                if isinstance(order_data[0], str)
                                else order_data[0]
                            )
                            if "type" in details:
                                order_types.append(details["type"])
                        except (json.JSONDecodeError, TypeError):
                            continue

                # Count occurrences
                if order_types:
                    # Get top 2 most common
                    counter = {}
                    for ot in order_types:
                        counter[ot] = counter.get(ot, 0) + 1

                    most_common = sorted(
                        counter.items(), key=lambda x: x[1], reverse=True
                    )[:2]

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
        if message_upper == "STATUS":
            return self._handle_status_command(phone)

        # Check for cancel command (both versions, regular and the special one to avoid Twilio collision)
        # "I got it wrong" is a different need from "forget it". Before
        # this, EDIT and CHANGE matched nothing and fell through to the
        # welcome message -- so a customer trying to fix their order was
        # asked for their first name by a system that had just greeted
        # them by it.
        elif message_upper in ("CHANGE", "EDIT", "CHANGE ORDER", "AMEND"):
            return self._handle_change_command(phone)

        elif message_upper in (
            "OOPS", "SCRAP", "NEVERMIND", "NEVER MIND",
            "CANCELORDER", "CANCEL ORDER",
            # CANCEL is a carrier-reserved OPT-OUT keyword: the
            # network answers it with "you have been unsubscribed"
            # and it never reaches us. Kept here only for the case
            # where a carrier does pass it through -- it must never
            # be the word we tell a customer to send.
            "CANCEL",
        ):
            return self._handle_cancel_command(phone)

        # Check for help/info command (avoiding HELP due to Twilio opt-out)
        elif message_upper == "INFO" or message_upper == "?":
            return self._handle_help_command()

        # Check for options/menu command
        elif (
            message_upper == "OPTIONS"
            or message_upper == "MENU"
            or message_upper == "COMMANDS"
        ):
            return self._handle_options_menu_command()

        # Check for USUAL command to order the usual
        elif message_upper == "USUAL":
            # Get customer name
            customer = self.get_customer(phone)
            name = customer.get("name", "") if customer else ""
            return self._process_usual_order(phone, name)

        # Check for FRIEND command to add a friend order
        elif message_upper == "FRIEND":
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
        elif message_upper == "FORGETME":
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
        elif (
            message_upper == "BARISTA"
            or message_upper == "STAFF"
            or message_upper == "HELPME"
        ):
            return self._handle_barista_command(
                phone, message, state, question_text=None
            )
        elif (
            message_upper.startswith("BARISTA ")
            or message_upper.startswith("STAFF ")
            or message_upper.startswith("HELPME ")
        ):
            # Extract everything after the keyword as the question.
            for kw in ("BARISTA ", "STAFF ", "HELPME "):
                if message_upper.startswith(kw):
                    question_text = message[len(kw) :].strip()
                    break
            return self._handle_barista_command(
                phone, message, state, question_text=question_text
            )

        # Check for VIP code
        elif self._is_vip_code(message_upper):
            return self._handle_vip_code(phone, message_upper)

        # Privacy commands
        elif message_upper == "MYDATA":
            return self._handle_mydata_command(phone)

        elif message_upper.startswith("CHANGENAME "):
            new_name = message[11:].strip()  # Get everything after "CHANGENAME "
            return self._handle_changename_command(phone, new_name)

        elif message_upper == "RESET":
            return self._handle_reset_command(phone)

        elif message_upper in ["DELETE", "FORGET ME", "STOP"]:
            return self._handle_delete_command(phone, state)

        # ETA scheduling ("im 15 mins away", "my eta is 20min") — the
        # client's arrival flow: after the morning comms blast, guests
        # text their ETA and we schedule their saved usual so it lands in
        # the barista queue a few minutes before they walk up.
        eta_minutes = self._parse_eta_minutes(message)
        if eta_minutes is not None:
            customer = self.get_customer(phone)
            eta_name = (customer.get("name") or "") if customer else ""
            return self._handle_eta(phone, eta_name, eta_minutes)

        # No special command detected
        return None

    @staticmethod
    def _parse_eta_minutes(message):
        """'im 15 mins away' / 'my eta is 20min' / 'eta 10' → minutes.

        A bare '15 min' with no arrival-ish context word is IGNORED so a
        normal order text can never be misread as an ETA. Returns None
        when the message isn't an ETA."""
        low = (message or "").lower()
        m = re.search(r"\beta\s*(?:is\s*)?[:\-]?\s*(\d{1,3})\b", low)
        if not m:
            m = re.search(r"\b(\d{1,3})\s*min(?:ute)?s?\b", low)
            if m and not re.search(
                r"\b(away|there|arriv\w*|off|out|leav\w*|driv\w*|walk\w*|from)\b", low
            ):
                m = None
        if not m:
            return None
        n = int(m.group(1))
        return n if 0 < n <= 180 else None

    # Scheduled orders drop into the barista queue this many minutes
    # before the customer's stated arrival, so the coffee is fresh when
    # they walk up rather than made the moment they text.
    ETA_PREP_LEAD_MIN = 5

    def _get_preferred_order(self, phone):
        """The customer's saved usual as an order_details dict, or None."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT name, preferred_drink, preferred_milk, preferred_size, "
                "preferred_sugar FROM customer_preferences WHERE phone = %s",
                (phone,),
            )
            row = cursor.fetchone()
            if not row:
                return None
            if isinstance(row, dict):
                name, drink, milk, size, sugar = (
                    row.get("name"),
                    row.get("preferred_drink"),
                    row.get("preferred_milk"),
                    row.get("preferred_size"),
                    row.get("preferred_sugar"),
                )
            else:
                name, drink, milk, size, sugar = row
            if not drink:
                return None
            return {
                "name": name,
                "type": drink,
                "milk": milk or self._default_milk(),
                "size": size or "medium",
                "sugar": sugar or "no sugar",
            }
        except Exception as e:
            logger.warning(f"_get_preferred_order failed: {e}")
            return None

    def _handle_eta(self, phone, name, minutes):
        """Schedule the customer's usual for their stated arrival time."""
        prefs = self._get_preferred_order(phone)
        if not prefs:
            return (
                f"Got it — about {minutes} min away! Text us your order now "
                f"(e.g. 'medium latte with full cream') and we'll get it "
                f"underway so it's ready when you arrive."
            )
        display_name = name or prefs.get("name") or "there"
        return self._create_scheduled_order(phone, display_name, prefs, minutes)

    def _create_scheduled_order(self, phone, name, order_details, minutes):
        """Insert an order with status='scheduled' that
        promote_due_scheduled_orders() flips to pending ETA_PREP_LEAD_MIN
        minutes before arrival. No stock moves until it's made."""
        # Same gate as _confirm_order — a scheduled order is still a new
        # order arriving, it just arrives with a delay.
        from utils.order_intake import intake_blocked_reason

        _blocked = intake_blocked_reason(self.db)
        if _blocked:
            logger.info(
                "Scheduled SMS order from %s refused: intake gate is closed", phone
            )
            return _blocked

        try:
            now = datetime.now()
            arrival = now + timedelta(minutes=minutes)
            fire_at = now + timedelta(minutes=max(0, minutes - self.ETA_PREP_LEAD_MIN))
            od = dict(order_details or {})
            try:
                station_id, _delayed = self._assign_station(
                    bool(od.get("vip")), od.get("milk"), od.get("type"), od.get("size")
                )
            except Exception:
                station_id = 1
            # Customer-facing summary must not include the arrival note below:
            # the reply already states the ready time, so build it first.
            summary = self.nlp.format_order_summary(od)
            od.update(
                {
                    "name": name,
                    "order_type": "sms",
                    "scheduled": True,
                    "fire_at": fire_at.isoformat(),
                    "arrival_at": arrival.isoformat(),
                    "notes": (
                        (od.get("notes") or "")
                        + f" (arriving ~{arrival.strftime('%H:%M')})"
                    ).strip(),
                }
            )
            cursor = self.db.cursor()
            order_number = None
            try:
                cursor.execute("SELECT nextval('order_number_seq')")
                srow = cursor.fetchone()
                if srow:
                    sval = (
                        srow[0]
                        if not isinstance(srow, dict)
                        else list(srow.values())[0]
                    )
                    order_number = str(int(sval))
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass
            if not order_number:
                order_number = f"S{now.strftime('%H%M%S')}"
            cursor = self.db.cursor()
            stamp_provenance(od, "sms")
            cursor.execute(
                "INSERT INTO orders (order_number, phone, order_details, status, "
                "station_id, created_at, updated_at, queue_priority) "
                "VALUES (%s, %s, %s, 'scheduled', %s, %s, %s, 5)",
                (order_number, phone, json.dumps(od), station_id, now, now),
            )
            self.db.commit()
            self._set_conversation_state(phone, "completed")
            return (
                f"Great {name}! Your {summary} is scheduled — we'll start "
                f"making it just before you arrive, ready about "
                f"{arrival.strftime('%H:%M')}. Order #{order_number}. "
                f"Reply CHANGE to fix it or OOPS to cancel."
            )
        except Exception as e:
            logger.error(f"_create_scheduled_order failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return (
                "Sorry, we couldn't schedule that just now - text your "
                "order when you arrive and we'll make it straight away."
            )

    def promote_due_scheduled_orders(self):
        """Flip due scheduled orders to pending. Called lazily from the
        order-listing endpoints (the barista UI polls every 15-30s), so no
        cron is needed and promotion latency is bounded by the poll."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT id, order_details FROM orders WHERE status = 'scheduled'"
            )
            rows = cursor.fetchall() or []
            now_iso = datetime.now().isoformat()
            due = []
            for r in rows:
                oid = r[0] if not isinstance(r, dict) else r.get("id")
                raw = r[1] if not isinstance(r, dict) else r.get("order_details")
                try:
                    d = json.loads(raw) if isinstance(raw, str) else (raw or {})
                except Exception:
                    d = {}
                if str(d.get("fire_at") or "") <= now_iso:
                    due.append(oid)
            if due:
                cursor.execute(
                    "UPDATE orders SET status = 'pending', updated_at = NOW() "
                    "WHERE id = ANY(%s)",
                    (due,),
                )
                self.db.commit()
                logger.info(f"promoted {len(due)} scheduled order(s) to pending")
            return len(due)
        except Exception as e:
            logger.warning(f"promote_due_scheduled_orders: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return 0

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
            (
                order_id,
                order_number,
                status,
                created_at,
                station_id,
                order_details_json,
            ) = result

            # Parse order details
            if isinstance(order_details_json, str):
                order_details = json.loads(order_details_json)
            else:
                order_details = order_details_json or {}

            # Get customer name
            name = order_details.get("name", "Customer")

            # Format coffee order summary
            order_summary = self.nlp.format_order_summary(order_details)

            # Calculate wait time
            current_time = datetime.now()
            wait_time_minutes = int((current_time - created_at).total_seconds() / 60)

            # Check for any friend/group orders linked to this order.
            # Primary link is the shared group_id stamped on every order in a
            # group (FRIEND orders + multi-drink). We match on the customer's
            # own recent orders and filter by group_id in Python so this works
            # whether order_details is stored as JSONB or text. The legacy
            # related_to_order_id/reference_number query is kept as a fallback.
            this_group_id = order_details.get("group_id")
            friend_orders = []
            seen_numbers = {order_number}
            try:
                if this_group_id:
                    cursor.execute(
                        """
                        SELECT order_number, order_details
                        FROM orders
                        WHERE phone = %s
                        ORDER BY created_at ASC
                    """,
                        (phone,),
                    )
                    for friend_result in cursor.fetchall():
                        fnum, fdetails_json = friend_result
                        fdetails = (
                            json.loads(fdetails_json)
                            if isinstance(fdetails_json, str)
                            else (fdetails_json or {})
                        )
                        if (
                            fnum in seen_numbers
                            or fdetails.get("group_id") != this_group_id
                        ):
                            continue
                        seen_numbers.add(fnum)
                        friend_orders.append(
                            f"#{fnum} for {fdetails.get('name', 'Friend')}: {self.nlp.format_order_summary(fdetails)}"
                        )
                # No group_id → no linked orders. The old "fallback" here
                # queried related_to_order_id/reference_number — columns that
                # have NEVER existed in the schema — so it errored on every
                # non-group STATUS, poisoned the transaction, and the next
                # query crashed the whole handler into "Sorry, we couldn't
                # retrieve your order status" (Test Bench: STATUS with an
                # active order). group_id is the only linkage.
            except Exception as friend_err:
                logger.error(f"Error getting friend orders: {str(friend_err)}")
                # Continue without friend orders — but FIRST un-poison the
                # transaction, or every later query in this handler dies
                # with InFailedSqlTransaction.
                try:
                    self.db.rollback()
                except Exception:
                    pass

            # Say WHERE, not which number. The venue runs two stations
            # fifteen metres apart in different rooms, so "at Station 2"
            # is a fact the customer cannot act on. station_label adds the
            # location when one is configured and falls back to the old
            # wording when it is not.
            _where = station_label(self.db, station_id) or f"Station {station_id}"

            # Build the status response
            status_messages = {
                "pending": f"Your order #{order_number} ({order_summary}) is pending at {_where}. You've been waiting {wait_time_minutes} minutes.",
                "in-progress": f"Your order #{order_number} ({order_summary}) is being made at {_where}. You've been waiting {wait_time_minutes} minutes.",
                "completed": f"Your order #{order_number} ({order_summary}) is ready for pickup at {_where}!",
            }

            response = status_messages.get(
                status,
                f"Your order #{order_number} ({order_summary}) is {status} at {_where}.",
            )

            # Add estimated time for pending orders
            if status == "pending":
                # Get station estimated wait time
                cursor.execute(
                    "SELECT wait_time FROM station_stats WHERE station_id = %s",
                    (station_id,),
                )
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
            if self._get_setting("enable_web_tracking", "false").lower() in (
                "true",
                "yes",
                "1",
            ):
                base_url = self._get_setting(
                    "web_tracking_url", "https://coffee.example.com/track/"
                )
                tracking_url = f"{base_url}?id={order_number}"
                response += f"\n\nTrack your order here: {tracking_url}"

            return response

        except Exception as e:
            logger.error(f"Error processing STATUS command: {str(e)}")
            return (
                "Sorry, we couldn't retrieve your order status. Please try again later."
            )

    def _handle_change_command(self, phone):
        """CHANGE / EDIT -- swap a pending order for a different one.

        There is no way to edit an order in place: the barista board, the
        label and the queue position are all derived from the row, so the
        honest implementation is cancel-and-replace. The customer should
        not have to know that, though -- they say CHANGE, we do the two
        steps, and we ask what they want instead.

        Delegates the actual cancellation so the station load and stock
        bookkeeping stay in one place; a second copy of that would drift
        the same way the menu lookups did.
        """
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT order_number FROM orders
                WHERE phone = %s AND status = 'pending'
                ORDER BY created_at DESC LIMIT 1
                """,
                (phone,),
            )
            pending = cursor.fetchone()
        except Exception as e:
            logger.warning(f"_handle_change_command lookup failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            pending = None

        # Nothing pending: the cancel handler already says the RIGHT thing
        # for an order that is being made, is ready on the shelf, or does
        # not exist. Reuse those rather than inventing a fourth answer.
        if not pending:
            return self._handle_cancel_command(phone)

        order_number = pending[0] if not isinstance(pending, dict) else \
            list(pending.values())[0]
        result = self._handle_cancel_command(phone)
        if "cancelled" not in str(result).lower():
            # Cancellation did not take -- do NOT tell them to order again,
            # or they end up with two coffees.
            return result

        # Clear the conversation so their next message is read as a fresh
        # order. They are a known customer by now, so they get greeted by
        # name rather than asked who they are.
        try:
            if isinstance(self.conversation_states, dict):
                self.conversation_states.pop(phone, None)
        except Exception:
            pass

        return (
            f"No problem - order #{order_number} is cancelled. "
            f"What would you like instead?"
        )

    def _handle_cancel_command(self, phone):
        """Handle CANCEL command - cancel the most recent order"""
        try:
            # Get most recent pending order
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT id, order_number, station_id
                FROM orders 
                WHERE phone = %s AND status = 'pending' 
                ORDER BY created_at DESC 
                LIMIT 1
            """,
                (phone,),
            )

            result = cursor.fetchone()

            if not result:
                # Be honest with a customer whose order is mid-make: "you
                # don't have any pending orders" reads as "we lost your
                # order" when their coffee is being made right now (Test
                # Bench cancel-while-making journey).
                cursor.execute(
                    """
                    SELECT order_number, station_id FROM orders
                    WHERE phone = %s AND status = 'in-progress'
                    ORDER BY created_at DESC LIMIT 1
                """,
                    (phone,),
                )
                making = cursor.fetchone()
                if making:
                    m_num, m_station = making
                    return (
                        f"Your order #{m_num} is already being made at "
                        f"{station_label(self.db, m_station)} - too late to cancel by text. "
                        f"Please see the barista if you need to change it."
                    )
                # Same honesty for a READY order: "you don't have any orders"
                # to someone whose coffee is on the shelf reads as "we lost
                # it" (Test Bench cancel-after-ready journey).
                cursor.execute(
                    """
                    SELECT order_number, station_id FROM orders
                    WHERE phone = %s AND status = 'completed'
                      AND picked_up_at IS NULL
                    ORDER BY completed_at DESC LIMIT 1
                """,
                    (phone,),
                )
                ready = cursor.fetchone()
                if ready:
                    r_num, r_station = ready
                    return (
                        f"Good news - your order #{r_num} is already made and "
                        f"waiting for you at {station_label(self.db, r_station)}! No need to "
                        f"cancel, just come and grab it."
                    )
                return "You don't have any pending orders to cancel."

            order_id, order_number, station_id = result

            # Update order status to cancelled
            cursor.execute(
                """
                UPDATE orders 
                SET status = 'cancelled', updated_at = %s 
                WHERE id = %s
            """,
                (datetime.now(), order_id),
            )

            # Update station load
            cursor.execute(
                """
                UPDATE station_stats
                SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                WHERE station_id = %s
            """,
                (datetime.now(), station_id),
            )

            self.db.commit()

            # Reset conversation state
            self._set_conversation_state(phone, "completed")

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
                phone,
                "awaiting_barista_question",
                {**(state.get("temp_data") or {})},
            )
            return (
                "Sure - type your question and I'll send it straight to the "
                "team. They'll text back within a minute."
            )

        return self._forward_question_to_baristas(phone, question_text, state)

    def _handle_barista_reply(self, phone, message, state):
        """The customer is replying to a barista's "Message Customer" SMS.
        Forward the reply into the barista Messages inbox, tagged with the
        order + station, and confirm to the customer — do NOT parse it as a
        new order (that produced the surreal "What's your first name?" after
        a barista asked "did you want sugar"). Replies older than 60 min are
        treated as a fresh conversation instead."""
        td = state.get("temp_data") or {}
        order_no = td.get("order_number")
        station = td.get("station_id")
        sent_at = td.get("sent_at")
        try:
            if sent_at:
                age = (datetime.now() - datetime.fromisoformat(sent_at)).total_seconds()
                if age > 3600:
                    self._set_conversation_state(phone, "completed")
                    return self._restart_conversation(phone, message)
        except Exception:
            pass
        tag = (
            f"[Re order #{order_no}"
            + (f" @ Station {station}" if station else "")
            + "] "
        )
        self._set_conversation_state(phone, "completed")
        return self._forward_question_to_baristas(
            phone, tag + (message or "").strip(), state
        )

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
        customer_name = ""
        try:
            customer = self.get_customer(phone)
            if customer:
                customer_name = customer.get("name", "") or ""
        except Exception:
            pass
        if not customer_name:
            customer_name = (
                (state.get("temp_data") or {}).get("name", "")
                if isinstance(state, dict)
                else ""
            )

        question_text = (question_text or "").strip()
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
                "Sorry, our system hiccuped sending your question - "
                "try again in a moment, or ask at the counter."
            )

        # Push a WebSocket event so any open Barista UI lights up the
        # badge without waiting for its 15s poll cycle.
        try:
            from flask import current_app as _ca

            socketio = _ca.config.get("socketio") if _ca else None
            if socketio:
                payload = {
                    "id": question_id,
                    "phone": phone,
                    "customer_name": customer_name,
                    "customerName": customer_name,
                    "question": question_text,
                    "created_at": created_at.isoformat() + "Z"
                    if hasattr(created_at, "isoformat")
                    else str(created_at),
                    "createdAt": created_at.isoformat() + "Z"
                    if hasattr(created_at, "isoformat")
                    else str(created_at),
                    "status": "pending",
                }
                # Broadcast to all stations — first to answer wins.
                socketio.emit("customer_question", payload, room="orders")
        except Exception as ws_err:
            logger.debug(f"customer_question WS emit skipped: {ws_err}")

        # Acknowledge to the customer. Keep their conversation state as
        # whatever it was BEFORE the BARISTA detour, so their next
        # message picks up where they left off (e.g. they were
        # mid-order). The barista's reply lands as a separate SMS, no
        # state churn needed.
        return (
            "Sent your question to the team. They'll text back within "
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
                pref_count,
                order_count,
                phone,
            )

            return (
                "Forgotten! Your saved name, preferences, and "
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
                "Sorry - couldn't fully reset your record right now. "
                "Try again in a moment."
            )

    def _handle_help_command(self):
        """Handle INFO command - provide instructions (avoiding HELP as Twilio uses it for opt-out)"""
        return (
            "Coffee Ordering Instructions:\n"
            "- Text your coffee order (e.g., 'large latte with oat milk')\n"
            "- STATUS: Check your order status\n"
            "- FRIEND: Add a coffee for a friend\n"
            "- CHANGE: Swap your order for a different one\n"
            "- OOPS: Cancel your pending order\n"
            "- MENU: See available coffee options\n"
            "- USUAL: Order your usual coffee\n"
            "- OPTIONS: See all available commands\n"
            "Need more help? Visit the help desk or any coffee station."
        )

    def _handle_options_command(self):
        """Handle OPTIONS command - list all available commands"""
        return (
            "Available Commands:\n"
            "Ordering:\n"
            "- STATUS: Check order status\n"
            "- FRIEND: Add coffee for a friend\n"
            "- CHANGE: Swap your order\n"
            "- OOPS: Cancel pending order\n"
            "- MENU: See coffee options\n"
            "- USUAL: Order your usual\n"
            "\nPrivacy:\n"
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
            sizes = self._get_available_sizes("latte") or ["small", "medium", "large"]

            # Non-coffee drinks the operator has stocked for this event
            # (the Quick Setup wizard adds these to the 'drinks' category).
            extra_drinks = []
            try:
                # Reset any aborted-transaction state before this read.
                self.db.rollback()
            except Exception:
                pass
            try:
                # Use the SAME source the ORDER path uses. This used to be a
                # fourth inline copy of the inventory_items query, so the menu
                # advertised teas that ordering then refused -- the operator
                # had switched every drink off and only the order path knew.
                extra_drinks = self._get_available_extra_drinks() or []
            except Exception as e:
                logger.warning(f"Couldn't read extra drinks: {e}")

            # Which milks are only available at one station? Customers
            # ordering one of those should know they'll be routed.
            milk_station_map = (
                self._milk_to_stations_map()
                if not self._is_unlimited_stock_mode()
                else {}
            )
            single_station_milks = [
                m for m, ids in milk_station_map.items() if len(ids) == 1
            ]

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

            POPULAR_COFFEE = [
                "latte",
                "flat white",
                "cappuccino",
                "espresso",
                "long black",
            ]
            extra_drinks_lower = {(d or "").lower() for d in extra_drinks}
            available_coffees_lower = {(c or "").lower() for c in available_coffees}

            # Filter out anything that's actually a tea or "other drink"
            # to avoid duplication. e.g. "chai latte" lives under "Other".
            coffee_only = [
                c
                for c in available_coffees
                if (c or "").lower() not in extra_drinks_lower
                and "tea" not in (c or "").lower()
            ]
            # Pick popular ones first, then add any others the operator
            # has configured but cap at ~6 for readability.
            shown = [c for c in POPULAR_COFFEE if c in available_coffees_lower]
            remaining = [
                c for c in coffee_only if c.lower() not in {s.lower() for s in shown}
            ]
            extra_count = max(0, len(remaining))
            # Take up to 1 extra "interesting" drink (e.g. mocha) so the
            # operator's customisation isn't completely hidden.
            shown += remaining[:1]
            coffee_line_tail = ""
            if extra_count > 1:
                coffee_line_tail = f" (+{extra_count - 1} more — just text the name)"

            # Build the message
            lines = ["Menu:"]
            if shown:
                lines.append(f"Coffee: {', '.join(shown)}{coffee_line_tail}")
            elif available_coffees:
                lines.append(f"Coffee: {', '.join(sorted(available_coffees)[:6])}")
            else:
                lines.append("Coffee: (none in stock - check back soon)")

            # Split out teas as their own line.
            teas = [d for d in extra_drinks if "tea" in d.lower()]
            other_drinks = [d for d in extra_drinks if "tea" not in d.lower()]
            if teas:
                # Drop the trailing " tea" since the line is already "Tea:"
                teas_short = [t.lower().replace(" tea", "").strip() or t for t in teas]
                lines.append(f"Tea: {', '.join(teas_short)}")
            if other_drinks:
                lines.append(f"Other: {', '.join(other_drinks)}")

            if available_milks:
                # Cap at 6 for visual cleanliness; if more configured,
                # hint that we accept others.
                milks_sorted = sorted(available_milks)
                milk_tail = ""
                if len(milks_sorted) > 6:
                    milk_tail = f" (+{len(milks_sorted) - 6} more)"
                    milks_sorted = milks_sorted[:6]
                lines.append(f"Milk: {', '.join(milks_sorted)}{milk_tail}")
            else:
                lines.append("Milk: (none in stock)")

            if available_sweeteners:
                lines.append(f"🍯 {self._summarise_sweeteners(available_sweeteners)}")

            lines.append(f"Size: {', '.join(sizes)}")

            if single_station_milks:
                lines.append("")
                lines.append(
                    f"💡 {', '.join(single_station_milks)} only at certain stations — "
                    f"we'll route automatically."
                )

            lines.append("")
            # Build a context-aware example using a real available size+milk.
            example_size = sizes[0] if sizes else "medium"
            example_milk = next(
                (
                    m
                    for m in ["oat", "full cream", "skim", "almond", "lactose free"]
                    if m in available_milks
                ),
                "full cream",
            )
            # Don't teach people to order something the baristas will
            # not make. When sugar is help-yourself, the example must
            # not contain it, or the menu itself creates the request
            # we then have to strip back out.
            if self._sugar_self_serve():
                lines.append(self.SUGAR_SELF_SERVE_NOTE.strip())
                lines.append(
                    f"Reply with your order, e.g. '{example_size} {example_milk} latte'"
                )
            else:
                lines.append(
                    f"Reply with your order, e.g. '{example_size} {example_milk} latte 1 sugar'"
                )
            return "\n".join(lines)

        except Exception as e:
            logger.error(f"Error building dynamic menu: {str(e)}")
            # Static fallback — only used if the helpers themselves crash.
            return (
                "Coffee: Latte, Cappuccino, Flat White, Long Black, Espresso, Mocha\n"
                "Milk: Full Cream, Skim, Soy, Almond\n"
                "Size: Medium\n\n"
                "Reply with your choice (e.g., 'flat white with skim')"
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
            cursor.execute(
                """
                SELECT station_id, COALESCE(capabilities, '{}'::jsonb) AS caps
                FROM station_stats
                WHERE COALESCE(status, 'active') IN ('active', 'open')
            """
            )
            mapping = {}
            for row in cursor.fetchall():
                station_id = row[0] if not isinstance(row, dict) else row["station_id"]
                caps = row[1] if not isinstance(row, dict) else row["caps"]
                if isinstance(caps, str):
                    import json as _json

                    try:
                        caps = _json.loads(caps)
                    except (TypeError, ValueError):
                        caps = {}
                if not isinstance(caps, dict):
                    continue
                for milk in caps.get("milk_types", []) or []:
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
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'inventory_items'
                )
            """
            )

            has_inventory_table = cursor.fetchone()[0]

            if has_inventory_table:
                # Get available drink types based on ingredient availability
                coffee_types = self._get_available_coffee_types()

                # Use the accessor, not another private copy of the query.
                # This one still read inventory_items directly, so it would
                # have listed oat at an event where oat was switched off.
                milk_types = self._get_available_milk_types() or []
                sizes = self._get_available_sizes() or []

                # Use dynamic data if available
                if coffee_types and milk_types:
                    size_line = (
                        f"Size: {', '.join(sizes)}\n" if sizes else ""
                    )
                    return (
                        "Coffee Menu:\n"
                        f"Types: {', '.join(coffee_types)}\n"
                        f"Milk: {', '.join(milk_types)}\n"
                        f"{size_line}"
                        "Extras: Extra Shot, Decaf, Extra Hot\n"
                        "Simply text your order, e.g. 'cappuccino with soy milk'"
                    )
        except Exception as e:
            logger.error(f"Error fetching menu items: {str(e)}")

        # Fallback to static menu if database query fails
        return (
            "Coffee Menu:\n"
            "Types: Latte, Cappuccino, Flat White, Long Black, Espresso, Mocha\n"
            "Milk: Full Cream, Skim, Soy, Almond\n"
            "Extras: Extra Shot, Decaf, Extra Hot\n"
            "Simply text your order, e.g. 'cappuccino with soy milk'"
        )

    def _is_vip_code(self, code):
        """Check if this is a valid VIP code"""
        try:
            # First check for default VIP code
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            result = cursor.fetchone()

            if result and (code == result[0] or code == "VIP"):
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
                            if (
                                vip_code_entry.get("enabled", True)
                                and vip_code_entry.get("code")
                                and code.upper() == vip_code_entry["code"].upper()
                            ):
                                logger.info(f"Matched custom VIP code: {code}")
                                return True
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.error(f"Error parsing VIP codes: {str(e)}")

            return False

        except Exception as e:
            logger.error(f"Error checking VIP code: {str(e)}")
            return False

    def extract_vip_from_text(self, text):
        """Find a VIP code hidden in free text and take it out.

        Steve: "in the sms field its meant to detect the vipcode ie
        treenetvip in current example but there is no where to put in qr
        scan app but possibly in the notes filed could detect the keyword
        and put in vip catogory but not give it away to others that there
        is even such a hack".

        So the notes box on the kiosk doubles as the code box, with no
        label saying so. Returns (cleaned_text, matched) -- the code is
        REMOVED, because it must not reach the label, the barista card or
        the board where the next person in the queue can read it.

        Two deliberate differences from `_is_vip_code`, which matches a
        whole SMS:

        1. The generic literal "VIP" is NOT accepted here. It is a common
           English word; someone writing "vip table please" or "for the
           VIP room" would be silently promoted, and the word could be
           guessed by anyone in a second. Only codes the operator
           configured count.
        2. Matching is on WORD BOUNDARIES, so a code cannot fire from the
           middle of an unrelated word.

        Returns (text, False) unchanged on any error: failing to spot a
        code costs someone their queue jump, while a crash costs them
        their coffee.
        """
        import re

        raw = str(text or "")
        if not raw.strip():
            return raw, False
        try:
            codes = []
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            row = cursor.fetchone()
            if row and row[0] and str(row[0]).strip():
                codes.append(str(row[0]).strip())
            cursor.execute("SELECT value FROM settings WHERE key = 'vip_codes'")
            row = cursor.fetchone()
            if row and row[0]:
                try:
                    for entry in json.loads(row[0]) or []:
                        if (
                            isinstance(entry, dict)
                            and entry.get("enabled", True)
                            and str(entry.get("code") or "").strip()
                        ):
                            codes.append(str(entry["code"]).strip())
                except (json.JSONDecodeError, TypeError, KeyError) as e:
                    logger.error(f"Error parsing VIP codes: {e}")

            cleaned, matched = raw, False
            # Longest first, so a code that contains another is not left
            # half-stripped.
            for code in sorted(set(codes), key=len, reverse=True):
                pattern = re.compile(rf"\b{re.escape(code)}\b", re.IGNORECASE)
                if pattern.search(cleaned):
                    cleaned = pattern.sub("", cleaned)
                    matched = True
            if not matched:
                return raw, False
            # Tidy what the removal left behind: doubled spaces, and a
            # stray leading/trailing comma from "treenetvip, no lid".
            cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;.-").strip()
            logger.info("VIP code redeemed via notes (code not logged)")
            return cleaned, True
        except Exception as e:
            logger.error(f"extract_vip_from_text failed: {e}")
            return raw, False

    def _handle_vip_code(self, phone, code):
        """Handle VIP code entry.

        Marks the customer VIP for future orders AND — if they just placed an
        order that's still pending — bumps THAT order into the VIP lane too, so
        a code entered right after ordering prioritises the order they're
        already waiting on (not only their next one).
        """
        try:
            # Mark this customer as VIP in their preferences
            cursor = self.db.cursor()

            # Check if customer exists
            cursor.execute(
                "SELECT phone FROM customer_preferences WHERE phone = %s", (phone,)
            )
            result = cursor.fetchone()

            if result:
                # Update existing customer
                cursor.execute(
                    """
                    UPDATE customer_preferences
                    SET is_vip = TRUE
                    WHERE phone = %s
                """,
                    (phone,),
                )
            else:
                # Create new customer record
                cursor.execute(
                    """
                    INSERT INTO customer_preferences
                    (phone, is_vip, first_order_date, last_order_date)
                    VALUES (%s, TRUE, %s, %s)
                """,
                    (phone, datetime.now(), datetime.now()),
                )

            # Bump the customer's most-recent PENDING order to VIP priority.
            # (Only pending — once a barista has started it, re-prioritising
            # is pointless.) order_details is a JSON text column, so read /
            # modify / write it in Python.
            bumped_number = None
            try:
                cursor.execute(
                    """
                    SELECT id, order_number, order_details
                    FROM orders
                    WHERE phone = %s AND status = 'pending'
                    ORDER BY created_at DESC
                    LIMIT 1
                """,
                    (phone,),
                )
                row = cursor.fetchone()
                if row:
                    o_id, o_number, o_details = row[0], row[1], row[2]
                    details = o_details
                    if isinstance(details, str):
                        try:
                            details = json.loads(details)
                        except Exception:
                            details = {}
                    if not isinstance(details, dict):
                        details = {}
                    details["vip"] = True
                    cursor.execute(
                        "UPDATE orders SET queue_priority = 1, order_details = %s, updated_at = %s WHERE id = %s",
                        (json.dumps(details), datetime.now(), o_id),
                    )
                    bumped_number = o_number
            except Exception as be:
                logger.warning(f"VIP bump of current pending order failed: {be}")

            self.db.commit()

            # Get customer name for a friendly reply
            customer = self.get_customer(phone)
            name = customer.get("name", "")
            name_greeting = f", {name}" if name else ""

            if bumped_number:
                # They just ordered — prioritise that order; don't force them
                # into a brand-new order flow.
                self._set_conversation_state(phone, "completed")
                return (
                    f"VIP status activated{name_greeting}! Your order "
                    f"#{bumped_number} is now priority - we'll make it next. "
                    f"Text us anytime to order again."
                )

            # No pending order — VIP applies to their next order. Route through
            # the NAME step (not coffee-type) so a reply like "Vic flat white"
            # still captures the name; the VIP flag rides along via the saved
            # is_vip we just set (read back in _confirm_order).
            self._set_conversation_state(phone, "awaiting_name", {"vip": True})
            return f"VIP status activated{name_greeting}! Your orders will be prioritised. What's your name and order?"

        except Exception as e:
            logger.error(f"Error processing VIP code: {str(e)}")
            return "Sorry, we couldn't process your VIP code. Please try again or contact the help desk."

    def _extract_name_and_order(self, message):
        """Pull a customer NAME and any ORDER details out of a single opening
        message like "Hi I'm Sarah, large flat white oat 1 sugar" so we don't
        make people re-enter everything. Returns (name_or_None, order_dict).

        Name guess = the first leftover word after stripping greeting/filler
        phrases and every token that belongs to a recognised order field
        (drink/milk/size/sugar/strength/temperature + numbers)."""
        order = self.nlp.parse_order(message, apply_defaults=False) or {}
        raw = (message or "").strip()
        # Lowercase, keep apostrophes for "i'm"/"it's", drop other punctuation.
        low = " " + re.sub(r"[^a-z0-9'\s]", " ", raw.lower()) + " "
        filler_phrases = [
            "good morning",
            "good afternoon",
            "good evening",
            "good day",
            "my name is",
            "name's",
            "name is",
            "this is",
            "it's",
            "its",
            "can i please get",
            "can i get",
            "can i have",
            "could i please get",
            "could i get",
            "could i have",
            "i would like",
            "i'd like",
            "id like",
            "i'll have",
            "ill have",
            "i'll get",
            "i will have",
            "i am",
            "i'm",
            "im",
            "hi there",
            "hello there",
            "hey there",
            "g'day",
        ]
        for f in sorted(filler_phrases, key=len, reverse=True):
            low = low.replace(" " + f + " ", " ")
        single_fillers = {
            "hi",
            "hello",
            "hey",
            "hiya",
            "howdy",
            "yo",
            "morning",
            "afternoon",
            "evening",
            "cheers",
            "please",
            "thanks",
            "thank",
            "you",
            "for",
            "a",
            "an",
            "the",
            "and",
            "with",
            "of",
            "order",
            "coffee",
            "get",
            "have",
            "like",
            "want",
            "me",
            "my",
            "is",
            # Re-order / quantity / generic words that are NOT names. Without
            # these, "Last latte" (meaning "my last/usual latte") greeted the
            # customer as "Thanks Last!" — the first leftover word was taken as
            # the name. Skipping them makes the bot ask "what's your first name?"
            # instead of inventing a name. Bias is intentional: a real name that
            # matches one of these just gets re-asked (safe); guessing wrong is
            # the embarrassing failure.
            "last",
            "usual",
            "same",
            "again",
            "another",
            "regular",
            "normal",
            "standard",
            "previous",
            "just",
            "only",
            "some",
            "one",
            "two",
            "three",
            "quick",
            "fresh",
            "nice",
            "good",
            "great",
            "best",
            "lovely",
            "favourite",
            "favorite",
            "today",
            "now",
            "that",
            "this",
            "will",
        }
        order_tokens = set()
        for d in (
            getattr(self.nlp, "coffee_types", {}),
            getattr(self.nlp, "milks", {}),
            getattr(self.nlp, "sizes", {}),
            getattr(self.nlp, "sugars", {}),
            getattr(self.nlp, "strengths", {}),
            getattr(self.nlp, "temperatures", {}),
        ):
            try:
                for canon, variants in d.items():
                    for tok in [canon] + list(variants or []):
                        for w in str(tok).split():
                            order_tokens.add(w)
            except Exception:
                pass
        order_tokens.update(
            {
                "sugar",
                "sugars",
                "milk",
                "shot",
                "shots",
                "decaf",
                "sweet",
                "sweetener",
                "extra",
                "cup",
                "oz",
                "ounce",
                "ounces",
            }
        )
        name = None
        for w in low.split():
            if w in single_fillers or w in order_tokens or w.isdigit() or len(w) < 2:
                continue
            # skip tokens that are purely numeric-ish (e.g. "8oz")
            if re.match(r"^\d", w):
                continue
            name = w[:1].upper() + w[1:]
            break
        return name, order

    # Default reply when a pre-event pre-order is saved. Editable by the
    # organiser (settings KV 'pre_event_settings'.message); placeholders
    # {name} {order} {event} are substituted. Plain ASCII (SMS cost).
    PRE_EVENT_DEFAULT_MESSAGE = (
        "Thanks {name}! We've saved your {order} for {event}. "
        "On event day, text this number when you arrive and we'll get "
        "your order underway."
    )

    def _pre_event_settings(self):
        """Pre-event pre-order mode (client request via Steve): before the
        event opens, SMS orders are SAVED as the customer's preference
        instead of being made. Read fresh from the settings table (no
        cache) so the organiser's toggle applies to the next text."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT value FROM settings WHERE key = 'pre_event_settings'"
            )
            row = cursor.fetchone()
            raw = (
                row[0]
                if row and not isinstance(row, dict)
                else (row.get("value") if row else None)
            )
            if raw:
                data = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(data, dict):
                    return data
        except Exception as e:
            logger.debug(f"_pre_event_settings read failed: {e}")
        return {"enabled": False}

    def _pre_event_response(self, phone, name, order_details):
        """Save the completed order as this customer's preference (their
        'usual') and reply with the configured pre-event message. On event
        day — mode switched off — the welcome-back flow offers exactly
        what they saved ('Welcome back! Your usual medium latte...?')."""
        od = dict(order_details or {})
        od.setdefault("sugar", "no sugar")
        try:
            self._save_customer_preferences(phone, name, od)
        except Exception as e:
            logger.error(f"pre-event preference save failed: {e}")
            return (
                "Sorry, we couldn't save your pre-order just now - "
                "please try again in a minute."
            )
        self._set_conversation_state(phone, "completed")
        cfg = self._pre_event_settings()
        template = (cfg.get("message") or "").strip() or self.PRE_EVENT_DEFAULT_MESSAGE
        summary = self.nlp.format_order_summary(od)

        # Tolerant substitution: unknown/misspelled placeholders stay as
        # literal text instead of crashing the SMS — the organiser edits
        # this template live mid-campaign (date, opening time, spiel...).
        class _SafeDict(dict):
            def __missing__(self, key):
                return "{" + key + "}"

        sponsor = ""
        try:
            info = (
                self.get_sponsor_info() if hasattr(self, "get_sponsor_info") else None
            )
            if isinstance(info, dict) and info.get("name"):
                sponsor = info["name"]
        except Exception:
            pass
        try:
            return template.format_map(
                _SafeDict(
                    name=name, order=summary, event=self.event_name, sponsor=sponsor
                )
            )
        except Exception:
            return self.PRE_EVENT_DEFAULT_MESSAGE.format(
                name=name, order=summary, event=self.event_name
            )

    def _sugar_self_serve(self):
        """True when the venue runs help-yourself sugar (baristas never
        add it). SMS then strips requested sugar from the order and tells
        the customer where to find it; kiosk/walk-in skip the question."""
        try:
            if str(self._get_setting("sugar_self_serve", "false")).lower() == "true":
                return True
        except Exception:
            pass
        # Derived from the menu itself: if the operator switched every
        # sweetener off, they have already said the baristas don't add
        # sugar. Making them find a SECOND switch to express the same
        # intention is how the two halves drift apart again.
        try:
            return self._event_enabled("sweeteners") == []
        except Exception:
            return False

    # Plain ASCII (SMS segment cost rule).
    SUGAR_SELF_SERVE_NOTE = " Sugar is help-yourself at the counter."

    def _apply_self_serve_sugar(self, od):
        """Strip a requested sugar when self-serve mode is on. Returns
        True when the customer HAD asked for sugar (so replies can say
        where to get it)."""
        if not self._sugar_self_serve():
            return False
        asked = str(od.get("sugar") or "").strip().lower()
        if asked and asked not in ("no sugar", "none", "0"):
            od["sugar"] = "no sugar"
            return True
        return False

    def _place_order(self, phone, name, order_details, prefix=""):
        """Auto-place a completed order — no YES step. Customers kept thinking
        the order was done after telling us what they wanted; the YES was a
        stumble. Defaults sugar to 'no sugar' if never mentioned, creates the
        order, and tells them it's placed + how to fix it (CANCEL / FRIEND)."""
        od = dict(order_details or {})
        od.setdefault("sugar", "no sugar")
        sugar_redirect = self._apply_self_serve_sugar(od)
        # PRE-EVENT MODE: save instead of make. All the parsing, milk
        # defaults and validation above still ran, so what we save is a
        # complete, makeable order.
        if self._pre_event_settings().get("enabled"):
            # The pre-event template greets by name itself ("Thanks {name}!…"),
            # so the caller's "Thanks Sarah! " prefix produced a doubled
            # "Thanks Sarah! Thanks Sarah!" (bench catch, features_flow).
            # Keep the prefix only for custom templates with no self-greeting.
            _tpl = (
                self._pre_event_settings().get("message") or ""
            ).strip() or self.PRE_EVENT_DEFAULT_MESSAGE
            _pfx = "" if "{name}" in _tpl else prefix
            return f"{_pfx}{self._pre_event_response(phone, name, od)}"
        summary = self.nlp.format_order_summary(od)
        order_response = self._confirm_order(phone, od, name)
        if not isinstance(order_response, str):
            order_response = "Order placed!"
        # If the order couldn't be created (no stations available, etc.), pass
        # the error through without the "placed / reply CANCEL" framing and
        # leave the conversation where it is so they can retry.
        low = order_response.lower()
        if (
            low.startswith("sorry")
            or "couldn't" in low
            or "no coffee station" in low
            or "unavailable" in low
        ):
            return f"{prefix}{order_response}"
        self._set_conversation_state(phone, "completed")
        # _confirm_order's message gives the order # + queue position but NOT
        # the drink — include the recap so the customer can check what we
        # placed (incl. the defaulted "no sugar") and fix it.
        # Price tail (empty when pricing is off) — the one-shot flow is how
        # most SMS orders confirm, and it was the ONLY confirmation path
        # not showing the total when pricing was enabled (Test Bench
        # pricing round-trip).
        return (
            f"{prefix}{order_response}\n"
            f"That's: {summary}.{self.SUGAR_SELF_SERVE_NOTE if sugar_redirect else ''}"
            f"{self._format_price_tail(od)} "
            f"Wrong? CHANGE or OOPS. Add another with FRIEND."
        )

    def _default_milk(self):
        """The event's 'normal' milk for orders that don't specify one:
        full cream (or the local wording for standard dairy) when stocked,
        else the first available milk."""
        milks = [str(m).lower() for m in (self._get_available_milk_types() or [])]
        for want in ("full cream", "whole", "dairy", "regular", "standard"):
            for m in milks:
                if want in m:
                    return m
        return milks[0] if milks else "full cream"

    def _next_order_step(self, phone, name, order_details, prefix=""):
        """Save state and ask for the next MISSING order field — or confirm if
        the order is already complete. Lets a pre-filled order (parsed from the
        customer's opening message) skip straight ahead instead of re-asking.
        `prefix` is an optional lead-in like 'Thanks Sarah! '."""
        od = dict(order_details or {})

        # Drink must be valid / makeable. If they named one we can't do, drop
        # it and ask for a good one.
        drink = od.get("type")
        if drink:
            available = self._get_available_coffee_types() or []
            if available and not self._is_valid_coffee_type(drink, available):
                self._set_conversation_state(
                    phone, "awaiting_coffee_type", {"name": name}
                )
                return f"{prefix}Sorry, we don't have {drink} today. What would you like? ({', '.join(available)})"
            if self.nlp.is_black_coffee(drink):
                od["milk"] = "no milk"

        # Un-makeable milk → drop it and re-ask milk.
        milk_note = ""
        if od.get("milk") and not self._milk_is_makeable(od.get("milk")):
            milk_note = f"We don't have {od.pop('milk')} at any station — "

        state_data = {"name": name, "order_details": od}

        if "type" not in od:
            self._set_conversation_state(
                phone, "awaiting_coffee_type", {"name": name, "order_details": od}
            )
            return f"{prefix}What can I get you? (e.g. flat white, latte, cappuccino — or MENU for the list)"
        if "milk" not in od:
            if milk_note:
                # They NAMED a milk we can't make — never swap dairy in
                # behind their back (allergy risk). This case still asks.
                self._set_conversation_state(phone, "awaiting_milk", state_data)
                milks = self._get_available_milk_types() or ["full cream"]
                return f"{prefix}{milk_note}What milk for your {od['type']}? ({', '.join(milks)}, or 'no milk')"
            # No milk mentioned at all: "flat white" means the normal one
            # (Steve, 2026-07-21) — default to the event's standard dairy
            # instead of interrogating the customer. NOT silent: the
            # confirmation recap spells the milk out with a CANCEL path.
            # Teas default to no milk (milk-on-the-side is the norm).
            if "tea" in str(od.get("type", "")).lower():
                od["milk"] = "no milk"
            else:
                od["milk"] = self._default_milk()
            state_data = {"name": name, "order_details": od}
        if "size" not in od:
            sizes = self._get_available_sizes(od.get("type")) or ["medium"]
            if len(sizes) == 1:
                od["size"] = sizes[0]
                state_data = {"name": name, "order_details": od}
            else:
                self._set_conversation_state(phone, "awaiting_size", state_data)
                return f"{prefix}What size {od['type']}? ({', '.join(sizes)})"
        # Sugar: don't prompt — most customers don't take it. Default to no
        # sugar (shown in the recap so they can fix it), then auto-place.
        return self._place_order(phone, name, od, prefix=prefix)

    def _split_multi_drink(self, message):
        """Detect "two coffees in one text" — e.g. "1 oat latte and 1 flat
        white", "2 cappuccinos", "latte, flat white & long black".

        Returns a list of (segment_text, parsed_order_dict) for each distinct
        drink when 2+ are found, else None (so the normal single-order flow
        runs). Quantities like "2 lattes"/"two flat whites" expand to repeats.
        """
        text = (message or "").strip()
        if not text:
            return None
        # Split on the connectors people actually put between drinks.
        parts = re.split(
            r"\s+and\s+|\s*,\s*|\s*\+\s*|\s*&\s*|\s+plus\s+", text, flags=re.I
        )
        num_words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}
        expanded = []
        for p in parts:
            p = (p or "").strip()
            if not p:
                continue
            # Leading digit quantity: "2 lattes", "2x latte", "3 flat whites".
            m = re.match(r"^(\d{1,2})\s*x?\s+(.+)$", p)
            wm = re.match(r"^(one|two|three|four|five|six)\s+(.+)$", p, flags=re.I)
            if m and 1 <= int(m.group(1)) <= 10:
                expanded.extend([m.group(2)] * int(m.group(1)))
            elif wm:
                expanded.extend([wm.group(2)] * num_words[wm.group(1).lower()])
            else:
                expanded.append(p)
        parsed = []
        for seg in expanded:
            od = self.nlp.parse_order(seg, apply_defaults=False) or {}
            if od.get("type"):
                parsed.append((seg, od))
        return parsed if len(parsed) >= 2 else None

    def _multi_drink_fallback(self, phone, name, reason):
        """When a multi-drink text can't be fully resolved (missing/unmakeable
        milk, drink we don't make), don't guess — drop back to the normal
        one-coffee flow and tell them how to do the group."""
        self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
        return (
            f"I can do a group order, but {reason}. Easiest is one coffee at a "
            f"time — what's the first one? (Then reply FRIEND to add the next.)"
        )

    def _handle_multi_drink_order(self, phone, message, state=None):
        """Place several coffees from a single text as ONE linked group: same
        station, shared group_id, ready together. Returns the combined
        confirmation, or None if the message isn't actually multi-drink (so the
        caller falls through to the normal single-order flow)."""
        parsed = self._split_multi_drink(message)
        if not parsed:
            return None

        # Who's ordering? Prefer the name we already have; otherwise pull it
        # from the message ("Sarah, a latte and a flat white"); otherwise ask.
        name = (state.get("temp_data") or {}).get("name") if state else None
        if not name:
            cust = self.get_customer(phone)
            name = cust.get("name") if cust else None
        if not name:
            name, _ = self._extract_name_and_order(message)
        if not name:
            self._set_conversation_state(
                phone, "awaiting_name", {"pending_multi": message}
            )
            return "Sounds like a few coffees! First - what's your name?"
        if len(name) > 50:
            name = name[:50]

        # Re-parse from a name-stripped message so a leading "Name 1 oat latte"
        # doesn't read the quantity "1" as 1 sugar. (When a comma follows the
        # name the splitter already drops it; this covers the no-comma case.)
        stripped = message.strip()
        if name and stripped.lower().startswith(name.lower()):
            stripped = stripped[len(name) :].lstrip(" ,")
            reparsed = self._split_multi_drink(stripped)
            if reparsed:
                parsed = reparsed

        # Resolve each drink. Unspecified milk defaults to the event's
        # standard dairy ("2 lattes" means normal milk — Steve), shown in
        # each order's confirmation. A milk they NAMED but we can't make
        # still hard-stops (allergen safety — never swap dairy in
        # silently). Size/sugar fall back to defaults shown in the recap.
        available_types = self._get_available_coffee_types() or []
        resolved = []
        for _seg, od in parsed:
            od = dict(od)
            drink = od.get("type")
            if available_types and not self._is_valid_coffee_type(
                drink, available_types
            ):
                return self._multi_drink_fallback(
                    phone, name, f"we don't have {drink} today"
                )
            if self.nlp.is_black_coffee(drink):
                od["milk"] = "no milk"
            if not od.get("milk"):
                od["milk"] = (
                    "no milk"
                    if "tea" in str(drink or "").lower()
                    else self._default_milk()
                )
            if not self._milk_is_makeable(od.get("milk")):
                return self._multi_drink_fallback(
                    phone, name, f"we don't have {od.get('milk')} milk"
                )
            if not od.get("size"):
                sizes = self._get_available_sizes(drink) or ["medium"]
                lower = [s.lower() for s in sizes]
                od["size"] = "medium" if "medium" in lower else sizes[0]
            od.setdefault("sugar", "no sugar")
            resolved.append(od)

        # Self-serve sugar venues: strip any requested sugar from every
        # drink; one note on the reply covers the lot.
        multi_sugar_redirect = any(self._apply_self_serve_sugar(od) for od in resolved)

        # PRE-EVENT MODE: preferences store ONE usual per phone — save the
        # first drink and say so rather than silently dropping the rest.
        if self._pre_event_settings().get("enabled"):
            msg = self._pre_event_response(phone, name, resolved[0])
            if len(resolved) > 1:
                msg += (
                    "\n(Pre-orders save ONE coffee per phone - we kept the "
                    "first; order the rest on the day.)"
                )
            return msg

        # Place them. The FIRST order establishes the group_id (its order
        # number) and the station; every sibling is forced to that station and
        # stamped with the same group_id so they stay together.
        placed = []
        group_id = None
        group_label = f"{name}'s group"
        station_for_group = None
        for od in resolved:
            if station_for_group is not None:
                od["station_id"] = station_for_group
                od["stationId"] = station_for_group
            if group_id is not None:
                od["group_id"] = group_id
                od["group_label"] = group_label
            resp = self._confirm_order(phone, od, name)
            if not isinstance(resp, str) or resp.lower().startswith("sorry"):
                break  # placement failed (no stations etc.) — stop, keep what stuck
            num = od.get("_created_order_number")
            if station_for_group is None:
                station_for_group = od.get("_created_station_id")
            if group_id is None and num:
                group_id = num
                # Back-link the first order, which was created before we knew
                # the group_id (it IS the group_id).
                self._ensure_group_id_on_order(
                    order_id=od.get("_created_order_id"),
                    order_number=num,
                    group_id=group_id,
                    group_label=group_label,
                )
            placed.append((num, od))

        self._set_conversation_state(phone, "completed")
        if not placed:
            return (
                "Sorry, I couldn't place that group order just now. "
                "Please try sending one coffee at a time."
            )

        lines = [f"#{num}: {self.nlp.format_order_summary(od)}" for num, od in placed]
        total_line = self._format_group_total([od for _, od in placed])
        return (
            f"Got it {name}! {len(placed)} coffees ordered together:\n"
            + "\n".join(lines)
            + (self.SUGAR_SELF_SERVE_NOTE + "\n" if multi_sugar_redirect else "")
            + f"{total_line}\n"
            "Same station, ready together. Wrong? CHANGE or OOPS."
        )

    def _handle_awaiting_name(self, phone, message, state):
        """Handle name input during conversation"""
        # If we stashed a multi-drink order while waiting for a name, this
        # reply IS the name — capture it and place the whole group now.
        pending_multi = (state.get("temp_data") or {}).get("pending_multi")
        if pending_multi:
            nm = (message or "").strip()
            if len(nm) < 2 or len(nm) > 50:
                return "Please enter a valid name (2-50 characters)."
            return self._handle_multi_drink_order(
                phone, pending_multi, {"temp_data": {"name": nm}}
            )

        # Usual-order shortcut ("the usual").
        if self.nlp.is_asking_for_usual(message):
            nm = (message or "").strip()
            self._set_conversation_state(phone, "awaiting_coffee_type", {"name": nm})
            return self._process_usual_order(phone, nm)

        # The reply may carry the name AND the order ("Sarah large flat white
        # oat 1 sugar"), or we may have stashed an order before asking the
        # name. If we end up with a drink, skip straight to the next missing
        # field instead of storing the whole reply as the name.
        extracted_name, parsed_order = self._extract_name_and_order(message)
        carried = (state.get("temp_data") or {}).get("order_details") or {}
        order_details = {
            **carried,
            **{k: v for k, v in (parsed_order or {}).items() if v},
        }
        if order_details.get("type"):
            name = extracted_name
            if not name:
                self._set_conversation_state(
                    phone, "awaiting_name", {"order_details": order_details}
                )
                return "Got it! And what's your first name?"
            if len(name) < 2 or len(name) > 50:
                return "Please enter a valid name (2-50 characters)."
            return self._next_order_step(
                phone, name, order_details, prefix=f"Thanks {name}! "
            )

        # No order in the reply — treat the whole thing as just the name.
        name = (message or "").strip()
        if len(name) < 2 or len(name) > 50:
            return "Please enter a valid name (2-50 characters)."

        # Get customer info to check if they have a usual order
        customer = self.get_customer(phone)

        if customer and self._has_usual_order(phone):
            # Suggest usual order if they have one. Include decaf
            # prefix and strength tail so a regular's full usual
            # ("strong decaf flat white") replays exactly.
            usual_order = self._get_usual_order_details(phone)
            if usual_order:
                coffee_type = usual_order.get("type", "coffee")
                milk = usual_order.get("milk", "milk")
                size = usual_order.get("size", "regular")
                strength = usual_order.get("strength")
                decaf = usual_order.get("decaf")
                drink_label = f"decaf {coffee_type}" if decaf else coffee_type
                strength_text = f" ({strength})" if strength else ""

                # Save name and set suggestion context
                self._set_conversation_state(
                    phone,
                    "awaiting_coffee_type",
                    {
                        "name": name,
                        "suggestion_context": "usual_order",  # Mark that we've suggested their usual order
                    },
                )

                return (
                    f"Nice to meet you, {name}! Would you like your usual "
                    f"{size} {drink_label} with {milk}{strength_text}? "
                    f"Reply YES or tell me what you'd like."
                )

        # For new customers or those without usual orders
        self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
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
            sizes = self._get_available_sizes() or ["medium"]
            milks = self._get_available_milk_types() or ["full cream"]
            example_size = sizes[0]
            example_milk = next(
                (
                    m
                    for m in ["oat", "full cream", "skim", "almond", "lactose free"]
                    if m in milks
                ),
                milks[0] if milks else "full cream",
            )
        except Exception:
            example_size, example_milk = "medium", "full cream"

        # Build the examples from what is ACTUALLY on, not from a fixed
        # string. The old one named "1 sugar" and "earl grey tea" at a
        # venue that serves neither -- an example is an instruction, and
        # teaching an order we then refuse is worse than giving none.
        examples = [f'"{example_size} {example_milk} latte"']
        if not self._sugar_self_serve():
            examples[0] = f'"{example_size} {example_milk} latte 1 sugar"'
        examples.append('"flat white"')
        try:
            extras = self._get_available_extra_drinks() or []
        except Exception:
            extras = []
        if extras:
            examples.append(f'"{extras[0]}"')
        return (
            f"Hi {name}! What can I get you?\n"
            f"Examples: {', '.join(examples)}\n"
            f"Reply MENU to see what's on offer."
        )

    def _has_usual_order(self, phone):
        """Check if customer has a usual order"""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT preferred_drink, preferred_milk 
                FROM customer_preferences 
                WHERE phone = %s
            """,
                (phone,),
            )

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
                cursor.execute(
                    """
                    SELECT preferred_drink, preferred_milk, preferred_size,
                           preferred_sugar, preferred_notes,
                           preferred_strength, preferred_decaf
                    FROM customer_preferences
                    WHERE phone = %s
                """,
                    (phone,),
                )
                result = cursor.fetchone()
                has_strength_cols = True
            except Exception:
                try:
                    self.db.rollback()
                except Exception:
                    pass
                cursor = self.db.cursor()
                cursor.execute(
                    """
                    SELECT preferred_drink, preferred_milk, preferred_size,
                           preferred_sugar, preferred_notes
                    FROM customer_preferences
                    WHERE phone = %s
                """,
                    (phone,),
                )
                result = cursor.fetchone()
                has_strength_cols = False

            if result:
                if has_strength_cols:
                    if isinstance(result, dict):
                        coffee_type = result.get("preferred_drink")
                        milk = result.get("preferred_milk")
                        size = result.get("preferred_size")
                        sugar = result.get("preferred_sugar")
                        notes = result.get("preferred_notes")
                        strength = result.get("preferred_strength")
                        decaf = result.get("preferred_decaf")
                    else:
                        coffee_type, milk, size, sugar, notes, strength, decaf = result
                else:
                    if isinstance(result, dict):
                        coffee_type = result.get("preferred_drink")
                        milk = result.get("preferred_milk")
                        size = result.get("preferred_size")
                        sugar = result.get("preferred_sugar")
                        notes = result.get("preferred_notes")
                    else:
                        coffee_type, milk, size, sugar, notes = result
                    strength, decaf = None, False

                # Only return if we have at least a coffee type
                if coffee_type:
                    order_details = {
                        "type": coffee_type,
                        "milk": milk or "full cream",
                        "size": size or "medium",
                    }

                    if sugar:
                        order_details["sugar"] = sugar

                    if notes:
                        order_details["notes"] = notes

                    if strength:
                        order_details["strength"] = strength

                    if decaf:
                        order_details["decaf"] = True

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
            name = customer.get("name", "") if customer else ""

            # If still no name, we need to ask for it
            if not name:
                self._set_conversation_state(phone, "awaiting_name")
                return "I don't have your name yet. What's your first name?"

        # Get usual order
        usual_order = self._get_usual_order_details(phone)

        if usual_order:
            # Make sure the name is included in the order details
            usual_order["name"] = name

            # Update conversation state with usual order
            state_data = {
                "name": name,
                "order_details": usual_order,
                "order_type": "usual",
            }
            self._set_conversation_state(phone, "awaiting_confirmation", state_data)

            # Format order summary — include decaf prefix and strength
            # tail so a regular's full usual ("strong decaf double-shot
            # flat white") replays exactly, not collapsed to "flat white".
            coffee_type = usual_order.get("type", "coffee")
            milk = usual_order.get("milk", "milk")
            size = usual_order.get("size", "medium")
            sugar = usual_order.get("sugar", "no sugar")
            strength = usual_order.get("strength")
            decaf = usual_order.get("decaf")

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
            self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
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
    _STANDARD_DRINK_MENU_FALLBACK = [
        "latte",
        "cappuccino",
        "flat white",
        "long black",
        "espresso",
        "mocha",
    ]

    def _get_espresso_drink_menu(self):
        """Return the espresso-based drink menu from catalog_items.

        Cached for the lifetime of the CoffeeOrderSystem instance —
        a new drink added at runtime requires a restart to pick up
        (acceptable since adding drinks is a rare operator action).
        Falls back to the hardcoded list if catalog_items is empty
        or unreachable.
        """
        if hasattr(self, "_espresso_menu_cache"):
            return self._espresso_menu_cache
        try:
            cur = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cur.execute(
                """
                SELECT short_name, display_name
                FROM catalog_items
                WHERE category = 'drink'
                  AND subcategory = 'espresso'
                  AND is_active = TRUE
                ORDER BY sort_order
            """
            )
            rows = cur.fetchall()
            if rows:
                # Prefer short_name (lowercase, no parens) — matches
                # what the SMS conversation pattern matchers expect.
                menu = [r[0] or (r[1] or "").lower() for r in rows]
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
            coffees = data.get("coffee") or []
            names = {
                str(c.get("name", "")).strip().lower()
                for c in coffees
                if isinstance(c, dict) and c.get("enabled", True)
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
        if hasattr(self, "_unlimited_stock_cache"):
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
                    self._unlimited_stock_cache = bool(parsed.get("enabled"))
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
        if hasattr(self, "_unlimited_stock_cache"):
            del self._unlimited_stock_cache

    # --- Routing rules ---------------------------------------------
    # The Barista → Queue AI tab now persists its load-balancing
    # preferences to the `routing_rules` row in `settings` (via
    # /api/routing-rules). _assign_station consults them to shape
    # the assignment algorithm. Cached at first call; invalidated by
    # the PUT endpoint.
    _ROUTING_DEFAULTS = {
        "prioritizeEfficiency": True,
        "balanceWorkload": True,
        "considerCapabilities": True,
        "emergencyMode": False,
    }

    def _get_routing_rules(self):
        if hasattr(self, "_routing_rules_cache"):
            return self._routing_rules_cache
        try:
            cursor = self.db.cursor()
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor.execute("SELECT value FROM settings WHERE key = 'routing_rules'")
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
        if hasattr(self, "_routing_rules_cache"):
            del self._routing_rules_cache

    # --- Pricing (honor-system) ----------------------------------
    # When pricing_settings.enabled is true, the SMS confirmation
    # message embeds the computed total and asks the customer to
    # pay at the counter at collection time. See ARCHITECTURE.md
    # section 11 for the pricing model.
    def _get_pricing_settings(self):
        if hasattr(self, "_pricing_cache"):
            return self._pricing_cache
        defaults = {
            "enabled": False,
            "currency": "AUD",
            "symbol": "$",
            "per_drink": {},
            "unknown_drink_price": 4.50,
            "milk_surcharge": {},
            "size_surcharge": {"small": -0.50, "medium": 0.00, "large": 0.50},
            "sugar_surcharge_per_sachet": 0.00,
            "show_in_sms": True,
            # When True AND pricing is enabled, VIP orders are free.
            # Used at paid events where the host comps drinks for
            # sponsors / staff / press — they get tagged VIP (via SMS
            # VIP code, or marked on a walk-in) and the price compute
            # returns 0 with a "VIP - no charge" label rather than a
            # dollar amount, so neither the SMS confirmation nor the
            # barista card mistakenly asks them to pay.
            "vip_free": False,
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
                        for k in ("per_drink", "milk_surcharge", "size_surcharge"):
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
        if hasattr(self, "_pricing_cache"):
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

        text = (message or "").strip().lower()
        # Strip the EDIT/CHANGE prefix
        for prefix in ("edit ", "change ", "edit", "change"):
            if text.startswith(prefix):
                text = text[len(prefix) :].strip()
                break
        # Allow optional "to": "edit milk TO oat" / "change size TO large"
        text = re.sub(r"\bto\b", " ", text).strip()
        text = re.sub(r"\s+", " ", text)
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
        if text in ("decaf", "make it decaf", "to decaf"):
            current_type = updated.get("type", "") or ""
            if not current_type.lower().startswith("decaf"):
                updated["type"] = f"decaf {current_type}".strip()
            return updated, "made it decaf"
        if text in ("no decaf", "regular", "not decaf", "undecaf"):
            current_type = updated.get("type", "") or ""
            lower = current_type.lower()
            if lower.startswith("decaf "):
                updated["type"] = current_type[6:].strip()
                return updated, "removed decaf"
            return updated, "kept it regular"

        # Field-then-value form: "milk oat", "size large", "sugar 2"
        parts = text.split(" ", 1)
        if len(parts) >= 2:
            field, value = parts[0], parts[1].strip()
            field_aliases = {
                "milk": "milk",
                "milks": "milk",
                "size": "size",
                "sizes": "size",
                "sugar": "sugar",
                "sugars": "sugar",
                "sweetener": "sugar",
                "sweetness": "sugar",
                "strength": "strength",
                "shot": "strength",
                "shots": "strength",
                "drink": "type",
                "coffee": "type",
                "type": "type",
            }
            canonical_field = field_aliases.get(field)
            if canonical_field == "milk":
                match = _match_vocab(value, self.nlp.milks)
                if match:
                    updated["milk"] = match
                    return updated, f"milk → {match}"
                return updated, f'sorry, "{value}" isn\'t a milk we recognise'
            if canonical_field == "size":
                match = _match_vocab(value, self.nlp.sizes)
                if match:
                    updated["size"] = match
                    return updated, f"size → {match}"
                return updated, f'sorry, "{value}" isn\'t a size we recognise'
            if canonical_field == "sugar":
                match = _match_vocab(value, self.nlp.sugars)
                if match:
                    updated["sugar"] = match
                    return updated, f"sugar → {match}"
                return updated, f'sorry, "{value}" isn\'t a sugar amount we recognise'
            if canonical_field == "strength":
                match = _match_vocab(value, self.nlp.strengths)
                if match:
                    updated["strength"] = match
                    return updated, f"strength → {match}"
                # Allow free-form ("2 shots") to pass through verbatim
                updated["strength"] = value
                return updated, f"strength → {value}"
            if canonical_field == "type":
                # Use full NLP parse to canonicalise the drink type
                parsed = self.nlp.parse_order(value, apply_defaults=False)
                if parsed.get("type"):
                    updated["type"] = parsed["type"]
                    return updated, f"drink → {parsed['type']}"
                return updated, f'sorry, "{value}" isn\'t a drink we recognise'

        # Single-word form: "milk", "size", "sugar" → not enough info
        if text in ("milk", "size", "sugar", "strength", "drink", "coffee"):
            return None

        # Fall-through: treat whole text as a candidate value across
        # all vocabs — e.g. customer just says "EDIT oat" or "CHANGE large".
        for vocab, field, label in (
            (self.nlp.milks, "milk", "milk"),
            (self.nlp.sizes, "size", "size"),
            (self.nlp.sugars, "sugar", "sugar"),
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
        if not pricing.get("enabled") or not pricing.get("show_in_sms", True):
            return ""
        try:
            price_value, formatted = self._compute_order_price(order_details)
            if formatted is None:
                return ""
            # VIP comp: no "pay at the counter" — they're not paying.
            # Keep the message warm; this is usually a sponsor/staff
            # comp and a brusque "$0.00 owed" would feel off.
            if price_value == 0.0:
                return "\nYour drink is complimentary today. Enjoy!"
            return f"\nTotal: {formatted}, pay at the counter when you collect."
        except Exception as e:
            logger.warning(f"_format_price_tail failed (non-fatal): {e}")
            return ""

    def _format_group_total(self, orders):
        """Return a "\nGroup total: $X for N coffees — pay at the counter on
        collection." line summing every coffee in a group order, or '' when
        pricing is off / not shown in SMS. VIP-comped coffees count as $0, so a
        group with free VIP drinks totals correctly."""
        try:
            pricing = self._get_pricing_settings()
            if not pricing.get("enabled") or not pricing.get("show_in_sms", True):
                return ""
            total = 0.0
            n = 0
            any_priced = False
            for od in orders or []:
                if not isinstance(od, dict):
                    continue
                n += 1
                price_value, _ = self._compute_order_price(od)
                if price_value is not None:
                    total += price_value
                    any_priced = True
            if not any_priced or n == 0:
                return ""
            symbol = pricing.get("symbol", "$")
            return (
                f"\nGroup total: {symbol}{total:.2f} for {n} "
                f"coffee{'s' if n != 1 else ''}, pay at the counter on collection."
            )
        except Exception as e:
            logger.warning(f"_format_group_total failed (non-fatal): {e}")
            return ""

    def _compute_order_price(self, order_details):
        """Compute the total price for an order.

        Returns (price_float, formatted_string) e.g. (5.50, "$5.50").
        Returns (None, None) when pricing is disabled — callers should
        skip price-related logic in that case.

        Honor-system: this is just the AMOUNT to mention in the SMS
        confirmation. No payment processing.

        VIP-free: when pricing_settings.vip_free is True AND the order
        is flagged vip, returns (0.0, "VIP - no charge"). The string
        is the badge the barista card / SMS will show instead of a
        dollar amount — so neither the customer nor the barista
        mistakenly thinks a sponsor / staff member owes money.
        """
        pricing = self._get_pricing_settings()
        if not pricing.get("enabled"):
            return None, None

        # VIP comp short-circuits BEFORE any price math. Cheaper and
        # avoids the "0.50 + -0.50 = $0.00" coincidence looking like
        # a free drink for non-VIPs.
        if pricing.get("vip_free") and order_details.get("vip"):
            return 0.0, "VIP - no charge"

        # Flat-fee mode: a fixed price regardless of drink and milk
        # (alt milk is free). Two shapes, checked in order:
        #   1. flat_price_by_size — a per-size table, e.g. {small: 2.00,
        #      medium: 2.50}. The event default Steve asked for.
        #   2. flat_price — a single price for everything.
        # Either ignores per-drink prices + all surcharges. Editable in the
        # Pricing UI any time. Malformed values fall through to itemised.
        symbol = pricing.get("symbol", "$")
        flat_size = (order_details.get("size") or "medium").strip().lower()
        by_size = pricing.get("flat_price_by_size") or {}
        if isinstance(by_size, dict) and by_size.get(flat_size) not in (None, ""):
            try:
                total = round(float(by_size[flat_size]), 2)
                return total, f"{symbol}{total:.2f}"
            except (ValueError, TypeError):
                pass
        flat = pricing.get("flat_price")
        if flat not in (None, ""):
            try:
                total = round(float(flat), 2)
                return total, f"{symbol}{total:.2f}"
            except (ValueError, TypeError):
                pass  # malformed flat_price → fall through to itemised pricing

        drink = (order_details.get("type") or "").strip().lower()
        milk = (order_details.get("milk") or "").strip().lower()
        size = (order_details.get("size") or "medium").strip().lower()

        # Strip "decaf " prefix if present — same price as regular.
        if drink.startswith("decaf "):
            drink = drink[6:].strip()

        per_drink = pricing.get("per_drink", {}) or {}
        base = per_drink.get(drink)
        if base is None:
            base = float(pricing.get("unknown_drink_price", 4.50))
        else:
            base = float(base)

        milk_surcharge = float((pricing.get("milk_surcharge", {}) or {}).get(milk, 0.0))

        size_surcharge = float((pricing.get("size_surcharge", {}) or {}).get(size, 0.0))

        # Sugar surcharge — only counts the sachets the customer asked for.
        try:
            sachets = self._sugar_sachets_from_text(order_details.get("sugar") or "")
        except Exception:
            sachets = 0
        sugar_total = float(pricing.get("sugar_surcharge_per_sachet", 0.0)) * sachets

        total = max(0.0, base + milk_surcharge + size_surcharge + sugar_total)
        # Round to 2dp; the format string handles trailing zeros.
        total = round(total, 2)
        symbol = pricing.get("symbol", "$")
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
            espresso_part = espresso
        else:
            try:
                cursor = self.db.cursor()
                cursor.execute(
                    """
                    SELECT COUNT(*) FROM inventory_items
                    WHERE category = 'coffee'
                    AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                """
                )
                coffee_available = cursor.fetchone()[0] > 0
                espresso_part = espresso if coffee_available else []
            except Exception as e:
                logger.error(f"Error checking coffee availability: {str(e)}")
                espresso_part = espresso

        # Espresso drinks are gated by station capability (they need the
        # machine + that station's configured espresso menu). The non-espresso
        # "drinks" rows (tea, hot chocolate, chai, matcha) are enabled
        # event-wide in inventory and aren't espresso-gated — so they're ALWAYS
        # offered. Running them through the espresso coffee_types capability was
        # silently hiding every tea/hot-choc the operator turned on (the menu
        # only ever showed espresso drinks).
        return self._filter_to_station_makeable(
            espresso_part, "coffee_types"
        ) + self._drop_extras_no_station_makes(extras)

    def _drop_extras_no_station_makes(self, extras):
        """Remove non-espresso drinks that EVERY active station has switched off.

        Stations only carry a 'coffee_types' capability, which lists espresso
        drinks — so tea and friends have no capability dimension to be gated
        by, and used to be offered unconditionally. At a typical event the
        barista makes coffee and the tea/cold drinks are self-serve from
        another table, so the app was inviting delegates to order drinks
        nobody was going to make.

        The per-station switch the operator actually uses lives in the
        settings KV 'station_inventory_configs', keyed by item id
        ('qs-add-drinks-Earl-Grey-Tea') while these names are plain
        ('earl grey tea') — so normalise both sides.

        Deliberately conservative: a drink is dropped ONLY when it is
        explicitly false at every active station. No entry means "no
        opinion", not "disabled" — the previous version of this gate hid
        every tea the operator had turned on, and that must not recur. Any
        error leaves the list untouched.
        """
        if not extras:
            return extras
        try:
            configs = self._kv_station_inventory_configs()
            if not configs:
                return extras
            station_ids = self._active_station_ids()
            if not station_ids:
                return extras

            def norm(s):
                return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()

            kept = []
            for drink in extras:
                want = norm(drink)
                # off at a station only if that station names it AND says false
                verdicts = []
                for sid in station_ids:
                    cfg = configs.get(str(sid)) or configs.get(sid) or {}
                    said = None
                    for by_cat in cfg.values():
                        if not isinstance(by_cat, dict):
                            continue
                        for item_id, on in by_cat.items():
                            if (
                                norm(
                                    re.sub(
                                        r"^qs-add-[a-z]+-", "", str(item_id), flags=re.I
                                    )
                                )
                                == want
                            ):
                                said = bool(on)
                                break
                        if said is not None:
                            break
                    verdicts.append(said)
                named = [v for v in verdicts if v is not None]
                if named and not any(named):
                    continue  # every station that has an opinion says off
                kept.append(drink)
            # Return `kept` even when it is EMPTY. The usual "never return
            # nothing" guard is wrong here: espresso drinks come from a
            # separate branch, so an empty extras list cannot empty the menu
            # — and at a coffee-only event switching every tea off is the
            # whole point. Guarding it would hand them all straight back.
            return kept
        except Exception as e:
            logger.warning(f"extras station filter skipped: {e}")
            return extras

    def _kv_station_inventory_configs(self):
        """Raw 'station_inventory_configs' KV blob, uncached."""
        try:
            self.db.rollback()
        except Exception:
            pass
        cur = self.db.cursor()
        cur.execute(
            "SELECT value FROM settings WHERE key = 'station_inventory_configs'"
        )
        row = cur.fetchone()
        raw = row[0] if row and row[0] else None
        if not raw:
            return {}
        return json.loads(raw) if isinstance(raw, str) else raw

    def _active_station_ids(self):
        """Ids of stations currently active, per station_stats."""
        try:
            self.db.rollback()
        except Exception:
            pass
        cur = self.db.cursor()
        cur.execute("SELECT station_id FROM station_stats WHERE status = 'active'")
        return [r[0] for r in (cur.fetchall() or [])]

    def _get_available_extra_drinks(self):
        """Lowercased names of ENABLED non-espresso drinks (tea, hot chocolate,
        chai, matcha, iced tea, etc.).

        Source of truth is the Organiser's event-inventory store (settings KV
        'event_inventory' → 'drinks') — the SAME store that already drives the
        espresso on/off switches (_get_event_enabled_coffees). This makes the
        Inventory screen actually control the SMS + kiosk drinks menu: tick a
        drink and it appears, untick it and it's gone. Previously this read the
        inventory_items table (only Quick Setup wrote it), so the UI and the
        menu drifted. Falls back to that table for legacy DBs with no KV blob.
        """
        # Preferred: the UI-controlled event_inventory blob. Read the settings
        # TABLE directly (not _get_setting, which caches) so an Organiser toggle
        # is live on the next turn.
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'event_inventory'")
            row = cursor.fetchone()
            raw = row[0] if row and row[0] else None
            if raw:
                data = json.loads(raw) if isinstance(raw, str) else raw
                drinks = data.get("drinks")
                # A present 'drinks' list is authoritative even if everything in
                # it is disabled (return [] then) — don't fall through to the
                # legacy table and resurrect drinks the operator turned off.
                if isinstance(drinks, list):
                    names = [
                        str(d.get("name", "")).strip().lower()
                        for d in drinks
                        if isinstance(d, dict)
                        and d.get("enabled", True)
                        and d.get("name")
                    ]
                    return sorted(set(names))
        except Exception as e:
            logger.debug(f"_get_available_extra_drinks (event_inventory): {e}")
            try:
                self.db.rollback()
            except Exception:
                pass

        # Legacy fallback: the inventory_items table (pre-KV-blob DBs).
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT LOWER(name) FROM inventory_items
                WHERE category = 'drinks'
                  AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                ORDER BY name
            """
            )
            return [row[0] for row in cursor.fetchall() if row and row[0]]
        except Exception as e:
            logger.debug(f"_get_available_extra_drinks (table): {e}")
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

    _STANDARD_MILK_MENU = ["full cream", "skim", "oat", "almond", "lactose free", "soy"]

    # ---------------------------------------------------------------
    # THE EVENT MENU: what the operator actually switched on.
    #
    # This is the bridge that was missing. The Organiser's Inventory
    # Management screen saves the event menu to the `event_inventory`
    # KV blob, and the docstring on that endpoint said:
    #
    #   "The SMS bot reads via _get_event_inventory() which falls back
    #    to inventory_items for legacy DBs."
    #
    # _get_event_inventory() had never been written. It existed in that
    # one sentence and nowhere else. So every order path -- SMS, kiosk,
    # walk-in -- read the `inventory_items` TABLE instead, which nothing
    # in the Organiser UI writes to.
    #
    # The result: Steve switched Oat Milk off, switched every sweetener
    # off, left only Medium cups, and disabled tea -- all correctly
    # saved -- and the system went on selling oat lattes with sugar in
    # three sizes, because the two halves had never been connected.
    #
    # PRECEDENCE: the event blob wins whenever it actually says
    # something. If it is missing, empty, or names a category we have no
    # opinion on, we fall back to the legacy table rather than serving a
    # blank menu -- an event mid-service must never lose its whole menu
    # because a config read failed.
    # ---------------------------------------------------------------
    def _get_event_inventory(self):
        """The operator's saved menu, or {} if there isn't one."""
        try:
            blob = self._get_setting("event_inventory", None)
            if isinstance(blob, str):
                blob = json.loads(blob)
            return blob if isinstance(blob, dict) else {}
        except Exception as e:
            logger.warning("_get_event_inventory: read failed: %s", e)
            return {}

    # The Organiser writes display names ("Whole Milk", "Oat Milk"); the
    # rest of the system speaks in bare names ("full cream", "oat").
    # Normalise once, here, so the two vocabularies can be compared.
    _EVENT_NAME_ALIASES = {
        "whole": "full cream",
        "whole milk": "full cream",
        "regular": "full cream",
        "dairy": "full cream",
    }

    @classmethod
    def _normalise_menu_name(cls, name):
        n = str(name or "").strip().lower()
        # NOT " sugar": stripping it collapses "Coconut Sugar" and
        # "Coconut Milk" to the same token, and turns "White Sugar" into
        # "white", which is not a sweetener anybody would recognise.
        for suffix in (" milk", " syrup"):
            if n.endswith(suffix) and n != suffix.strip():
                n = n[: -len(suffix)].strip()
                break
        return cls._EVENT_NAME_ALIASES.get(n, n)

    def _event_enabled(self, category):
        """Enabled item names in one event-inventory category.

        Returns None when the operator has expressed no opinion (no
        blob, or no such category) so callers can tell "switched
        everything off" apart from "never configured" -- those must not
        behave the same way.
        """
        inv = self._get_event_inventory()
        items = inv.get(category)
        if not isinstance(items, list):
            return None
        names = [
            self._normalise_menu_name(it.get("name"))
            for it in items
            if isinstance(it, dict) and it.get("enabled")
        ]
        return [n for n in names if n]

    # What counts as a bean row in the mixed 'coffee' category. The
    # category holds both drink-named rows (legacy) and real bean rows;
    # same test the walk-in dialog applies client-side.
    _BEAN_WORDS = re.compile(
        r"(bean|blend|roast|single\s*origin|decaf|colombian?|ethiopian?"
        r"|brazilian?|kenyan?|guatemalan?)", re.I)

    def _requested_bean(self, od):
        """Which bean this order asks for, whatever shape the channel used.

        Decaf arrives in THREE shapes, one per era of the codebase:
          * bean_type='decaf'          (kiosk, walk-in, order editor)
          * decaf=True                 (the SMS NLP's flag)
          * type='decaf latte'         (older SMS parses fold it into
                                        the drink name)
        Every reader that interpreted only one of them was wrong for the
        other two -- the stock decrement read only bean_type, so an SMS
        decaf order burned house blend. Interpret once, here, and nowhere
        else.

        Returns '' for "no preference" (house/default).
        """
        try:
            b = str(od.get("bean_type") or "").strip().lower()
            if b and b not in ("house", "house blend", "default"):
                return b
            if od.get("decaf") is True:
                return "decaf"
            t = str(od.get("type") or "").strip().lower()
            if t.startswith("decaf"):
                return "decaf"
        except Exception:
            pass
        return ""

    def _get_available_bean_types(self):
        """Bean choices actually in stock, prettied for a menu.

        ['house blend', 'decaf'] -- house-ish first. Empty list when no
        bean rows exist (legacy events), which callers must treat as
        "don't offer the choice", not "offer nothing".
        """
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            unlimited = self._is_unlimited_stock_mode()
            if unlimited:
                cursor.execute(
                    "SELECT name FROM inventory_items WHERE category = 'coffee'"
                )
            else:
                cursor.execute(
                    """
                    SELECT name FROM inventory_items
                    WHERE category = 'coffee'
                    AND (COALESCE(amount, current_quantity) IS NULL
                         OR COALESCE(amount, current_quantity) > COALESCE(minimum_threshold, 0))
                """
                )
            beans, seen = [], set()
            for row in cursor.fetchall():
                raw = row[0] if not isinstance(row, dict) else list(row.values())[0]
                if not raw or not self._BEAN_WORDS.search(str(raw)):
                    continue
                name = re.sub(r"\s*(coffee\s*)?beans?\s*$", "", str(raw).strip(),
                              flags=re.I).strip().lower()
                if name and name not in seen:
                    seen.add(name)
                    beans.append(name)
            beans.sort(key=lambda b: (0 if ("house" in b or "blend" in b) else 1, b))
            return beans
        except Exception as e:
            logger.warning(f"_get_available_bean_types: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return []

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
            try:
                # commit=True is safe here: we rolled back just above, so the
                # transaction holds nothing but the heal's own work.
                self._ensure_inventory_quantity_columns(cursor, commit=True)
            except Exception:
                pass
            if unlimited:
                cursor.execute(
                    """
                    SELECT name FROM inventory_items
                    WHERE category = 'milk'
                    ORDER BY name
                """
                )
            else:
                cursor.execute(
                    """
                    SELECT name FROM inventory_items
                    WHERE category = 'milk'
                    AND (COALESCE(amount, current_quantity) IS NULL
                         OR COALESCE(amount, current_quantity) > COALESCE(minimum_threshold, 0))
                    ORDER BY name
                """
                )
            milk_types = [row[0].lower() for row in cursor.fetchall()]

            if not milk_types:
                # No milks configured yet — only happens on a brand-new
                # deploy before Quick Setup runs. Return canonical
                # defaults so the bot doesn't refuse all orders.
                logger.warning(
                    "No milk types found in inventory_items table, using defaults"
                )
                return ["full cream", "skim"]

            logger.info(f"Available milk types (from inventory_items): {milk_types}")

            # THE EVENT MENU WINS. This is the line whose absence sold
            # Steve an oat latte after he had switched oat off.
            event_milks = self._event_enabled("milk")
            if event_milks:
                dropped = [m for m in milk_types if m not in event_milks]
                milk_types = event_milks
                if dropped:
                    logger.info(
                        "Event menu excludes milk(s) %s that inventory_items "
                        "still stocks", dropped)
            elif event_milks == []:
                # Every milk switched off. Almost certainly a misconfig
                # rather than an intention -- a latte needs milk -- so we
                # keep serving, but say so rather than failing silently.
                logger.warning(
                    "Event menu has NO milk enabled; falling back to "
                    "inventory_items. Check the Organiser inventory screen.")

            # Only offer milks at least one station can make (drops e.g. soy /
            # lactose-free / coconut that are stocked but no station carries).
            makeable = [m for m in milk_types if self._milk_is_makeable(m)]
            if not makeable:
                # Fail-open, but loudly. Returning the unfiltered list when
                # NO station can make anything silently discards the whole
                # station-capability check -- which is how a misconfigured
                # event ends up accepting drinks nobody can produce.
                logger.warning(
                    "No station can make any of %s -- serving the unfiltered "
                    "list. Station capabilities are probably not configured.",
                    milk_types)
                return milk_types
            return makeable
        except Exception as e:
            logger.error(f"Error getting available milk types: {str(e)}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return ["full cream", "skim"]

    # Drinks the catering team pours, not us. Used to redirect rather
    # than refuse -- see the coffee-only reply in _validate_order.
    # Kept deliberately tight: exactly the drinks the reply PROMISES are
    # over there. Sending someone to catering for a smoothie, in a message
    # that only mentions tea, juice and water, is a worse answer than a
    # plain "we don't have that" -- named teas are included because
    # "english breakfast" contains no giveaway word.
    _CATERING_DRINKS = (
        "tea", "juice", "water",
        "earl grey", "english breakfast", "breakfast blend",
        "peppermint", "chamomile", "camomile", "green blend",
    )

    def _is_catering_drink(self, name):
        n = str(name or "").strip().lower()
        if not n:
            return False
        return any(term in n for term in self._CATERING_DRINKS)

    def _is_valid_milk_type(self, requested_milk, available_milks):
        """Check if the requested milk type is valid and in stock"""
        if not requested_milk:
            return True  # No milk requested is valid

        requested_milk = requested_milk.lower().replace(" milk", "").strip()

        # Direct match
        for available_milk in available_milks:
            available_clean = available_milk.lower().replace(" milk", "").strip()
            if requested_milk == available_clean:
                return True

            # Check for partial matches (e.g., "oat" matches "oat milk")
            if requested_milk in available_clean or available_clean in requested_milk:
                return True

        return False

    _STANDARD_SWEETENER_MENU = [
        ("no sugar", "sugar"),
        ("1 sugar", "sugar"),
        ("2 sugar", "sugar"),
        ("3 sugar", "sugar"),
        ("half sugar", "sugar"),
    ]

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
        has_bare_sugar = False
        for n in names:
            nl = (n or "").strip().lower()
            if nl == "no sugar":
                has_no_sugar = True
                continue
            if nl == "half sugar":
                has_half_sugar = True
                continue
            # "1 sugar", "2 sugar", etc. — must be checked BEFORE the
            # bare-sugar catch (they also end in ' sugar').
            parts = nl.split()
            if len(parts) >= 2 and parts[0].isdigit() and "sugar" in parts[1]:
                sugar_ints.append(int(parts[0]))
                continue
            # A bare stock row ('sugar' / 'white sugar' / 'raw sugar')
            # means any count is fine — the single-row model.
            if nl == "sugar" or nl.endswith(" sugar"):
                has_bare_sugar = True
                continue
            non_sugar_names.append(n)

        # Build the sugar range string.
        sugar_part = ""
        if has_bare_sugar and not sugar_ints:
            sugar_part = "any number (e.g. '2 sugars')"
        elif sugar_ints or has_no_sugar:
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
            bits.append(", ".join(non_sugar_names))

        return (
            f"Sugar: {', '.join(bits)} (just text the number)"
            if bits
            else "Sweetener: none"
        )

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
                cursor.execute(
                    """
                    SELECT name, category FROM inventory_items
                    WHERE category IN ('sweetener', 'sugar', 'artificial_sweetener')
                    ORDER BY category, name
                """
                )
            else:
                cursor.execute(
                    """
                    SELECT name, category FROM inventory_items
                    WHERE category IN ('sweetener', 'sugar', 'artificial_sweetener')
                    AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                    ORDER BY category, name
                """
                )
            sweeteners = [(row[0].lower(), row[1]) for row in cursor.fetchall()]

            # THE EVENT MENU WINS -- same bridge as milk. This category was
            # missed when drinks, coffee and cups were each wired up, so an
            # operator who switched every sweetener off still got asked
            # about sugar.
            event_sweeteners = self._event_enabled("sweeteners")
            if event_sweeteners is not None:
                if event_sweeteners:
                    keep = set(event_sweeteners)
                    sweeteners = [
                        (n, c) for (n, c) in sweeteners
                        if self._normalise_menu_name(n) in keep
                    ] or [(n, "sugar") for n in event_sweeteners]
                else:
                    # Deliberately none. Unlike milk, that is a coherent
                    # instruction: this venue does not add sweeteners, so
                    # the flow stops asking and tells people where to find
                    # them instead. See _sugar_self_serve.
                    logger.info(
                        "Event menu enables no sweeteners -- sugar is "
                        "help-yourself for this event.")
                    return []

            # If no sweeteners defined, return basic defaults
            if not sweeteners:
                logger.warning(
                    "No sweeteners found in inventory_items table, using defaults"
                )
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
                logger.warning(
                    "Equal sweetener incorrectly categorized as sugar instead of artificial_sweetener"
                )
                return False  # Reject if miscategorized

            # Check for partial matches
            if (
                requested_sweetener in sweetener_name
                or sweetener_name in requested_sweetener
            ):
                return True

        return False

    # Map cup names as the operator writes them (in inventory_items) to
    # the canonical sizes the NLP/order layer uses. Customers say
    # "medium" but the operator's cup category is "Regular"; we treat
    # those as the same thing rather than rejecting the customer's word.
    _SIZE_NAME_NORMALIZATION = {
        # canonical → variants seen in inventory_items.name
        "small": ["small", "sm", "s", "8oz", "8 oz"],
        "medium": ["medium", "regular", "med", "reg", "m", "12oz", "12 oz"],
        "large": ["large", "lg", "l", "16oz", "16 oz", "extra large", "xl"],
    }

    def _active_station_capability_set(self, dimension):
        """Union (lowercased) of one capability dimension ('sizes' /
        'coffee_types' / 'milk_types') across ACTIVE stations. Returns None
        when no active station defines that dimension — callers then treat it
        as 'no restriction' rather than 'nothing allowed'."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE status = 'active'"
            )
            rows = cursor.fetchall()
            vals = set()
            defined = False
            for row in rows:
                caps = row[0] if not isinstance(row, dict) else row.get("capabilities")
                if isinstance(caps, str):
                    try:
                        caps = json.loads(caps)
                    except Exception:
                        caps = {}
                if not isinstance(caps, dict):
                    continue
                lst = caps.get(dimension)
                if lst:
                    defined = True
                    for v in lst:
                        vals.add(str(v).strip().lower())
            return vals if defined else None
        except Exception as e:
            logger.warning(f"_active_station_capability_set({dimension}) failed: {e}")
            return None

    def _filter_to_station_makeable(self, items, dimension):
        """Keep only items at least one ACTIVE station can make for the given
        capability dimension. Safe fallbacks: if no active station defines the
        dimension, OR the filter would remove everything, return the original
        list unchanged — never leave the SMS menu empty or over-restrict on a
        misconfiguration. This is what stops the bot offering a size/drink no
        station can make (which then gets stuck 'pending', un-startable at the
        barista — the bug where a 'large hot chocolate' vanished)."""
        try:
            if not items:
                return items
            allowed = self._active_station_capability_set(dimension)
            if not allowed:
                return items
            kept = [it for it in items if str(it).strip().lower() in allowed]
            return kept if kept else items
        except Exception as e:
            logger.warning(f"_filter_to_station_makeable({dimension}) failed: {e}")
            return items

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

        # PREFER the Organiser's own list. The Inventory screen writes the
        # settings KV 'event_inventory'; only Quick Setup ever wrote the
        # inventory_items TABLE this function used to read. On a real event
        # that table can be EMPTY while the operator has carefully ticked
        # exactly one cup size — and an empty table fell through to
        # ['small','medium','large'], so the menu offered sizes that had
        # been switched off. Steve hit exactly that: only Medium ticked,
        # Small still on offer. Same fix already applied to drinks in
        # _get_available_extra_drinks; the table remains the fallback for
        # legacy events with no KV blob.
        kv_names = self._event_cup_names()
        if kv_names is not None:
            raw_names = kv_names
        else:
            raw_names = None

        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            if raw_names is not None:
                pass
            elif unlimited:
                cursor.execute(
                    """
                    SELECT name FROM inventory_items
                    WHERE category = 'cups'
                """
                )
            else:
                cursor.execute(
                    """
                    SELECT name FROM inventory_items
                    WHERE category = 'cups'
                      AND (amount IS NULL OR amount > COALESCE(minimum_threshold, 0))
                """
                )
            if raw_names is None:
                raw_names = [row[0] for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error getting available sizes: {e}")
            return ["small", "medium", "large"]

        if not raw_names:
            # No cups defined yet — return canonical defaults so the
            # bot doesn't refuse to take orders during initial setup.
            return ["small", "medium", "large"]

        # Normalize: map each operator-defined cup name back to one of
        # the three canonical sizes the NLP understands.
        # Match on TOKENS, not the whole string. Operators name cups things
        # like 'Medium (12oz)', 'Takeaway Cup Small', 'Extra Large (20oz)' —
        # none of which equal a canonical name or appear in the variant lists,
        # so exact matching returned nothing and the caller fell back to
        # offering all three sizes. That is why ticking only Medium still
        # left Small on the menu.
        #
        # 'extra large' is checked before the plain sizes so it cannot be
        # read as 'large' first — they both map to large here, but the order
        # keeps that true if the mapping ever changes.
        canonical = []
        for raw in raw_names:
            key = re.sub(r"[^a-z0-9 ]+", " ", (raw or "").strip().lower())
            key = re.sub(r"\s+", " ", key).strip()
            tokens = set(key.split())
            matched = None
            for canon, variants in self._SIZE_NAME_NORMALIZATION.items():
                for v in [canon] + list(variants):
                    v_norm = re.sub(r"[^a-z0-9 ]+", " ", v).strip()
                    if not v_norm:
                        continue
                    if " " in v_norm:
                        if v_norm in key:  # multi-word: 'extra large'
                            matched = canon
                            break
                    elif v_norm in tokens:  # single word: whole token only,
                        matched = canon  # so 'm' cannot match 'medium'
                        break
                if matched:
                    break
            if matched and matched not in canonical:
                canonical.append(matched)

        # Preserve the conventional small → medium → large order even
        # if the DB returned them in a different sequence.
        order = {"small": 0, "medium": 1, "large": 2}
        canonical.sort(key=lambda s: order.get(s, 99))
        canonical = canonical or ["small", "medium", "large"]
        # Only offer sizes at least one ACTIVE station can make — otherwise a
        # customer can pick a size (e.g. large) no barista can start.
        return self._filter_to_station_makeable(canonical, "sizes")

    def _event_cup_names(self):
        """ENABLED cup names from the Organiser's event_inventory blob.

        Returns None when there is no blob at all (legacy event — caller
        falls back to the inventory_items table). Returns [] when the blob
        exists but nothing is ticked, which is a real answer, not a
        missing one.
        """
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cur = self.db.cursor()
            cur.execute("SELECT value FROM settings WHERE key = 'event_inventory'")
            row = cur.fetchone()
            raw = row[0] if row and row[0] else None
            if not raw:
                return None
            data = json.loads(raw) if isinstance(raw, str) else raw
            cups = (data or {}).get("cups")
            if not isinstance(cups, list):
                return None
            return [
                str(c.get("name"))
                for c in cups
                if isinstance(c, dict) and c.get("enabled") and c.get("name")
            ]
        except Exception as e:
            logger.warning(f"event cup list unavailable, using inventory table: {e}")
            return None

    def _handle_awaiting_coffee_type(self, phone, message, state):
        """Handle coffee type input"""
        # Check if this is a usual order request
        if self.nlp.is_asking_for_usual(message):
            name = state.get("temp_data", {}).get("name", "")
            return self._process_usual_order(phone, name)

        # Check if this is an affirmative response to a suggestion of their usual order
        if self.nlp.is_affirmative_response(message):
            # Check if we previously suggested their usual order
            suggestion_context = state.get("temp_data", {}).get("suggestion_context")
            name = state.get("temp_data", {}).get("name", "")

            if suggestion_context == "usual_order":
                # They've said "Yes" to our suggestion of their usual order
                return self._process_usual_order(phone, name)

        # Check available coffee types from the inventory
        available_coffee_types = self._get_available_coffee_types()

        # Parse message with NLP. apply_defaults=False so we can tell which
        # fields the customer actually specified vs. fields that are missing
        # and need to be asked for. (See nlp.py parse_order docstring.)
        order_details = self.nlp.parse_order(message, apply_defaults=False)
        coffee_type = order_details.get("type", "").lower()

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
        if coffee_type and not self._is_valid_coffee_type(
            coffee_type, available_coffee_types
        ):
            # Split teas and coffees so the response reads naturally.
            teas = [c for c in (available_coffee_types or []) if "tea" in c.lower()]
            non_teas = [
                c for c in (available_coffee_types or []) if "tea" not in c.lower()
            ]
            parts = []
            if non_teas:
                parts.append(f"Coffee: {', '.join(sorted(non_teas))}")
            if teas:
                parts.append(f"Tea: {', '.join(sorted(teas))}")
            available_line = " / ".join(parts) if parts else "see MENU"

            # If they asked for something the CATERERS serve and we do not,
            # send them somewhere rather than just saying no. At a venue
            # running coffee stations alongside a morning-tea spread, "we
            # don't have earl grey" is a dead end; "it's over there" is an
            # answer. Only fires when we genuinely serve no such drink --
            # at an event that does stock tea, the normal menu reply is
            # the more useful one.
            if not teas and self._is_catering_drink(coffee_type):
                return (
                    f"We're coffee only - tea, juice and water are "
                    f"available in the catering area.\n"
                    f"From us: {available_line}.\n"
                    f"Reply MENU for the full list."
                )
            return (
                f"Sorry, we don't have {coffee_type} today. Available: "
                f"{available_line}.\n"
                f"Reply MENU for the full list."
            )

        # Validate milk type if specified
        milk_type = order_details.get("milk", "")
        if milk_type:
            available_milk_types = self._get_available_milk_types()
            if not self._is_valid_milk_type(milk_type, available_milk_types):
                return (
                    f"Sorry, we don't have {milk_type} milk. Available milks: "
                    f"{', '.join(available_milk_types)}.\n"
                    f"Reply MENU for the full list."
                )

        # Validate the bean choice. The kiosk hides its Decaf toggle when
        # no decaf row is stocked and the walk-in builds its tiles from
        # stock -- SMS was the one channel with no gate at all, so it
        # would accept "decaf latte" with zero decaf beans and the
        # barista would discover it at the machine. Steve: "might not
        # have decaf so all variation of that recipe cant be made ...
        # prevent people from ordering via either sms, qr, walk in".
        #
        # An empty beans list means this event has no bean rows (legacy)
        # -- no gate to apply, same rule as the menu side.
        requested_bean = self._requested_bean(order_details)
        if requested_bean:
            available_beans = self._get_available_bean_types()
            if available_beans and not any(
                requested_bean in b or b in requested_bean
                for b in available_beans
            ):
                return (
                    f"Sorry, we don't have {requested_bean} today. "
                    f"We can make it with: {', '.join(available_beans)}.\n"
                    f"Reply MENU for the full list."
                )

        # Validate sweetener if specified
        sweetener = order_details.get("sugar", "")
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
        name = state.get("temp_data", {}).get("name", "")

        # If no coffee type found, prompt again
        if "type" not in order_details:
            return f"I'm not sure what type of coffee you'd like, {name}. Please specify a coffee type like latte, cappuccino, flat white, etc."

        # For black coffees, milk is implicitly "no milk"
        if self.nlp.is_black_coffee(order_details["type"]):
            order_details["milk"] = "no milk"

        # Propagate the VIP flag from conversation state into the
        # order details. _handle_vip_code stores it on temp_data but
        # nothing copied it onto order_details, so _confirm_order's
        # `if order_details.get('vip'): queue_priority = 1` branch
        # never fired and VIP orders ended up at normal priority.
        if state.get("temp_data", {}).get("vip"):
            order_details["vip"] = True

        # Walk through missing fields one at a time so customers know what
        # we understood vs. what we're still asking about. Previously the
        # system silently defaulted missing fields and skipped to "Confirm?",
        # which made customers feel their SMS was ignored.
        state_data = {"name": name, "order_details": order_details}
        # Keep the VIP flag on temp_data too so it survives the
        # subsequent milk → size → sugar state transitions.
        if state.get("temp_data", {}).get("vip"):
            state_data["vip"] = True

        if "milk" not in order_details:
            # Unspecified milk means the normal one (Steve, 2026-07-21):
            # default to the event's standard dairy (teas: no milk) and
            # let the read-back / confirmation show it with a CANCEL
            # path. A milk they NAMED that we can't make still asks
            # (handled upstream) — dairy is never swapped in silently.
            if "tea" in str(order_details.get("type", "")).lower():
                order_details["milk"] = "no milk"
            else:
                order_details["milk"] = self._default_milk()
            state_data = {
                "name": name,
                "order_details": order_details,
                **({"vip": True} if state_data.get("vip") else {}),
            }

        # Phrase the read-back differently for black coffees so we don't say
        # "with no milk milk".
        milk = order_details["milk"]
        milk_phrase = "" if milk == "no milk" else f" with {milk} milk"

        # Size note is set (not returned) when there's exactly one size, so
        # we FALL THROUGH to the sugar/confirm checks. The bug this fixes
        # (caught in the live prod e2e, 2026-06-13): a one-size event jumped
        # straight to "How much sugar?" even when the customer had ALREADY
        # said it in the same message ("skim flat white 1 sugar"), dropping
        # their answer and asking again.
        size_note = ""
        if "size" not in order_details:
            available_sizes = self._get_available_sizes(
                order_details.get("type", "")
            ) or ["small", "medium", "large"]
            if len(available_sizes) == 1:
                order_details["size"] = available_sizes[0]
                size_note = f" (all drinks are {available_sizes[0]} today)"
                # fall through — do NOT return; sugar may already be known
            else:
                self._set_conversation_state(phone, "awaiting_size", state_data)
                return (
                    f"Got it — {order_details['type']}{milk_phrase}. "
                    f"What size? ({', '.join(available_sizes)})"
                )

        # Sugar isn't prompted — default to no sugar (shown in the recap so
        # they can fix it) and auto-place the order (no YES step).
        return self._place_order(phone, name, order_details)

    def _handle_awaiting_milk(self, phone, message, state):
        """Handle milk type input"""
        # Get current order details from state
        order_details = state.get("temp_data", {}).get("order_details", {})
        name = state.get("temp_data", {}).get("name", "")

        # Parse milk preference
        if message.lower() == "no milk" or message.lower() == "black":
            milk_type = "no milk"
        else:
            # Use NLP to extract milk type
            new_details = self.nlp.parse_order(message)
            milk_type = new_details.get("milk", None)

        # Reject a milk no station can make (e.g. coconut when stations only
        # carry full-cream/skim/oat/almond) — otherwise it's accepted and the
        # order gets stuck un-startable. Tolerant + safe-fallback via
        # _milk_is_makeable so valid milks are never wrongly rejected.
        if milk_type and not self._milk_is_makeable(milk_type):
            available = self._get_available_milk_types() or []
            self._set_conversation_state(
                phone, "awaiting_milk", {"name": name, "order_details": order_details}
            )
            opts = (
                (", ".join(available) + ", or 'no milk'") if available else "'no milk'"
            )
            return f"Sorry, we don't have {milk_type} at any station today. What milk would you like? ({opts})"

        # If milk type was provided, update order details
        if milk_type:
            order_details["milk"] = milk_type
            state_data = {"name": name, "order_details": order_details}

            # Don't re-ask for fields the customer already gave in their
            # first message — "large latte" used to get asked "what size?"
            # anyway because this handler unconditionally moved to
            # awaiting_size (and its prompt hardcoded "(small, medium,
            # large)" regardless of what cups the event actually stocks).
            # Found by tests/sms_scenarios: size_in_first_message_respected.
            # One-size events set the size and FALL THROUGH (don't return)
            # so an already-known sugar isn't re-asked. See the matching
            # fix + rationale in _handle_awaiting_coffee_type.
            size_note = ""
            if "size" not in order_details:
                available_sizes = self._get_available_sizes(
                    order_details.get("type", "")
                ) or ["small", "medium", "large"]
                if len(available_sizes) == 1:
                    order_details["size"] = available_sizes[0]
                    size_note = f"All drinks are {available_sizes[0]} today. "
                else:
                    self._set_conversation_state(phone, "awaiting_size", state_data)
                    return (
                        f"What size {order_details.get('type', 'coffee')} would you like? "
                        f"({', '.join(available_sizes)})"
                    )

            # Sugar isn't prompted — default no sugar (shown in the recap) and
            # auto-place. `size_note` (one-size events) is carried as a prefix.
            return self._place_order(phone, name, order_details, prefix=size_note)
        else:
            # If no milk type was found, prompt again with the makeable milks.
            milks = self._get_available_milk_types() or ["full cream", "skim"]
            return f"I didn't recognise that milk. Please choose from: {', '.join(milks)}, or 'no milk'."

    def _handle_awaiting_size(self, phone, message, state):
        """Handle size input"""
        # Get current order details from state
        order_details = state.get("temp_data", {}).get("order_details", {})
        name = state.get("temp_data", {}).get("name", "")

        # Get available sizes for this coffee type
        available_sizes = self._get_available_sizes(order_details.get("type", ""))

        # If only one size is available, select it — but NEVER silently.
        # Previously this branch ignored whatever the customer just typed:
        # they answered "medium" and the confirmation read "small latte"
        # (the only configured cup), i.e. the wrong cup at pickup with no
        # warning. Found by tests/sms_scenarios: size_answer_respected.
        # Now: if their answer differs from the only size, say so.
        if len(available_sizes) == 1:
            only_size = available_sizes[0]
            requested = self.nlp.parse_order(message).get("size")
            order_details["size"] = only_size

            state_data = {"name": name, "order_details": order_details}
            note = ""
            if requested and requested.lower() != only_size.lower():
                note = f"We only have {only_size} cups today, so I've made it {only_size}. "
            # Sugar isn't prompted — default no sugar, auto-place.
            return self._place_order(phone, name, order_details, prefix=note)

        # Use NLP to extract size
        new_details = self.nlp.parse_order(message)
        size = new_details.get("size")

        # Also check for simple size indicators
        if not size:
            message_lower = message.lower().strip()
            if message_lower in ["s", "small", "sm"]:
                size = "small"
            elif message_lower in ["m", "medium", "med", "regular", "standard"]:
                size = "medium"
            elif message_lower in ["l", "large", "lg", "big"]:
                size = "large"

        # If size was provided, check if it's available and update order details
        if size:
            # Convert to lowercase for comparison
            size_lower = size.lower()
            available_sizes_lower = [s.lower() for s in available_sizes]

            # Check if requested size is available
            if size_lower in available_sizes_lower:
                # Use the case from the available_sizes list
                order_details["size"] = available_sizes[
                    available_sizes_lower.index(size_lower)
                ]

                # Sugar isn't prompted — default no sugar (shown in the recap),
                # auto-place the order.
                return self._place_order(phone, name, order_details)
            else:
                # If size is not available, show available options
                return f"Sorry, we don't offer size '{size}' for {order_details.get('type', 'coffee')}. Available sizes are: {', '.join(available_sizes)}. Please select one of these."
        else:
            # If no size was found, prompt again with available options
            return f"I didn't recognize that size. Please choose from: {', '.join(available_sizes)}."

    def _sugar_value_to_string(self, val):
        """Map a numeric sugar value to a canonical sugar string."""
        if val <= 0:
            return "no sugar"
        if val > 12:
            val = 12  # sane cap; nobody needs 13 sugars
        if abs(val - 0.25) < 1e-9:
            return "quarter sugar"
        if abs(val - 0.5) < 1e-9:
            return "half sugar"
        if val == int(val):
            return f"{int(val)} sugar"
        return f"{val:g} sugar"

    def _parse_sugar_input(self, message):
        """Parse a sugar reply into a canonical sugar string. Accepts 0-9 (and
        higher, capped at 12), 'none'/'no', number words (one..ten), 'half' /
        'quarter', and fractions (1/2, 1/4, .5, .25, 1.5). Returns None when
        nothing sugar-like is found so the caller can re-ask."""
        s = (message or "").lower().strip()
        if not s:
            return None
        if s in (
            "no",
            "none",
            "zero",
            "n",
            "no sugar",
            "without sugar",
            "nil",
            "nope",
            "no thanks",
            "no thank you",
        ):
            return "no sugar"
        if "half" in s or s in ("1/2", "½", ".5", "0.5"):
            return "half sugar"
        if "quarter" in s or s in ("1/4", "¼", ".25", "0.25"):
            return "quarter sugar"
        word_nums = {
            "ten": 10,
            "nine": 9,
            "eight": 8,
            "seven": 7,
            "six": 6,
            "five": 5,
            "four": 4,
            "three": 3,
            "two": 2,
            "one": 1,
        }
        for w, n in word_nums.items():
            if w in s:
                return f"{n} sugar"
        frac = re.match(r"^\s*(\d+)\s*/\s*(\d+)\s*(?:sugars?)?\s*$", s)
        if frac:
            try:
                return self._sugar_value_to_string(
                    int(frac.group(1)) / int(frac.group(2))
                )
            except (ValueError, ZeroDivisionError):
                return None
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        if m:
            try:
                return self._sugar_value_to_string(float(m.group(1)))
            except ValueError:
                return None
        return None

    def _handle_awaiting_sugar(self, phone, message, state):
        """Handle sugar input"""
        # Get current order details from state
        order_details = state.get("temp_data", {}).get("order_details", {})
        name = state.get("temp_data", {}).get("name", "")

        # Check for usual order request again (sometimes users get confused)
        if self.nlp.is_asking_for_usual(message):
            return self._process_usual_order(phone, name)

        # Parse sugar flexibly: any number (0-9 and beyond), fractions
        # (1/2, 1/4, .5, .25, 1.5), "half"/"quarter", and number words.
        # Falls back to NLP for phrasings like "two sugars please".
        sugar = self._parse_sugar_input(message)
        if not sugar:
            new_details = self.nlp.parse_order(message, apply_defaults=False)
            sugar = new_details.get("sugar")

        if not sugar:
            return (
                "Sorry, I didn't catch that. How much sugar? "
                "Reply a number (0-9), 'half', or 'quarter'."
            )

        # They gave an explicit sugar — record it and auto-place (no YES step).
        order_details["sugar"] = sugar
        return self._place_order(phone, name, order_details)

    def _handle_awaiting_confirmation(self, phone, message, state):
        """Handle order confirmation"""
        message_upper = message.upper().strip()

        # Get order details from state
        order_details = state.get("temp_data", {}).get("order_details", {})
        name = state.get("temp_data", {}).get("name", "")

        if message_upper == "YES" or message_upper == "Y":
            # Confirm the order
            order_response = self._confirm_order(phone, order_details, name)

            # Order is complete - end the conversation
            self._set_conversation_state(phone, "completed")

            return (
                f"{order_response}\n"
                f"Tip: add a friend's coffee anytime by texting FRIEND."
            )

        elif message_upper == "NO" or message_upper == "N" or message_upper == "CANCEL":
            # Cancel the order
            self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
            return (
                f"Order cancelled. What type of coffee would you like instead, {name}?"
            )

        elif message_upper.startswith("EDIT") or message_upper.startswith("CHANGE"):
            # Targeted edit ("edit milk to oat") modifies only that
            # field and keeps the rest. Bare EDIT/CHANGE falls back
            # to the legacy "restart from coffee type" behaviour.
            edit_result = self._apply_targeted_edit(message, order_details)
            if edit_result is not None:
                updated_details, change_summary = edit_result
                # Save back and re-prompt confirmation
                temp_data = dict(state.get("temp_data", {}))
                temp_data["order_details"] = updated_details
                self._set_conversation_state(phone, "awaiting_confirmation", temp_data)
                order_summary = self.nlp.format_order_summary(updated_details)
                return (
                    f"Updated — {change_summary}.\n"
                    f"Here's your order now: {order_summary}"
                    f"{self._format_price_tail(updated_details)}\n"
                    f"Reply YES to confirm, NO to cancel, or EDIT to change something else."
                )
            # Bare EDIT — restart from coffee type
            self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
            return (
                f"Let's change that order, {name}. What type of coffee would you like?\n"
                f'Tip: you can also say e.g. "edit milk to oat" to change just one thing.'
            )

        elif (
            message_upper == "FRIEND"
            or message_upper == "GROUP"
            or "FRIEND" in message_upper
        ):
            # Start an order for a friend - keep the same phone number but ask for friend's name
            self._set_conversation_state(
                phone,
                "awaiting_friend_name",
                {
                    "primary_name": name,
                    "primary_order": order_details,
                    "group_orders": state.get("temp_data", {}).get("group_orders", []),
                    "station_id": order_details.get(
                        "station_id"
                    ),  # Keep same station for group orders
                },
            )
            return (
                "Great! Let's add a coffee for your friend. What's your friend's name?"
            )

        elif (
            message_upper == "NO FRIEND"
            or message_upper == "NO FRIENDS"
            or message_upper == "DONE"
            or message_upper == "FINISH"
        ):
            # User wants to end the conversation
            self._set_conversation_state(phone, "completed")
            total_orders = 1  # Just this order
            return f"Thanks, {name}! Your order has been confirmed. It will be ready for pickup at {station_label(self.db, order_details.get('station_id', 1))}."

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
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Check if we have a previous order for this friend
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT preferred_drink, preferred_milk, preferred_size, preferred_sugar
                FROM customer_preferences
                WHERE phone = %s AND name = %s
            """,
                (f"{phone}_{friend_name}", friend_name),
            )

            previous_order = cursor.fetchone()

            if previous_order and previous_order[0]:
                # We have a previous order for this friend
                coffee_type, milk, size, sugar = previous_order

                # Create a suggested order
                friend_order = {
                    "name": friend_name,
                    "type": coffee_type,
                    "milk": milk,
                    "size": size,
                    "sugar": sugar,
                }

                if station_id:
                    friend_order["station_id"] = station_id
                    friend_order["stationId"] = station_id

                # Format order summary for display
                order_summary = self.nlp.format_order_summary(friend_order)

                # Move to friend confirmation with suggested order
                self._set_conversation_state(
                    phone,
                    "awaiting_friend_suggestion_response",
                    {
                        "primary_name": primary_name,
                        "primary_order": primary_order,
                        "friend_name": friend_name,
                        "friend_order": friend_order,
                        "group_orders": group_orders,
                        "station_id": station_id,
                    },
                )

                return (
                    f"I see {friend_name} usually orders: {order_summary}\n"
                    f"Would you like to order this again? (Reply YES or tell me what {friend_name} would like instead)"
                )

        except Exception as e:
            logger.error(f"Error checking for previous friend order: {str(e)}")
            # Continue as if no previous order was found - not critical

        # If no previous order or error occurred, move to coffee type state for friend's order
        self._set_conversation_state(
            phone,
            "awaiting_friend_coffee_type",
            {
                "primary_name": primary_name,
                "primary_order": primary_order,
                "friend_name": friend_name,
                "group_orders": group_orders,
                "station_id": station_id,
            },
        )

        return f"Thanks! What type of coffee would {friend_name} like?"

    def _handle_awaiting_friend_suggestion_response(self, phone, message, state):
        """Handle response to friend's suggested previous order"""
        message_upper = message.upper().strip()

        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        friend_order = state.get("temp_data", {}).get("friend_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Check if this is an affirmative response (YES to suggested order)
        if self.nlp.is_affirmative_response(message):
            # They want to use the suggested order - proceed to confirmation
            updated_group_orders = group_orders.copy()
            updated_group_orders.append(friend_order)

            self._set_conversation_state(
                phone,
                "awaiting_friend_confirmation",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "friend_name": friend_name,
                    "friend_order": friend_order,
                    "group_orders": updated_group_orders,
                    "station_id": station_id,
                },
            )

            # Format order summary
            order_summary = self.nlp.format_order_summary(friend_order)

            return (
                f"Great! Here's the order for {friend_name}: {order_summary}\n"
                f"Would you like to confirm this order? (Reply YES to confirm, NO to cancel, or EDIT to change it)"
            )

        else:
            # They want to specify a different order
            # Treat the response as a coffee type and continue the normal flow
            self._set_conversation_state(
                phone,
                "awaiting_friend_coffee_type",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "friend_name": friend_name,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )

            # Process their message as a coffee type
            return self._handle_awaiting_friend_coffee_type(phone, message, state)

    def _handle_awaiting_friend_coffee_type(self, phone, message, state):
        """Handle friend's coffee type during group ordering"""
        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Parse message; do not silently default missing fields.
        order_details = self.nlp.parse_order(message, apply_defaults=False)

        if "type" not in order_details:
            return f"I'm not sure what coffee {friend_name} would like. Please specify a coffee type like latte, cappuccino, flat white, etc."

        # Black coffees don't need milk
        if self.nlp.is_black_coffee(order_details["type"]):
            order_details["milk"] = "no milk"

        if station_id:
            order_details["station_id"] = station_id
            order_details["stationId"] = station_id

        shared_state = {
            "primary_name": primary_name,
            "primary_order": primary_order,
            "friend_name": friend_name,
            "friend_order": order_details,
            "group_orders": group_orders,
            "station_id": station_id,
        }

        # Step through missing fields one at a time (same as the primary
        # ordering flow) so customers can correct typos before the order
        # is committed. Unspecified milk defaults to standard dairy
        # (teas: no milk), shown in the read-back — kept in sync with
        # the primary flow (Steve, 2026-07-21).
        if "milk" not in order_details:
            if "tea" in str(order_details.get("type", "")).lower():
                order_details["milk"] = "no milk"
            else:
                order_details["milk"] = self._default_milk()

        milk = order_details["milk"]
        milk_phrase = "" if milk == "no milk" else f" with {milk} milk"

        if "size" not in order_details:
            self._set_conversation_state(phone, "awaiting_friend_size", shared_state)
            return f"Got it — {order_details['type']}{milk_phrase} for {friend_name}. What size? (small, medium, large)"

        # Skip the sugar prompt to match the main order flow — default to no
        # sugar (shown in the summary; the customer can still EDIT).
        order_details.setdefault("sugar", "no sugar")

        # Order is complete — confirm
        updated_group_orders = group_orders.copy()
        updated_group_orders.append(order_details)
        shared_state["group_orders"] = updated_group_orders
        self._set_conversation_state(
            phone, "awaiting_friend_confirmation", shared_state
        )
        order_summary = self.nlp.format_order_summary(order_details)
        return (
            f"For {friend_name}: {order_summary}.\n"
            f"Reply YES to confirm, EDIT to change, or NO to cancel."
        )

    def _handle_awaiting_friend_milk(self, phone, message, state):
        """Handle friend's milk type during group ordering"""
        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        friend_order = state.get("temp_data", {}).get("friend_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Parse milk preference
        if message.lower() == "no milk" or message.lower() == "black":
            milk_type = "no milk"
        else:
            # Use NLP to extract milk type
            new_details = self.nlp.parse_order(message)
            milk_type = new_details.get("milk", None)

        # If milk type was provided, update order details
        if milk_type:
            friend_order["milk"] = milk_type

            # Update state and move to size
            self._set_conversation_state(
                phone,
                "awaiting_friend_size",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "friend_name": friend_name,
                    "friend_order": friend_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )

            return f"What size {friend_order.get('type', 'coffee')} would {friend_name} like? (small, medium, large)"
        else:
            # If no milk type was found, prompt again
            return f"I didn't recognize that milk type. Please choose from: full cream, skim, soy, almond, oat, lactose free, or no milk."

    def _handle_awaiting_friend_size(self, phone, message, state):
        """Handle friend's size preference during group ordering"""
        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        friend_order = state.get("temp_data", {}).get("friend_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Use NLP to extract size
        new_details = self.nlp.parse_order(message)
        size = new_details.get("size")

        # Also check for simple size indicators
        if not size:
            message_lower = message.lower().strip()
            if message_lower in ["s", "small", "sm"]:
                size = "small"
            elif message_lower in ["m", "medium", "med", "regular", "standard"]:
                size = "medium"
            elif message_lower in ["l", "large", "lg", "big"]:
                size = "large"

        # If size was provided, update order details
        if size:
            friend_order["size"] = size
            # Skip the sugar prompt (match the main flow): default no sugar and
            # go straight to confirmation, where the customer can EDIT.
            friend_order.setdefault("sugar", "no sugar")
            updated_group_orders = group_orders.copy()
            updated_group_orders.append(friend_order)
            self._set_conversation_state(
                phone,
                "awaiting_friend_confirmation",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "friend_name": friend_name,
                    "friend_order": friend_order,
                    "group_orders": updated_group_orders,
                    "station_id": station_id,
                },
            )
            order_summary = self.nlp.format_order_summary(friend_order)
            return (
                f"For {friend_name}: {order_summary}.\n"
                f"Reply YES to confirm, EDIT to change, or NO to cancel."
            )
        else:
            # If no size was found, prompt again
            return f"I didn't recognize that size. Please choose small, medium, or large for {friend_name}'s coffee."

    def _handle_awaiting_friend_sugar(self, phone, message, state):
        """Handle friend's sugar preference during group ordering"""
        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        friend_order = state.get("temp_data", {}).get("friend_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        # Handle common "no sugar" responses
        message_lower = message.lower().strip()
        if message_lower in [
            "no",
            "none",
            "zero",
            "0",
            "n",
            "no sugar",
            "without sugar",
        ]:
            sugar = "no sugar"
        elif message_lower in ["1", "one", "one sugar", "1 sugar"]:
            sugar = "1 sugar"
        elif message_lower in ["2", "two", "two sugar", "2 sugar"]:
            sugar = "2 sugar"
        elif message_lower in ["3", "three", "three sugar", "3 sugar"]:
            sugar = "3 sugar"
        else:
            new_details = self.nlp.parse_order(message, apply_defaults=False)
            sugar = new_details.get("sugar")

        if not sugar:
            return f"Sorry, I didn't catch how much sugar for {friend_name}. Reply 'none', '1', '2', '3', or 'half'."

        # Update order details
        friend_order["sugar"] = sugar

        # Add friend's order to the group
        updated_group_orders = group_orders.copy()
        updated_group_orders.append(friend_order)

        # Update state and move to confirmation
        self._set_conversation_state(
            phone,
            "awaiting_friend_confirmation",
            {
                "primary_name": primary_name,
                "primary_order": primary_order,
                "friend_name": friend_name,
                "friend_order": friend_order,
                "group_orders": updated_group_orders,
                "station_id": station_id,
            },
        )

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
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get(
            "station_id", 1
        )  # Default to station 1 if not set

        # Handle different responses
        if (
            message_upper == "NO"
            or message_upper == "N"
            or message_upper == "FINISH"
            or message_upper == "DONE"
            or message_upper == "END"
        ):
            # User wants to end the conversation
            total_orders = len(group_orders) + 1  # +1 for the primary order
            self._set_conversation_state(phone, "completed")
            if total_orders > 1:
                total_line = self._format_group_total(
                    [primary_order] + list(group_orders)
                )
                return (
                    f"Thanks, {primary_name}! Your group order of {total_orders} coffees has been confirmed."
                    f"{total_line}\nThey'll be ready together - we'll SMS you the pickup location."
                )
            else:
                return f"Thanks, {primary_name}! Your order has been confirmed.\nWe'll SMS you when it's ready with the pickup location."

        elif (
            message_upper == "FRIEND"
            or message_upper == "YES"
            or message_upper == "Y"
            or "FRIEND" in message_upper
            or message_upper == "ANOTHER"
        ):
            # Start another order for a different friend
            self._set_conversation_state(
                phone,
                "awaiting_friend_name",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )
            return "Great! Let's add another coffee. What's your friend's name?"

        else:
            # Unrecognized response - prompt again
            return "Please reply FRIEND to order for another friend, or NO to finish."

    def _handle_awaiting_friend_confirmation(self, phone, message, state):
        """Handle friend order confirmation during group ordering"""
        message_upper = message.upper().strip()

        # Get data from state
        primary_name = state.get("temp_data", {}).get("primary_name", "")
        primary_order = state.get("temp_data", {}).get("primary_order", {})
        friend_name = state.get("temp_data", {}).get("friend_name", "")
        friend_order = state.get("temp_data", {}).get("friend_order", {})
        group_orders = state.get("temp_data", {}).get("group_orders", [])
        station_id = state.get("temp_data", {}).get("station_id")

        if message_upper == "YES" or message_upper == "Y":
            # Stamp the shared group_id so this friend's order is linked to the
            # customer's own. Prefer the value carried in state; if it got
            # dropped between friend-flow steps, derive it from the EARLIEST
            # recent order for this phone (that's the primary) and back-fill it.
            group_id = state.get("temp_data", {}).get("group_id")
            group_label = state.get("temp_data", {}).get("group_label")
            if not group_id:
                try:
                    gc = self.db.cursor()
                    gc.execute(
                        """
                        SELECT order_number, order_details FROM orders
                        WHERE phone = %s AND created_at > %s
                        ORDER BY created_at ASC LIMIT 1
                    """,
                        (phone, datetime.now() - timedelta(hours=1)),
                    )
                    gr = gc.fetchone()
                    if gr:
                        group_id = gr[0]
                        pdetails = (
                            gr[1] if not isinstance(gr[1], str) else json.loads(gr[1])
                        )
                        group_label = (pdetails or {}).get(
                            "group_label"
                        ) or f"{primary_name}'s group"
                except Exception as ge:
                    logger.warning(
                        f"Could not derive group_id for friend order (non-fatal): {ge}"
                    )
            if group_id:
                friend_order["group_id"] = group_id
                if group_label:
                    friend_order["group_label"] = group_label
                # Make sure the primary carries the same group_id (idempotent).
                self._ensure_group_id_on_order(
                    order_number=group_id,
                    group_id=group_id,
                    group_label=group_label,
                )

            # Confirm the order for the friend (mark it as a friend order)
            order_response = self._confirm_order(
                phone, friend_order, friend_name, is_friend_order=True
            )

            # Store friend's order preferences for future ordering
            try:
                cursor = self.db.cursor()
                cursor.execute(
                    """
                    INSERT INTO customer_preferences
                    (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, last_order_date, is_friend_of, friend_phone)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (phone, name) DO UPDATE SET
                        preferred_drink = EXCLUDED.preferred_drink,
                        preferred_milk = EXCLUDED.preferred_milk,
                        preferred_size = EXCLUDED.preferred_size,
                        preferred_sugar = EXCLUDED.preferred_sugar,
                        last_order_date = EXCLUDED.last_order_date
                """,
                    (
                        f"{phone}_{friend_name}",  # Use a composite key to store friend orders
                        friend_name,
                        friend_order.get("type"),
                        friend_order.get("milk"),
                        friend_order.get("size"),
                        friend_order.get("sugar"),
                        datetime.now(),
                        primary_name,
                        phone,
                    ),
                )
                self.db.commit()
                logger.info(f"Stored friend preferences for {friend_name}")
            except Exception as e:
                logger.error(f"Error storing friend preferences: {str(e)}")
                # Continue even if this fails - it's non-critical

            # Ask if they want to order for another friend
            # Set state to a special "awaiting_friend_decision" state to handle the response
            self._set_conversation_state(
                phone,
                "awaiting_friend_decision",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )
            total_so_far = len(group_orders) + 1  # +1 for the primary order
            return (
                f"{order_response}\n\n"
                f"That's {total_so_far} coffees in your group order.\n"
                f"Reply FRIEND to add another or NO to finish."
            )

        elif message_upper == "NO" or message_upper == "N" or message_upper == "CANCEL":
            # Cancel the friend's order but keep the group context
            self._set_conversation_state(
                phone,
                "awaiting_friend_name",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )
            return f"Order for {friend_name} cancelled. What's the name of another friend you'd like to order for? (or type DONE to finish)"

        elif message_upper == "EDIT" or message_upper == "CHANGE":
            # Allow editing the friend's order - go back to coffee type
            self._set_conversation_state(
                phone,
                "awaiting_friend_coffee_type",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "friend_name": friend_name,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )
            return f"Let's change {friend_name}'s order. What type of coffee would {friend_name} like?"

        elif (
            message_upper == "FRIEND"
            or message_upper == "ANOTHER"
            or "FRIEND" in message_upper
        ):
            # Start another order for a different friend
            self._set_conversation_state(
                phone,
                "awaiting_friend_name",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                },
            )
            return "Great! Let's add another coffee. What's your friend's name?"

        elif (
            message_upper == "DONE"
            or message_upper == "FINISH"
            or message_upper == "END"
        ):
            # Finish the group ordering process
            total_orders = len(group_orders) + 1  # +1 for the primary order
            self._set_conversation_state(phone, "completed")
            total_line = self._format_group_total([primary_order] + list(group_orders))
            return (
                f"Thanks, {primary_name}! Your group order of {total_orders} coffees has been confirmed."
                f"{total_line}\nThey'll be ready together - we'll SMS you the pickup location."
            )

        else:
            # Unrecognized response - prompt again
            return f"Please reply YES to confirm {friend_name}'s order, NO to cancel, EDIT to change it, or DONE to finish the group order."

    def _ensure_group_id_on_order(
        self, order_id=None, order_number=None, group_id=None, group_label=None
    ):
        """Retro-stamp group_id/group_label onto an already-created order's
        order_details JSON. Used to fold the FIRST order of a group (the
        customer's own / primary) into the group once a sibling is added.
        Idempotent and best-effort — never raises into the SMS flow."""
        if not group_id or (order_id is None and not order_number):
            return
        try:
            cur = self.db.cursor()
            if order_id is not None:
                cur.execute(
                    "SELECT order_details FROM orders WHERE id = %s", (order_id,)
                )
            else:
                cur.execute(
                    "SELECT order_details FROM orders WHERE order_number = %s",
                    (order_number,),
                )
            row = cur.fetchone()
            if not row or not row[0]:
                return
            details = row[0]
            if isinstance(details, str):
                details = json.loads(details)
            if not isinstance(details, dict):
                return
            if details.get("group_id") == group_id:
                return  # already linked
            details["group_id"] = group_id
            if group_label:
                details["group_label"] = group_label
            if order_id is not None:
                cur.execute(
                    "UPDATE orders SET order_details = %s WHERE id = %s",
                    (json.dumps(details), order_id),
                )
            else:
                cur.execute(
                    "UPDATE orders SET order_details = %s WHERE order_number = %s",
                    (json.dumps(details), order_number),
                )
            self.db.commit()
            logger.info(
                f"Linked order {order_number or order_id} into group {group_id}"
            )
        except Exception as e:
            logger.warning(f"_ensure_group_id_on_order failed (non-fatal): {e}")
            try:
                self.db.rollback()
            except Exception:
                pass

    def _confirm_order(self, phone, order_details, name, is_friend_order=False):
        """Confirm and process the order"""
        # Intake gate. Checked HERE rather than at the top of handle_sms so
        # that STATUS and CANCEL keep working while ordering is stopped —
        # a customer who already has a drink in the queue still needs to be
        # able to ask about it or cancel it.
        from utils.order_intake import intake_blocked_reason

        _blocked = intake_blocked_reason(self.db)
        if _blocked:
            logger.info("SMS order from %s refused: intake gate is closed", phone)
            return _blocked

        # Stash the computed price on the order_details blob so the
        # barista UI can show "what to charge" without having to
        # re-compute. No-op when pricing is disabled.
        try:
            price_value, price_formatted = self._compute_order_price(order_details)
            if price_value is not None:
                order_details["price"] = price_value
                order_details["price_formatted"] = price_formatted
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
            db_type = (
                "sqlite" if isinstance(fresh_conn, sqlite3.Connection) else "postgres"
            )
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
            event_prefix = ""
            try:
                prefix_cur = fresh_conn.cursor()
                prefix_cur.execute(
                    "SELECT value FROM settings WHERE key = 'order_prefix'"
                )
                prefix_row = prefix_cur.fetchone()
                prefix_cur.close()
                if prefix_row and prefix_row[0]:
                    import json as _json

                    try:
                        parsed = (
                            _json.loads(prefix_row[0])
                            if isinstance(prefix_row[0], str)
                            else prefix_row[0]
                        )
                        if isinstance(parsed, dict):
                            event_prefix = (parsed.get("prefix") or "").strip()
                        elif isinstance(parsed, str):
                            event_prefix = parsed.strip()
                    except Exception:
                        event_prefix = ""
            except Exception:
                event_prefix = ""

            if db_type != "sqlite":
                try:
                    seq_cursor = fresh_conn.cursor()
                    seq_cursor.execute("SELECT nextval('order_number_seq')")
                    seq_row = seq_cursor.fetchone()
                    seq_cursor.close()
                    if seq_row:
                        seq_val = (
                            seq_row[0]
                            if not isinstance(seq_row, dict)
                            else list(seq_row.values())[0]
                        )
                        order_number = f"{event_prefix}{int(seq_val)}"
                except Exception as seq_err:
                    logger.info(
                        f"order_number_seq unavailable, using legacy format: {seq_err}"
                    )
                    try:
                        fresh_conn.rollback()
                    except Exception:
                        pass

            if not order_number:
                # Legacy fallback — keeps SQLite test path working.
                legacy_prefix = "A" if now.hour < 12 else "P"
                order_number = (
                    f"{legacy_prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"
                )

            # Check for station assignment in the order details
            specified_station = order_details.get("station_id") or order_details.get(
                "stationId"
            )

            # A saved-VIP customer's orders are ALL VIP — not just the one
            # placed right after they enter the code. Before this, the vip flag
            # came only from the in-conversation state, so a VIP's later orders
            # dropped back to normal priority and lost the "VIP orders are free"
            # comp. (Only the customer's OWN orders inherit it — not coffees
            # they order for friends.)
            if not is_friend_order and not order_details.get("vip"):
                try:
                    _vc = self.db.cursor()
                    _vc.execute(
                        "SELECT is_vip FROM customer_preferences WHERE phone = %s",
                        (phone,),
                    )
                    _vr = _vc.fetchone()
                    if _vr and _vr[0]:
                        order_details["vip"] = True
                        logger.info(
                            f"Order flagged VIP from saved customer status for {phone}"
                        )
                except Exception as _ve:
                    logger.warning(f"VIP-customer lookup failed (non-fatal): {_ve}")

            # Assign station based on available information
            is_vip = order_details.get("vip", False)
            milk_type = order_details.get("milk")

            # Track whether the customer's chosen station got changed so we
            # can tell them in the confirmation message instead of silently
            # routing the order somewhere else.
            requested_station_id = None
            station_was_reassigned = False
            reassign_reason = None  # 'capability' | 'invalid' — shapes the SMS note

            if specified_station:
                try:
                    requested_station_id = int(specified_station)
                    # A station is specified (customer asked, QR context, or a
                    # station carried over from the conversation/last order).
                    # Honour it ONLY if it can actually make this order — else
                    # an oat order tagged to a full-cream-only station got
                    # stranded there because this path skipped the milk-aware
                    # router. If it can't make it, reassign to one that can.
                    if self._station_can_make(
                        requested_station_id, milk_type, order_details.get("size")
                    ):
                        station_id = requested_station_id
                        is_delayed = False
                        logger.info(
                            f"Using specified station {station_id} from order details"
                        )
                    else:
                        station_id, is_delayed = self._assign_station(
                            is_vip,
                            milk_type,
                            order_details.get("type"),
                            order_details.get("size"),
                        )
                        if station_id is None:
                            if milk_type and self._has_active_station():
                                logger.warning(
                                    f"No active station can make {milk_type}; re-asking customer for milk"
                                )
                                return self._no_capable_milk_message(
                                    phone, name, order_details
                                )
                            logger.error("No stations available to assign order")
                            return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                        station_was_reassigned = True
                        reassign_reason = "capability"
                        logger.info(
                            f"Specified station {requested_station_id} can't make this order (milk/size); reassigned to station {station_id}"
                        )
                except (ValueError, TypeError):
                    requested_station_id = specified_station
                    station_id, is_delayed = self._assign_station(
                        is_vip,
                        milk_type,
                        order_details.get("type"),
                        order_details.get("size"),
                    )
                    if station_id is None:
                        if milk_type and self._has_active_station():
                            logger.warning(
                                f"No active station can make {milk_type}; re-asking customer for milk"
                            )
                            return self._no_capable_milk_message(
                                phone, name, order_details
                            )
                        logger.error("No stations available to assign order")
                        return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                    station_was_reassigned = True
                    reassign_reason = "invalid"
                    logger.info(
                        f"Invalid station {requested_station_id} specified, reassigned to station {station_id}"
                    )
            else:
                # Use advanced station assignment if no station specified
                station_id, is_delayed = self._assign_station(
                    is_vip,
                    milk_type,
                    order_details.get("type"),
                    order_details.get("size"),
                )
                if station_id is None:
                    # No station could take this order. If it's because no active
                    # station can make the requested MILK, ask the customer for a
                    # milk we can make (parking the conversation so their reply
                    # continues this order) — never silently confirm it onto a
                    # station that can't make it. This is the #165 fix.
                    if milk_type and self._has_active_station():
                        logger.warning(
                            f"No active station can make {milk_type}; re-asking customer for milk"
                        )
                        return self._no_capable_milk_message(phone, name, order_details)
                    logger.error("No stations available to assign order")
                    return "Sorry, no coffee stations are currently available. Please contact the organizer to set up stations."
                logger.info(
                    f"No station specified, using intelligent assignment to station {station_id}"
                )

            # Sanity-check required fields. If anything is missing at this
            # point, the conversation state machine has a bug — fail loudly
            # rather than silently filling in defaults that the customer
            # never agreed to.
            missing_required = [
                f for f in ("type", "milk", "size", "sugar") if f not in order_details
            ]
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
                "name": name,
                "type": order_details["type"],
                "milk": order_details["milk"],
                "size": order_details["size"],
                "sugar": order_details["sugar"],
                "station_id": station_id,
                "stationId": station_id,
                "assigned_to_station": station_id,
                "assignedStation": station_id,
            }
            # Provenance. This is the SMS path -- the one channel that
            # never marked itself, which is why every unmarked historical
            # order reads as SMS. Stamped on processed_details, which is
            # the dict that actually gets serialised into the row.
            stamp_provenance(processed_details, "sms")
            if station_was_reassigned:
                processed_details["requested_station_id"] = requested_station_id
                processed_details["station_was_reassigned"] = True

            if "strength" in order_details:
                processed_details["strength"] = order_details["strength"]

            if "temp" in order_details:
                processed_details["temp"] = order_details["temp"]

            if "notes" in order_details:
                processed_details["notes"] = order_details["notes"]

            # Price (stashed at the top of _confirm_order) and decaf/shots
            # must survive this allow-list rebuild — the barista card reads
            # them from the STORED details. price was computed, shown in the
            # SMS, then dropped right here, so the card never knew what to
            # charge (Test Bench pricing round-trip).
            for _carry in ("price", "price_formatted", "decaf", "shots"):
                if _carry in order_details:
                    processed_details[_carry] = order_details[_carry]

            # Group link — when this order is part of a group (a multi-drink
            # SMS or a FRIEND order), carry the shared group_id + label so the
            # barista UI can show "these go together" and start/collect them as
            # one. group_id is the primary order's number (e.g. "C5").
            if order_details.get("group_id"):
                processed_details["group_id"] = order_details.get("group_id")
                if order_details.get("group_label"):
                    processed_details["group_label"] = order_details.get("group_label")

            # Handle delayed orders (scheduled for next break)
            if is_delayed:
                processed_details["delayed"] = True
                processed_details["scheduled_for_next_break"] = True
                logger.info(f"Order for {name} will be delayed until next break")

            # Check if this is a VIP order and set appropriate priority
            # Priority 1: VIP orders
            # Priority 5-9: Regular orders (with time-based priority to ensure older orders stay ahead)
            if order_details.get("vip", False):
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

                logger.info(
                    f"Assigned queue priority {queue_priority} to non-VIP order at {hour}:{minute:02d}"
                )

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
                    cursor.execute(
                        """
                        INSERT INTO orders 
                        (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                        (
                            order_number,
                            phone,
                            json.dumps(processed_details),
                            "pending",
                            station_id,
                            now,
                            now,
                            queue_priority,
                        ),
                    )
                    fresh_conn.commit()

                    # Get the ID of the inserted row
                    cursor.execute("SELECT last_insert_rowid()")
                    order_id = cursor.fetchone()[0]
                else:
                    cursor.execute(
                        """
                        INSERT INTO orders 
                        (order_number, phone, order_details, status, station_id, created_at, updated_at, queue_priority)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id
                    """,
                        (
                            order_number,
                            phone,
                            json.dumps(processed_details),
                            "pending",
                            station_id,
                            now,
                            now,
                            queue_priority,
                        ),
                    )
                    result = cursor.fetchone()

                    # Handle different result formats
                    if isinstance(result, dict):
                        order_id = result.get("id")
                    elif isinstance(result, (list, tuple)) and len(result) > 0:
                        order_id = result[0]

                    fresh_conn.commit()

                logger.info(f"Created order {order_number} with ID {order_id}")

                # Stamp the created identifiers back onto the caller's dict so
                # group flows (multi-drink, FRIEND) can read what was actually
                # created — the order number to use as a group key, the DB id to
                # retro-link siblings, and the station so every order in the
                # group lands at the same bar.
                try:
                    order_details["_created_order_number"] = order_number
                    order_details["_created_order_id"] = order_id
                    order_details["_created_station_id"] = station_id
                except Exception:
                    pass

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

                    socketio = _ca.config.get("socketio") if _ca else None
                    if socketio:
                        new_order_payload = {
                            "order_number": order_number,
                            "id": order_number,
                            "status": "pending",
                            "station_id": station_id,
                            "stationId": station_id,
                            # See identical comment in consolidated_api_routes:
                            # 'Z' suffix forces browser to parse as UTC,
                            # avoiding the 9.5h AEST offset Steve hit.
                            "created_at": now.isoformat() + "Z"
                            if hasattr(now, "isoformat")
                            else str(now),
                            "createdAt": now.isoformat() + "Z"
                            if hasattr(now, "isoformat")
                            else str(now),
                            "wait_time": 0,
                            "waitTime": 0,
                            "customer_name": processed_details.get("name"),
                            "customerName": processed_details.get("name"),
                            "coffee_type": processed_details.get("type"),
                            "coffeeType": processed_details.get("type"),
                            "milk_type": processed_details.get("milk"),
                            "milkType": processed_details.get("milk"),
                            "sugar": processed_details.get("sugar"),
                            "size": processed_details.get("size"),
                            "vip": processed_details.get("vip", False),
                        }
                        socketio.emit("order_created", new_order_payload, room="orders")
                        if station_id is not None:
                            socketio.emit(
                                "new_order",
                                new_order_payload,
                                room=f"station_{station_id}",
                            )
                except Exception as ws_err:
                    # Never let WS failures break the order flow.
                    logger.debug(f"WS new-order emit skipped (SMS path): {ws_err}")

            except Exception as order_error:
                logger.error(f"Error creating order: {str(order_error)}")
                try:
                    fresh_conn.rollback()
                except Exception as rollback_error:
                    logger.error(
                        f"Error rolling back after order creation failure: {str(rollback_error)}"
                    )
                return "Sorry, we encountered an error processing your order. Please try again or visit the coffee station directly."

            # Step 2: Update customer preferences ONLY if this is NOT a friend order
            # When ordering for a friend, don't overwrite the customer's own preferences
            if not is_friend_order:
                try:
                    # Extract decaf-ness from the drink type so "decaf flat white"
                    # is stored as type="flat white" with decaf=True. Without
                    # this, the next visit drops the decaf and a regular has
                    # to re-specify every time.
                    raw_type = (processed_details.get("type") or "").strip()
                    decaf_flag = False
                    bare_type = raw_type
                    lower_type = raw_type.lower()
                    if lower_type.startswith("decaf "):
                        decaf_flag = True
                        bare_type = raw_type[6:].strip()
                    elif lower_type.startswith("decaffeinated "):
                        decaf_flag = True
                        bare_type = raw_type[14:].strip()
                    preferred_strength = processed_details.get("strength")

                    # Check if customer exists
                    if db_type == "sqlite":
                        cursor.execute(
                            "SELECT name FROM customer_preferences WHERE phone = ?",
                            (phone,),
                        )
                    else:
                        cursor.execute(
                            "SELECT name FROM customer_preferences WHERE phone = %s",
                            (phone,),
                        )

                    # Get result based on cursor type
                    if db_type == "sqlite":
                        result = cursor.fetchone()
                    else:
                        result = cursor.fetchone()

                    if result:
                        # Update existing customer but DON'T change their name
                        # Only update their drink preferences with their own order
                        if db_type == "sqlite":
                            cursor.execute(
                                """
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
                            """,
                                (
                                    bare_type,
                                    processed_details.get("milk"),
                                    processed_details.get("size"),
                                    processed_details.get("sugar"),
                                    preferred_strength,
                                    1 if decaf_flag else 0,
                                    now,
                                    phone,
                                ),
                            )
                        else:
                            cursor.execute(
                                """
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
                            """,
                                (
                                    bare_type,
                                    processed_details.get("milk"),
                                    processed_details.get("size"),
                                    processed_details.get("sugar"),
                                    preferred_strength,
                                    decaf_flag,
                                    now,
                                    phone,
                                ),
                            )
                    else:
                        # Create new customer
                        if db_type == "sqlite":
                            cursor.execute(
                                """
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar,
                             preferred_strength, preferred_decaf,
                             first_order_date, last_order_date, total_orders)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                                (
                                    phone,
                                    name,
                                    bare_type,
                                    processed_details.get("milk"),
                                    processed_details.get("size"),
                                    processed_details.get("sugar"),
                                    preferred_strength,
                                    1 if decaf_flag else 0,
                                    now,
                                    now,
                                    1,
                                ),
                            )
                        else:
                            cursor.execute(
                                """
                            INSERT INTO customer_preferences
                            (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar,
                             preferred_strength, preferred_decaf,
                             first_order_date, last_order_date, total_orders)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                                (
                                    phone,
                                    name,
                                    bare_type,
                                    processed_details.get("milk"),
                                    processed_details.get("size"),
                                    processed_details.get("sugar"),
                                    preferred_strength,
                                    decaf_flag,
                                    now,
                                    now,
                                    1,
                                ),
                            )

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
                processed_details["_stock_decremented"] = True
                try:
                    upd = fresh_conn.cursor()
                    if db_type == "sqlite":
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
                    logger.warning(
                        f"Could not persist _stock_decremented flag: {upd_err}"
                    )
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
                self._set_conversation_state(phone, "completed")
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
            requested_milk = (processed_details.get("milk") or "").lower()

            if requested_milk and requested_milk != "no milk" and db_type != "sqlite":
                try:
                    cursor.execute("SAVEPOINT milk_uniq_probe")
                    cursor.execute(
                        """
                        SELECT COUNT(DISTINCT station_id) AS station_count
                        FROM station_stats
                        WHERE capabilities IS NOT NULL
                          AND (capabilities->'milk_types') ? %s
                    """,
                        (requested_milk,),
                    )

                    result = cursor.fetchone()
                    if result:
                        count_val = (
                            result[0]
                            if not isinstance(result, dict)
                            else (
                                result.get("station_count") or list(result.values())[0]
                            )
                        )
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
            if order_details.get("vip"):
                # VIP orders jump the queue — don't quote a misleading "#N in
                # line" position. (Hyphen, not em-dash, to stay GSM-7.)
                position_line = (
                    "VIP order - we'll prioritise it and text you when it's ready."
                )
            elif queue_position is not None and queue_position > 0:
                position_line = (
                    # Hyphen, not an em-dash: '—' isn't in GSM-7 and would push
                    # the whole SMS to UCS-2 (70-char segments).
                    f"You're #1 in line, starting shortly."
                    if queue_position == 1
                    else f"You're #{queue_position} in line (~{wait_time} min wait)."
                )
            else:
                position_line = f"Estimated wait time: {wait_time} minutes."

            # Build the confirmation message. No emoji — an emoji forces the
            # SMS into UCS-2 (70-char segments instead of 160), doubling cost.
            if milk_is_unique and unique_station_info:
                # Show station immediately if it's the only one with this milk
                confirmation_message = (
                    f"Order #{order_number} confirmed. "
                    f"{processed_details.get('milk').title()} is at {station_label(self.db, station_id)} only. "
                    f"{position_line}"
                )
            else:
                # Standard message - don't show station immediately. Keep it
                # to one segment; the recap (auto-place) and the ready SMS that
                # follows both make clear they'll be texted.
                confirmation_message = (
                    f"Order #{order_number} confirmed. {position_line}"
                )

            # If the customer asked for a specific station but we had to
            # reassign (invalid station number, capacity, etc.) let them know
            # — silently routing the order elsewhere has caused confusion.
            if station_was_reassigned:
                if reassign_reason == "capability":
                    confirmation_message += (
                        f"\n\nNote: {station_label(self.db, requested_station_id)} can't make this order, "
                        f"so it was routed to {station_label(self.db, station_id)}."
                    )
                else:
                    confirmation_message += (
                        f"\n\nNote: {station_label(self.db, requested_station_id)} isn't available right now, "
                        f"so your order was routed to {station_label(self.db, station_id)}."
                    )

            # Add tracking URL if enabled
            if self._get_setting("enable_web_tracking", "false").lower() in (
                "true",
                "yes",
                "1",
            ):
                try:
                    base_url = self._get_setting(
                        "web_tracking_url", "https://coffee.example.com/track/"
                    )
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

    def _batch_costation(self, candidates, coffee_type, milk_type):
        """Batch-aware routing tiebreak: if a candidate station already has a
        PENDING identical drink (same type + milk, recent), prefer it — two
        lattes made side by side let the barista steam ONE jug / pull one
        double shot. Only when that station isn't meaningfully busier than
        the least-loaded option (load within +1), so batching never causes a
        pile-up. Returns the preferred station dict or None.

        Found by the pipeline tracer: identical orders seconds apart were
        being SPREAD across stations by pure load-balancing, which silently
        defeated the whole batching feature."""
        if not candidates or not coffee_type:
            return None
        try:
            cursor = self.db.cursor()
            # SAVEPOINT so a failure here can NEVER poison the caller's
            # in-flight transaction — _assign_station keeps reading station
            # data after this, and an aborted transaction would crash it
            # into the kiosk's dumb first-capable fallback (full-sweep
            # regression: break-window orders landed on CLOSED stations).
            cursor.execute("SAVEPOINT batch_twin")
            try:
                cursor.execute(
                    "SELECT DISTINCT station_id FROM orders "
                    "WHERE status = 'pending' "
                    "AND created_at > NOW() - INTERVAL '30 minutes' "
                    "AND LOWER(order_details->>'type') = %s "
                    "AND LOWER(COALESCE(order_details->>'milk','')) = %s",
                    (str(coffee_type).lower(), str(milk_type or "").lower()),
                )
                with_twin = {
                    int(r[0]) for r in cursor.fetchall() if r and r[0] is not None
                }
                cursor.execute("RELEASE SAVEPOINT batch_twin")
            except Exception:
                cursor.execute("ROLLBACK TO SAVEPOINT batch_twin")
                return None
        except Exception:
            return None
        if not with_twin:
            return None
        min_load = min(s["load"] for s in candidates)
        for s in sorted(candidates, key=lambda x: x["load"]):
            if s["id"] in with_twin and s["load"] <= min_load + 1:
                return s
        return None

    def _assign_station(
        self, is_vip=False, milk_type=None, coffee_type=None, size=None
    ):
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
            # 'no milk' is not a milk requirement — normalising it away up
            # front keeps every downstream milk filter honest. Left in, the
            # ".replace(' milk','')" canonicalisers turned it into the
            # phantom milk 'no', no station "stocked" it, and every long
            # black was refused (full-sweep regression, matrix mx07).
            if milk_type and str(milk_type).strip().lower() in (
                "no milk",
                "none",
                "black",
            ):
                milk_type = None

            # Clear any ABORTED transaction left by an earlier failure on this
            # shared connection. Without this, every query below dies with
            # InFailedSqlTransaction and the outer except's last-resort
            # 'station 1' fallback fires — the bench caught an almond order
            # landing on a no-almond station exactly this way (run 4).
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()

            # Log station assignment request
            logger.info(
                f"Station assignment requested: VIP={is_vip}, milk_type={milk_type}"
            )

            # First check if we're in a break period or not
            current_time = datetime.now()
            current_hour = current_time.hour
            current_minute = current_time.minute
            current_day = current_time.weekday()  # 0=Monday, 6=Sunday

            # Check for any scheduled breaks that include the current time
            cursor.execute(
                """
                SELECT id, start_time, end_time, stations 
                FROM event_breaks 
                WHERE day_of_week = %s
                ORDER BY start_time
            """,
                (current_day,),
            )

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
                    if hasattr(value, "hour") and hasattr(value, "minute"):
                        return int(value.hour), int(value.minute)
                    return tuple(int(p) for p in str(value).split(":")[:2])

                start_hour, start_minute = _hours(start_str)
                end_hour, end_minute = _hours(end_str)

                # Check if current time is within the break
                if (
                    (current_hour > start_hour)
                    or (current_hour == start_hour and current_minute >= start_minute)
                ) and (
                    (current_hour < end_hour)
                    or (current_hour == end_hour and current_minute <= end_minute)
                ):
                    # We're in a break period now
                    current_break = {
                        "id": break_id,
                        "start": (start_hour, start_minute),
                        "end": (end_hour, end_minute),
                        # event_breaks.stations is JSONB; psycopg2
                        # already deserialises to a list, so don't
                        # double-parse.
                        "stations": stations_json
                        if isinstance(stations_json, list)
                        else (json.loads(stations_json) if stations_json else []),
                    }
                    break

                # Check if this is the next upcoming break
                if (current_hour < start_hour) or (
                    current_hour == start_hour and current_minute < start_minute
                ):
                    next_break = {
                        "id": break_id,
                        "start": (start_hour, start_minute),
                        "end": (end_hour, end_minute),
                        # event_breaks.stations is JSONB; psycopg2
                        # already deserialises to a list, so don't
                        # double-parse.
                        "stations": stations_json
                        if isinstance(stations_json, list)
                        else (json.loads(stations_json) if stations_json else []),
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
            # Real-time load = actual not-yet-collected orders per station.
            # The station_stats.current_load column drifts (it isn't always
            # incremented/decremented in lockstep), which broke load-balancing:
            # identical orders piled onto one station instead of spreading.
            # Counting live orders is authoritative. NOTE: this must run AND be
            # fully fetched BEFORE the station_stats query below — psycopg2 won't
            # let a second cursor run while the first has an unread result, so
            # doing it after silently failed and fell back to current_load.
            real_load = {}
            real_load_ok = False
            try:
                lc = self.db.cursor()
                lc.execute(
                    """
                    SELECT station_id, COUNT(*) FROM orders
                    WHERE status IN ('pending', 'in-progress', 'in_progress')
                    GROUP BY station_id
                """
                )
                for _row in lc.fetchall():
                    if _row and _row[0] is not None:
                        real_load[int(_row[0])] = int(_row[1])
                lc.close()
                real_load_ok = True
            except Exception as _le:
                logger.warning(f"real-load count failed, using current_load: {_le}")

            # Get all stations with their current load and capabilities.
            cursor.execute(
                """
                SELECT station_id, COALESCE(current_load, 0),
                       COALESCE(capabilities, '{}'::jsonb) AS capabilities,
                       COALESCE(status, 'active') AS current_status
                FROM station_stats
                WHERE status IN ('active', 'open') OR status IS NULL
                ORDER BY COALESCE(current_load, 0)
            """
            )

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
                        capabilities = (
                            json.loads(capabilities_value)
                            if capabilities_value and capabilities_value != "{}"
                            else {}
                        )
                    except (json.JSONDecodeError, TypeError):
                        capabilities = {}

                # Set default capabilities for stations that don't have them configured
                if not capabilities:
                    # No capabilities configured → treat as NO RESTRICTION (can
                    # make any milk/coffee/size), matching the SMS milk gate's
                    # fail-open (_milk_is_makeable). The old code injected a
                    # hardcoded 'full cream'+'skim' default here, which silently
                    # stranded oat/soy/almond orders: the gate accepted the milk
                    # (no station defined milk_types → no restriction) but routing
                    # then found no station "with" that milk and dumped the order
                    # on station 1 with a false "confirmed" SMS. Empty lists =
                    # wildcard in order_capable() / the milk filters below.
                    capabilities = {
                        "milk_types": [],
                        "coffee_types": [],
                        "sizes": [],
                        "capacity": 10,
                        "high_volume": False,
                        "vip_service": False,
                    }
                    logger.warning(
                        f"Station {station_id} has no capabilities configured. Treating as no-restriction (can make any order)."
                    )

                # Extract milk types for this station. Missing/empty = no
                # restriction (wildcard), NOT a hardcoded full-cream/skim default
                # — see the capabilities block above.
                milk_types = capabilities.get("milk_types", []) or []

                # Track which stations have this milk
                for milk in milk_types:
                    if milk not in stations_with_milk:
                        stations_with_milk[milk] = []
                    stations_with_milk[milk].append(station_id)

                stations.append(
                    {
                        "id": station_id,
                        # Live order count. A station with no live orders is load 0,
                        # NOT the drifting current_load column — otherwise a stale
                        # high counter makes an idle station look busy and every
                        # order avoids it. Only fall back to current_load if the
                        # count query itself failed.
                        "load": (
                            real_load.get(station_id, 0) if real_load_ok else load
                        ),
                        "capacity": capabilities.get(
                            "capacity", 10
                        ),  # Default capacity if none set
                        "status": status,
                        "capabilities": capabilities,
                        "milk_types": milk_types,
                        "coffee_types": capabilities.get("coffee_types", []),
                        "sizes": capabilities.get("sizes", []),
                        "alt_milk_available": any(
                            m in milk_types
                            for m in ["soy", "almond", "oat", "lactose free", "coconut"]
                        ),
                        "high_volume": capabilities.get("high_volume", False),
                        "vip_service": capabilities.get("vip_service", False),
                    }
                )

            if not stations:
                # No stations found
                logger.error(
                    "No active stations found in database. Orders cannot be assigned."
                )
                logger.error(
                    "Please create stations through the Organizer interface before accepting orders."
                )
                # Return None to indicate no station available
                return None, False

            # ---- Full-capability filter -------------------------------------
            # Routing must consider the WHOLE order — drink type AND size, not
            # just milk. Before this, _assign_station was only passed milk +
            # load, so a mocha (made only at station 2) could be sent to a
            # station that can't make it and sit un-startable. Build a predicate
            # that checks milk + (espresso) coffee type + size against a
            # station's capabilities. Non-espresso drinks (tea/hot choc — not in
            # any station's coffee_types list) aren't gated on coffee type.
            req_milk = (milk_type or "").lower().replace(" milk", "").strip()
            req_coffee = (coffee_type or "").lower().strip()
            if req_coffee.startswith("decaf "):
                req_coffee = req_coffee[6:].strip()
            req_size = (size or "").lower().strip()
            all_coffee_types = set()
            for s in stations:
                for c in s.get("coffee_types") or []:
                    all_coffee_types.add(str(c).lower())

            def order_capable(s):
                # Milk
                if req_milk and req_milk not in ("no milk", "none", ""):
                    mt = [
                        str(m).lower().replace(" milk", "")
                        for m in (s.get("milk_types") or [])
                    ]
                    if mt and req_milk not in mt:
                        return False
                # Coffee type — only gate drinks some station explicitly lists
                # (espresso menu); tea/hot-choc fall through as make-anywhere.
                if req_coffee and req_coffee in all_coffee_types:
                    ct = [str(c).lower() for c in (s.get("coffee_types") or [])]
                    if req_coffee not in ct:
                        return False
                # Size
                if req_size and (s.get("sizes") or []):
                    sz = [str(z).lower() for z in s.get("sizes")]
                    if req_size not in sz:
                        return False
                return True

            # Candidate set = active stations that can make the WHOLE order.
            # Never strand: if none qualify, fall back to all active stations
            # (the barista capability gate is the final backstop).
            _active_all = [s for s in stations if s["status"] == "active"]
            _capable = [s for s in _active_all if order_capable(s)]
            capable_active = _capable if _capable else _active_all

            # First handle VIP logic — among stations that can actually make
            # this order, prefer a VIP-service station, else the least busy.
            if is_vip:
                vip_stations = [s for s in capable_active if s["vip_service"]]
                if vip_stations:
                    vip_stations.sort(key=lambda s: s["load"])
                    logger.info(
                        f"Assigned VIP order to dedicated VIP station {vip_stations[0]['id']}"
                    )
                    return vip_stations[0]["id"], False
                if capable_active:
                    least = sorted(capable_active, key=lambda s: s["load"])[0]
                    logger.info(
                        f"Assigned VIP order to station {least['id']} (least busy capable)"
                    )
                    return least["id"], False

            # Check if the requested milk type requires specific station
            milk_type_normalized = (
                milk_type.lower().replace(" milk", "") if milk_type else None
            )
            stations_for_milk = (
                stations_with_milk.get(milk_type_normalized, [])
                if milk_type_normalized
                else []
            )

            # If only one station has this milk type, use it — but only if it
            # can also make the drink + size. Otherwise fall through (the
            # capable_active selection below handles it / falls back safely).
            if milk_type_normalized and len(stations_for_milk) == 1:
                station_id = stations_for_milk[0]
                station = next((s for s in stations if s["id"] == station_id), None)
                if station and order_capable(station):
                    wait_time = self._get_station_wait_time(station_id)
                    logger.info(
                        f"Only station {station_id} has {milk_type}, assigning order there (wait: {wait_time} min)"
                    )
                    return station_id, False

            # Check if this is alternative milk
            is_alt_milk = milk_type_normalized and milk_type_normalized in [
                "soy",
                "almond",
                "oat",
                "lactose free",
                "coconut",
                "macadamia",
            ]

            # During a break period, use open stations based on capabilities
            if current_break:
                # Get the stations that are open during this break
                open_station_ids = current_break["stations"]
                open_stations = [
                    s
                    for s in stations
                    if s["id"] in open_station_ids and s["status"] == "active"
                ]

                if not open_stations:
                    logger.warning(
                        f"No stations open during current break, using all active stations"
                    )
                    open_stations = [s for s in stations if s["status"] == "active"]

                # Find the best station based on milk type and load
                if milk_type_normalized:
                    # Find stations that have this milk (empty milk_types = wildcard)
                    milk_capable_stations = [
                        s
                        for s in open_stations
                        if (not s["milk_types"])
                        or milk_type_normalized
                        in [
                            str(m).lower().replace(" milk", "") for m in s["milk_types"]
                        ]
                    ]
                    if milk_capable_stations:
                        milk_capable_stations.sort(key=lambda s: s["load"])
                        twin = self._batch_costation(
                            milk_capable_stations, coffee_type, milk_type
                        )
                        if twin is not None:
                            logger.info(
                                f"Assigned {milk_type} order to station {twin['id']} during break (batch co-location)"
                            )
                            return twin["id"], False
                        logger.info(
                            f"Assigned {milk_type} order to station {milk_capable_stations[0]['id']} during break"
                        )
                        return milk_capable_stations[0]["id"], False
                    # No OPEN station has this milk. Capability beats break
                    # hours: route to a milk-capable ACTIVE station even if
                    # it's on break (a slower coffee beats an impossible one).
                    # Previously this fell through to weighted selection among
                    # the open stations REGARDLESS of milk — a #165-class hole
                    # that could strand e.g. an almond order on a
                    # full-cream-only station.
                    all_capable = [
                        s
                        for s in stations
                        if s["status"] == "active"
                        and (
                            (not s["milk_types"])
                            or milk_type_normalized
                            in [
                                str(m).lower().replace(" milk", "")
                                for m in s["milk_types"]
                            ]
                        )
                    ]
                    if all_capable:
                        all_capable.sort(key=lambda s: s["load"])
                        logger.warning(
                            f"No open station has {milk_type} during break; "
                            f"routing to milk-capable station {all_capable[0]['id']} despite the break"
                        )
                        return all_capable[0]["id"], False
                    logger.warning(
                        f"No active station can make {milk_type} (break period); returning None"
                    )
                    return None, False

                # If we reached here, use standard load balancing among open stations
                if open_stations:
                    # Weighted random assignment based on load and capacity
                    weights = []
                    for station in open_stations:
                        # Higher weight for stations with more capacity and less load
                        capacity_factor = (
                            station["capacity"] / 10.0
                        )  # Normalize capacity
                        load_factor = max(
                            0.1, 1.0 - (station["load"] / station["capacity"])
                        )
                        weight = capacity_factor * load_factor
                        weights.append(weight)

                    # Select a station based on weights
                    total_weight = sum(weights) or 1.0  # Avoid division by zero
                    normalized_weights = [w / total_weight for w in weights]

                    rand = random.random()
                    cumulative = 0
                    selected_station = open_stations[0]["id"]  # Default

                    for i, weight in enumerate(normalized_weights):
                        cumulative += weight
                        if rand <= cumulative:
                            selected_station = open_stations[i]["id"]
                            break

                    logger.info(
                        f"Assigned order to station {selected_station} during break"
                    )
                    return selected_station, False

            # If not during a break and we have a next break, check if we should delay the order
            if not current_break and next_break:
                # Get all active stations
                active_stations = [s for s in stations if s["status"] == "active"]

                # Check if all active stations are nearly at capacity
                if active_stations and all(
                    s["load"] >= 0.8 * s["capacity"] for s in active_stations
                ):
                    # Stations are busy, so delay until next break
                    # Choose a station from those that will be open during the next break
                    next_break_station_ids = next_break["stations"]
                    next_break_stations = [
                        s for s in stations if s["id"] in next_break_station_ids
                    ]

                    if next_break_stations:
                        # Choose a high-capacity station for the next break if possible
                        high_volume_stations = [
                            s for s in next_break_stations if s["high_volume"]
                        ]
                        if high_volume_stations:
                            station_choice = high_volume_stations[0]["id"]
                        else:
                            station_choice = next_break_stations[0]["id"]

                        logger.info(
                            f"Stations busy, delaying order until next break at {next_break['start']} using station {station_choice}"
                        )
                        return station_choice, True

            # Standard station assignment logic for normal operations.
            # Use the capability-filtered candidate set so we never route a
            # drink/size to a station that can't make it; load below is the
            # live order count, so identical orders spread evenly.
            active_stations = capable_active

            if not active_stations:
                # No active station can make this order. Do NOT silently dump it
                # on station 1 — return None so _confirm_order tells the customer
                # (and, for a milk we can't make, asks for a different milk)
                # instead of sending a false "confirmed" SMS.
                logger.warning(
                    "No active station can make this order; returning None (no silent station-1 fallback)"
                )
                return None, False

            # Pull the operator's load-balancing preferences. These come
            # from Barista → Queue AI (or admin can override via
            # /api/routing-rules). They shape the algorithm below
            # without changing its overall structure.
            routing = self._get_routing_rules()
            consider_capabilities = bool(routing.get("considerCapabilities", True))
            balance_workload = bool(routing.get("balanceWorkload", True))
            prioritize_efficiency = bool(routing.get("prioritizeEfficiency", True))
            emergency_mode = bool(routing.get("emergencyMode", False))

            # Special handling for specific milk type orders. In
            # emergency mode (or with considerCapabilities turned off),
            # we don't refuse the order if no station has that milk —
            # we just assign it to the least-busy station and let the
            # barista improvise. Closes the gap where the operator
            # turned off oat mid-event but the wizard hadn't caught up.
            if milk_type_normalized:
                # A station with NO milk_types configured is a wildcard (can make
                # any milk) — same fail-open as the SMS milk gate. Only a station
                # that explicitly lists milks is restricted to that list.
                milk_capable_stations = [
                    s
                    for s in active_stations
                    if (not s["milk_types"])
                    or milk_type_normalized
                    in [str(m).lower().replace(" milk", "") for m in s["milk_types"]]
                ]
                if milk_capable_stations:
                    # Sort by load to find the least busy station with this milk
                    milk_capable_stations.sort(key=lambda s: s["load"])
                    # Batch-aware tiebreak: co-locate with a pending twin
                    # drink when it doesn't cost meaningful queue time.
                    twin = self._batch_costation(
                        milk_capable_stations, coffee_type, milk_type
                    )
                    if twin is not None:
                        logger.info(
                            f"Assigned {milk_type} order to station {twin['id']} (batch co-location)"
                        )
                        return twin["id"], False
                    logger.info(
                        f"Assigned {milk_type} order to station {milk_capable_stations[0]['id']} "
                        f"(milk-capability match)"
                    )
                    return milk_capable_stations[0]["id"], False
                else:
                    if not consider_capabilities or emergency_mode:
                        logger.warning(
                            f"No active stations have {milk_type}, but "
                            f"considerCapabilities={consider_capabilities} / "
                            f"emergencyMode={emergency_mode}; falling through to "
                            f"normal load-balancing."
                        )
                        # Fall through to the general weighted selection below.
                    else:
                        # No active station can make this milk. Return None (NOT a
                        # silent station-1 fallback) so _confirm_order asks the
                        # customer for a milk we can actually make.
                        logger.warning(
                            f"No active station can make {milk_type}; returning None so the customer is asked for another milk"
                        )
                        return None, False

            # Calculate weights for station selection based on load and capacity.
            # The exact mix is driven by the routing rules:
            #   balanceWorkload=False       → ignore load score (use capacity only)
            #   prioritizeEfficiency=False  → ignore capacity bonus (use load only)
            #   both False                  → uniform random; not what you want, but
            #                                 we let the operator do it
            weighted_stations = []
            for station in active_stations:
                norm_load = (
                    min(1.0, station["load"] / station["capacity"])
                    if station["capacity"] > 0
                    else 1.0
                )
                load_score = 1.0 - norm_load
                capacity_weight = station["capacity"] / 10.0

                load_term = load_score if balance_workload else 1.0
                cap_term = capacity_weight if prioritize_efficiency else 1.0
                final_weight = load_term * cap_term
                weighted_stations.append((station["id"], max(0.01, final_weight)))

            # If only one station, use it
            if len(weighted_stations) == 1:
                return weighted_stations[0][0], False

            # If balanceWorkload is OFF but prioritizeEfficiency is ON,
            # the operator wants deterministic "send to the biggest free
            # station". Skip the random draw and just pick the highest.
            if not balance_workload:
                weighted_stations.sort(key=lambda t: t[1], reverse=True)
                logger.info(
                    f"Assigned order to station {weighted_stations[0][0]} "
                    f"(balanceWorkload=False → deterministic pick)"
                )
                return weighted_stations[0][0], False

            # Otherwise do weighted random selection (the existing behavior).
            station_ids, weights = zip(*weighted_stations)
            total_weight = sum(weights)
            norm_weights = [w / total_weight for w in weights]

            rand = random.random()
            cumulative = 0
            for i, weight in enumerate(norm_weights):
                cumulative += weight
                if rand <= cumulative:
                    logger.info(
                        f"Assigned order to station {station_ids[i]} using weighted selection "
                        f"(rules: balance={balance_workload}, eff={prioritize_efficiency})"
                    )
                    return station_ids[i], False

            # Fallback to the least busy active station
            active_stations.sort(key=lambda s: s["load"])
            selected_station = active_stations[0]["id"]
            logger.warning(
                f"Selection algorithm failed, using least busy station {selected_station}"
            )
            return selected_station, False

        except Exception as e:
            logger.error(f"Error in advanced station assignment: {str(e)}")
            logger.exception(e)

            # Try to find any active station instead of defaulting to station 1
            try:
                try:
                    self.db.rollback()
                except Exception:
                    pass
                cursor = self.db.cursor()
                cursor.execute(
                    """
                    SELECT station_id, current_load 
                    FROM station_stats 
                    WHERE status = 'active' 
                    ORDER BY current_load ASC
                    LIMIT 1
                """
                )
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
                cursor.execute(
                    """
                    UPDATE station_stats
                    SET current_load = current_load + 1, last_updated = %s
                    WHERE station_id = %s
                """,
                    (datetime.now(), station_id),
                )
            else:
                cursor.execute(
                    """
                    UPDATE station_stats
                    SET current_load = GREATEST(0, current_load - 1), last_updated = %s
                    WHERE station_id = %s
                """,
                    (datetime.now(), station_id),
                )

            self.db.commit()

        except Exception as e:
            logger.error(f"Error updating station load: {str(e)}")

    # Per-drink consumption defaults. Tweak per event in the inventory
    # UI later; these are the "if I don't know better" values.
    _SIZE_TO_ML = {"small": 150, "medium": 200, "large": 280}
    _COFFEE_SHOTS_BY_TYPE = {
        "espresso": 1,
        "long black": 1,
        "short black": 1,
        "americano": 1,
        "flat white": 1,
        "latte": 1,
        "cappuccino": 1,
        "mocha": 1,
        "piccolo": 1,
        "macchiato": 1,
        "cortado": 1,
    }

    # Drinks that contain NO espresso. ONE shared truth — used by stock
    # depletion below (no bean burn) and mirrored by the team-mode stage
    # chips in the frontend (utils/orderUtils.applicableStages — keep the
    # two patterns aligned). Name-based because drinks are inventory
    # names, not recipes with ingredient lists; if a per-drink
    # "contains coffee" flag ever lands in the menu, both should read it.
    # Steve's audit question found the bug this fixes: the shot decrement
    # excluded only TEA and defaulted everything else to 1 shot, so every
    # hot chocolate/chai/matcha/babycino burned 8g of beans from stock.
    _NO_COFFEE_DRINK_RE = re.compile(
        r"tea|chai|matcha|hot choc|chocolate|babycino|juice|smoothie|water",
        re.IGNORECASE,
    )

    def _drink_uses_coffee(self, coffee_type):
        return not self._NO_COFFEE_DRINK_RE.search(str(coffee_type or ""))

    def _decrement_stock_for_order(
        self, conn, db_type, station_id, processed_details, restock=False
    ):
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
        result = {"decremented": [], "skipped": []}
        # Idempotency guard. The SMS confirmation flow calls this on
        # order confirm; the new /complete endpoint also calls it for
        # walk-in orders. If both fire on the same order we'd
        # double-decrement. Caller is expected to set/check a
        # `_stock_decremented` flag on processed_details to mark
        # completion, but as a backstop we no-op here when we see it.
        if restock:
            # Give stock back for a cancelled order — only if it was actually
            # taken, and only once.
            if not processed_details.get("_stock_decremented"):
                return result
            if processed_details.get("_stock_restocked"):
                return result
        elif processed_details.get("_stock_decremented"):
            return result
        self._stock_errors = []  # collected by _decrement_inventory_item
        cursor = conn.cursor()
        # Heal the amount/current_quantity split-brain before touching stock
        # (no-op after the first call in this process).
        try:
            self._ensure_inventory_quantity_columns(cursor)
        except Exception as _heal_err:
            logger.warning(f"inventory schema heal failed (continuing): {_heal_err}")
        size = (processed_details.get("size") or "medium").lower()
        milk = (processed_details.get("milk") or "").lower()
        coffee_type = (processed_details.get("type") or "").lower()
        # Tea detection: any drink with "tea" in the type name, OR an
        # explicit is_tea flag set by the walk-in dialog.
        is_tea = bool(processed_details.get("is_tea")) or ("tea" in coffee_type)
        tea_double_cup = bool(processed_details.get("tea_double_cup"))

        # --- milk ---------------------------------------------------
        if milk and milk != "no milk":
            if is_tea:
                # Tea milk is a splash — most customers want barely any.
                # 30 mL keeps the decrement honest without overstating
                # consumption.
                liters = 30 / 1000.0
            else:
                ml = self._SIZE_TO_ML.get(size, 200)
                liters = ml / 1000.0
            if self._decrement_inventory_item(
                cursor,
                db_type,
                category="milk",
                name=milk,
                amount=liters,
                station_id=station_id,
                restock=restock,
            ):
                result["decremented"].append(f"milk:{milk}")
            else:
                result["skipped"].append(
                    {
                        "category": "milk",
                        "name": milk,
                        "reason": "no matching inventory row",
                    }
                )

        # --- coffee shots -------------------------------------------
        # Only drinks that actually CONTAIN espresso burn beans. Was
        # `if not is_tea:` — hot chocolate/chai/matcha/babycino fell
        # through to the 1-shot default and silently drained bean stock
        # (bug #19, found by Steve asking how "no shots" was decided).
        if not is_tea and self._drink_uses_coffee(coffee_type):
            # Steve's audit: shot COUNTS must reach the bean math. Café
            # practice here is "run another full extraction" (not a
            # bigger basket), so N shots = N x 8g. Priority order:
            #   1. explicit shots field (walk-in dialog sends shots: 2)
            #   2. strength words: strong/double/extra +1, triple +2,
            #      quad +3 (SMS "quad shot latte" parses into strength)
            #   3. per-type base (currently 1 for every espresso drink)
            shots = 0
            try:
                shots = int(processed_details.get("shots") or 0)
            except (TypeError, ValueError):
                shots = 0
            if shots <= 0:
                shots = self._COFFEE_SHOTS_BY_TYPE.get(coffee_type, 1)
                strength = (processed_details.get("strength") or "").lower()
                if "quad" in strength:
                    shots += 3
                elif "triple" in strength:
                    shots += 2
                elif (
                    strength in ("strong", "double", "extra shot")
                    or "double" in strength
                ):
                    shots += 1
            # Bean stock is in KILOGRAMS. Dose per extraction is a
            # SETTING (beans_grams_per_shot), default 22g — the top of
            # the Australian standard (20-22g double-basket dose; the
            # double IS the default drink in AU practice), deliberately
            # high-side per Steve: dial-in shots, spills and staff
            # coffees never enter the system, so stock maths should err
            # toward "you still have beans". The old hardcoded 8g was
            # the classic Italian SINGLE dose — wrong context (Steve's
            # audit); before that, the raw shot count deducted 1kg PER
            # SHOT and drained 7.5kg in a day of testing.
            try:
                grams_per_shot = float(self._get_setting("beans_grams_per_shot", "22"))
                if not (1 <= grams_per_shot <= 60):
                    grams_per_shot = 22.0
            except (TypeError, ValueError):
                grams_per_shot = 22.0
            bean_kg = shots * grams_per_shot / 1000.0
            # Decrement the BEAN the customer chose, not the drink name.
            # This passed name="flat white": no inventory row is called
            # that, so the category fallback fired and decremented
            # whichever coffee row it found first -- meaning a decaf
            # order burned house blend stock, and the decaf row never
            # moved. Steve: "not sure how this would track stock then".
            # It didn't.
            #
            # bean_type ("decaf", "house blend") partial-matches the
            # real rows ("decaf beans", "house blend beans") via rule 3.
            # Orders with no bean choice keep the old name + category
            # fallback, so legacy events keep decrementing SOMETHING
            # rather than nothing.
            bean_name = self._requested_bean(processed_details) or coffee_type
            if bean_kg > 0 and coffee_type:
                if self._decrement_inventory_item(
                    cursor,
                    db_type,
                    category="coffee",
                    name=bean_name,
                    amount=bean_kg,
                    station_id=station_id,
                    restock=restock,
                ):
                    result["decremented"].append(f"coffee:{bean_name}")
                else:
                    result["skipped"].append(
                        {
                            "category": "coffee",
                            "name": coffee_type,
                            "reason": "no matching inventory row",
                        }
                    )

        # --- cups ---------------------------------------------------
        # Tea is typically double-cupped because the cup gets too hot
        # to hold; the walk-in dialog defaults the toggle to ON. We
        # don't know the exact cup name the operator is using so we
        # try a few common matches.
        cups_used = 2 if (is_tea and tea_double_cup) else 1
        size_label = (processed_details.get("size") or "medium").lower()
        cup_candidates = [
            size_label,  # 'medium'
            f"{size_label} (12oz)" if size_label == "medium" else "",
            f"{size_label} (8oz)" if size_label == "small" else "",
            f"{size_label} (16oz)" if size_label == "large" else "",
            f"takeaway cup {size_label}",
            "cup",
            "cups",
        ]
        cup_decremented = False
        for cup_name in [c for c in cup_candidates if c]:
            if self._decrement_inventory_item(
                cursor,
                db_type,
                category="cups",
                name=cup_name,
                amount=cups_used,
                station_id=station_id,
                restock=restock,
            ):
                result["decremented"].append(f"cups:{cup_name}")
                cup_decremented = True
                break
        if not cup_decremented:
            result["skipped"].append(
                {
                    "category": "cups",
                    "name": size_label,
                    "reason": "no matching inventory row",
                }
            )

        # --- sugar / sweeteners -------------------------------------
        # Sugar is tracked in *sachets* (or grams) — never in
        # kilograms. We bill 1 sachet per "1 sugar", 2 per "2 sugar",
        # etc. "no sugar" decrements nothing. The category check is
        # broad so "sugar" / "sweetener" / "artificial_sweetener" all
        # match — the inventory data model still mixes these up.
        sugar = (processed_details.get("sugar") or "").lower()
        sachets = self._sugar_sachets_from_text(sugar)
        if sachets > 0:
            sugar_decremented = False
            for cat in ("sweetener", "sugar", "artificial_sweetener"):
                if self._decrement_inventory_item(
                    cursor,
                    db_type,
                    category=cat,
                    name=sugar,
                    amount=sachets,
                    station_id=station_id,
                    restock=restock,
                ):
                    result["decremented"].append(f"{cat}:{sugar}")
                    sugar_decremented = True
                    break
            if not sugar_decremented:
                result["skipped"].append(
                    {
                        "category": "sweetener",
                        "name": sugar,
                        "reason": "no matching inventory row",
                    }
                )

        # Surface any SQL errors the savepoint-wrapped executor swallowed so
        # callers (and the kiosk stock_debug field) can show WHY nothing moved.
        errs = getattr(self, "_stock_errors", None)
        if errs:
            result["errors"] = errs[:5]

        if restock:
            processed_details["_stock_restocked"] = True
        conn.commit()
        return result

    @staticmethod
    def _sugar_sachets_from_text(sugar_text):
        """Translate '1 sugar' / 'two sugar' / '3 sugar' → integer count.

        Returns 0 for 'no sugar' or unparseable values.
        """
        if not sugar_text or "no" in sugar_text or sugar_text == "none":
            return 0
        if "half" in sugar_text:
            return 1  # round up — half-sachets aren't a thing
        import re as _re

        m = _re.match(r"(\d+)", sugar_text)
        if m:
            return max(0, min(10, int(m.group(1))))
        # Handle "one", "two", "three"
        words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
        for w, n in words.items():
            if w in sugar_text:
                return n
        return 0

    def _ensure_inventory_quantity_columns(self, cursor, commit=False):
        """Heal the inventory_items quantity SPLIT-BRAIN (found by the Test
        Bench: prod's table has only `amount`; the API/UI write
        `current_quantity` — run 4's stock_debug caught the decrement failing
        with 'column current_quantity does not exist').

        v2 of this heal: the first version marked itself done even when the
        ALTERs silently failed, so it never retried and the column never
        arrived. Now every statement runs in its own SAVEPOINT and the flag is
        only set after VERIFYING both columns are actually selectable — if
        verification fails we log loudly and retry on the next call.

        v4: the done-flag is only set when the heal's work is durably
        COMMITTED (commit=True, safe only when the caller's transaction is
        fresh). v3 set the flag on any run — but the first caller after boot
        can be a read-only path whose transaction is never committed, so the
        heal's UPDATEs evaporated on the next rollback while the flag stayed
        set and blocked every retry. Non-committing callers (the decrement,
        which commits later itself) now just rerun the cheap heal until a
        committing caller locks it in."""
        if getattr(self, "_inv_qty_cols_ok", False):
            return

        # ASK THE CATALOGUE BEFORE REACHING FOR DDL.
        #
        # The done-flag above is only set by a COMMITTING caller, and the
        # decrement path deliberately does not commit here -- so on a
        # healthy database this function was still issuing two ALTER
        # TABLEs on inventory_items for EVERY order completion, to
        # discover each time that both columns already exist.
        #
        # ADD COLUMN takes ACCESS EXCLUSIVE before it checks whether the
        # column is there, so those no-ops were asking for the strongest
        # lock on the busiest path in the system. information_schema is
        # an ordinary catalogue read: no lock, no DDL, and if both
        # columns are present there is nothing to heal and we can say so
        # permanently.
        #
        # This does not weaken the heal. A database that genuinely lacks
        # the columns falls straight through to the savepoint logic
        # below, unchanged.
        try:
            cursor.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'inventory_items' "
                "AND column_name IN ('amount', 'current_quantity')"
            )
            present = {
                (r[0] if not isinstance(r, dict) else list(r.values())[0])
                for r in (cursor.fetchall() or [])
            }
            if {"amount", "current_quantity"}.issubset(present):
                self._inv_qty_cols_ok = True
                return
        except Exception:
            # Cannot tell (SQLite, or a catalogue hiccup) -- fall through
            # to the heal, which is what happened before this check.
            pass

        def sp(sql):
            try:
                cursor.execute("SAVEPOINT inv_heal")
                cursor.execute(sql)
                cursor.execute("RELEASE SAVEPOINT inv_heal")
                return True, None
            except Exception as e:
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT inv_heal")
                except Exception:
                    pass
                return False, str(e)

        def note(msg):
            # Surface heal progress via _stock_errors so the kiosk stock_debug
            # field shows it — Railway logs aren't visible from the bench.
            if not hasattr(self, "_stock_errors"):
                self._stock_errors = []
            self._stock_errors.append(f"heal: {msg}")

        for col in ("amount", "current_quantity"):
            ok, err = sp(
                f"ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS {col} DECIMAL(10,2)"
            )
            if not ok:
                # SQLite has no IF NOT EXISTS for columns
                ok2, err2 = sp(
                    f"ALTER TABLE inventory_items ADD COLUMN {col} DECIMAL(10,2)"
                )
                if (
                    not ok2
                    and "duplicate" not in (err2 or "").lower()
                    and "exists" not in (err2 or "").lower()
                ):
                    logger.error(
                        f"inventory heal: could not add column {col}: {err} / {err2}"
                    )
                    note(f"ALTER {col} FAILED: {err} / {err2}")

        # VERIFY both columns are real before trusting the heal.
        ok, err = sp("SELECT amount, current_quantity FROM inventory_items LIMIT 1")
        if not ok:
            logger.error(
                f"inventory heal VERIFICATION FAILED — will retry next call: {err}"
            )
            note(f"v3 verification FAILED: {err}")
            return
        note("v3 verified OK")

        sp(
            """UPDATE inventory_items SET current_quantity = amount
              WHERE (current_quantity IS NULL OR current_quantity = 0)
                AND amount > 0"""
        )
        sp(
            """UPDATE inventory_items SET amount = current_quantity
              WHERE amount IS NULL AND current_quantity IS NOT NULL"""
        )
        # Reconcile rows where BOTH columns hold different non-null values
        # (legacy drift from the era when manual adjust/restock/transfer wrote
        # only `amount`). amount wins: it's what those manual paths wrote, so
        # on a drifted row it carries the operator's latest intent. All write
        # paths now set both columns, so this is a one-time cleanup.
        sp(
            """UPDATE inventory_items SET current_quantity = amount
              WHERE amount IS NOT NULL AND current_quantity IS NOT NULL
                AND current_quantity <> amount"""
        )
        if not commit:
            # Caller owns the transaction; our work is only durable if THEY
            # commit. Don't set the done-flag — rerun until a committing
            # caller locks the heal in.
            return
        try:
            cursor.connection.commit()
        except Exception as e:
            note(f"v4 commit failed — will retry: {e}")
            return
        self._inv_qty_cols_ok = True
        logger.info(
            "inventory quantity columns verified healthy (amount + current_quantity)"
        )

    def _restock_for_order(self, conn, db_type, station_id, processed_details):
        """Give back the stock a CANCELLED order had taken. Thin wrapper over
        _decrement_stock_for_order(restock=True): same amounts, same matching
        cascade, opposite sign, guarded so it only fires once and only when the
        order actually decremented. Never raises."""
        try:
            return self._decrement_stock_for_order(
                conn, db_type, station_id, processed_details, restock=True
            )
        except Exception as e:
            logger.warning(f"restock on cancel failed (non-fatal): {e}")
            try:
                conn.rollback()
            except Exception:
                pass
            return {"restocked": [], "skipped": [], "errors": [str(e)]}

    def _decrement_inventory_item(
        self, cursor, db_type, *, category, name, amount, station_id, restock=False
    ):
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
        ph = "?" if db_type == "sqlite" else "%s"
        # restock=True gives stock BACK (order cancelled) — same matching
        # cascade, opposite sign. GREATEST(0, ...) is a no-op for adds.
        op = "+" if restock else "-"
        name_norm = (name or "").strip().lower()
        if not name_norm:
            return False

        def _run(sql, params):
            """Execute one decrement UPDATE inside a SAVEPOINT so an SQL
            error (missing column, aborted txn, ...) can't silently poison
            the rest of the transaction — the old behaviour behind 'stock
            never moves and nobody knows why'. Errors are collected on
            self._stock_errors and surfaced in the result/debug output."""
            try:
                cursor.execute("SAVEPOINT stock_dec")
                cursor.execute(sql, params)
                n = cursor.rowcount or 0
                cursor.execute("RELEASE SAVEPOINT stock_dec")
                return n
            except Exception as e:
                if not hasattr(self, "_stock_errors"):
                    self._stock_errors = []
                self._stock_errors.append(f"{category}/{name_norm}: {e}")
                logger.warning(
                    f"stock decrement SQL failed ({category}/{name_norm}): {e}"
                )
                try:
                    cursor.execute("ROLLBACK TO SAVEPOINT stock_dec")
                except Exception:
                    pass
                return 0

        def _exact(sql_extra, params):
            return _run(
                f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) {op} {ph}),
                    current_quantity = GREATEST(0, COALESCE(current_quantity, amount, 0) {op} {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE category = {ph} AND LOWER(name) = {ph}
                  AND COALESCE(amount, current_quantity) IS NOT NULL
                  {sql_extra}
                """,
                (amount, amount, category, name_norm, *params),
            )

        # Step 1: exact match at station scope.
        if _exact(f"AND station_id = {ph}", (station_id,)) > 0:
            return True
        # Step 2: exact match event-wide.
        if _exact("AND station_id IS NULL", ()) > 0:
            return True
        # Step 2.5: exact match on ANY station's row. Found by the Test Bench:
        # demo/seed rows are all scoped to station 1, but an almond order can
        # only land on a station that HAS almond (2/4) — so the station-scoped
        # steps never matched and stock never moved. A decrement against
        # another station's row keeps the EVENT total right, which beats
        # never decrementing at all.
        if (
            _run(
                f"""
            UPDATE inventory_items
            SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) {op} {ph}),
                current_quantity = GREATEST(0, COALESCE(current_quantity, amount, 0) {op} {ph}),
                last_updated = CURRENT_TIMESTAMP
            WHERE id = (
                SELECT id FROM inventory_items
                WHERE category = {ph} AND LOWER(name) = {ph}
                  AND COALESCE(amount, current_quantity) IS NOT NULL
                ORDER BY (station_id IS NULL) DESC
                LIMIT 1
            )
            """,
                (amount, amount, category, name_norm),
            )
            > 0
        ):
            return True

        # Step 3: partial-match cascade. Build the candidate tokens by
        # stripping noise that often differs between order text and
        # inventory row name (' milk' suffix, parenthetical sizes,
        # leading count words like '1 ').
        import re as _re

        candidates = {name_norm}
        # Strip a trailing ' milk' for milk-category names so
        # 'oat milk' matches 'oat' and vice versa.
        if name_norm.endswith(" milk"):
            candidates.add(name_norm[:-5].strip())
        # Strip parenthetical content for cups: 'small (8oz)' → 'small'.
        no_paren = _re.sub(r"\s*\([^)]*\)\s*", "", name_norm).strip()
        if no_paren:
            candidates.add(no_paren)
        # Strip a leading numeric count for sweeteners: '1 white sugar' → 'white sugar'.
        no_count = _re.sub(r"^\d+\s+", "", name_norm).strip()
        if no_count:
            candidates.add(no_count)

        # For each candidate try a substring match (both directions —
        # row name contains candidate OR candidate contains row name).
        for cand in candidates:
            if not cand:
                continue
            if (
                _run(
                    f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) {op} {ph}),
                    current_quantity = GREATEST(0, COALESCE(current_quantity, amount, 0) {op} {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT id FROM inventory_items
                    WHERE category = {ph}
                      AND COALESCE(amount, current_quantity) IS NOT NULL
                      AND (LOWER(name) LIKE {ph} OR {ph} LIKE '%%' || LOWER(name) || '%%')
                    ORDER BY (station_id = {ph}) DESC NULLS LAST
                    LIMIT 1
                )
                """,
                    (amount, amount, category, f"%{cand}%", cand, station_id),
                )
                > 0
            ):
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
        if category in ("coffee", "sugar", "sweetener", "artificial_sweetener"):
            # Pick the row that should ACTUALLY be consumed:
            #  1. rows with stock left first — the old ORDER BY was alphabetical,
            #     so a real event with 'decaf beans' (0.00) and 'house blend
            #     beans' (5.00) always hit the EMPTY decaf row, clamped it at 0,
            #     reported success, and never touched the beans being used
            #     (found by the Test Bench: "no coffee row decremented").
            #  2. match the order's decaf-ness: a decaf drink should burn decaf
            #     beans; a normal drink should not.
            #  3. then station scope, then name for stability.
            want_decaf = "decaf" in (name or "").lower()
            if (
                _run(
                    f"""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) {op} {ph}),
                    current_quantity = GREATEST(0, COALESCE(current_quantity, amount, 0) {op} {ph}),
                    last_updated = CURRENT_TIMESTAMP
                WHERE id = (
                    SELECT id FROM inventory_items
                    WHERE category = {ph}
                      AND COALESCE(amount, current_quantity) IS NOT NULL
                    ORDER BY (COALESCE(amount, current_quantity, 0) > 0) DESC,
                             ((LOWER(name) LIKE '%%decaf%%') = {ph}) DESC,
                             (station_id = {ph}) DESC NULLS LAST,
                             LOWER(name) ASC
                    LIMIT 1
                )
                """,
                    (amount, amount, category, want_decaf, station_id),
                )
                > 0
            ):
                logger.debug(
                    f"Stock decrement matched via category fallback: "
                    f"requested='{name}', category={category}"
                )
                return True

        logger.info(f"No inventory row to decrement: category={category} name={name}")
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
            placeholder = "?" if is_sqlite else "%s"
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

    def _get_recent_completion_avg_minutes(
        self, station_id, window_minutes=60, sample_size=20
    ):
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
                SELECT EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) / 60.0 AS minutes
                FROM orders
                WHERE station_id = %s
                  AND status IN ('completed', 'picked_up')
                  AND updated_at >= NOW() - (%s || ' minutes')::interval
                  AND started_at IS NOT NULL
                  -- MAKE time only (start → complete). The old metric was
                  -- created → updated: the order's WHOLE LIFETIME including
                  -- however long it sat in the queue, so a backlog that
                  -- cleared poisoned the average for the next hour (Steve:
                  -- empty station claiming a 10-minute walk-up wait).
                  -- Discard outliers: sub-10s ghosts and >15 min = the
                  -- barista walked away, not a drink's make-time.
                  AND EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) BETWEEN 10 AND 900
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

    def _get_station_capacity(self, station_id):
        """How many drinks this station can make at once — its parallelism,
        a proxy for steam wands / group heads / number of baristas. Stored in
        station_stats.capabilities JSON as 'concurrent'. Defaults to 1 (serial)
        so the estimate stays conservative until an operator configures it.

        NOTE: deliberately does NOT fall back to capabilities.capacity — that
        field is the MAX QUEUE size (default 10), a different concept; using it
        as the divisor would make every wait ~10× too short."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            row = cursor.fetchone()
            caps = row[0] if row else None
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    caps = {}
            if isinstance(caps, dict):
                c = caps.get("concurrent")
                if c:
                    return max(1, int(c))
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return 1

    def _get_station_declared_throughput(self, station_id):
        """The team's self-declared orders/hour for a station, set in station
        capabilities as 'throughput_per_hour' (e.g. 'we can do ~120/hour').
        Returns int orders/hour, or None if not set."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT capabilities FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            row = cursor.fetchone()
            caps = row[0] if row else None
            if isinstance(caps, str):
                try:
                    caps = json.loads(caps)
                except Exception:
                    caps = {}
            if isinstance(caps, dict):
                t = caps.get("throughput_per_hour") or caps.get("throughput")
                if t:
                    return max(1, int(float(t)))
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return None

    def _estimate_wait_from_throughput(self, station_id):
        """Fallback estimate from the team's DECLARED orders/hour — useful
        before any drinks have completed (no real data yet). A new order is
        #(queue+1) in line; at `rate` per hour that's this many minutes."""
        rate = self._get_station_declared_throughput(station_id)
        if not rate or rate <= 0:
            return None
        queue = self._get_station_pending_count(station_id)  # pending + in-progress
        est = ((queue + 1) / float(rate)) * 60.0
        return max(1, min(int(round(est)), 60))

    def _get_per_drink_avgs(self, station_id, window_minutes=120):
        """Recent average make-time per drink type at this station, from real
        completions. Returns {drink_lower: minutes}; empty if no data."""
        out = {}
        try:
            cursor = self.db.cursor()
            cursor.execute(
                """
                SELECT LOWER(order_details->>'type') AS drink,
                       AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) / 60.0) AS m
                FROM orders
                WHERE station_id = %s
                  AND started_at IS NOT NULL
                  AND EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - started_at)) BETWEEN 10 AND 900
                  AND status IN ('completed', 'picked_up')
                  AND updated_at >= NOW() - (%s || ' minutes')::interval
                  AND created_at IS NOT NULL AND updated_at IS NOT NULL
                  AND order_details ? 'type'
                GROUP BY drink
                """,
                (station_id, str(window_minutes)),
            )
            for row in cursor.fetchall():
                if row[0] and row[1] is not None:
                    out[row[0]] = float(row[1])
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return out

    def _get_queue_drinks(self, station_id):
        """Drink types of orders currently pending/in-progress at the station.

        RECENT ONLY (last 8 hours): a crashed flow can strand an order in
        pending/in-progress forever, and without this window those ghosts
        inflated queue counts and wait estimates for days (Steve's S2-pill
        report: header said Q5 while the real queue was 2)."""
        out = []
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT LOWER(order_details->>'type') FROM orders "
                "WHERE station_id = %s AND status IN ('pending', 'in-progress', 'in_progress') "
                "AND created_at > NOW() - INTERVAL '8 hours'",
                (station_id,),
            )
            for row in cursor.fetchall():
                out.append(row[0] or "")
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return out

    def _estimate_wait_from_queue(self, station_id):
        """Smart wait estimate for a NEW order: real per-drink make-times × the
        actual current queue (pending + in-progress), divided by the station's
        concurrent capacity, plus one drink's own make-time. Returns int minutes
        or None when there's not enough recent data (caller falls back)."""
        overall = self._get_recent_completion_avg_minutes(station_id)
        if overall is None:
            return None
        per_drink = self._get_per_drink_avgs(station_id)
        queue = self._get_queue_drinks(station_id)
        capacity = self._get_station_capacity(station_id)
        # Total queued work = sum of each waiting drink's expected make-time
        # (fall back to the station overall avg for drinks with no history).
        work_ahead = sum(per_drink.get(d, overall) for d in queue)
        # A new order waits for the queue ahead to clear across `capacity`
        # parallel lanes, then takes ~one drink's time itself.
        est = (work_ahead / max(1, capacity)) + overall
        return max(1, min(int(round(est)), 60))

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
            # 0. EMPTY queue = "walk up now, wait one drink's worth" — the
            # recent per-station average if we have one, else ~2 minutes.
            # Without this, an empty station fell through to the operator
            # override / static default and told walk-ups 5-10 minutes for
            # a coffee nobody is ahead of (Steve's report: 'starts at 5 min
            # with no orders in the queue').
            queue_now = self._get_queue_drinks(station_id)
            if not queue_now:
                # Empty queue = one drink's MAKE time, hard-capped at 5:
                # whatever history says, an empty station can never honestly
                # tell a walk-up more than a few minutes.
                overall = self._get_recent_completion_avg_minutes(station_id)
                return max(1, min(int(round(overall)), 5)) if overall else 2

            # 1. Best signal: per-drink make-times × the real queue (pending +
            # in-progress), divided by the station's concurrent capacity. One
            # source of truth for the barista header AND the SMS estimate.
            est = self._estimate_wait_from_queue(station_id)
            if est is not None:
                return est

            # 1b. No real completion data yet → use the team's DECLARED
            # throughput (orders/hour, set in station capabilities) if any.
            # Gives a sensible estimate from the very first order, before the
            # per-drink history exists.
            est = self._estimate_wait_from_throughput(station_id)
            if est is not None:
                return est

            # 1c. Queue is BUSY but we have neither completion history nor a
            # declared throughput: scale by queue depth at ~2 min/drink
            # rather than falling through to a static number that ignores
            # the queue entirely (Steve's report: 'when there is a lot of
            # orders then it does not go up').
            capacity = self._get_station_capacity(station_id)
            est = (len(queue_now) * 2.0) / max(1, capacity) + 2
            return max(1, min(int(round(est)), 60))
            db_type = (
                "sqlite" if isinstance(self.db, sqlite3.Connection) else "postgres"
            )
            cursor = self.db.cursor()

            # First check if the station_stats table exists
            if db_type == "sqlite":
                cursor.execute(
                    """
                    SELECT 1 FROM sqlite_master WHERE type='table' AND name='station_stats'
                """
                )
            else:
                cursor.execute(
                    """
                    SELECT 1 FROM information_schema.tables 
                    WHERE table_schema = 'public' AND table_name = 'station_stats'
                """
                )

            if cursor.fetchone() is None:
                # Table doesn't exist, return default wait time
                logger.info(
                    "station_stats table doesn't exist, using default wait time"
                )
                return 10  # Default wait time

            # Get station wait time
            if db_type == "sqlite":
                cursor.execute(
                    """
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = ?
                """,
                    (station_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT current_load, avg_completion_time, wait_time
                    FROM station_stats
                    WHERE station_id = %s
                """,
                    (station_id,),
                )

            result = cursor.fetchone()

            if not result:
                # No statistics for this station, check if it has a configured wait time in stations table
                try:
                    # Check if the stations table exists
                    if db_type == "sqlite":
                        cursor.execute(
                            """
                            SELECT 1 FROM sqlite_master WHERE type='table' AND name='stations'
                        """
                        )
                    else:
                        cursor.execute(
                            """
                            SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = 'public' AND table_name = 'stations'
                        """
                        )

                    if cursor.fetchone() is not None:
                        # Try to get waitTime from stations table
                        if db_type == "sqlite":
                            cursor.execute(
                                """
                                SELECT waitTime FROM stations WHERE id = ?
                            """,
                                (station_id,),
                            )
                        else:
                            cursor.execute(
                                """
                                SELECT waitTime FROM stations WHERE id = %s
                            """,
                                (station_id,),
                            )

                        wait_time_result = cursor.fetchone()
                        if wait_time_result and wait_time_result[0]:
                            return wait_time_result[0]
                except Exception as e:
                    logger.error(
                        f"Error getting wait time from stations table: {str(e)}"
                    )

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
            if not name and order_details and "name" in order_details:
                name = order_details["name"]

            # Skip if we still don't have a name or phone
            if not name or not phone:
                logger.warning(
                    f"Cannot save customer preferences without name and phone: name={name}, phone={phone}"
                )
                return

            db_type = (
                "sqlite" if isinstance(self.db, sqlite3.Connection) else "postgres"
            )
            cursor = self.db.cursor()

            # Check if customer exists
            if db_type == "sqlite":
                cursor.execute(
                    "SELECT name FROM customer_preferences WHERE phone = ?", (phone,)
                )
            else:
                cursor.execute(
                    "SELECT name FROM customer_preferences WHERE phone = %s", (phone,)
                )

            result = cursor.fetchone()

            now = datetime.now()

            if result:
                # Update existing customer
                if db_type == "sqlite":
                    cursor.execute(
                        """
                        UPDATE customer_preferences
                        SET name = ?,
                            preferred_drink = ?,
                            preferred_milk = ?,
                            preferred_size = ?,
                            preferred_sugar = ?,
                            last_order_date = ?,
                            total_orders = total_orders + 1
                        WHERE phone = ?
                    """,
                        (
                            name,
                            order_details.get("type"),
                            order_details.get("milk"),
                            order_details.get("size"),
                            order_details.get("sugar"),
                            now,
                            phone,
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        UPDATE customer_preferences
                        SET name = %s,
                            preferred_drink = %s,
                            preferred_milk = %s,
                            preferred_size = %s,
                            preferred_sugar = %s,
                            last_order_date = %s,
                            total_orders = total_orders + 1
                        WHERE phone = %s
                    """,
                        (
                            name,
                            order_details.get("type"),
                            order_details.get("milk"),
                            order_details.get("size"),
                            order_details.get("sugar"),
                            now,
                            phone,
                        ),
                    )
            else:
                # Create new customer
                if db_type == "sqlite":
                    cursor.execute(
                        """
                        INSERT INTO customer_preferences
                        (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                         first_order_date, last_order_date, total_orders)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                        (
                            phone,
                            name,
                            order_details.get("type"),
                            order_details.get("milk"),
                            order_details.get("size"),
                            order_details.get("sugar"),
                            now,
                            now,
                            1,
                        ),
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO customer_preferences
                        (phone, name, preferred_drink, preferred_milk, preferred_size, preferred_sugar, 
                         first_order_date, last_order_date, total_orders)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                        (
                            phone,
                            name,
                            order_details.get("type"),
                            order_details.get("milk"),
                            order_details.get("size"),
                            order_details.get("sugar"),
                            now,
                            now,
                            1,
                        ),
                    )

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
        if message_upper in [
            "MENU",
            "STATUS",
            "INFO",
            "OPTIONS",
            "COMMANDS",
            "USUAL",
            "CANCEL",
            "CANCELORDER",
        ]:
            # Don't restart, handle as a command (recursive call to handle_sms)
            logger.info(
                f"Detected command {message_upper} during restart, handling as command"
            )
            return self.handle_sms(phone, message, None, None)

        # Check if this is a usual order request
        if self.nlp.is_asking_for_usual(message):
            # Get customer info
            customer = self.get_customer(phone)
            name = customer.get("name", "") if customer else ""

            if name:
                return self._process_usual_order(phone, name)
            else:
                # We don't know their name yet
                self._set_conversation_state(phone, "awaiting_name")

                # Get welcome message from settings or use default if not available
                welcome_message = self._get_setting(
                    "sms_welcome_message",
                    f"Welcome to {{event_name}}! I'll take your coffee order. What's your first name?",
                )
                # Replace event_name placeholder with actual event name
                return (
                    welcome_message.replace("{event_name}", self.event_name)
                    + self._sms_first_message_hint()
                )

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
            coffee_type = order_details.get("type", "")
            if coffee_type:
                available_coffee_types = self._get_available_coffee_types()
                if not self._is_valid_coffee_type(coffee_type, available_coffee_types):
                    return f"Sorry, we don't offer {coffee_type}. Available options are: {', '.join(available_coffee_types)}. Please text MENU for full options."

            # Validate milk type
            milk_type = order_details.get("milk", "")
            if milk_type:
                available_milk_types = self._get_available_milk_types()
                if not self._is_valid_milk_type(milk_type, available_milk_types):
                    return f"Sorry, we don't have {milk_type} milk. Available options are: {', '.join(available_milk_types)}. Please text MENU for full options."

            # Validate sweetener
            sweetener = order_details.get("sugar", "")
            if sweetener:
                available_sweeteners = self._get_available_sweeteners()
                if not self._is_valid_sweetener(sweetener, available_sweeteners):
                    sweetener_names = [s[0] for s in available_sweeteners]
                    return f"Sorry, we don't have {sweetener}. Available options are: {', '.join(sweetener_names)}. Please text MENU for full options."

        # Get customer info
        customer = self.get_customer(phone)
        name = customer.get("name", "") if customer else ""

        # Returning customer who texted a drink — fill any gaps and auto-place
        # (no YES step). _next_order_step asks only for anything still missing.
        if "type" in order_details and name:
            return self._next_order_step(
                phone, name, order_details, prefix=f"Welcome back, {name}! "
            )

        # If we have customer name but not a complete order
        if name:
            # Check if message contains coffee type
            if "type" in order_details:
                # Save coffee type and continue conversation
                state_data = {"name": name, "order_details": order_details}
                self._set_conversation_state(phone, "awaiting_milk", state_data)

                return f"Welcome back, {name}! What type of milk would you like with your {order_details['type']}?"
            else:
                # Get usual order suggestions
                usual_suggestions = self._get_usual_order_suggestion(phone, name)
                if usual_suggestions:
                    # Set state with suggestion context
                    self._set_conversation_state(
                        phone,
                        "awaiting_coffee_type",
                        {"name": name, "suggestion_context": "usual_order"},
                    )
                    return f"Welcome back, {name}! {usual_suggestions}"
                else:
                    # Just welcome them back and ask for coffee
                    self._set_conversation_state(
                        phone, "awaiting_coffee_type", {"name": name}
                    )
                    return f"Welcome back, {name}! What type of coffee would you like today?"

        # New customer: we already parsed any order above. Try to pull a name
        # from the same message so "John large latte" doesn't make them start
        # over. Skip-ahead only when there's a drink (high signal).
        if order_details.get("type"):
            extracted_name, _ = self._extract_name_and_order(message)
            if extracted_name:
                return self._next_order_step(
                    phone,
                    extracted_name,
                    order_details,
                    prefix=f"Thanks {extracted_name}! ",
                )
            self._set_conversation_state(
                phone, "awaiting_name", {"order_details": order_details}
            )
            return "Got it! And what's your first name?"

        # Nothing usable yet — welcome + ask for name.
        self._set_conversation_state(phone, "awaiting_name")

        # Get welcome message from settings or use default if not available
        welcome_message = self._get_setting(
            "sms_welcome_message",
            f"Welcome to {{event_name}}! I'll take your coffee order. What's your first name?",
        )
        # Replace event_name placeholder with actual event name
        return (
            welcome_message.replace("{event_name}", self.event_name)
            + self._sms_first_message_hint()
        )

    def _get_setting(self, key, default_value=None):
        """Get a setting from the database

        Args:
            key: Setting key
            default_value: Default value if setting not found

        Returns:
            Setting value or default value if not found
        """
        # Check cache first if available
        if hasattr(self, "settings_cache") and key in self.settings_cache:
            return self.settings_cache[key]

        try:
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            result = cursor.fetchone()

            if result and result[0]:
                # Cache the result if cache exists
                if hasattr(self, "settings_cache"):
                    self.settings_cache[key] = result[0]
                return result[0]
            else:
                # Cache the default if cache exists
                if hasattr(self, "settings_cache"):
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
                cursor.execute(
                    "UPDATE settings SET value = %s WHERE key = %s", (value, key)
                )
            else:
                # Insert new setting
                cursor.execute(
                    "INSERT INTO settings (key, value) VALUES (%s, %s)", (key, value)
                )

            self.db.commit()

            # Update cache if it exists
            if hasattr(self, "settings_cache"):
                self.settings_cache[key] = value

            return True

        except Exception as e:
            logger.error(f"Error saving setting '{key}': {str(e)}")
            return False

    # --- SMS abuse protection (manual blocklist + inbound burst throttle) ---
    # Every inbound SMS triggers a paid outbound reply, so a flood would burn
    # Twilio credit. Two layers: a manual BLOCKLIST (an operator bans a number —
    # the bot ignores it, zero reply cost) and an automatic BURST THROTTLE that
    # pauses replies to any number texting faster than a human possibly could,
    # then alerts a barista. The thresholds are deliberately generous so a
    # legit-but-chatty customer (MENU / VIP / FRIEND group orders / correcting
    # an order — all of which wait for a reply between texts) never trips it;
    # only machine-gun automation does. After the pause the number is served
    # again automatically, so a false positive self-heals.
    _SMS_BURST_MAX = 12  # > this many messages...
    _SMS_BURST_WINDOW = 60  # ...within this many seconds → trip
    _SMS_SUSTAINED_MAX = 60  # backstop: > this many messages...
    _SMS_SUSTAINED_WINDOW = 600  # ...within this many seconds → trip
    _SMS_PAUSE_SECONDS = 600  # silence (no replies) after a trip

    def _load_sms_blocklist(self):
        """Return the blocklist as {normalised_phone: {reason, by, at}} — read
        FRESH from the settings table (not the cache) so a just-blocked number
        takes effect immediately."""
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = 'sms_blocklist'")
            row = cursor.fetchone()
            if not row or not row[0]:
                return {}
            raw = row[0] if not isinstance(row, dict) else row.get("value")
            data = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(data, dict):
                return data
            if isinstance(data, list):  # legacy plain-list shape
                return {p: {} for p in data}
            return {}
        except Exception as e:
            logger.warning(f"_load_sms_blocklist failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return {}

    def is_sms_blocked(self, phone):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        return p in self._load_sms_blocklist()

    def block_sms_number(self, phone, reason="", by=""):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        bl = self._load_sms_blocklist()
        bl[p] = {
            "reason": reason or "",
            "by": by or "",
            "at": datetime.now().isoformat(),
        }
        self._set_setting("sms_blocklist", json.dumps(bl))
        logger.info(f"SMS number blocked: {p} (by={by!r}, reason={reason!r})")
        return p

    def unblock_sms_number(self, phone):
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        bl = self._load_sms_blocklist()
        if p in bl:
            del bl[p]
            self._set_setting("sms_blocklist", json.dumps(bl))
            logger.info(f"SMS number unblocked: {p}")
            return True
        return False

    def get_sms_blocklist(self):
        bl = self._load_sms_blocklist()
        return [
            {"phone": p, **(v if isinstance(v, dict) else {})} for p, v in bl.items()
        ]

    def register_inbound_sms(self, phone, now_ts=None):
        """Record an inbound SMS and decide how to treat it. Returns:
          'ok'      — handle normally (reply)
          'blocked' — on the manual blocklist (ignore, no reply)
          'paused'  — within cooldown from an earlier burst trip (ignore)
          'tripped' — JUST crossed the burst/sustained threshold (ignore + alert)
        In-memory per-number sliding window on the singleton; `now_ts` is
        overridable for tests."""
        ts = now_ts if now_ts is not None else datetime.now().timestamp()
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone

        if self.is_sms_blocked(p):
            return "blocked"

        pauses = getattr(self, "_sms_pause_until", None)
        if pauses is None:
            pauses = {}
            self._sms_pause_until = pauses
        log = getattr(self, "_sms_inbound_log", None)
        if log is None:
            log = {}
            self._sms_inbound_log = log

        # Still cooling down from a previous trip?
        until = pauses.get(p, 0)
        if until and ts < until:
            return "paused"

        # Append this timestamp, pruning anything older than the larger window.
        window = max(self._SMS_BURST_WINDOW, self._SMS_SUSTAINED_WINDOW)
        times = [t for t in log.get(p, []) if ts - t <= window]
        times.append(ts)
        log[p] = times

        burst = sum(1 for t in times if ts - t <= self._SMS_BURST_WINDOW)
        sustained = len(times)  # already pruned to the larger window
        if burst > self._SMS_BURST_MAX or sustained > self._SMS_SUSTAINED_MAX:
            pauses[p] = ts + self._SMS_PAUSE_SECONDS
            log[p] = []  # reset so post-cooldown counting starts clean
            self._last_sms_burst_count = burst
            return "tripped"
        return "ok"

    def sms_spam_alert(self, phone, burst_count=None):
        """Post a ONE-OFF alert into the barista Messages inbox
        (customer_questions) when a number is auto-paused, so a human can judge
        spam vs a real customer who needs help. Mirrors
        _forward_question_to_baristas' insert + WS event. Never raises."""
        try:
            p = self._normalize_phone(phone)
        except Exception:
            p = phone
        n = (
            burst_count
            or getattr(self, "_last_sms_burst_count", 0)
            or self._SMS_BURST_MAX
        )
        mins = self._SMS_PAUSE_SECONDS // 60
        msg = (
            f"{p} sent {n}+ texts very fast and was auto-paused for {mins} "
            f"min to protect SMS credit. If it's a real customer who needs "
            f"help, assist them at the counter — replies resume automatically "
            f"after the pause. If it's spam, block the number."
        )
        try:
            try:
                self.db.rollback()
            except Exception:
                pass
            cursor = self.db.cursor()
            cursor.execute(
                """INSERT INTO customer_questions
                     (phone, customer_name, question, status, created_at)
                   VALUES (%s, %s, %s, 'pending', %s) RETURNING id, created_at""",
                (p, "⚠️ Possible SMS spam", msg, datetime.now()),
            )
            row = cursor.fetchone()
            self.db.commit()
            qid = row[0] if row else None
            created = row[1] if row else datetime.now()
        except Exception as e:
            logger.error(f"sms_spam_alert insert failed: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return
        try:
            from flask import current_app as _ca

            socketio = _ca.config.get("socketio") if _ca else None
            if socketio:
                socketio.emit(
                    "customer_question",
                    {
                        "id": qid,
                        "phone": p,
                        "customer_name": "⚠️ Possible SMS spam",
                        "customerName": "⚠️ Possible SMS spam",
                        "question": msg,
                        "created_at": created.isoformat() + "Z"
                        if hasattr(created, "isoformat")
                        else str(created),
                        "createdAt": created.isoformat() + "Z"
                        if hasattr(created, "isoformat")
                        else str(created),
                    },
                    room="orders",
                )
        except Exception as ws_err:
            logger.debug(f"sms_spam_alert WS emit skipped: {ws_err}")

    @property
    def db(self):
        """The shared database connection, revived if it has died.

        This object is created ONCE at boot and handed to CoffeeOrderSystem,
        then used by ~460 call sites. There was no liveness check anywhere:
        when the connection died, every one of those call sites failed with
        "connection already closed" until somebody restarted the app.

        Seen in production on 23 Aug, hours after the outage: /api/health was
        200 (it does not touch this connection) while /api/orders,
        /api/stations and /api/reports/today all returned 500. Endpoints that
        take a fresh pooled connection kept working, which is what pinned it
        to this singleton rather than to Postgres.

        The pool in utils.database already recovers from a dead pool. This
        gives the singleton the same property, in one place instead of 460.
        """
        conn = self._db
        try:
            if conn is not None and not getattr(conn, "closed", 0):
                return conn
        except Exception:
            pass

        # Dead or missing — take a fresh one. Never raise from here: a
        # failed revive should surface as the caller's own error, not as an
        # AttributeError from a property.
        try:
            from utils.database import get_db_connection

            new_conn = get_db_connection()
            if new_conn is not None:
                logger.warning("Shared DB connection was closed; reconnected.")
                self._db = new_conn
        except Exception as e:
            logger.error("Could not revive the shared DB connection: %s", e)
        return self._db

    @db.setter
    def db(self, value):
        self._db = value

    def _normalize_phone(self, phone):
        """Normalize phone number format"""
        # Remove any non-digit characters
        digits = re.sub(r"\D", "", phone)

        # For Australian numbers, ensure they start with +61
        if digits.startswith("0"):
            return "+61" + digits[1:]
        elif not digits.startswith("+"):
            return "+" + digits

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
        last = (
            state_obj.get("last_interaction") if isinstance(state_obj, dict) else None
        )
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
                    last = datetime.strptime(last.split(".")[0], "%Y-%m-%d %H:%M:%S")
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
                return {"state": None, "temp_data": {}, "message_count": 0}
            return cached

        # Check if we're using SQLite or PostgreSQL
        is_sqlite = isinstance(self.db, sqlite3.Connection)
        db_type = "sqlite" if is_sqlite else "postgres"

        # Otherwise, check database
        try:
            cursor = self.db.cursor()

            # Use the appropriate parameter style for the database type
            if is_sqlite:
                cursor.execute(
                    """
                    SELECT state, temp_data, last_interaction, message_count
                    FROM conversation_states
                    WHERE phone = ?
                """,
                    (phone,),
                )
            else:
                cursor.execute(
                    """
                    SELECT state, temp_data, last_interaction, message_count
                    FROM conversation_states
                    WHERE phone = %s
                """,
                    (phone,),
                )

            result = cursor.fetchone()

            if result:
                # Get values from result - may be a tuple or a dict depending on cursor type
                if isinstance(result, dict):
                    state = result.get("state")
                    temp_data_str = result.get("temp_data")
                    last_interaction = result.get("last_interaction")
                    message_count = result.get("message_count", 0)
                else:
                    state, temp_data_str, last_interaction, message_count = result

                # Parse JSON temp data
                try:
                    temp_data = json.loads(temp_data_str) if temp_data_str else {}
                except Exception as json_err:
                    logger.error(
                        f"Error parsing JSON in conversation state: {str(json_err)}"
                    )
                    temp_data = {}

                # Create state object
                state_obj = {
                    "state": state,
                    "temp_data": temp_data,
                    "last_interaction": last_interaction,
                    "message_count": int(message_count) if message_count else 0,
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
                    return {"state": None, "temp_data": {}, "message_count": 0}

                # Cache in memory
                self.conversation_states[phone] = state_obj

                return state_obj

            # No state found - return empty state
            return {"state": None, "temp_data": {}, "message_count": 0}

        except Exception as e:
            logger.error(f"Error getting conversation state: {str(e)}")
            return {"state": None, "temp_data": {}, "message_count": 0}

    def _set_conversation_state(self, phone, state, temp_data=None):
        """Update the conversation state for a phone number"""
        # Update in-memory cache
        now = datetime.now()

        # Get existing state to update message count
        existing = self._get_conversation_state(phone)
        message_count = existing.get("message_count", 0) + 1

        # Create state object
        state_obj = {
            "state": state,
            "temp_data": temp_data or {},
            "last_interaction": now,
            "message_count": message_count,
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
                cursor.execute(
                    "SELECT phone FROM conversation_states WHERE phone = ?", (phone,)
                )
            else:
                cursor.execute(
                    "SELECT phone FROM conversation_states WHERE phone = %s", (phone,)
                )

            result = cursor.fetchone()

            if result:
                # Update existing state
                if is_sqlite:
                    cursor.execute(
                        """
                        UPDATE conversation_states
                        SET state = ?, temp_data = ?, last_interaction = ?, message_count = ?
                        WHERE phone = ?
                    """,
                        (state, temp_data_json, now, message_count, phone),
                    )
                else:
                    cursor.execute(
                        """
                        UPDATE conversation_states
                        SET state = %s, temp_data = %s, last_interaction = %s, message_count = %s
                        WHERE phone = %s
                    """,
                        (state, temp_data_json, now, message_count, phone),
                    )
            else:
                # Insert new state
                if is_sqlite:
                    cursor.execute(
                        """
                        INSERT INTO conversation_states
                        (phone, state, temp_data, last_interaction, message_count)
                        VALUES (?, ?, ?, ?, ?)
                    """,
                        (phone, state, temp_data_json, now, message_count),
                    )
                else:
                    cursor.execute(
                        """
                        INSERT INTO conversation_states
                        (phone, state, temp_data, last_interaction, message_count)
                        VALUES (%s, %s, %s, %s, %s)
                    """,
                        (phone, state, temp_data_json, now, message_count),
                    )

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
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'pending' AND station_id = %s
                    ORDER BY queue_priority, created_at
                """,
                    (station_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'pending'
                    ORDER BY queue_priority, created_at
                """
                )

            orders = cursor.fetchall()

            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order["order_details"] and isinstance(order["order_details"], str):
                    order["order_details"] = json.loads(order["order_details"])

                # Calculate wait time
                if order["created_at"]:
                    created_at = order["created_at"]
                    order["wait_time"] = int(
                        (datetime.now() - created_at).total_seconds() / 60
                    )

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
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'in-progress' AND station_id = %s
                    ORDER BY created_at
                """,
                    (station_id,),
                )
            else:
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'in-progress'
                    ORDER BY created_at
                """
                )

            orders = cursor.fetchall()

            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order["order_details"] and isinstance(order["order_details"], str):
                    order["order_details"] = json.loads(order["order_details"])

                # Calculate wait time
                if order["created_at"]:
                    created_at = order["created_at"]
                    order["wait_time"] = int(
                        (datetime.now() - created_at).total_seconds() / 60
                    )

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
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'completed' AND station_id = %s
                    ORDER BY updated_at DESC
                    LIMIT %s
                """,
                    (station_id, limit),
                )
            else:
                cursor.execute(
                    """
                    SELECT * FROM orders 
                    WHERE status = 'completed'
                    ORDER BY updated_at DESC
                    LIMIT %s
                """,
                    (limit,),
                )

            orders = cursor.fetchall()

            # Process orders
            result = []
            for order in orders:
                # Parse order details
                if order["order_details"] and isinstance(order["order_details"], str):
                    order["order_details"] = json.loads(order["order_details"])

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
            if order["order_details"] and isinstance(order["order_details"], str):
                order["order_details"] = json.loads(order["order_details"])

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
            cursor.execute(
                "SELECT * FROM orders WHERE order_number = %s", (order_number,)
            )
            order = cursor.fetchone()

            if not order:
                return None

            # Parse order details
            if order["order_details"] and isinstance(order["order_details"], str):
                order["order_details"] = json.loads(order["order_details"])

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
            cursor.execute(
                """
                SELECT status, station_id, created_at 
                FROM orders 
                WHERE id = %s
            """,
                (order_id,),
            )

            result = cursor.fetchone()

            if not result:
                logger.error(f"Order {order_id} not found")
                return False

            current_status, station_id, created_at = result

            # Calculate completion time if completing
            completion_time = None
            if status == "completed" and current_status != "completed":
                completion_time = int((datetime.now() - created_at).total_seconds())

            # Update order status
            cursor.execute(
                """
                UPDATE orders 
                SET status = %s, 
                    updated_at = %s, 
                    last_modified_by = %s
                WHERE id = %s
            """,
                (status, datetime.now(), editor or "system", order_id),
            )

            # If completing order, update completion time and completion date
            if completion_time:
                cursor.execute(
                    """
                    UPDATE orders 
                    SET completion_time = %s, 
                        completed_at = %s
                    WHERE id = %s
                """,
                    (completion_time, datetime.now(), order_id),
                )

            # Update station load
            if status in ["completed", "cancelled"] and current_status not in [
                "completed",
                "cancelled",
            ]:
                self._update_station_load(station_id, increment=False)
            elif status == "in-progress" and current_status == "pending":
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
            prefix = (
                "W" if now.hour < 12 else "E"
            )  # W for Walk-in Morning, E for walk-in Evening
            order_number = f"{prefix}{now.strftime('%H%M%S')}{now.microsecond // 10000}"

            # Assign to a station
            station_id = order_data.get("station_id", None)
            if not station_id:
                station_result = self._assign_station(order_data.get("vip", False))
                if isinstance(station_result, tuple):
                    station_id, is_delayed = station_result
                else:
                    station_id = station_result

                if station_id is None:
                    logger.error("No stations available for walk-in order")
                    raise Exception(
                        "No coffee stations are currently available. Please create stations through the Organizer interface."
                    )

            # Process and validate order details
            if "order_details" not in order_data:
                order_data["order_details"] = {}

            # Ensure order_details is a dictionary
            if isinstance(order_data["order_details"], str):
                order_data["order_details"] = json.loads(order_data["order_details"])

            # Add basic details if not present
            # Barista-entered walk-in. The frontend already sends
            # source='walkin'; this records it in the closed vocabulary so
            # reports do not have to know that spelling.
            stamp_provenance(
                order_data["order_details"],
                "barista",
                order_data.get("src") or order_data.get("source_code"),
            )
            if "name" not in order_data["order_details"]:
                order_data["order_details"]["name"] = order_data.get(
                    "customer_name", "Walk-in Customer"
                )

            # Add order number
            order_data["order_number"] = order_number

            # Set timestamps
            order_data["created_at"] = now
            order_data["updated_at"] = now

            # Set status
            order_data["status"] = "pending"

            # Insert into database
            cursor = self.db.cursor()

            # Prepare data for insertion
            fields = []
            placeholders = []
            values = []

            for key, value in order_data.items():
                if key == "order_details":
                    # JSON encode order details
                    fields.append(key)
                    placeholders.append("%s")
                    values.append(json.dumps(value))
                elif key not in ["id"]:  # Skip fields that shouldn't be inserted
                    fields.append(key)
                    placeholders.append("%s")
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
            cursor.execute(
                """
                SELECT * FROM customer_preferences
                WHERE phone = %s
            """,
                (phone,),
            )

            customer = cursor.fetchone()

            if not customer:
                return self._ea_attendee_as_customer(phone)

            return dict(customer)

        except Exception as e:
            logger.error(f"Error getting customer: {str(e)}")
            return None

    def _ea_attendee_as_customer(self, phone):
        """EventsAir registration-list fallback (research Phase 1.3).

        A first-time texter whose mobile matches the event's synced
        attendee mirror is treated as a known customer: greeted by first
        name, no name question, and their orders carry the name from
        registration. Unmatched numbers behave exactly as before.

        Data-driven, no feature flag: the ea_attendees mirror is empty
        until the EA integration is configured and synced, so this is a
        no-op today. to_regclass avoids an exception (and the transaction
        poisoning that comes with it) when the table doesn't exist yet.
        """
        try:
            from services.eventsair.survey import normalize_phone_e164

            e164 = normalize_phone_e164(phone)
            if not e164:
                return None
            cursor = self.db.cursor(cursor_factory=RealDictCursor)
            cursor.execute("SELECT to_regclass('ea_attendees') IS NOT NULL AS ok")
            row = cursor.fetchone()
            if not (row and row.get("ok")):
                return None
            cursor.execute(
                "SELECT ea_contact_id, first_name, last_name FROM ea_attendees "
                "WHERE mobile_e164 = %s LIMIT 1",
                (e164,),
            )
            att = cursor.fetchone()
            if not att:
                return None
            first = (att.get("first_name") or "").strip()
            if not first:
                return None
            return {
                "phone": phone,
                "name": first,
                "ea_contact_id": att.get("ea_contact_id"),
                "ea_matched": True,
            }
        except Exception as e:
            logger.warning(f"EA attendee lookup failed (non-fatal): {e}")
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
                cursor.execute(
                    """
                    SELECT * FROM customer_preferences
                    WHERE name ILIKE %s OR phone ILIKE %s
                    ORDER BY last_order_date DESC
                    LIMIT %s
                """,
                    (f"%{search}%", f"%{search}%", limit),
                )
            else:
                # Get all customers
                cursor.execute(
                    """
                    SELECT * FROM customer_preferences
                    ORDER BY last_order_date DESC
                    LIMIT %s
                """,
                    (limit,),
                )

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
                cursor.execute(
                    """
                    SELECT * FROM station_stats
                    WHERE station_id = %s
                """,
                    (station_id,),
                )

                stats = cursor.fetchone()

                if not stats:
                    return None

                return dict(stats)
            else:
                # Get all stations
                cursor.execute(
                    """
                    SELECT * FROM station_stats
                    ORDER BY station_id
                """
                )

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
            cursor.execute(
                """
                UPDATE station_stats
                SET wait_time = %s, last_updated = %s
                WHERE station_id = %s
            """,
                (wait_time, datetime.now(), station_id),
            )

            self.db.commit()
            return True

        except Exception as e:
            self.db.rollback()
            logger.error(f"Error updating wait time: {str(e)}")
            return False

    def add_loyalty_points(
        self, phone, points, order_id=None, transaction_type="earned", notes=None
    ):
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
            cursor.execute(
                "SELECT loyalty_points FROM customer_preferences WHERE phone = %s",
                (phone,),
            )
            result = cursor.fetchone()

            now = datetime.now()

            if result:
                # Update existing customer
                cursor.execute(
                    """
                    UPDATE customer_preferences
                    SET loyalty_points = loyalty_points + %s,
                        last_order_date = %s
                    WHERE phone = %s
                """,
                    (points, now, phone),
                )
            else:
                # Create new customer
                cursor.execute(
                    """
                    INSERT INTO customer_preferences
                    (phone, loyalty_points, first_order_date, last_order_date)
                    VALUES (%s, %s, %s, %s)
                """,
                    (phone, points, now, now),
                )

            # Record transaction
            cursor.execute(
                """
                INSERT INTO loyalty_transactions
                (phone, points, transaction_type, order_id, created_at, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            """,
                (phone, points, transaction_type, order_id, now, notes),
            )

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
            cursor.execute(
                """
                SELECT loyalty_points, loyalty_free_drinks, total_orders
                FROM customer_preferences
                WHERE phone = %s
            """,
                (phone,),
            )

            result = cursor.fetchone()

            if not result:
                return {"points": 0, "free_coffees": 0, "progress": 0}

            loyalty_points, free_drinks, total_orders = result

            # Get points needed from config
            points_needed = self.config.get("LOYALTY_POINTS_FOR_FREE_COFFEE", 100)

            # Calculate free coffees and progress
            free_coffees = loyalty_points // points_needed
            progress = (loyalty_points % points_needed) / points_needed * 100

            return {
                "points": loyalty_points,
                "free_coffees": free_coffees,
                "progress": progress,
                "free_drinks": free_drinks or 0,
                "total_orders": total_orders or 0,
            }

        except Exception as e:
            logger.error(f"Error getting loyalty status: {str(e)}")
            return {"points": 0, "free_coffees": 0, "progress": 0, "error": str(e)}

    def batch_process_orders(self, order_ids, action="start"):
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
                if action == "start":
                    if self.update_order_status(
                        order_id, "in-progress", "batch_process"
                    ):
                        success_count += 1
                elif action == "complete":
                    if self.update_order_status(order_id, "completed", "batch_process"):
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
            cursor.execute(
                "SELECT order_details, edit_history FROM orders WHERE id = %s",
                (order_id,),
            )
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
                "timestamp": datetime.now().isoformat(),
                "editor": editor or "system",
                "previous": current_details.copy(),
                "changes": updated_details,
            }

            # Add to history
            edit_history.append(edit_record)

            # Update order details
            for key, value in updated_details.items():
                current_details[key] = value

            # Save to database
            cursor.execute(
                """
                UPDATE orders
                SET order_details = %s,
                    edit_history = %s,
                    updated_at = %s,
                    last_modified_by = %s
                WHERE id = %s
            """,
                (
                    json.dumps(current_details),
                    json.dumps(edit_history),
                    datetime.now(),
                    editor or "system",
                    order_id,
                ),
            )

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
            cursor.execute(
                """
                SELECT
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                    SUM(CASE WHEN status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_count,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_count,
                    AVG(completion_time) as avg_completion_time
                FROM orders
            """
            )

            order_stats = cursor.fetchone()

            # Get customer count
            cursor.execute("SELECT COUNT(*) FROM customer_preferences")
            customer_count = cursor.fetchone()[0]

            # Get today's orders
            today = datetime.now().date()
            cursor.execute(
                """
                SELECT COUNT(*) 
                FROM orders 
                WHERE DATE(created_at) = %s
            """,
                (today,),
            )

            todays_orders = cursor.fetchone()[0]

            # Get active stations
            cursor.execute(
                """
                SELECT COUNT(*) 
                FROM station_stats 
                WHERE status = 'active'
            """
            )

            active_stations = cursor.fetchone()[0]

            return {
                "total_orders": order_stats[0] or 0,
                "pending_count": order_stats[1] or 0,
                "in_progress_count": order_stats[2] or 0,
                "completed_count": order_stats[3] or 0,
                "avg_completion_time": order_stats[4] or 0,
                "customer_count": customer_count or 0,
                "todays_orders": todays_orders or 0,
                "active_stations": active_stations or 0,
            }

        except Exception as e:
            logger.error(f"Error getting system stats: {str(e)}")
            return {"error": str(e)}

    # Privacy Command Handlers
    def _handle_mydata_command(self, phone):
        """Handle MYDATA command - show customer their stored data"""
        try:
            customer = self.get_customer(phone)

            if not customer:
                return "No data found for your phone number. Start your first order to get personalized service!"

            # Format the response
            name = customer.get("name", "Unknown")
            drink = customer.get("preferred_drink", "Not set")
            milk = customer.get("preferred_milk", "Not set")
            size = customer.get("preferred_size", "Not set")
            sugar = customer.get("preferred_sugar", "Not set")
            total_orders = customer.get("total_orders", 0)
            first_order = customer.get("first_order_date", "Unknown")

            # Format date nicely
            if first_order != "Unknown":
                try:
                    first_order_date = datetime.strptime(
                        str(first_order), "%Y-%m-%d %H:%M:%S"
                    )
                    first_order = first_order_date.strftime("%b %Y")
                except:
                    pass

            response = f"""Your {self.system_name} Profile:
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
            cursor.execute(
                "SELECT name FROM customer_preferences WHERE phone = %s", (phone,)
            )
            result = cursor.fetchone()

            if result:
                # Update existing customer
                cursor.execute(
                    """
                    UPDATE customer_preferences
                    SET name = %s
                    WHERE phone = %s
                """,
                    (new_name, phone),
                )
            else:
                # Create new customer with just name
                cursor.execute(
                    """
                    INSERT INTO customer_preferences
                    (phone, name, first_order_date, last_order_date, total_orders)
                    VALUES (%s, %s, %s, %s, 0)
                """,
                    (phone, new_name, datetime.now(), datetime.now()),
                )

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
            cursor.execute(
                "SELECT name FROM customer_preferences WHERE phone = %s", (phone,)
            )
            result = cursor.fetchone()

            if not result:
                return "No preferences found to reset."

            name = result[0]

            # Reset preferences but keep name
            cursor.execute(
                """
                UPDATE customer_preferences
                SET preferred_drink = NULL,
                    preferred_milk = NULL,
                    preferred_size = NULL,
                    preferred_sugar = NULL
                WHERE phone = %s
            """,
                (phone,),
            )

            self.db.commit()

            return f"✅ Preferences cleared!\nWe'll ask for your order details next time.\nYour name ({name}) is still saved."

        except Exception as e:
            logger.error(f"Error in RESET command: {str(e)}")
            self.db.rollback()
            return "Sorry, couldn't reset your preferences. Please try again."

    def _handle_delete_command(self, phone, state):
        """Handle DELETE command - request to delete all customer data"""
        # Check if we're already in deletion confirmation state
        if state.get("state") == "awaiting_deletion_confirmation":
            return None  # Let the normal state handler deal with YES/NO

        # Set state to await confirmation
        self._set_conversation_state(phone, "awaiting_deletion_confirmation")

        return "This will delete all your data including order history.\nReply YES to confirm deletion or NO to cancel."

    def _handle_awaiting_deletion_confirmation(self, phone, message, state):
        """Handle deletion confirmation"""
        message_upper = message.upper().strip()

        if message_upper == "YES":
            try:
                cursor = self.db.cursor()

                # Delete customer preferences
                cursor.execute(
                    "DELETE FROM customer_preferences WHERE phone = %s", (phone,)
                )
                deleted_count = cursor.rowcount

                # Note: We keep order history for business records, but it's no longer linked to preferences

                self.db.commit()

                # Clear conversation state
                self._set_conversation_state(phone, "completed")

                if deleted_count > 0:
                    return f"Your data has been deleted. Thanks for using {self.system_name}."
                else:
                    return "No data found to delete."

            except Exception as e:
                logger.error(f"Error deleting customer data: {str(e)}")
                self.db.rollback()
                return "Sorry, couldn't delete your data. Please contact support."

        elif message_upper == "NO":
            # Cancel deletion
            self._set_conversation_state(phone, "completed")
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
            cursor.execute(
                """
                SELECT id, order_number, order_details, station_id, created_at
                FROM orders
                WHERE phone = %s 
                AND created_at > %s
                ORDER BY created_at DESC
                LIMIT 1
            """,
                (phone, datetime.now() - timedelta(hours=1)),
            )

            recent_order = cursor.fetchone()

            if not recent_order:
                return f"Hi {primary_name}! Please place your own order first, then you can add coffees for friends."

            # Parse the recent order details
            (
                order_id,
                order_number,
                order_details_json,
                station_id,
                created_at,
            ) = recent_order

            if isinstance(order_details_json, str):
                primary_order = json.loads(order_details_json)
            else:
                primary_order = order_details_json or {}

            # If the conversation is ALREADY mid-group (this is the 2nd/3rd
            # FRIEND of one group), carry the existing group context forward.
            # Resetting it here dropped every earlier friend (DONE said
            # "group order of 2 coffees" for a group of 3 — Test Bench
            # customer suite caught it), and re-deriving group_id from the
            # MOST RECENT order linked the new friend to the PREVIOUS
            # friend's order number, silently splitting the barista's group
            # badge into two groups.
            prev = (state.get("temp_data") or {}) if state else {}
            if prev.get("group_orders") or prev.get("group_id"):
                group_id = prev.get("group_id") or order_number
                group_label = prev.get("group_label") or f"{primary_name}'s group"
                group_orders = prev.get("group_orders") or []
                primary_order = prev.get("primary_order") or primary_order
                primary_name = prev.get("primary_name") or primary_name
                station_id = prev.get("station_id") or station_id
                reference_order = prev.get("reference_order") or order_number
            else:
                # Fresh group: form it around the customer's own order. The
                # group_id is the primary's order number (e.g. "C5") — short,
                # already shouted across the bar, and unique per event.
                # Retro-link the primary now so even a one-friend group shows
                # the badge on BOTH cards.
                group_id = order_number
                group_label = f"{primary_name}'s group"
                group_orders = []
                reference_order = order_number
                self._ensure_group_id_on_order(
                    order_id=order_id,
                    order_number=order_number,
                    group_id=group_id,
                    group_label=group_label,
                )

            # Start friend order flow
            self._set_conversation_state(
                phone,
                "awaiting_friend_name",
                {
                    "primary_name": primary_name,
                    "primary_order": primary_order,
                    "group_orders": group_orders,
                    "station_id": station_id,
                    "reference_order": reference_order,
                    "group_id": group_id,
                    "group_label": group_label,
                },
            )

            return f"Great! Let's add a coffee for your friend. What's their name?"

        except Exception as e:
            logger.error(f"Error in FRIEND command: {str(e)}")
            return "Sorry, couldn't process your request. Please try again."
