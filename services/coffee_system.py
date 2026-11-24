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

from services.sms_wording import say  # the bot's editable wording (X7-6)

# Replies that are never a first name (see _handle_awaiting_name).
_NOT_A_NAME = {
    "yes", "yeah", "yep", "yup", "y", "no", "nope", "nah", "n", "ok", "okay",
    "k", "none", "nothing", "thanks", "thank you", "thx", "ta", "cheers",
    "sure", "please", "done", "hello", "hi", "hey",
}
logger = logging.getLogger("expresso.services.coffee_system")


def _milk_key(name):
    """A milk's one name: lowercase, without a trailing "milk" ("Oat Milk"
    -> "oat", "Full Cream Milk" -> "full cream"). "no milk" -> "" so it is
    never offered as a milk (the phantom 'no' milk, matrix mx07)."""
    s = re.sub(r"\s+", " ", str(name or "").strip().lower())
    if s in ("no milk", "none", "black"):
        return ""
    return re.sub(r"\s*\bmilk$", "", s).strip()


def _unique_milk_keys(names):
    """_milk_key of each, blanks dropped, first spelling's order kept."""
    out, seen = [], set()
    for n in names:
        k = _milk_key(n)
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


# What the product used to be called. A copy that saved one of these (an
# older Branding default) is still "CupQ": no client picks these, and
# demo.cupq.app showed "powered by Coffee Cue" because of one.
OLD_PRODUCT_NAMES = {"coffee cue", "coffee cue ordering system", "expresso coffee system",
                     "expresso", "coffeecue"}


def is_old_product_name(name):
    return str(name or "").strip().lower() in OLD_PRODUCT_NAMES

# CoffeeOrderSystem's methods live in services/coffee/, one mixin per area
# (roadmap X7-11). Imported here, after the helpers above, which they use.
from services.coffee.commands import CommandsMixin  # noqa: E402
from services.coffee.conversation import ConversationMixin  # noqa: E402
from services.coffee.friends import FriendsMixin  # noqa: E402
from services.coffee.menu import MenuMixin  # noqa: E402
from services.coffee.placing import PlacingMixin  # noqa: E402
from services.coffee.stock import StockMixin  # noqa: E402
from services.coffee.wait_times import WaitTimesMixin  # noqa: E402
from services.coffee.sms_guard import SmsGuardMixin  # noqa: E402
from services.coffee.state import StateMixin  # noqa: E402
from services.coffee.staff import StaffMixin  # noqa: E402


