"""The ordering conversation: greeting, name, drink, milk, size, sugar, confirm, friends, usual order.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
ConversationMixin, so self.<method>() reaches them exactly as before.
"""
import json
import re
import sqlite3
from datetime import datetime
from services.sms_wording import say
from utils.milk import BLACK_MILKS
from utils.station_label import station_label
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    _NOT_A_NAME,
    logger,
)


class ConversationMixin:
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
                # The suggestion already greets by name ("...today, {name}?"),
                # so don't add the name again or it reads "Welcome back, Bart!
                # ...today, Bart?" (Steve, live test).
                return f"Welcome back! {usual_suggestions}"
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
                return say("ask_name_after_order")

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
                # A black coffee has no milk to run out of: "no milk isn't
                # on at any station" was sent to every long-black regular.
                is_black = (
                    str(milk or "").strip().lower().removesuffix(" milk").strip()
                    in BLACK_MILKS
                )
                if available_milks is not None and milk and not is_black:
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
                            f"(Just letting you know - {milk} isn't on at any "
                            f"station right now.)"
                        )

            if drink:
                # Build a suggestion message with full fidelity
                if all([drink, milk, size]):
                    drink_label = f"decaf {drink}" if decaf else drink
                    sugar_text = f", {sugar}" if sugar else ""
                    strength_text = f" ({strength})" if strength else ""
                    _m = str(milk).strip()
                    if _m.lower().removesuffix(" milk").strip() in BLACK_MILKS:
                        milk_text = ""
                    elif _m.lower().endswith(" milk"):
                        milk_text = f" with {_m}"
                    else:
                        milk_text = f" with {_m} milk"
                    return (
                        f"What can I get you today, {name}? Your usual "
                        f"{size} {drink_label}{milk_text}{sugar_text}"
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
        """Auto-place a completed order - no YES step. Customers kept thinking
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
        if not self._order_was_placed(od):
            return f"{prefix}{order_response}"
        self._set_conversation_state(phone, "completed")
        # _confirm_order's message gives the order # + queue position but NOT
        # the drink — include the recap so the customer can check what we
        # placed (incl. the defaulted "no sugar") and fix it.
        # Price tail (empty when pricing is off) — the one-shot flow is how
        # most SMS orders confirm, and it was the ONLY confirmation path
        # not showing the total when pricing was enabled (Test Bench
        # pricing round-trip).
        # Sponsor acknowledgement: a UI field (Comms Hub), never code.
        # Empty field = no line = no cost. When set it usually tips the
        # confirmation to a second SMS segment -- the field's helper in
        # the UI shows that cost while the operator types.
        _sponsor = str(self._get_setting_fresh("sponsor_line", "") or "").strip()
        _sponsor_tail = f"\n{_sponsor}" if _sponsor else ""
        return (
            f"{prefix}{order_response}\n"
            f"That's: {summary}.{self.SUGAR_SELF_SERVE_NOTE if sugar_redirect else ''}"
            f"{self._format_price_tail(od)} "
            f"Wrong? CHANGE or OOPS. Add another with FRIEND."
            f"{_sponsor_tail}"
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
        """Save state and ask for the next MISSING order field - or confirm if
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
                self._count_refusal("sms", od, reason="no_drink", item=drink)
                self._set_conversation_state(
                    phone, "awaiting_coffee_type", {"name": name}
                )
                return prefix + say("drink_unavailable", drink=drink, available=", ".join(available))
            if self.nlp.is_black_coffee(drink):
                od["milk"] = "no milk"

        # Un-makeable milk → drop it and re-ask milk.
        milk_note = ""
        if od.get("milk") and not self._milk_is_makeable(od.get("milk")):
            milk_note = f"We don't have {od.pop('milk')} at any station - "

        state_data = {"name": name, "order_details": od}

        if "type" not in od:
            self._set_conversation_state(
                phone, "awaiting_coffee_type", {"name": name, "order_details": od}
            )
            return prefix + say("ask_drink")
        if "milk" not in od:
            if milk_note:
                # They NAMED a milk we can't make — never swap dairy in
                # behind their back (allergy risk). This case still asks.
                self._set_conversation_state(phone, "awaiting_milk", state_data)
                milks = self._get_available_milk_types() or ["full cream"]
                return f"{prefix}{milk_note}" + say("ask_milk", drink=od['type'], milks=', '.join(milks))
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
                return f"{prefix}" + say("ask_size", drink=od['type'], sizes=', '.join(sizes))
        # Sugar: don't prompt — most customers don't take it. Default to no
        # sugar (shown in the recap so they can fix it), then auto-place.
        return self._place_order(phone, name, od, prefix=prefix)

    def _split_multi_drink(self, message):
        """Detect "two coffees in one text" - e.g. "1 oat latte and 1 flat
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
        milk, drink we don't make), don't guess - drop back to the normal
        one-coffee flow and tell them how to do the group."""
        self._set_conversation_state(phone, "awaiting_coffee_type", {"name": name})
        return (
            f"I can do a group order, but {reason}. Easiest is one coffee at a "
            f"time - what's the first one? (Then reply FRIEND to add the next.)"
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
            return say("group_ask_name")
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
                self._count_refusal("sms", od, reason="no_drink", item=drink)
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
                self._count_refusal("sms", od, reason="no_milk", item=od.get("milk"))
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
        refusal = None
        # Letter the round (336a/336b/336c): reserve ONE base up front so
        # every drink -- the first included -- is stamped with the round's
        # group_id before it is placed, and each carries its pre-assigned
        # number into _confirm_order (one sequence tick per round, no gaps).
        # Only for 2+ drinks. If the sequence is unavailable, _base is None
        # and the loop below behaves exactly as it always did.
        from utils.order_numbering import reserve_order_base, lettered

        _base = reserve_order_base(self.db) if len(resolved) >= 2 else None
        if _base:
            group_id = str(_base)
        for _i, od in enumerate(resolved, start=1):
            if station_for_group is not None:
                od["station_id"] = station_for_group
                od["stationId"] = station_for_group
            if group_id is not None:
                od["group_id"] = group_id
                od["group_label"] = group_label
            if _base:
                od["_preassigned_number"] = lettered(_base, _i)
                # Same badge data the app/kiosk group sets, so the barista
                # board shows 1/3, 2/3, 3/3 for an SMS round too.
                od["group_position"] = _i
                od["group_size"] = len(resolved)
            resp = self._confirm_order(phone, od, name)
            if not self._order_was_placed(od):
                # Not the "which milk instead?" question: it is about one
                # coffee, and the conversation below ends for the round.
                asked_milk = (self._get_conversation_state(phone) or {}).get(
                    "state"
                ) == "awaiting_milk"
                if isinstance(resp, str) and not asked_milk:
                    refusal = resp
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
            if refusal:
                return refusal
            return (
                "Sorry, I couldn't place that group order just now. "
                "Please try sending one coffee at a time."
            )

        lines = [f"#{num}: {self.nlp.format_order_summary(od)}" for num, od in placed]
        # Say which coffees did NOT go through; they used to just be missing
        # from the list.
        for od in resolved[len(placed):]:
            lines.append(f"Not ordered: {self.nlp.format_order_summary(od)}")
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
                return say("name_invalid")
            return self._handle_multi_drink_order(
                phone, pending_multi, {"temp_data": {"name": nm}}
            )

        # Usual-order shortcut ("the usual"). The message here is the COMMAND
        # ("the usual" / "my usual"), NEVER the customer's name — using it as the
        # name placed the order under the literal name "The usual" (Steve saw
        # this on #345). Pull the SAVED name, exactly like the `USUAL` keyword
        # branch above; _process_usual_order asks for the name if we have none
        # yet and sets the conversation state itself, so no pre-set is needed.
        if self.nlp.is_asking_for_usual(message):
            customer = self.get_customer(phone)
            nm = customer.get("name", "") if customer else ""
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
                return say("ask_name_after_order")
            if len(name) < 2 or len(name) > 50:
                return say("name_invalid")
            return self._next_order_step(
                phone, name, order_details, prefix=f"Thanks {name}! "
            )

        # No order in the reply — treat the whole thing as just the name.
        name = (message or "").strip()
        # ...unless it's plainly not a name. A stray "yes" or "none" after an
        # order used to become the customer's name ("Hi yes!"); found by
        # the golden transcript, 15 Oct 2026. A returning customer keeps the
        # name we have; anyone else is asked again.
        if name.lower().strip(" .!?,") in _NOT_A_NAME:
            customer = self.get_customer(phone)
            known = (customer or {}).get("name") if customer else ""
            if known:
                name = known
            else:
                self._set_conversation_state(phone, "awaiting_name", state.get("temp_data") or {})
                return say("not_a_name")
        if len(name) < 2 or len(name) > 50:
            return say("name_invalid")

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
        # Defensive: the REQUEST phrase must never become the name. A caller
        # that passed the raw message ("the usual") would otherwise place the
        # order under the literal name "The usual" (#345). Drop it and fall
        # through to the saved name / a proper name prompt.
        if name and self.nlp.is_asking_for_usual(name):
            name = ""
        # Get customer information if name not provided
        if not name:
            customer = self.get_customer(phone)
            name = customer.get("name", "") if customer else ""

            # If still no name, we need to ask for it
            if not name:
                self._set_conversation_state(phone, "awaiting_name")
                return say("no_name_yet")

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
            return say("no_usual_yet", name=name)

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

        # Every station closed: say so now, in customer words, instead of
        # asking for the size and milk and refusing at the end with staff
        # wording (found by the SMS scenarios, 15 Oct 2026).
        if coffee_type and not self._has_active_station():
            return say("stations_closed")

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
            # Plain "tea" when there ARE teas: ask which, don't refuse. It
            # used to say "Sorry, we don't have hot tea today" with four
            # teas on the menu.
            if teas and coffee_type.strip().lower() in ("tea", "hot tea", "a tea", "cup of tea", "a cup of tea"):
                return say("which_tea", teas=', '.join(sorted(teas)))
            self._count_refusal("sms", order_details, reason="no_drink", item=coffee_type)
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
        # "none" / "no milk" is a black coffee, never "we don't have no milk milk".
        if milk_type and milk_type.lower() not in ("no milk", "none", "black"):
            available_milk_types = self._get_available_milk_types()
            if not self._is_valid_milk_type(milk_type, available_milk_types):
                self._count_refusal("sms", order_details, reason="no_milk", item=milk_type)
                milk_words = milk_type if "milk" in milk_type.lower() else f"{milk_type} milk"
                return (
                    f"Sorry, we don't have {milk_words}. Available milks: "
                    f"{', '.join(available_milk_types)}."
                    f"{self._offmenu_note()}\n"
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
                self._count_refusal("sms", order_details, reason="no_bean", item=requested_bean)
                return (
                    f"Sorry, we don't have {requested_bean} today. "
                    f"We can make it with: {', '.join(available_beans)}.\n"
                    f"Reply MENU for the full list."
                )

        # Gate 2: the resolved recipe's ingredients (chocolate powder for
        # a mocha, water on a jerry-can cart, the cup itself). Milk and
        # beans were already validated above; this catches the FIXED
        # ingredients no earlier check knows about. Steve's example: "dont
        # make hot chocolate but might do mocha but still have the
        # chocolate powder" -- and when the powder runs dry, BOTH stop
        # being makeable, on every channel, from this one check.
        _mk_ok, _mk_msg = self.check_order_makeable(order_details)
        if not _mk_ok:
            self._count_refusal("sms", order_details, message=_mk_msg)
            return _mk_msg + "\nReply MENU for what's available."

        # Validate sweetener if specified
        sweetener = order_details.get("sugar", "")
        if sweetener:
            available_sweeteners = self._get_available_sweeteners()
            if not self._is_valid_sweetener(sweetener, available_sweeteners):
                sweetener_names = [s[0] for s in available_sweeteners]
                self._count_refusal("sms", order_details, reason="no_sweetener", item=sweetener)
                return (
                    f"Sorry, we don't have {sweetener}. Available sweeteners: "
                    f"{', '.join(sweetener_names)}.\n"
                    f"Reply MENU for the full list."
                )

        # Get customer's name from state
        name = state.get("temp_data", {}).get("name", "")

        # If no coffee type found, prompt again
        if "type" not in order_details:
            return say("unsure_coffee", name=name)

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
                    f"Got it - {order_details['type']}{milk_phrase}. "
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
            self._count_refusal("sms", order_details, reason="no_milk", item=milk_type)
            return say("milk_none_today", milk=milk_type, options=opts)

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
            return say("milk_unrecognised", milks=', '.join(milks))

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

        # A milk named at the size question ("oat") is the customer changing
        # the milk, usually away from the full-cream default shown in the
        # last reply ("Got it - latte with full cream milk. What size?").
        # It used to be read as a bad size, and the order then went through
        # with full cream: the wrong coffee. Found by the golden transcript,
        # 15 Oct 2026.
        said_milk = new_details.get("milk")
        if said_milk and said_milk != order_details.get("milk"):
            if not self._milk_is_makeable(said_milk):
                available = self._get_available_milk_types() or []
                return (f"Sorry, we don't have {said_milk} at any station today. "
                        f"Milks: {', '.join(available)}. What size? ({', '.join(available_sizes)})")
            order_details["milk"] = said_milk
            if not size:
                self._set_conversation_state(
                    phone, "awaiting_size", {"name": name, "order_details": order_details})
                return (f"Got it - {order_details.get('type', 'coffee')} with {said_milk} milk. "
                        f"What size? ({', '.join(available_sizes)})")

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
                return say("size_not_offered", size=size, drink=order_details.get("type", "coffee"), sizes=", ".join(available_sizes))
        else:
            # If no size was found, prompt again with available options
            return say("size_unrecognised", sizes=", ".join(available_sizes))

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
            if not self._order_was_placed(order_details):
                # Refused (ordering stopped, stations closed, milk run out):
                # no "add a friend" tip, and leave the conversation where the
                # refusal put it so they can retry.
                return order_response

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
                    f"Updated - {change_summary}.\n"
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
            return say("usual_confirmed", name=name, station=station_label(self.db, order_details.get('station_id', 1)))

        else:
            # Unrecognized response - prompt again
            return say("confirm_yes_no_edit")

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
        logger.info(f"Restarting conversation for {phone} ({len(message or '')} chars)")

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
                    self._count_refusal("sms", order_details, reason="no_drink", item=coffee_type)
                    return say("drink_not_offered", drink=coffee_type, available=', '.join(available_coffee_types))

            # Validate milk type
            milk_type = order_details.get("milk", "")
            # "none" / "no milk" means a black coffee, not a milk we lack:
            # it used to come back as "Sorry, we don't have no milk milk".
            if milk_type and milk_type.lower() not in ("no milk", "none", "black"):
                available_milk_types = self._get_available_milk_types()
                if not self._is_valid_milk_type(milk_type, available_milk_types):
                    self._count_refusal("sms", order_details, reason="no_milk", item=milk_type)
                    milk_words = milk_type if "milk" in milk_type.lower() else f"{milk_type} milk"
                    return say("milk_not_offered", milk=milk_words, available=', '.join(available_milk_types), off_menu=self._offmenu_note())

            # Validate sweetener
            sweetener = order_details.get("sugar", "")
            if sweetener:
                available_sweeteners = self._get_available_sweeteners()
                if not self._is_valid_sweetener(sweetener, available_sweeteners):
                    sweetener_names = [s[0] for s in available_sweeteners]
                    self._count_refusal("sms", order_details, reason="no_sweetener", item=sweetener)
                    return say("sweetener_not_offered", sweetener=sweetener, available=', '.join(sweetener_names))

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

                return say("welcome_back_ask_milk", name=name, drink=order_details['type'])
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
                    # The suggestion already greets by name, so don't add it
                    # again (would read "Welcome back, Bart! ...today, Bart?").
                    return f"Welcome back! {usual_suggestions}"
                else:
                    # Just welcome them back and ask for coffee
                    self._set_conversation_state(
                        phone, "awaiting_coffee_type", {"name": name}
                    )
                    return say("welcome_back_ask_drink", name=name)

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
            return say("ask_name_after_order")

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
