"""Stock: what an order uses up, and putting it back.

Methods of CoffeeOrderSystem, moved here unchanged from
services/coffee_system.py (roadmap X7-11). CoffeeOrderSystem inherits
StockMixin, so self.<method>() reaches them exactly as before.
"""
from services.coffee_system import (  # noqa: F401  (defined above the mixin imports)
    logger,
)


class StockMixin:
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

        # --- RECIPE PATH (docs/MENU_ARCHITECTURE.md) ----------------
        # When the drink has a recipe, the resolved lines ARE the
        # ledger movement: each ingredient by exactly the recipe's
        # quantity, substitutions (which milk, which bean) already
        # applied by resolve_order. Drinks WITHOUT a recipe fall
        # through to the legacy hardcoded path below, unchanged --
        # that fallback is what makes this deployable mid-week without
        # touching how yesterday's drinks deplete.
        #
        # Units: recipes speak mL and g; the ledger rows speak L and
        # kg (matching the live inventory: milk 18.55 L, beans 27 kg).
        _lines = None
        _stamped = processed_details.get("_resolved_lines")
        if isinstance(_stamped, list) and _stamped:
            # The acceptance-time stamp wins: this is the exact list the
            # gate approved, whatever the recipes table says NOW.
            _lines = _stamped
        else:
            try:
                from services.recipes import resolve_order as _resolve
                _lines, _meta = _resolve(
                    self.db, processed_details, self._get_setting,
                    requested_bean=self._requested_bean(processed_details),
                )
            except Exception as _re:
                logger.warning(f"recipe resolve failed; using legacy path: {_re}")
                _lines = None
        if _lines:
            _DIVISOR = {"mL": 1000.0, "g": 1000.0}  # -> L / kg
            for _ln in _lines:
                _qty = float(_ln["qty"]) / _DIVISOR.get(_ln["unit"], 1.0)
                if tea_double_cup and _ln["category"] == "cups":
                    _qty *= 2
                if self._decrement_inventory_item(
                    cursor,
                    db_type,
                    category=_ln["category"],
                    name=_ln["name"],
                    amount=_qty,
                    station_id=station_id,
                    restock=restock,
                ):
                    result["decremented"].append(
                        f"{_ln['category']}:{_ln['name']}")
                else:
                    result["skipped"].append(
                        {"item": f"{_ln['category']}:{_ln['name']}",
                         "reason": "no inventory row matched"})
            result["recipe"] = True
            # Same tail bookkeeping as the legacy path -- the restock
            # flag is what stops a cancelled order being refunded to
            # the ledger twice, and errors surface for the same reason
            # they do below: a decrement that silently moved nothing is
            # the lie this whole layer exists to end.
            errs = getattr(self, "_stock_errors", None)
            if errs:
                result["errors"] = errs[:5]
            if restock:
                processed_details["_stock_restocked"] = True
            conn.commit()
            return result
        # --- LEGACY PATH (no recipe for this drink) -----------------

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
                elif "half" in strength or "weak" in strength or "light" in strength:
                    # A half-strength drink used a FULL dose in the stock
                    # maths -- the customer's "half strength" reached the
                    # barista and the label but never the beans (Steve:
                    # "the double shot / half strength should also affect
                    # the stock levels"). Half a dose, not none: a ristretto
                    # or a lighter pull still grinds.
                    shots = max(0.5, shots - 0.5)
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
            # shots can now be fractional (half strength = 0.5).
            bean_kg = float(shots) * grams_per_shot / 1000.0
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
                f"inventory heal VERIFICATION FAILED - will retry next call: {err}"
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
            note(f"v4 commit failed - will retry: {e}")
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
