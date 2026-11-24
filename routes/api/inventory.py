"""Stock, recipes and the drinks catalogue.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import MANAGER_ROLES, jwt_required_with_demo, role_required_with_demo, writes_need
from datetime import date, datetime
from flask import current_app, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity
from routes.consolidated_api_routes import (  # noqa: F401
    VALID_CATALOG_CATEGORIES,
    _event_enabled_for_catalog,
    _kv_get,
    _kv_put,
    bp,
    ensure_inventory_management_tables,
    logger,
)



@bp.route('/recipes', methods=['GET'])
@jwt_required_with_demo()
def list_recipes():
    """Every recipe row, grouped drink -> size -> lines. The data the
    coming recipe editor reads; until then, the way to SEE what the
    ledger will do (docs/MENU_ARCHITECTURE.md)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        cur.execute(
            "SELECT drink, size, ingredient_category, ingredient_name, "
            "quantity, unit, source FROM recipes ORDER BY drink, size, id")
        out = {}
        for r in cur.fetchall():
            d, sz, cat, name, qty, unit, src = (
                (r['drink'], r['size'], r['ingredient_category'],
                 r['ingredient_name'], r['quantity'], r['unit'], r['source'])
                if isinstance(r, dict) else r)
            out.setdefault(d, {}).setdefault(sz, []).append({
                'category': cat, 'name': name,
                'quantity': float(qty), 'unit': unit, 'source': src,
            })
        return jsonify({'success': True, 'recipes': out})
    except Exception as e:
        logger.error(f"list_recipes error: {e}")
        try:
            coffee_system.db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/recipes/drinks-debug', methods=['GET'])
@jwt_required_with_demo()
def drinks_debug():
    """Every stage of the drink-menu pipeline, separately. Built when
    ristretto and magic were enabled in the event inventory yet the
    kiosk kept serving exactly the standard six, twice, after two fixes
    that each looked complete -- the merged result alone cannot say
    which stage lied."""
    coffee_system = current_app.config.get('coffee_system')
    out = {}
    try:
        out['standard_menu'] = list(coffee_system._STANDARD_DRINK_MENU)
    except Exception as e:
        out['standard_error'] = str(e)
    try:
        en = coffee_system._get_event_enabled_coffees()
        out['event_enabled_coffees'] = sorted(en) if en else en
    except Exception as e:
        out['event_enabled_error'] = str(e)
    try:
        out['extra_drinks'] = list(coffee_system._get_available_extra_drinks() or [])
    except Exception as e:
        out['extra_drinks_error'] = str(e)
    try:
        out['available_coffee_types'] = list(
            coffee_system._get_available_coffee_types() or [])
    except Exception as e:
        out['available_error'] = str(e)
    try:
        from services.recipes import get_overrides
        out['overrides'] = [
            [c, n, st] for (c, n), st in get_overrides(coffee_system.db).items()]
    except Exception as e:
        out['overrides_error'] = str(e)
    return jsonify({'success': True, **out})



@bp.route('/recipes/milks-debug', methods=['GET'])
@jwt_required_with_demo()
def milks_debug():
    """Every stage of the milk-menu pipeline, separately. Built when a
    dry almond survived on the menu and the merged result alone could
    not say which stage lied."""
    coffee_system = current_app.config.get('coffee_system')
    out = {}
    try:
        cur = coffee_system.db.cursor()
        cur.execute(
            """SELECT LOWER(name), COALESCE(amount, current_quantity),
                      COALESCE(minimum_threshold, 0)
               FROM inventory_items WHERE category = 'milk' ORDER BY name""")
        out['ledger'] = [
            [r[0], float(r[1] or 0), float(r[2] or 0)] for r in cur.fetchall()]
    except Exception as e:
        out['ledger_error'] = str(e)
    try:
        out['tracked'] = coffee_system._all_tracked_milk_names()
    except Exception as e:
        out['tracked_error'] = str(e)
    try:
        out['event_enabled'] = coffee_system._event_enabled('milk')
    except Exception as e:
        out['event_error'] = str(e)
    try:
        out['unlimited_mode'] = coffee_system._is_unlimited_stock_mode()
    except Exception as e:
        out['unlimited_error'] = str(e)
    try:
        out['final'] = coffee_system._get_available_milk_types()
    except Exception as e:
        out['final_error'] = str(e)
    return jsonify({'success': True, **out})



