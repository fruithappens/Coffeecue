"""Adding a friend's coffee to an order: name, drink, milk, size, sugar, confirm.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
FriendsMixin, so self.<method>() reaches them exactly as before.
"""
import json
from datetime import datetime, timedelta
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class FriendsMixin:
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
            return f"Got it - {order_details['type']}{milk_phrase} for {friend_name}. What size? (small, medium, large)"

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
