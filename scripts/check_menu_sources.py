#!/usr/bin/env python3
"""Only the designated accessors may read the menu tables directly.

WHY THIS EXISTS
---------------
The event menu lives in two places: the `event_inventory` KV blob that
the Organiser UI writes, and the legacy `inventory_items` table. The
accessors below know how to consult both, in the right order.

Everything else must go through them. When it doesn't, the display and
the order path end up reading different stores, and the customer is
offered something the system will then refuse. That exact bug shipped
four times -- drinks, coffee, cups and finally the MENU builder, which
had grown its own private copy of the inventory_items query and so
advertised teas the order path rejected.

Each of those was fixed by hand, one at a time, and the next one was
written the same way a month later. This check is the thing that
notices instead.

Adding a name to ALLOWED is a deliberate decision: it means "this
function is a menu accessor and knows about BOTH stores."
"""
import ast
import sys

TARGET = "services/coffee_system.py"
TABLES = ("inventory_items",)

ALLOWED = {
    "_get_available_milk_types",
    "_get_available_coffee_types",
    "_get_available_sizes",
    "_get_available_sweeteners",
    "_get_available_extra_drinks",
    "_get_available_bean_types",
    "_get_event_inventory",
    "_event_enabled",
    "_event_cup_names",
    "_get_event_enabled_coffees",
    "_ensure_inventory_quantity_columns",
    "_is_unlimited_stock_mode",
    "_milk_is_makeable",
    "_milk_to_stations_map",
    # Writes stock levels rather than reading the menu. Allowed
    # because decrementing what was used is not the same question
    # as deciding what may be ordered.
    "_decrement_inventory_item",
}


def main():
    src = open(TARGET, encoding="utf8").read()
    tree = ast.parse(src)
    offenders = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name in ALLOWED:
            continue
        for sub in ast.walk(node):
            if not isinstance(sub, ast.Constant) or not isinstance(sub.value, str):
                continue
            text = sub.value
            upper = text.upper()
            if not any(t in text for t in TABLES) or "FROM" not in upper:
                continue
            # "does this table exist?" is a schema probe, not a menu read.
            if "INFORMATION_SCHEMA" in upper:
                continue
            offenders.append((node.name, sub.lineno))

    if offenders:
        print("FAIL: functions querying a menu table directly instead of "
              "using an accessor:")
        for name, line in sorted(set(offenders)):
            print(f"    {TARGET}:{line}  in {name}()")
        print("\n  These must call one of the _get_available_* accessors, which")
        print("  consult the Organiser's event_inventory blob FIRST. Reading")
        print("  inventory_items directly is how the menu ends up offering")
        print("  what ordering refuses.")
        return 1

    print("  ok: only the designated accessors read the menu tables")
    return 0


if __name__ == "__main__":
    sys.exit(main())
