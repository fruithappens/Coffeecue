"""What can be made: drinks, milks, sizes, sweeteners, beans, prices, routing rules.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
MenuMixin, so self.<method>() reaches them exactly as before.
"""
import json
import re

from utils.milk import BLACK_MILKS
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    _milk_key,
    _unique_milk_keys,
    logger,
)


class MenuMixin:
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
            if req_milk and req_milk not in BLACK_MILKS:
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
            # Both cursor shapes pass through here. row[0] on a dict row
            # raised KeyError into the blanket except -> None -> "no
            # filter" -> the event's extra espresso drinks (ristretto,
            # magic...) silently never joined the menu on prod.
            raw = None
            if row:
                raw = row.get('value') if isinstance(row, dict) else row[0]
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
        operator isn't tracking stock for this event - skip the
        "we're out of X" branches so customers don't get spurious
        rejections. Cached at first call to avoid hitting the DB on
        every conversation turn.
        """
        # TTL cache, not forever. This was cached for the life of the
        # process, so flipping "unlimited stock" at the venue (turning
        # real tracking on for the event day) silently did nothing until
        # the next deploy restarted the container. Ten seconds keeps the
        # per-message cost near zero and makes the switch actually a
        # switch.
        import time as _time
        _now = _time.time()
        if (hasattr(self, "_unlimited_stock_cache")
                and _now - getattr(self, "_unlimited_stock_cache_at", 0) < 10):
            return self._unlimited_stock_cache
        self._unlimited_stock_cache_at = _now
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
            # honour | pay_to_collect | pay_to_order -- services/payments.py
            "mode": "honour",
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

    def _format_price_tail(self, order_details):
        """Return a one-line "\nTotal: $5.50 - pay at the counter on
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
        """Return a "\nGroup total: $X for N coffees - pay at the counter on
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
        """Get list of available drink types - espresso drinks (gated
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
            # The event menu can ADD drinks, not just subtract. This was
            # a pure intersection with the hardcoded standard menu, so
            # enabling Macchiato in the Organiser put it on every display
            # surface while SMS refused it -- on the menu, unorderable
            # (scenario matrix S6). Enabled names beyond the standard six
            # join the list here; station capabilities still gate them
            # below, so a drink no station carries stays unorderable
            # WITH a consistent story on every surface.
            extras_enabled = [
                e for e in enabled
                if e not in {d.lower() for d in espresso}
            ]
            if filtered or extras_enabled:
                espresso = filtered + extras_enabled
        # An 86'd drink leaves the menu everywhere at once.
        try:
            from services.recipes import get_overrides
            _ov = get_overrides(self.db)
            _dead = {n for (c, n), st in _ov.items()
                     if c == "drink" and st == "86"}
            if _dead:
                espresso = [d for d in espresso if d.lower() not in _dead]
        except Exception:
            pass

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
        ('earl grey tea') - so normalise both sides.

        Deliberately conservative: a drink is dropped ONLY when it is
        explicitly false at every active station. No entry means "no
        opinion", not "disabled" - the previous version of this gate hid
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
        'event_inventory' → 'drinks') - the SAME store that already drives the
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

    def _count_refusal(self, channel, od, reason=None, item="", message=""):
        """One row per order we turned away (utils/refusals.py). When
        `reason` is not given, the last check_order_makeable() refusal
        supplies it. Never raises."""
        try:
            from utils.refusals import note_refusal
            od = od if isinstance(od, dict) else {}
            if reason is None:
                last = getattr(self, "_last_refusal", None) or {}
                reason, item = last.get("reason", "other"), item or last.get("item", "")
            self._last_refusal = None
            note_refusal(self.db, channel, reason, item=item,
                         drink=od.get("type", ""), milk=od.get("milk", ""), message=message)
        except Exception as e:
            logger.debug(f"refusal not counted: {e}")

    def check_order_makeable(self, od):
        """Gate 2 for a COMPLETE order: can the resolved recipe be made?

        Returns (ok, message). Steve's decision: sold-out behaviour is a
        per-event setting -- 'strict' (default) refuses with the reason,
        'warn' lets orders flow and leaves it to the barista screens.

        Drinks with no recipe always pass: the legacy path has no
        ingredient knowledge to enforce, and inventing constraints for
        it would refuse orders the system would happily have made
        yesterday.
        """
        try:
            from services.recipes import (apply_overrides, check_ingredients,
                                          get_overrides, resolve_order)
            # THE 86 BOARD FIRST -- a barista's statement about reality
            # outranks every mode and every ledger number, in both
            # directions. It works even in unlimited mode: "the crate
            # spilled" is not stock arithmetic, it is testimony.
            _lines, _meta = resolve_order(
                self.db, od, self._get_setting,
                requested_bean=self._requested_bean(od),
            )
            # STAMP AT ACCEPTANCE (docs/MENU_ARCHITECTURE.md): the resolved
            # ingredient lines are saved ON the order, and completion
            # replays the stamp. What was checked is exactly what is
            # decremented -- an operator editing a recipe mid-queue
            # changes future orders, never the ledger meaning of orders
            # already accepted.
            if _lines:
                od["_resolved_lines"] = _lines
            _ov = get_overrides(self.db, station_id=od.get("station_id"))
            if _ov:
                _verdict, _names = apply_overrides(
                    _lines, _meta.get("drink"), _ov)
                if _verdict == "86":
                    drink = str(od.get("type") or "that")
                    # For the caller to count (utils/refusals.py): what
                    # stopped it, in the terms the report groups by.
                    self._last_refusal = {"reason": "86", "item": ", ".join(_names)}
                    return False, (
                        f"Sorry, we can't make {drink} right now - "
                        f"the barista has marked {', '.join(_names)} "
                        f"unavailable."
                    )
                if _verdict == "on":
                    return True, ""
            # Unlimited-stock mode means "this event does not refuse for
            # stock" -- the legacy menu already honours it (everything
            # stays listed), and a gate that refuses what the menu shows
            # is the menu lying (matrix S4: dry almond refused by SMS,
            # advertised by the kiosk). The ledger still DECREMENTS in
            # unlimited mode, so the post-event report stays honest; the
            # only thing switched off is refusal.
            if self._is_unlimited_stock_mode():
                return True, ""
            if str(self._get_setting("sold_out_mode", "strict")).lower() == "warn":
                return True, ""
            lines = _lines
            if not lines:
                return True, ""
            ok, missing = check_ingredients(self.db, lines)
            if ok:
                return True, ""
            drink = str(od.get("type") or "that")
            self._last_refusal = {"reason": "stock", "item": ", ".join(missing)}
            return False, (
                f"Sorry, we can't make {drink} right now - "
                f"we've run out of {', '.join(missing)}."
            )
        except Exception as e:
            logger.error(f"check_order_makeable failed (allowing order): {e}")
            return True, ""

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
            # The 86 board beats the ledger here like everywhere else.
            # Steve 86'd decaf and the app kept offering the Decaf?
            # button ("this is why i wanted a full optional turn off
            # not just a 86 disable") -- because this list only checked
            # STOCK, which unlimited mode skips entirely. An 86'd bean
            # now leaves every menu at once and stays gone until the
            # chip is tapped back on.
            try:
                from services.recipes import get_overrides
                dead = {n for (c, n), st in get_overrides(self.db).items()
                        if c == "coffee" and st == "86"}
                if dead:
                    beans = [b for b in beans if b not in dead]
            except Exception:
                pass
            return beans
        except Exception as e:
            logger.warning(f"_get_available_bean_types: {e}")
            try:
                self.db.rollback()
            except Exception:
                pass
            return []

    def _all_tracked_milk_names(self):
        """Every milk name with an inventory row at ANY level -- the
        'tracked' set for the untracked-passes rule. A menu milk with a
        row is judged by that row; one with no row constrains nothing."""
        try:
            cursor = self.db.cursor()
            cursor.execute(
                "SELECT LOWER(name) FROM inventory_items WHERE category = 'milk'")
            return [
                (r[0] if not isinstance(r, dict) else list(r.values())[0])
                for r in cursor.fetchall()
            ]
        except Exception:
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
            # One name per milk. inventory_items holds a row per station
            # plus the event-level one, each with its own spelling ("Oat
            # Milk", "oat"), and these were listed as-is: the SMS MENU read
            # "almond, almond milk, almond milk, ..." and, worse, the stock
            # gate below compared "oat" against "oat milk" and never matched.
            milk_types = _unique_milk_keys(
                (row[0] if not isinstance(row, dict) else list(row.values())[0])
                for row in cursor.fetchall()
            )

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
                # INTERSECT with stock, don't replace it. The first
                # version substituted the event list wholesale, which
                # un-did the stock filter above: the scenario matrix
                # drained almond to 0.05L and the kiosk menu went on
                # advertising it (S4) while the order gate refused it --
                # menu and acceptance disagreeing, the exact disease.
                # Two gates: on the menu (choice) AND stocked (fact).
                # A menu milk with NO inventory row at all is untracked
                # and passes -- same rule as everywhere else.
                stocked = set(milk_types)
                tracked = set(_unique_milk_keys(self._all_tracked_milk_names() or []))
                event_milks = _unique_milk_keys(event_milks)
                merged = [
                    m for m in event_milks
                    if m in stocked or m not in tracked
                ]
                dropped = [m for m in event_milks if m not in merged]
                milk_types = merged
                if dropped:
                    logger.info(
                        "Event menu milk(s) %s hidden: stocked out", dropped)
            elif event_milks == []:
                # Every milk switched off. Almost certainly a misconfig
                # rather than an intention -- a latte needs milk -- so we
                # keep serving, but say so rather than failing silently.
                logger.warning(
                    "Event menu has NO milk enabled; falling back to "
                    "inventory_items. Check the Organiser inventory screen.")

            # The 86 board: a milk the barista marked out disappears from
            # every menu, whatever the ledger or the mode says. Testimony
            # outranks arithmetic in both modes.
            try:
                from services.recipes import get_overrides
                _ov = get_overrides(self.db)
                _dead = {_milk_key(n) for (c, n), st in _ov.items()
                         if c == "milk" and st == "86"}
                if _dead:
                    milk_types = [m for m in milk_types if m not in _dead]
            except Exception:
                pass

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

    def _is_catering_drink(self, name):
        n = str(name or "").strip().lower()
        if not n:
            return False
        return any(term in n for term in self._CATERING_DRINKS)

    def _offmenu_note(self):
        """' Or grab it yourself from the Wined Bar.' -- when the venue
        has named an outlet. A UI field (venue_cafe_name); empty means
        no note. The venue doc's rule: never ship this copy with a
        guessed name."""
        try:
            name = str(self._get_setting_fresh("venue_cafe_name", "") or "").strip()
        except Exception:
            name = ""
        return f" Or grab it yourself from the {name}." if name else ""

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
            # The capabilities editor's 'espresso drinks' GROUP TOKEN
            # means "this station makes the espresso family". Every list
            # that reaches this filter on the coffee_types dimension IS
            # espresso drinks by construction, so the token grants them
            # all -- without this, event-enabled drinks beyond a
            # station's explicit list (ristretto, magic, cortado) were
            # silently stripped here, one call before every menu.
            if dimension == "coffee_types" and "espresso drinks" in allowed:
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
