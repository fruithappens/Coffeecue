"""Quick setup, event templates and integrations.

Endpoints under /api, moved here unchanged from
routes/consolidated_api_routes.py (roadmap X7-11). They register on the
same blueprint, so every address and endpoint name is as it was.
"""
import json
from auth import jwt_required_with_demo, role_required_with_demo
from flask import current_app, jsonify, request
from routes.consolidated_api_routes import (  # noqa: F401
    DEFAULT_QUICK_PRESET,
    ESPRESSO_DRINKS,
    _apply_quick_setup,
    _compute_proposed_inventory,
    _eventsair_secret_ok,
    _kv_get,
    _normalize_eventsair_order,
    _qs_current,
    _qs_remember,
    bp,
    logger,
)



@bp.route('/quick-setup/preset', methods=['GET'])
@jwt_required_with_demo()
def get_quick_setup_preset():
    """Return the suggested defaults so the UI can pre-fill checkboxes."""
    return jsonify({'preset': DEFAULT_QUICK_PRESET})



@bp.route('/quick-setup/current', methods=['GET'])
@jwt_required_with_demo()
def get_quick_setup_current():
    """What is running now, so the form and "Save current" start from it."""
    try:
        preset, recorded = _qs_current(current_app.config.get('coffee_system').db)
        return jsonify({'success': True, 'preset': preset, 'recorded': recorded})
    except Exception as e:
        logger.exception(f"quick setup current failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/quick-setup', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def apply_quick_setup():
    """Apply the supplied preset (or DEFAULT_QUICK_PRESET if empty).

    DESTRUCTIVE: wipes the inventory_items table before rebuilding.
    The endpoint requires admin/staff role. Returns a summary of
    everything that was applied.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json() or {}
        preset = body.get('preset') if isinstance(body.get('preset'), dict) else body or DEFAULT_QUICK_PRESET
        # Merge with defaults so callers can send just the fields
        # they want to override.
        merged = {**DEFAULT_QUICK_PRESET, **(preset or {})}
        # A SAVED EVENT is being applied (Demo Room Load, or Quick Setup
        # after loading one): its look replaces the current one.
        if body.get('replace_look') is True:
            merged['_replace_look'] = True
        # drinks is a nested dict — merge it too
        if isinstance(preset.get('drinks'), dict):
            merged['drinks'] = {
                **DEFAULT_QUICK_PRESET['drinks'],
                **preset['drinks'],
            }
        # teas is a nested dict — same merge pattern
        if isinstance(preset.get('teas'), dict):
            merged['teas'] = {
                **DEFAULT_QUICK_PRESET['teas'],
                **preset['teas'],
            }
        summary = _apply_quick_setup(coffee_system, merged)
        merged.pop('_replace_look', None)  # an instruction, not part of the event
        _qs_remember(coffee_system.db, merged)
        # Invalidate the unlimited-stock cache so the conversation
        # flow's next read picks up the new value immediately.
        if hasattr(coffee_system, '_invalidate_unlimited_stock_cache'):
            coffee_system._invalidate_unlimited_stock_cache()
        # Return the real station list so the frontend can mirror
        # the preset into per-station localStorage stock data
        # (coffee_stock_station_N). Without this the walk-in dialog
        # reads stale per-station stock and shows different milks
        # at different stations even though Quick Setup picked
        # the same set for all of them.
        stations = []
        try:
            cur = coffee_system.db.cursor()
            cur.execute(
                "SELECT station_id, COALESCE(notes, '') "
                "FROM station_stats ORDER BY station_id"
            )
            stations = [
                {'id': row[0], 'name': row[1] or f'Station {row[0]}'}
                for row in cur.fetchall()
            ]
        except Exception as e:
            logger.warning(f"could not enumerate stations for quick-setup response: {e}")
            try:
                coffee_system.db.rollback()
            except Exception:
                pass
        return jsonify({
            'success': True,
            'applied': summary,
            'summary': '; '.join(summary),
            'preset': merged,
            'stations': stations,
        })
    except Exception as e:
        logger.exception(f"apply_quick_setup failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/quick-setup/dry-run', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def dry_run_quick_setup():
    """Return what an Apply would change, without changing anything.

    The biggest worry operators have re-running Quick Setup is "did
    that just wipe my custom stock amounts?" — because the real apply
    DELETEs inventory_items before inserting. This endpoint shows them
    the diff so they can confirm before pulling the trigger.

    Response shape:
      {
        success: true,
        inventory: {
          added:   [{category, name}],   # rows the apply will insert
          removed: [{category, name, amount, unit}],  # current rows that will disappear
          unchanged: [{category, name}], # both lists have it
        },
        capabilities: {
          will_overwrite_all: bool,
          stations: [{station_id, current, proposed}],
        },
        settings: {
          vip_code:        {current, proposed, changed},
          unlimited_stock: {current, proposed, changed},
          activate_all_stations: {will_activate: int},
          always_open_schedule:  {breaks_to_delete: int},
        },
      }
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        body = request.get_json() or {}
        preset = body.get('preset') if isinstance(body.get('preset'), dict) else body or DEFAULT_QUICK_PRESET
        merged = {**DEFAULT_QUICK_PRESET, **(preset or {})}
        if isinstance(preset.get('drinks'), dict):
            merged['drinks'] = {**DEFAULT_QUICK_PRESET['drinks'], **preset['drinks']}
        if isinstance(preset.get('teas'), dict):
            merged['teas'] = {**DEFAULT_QUICK_PRESET['teas'], **preset['teas']}

        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()

        proposed_inv = _compute_proposed_inventory(merged)
        proposed_set = {(c, n) for c, n in proposed_inv}

        current_rows = []
        try:
            cur.execute("""
                SELECT category, COALESCE(name, ''), amount, COALESCE(unit, '')
                  FROM inventory_items
            """)
            for r in cur.fetchall() or []:
                if isinstance(r, dict):
                    current_rows.append({
                        'category': r['category'],
                        'name': r.get('name') or '',
                        'amount': r.get('amount'),
                        'unit': r.get('unit') or '',
                    })
                else:
                    current_rows.append({
                        'category': r[0],
                        'name': r[1] or '',
                        'amount': r[2],
                        'unit': r[3] or '',
                    })
        except Exception as e:
            logger.warning(f"dry-run: could not read inventory_items: {e}")

        current_set = {((row['category'] or '').lower(), (row['name'] or '').lower().strip())
                       for row in current_rows}

        added = [
            {'category': c, 'name': n}
            for (c, n) in proposed_inv
            if (c, n) not in current_set
        ]
        removed = [
            row for row in current_rows
            if ((row['category'] or '').lower(), (row['name'] or '').lower().strip()) not in proposed_set
        ]
        unchanged = [
            {'category': c, 'name': n}
            for (c, n) in proposed_inv
            if (c, n) in current_set
        ]

        capabilities_diff = {
            'will_overwrite_all': bool(merged.get('all_stations_same_capabilities')),
            'stations': [],
        }
        if merged.get('all_stations_same_capabilities'):
            proposed_caps = {
                'milk_types': merged.get('milks', []),
                'coffee_types': ESPRESSO_DRINKS,
                'sizes': merged.get('sizes', []),
                'alt_milk': True,
            }
            try:
                cur.execute("SELECT station_id, capabilities FROM station_stats ORDER BY station_id")
                for r in cur.fetchall() or []:
                    if isinstance(r, dict):
                        sid = r['station_id']
                        cur_caps = r.get('capabilities') or {}
                    else:
                        sid = r[0]
                        cur_caps = r[1] or {}
                    capabilities_diff['stations'].append({
                        'station_id': sid,
                        'current': cur_caps,
                        'proposed': proposed_caps,
                    })
            except Exception as e:
                logger.warning(f"dry-run: capabilities read failed: {e}")

        settings_diff = {}

        current_vip = ''
        try:
            cur.execute("SELECT value FROM settings WHERE key = 'vip_code'")
            row = cur.fetchone()
            if row:
                current_vip = (row['value'] if isinstance(row, dict) else row[0]) or ''
        except Exception:
            pass
        proposed_vip = (merged.get('vip_code') or '').strip()
        settings_diff['vip_code'] = {
            'current': current_vip,
            'proposed': proposed_vip if proposed_vip else current_vip,
            'changed': bool(proposed_vip) and proposed_vip != current_vip,
        }

        current_unlimited = bool(_kv_get(db, 'unlimited_stock_mode', default={}).get('enabled', False))
        proposed_unlimited = bool(merged.get('unlimited_stock'))
        settings_diff['unlimited_stock'] = {
            'current': current_unlimited,
            'proposed': proposed_unlimited,
            'changed': current_unlimited != proposed_unlimited,
        }

        will_activate = 0
        try:
            cur.execute("SELECT COUNT(*) FROM station_stats WHERE status != 'active'")
            row = cur.fetchone()
            will_activate = int((row['count'] if isinstance(row, dict) else row[0]) or 0)
        except Exception:
            pass
        settings_diff['activate_all_stations'] = {
            'will_activate': will_activate if merged.get('activate_all_stations') else 0,
        }

        breaks_to_delete = 0
        if merged.get('always_open_schedule'):
            try:
                cur.execute("SELECT COUNT(*) FROM event_breaks")
                row = cur.fetchone()
                breaks_to_delete = int((row['count'] if isinstance(row, dict) else row[0]) or 0)
            except Exception:
                pass
        settings_diff['always_open_schedule'] = {
            'breaks_to_delete': breaks_to_delete,
        }
        # What a recalled EVENT template sets beyond the menu (see
        # _apply_event_extras), so the preview names it before Apply.
        extras = []
        if isinstance(merged.get('branding'), dict) and merged['branding']:
            extras.append(f"branding ({len(merged['branding'])} field(s))")
        if isinstance(merged.get('event_inventory'), dict) and merged['event_inventory']:
            extras.append('event inventory replaced')
        if isinstance(merged.get('quick_picks'), list):
            extras.append(f"{len(merged['quick_picks'])} quick pick(s)")
        if 'sugar_self_serve' in merged:
            extras.append('sugar self-serve ' + ('on' if merged.get('sugar_self_serve') else 'off'))
        if isinstance(merged.get('active_stations'), int) and not isinstance(merged.get('active_stations'), bool):
            extras.append(f"{merged['active_stations']} station(s) on, the rest off")
        settings_diff['event_extras'] = extras

        return jsonify({
            'success': True,
            'inventory': {
                'added': added,
                'removed': [
                    {'category': r['category'], 'name': r['name'],
                     'amount': r['amount'], 'unit': r['unit']}
                    for r in removed
                ],
                'unchanged': unchanged,
                'destructive': len(removed) > 0,
            },
            'capabilities': capabilities_diff,
            'settings': settings_diff,
        })
    except Exception as e:
        logger.exception(f"dry_run_quick_setup failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500


# ----------------------------------------------------------------------
# Event templates — save a Quick Setup preset, re-apply to a new event.
#
# The friction "every new event is 30 clicks" became "every new event
# is 5 clicks" with Quick Setup. With templates it's 1 click: load the
# saved preset, hit Apply. Templates store the Quick Setup config
# shape (milks, sizes, drinks, teas, pricing, walkin defaults, SMS
# policy) — same JSON the /api/quick-setup endpoint accepts.
# ----------------------------------------------------------------------

@bp.route('/event-templates', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def list_event_templates():
    """Return all saved event templates, newest first."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT id, name, description, saved_by, saved_at, updated_at
              FROM event_templates
             ORDER BY updated_at DESC
        """)
        rows = cur.fetchall() or []
        templates = []
        for r in rows:
            if isinstance(r, dict):
                templates.append({
                    'id':          r['id'],
                    'name':        r['name'],
                    'description': r['description'],
                    'saved_by':    r['saved_by'],
                    'saved_at':    r['saved_at'].isoformat() if r['saved_at'] else None,
                    'updated_at':  r['updated_at'].isoformat() if r['updated_at'] else None,
                })
            else:
                templates.append({
                    'id': r[0], 'name': r[1], 'description': r[2],
                    'saved_by': r[3],
                    'saved_at':   r[4].isoformat() if r[4] else None,
                    'updated_at': r[5].isoformat() if r[5] else None,
                })
        return jsonify({'success': True, 'templates': templates})
    except Exception as e:
        logger.error(f"list_event_templates error: {e}")
        return jsonify({'success': False, 'templates': [], 'error': str(e)}), 200



@bp.route('/event-templates/<int:template_id>', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_event_template(template_id):
    """Return a single template's full payload — used to populate the
    Quick Setup form when the operator clicks 'Load template'."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("""
            SELECT id, name, description, payload, saved_by, saved_at, updated_at
              FROM event_templates
             WHERE id = %s
        """, (template_id,))
        row = cur.fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        if isinstance(row, dict):
            payload = row['payload']
            saved_at = row['saved_at']
            updated_at = row['updated_at']
            data = {
                'id': row['id'], 'name': row['name'],
                'description': row['description'],
                'payload': payload, 'saved_by': row['saved_by'],
                'saved_at':   saved_at.isoformat() if saved_at else None,
                'updated_at': updated_at.isoformat() if updated_at else None,
            }
        else:
            data = {
                'id': row[0], 'name': row[1], 'description': row[2],
                'payload': row[3], 'saved_by': row[4],
                'saved_at':   row[5].isoformat() if row[5] else None,
                'updated_at': row[6].isoformat() if row[6] else None,
            }
        return jsonify({'success': True, 'template': data})
    except Exception as e:
        logger.error(f"get_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/event-templates', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def save_event_template():
    """Save (or overwrite, if same name) a Quick Setup preset.

    Body: {name, description (optional), payload}

    Idempotent on name: re-saving with the same name updates the
    existing row + bumps updated_at. This is the "Save current config
    as template" flow — operator types a name, clicks Save, done.

    Strips the per-event fields (event_name, event_password,
    event_slug, num_event_baristas) from the payload before storing
    so a template doesn't carry one event's identity into another.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        data = request.get_json() or {}
        name = (data.get('name') or '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'name required'}), 400
        if len(name) > 120:
            return jsonify({'success': False, 'error': 'name too long (max 120)'}), 400
        payload = data.get('payload') or {}
        if not isinstance(payload, dict):
            return jsonify({'success': False, 'error': 'payload must be a JSON object'}), 400

        # Strip per-event identity — a template applies across events,
        # so carrying the last event's name/password would be confusing
        # (and a credential leak).
        stripped = dict(payload)
        for key in ('event_name', 'event_slug', 'event_password',
                    'num_event_baristas'):
            stripped.pop(key, None)

        description = (data.get('description') or '').strip() or None
        try:
            from flask_jwt_extended import get_jwt_identity
            saved_by = get_jwt_identity() or 'unknown'
        except Exception:
            saved_by = 'unknown'

        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO event_templates (name, description, payload, saved_by)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (name) DO UPDATE
                SET description = EXCLUDED.description,
                    payload     = EXCLUDED.payload,
                    saved_by    = EXCLUDED.saved_by,
                    updated_at  = NOW()
            RETURNING id
            """,
            (name, description, json.dumps(stripped), saved_by),
        )
        row = cur.fetchone()
        db.commit()
        new_id = row[0] if not isinstance(row, dict) else row['id']
        return jsonify({'success': True, 'id': new_id, 'name': name})
    except Exception as e:
        logger.error(f"save_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/event-templates/<int:template_id>', methods=['DELETE'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def delete_event_template(template_id):
    """Delete a saved template. Admin only — staff can save but not
    delete (less destructive default)."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        cur = db.cursor()
        cur.execute("DELETE FROM event_templates WHERE id = %s", (template_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"delete_event_template error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/integrations/eventsair/order', methods=['POST'])
def eventsair_inbound_order():
    """Receive an order placed from the EventsAir app and create it in
    Coffee Cue's normal pipeline (with stock control).

    Auth: shared-secret header (X-Coffee-Cue-Webhook-Secret).
    Idempotent on eventsair_order_id so EA retries don't double-create.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass

        ok, reason = _eventsair_secret_ok(db)
        if not ok:
            logger.warning(f"EventsAir inbound order rejected: {reason}")
            return jsonify({'success': False, 'error': reason}), 403

        payload = request.get_json(silent=True) or {}
        canonical = _normalize_eventsair_order(payload)
        if not canonical.get('coffee_type'):
            return jsonify({'success': False, 'error': 'missing coffee_type/drink'}), 400

        # Idempotency: if we've already created an order for this EA id,
        # return the existing one instead of a duplicate.
        ea_id = canonical.get('eventsair_order_id')
        if ea_id:
            cur = db.cursor()
            cur.execute(
                "SELECT order_number FROM orders "
                "WHERE order_details->>'eventsair_order_id' = %s LIMIT 1",
                (str(ea_id),),
            )
            existing = cur.fetchone()
            if existing:
                on = existing[0] if not isinstance(existing, dict) else existing.get('order_number')
                return jsonify({'success': True, 'duplicate': True, 'order_number': on})

        # Reuse the FULL existing order pipeline via an internal self-call.
        # This is deliberate: /api/orders does price compute, station
        # existence/status checks, capability gating, queue priority, WS
        # emit and (at completion) stock decrement. Re-implementing any
        # of that here would drift. We mint a short-lived service token
        # for the internal call.
        from flask_jwt_extended import create_access_token
        service_token = create_access_token(
            identity='eventsair-integration',
            additional_claims={'role': 'staff', 'source': 'eventsair'},
        )
        # Stash EA identifiers in notes-adjacent fields by extending the
        # body; /api/orders persists unknown keys it reads, and we add
        # the EA ids onto order_details via a follow-up update below.
        client = current_app.test_client()
        resp = client.post(
            '/api/orders',
            json=canonical,
            headers={'Authorization': f'Bearer {service_token}'},
        )
        if resp.status_code != 200:
            body = resp.get_json(silent=True) or {}
            return jsonify({'success': False,
                            'error': body.get('message') or f'order create failed ({resp.status_code})',
                            'detail': body}), resp.status_code
        created = resp.get_json(silent=True) or {}
        order_number = (created.get('data') or {}).get('order_number') or created.get('order_number')

        # Persist the EA identifiers onto the order_details so the
        # outbound notifier can push status back to the right attendee.
        if order_number and (ea_id or canonical.get('eventsair_contact_id')):
            try:
                cur = db.cursor()
                cur.execute(
                    "UPDATE orders SET order_details = order_details "
                    "|| %s::jsonb WHERE order_number = %s",
                    (json.dumps({
                        'eventsair_order_id': ea_id,
                        'eventsair_contact_id': canonical.get('eventsair_contact_id'),
                        'source': 'eventsair',
                    }), order_number),
                )
                db.commit()
            except Exception as e:
                logger.warning(f"EventsAir id stamp failed (non-fatal): {e}")
                try:
                    db.rollback()
                except Exception:
                    pass

        try:
            from services.logging_utils import event as _event
            _event('EVENTSAIR_ORDER_CREATED', order_number=order_number, ea_id=ea_id)
        except Exception:
            pass
        return jsonify({'success': True, 'order_number': order_number})
    except Exception as e:
        logger.exception(f"eventsair_inbound_order failed: {e}")
        try:
            current_app.config.get('coffee_system').db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/integrations/eventsair/webhook', methods=['POST'])
def eventsair_webhook():
    """Receive EventsAir webhooks (registration created/updated, etc.).

    Phase 0: acknowledge + log. Phase 1 will upsert into event_attendees
    so the SMS/order flow can recognize attendees by phone. Shared-secret
    gated.
    """
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        try:
            db.rollback()
        except Exception:
            pass
        ok, reason = _eventsair_secret_ok(db)
        if not ok:
            return jsonify({'success': False, 'error': reason}), 403
        payload = request.get_json(silent=True) or {}
        logger.info("EventsAir webhook: %s", str(payload)[:300])
        # TODO Phase 1: upsert event_attendees from the registration event.
        return ('', 204)
    except Exception as e:
        logger.warning(f"eventsair_webhook failed: {e}")
        return ('', 204)



@bp.route('/integrations/eventsair/config', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def get_eventsair_config():
    """Return EventsAir config with secrets redacted to *_set booleans."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import load_config, public_config
        return jsonify({'success': True, 'config': public_config(load_config(db))})
    except Exception as e:
        logger.error(f"get_eventsair_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/integrations/eventsair/config', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def put_eventsair_config():
    """Upsert EventsAir config. Blank secret fields are preserved (not
    wiped). Body: {enabled, client_id, client_secret, event_id,
    webhook_secret, vip_categories: [...]}"""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import save_config, public_config
        body = request.get_json() or {}
        cfg = save_config(db, body)
        return jsonify({'success': True, 'config': public_config(cfg)})
    except Exception as e:
        logger.error(f"put_eventsair_config error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500



@bp.route('/integrations/eventsair/status', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def eventsair_status():
    """Health: configured? token reachable? Used by the Organiser
    Connect-EventsAir panel and /api/health/full.

    ?probe=1 does a REAL token fetch (round-trips Microsoft Entra) so the
    'Test connection' button can report token_ok. Off by default: a plain
    status check must never block on a third party (a hung /status took prod
    down for 19 min on 2026-08-20), so the round trip is opt-in only."""
    try:
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        from services.eventsair import get_client, is_enabled
        client = get_client(db)
        probe = str(request.args.get('probe', '')).lower() in ('1', 'true', 'yes')
        return jsonify({'success': True, 'enabled': is_enabled(db),
                        'health': client.health(probe=probe)})
    except Exception as e:
        logger.error(f"eventsair_status error: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