class CoffeeOrderSystem(
    CommandsMixin,
    ConversationMixin,
    FriendsMixin,
    MenuMixin,
    PlacingMixin,
    StockMixin,
    WaitTimesMixin,
    SmsGuardMixin,
    StateMixin,
    StaffMixin,
):
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
        """Live event name - reads branding_settings on each access.

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
                    if candidate and not is_old_product_name(candidate):
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
        logger.info(f"SMS received from {phone} ({len(message_body or '')} chars)")

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


    # Scheduled orders drop into the barista queue this many minutes
    # before the customer's stated arrival, so the coffee is fresh when
    # they walk up rather than made the moment they text.
    ETA_PREP_LEAD_MIN = 5


    # Default reply when a pre-event pre-order is saved. Editable by the
    # organiser (settings KV 'pre_event_settings'.message); placeholders
    # {name} {order} {event} are substituted. Plain ASCII (SMS cost).
    PRE_EVENT_DEFAULT_MESSAGE = (
        "Thanks {name}! We've saved your {order} for {event}. "
        "On event day, text this number when you arrive and we'll get "
        "your order underway."
    )


    # Plain ASCII (SMS segment cost rule).
    @property
    def SUGAR_SELF_SERVE_NOTE(self):
        return " " + say("sugar_self_serve")


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


    # Back-compat shim: existing code references self._STANDARD_DRINK_MENU
    # as if it were a list. Make it a property that calls the getter so
    # we don't have to find-and-replace every callsite in one go.
    @property
    def _STANDARD_DRINK_MENU(self):
        return self._get_espresso_drink_menu()


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


    _STANDARD_MILK_MENU = ["full cream", "skim", "oat", "almond", "lactose free", "soy"]


    # The Organiser writes display names ("Whole Milk", "Oat Milk"); the
    # rest of the system speaks in bare names ("full cream", "oat").
    # Normalise once, here, so the two vocabularies can be compared.
    _EVENT_NAME_ALIASES = {
        "whole": "full cream",
        "whole milk": "full cream",
        "regular": "full cream",
        "dairy": "full cream",
        # The Organiser's default row is "Lactose-Free Milk"; Quick Setup
        # and the stations say "lactose free". Without this the event list
        # never matched and lactose free vanished from the kiosk menu.
        "lactose-free": "lactose free",
    }


    # What counts as a bean row in the mixed 'coffee' category. The
    # category holds both drink-named rows (legacy) and real bean rows;
    # same test the walk-in dialog applies client-side.
    _BEAN_WORDS = re.compile(
        r"(bean|blend|roast|single\s*origin|decaf|colombian?|ethiopian?"
        r"|brazilian?|kenyan?|guatemalan?)", re.I)


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


    _STANDARD_SWEETENER_MENU = [
        ("no sugar", "sugar"),
        ("1 sugar", "sugar"),
        ("2 sugar", "sugar"),
        ("3 sugar", "sugar"),
        ("half sugar", "sugar"),
    ]


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


    @property
    def db(self):
        """The database connection for the current caller.

        PER-REQUEST POOLED CONNECTION (added 2026-09): inside a Flask
        request/SocketIO context, hand out a connection dedicated to THIS
        request, checked out from the pool and returned on teardown
        (app.py `_release_db_locks`). This is what lets the server serve
        requests concurrently: once psycopg is cooperative under eventlet
        (patch_psycopg in run_server.py), two requests sharing ONE
        connection would collide ("another command is already in progress"),
        so each request needs its own. Checkout is lazy — a request that
        never touches the DB never takes a connection from the pool.

        SHARED SINGLETON (unchanged) everywhere else — startup, the SMS
        conversation scheduler, background tasks — where there is no request
        context. Those are low-concurrency; the singleton is revived if it
        has died (the pool recovers a dead pool; this gives the singleton the
        same property, in one place instead of ~460 call sites). Historically
        this WAS the connection every handler used, and a closed singleton
        500'd /api/orders while /api/health (which touches nothing) stayed
        200 — see the git history for 23 Aug.
        """
        # --- request-scoped pooled connection ---
        # Kept on the REQUEST, not flask.g: a request made inside another
        # (/me/order and group orders place drinks through test_client)
        # shares g with the outer one, so the inner request used the outer's
        # connection and returned it at its teardown; the outer then returned
        # it again, the pool refused the duplicate and closed it, and the
        # next customer request drew a dead connection (500).
        try:
            from flask import has_request_context, request

            if has_request_context():
                req = request._get_current_object()
                conn = getattr(req, "_cupq_pooled_db", None)
                try:
                    if conn is not None and not getattr(conn, "closed", 0):
                        return conn
                except Exception:
                    pass
                from utils.database import get_db_connection

                conn = get_db_connection()
                if conn is not None:
                    req._cupq_pooled_db = conn
                    return conn
                # pool unavailable — fall through to the shared singleton
        except Exception as e:
            # Pool busy (every connection out, none back in time): fail
            # THIS request. Falling back to the shared singleton under load
            # puts dozens of concurrent requests on one connection, which
            # collide and poison it for the background SMS scheduler too.
            if type(e).__name__ == "_PoolBusy":
                raise
            # Any import/context problem: fall back to the singleton below.
            pass

        # --- shared singleton (non-request contexts) ---
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

            new_conn = get_db_connection(track=False)  # kept beyond any request
            if new_conn is not None:
                logger.warning("Shared DB connection was closed; reconnected.")
                self._db = new_conn
        except Exception as e:
            logger.error("Could not revive the shared DB connection: %s", e)
        return self._db

    @db.setter
    def db(self, value):
        self._db = value


    # ==== Order Management Methods ====