@bp.route('/stock-overrides', methods=['GET', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def stock_overrides():
    """The 86 board (Steve's decision 3: both directions, logged).

    GET  -> every current override, newest first.
    POST -> {"category": "milk"|"coffee"|"extras"|"drink"|...,
             "name": "oat", "state": "86"|"on"|"clear",
             "station_id": optional}
    '86' refuses the item everywhere it appears in a resolved recipe
    (86 the chocolate powder, lose mocha AND hot chocolate). 'on'
    forces a drink makeable past the ledger gate. 'clear' removes the
    override and the arithmetic speaks again. Every write records who
    and when, and reads back as an OVERRIDE, never as computed state.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        if request.method == 'GET':
            cur.execute(
                "SELECT id, category, item_name, station_id, state, "
                "set_by, set_at FROM stock_overrides ORDER BY set_at DESC")
            rows = []
            for r in cur.fetchall():
                vals = list(r.values()) if isinstance(r, dict) else list(r)
                rows.append({
                    'id': vals[0], 'category': vals[1], 'name': vals[2],
                    'station_id': vals[3], 'state': vals[4],
                    'set_by': vals[5],
                    'set_at': vals[6].isoformat() if hasattr(vals[6], 'isoformat') else vals[6],
                })
            return jsonify({'success': True, 'overrides': rows})

        data = request.get_json() or {}
        category = str(data.get('category') or '').strip().lower()
        name = str(data.get('name') or '').strip().lower()
        state = str(data.get('state') or '').strip().lower()
        station_id = data.get('station_id')
        if not category or not name or state not in ('86', 'on', 'clear'):
            return jsonify({'success': False,
                            'message': "category, name and state "
                                       "('86'|'on'|'clear') required"}), 400
        try:
            who = get_jwt_identity()
        except Exception:
            who = None
        if state == 'clear':
            if station_id is None:
                cur.execute(
                    "DELETE FROM stock_overrides WHERE category = %s "
                    "AND item_name = %s AND station_id IS NULL",
                    (category, name))
            else:
                cur.execute(
                    "DELETE FROM stock_overrides WHERE category = %s "
                    "AND item_name = %s AND station_id = %s",
                    (category, name, int(station_id)))
        else:
            cur.execute(
                """
                INSERT INTO stock_overrides
                    (category, item_name, station_id, state, set_by, set_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (category, item_name, COALESCE(station_id, 0))
                DO UPDATE SET state = EXCLUDED.state,
                              set_by = EXCLUDED.set_by,
                              set_at = NOW()
                """,
                (category, name,
                 int(station_id) if station_id is not None else None,
                 state, str(who) if who else None))
        db.commit()
        return jsonify({'success': True, 'category': category,
                        'name': name, 'state': state})
    except Exception as e:
        logger.error(f"stock_overrides error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/recipes', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def upsert_recipe_line():
    """Edit one recipe quantity (the Organiser's recipe editor).

    Body: {drink, size, category, name (null = customer's choice),
           quantity, unit}. Upserts through the same COALESCE-keyed
    index the seed uses; the row becomes source='custom', which the
    boot re-seed never touches again -- an operator's dose survives
    every deploy (Steve's decision 4: shipped defaults, editable).
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        data = request.get_json() or {}
        drink = str(data.get('drink') or '').strip().lower()
        size = str(data.get('size') or '').strip().lower()
        category = str(data.get('category') or '').strip().lower()
        name = data.get('name')
        name = str(name).strip().lower() if name not in (None, '') else None
        unit = str(data.get('unit') or '').strip()
        try:
            quantity = float(data.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({'success': False,
                            'message': 'quantity must be a number'}), 400
        if not drink or not size or not category or not unit or quantity < 0:
            return jsonify({'success': False,
                            'message': 'drink, size, category, unit and a '
                                       'non-negative quantity are required'}), 400
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO recipes (drink, size, ingredient_category,
                                 ingredient_name, quantity, unit, source)
            VALUES (%s, %s, %s, %s, %s, %s, 'custom')
            ON CONFLICT (drink, size, ingredient_category,
                         COALESCE(ingredient_name, ''))
            DO UPDATE SET quantity = EXCLUDED.quantity,
                          unit = EXCLUDED.unit,
                          source = 'custom'
            """,
            (drink, size, category, name, quantity, unit))
        db.commit()
        return jsonify({'success': True, 'drink': drink, 'size': size,
                        'category': category, 'name': name,
                        'quantity': quantity, 'unit': unit})
    except Exception as e:
        logger.error(f"upsert_recipe_line error: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/recipes/check', methods=['GET'])
@jwt_required_with_demo()
def recipes_check():
    """Diagnostic: what would gate 2 say for this drink, and WHY.

    ?drink=mocha&size=medium&milk=skim&bean=decaf&shots=2

    Built while chasing a gate that failed open in production with no
    trace: the resolver, the ingredient match and the verdict all live
    server-side, and Railway's logs are not to hand at a cart. This
    answers "why was that allowed/refused" from the system itself --
    the same lesson as /api/sms/health, applied to stock.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        from services.recipes import check_ingredients, resolve_order
        if request.args.get('order'):
            # Resolve from a STORED order's actual details -- the shape
            # that reaches the decrement is the shape saved at
            # acceptance, and S7 of the scenario matrix proved those
            # two can differ from what the parser knew.
            cur0 = coffee_system.db.cursor()
            cur0.execute(
                'SELECT order_details FROM orders WHERE order_number = %s',
                (str(request.args.get('order')),))
            row0 = cur0.fetchone()
            raw = (row0[0] if row0 and not isinstance(row0, dict)
                   else (row0 or {}).get('order_details'))
            if isinstance(raw, str):
                raw = json.loads(raw)
            od = raw or {}
            od.pop('name', None)  # not needed for resolution
        else:
            od = {
                'type': request.args.get('drink') or '',
                'size': request.args.get('size') or 'medium',
                'milk': request.args.get('milk') or '',
                'bean_type': request.args.get('bean') or '',
            }
            if request.args.get('shots'):
                od['shots'] = request.args.get('shots')
        out = {'order': od,
               'requested_bean': coffee_system._requested_bean(od)}
        try:
            out['sold_out_mode'] = str(
                coffee_system._get_setting('sold_out_mode', 'strict'))
        except Exception as e:
            out['sold_out_mode_error'] = str(e)
        try:
            lines, meta = resolve_order(
                coffee_system.db, od, coffee_system._get_setting,
                requested_bean=coffee_system._requested_bean(od))
            out['resolved'] = lines
            out['meta'] = meta
        except Exception as e:
            out['resolve_error'] = str(e)
            lines = None
        if lines:
            # Per-line: what inventory row matched, with its numbers.
            rows = []
            try:
                cur = coffee_system.db.cursor()
                for ln in lines:
                    nm = str(ln.get('name') or '').strip().lower()
                    cur.execute(
                        """
                        SELECT name, COALESCE(amount, current_quantity),
                               COALESCE(minimum_threshold, 0)
                        FROM inventory_items
                        WHERE category = %s
                          AND (LOWER(name) = %s OR LOWER(name) LIKE %s
                               OR %s LIKE '%%' || LOWER(name) || '%%')
                        ORDER BY (LOWER(name) = %s) DESC LIMIT 1
                        """,
                        (ln['category'], nm, f"%{nm}%", nm, nm))
                    r = cur.fetchone()
                    rows.append({'line': ln,
                                 'matched': (list(r) if r and not isinstance(r, dict)
                                             else (r if r else None))})
            except Exception as e:
                out['match_error'] = str(e)
                try:
                    coffee_system.db.rollback()
                except Exception:
                    pass
            out['matches'] = rows
            try:
                ok, missing = check_ingredients(coffee_system.db, lines)
                out['gate'] = {'ok': ok, 'missing': missing}
            except Exception as e:
                out['gate_error'] = str(e)
            try:
                ok2, msg2 = coffee_system.check_order_makeable(od)
                out['check_order_makeable'] = {'ok': ok2, 'message': msg2}
            except Exception as e:
                out['makeable_error'] = str(e)
        return jsonify({'success': True, **out})
    except Exception as e:
        logger.error(f"recipes_check error: {e}", exc_info=True)
        return jsonify({'success': False, 'error': str(e)}), 200



# /inventory/<id> GET, PUT, PATCH, DELETE, /adjust and /report-low live in
# routes/inventory_routes.py (int ids). Copies here with a string converter
# only ever ran for non-numeric ids and were broken; removed. A string twin
# of an int route is now a CI error (scripts/check_route_shadowing.py).


@bp.route('/inventory', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def create_inventory_item():
    """Create a new inventory item"""
    try:
        # Get request data
        data = request.json
        name = data.get('name')
        category = data.get('category')
        current_quantity = data.get('current_quantity')
        unit = data.get('unit')
        station_id = data.get('station_id')
        minimum_threshold = data.get('minimum_threshold')
        
        # Validate required fields
        if not name or not category or current_quantity is None or not unit:
            return jsonify({
                'success': False,
                'message': "Name, category, current_quantity, and unit are required"
            }), 400
        
        # Numbers, and no minimum means 0. A create without
        # minimum_threshold used to crash comparing the quantity with None
        # (HTTP 500, test bench inv_crud).
        try:
            current_quantity = float(current_quantity)
            minimum_threshold = float(minimum_threshold) if minimum_threshold not in (None, '') else 0.0
        except (TypeError, ValueError):
            return jsonify({
                'success': False,
                'message': "current_quantity and minimum_threshold must be numbers"
            }), 400

        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        # Recover the shared connection first -- the matrix hit this
        # right after another write and got a generic 400 where the
        # duplicate check should have answered 409: the transaction was
        # poisoned and the SELECT below raised. Same defensive rollback
        # every other endpoint on this connection carries.
        try:
            db.rollback()
        except Exception:
            pass

        # ONE ROW PER INGREDIENT (per station scope). The scenario matrix
        # created 'chocolate powder' twice and the availability gate's
        # LIMIT 1 read the FULL row while the dry one sat beside it --
        # the gate went blind to its own ingredient. Nothing stopped an
        # operator doing the same by hand. A duplicate name in the same
        # category and scope now returns the existing row instead of
        # forking the ledger.
        cursor = db.cursor()
        if station_id is None:
            cursor.execute(
                "SELECT id FROM inventory_items WHERE category = %s "
                "AND LOWER(name) = LOWER(%s) AND station_id IS NULL LIMIT 1",
                (category, name))
        else:
            cursor.execute(
                "SELECT id FROM inventory_items WHERE category = %s "
                "AND LOWER(name) = LOWER(%s) AND station_id = %s LIMIT 1",
                (category, name, station_id))
        dup = cursor.fetchone()
        if dup:
            dup_id = dup[0] if not isinstance(dup, dict) else dup.get('id')
            return jsonify({
                'success': False,
                'message': (f"'{name}' already exists in {category} "
                            f"(id {dup_id}). Adjust its quantity instead "
                            "of creating a second row -- two rows for one "
                            "ingredient makes stock counting meaningless."),
                'existing_id': dup_id,
            }), 409

        # capacity is NOT NULL in the table; a new item starts full unless told.
        try:
            capacity = float(data.get('capacity') or current_quantity or 0)
        except (TypeError, ValueError):
            capacity = float(current_quantity or 0)

        # Insert new item
        status = 'low_stock' if current_quantity <= minimum_threshold else 'in_stock'
        # inventory_items has no "status" column (models/inventory.py): it
        # is worked out here and returned, never stored. Writing it made every
        # create a 500 ("column status does not exist"), found 15 Oct 2026;
        # capacity was never written either, and the column is NOT NULL.
        cursor.execute("""
            INSERT INTO inventory_items
            (name, category, current_quantity, amount, capacity, unit, station_id, minimum_threshold, created_at, last_updated)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (name, category, current_quantity, current_quantity, capacity, unit, station_id, minimum_threshold,
              datetime.now().isoformat(), datetime.now().isoformat()))
        
        # Get column names
        columns = [desc[0] for desc in cursor.description]
        
        # Get inserted item
        row = cursor.fetchone()
        db.commit()
        
        # Format item
        item = dict(zip(columns, row))
        item['status'] = status

        return jsonify({
            'success': True,
            'message': "Inventory item created successfully",
            'item': item
        }), 201
    
    except Exception as e:
        logger.error(f"Error creating inventory item: {str(e)}")
        return jsonify({
            'success': False,
            'message': f"Error creating inventory item: {str(e)}"
        }), 500


# ---------------------------------------------------------------------------
# Source-of-truth event inventory
# ---------------------------------------------------------------------------
# The "master list" of what's on the menu (categories with enabled flags) used
# to live ONLY in `localStorage.event_inventory`. That meant different
# browsers/devices could disagree on what was on offer, and the Quick Setup
# wizard had to manually rewrite each browser's local copy. Now the master
# list is persisted to the `settings` table (key='event_inventory'). Local
# stores keep working as a write-through cache; the backend is authoritative.
@bp.route('/event-inventory', methods=['GET'])
@jwt_required_with_demo()
def get_event_inventory():
    """Return the master inventory list (what's on the menu).

    Shape: { milk: [...], coffee: [...], cups: [...], syrups: [...],
             sweeteners: [...], drinks: [...], extras: [...] }
    Each item: { id, name, description, enabled, ...optional }
    Returns {} on first access — frontend treats that as "use the
    InventoryManagement defaults and POST them back on first save".
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        inventory = _kv_get(coffee_system.db, 'event_inventory', default=None)
        return jsonify(inventory or {})
    except Exception as e:
        logger.error(f"get_event_inventory error: {e}")
        return jsonify({}), 200



@bp.route('/event-inventory', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@role_required_with_demo(MANAGER_ROLES)
def upsert_event_inventory():
    """Persist the master inventory list. The whole blob is replaced.

    InventoryManagement.js and Quick Setup both POST to this endpoint
    after editing. The SMS bot reads via _get_event_inventory() which
    falls back to inventory_items for legacy DBs.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'payload must be an object'}), 400
        _kv_put(coffee_system.db, 'event_inventory', data)
        # Tell anyone listening (other tabs, the SMS bot, etc.) that
        # the menu changed. Echoed to the React event bus via WS.
        try:
            socketio = current_app.config.get('socketio')
            if socketio:
                socketio.emit('event_inventory_updated', {'keys': list(data.keys())},
                              room='all_stations')
        except Exception:
            pass
        return jsonify({'success': True, 'event_inventory': data})
    except Exception as e:
        logger.error(f"upsert_event_inventory error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/catalog/<category>', methods=['GET'])
@jwt_required_with_demo()
def get_catalog(category):
    """List canonical items for a category.

    Query params:
      include_inactive=1  — include rows where is_active=false
      include_custom=0    — exclude operator-added customs

    Response:
      {
        "category": "milk",
        "items": [
          {"id": "full_cream", "name": "Full Cream Milk",
           "short_name": "full cream", "subcategory": "standard",
           "properties": {...}, "is_custom": false, ...},
          ...
        ]
      }
    """
    try:
        if category not in VALID_CATALOG_CATEGORIES:
            return jsonify({
                'success': False,
                'error': f"Unknown category '{category}'. Valid: "
                         f"{sorted(VALID_CATALOG_CATEGORIES)}",
            }), 400

        include_inactive = request.args.get('include_inactive') == '1'
        include_custom_raw = request.args.get('include_custom', '1')
        include_custom = include_custom_raw != '0'

        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not getattr(coffee_system, 'db', None):
            return jsonify({'success': False, 'error': 'DB unavailable'}), 503

        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass

        where = ['category = %s']
        params: list = [category]
        if not include_inactive:
            where.append('is_active = TRUE')
        if not include_custom:
            where.append('is_custom = FALSE')

        cur.execute(f"""
            SELECT item_id, display_name, short_name, subcategory,
                   properties, sort_order, is_active, is_custom
            FROM catalog_items
            WHERE {' AND '.join(where)}
            ORDER BY sort_order, display_name
        """, params)

        items = []
        for row in cur.fetchall():
            iid, dn, sn, sub, props, sort, active, custom = row
            items.append({
                'id': iid,
                'name': dn,
                'short_name': sn,
                'subcategory': sub,
                'properties': props or {},
                'sort_order': sort,
                'is_active': active,
                'is_custom': custom,
            })

        # event_only=1 narrows the CANONICAL catalogue to what this event
        # actually serves.
        #
        # The catalogue deliberately lists everything that exists, because
        # the Organiser's inventory editor needs the full set to offer
        # toggles for. Order-entry surfaces need the opposite: only what is
        # switched on. Serving both from one unfiltered endpoint is why the
        # walk-in screen still offered Oat, Lactose-Free and even "Smoke
        # Test Milk" at an event configured for four milks -- it was reading
        # the catalogue of everything that COULD exist and presenting it as
        # a menu.
        #
        # Opt-in rather than default, so the editor keeps seeing everything.
        # ALWAYS annotate. Steve wants unavailable items greyed out rather
        # than vanishing -- "grey = not available" reads as a deliberate
        # decision, where a missing tile just looks like the system does
        # not know about oat milk. Greying needs the item to still be in
        # the response, so the flag goes on every item and the client
        # decides whether to dim it or drop it.
        try:
            enabled_names = _event_enabled_for_catalog(coffee_system, category)
            if enabled_names is not None:
                keep_set = set(enabled_names)
                for it in items:
                    it['event_enabled'] = coffee_system._normalise_menu_name(
                        it.get('short_name') or it.get('name')) in keep_set
                # If NOTHING matched, the two vocabularies failed to line
                # up -- an event that serves literally nothing is not a
                # real state. Greying every tile would leave a barista
                # unable to take an order at all, which is far worse than
                # showing one milk too many. Same fallback the event_only
                # filter already makes; it was missing here.
                if (enabled_names and items
                        and not any(it.get('event_enabled') for it in items)):
                    logger.warning(
                        "catalog %s: no item matched the event menu %s -- "
                        "marking all available rather than greying the whole "
                        "screen out", category, enabled_names)
                    for it in items:
                        it['event_enabled'] = True
            else:
                # None = genuinely never configured. Everything-switched-off
                # arrives as [] and takes the branch ABOVE, so an all-off
                # category greys/hides properly instead of being mistaken
                # for a blank config (the bug that put Rooibos Tea on the
                # order editor at a coffee-only event).
                for it in items:
                    it['event_enabled'] = True
        except Exception as e:
            logger.warning(f"catalog event_enabled annotation failed: {e}")
            for it in items:
                it.setdefault('event_enabled', True)

        if request.args.get('event_only') == '1':
            try:
                enabled = _event_enabled_for_catalog(coffee_system, category)
                if enabled:
                    keep = set(enabled)
                    filtered = [
                        it for it in items
                        if coffee_system._normalise_menu_name(
                            it.get('short_name') or it.get('name')) in keep
                    ]
                    # Never hand back an empty menu because two vocabularies
                    # failed to line up -- an empty walk-in dropdown is a
                    # barista who cannot take an order at all.
                    if filtered:
                        items = filtered
                    else:
                        logger.warning(
                            "catalog event_only: no %s matched the event menu "
                            "%s -- serving the full catalogue rather than an "
                            "empty one", category, enabled)
            except Exception as e:
                logger.warning(f"catalog event_only filter failed: {e}")

        return jsonify({'category': category, 'items': items})
    except Exception as e:
        logger.error(f"get_catalog({category}) error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/catalog/<category>', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def add_catalog_item(category):
    """Add a custom item to the catalog.

    Body: {"name": "Hemp Milk", "short_name": "hemp" (optional),
           "subcategory": "alternative" (optional)}

    The item_id is derived from the name (lowercased, spaces→underscores)
    so it's deterministic — adding 'Hemp Milk' twice is a no-op.
    """
    try:
        if category not in VALID_CATALOG_CATEGORIES:
            return jsonify({
                'success': False,
                'error': f"Unknown category '{category}'",
            }), 400

        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': "'name' required"}), 400

        # Derive item_id deterministically so duplicates collapse.
        import re as _re
        item_id = _re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
        if not item_id:
            return jsonify({'success': False, 'error': 'name produced empty id'}), 400

        short_name = (data.get('short_name') or name).strip().lower()
        # Strip ' milk' suffix from milks for compact display.
        if category == 'milk' and short_name.endswith(' milk'):
            short_name = short_name[:-5]
        subcategory = data.get('subcategory')
        properties = data.get('properties') or {}

        coffee_system = current_app.config.get('coffee_system')
        cur = coffee_system.db.cursor()
        try:
            coffee_system.db.rollback()
        except Exception:
            pass

        # Highest sort_order + 10 puts custom items at the end of
        # the seeded list by default — operator can drag-reorder later.
        cur.execute(
            "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM catalog_items WHERE category = %s",
            (category,),
        )
        next_sort = cur.fetchone()[0]

        cur.execute("""
            INSERT INTO catalog_items
                (category, item_id, display_name, short_name, subcategory,
                 properties, sort_order, is_custom)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, TRUE)
            ON CONFLICT (category, item_id) DO UPDATE
                SET is_active = TRUE
            RETURNING item_id, display_name, short_name, subcategory,
                      properties, sort_order, is_active, is_custom
        """, (category, item_id, name, short_name, subcategory,
              json.dumps(properties), next_sort))
        row = cur.fetchone()
        coffee_system.db.commit()

        iid, dn, sn, sub, props, sort, active, custom = row
        return jsonify({
            'success': True,
            'item': {
                'id': iid, 'name': dn, 'short_name': sn,
                'subcategory': sub, 'properties': props or {},
                'sort_order': sort, 'is_active': active, 'is_custom': custom,
            }
        })
    except Exception as e:
        logger.error(f"add_catalog_item({category}) error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/inventory/transfer', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(MANAGER_ROLES)
def transfer_inventory():
    """Move stock from one station to another.

    Body: { from_station: int|null, to_station: int|null, name: str,
            category: str, amount: float }

    A null station_id means the "event-wide" pool (the row with
    station_id IS NULL). Useful for "I'm taking 5L oat from event
    reserve to Station 2".
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        from_station = data.get('from_station')
        to_station = data.get('to_station')
        name = (data.get('name') or '').strip().lower()
        category = (data.get('category') or '').strip().lower()
        amount = float(data.get('amount') or 0)
        if not name or not category or amount <= 0:
            return jsonify({'success': False, 'error': 'name, category, and a positive amount are required'}), 400
        if from_station == to_station:
            return jsonify({'success': False, 'error': 'from_station and to_station must differ'}), 400

        cur = db.cursor()
        # Decrement from source. We GREATEST(0, …) so we never go
        # negative — short transfers just zero out the source row.
        if from_station is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    current_quantity = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    current_quantity = GREATEST(0, COALESCE(amount, current_quantity, 0) - %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, category, name, from_station))
        src_row = cur.fetchone()
        if not src_row:
            db.rollback()
            return jsonify({'success': False,
                            'error': f'No {category}/{name} row found at source station'}), 404

        # Increment destination. Upsert: if the row doesn't exist
        # for the destination, create it.
        if to_station is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, category, name, to_station))
        dst_row = cur.fetchone()

        if not dst_row:
            # Destination station doesn't have a row for this item yet
            # — insert one. Copy unit/capacity from source if we can.
            cur.execute("""
                SELECT unit, capacity, minimum_threshold FROM inventory_items
                WHERE LOWER(category) = %s AND LOWER(name) = %s
                LIMIT 1
            """, (category, name))
            template = cur.fetchone() or ('units', amount * 2, 0)
            unit, capacity, min_thr = template
            cur.execute("""
                INSERT INTO inventory_items
                  (category, name, amount, current_quantity, unit, capacity, minimum_threshold, station_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (category, name, amount, amount, unit, capacity, min_thr, to_station))

        db.commit()
        logger.info(f"Inventory transfer: {amount} {category}/{name} from station {from_station} → {to_station}")
        return jsonify({'success': True,
                        'source_remaining': float(src_row[0]),
                        'destination_amount': float(dst_row[0]) if dst_row else amount})
    except Exception as e:
        logger.error(f"transfer_inventory error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/inventory/emergency-restock', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff', 'barista'])
def emergency_restock():
    """Bump a single inventory_items row up by the requested amount.

    Body: { item: str, type: str (= category), amount: float,
            station_id?: int|null, priority?: str }

    The "priority" field is accepted for compatibility with the
    existing UI but isn't persisted — emergency restocks are
    inherently urgent. Returns the new amount.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        name = (data.get('item') or data.get('name') or '').strip().lower()
        category = (data.get('type') or data.get('category') or '').strip().lower()
        amount = float(data.get('amount') or 0)
        station_id = data.get('station_id')  # may be None — event-wide
        if not name or not category or amount <= 0:
            return jsonify({'success': False, 'error': 'item, type, and positive amount required'}), 400

        cur = db.cursor()
        if station_id is None:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    capacity = GREATEST(capacity, COALESCE(amount, current_quantity, 0) + %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id IS NULL
                RETURNING amount
            """, (amount, amount, amount, category, name))
        else:
            cur.execute("""
                UPDATE inventory_items
                SET amount = COALESCE(amount, current_quantity, 0) + %s,
                    current_quantity = COALESCE(amount, current_quantity, 0) + %s,
                    capacity = GREATEST(capacity, COALESCE(amount, current_quantity, 0) + %s),
                    last_updated = CURRENT_TIMESTAMP
                WHERE LOWER(category) = %s AND LOWER(name) = %s AND station_id = %s
                RETURNING amount
            """, (amount, amount, amount, category, name, station_id))
        row = cur.fetchone()
        if not row:
            # No row exists — create one.
            cur.execute("""
                INSERT INTO inventory_items
                  (category, name, amount, current_quantity, unit, capacity, minimum_threshold, station_id)
                VALUES (%s, %s, %s, %s, 'units', %s, 0, %s)
                RETURNING amount
            """, (category, name, amount, amount, amount * 2, station_id))
            row = cur.fetchone()
        db.commit()
        return jsonify({'success': True, 'amount': float(row[0])})
    except Exception as e:
        logger.error(f"emergency_restock error: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/event-stock', methods=['GET'])
@jwt_required_with_demo()
def get_event_stock():
    """Event-wide stock levels (the inventory that exists for the
    whole event, before being allocated to stations). Same KV
    persistence pattern as the other JSON blobs."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        stock = _kv_get(coffee_system.db, 'event_stock_levels', default={}) or {}
        return jsonify(stock)
    except Exception as e:
        logger.error(f"get_event_stock error: {e}")
        return jsonify({}), 200



@bp.route('/event-stock', methods=['PUT', 'POST'])
@jwt_required_with_demo()
@writes_need(MANAGER_ROLES)
def upsert_event_stock():
    try:
        coffee_system = current_app.config.get('coffee_system')
        data = request.get_json() or {}
        _kv_put(coffee_system.db, 'event_stock_levels', data)
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"upsert_event_stock error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
