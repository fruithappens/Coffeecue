"""Order and customer lookups the staff screens call.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
StaffMixin, so self.<method>() reaches them exactly as before.
"""
import json
from datetime import datetime
from psycopg2.extras import RealDictCursor
from utils.order_provenance import stamp as stamp_provenance
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class StaffMixin:
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
                logger.info(f"Sent SMS to {normalized_phone} ({len(message or '')} chars)")
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

            # Get today's orders -- today where the event is, not UTC
            # (finding 3; utils/event_time.py).
            from utils import event_time as _et
            _t0, _t1 = _et.today_bounds(_et.resolve_zone(self._get_setting))
            cursor.execute(
                """
                SELECT COUNT(*) 
                FROM orders 
                WHERE created_at >= %s AND created_at < %s
            """,
                (_t0, _t1),
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
