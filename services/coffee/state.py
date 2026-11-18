"""Settings reads and writes, and each phone's conversation state.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
StateMixin, so self.<method>() reaches them exactly as before.
"""
import json
import re
import sqlite3
from datetime import datetime, timedelta
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class StateMixin:
    def _get_setting_fresh(self, key, default_value=None):
        """Read a setting PAST the forever-cache.

        _get_setting caches on first read for the life of the process,
        which is right for boot constants and wrong for wording an
        operator edits during an event (sponsor line, cafe name --
        Steve: "make sure its only written in a ui field not hardcoded
        somewhere", which also has to mean editable-and-it-applies).
        Costs one small SELECT per use; use it only for copy.
        """
        try:
            cursor = self.db.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = %s", (key,))
            row = cursor.fetchone()
            if row and row[0] is not None:
                val = row[0] if not isinstance(row, dict) else row.get("value")
                try:
                    import json as _json
                    parsed = _json.loads(val)
                    return parsed if parsed is not None else default_value
                except (TypeError, ValueError):
                    return val
        except Exception:
            try:
                self.db.rollback()
            except Exception:
                pass
        return default_value

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
