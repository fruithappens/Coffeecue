"""Adding a friend's coffee to an order: name, drink, milk, size, sugar, confirm.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
FriendsMixin, so self.<method>() reaches them exactly as before.
"""
import json
from services.sms_wording import say
from utils.milk import BLACK_MILKS
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
            return say("friend_name_invalid")

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

        return say("friend_ask_drink", friend=friend_name)

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
            return say("friend_unsure_drink", friend=friend_name)

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

        refusal = self._friend_menu_refusal(order_details)
        if refusal:
            return refusal

        milk = order_details["milk"]
        milk_phrase = "" if milk == "no milk" else f" with {milk} milk"

        # One size on offer: use it, as the customer's own order does.
        only = self._friend_sizes(order_details)
        if "size" not in order_details and len(only) == 1:
            order_details["size"] = only[0]

        if "size" not in order_details:
            self._set_conversation_state(phone, "awaiting_friend_size", shared_state)
            return say("friend_got_it_ask_size", order=f"{order_details['type']}{milk_phrase}", friend=friend_name, sizes=", ".join(self._friend_sizes(order_details)))

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

    def _friend_sizes(self, order):
        """The sizes this event pours, for the friend's size question."""
        return self._get_available_sizes(order.get("type")) or ["small", "medium", "large"]

    def _friend_menu_refusal(self, order):
        """Why the friend's drink can't be made here, or None.

        The friend flow used to take any drink, milk or size: a friend
        could be given soy with no soy station, or a medium at an event
        that only pours small and large (found 24 Nov 2026). Same checks
        and wording as the customer's own order.
        """
        drink = order.get("type")
        if drink:
            drinks = self._get_available_coffee_types()
            if drinks and not self._is_valid_coffee_type(drink, drinks):
                return say("drink_not_offered", drink=drink, available=", ".join(drinks))
        milk = str(order.get("milk") or "").strip()
        if milk and milk.lower() not in BLACK_MILKS:
            milks = self._get_available_milk_types()
            if milks and not (
                self._is_valid_milk_type(milk, milks) and self._milk_is_makeable(milk)
            ):
                words = milk if "milk" in milk.lower() else f"{milk} milk"
                return say("milk_not_offered", milk=words, available=", ".join(milks), off_menu="")
        size = order.get("size")
        if size:
            sizes = self._get_available_sizes(drink)
            if sizes and str(size).lower() not in [str(x).lower() for x in sizes]:
                return say("size_not_offered", size=size, drink=drink or "coffee", sizes=", ".join(sizes))
        return None

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
            refusal = self._friend_menu_refusal({**friend_order, "milk": milk_type})
            if refusal:
                return refusal
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

            return say("friend_ask_size", drink=friend_order.get('type', 'coffee'), friend=friend_name, sizes=", ".join(self._friend_sizes(friend_order)))
        else:
            # If no milk type was found, prompt again
            return say("friend_milk_unrecognised", milks=", ".join(self._get_available_milk_types() or ["full cream"]))

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
            refusal = self._friend_menu_refusal({**friend_order, "size": size})
            if refusal:
                return refusal
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
            sizes = self._friend_sizes(friend_order)
            either = ", ".join(sizes[:-1]) + ", or " + sizes[-1] if len(sizes) > 1 else sizes[0]
            return say("friend_size_unrecognised", sizes=either, friend=friend_name)

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
            return say("friend_sugar_unclear", friend=friend_name)

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
                return say("friend_flow_confirmed", name=primary_name)

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
            return say("friend_ask_another")

        else:
            # Unrecognized response - prompt again
            return say("friend_another_or_no")

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

            # (A friend's preferences used to be "stored" here under the key
            # phone + "_" + name. It never worked -- the phone column holds 20
            # characters, the ON CONFLICT (phone, name) has no matching key,
            # and two columns it wrote do not exist -- nothing read it back,
            # and the swallowed error left the request's connection in a
            # failed transaction. Removed.)

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
            return say("friend_cancelled_next", friend=friend_name)

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
            return say("friend_change", friend=friend_name)

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
            return say("friend_ask_another")

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
            return say("friend_confirm_prompt", friend=friend_name)
