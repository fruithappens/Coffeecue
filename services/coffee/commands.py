"""Text commands: STATUS, CANCEL, CHANGE, MENU, HELP, VIP codes, the barista line, scheduled orders.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
CommandsMixin, so self.<method>() reaches them exactly as before.
"""
import json
import re
from datetime import datetime, timedelta
from services.sms_wording import say
from utils.order_provenance import stamp as stamp_provenance
from utils.station_label import station_label
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class CommandsMixin:
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
                f"Got it - about {minutes} min away! Text us your order now "
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
        from utils.plan_limits import attendee_cap_message

        _blocked = intake_blocked_reason(self.db)
        if _blocked:
            logger.info(
                "Scheduled SMS order from %s refused: intake gate is closed", phone
            )
            return _blocked

        _cap_msg = attendee_cap_message(self.db, phone)
        if _cap_msg:
            logger.info(
                "Scheduled SMS order from %s refused: attendee cap reached", phone
            )
            return _cap_msg

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
                f"Great {name}! Your {summary} is scheduled - we'll start "
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
                return say("no_active_orders")

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
                return say("nothing_to_cancel")

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

            return say("order_cancelled", order_number=order_number)

        except Exception as e:
            logger.error(f"Error cancelling order: {str(e)}")
            return say("cancel_failed")

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
            return say("ask_barista_question")

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
        # Record the answer ON THE ORDER too, so the barista's question card
        # (the milk-substitution "/ask" prompt, which reads _customer_reply)
        # shows it — not only the Messages inbox. Harmless when no card is
        # open. Same shape the tracking-page /reply endpoint writes.
        try:
            if order_no:
                _cur = self.db.cursor()
                try:
                    self.db.rollback()
                except Exception:
                    pass
                _cur.execute(
                    "UPDATE orders SET order_details = "
                    "COALESCE(order_details::jsonb, '{}'::jsonb) || %s::jsonb "
                    "WHERE order_number = %s",
                    (json.dumps({'_customer_reply': {
                        'text': (message or '').strip()[:280],
                        'at': datetime.now().isoformat()}}), order_no))
                self.db.commit()
        except Exception as reply_err:
            try:
                self.db.rollback()
            except Exception:
                pass
            logger.warning(f"could not record _customer_reply on order (non-fatal): {reply_err}")
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
        return say("question_passed")

    def _handle_forgetme_command(self, phone):
        """Handle FORGETME command - wipe this phone's customer record.

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
        """MENU / OPTIONS command - return the live, current menu so the
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
                coffee_line_tail = f" (+{extra_count - 1} more - just text the name)"

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
                lines.append(f"{self._summarise_sweeteners(available_sweeteners)}")

            lines.append(f"Size: {', '.join(sizes)}")

            if single_station_milks:
                lines.append("")
                lines.append(
                    f"{', '.join(single_station_milks)} only at certain stations - "
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
            from utils.plan_limits import feature_allowed
            if not feature_allowed(self.db, "vip"):
                return False
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
            from utils.plan_limits import feature_allowed
            if not feature_allowed(self.db, "vip"):
                return raw, False
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
        order that's still pending - bumps THAT order into the VIP lane too, so
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
            return say("vip_failed")

    # Privacy Command Handlers
    def _handle_mydata_command(self, phone):
        """Handle MYDATA command - show customer their stored data"""
        try:
            customer = self.get_customer(phone)

            if not customer:
                return say("mydata_none")

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
            return say("mydata_failed")

    def _handle_changename_command(self, phone, new_name):
        """Handle CHANGENAME command - update customer's name"""
        try:
            if not new_name:
                return say("changename_usage")

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

            return say("name_updated", name=new_name)

        except Exception as e:
            logger.error(f"Error in CHANGENAME command: {str(e)}")
            self.db.rollback()
            return say("name_update_failed")

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
                return say("prefs_none")

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

            return say("prefs_cleared", name=name)

        except Exception as e:
            logger.error(f"Error in RESET command: {str(e)}")
            self.db.rollback()
            return say("prefs_reset_failed")

    def _handle_delete_command(self, phone, state):
        """Handle DELETE command - request to delete all customer data"""
        # Check if we're already in deletion confirmation state
        if state.get("state") == "awaiting_deletion_confirmation":
            return None  # Let the normal state handler deal with YES/NO

        # Set state to await confirmation
        self._set_conversation_state(phone, "awaiting_deletion_confirmation")

        return say("delete_confirm")

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
                    return say("data_deleted", service=self.system_name)
                else:
                    return say("nothing_to_delete")

            except Exception as e:
                logger.error(f"Error deleting customer data: {str(e)}")
                self.db.rollback()
                return say("delete_failed")

        elif message_upper == "NO":
            # Cancel deletion
            self._set_conversation_state(phone, "completed")
            return say("delete_cancelled")

        else:
            return say("delete_yes_or_no")

    def _handle_friend_command(self, phone, state):
        """Handle FRIEND command - add a coffee for a friend"""
        try:
            from utils.plan_limits import feature_allowed, GROUP_ORDER_DISABLED_MESSAGE
            if not feature_allowed(self.db, "group_orders"):
                return GROUP_ORDER_DISABLED_MESSAGE

            # Get customer info
            customer = self.get_customer(phone)
            if not customer or not customer.get("name"):
                return say("friend_order_first")

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
                return say("friend_own_order_first", name=primary_name)

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

            return say("friend_ask_name")

        except Exception as e:
            logger.error(f"Error in FRIEND command: {str(e)}")
            return say("friend_failed")
