"""Placing an order: the confirm step, group ids, choosing the station.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
PlacingMixin, so self.<method>() reaches them exactly as before.
"""
import json
import random
import sqlite3
from datetime import datetime
from services.sms_wording import say
from utils.order_provenance import stamp as stamp_provenance
from utils.station_label import station_label
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class PlacingMixin:
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

    @staticmethod
    def _order_was_placed(order_details):
        """Did _confirm_order really create this order? It stamps the number
        on the dict once the order is saved. Never judge by the reply's
        words: they are editable (sms_wording), so 'starts with Sorry' can
        stop being true."""
        return bool((order_details or {}).get("_created_order_number"))

    def _confirm_order(self, phone, order_details, name, is_friend_order=False):
        """Confirm and process the order"""
        # A dict carried over from an earlier order must not look placed.
        for _k in ("_created_order_number", "_created_order_id", "_created_station_id"):
            order_details.pop(_k, None)

        # Intake gate. Checked HERE rather than at the top of handle_sms so
        # that STATUS and CANCEL keep working while ordering is stopped —
        # a customer who already has a drink in the queue still needs to be
        # able to ask about it or cancel it.
        from utils.order_intake import intake_blocked_reason
        from utils.plan_limits import attendee_cap_message

        _blocked = intake_blocked_reason(self.db)
        if _blocked:
            logger.info("SMS order from %s refused: intake gate is closed", phone)
            return _blocked

        _cap_msg = attendee_cap_message(self.db, phone)
        if _cap_msg:
            logger.info("SMS order from %s refused: attendee cap reached", phone)
            return _cap_msg

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
            # Group lettering: the multi-drink flow reserves ONE base for the
            # round and pre-assigns 336a/336b/336c per drink. Pop it so it
            # never lands in the stored order_details; when set it replaces
            # the per-drink nextval below (one sequence tick per round).
            try:
                _pre = order_details.pop("_preassigned_number", None)
                if _pre:
                    order_number = str(_pre)
            except Exception:
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

            if not order_number and db_type != "sqlite":
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

            # The EventsAir rule: a speaker or a tagged VIP is one without
            # typing a code, and may be sent to the station the organiser
            # chose. Same rule every door applies (services/vip_rule.py).
            if not is_friend_order:
                try:
                    from services.vip_rule import resolve as _vip_resolve
                    _hit = _vip_resolve(self.db.cursor(), phone=phone)
                    if _hit.get("vip"):
                        if _hit.get("jump_queue", True):
                            order_details["vip"] = True
                        order_details["vip_reason"] = _hit.get("reason") or ""
                        if _hit.get("station_id") and not specified_station:
                            specified_station = _hit["station_id"]
                        logger.info(
                            f"Order flagged VIP by the EventsAir rule "
                            f"({_hit.get('reason')}) for {phone}"
                        )
                except Exception as _ve:
                    logger.warning(f"VIP rule lookup failed (non-fatal): {_ve}")

            # Assign station based on available information
            is_vip = order_details.get("vip", False)
            milk_type = order_details.get("milk")

            # Track whether the customer's chosen station got changed so we
            # can tell them in the confirmation message instead of silently
            # routing the order somewhere else.
            requested_station_id = None
            station_was_reassigned = False
            reassign_reason = None  # 'capability' | 'invalid' - shapes the SMS note

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
                            return say("stations_closed")
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
                        return say("stations_closed")
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
                    return say("stations_closed")
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
            # vip and vip_reason too: the row's queue_priority carried the
            # fact, but the stored details never said WHY -- and the barista
            # card reads "Priority · Speaker" from the details.
            for _carry in ("price", "price_formatted", "decaf", "shots", "vip", "vip_reason"):
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

                # Payments level 2 (services/payments.py): a Square link for
                # the ready text, when the operator wants the phone to pay.
                try:
                    from utils.plan_limits import feature_allowed
                    _pr = self._get_pricing_settings() or {}
                    if _pr.get("enabled") and (_pr.get("mode") or "honour") != "honour" \
                            and processed_details.get("price") \
                            and feature_allowed(self.db, "square"):
                        from flask import current_app as _ca
                        from routes.square_routes import attach_payment_link as _attach
                        _attach(self.db, order_number, processed_details.get("price"),
                                f"{processed_details.get('type') or 'coffee'} for {processed_details.get('name') or 'you'}")
                except Exception as _sq:
                    logger.debug(f"square link skipped for SMS order: {_sq}")

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
                return say("order_error")

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
                position_line = say("queue_vip")
            elif queue_position is not None and queue_position > 0:
                position_line = (
                    say("queue_first")
                    if queue_position == 1
                    else say("queue_position", position=queue_position, wait=wait_time)
                )
            else:
                position_line = say("queue_wait", wait=wait_time)

            # Build the confirmation message. No emoji — an emoji forces the
            # SMS into UCS-2 (70-char segments instead of 160), doubling cost.
            if milk_is_unique and unique_station_info:
                # Show station immediately if it's the only one with this milk
                confirmation_message = say(
                    "order_placed_one_station",
                    order_number=order_number,
                    milk=processed_details.get("milk").title(),
                    station=station_label(self.db, station_id),
                    queue=position_line,
                )
            else:
                # Standard message - don't show station immediately. Keep it
                # to one segment; the recap (auto-place) and the ready SMS that
                # follows both make clear they'll be texted.
                confirmation_message = say(
                    "order_placed", order_number=order_number, queue=position_line
                )

            # If the customer asked for a specific station but we had to
            # reassign (invalid station number, capacity, etc.) let them know
            # — silently routing the order elsewhere has caused confusion.
            if station_was_reassigned:
                if reassign_reason == "capability":
                    confirmation_message += "\n\n" + say(
                        "moved_cant_make",
                        asked_station=station_label(self.db, requested_station_id),
                        station=station_label(self.db, station_id),
                    )
                else:
                    confirmation_message += "\n\n" + say(
                        "moved_not_available",
                        asked_station=station_label(self.db, requested_station_id),
                        station=station_label(self.db, station_id),
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

            return say("order_error")
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

            # First check if we're in a break period or not. In the EVENT's
            # time: breaks are entered as the venue's clock times, and the
            # server runs on UTC, so datetime.now() put a 10:30 Adelaide
            # break at 21:00 the day before (test bench, breaks suite).
            from utils import event_time as _et

            current_time = _et.local_now(_et.resolve_zone(self._get_setting))
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

            # The sponsor's cart that only serves VIPs: a non-VIP is never
            # routed there. If that would leave nowhere at all, the filter
            # stands down -- a coffee has to be made somewhere.
            try:
                from services.vip_rule import allowed_stations as _vip_allowed
                _keep = set(_vip_allowed(
                    self.db.cursor(), [st["id"] for st in stations], bool(is_vip)))
                stations = [st for st in stations if st["id"] in _keep]
                for _m in list(stations_with_milk.keys()):
                    stations_with_milk[_m] = [
                        sid for sid in stations_with_milk[_m] if sid in _keep]
            except Exception as _vo:
                logger.warning(f"VIP-only station filter failed (non-fatal): {_vo}")

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
