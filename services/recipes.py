"""The recipe layer: what a drink is actually made of.

Spec: docs/MENU_ARCHITECTURE.md. The one-sentence version of the rule
this module enforces: a drink never carries a quantity, and an
ingredient never appears on a menu. Everything between an order and the
inventory ledger goes through resolve_order() here, so what is CHECKED
at acceptance and what is DECREMENTED at completion can never be two
different opinions.

VOCABULARY (Steve's, 2026-08-26)
--------------------------------
  ingredient  a thing that depletes: beans (g), milk (mL), cups (unit),
              water (mL), chocolate powder (g). One flat pool -- milk
              appears in lattes, chai, hot chocolate AND the splash in
              tea, so ingredients are never "inside" a category.
  recipe      drink + size -> ingredient quantities. A TABLE, not a
              list, because scaling is not linear (a large flat white
              is 2 shots, not 1.4).
  menu        which recipes may be ordered. A CHOICE, held elsewhere
              (event_inventory); nothing here consults it.
  "in stock"  DERIVED: every tracked ingredient in the resolved recipe
              is available. Computed, never typed.

ROWS
----
A recipe row is (drink, size, ingredient_category, ingredient_name,
quantity, unit). A NULL ingredient_name means "the customer's choice
within that category" -- which milk, which bean -- resolved per order.
Named rows (chocolate powder, water) are fixed parts of the drink.

Shots are stored as unit='shot' and converted to grams at resolve time
via the beans_grams_per_shot setting, so the operator tunes dose in one
place. An order's explicit shot count (a double) OVERRIDES the recipe's
default shots; every other quantity comes from the recipe.

THE TRACKED-ONLY RULE
---------------------
Availability checks skip ingredients the event does not track (no
inventory row matches). A plumbed venue simply never stocks 'water' and
water then constrains nothing. This is the same three-state "absence
means no opinion" rule the menu bridge uses -- deliberate absence, not
fail-open on error (errors stay loud).
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# Grams of beans per espresso shot when the setting is absent/broken.
DEFAULT_GRAMS_PER_SHOT = 22.0

# Milk poured into a TEA when the customer asks for milk: a splash, not
# a flat-white's worth. Mirrors the constant the legacy decrement used.
TEA_MILK_SPLASH_ML = 30

# The shipped defaults. Standard cafe quantities -- deliberately
# ordinary, because they are a starting point the operator EDITS, not
# an opinion about coffee. source='shipped' rows may be re-seeded;
# operator edits become source='custom' and are never touched again.
#
# Shape: drink -> size -> list of (category, name-or-None, qty, unit)
SHIPPED_RECIPES = {
    "latte": {
        "small": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 150, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 200, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 280, "mL"),
            ("cups", None, 1, "unit"),
        ],
    },
    "flat white": {
        "small": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 140, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 190, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 260, "mL"),
            ("cups", None, 1, "unit"),
        ],
    },
    "cappuccino": {
        "small": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 120, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 160, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 220, "mL"),
            ("cups", None, 1, "unit"),
        ],
    },
    "espresso": {
        "small": [("coffee", None, 1, "shot"), ("cups", None, 1, "unit")],
        "medium": [("coffee", None, 1, "shot"), ("cups", None, 1, "unit")],
        "large": [("coffee", None, 2, "shot"), ("cups", None, 1, "unit")],
    },
    "long black": {
        "small": [
            ("coffee", None, 1, "shot"),
            ("water", "water", 120, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 2, "shot"),
            ("water", "water", 160, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("water", "water", 220, "mL"),
            ("cups", None, 1, "unit"),
        ],
    },
    "mocha": {
        "small": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 140, "mL"),
            ("extras", "chocolate powder", 15, "g"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 1, "shot"),
            ("milk", None, 180, "mL"),
            ("extras", "chocolate powder", 20, "g"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 250, "mL"),
            ("extras", "chocolate powder", 25, "g"),
            ("cups", None, 1, "unit"),
        ],
    },
    "hot chocolate": {
        "small": [
            ("milk", None, 170, "mL"),
            ("extras", "chocolate powder", 20, "g"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("milk", None, 220, "mL"),
            ("extras", "chocolate powder", 25, "g"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("milk", None, 300, "mL"),
            ("extras", "chocolate powder", 32, "g"),
            ("cups", None, 1, "unit"),
        ],
    },
    "chai latte": {
        "small": [
            ("milk", None, 170, "mL"),
            ("extras", "chai powder", 15, "g"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("milk", None, 220, "mL"),
            ("extras", "chai powder", 20, "g"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("milk", None, 300, "mL"),
            ("extras", "chai powder", 25, "g"),
            ("cups", None, 1, "unit"),
        ],
    },
    # A magic: double ristretto in a 3/4 cup. First-class recipe, not a
    # delta on flat white -- same beans as two shots, LESS water pulled
    # through and less milk. The reason specials are rows, not options.
    "magic": {
        "small": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 120, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "medium": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 140, "mL"),
            ("cups", None, 1, "unit"),
        ],
        "large": [
            ("coffee", None, 2, "shot"),
            ("milk", None, 160, "mL"),
            ("cups", None, 1, "unit"),
        ],
    },
}


def seed_shipped_recipes(db):
    """Insert the shipped defaults, never touching operator rows.

    ON CONFLICT DO NOTHING: a (drink, size, category, name) an operator
    has edited (source='custom') or that already exists is left alone.
    Safe to run on every boot.
    """
    try:
        cur = db.cursor()
        n = 0
        for drink, sizes in SHIPPED_RECIPES.items():
            for size, lines in sizes.items():
                for category, name, qty, unit in lines:
                    cur.execute(
                        """
                        INSERT INTO recipes
                            (drink, size, ingredient_category,
                             ingredient_name, quantity, unit, source)
                        VALUES (%s, %s, %s, %s, %s, %s, 'shipped')
                        ON CONFLICT (drink, size, ingredient_category,
                                     COALESCE(ingredient_name, ''))
                        DO NOTHING
                        """,
                        (drink, size, category, name, qty, unit),
                    )
                    n += cur.rowcount
        db.commit()
        if n:
            logger.info("Seeded %d shipped recipe rows", n)
        return n
    except Exception as e:
        logger.warning("Recipe seed failed (non-fatal): %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return 0


def _normalise_drink(name):
    """Order 'type' -> recipe drink key. Strips the decaf prefix (decaf
    is a bean substitution, not a different recipe)."""
    n = str(name or "").strip().lower()
    n = re.sub(r"^decaf\s+", "", n)
    return n


def _grams_per_shot(get_setting):
    try:
        g = float(get_setting("beans_grams_per_shot", DEFAULT_GRAMS_PER_SHOT))
        if 1 <= g <= 60:
            return g
    except (TypeError, ValueError):
        pass
    return DEFAULT_GRAMS_PER_SHOT


def resolve_order(db, order_details, get_setting, requested_bean=""):
    """An order -> the exact ingredient lines it consumes.

    Returns (lines, meta) where lines is a list of dicts
    {category, name, qty, unit} ready for the ledger, or (None, meta)
    when no recipe exists for the drink -- the caller then falls back
    to the legacy hardcoded path, which is what keeps every drink
    without a recipe behaving exactly as it did yesterday.

    Substitutions happen HERE and nowhere else:
      * a NULL-name milk row takes the order's milk (skipped for
        'no milk')
      * a NULL-name coffee row takes the requested bean ('decaf' ->
        the decaf row; default -> 'house blend')
      * unit='shot' converts to grams; the order's explicit shot count
        overrides the recipe's default shots
      * a NULL-name cups row takes the order's size as the cup name
        (cup inventory rows are named 'small'/'medium'/'large')
      * tea-with-milk uses a splash, not a pour (legacy rule kept)
    """
    od = order_details or {}
    drink = _normalise_drink(od.get("type"))
    size = str(od.get("size") or "medium").strip().lower() or "medium"
    meta = {"drink": drink, "size": size, "recipe": False}
    if not drink:
        return None, meta

    try:
        cur = db.cursor()
        cur.execute(
            "SELECT ingredient_category, ingredient_name, quantity, unit "
            "FROM recipes WHERE drink = %s AND size = %s",
            (drink, size),
        )
        rows = cur.fetchall()
        if not rows and size != "medium":
            # Unknown size falls back to medium rather than resolving to
            # nothing -- an odd size string must not zero the ledger.
            cur.execute(
                "SELECT ingredient_category, ingredient_name, quantity, unit "
                "FROM recipes WHERE drink = %s AND size = 'medium'",
                (drink,),
            )
            rows = cur.fetchall()
            if rows:
                meta["size_fallback"] = "medium"
    except Exception as e:
        logger.warning("resolve_order recipe read failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return None, meta

    if not rows:
        return None, meta

    milk = str(od.get("milk") or "").strip().lower()
    is_tea = "tea" in drink
    lines = []
    for r in rows:
        if isinstance(r, dict):
            category, name, qty, unit = (
                r["ingredient_category"],
                r["ingredient_name"],
                r["quantity"],
                r["unit"],
            )
        else:
            category, name, qty, unit = r
        qty = float(qty)

        if category == "coffee":
            bean = (requested_bean or "").strip().lower() or "house blend"
            shots = qty if unit == "shot" else None
            try:
                if od.get("shots"):
                    shots = float(od["shots"])
            except (TypeError, ValueError):
                pass
            if shots is not None:
                grams = shots * _grams_per_shot(get_setting)
                lines.append(
                    {
                        "category": "coffee",
                        "name": bean,
                        "qty": round(grams, 2),
                        "unit": "g",
                    }
                )
            else:
                lines.append(
                    {"category": "coffee", "name": bean, "qty": qty, "unit": unit}
                )
        elif category == "milk" and name is None:
            if not milk or milk in ("no milk", "none", "black"):
                continue
            ml = TEA_MILK_SPLASH_ML if is_tea else qty
            lines.append({"category": "milk", "name": milk, "qty": ml, "unit": "mL"})
        elif category == "cups" and name is None:
            lines.append({"category": "cups", "name": size, "qty": qty, "unit": unit})
        else:
            lines.append({"category": category, "name": name, "qty": qty, "unit": unit})

    meta["recipe"] = True
    return lines, meta


def check_ingredients(db, lines):
    """Gate 2: can THIS order's quantities actually be poured?

    Refuses only when a TRACKED ingredient's remaining amount is less
    than what the resolved line needs (units converted: recipes speak
    mL/g, the ledger speaks L/kg). minimum_threshold is deliberately
    NOT a refusal floor: production has cups at threshold 50 as a
    "warn me" level, and refusing coffee while 50 cups sit on the
    shelf would be the gate lying in the other direction. Thresholds
    stay what they were: low-stock warnings for the humans.

    An ingredient with no matching inventory row is untracked and
    constrains nothing. Errors allow, loudly -- a gate that refuses
    coffee because a query failed is worse than one that lets a rare
    mistake through.
    """
    if not lines:
        return True, []
    DIVISOR = {"mL": 1000.0, "g": 1000.0}  # -> L / kg (ledger units)
    missing = []
    try:
        cur = db.cursor()
        for ln in lines:
            name = str(ln.get("name") or "").strip().lower()
            if not name:
                continue
            cur.execute(
                """
                SELECT COALESCE(amount, current_quantity)
                FROM inventory_items
                WHERE category = %s
                  AND (LOWER(name) = %s
                       OR LOWER(name) LIKE %s OR %s LIKE '%%' || LOWER(name) || '%%')
                ORDER BY (LOWER(name) = %s) DESC
                LIMIT 1
                """,
                (ln["category"], name, f"%{name}%", name, name),
            )
            row = cur.fetchone()
            if row is None:
                continue  # untracked: no opinion
            qty = row[0] if not isinstance(row, dict) else list(row.values())[0]
            if qty is None:
                continue  # unlimited-style row: no opinion
            needed = float(ln["qty"]) / DIVISOR.get(ln["unit"], 1.0)
            if float(qty) < needed:
                missing.append(name)
        return (len(missing) == 0), missing
    except Exception as e:
        logger.error("check_ingredients failed (allowing order): %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return True, []
