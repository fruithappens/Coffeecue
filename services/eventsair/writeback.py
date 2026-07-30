"""EventsAir Phase 2 — order write-back to attendee custom fields.

Research: "CoffeeCue can create a 'Coffee Preference' / 'CoffeeCue Orders'
custom field per event, write each order back onto the attendee's record;
organisers then see coffee data inside EventsAir."

Off by default (`writeback_enabled` in ea_config). Fire-and-forget: a
failed write-back logs a breadcrumb and never touches order flow.

⚠ TODO_EA: both mutations follow the documented naming
(createEventScopedCustomFieldDefinition; values set through the normal
contact update mutation with upsert semantics) but the exact arg shapes
need the schema-inspection report from first sandbox access. Expected to
need tweaks, not a rebuild.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

FIELD_NAME = 'CoffeeCue Orders'


def ensure_custom_field(client, ea_event_id, existing_field_id=None):
    """Create (once) the event-scoped text custom field. Returns
    (field_id or None, detail)."""
    if existing_field_id:
        return existing_field_id, 'already created'
    mutation = """
    mutation CreateField($input: CreateEventScopedCustomFieldDefinitionInput!) {
      createEventScopedCustomFieldDefinition(input: $input) { id name }
    }"""
    ok, data = client.graphql(mutation, {'input': {
        'eventId': ea_event_id,
        'name': FIELD_NAME,
        'type': 'TEXT',
        'containsPersonalData': False,
    }})
    if not ok:
        return None, f'field create failed: {data}'
    field = (data or {}).get('createEventScopedCustomFieldDefinition') or {}
    return field.get('id'), 'created'


def write_order_summary(client, contact_id, field_id, summary_line,
                        previous_value=''):
    """Append one order line to the attendee's custom field (upsert via
    the contact update mutation). Returns (ok, detail)."""
    value = (previous_value + '\n' if previous_value else '') + summary_line
    # Keep the field readable in the EA console — last 10 lines.
    value = '\n'.join(value.splitlines()[-10:])
    mutation = """
    mutation UpdateContactField($input: UpdateContactInput!) {
      updateContact(input: $input) { id }
    }"""
    ok, data = client.graphql(mutation, {'input': {
        'id': contact_id,
        'customFields': [{'definitionId': field_id, 'value': value}],
    }})
    return ok, (str(data)[:200] if not ok else 'written')


def order_summary_line(order_details, order_number):
    od = order_details or {}
    bits = [od.get('size'), od.get('type')]
    extras = [b for b in (od.get('milk'), od.get('sugar')) if b]
    line = ' '.join(str(b).strip() for b in bits if b)
    if extras:
        line += ' (' + ', '.join(str(e) for e in extras) + ')'
    return f"{datetime.now().strftime('%Y-%m-%d %H:%M')} {line} #{order_number}"


def writeback_order(conn, config, cfg_row, order_number):
    """Full write-back for one completed order. Own connection, never
    raises, breadcrumbs on failure. Called from a daemon thread."""
    try:
        cur = conn.cursor()
        cur.execute("SELECT order_details FROM orders WHERE order_number = %s",
                    (str(order_number),))
        row = cur.fetchone()
        if not row:
            return
        od_raw = row[0] if not isinstance(row, dict) else row.get('order_details')
        od = json.loads(od_raw) if isinstance(od_raw, str) else (od_raw or {})
        contact_id = od.get('ea_contact_id')
        if not contact_id:
            return  # not an EA-linked order — nothing to write

        from .survey_client import EASurveyClient
        client = EASurveyClient(config)
        if client.is_stub():
            return

        field_id = cfg_row.get('custom_field_id')
        if not field_id:
            field_id, detail = ensure_custom_field(
                client, cfg_row.get('ea_event_id') or client.event_id)
            if not field_id:
                logger.warning(f"EA writeback: {detail}")
                return
            cur.execute("UPDATE ea_config SET custom_field_id = %s WHERE id = %s",
                        (field_id, cfg_row.get('id')))
            conn.commit()

        ok, detail = write_order_summary(
            client, contact_id, field_id,
            order_summary_line(od, order_number))
        if ok:
            logger.info(f"EA writeback: order #{order_number} → contact {contact_id}")
        else:
            logger.warning(f"EA writeback failed for #{order_number}: {detail}")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"EA writeback crashed (non-fatal): {e}")
        try:
            conn.rollback()
        except Exception:
            pass
