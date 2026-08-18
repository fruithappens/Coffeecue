"""EventsAir Survey Order Channel (BETA) — /api/ea/*

Attendees order coffee by submitting a "Coffee Order" survey in the
EventsAir event app. EA fires a THIN webhook (IDs + correlationId only);
we verify, dedupe, 200 fast, then a background worker fetches the full
response via GraphQL, maps answers to order fields, and injects the
order into the normal pipeline (source "ea_app"). Confirmation and
"ready" SMS ride the existing rail.

Feature flag: EA_SURVEY_CHANNEL_ENABLED (env, default false). When off,
every route (except GET /status, which reports the flag) returns 503 and
NOTHING here can touch an order — zero impact on SMS ordering.

Design notes:
  - Webhook route does no heavy work: verify signature on the RAW body,
    check the correlationId, insert a log stub, spawn a worker thread,
    return 200 — well inside EA's 15s budget even under backlog.
  - Worker threads use their own pooled DB connection (utils.database),
    never the request's.
  - A lazy sweep (on /status and on each webhook) reprocesses 'received'
    rows older than 2 minutes, so a died thread can't lose an order —
    same no-cron pattern as scheduled-order promotion and print-job
    sweeps.
  - Idempotency is double-walled: correlation_id UNIQUE in the log, and
    ea_response_id UNIQUE (partial index) on orders.
"""
from __future__ import annotations

import json
import re as _re
import logging
import os
import threading
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request

from auth import jwt_required_with_demo, role_required_with_demo
from services.eventsair import load_config, save_config
from services.eventsair.survey import (SignatureError, map_answers,
                                       normalize_phone_e164,
                                       verify_webhook_signature)
from services.eventsair.survey_client import EASurveyClient

logger = logging.getLogger(__name__)

bp = Blueprint('ea', __name__, url_prefix='/api/ea')

TIMESTAMP_TOLERANCE_S = int(os.environ.get('EA_WEBHOOK_TIMESTAMP_TOLERANCE_S', '300'))
FETCH_RETRIES = int(os.environ.get('EA_FETCH_RETRIES', '3'))
SWEEP_STALE_S = 120


def channel_enabled():
    return os.environ.get('EA_SURVEY_CHANNEL_ENABLED', 'false').lower() == 'true'


def _db():
    return current_app.config.get('coffee_system').db


def _ensure_tables(db):
    try:
        cur = db.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ea_config (
                id SERIAL PRIMARY KEY,
                event_id INTEGER,
                ea_event_id VARCHAR(64),
                ea_survey_ids TEXT DEFAULT '[]',
                question_map TEXT DEFAULT '{}',
                webhook_subscription_id VARCHAR(64),
                signing_secret TEXT,
                signature_mode VARCHAR(10) DEFAULT 'svix',
                enabled BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ea_attendees (
                ea_contact_id VARCHAR(64) PRIMARY KEY,
                event_id INTEGER,
                first_name VARCHAR(100),
                last_name VARCHAR(100),
                mobile_e164 VARCHAR(20),
                email VARCHAR(200),
                synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ea_attendees_mobile "
                    "ON ea_attendees(mobile_e164)")
        # A coffee preference held on the ATTENDEE record ("oat latte, 1
        # sugar, medium") turns ordering from a conversation into a
        # confirmation. Stored as the raw text plus the whole custom-field
        # blob, so a field renamed in EA can be re-mapped from mirrored
        # data instead of forcing a full re-sync.
        cur.execute("ALTER TABLE ea_attendees ADD COLUMN IF NOT EXISTS "
                    "coffee_pref TEXT")
        cur.execute("ALTER TABLE ea_attendees ADD COLUMN IF NOT EXISTS "
                    "custom_fields TEXT")
        # The number NOT chosen, plus which EA field the chosen one came
        # from. Keeps the decision visible, and gives a fallback when a
        # freshly-bought local SIM turns out to be wrong.
        cur.execute("ALTER TABLE ea_attendees ADD COLUMN IF NOT EXISTS "
                    "mobile_alt_e164 VARCHAR(20)")
        cur.execute("ALTER TABLE ea_attendees ADD COLUMN IF NOT EXISTS "
                    "mobile_source VARCHAR(20)")
        # EventsAir's SHORT human id — the "ID 56" printed on the contact
        # record and the name badge. The GraphQL `id` is a long opaque
        # value nobody can read out or type. Steve's walk-up case: a guest
        # says "fifty-six" at the cart, or taps four digits, and we know
        # who they are without scanning anything. Indexed because that
        # lookup happens with someone standing in front of you.
        cur.execute("ALTER TABLE ea_attendees ADD COLUMN IF NOT EXISTS "
                    "internal_number INTEGER")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_ea_attendees_internal "
                    "ON ea_attendees(internal_number)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS ea_webhook_log (
                correlation_id VARCHAR(100) PRIMARY KEY,
                event_type VARCHAR(100),
                raw_payload TEXT,
                status VARCHAR(20) DEFAULT 'received',
                error TEXT,
                received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP
            )
        """)
        cur.execute("ALTER TABLE ea_config ADD COLUMN IF NOT EXISTS "
                    "custom_field_id VARCHAR(64)")
        # Which custom field holds the coffee preference, when a client
        # names it something the built-in hints miss.
        cur.execute("ALTER TABLE ea_config ADD COLUMN IF NOT EXISTS "
                    "coffee_field_hint VARCHAR(100)")
        cur.execute("ALTER TABLE ea_config ADD COLUMN IF NOT EXISTS "
                    "writeback_enabled BOOLEAN DEFAULT FALSE")
        cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS source VARCHAR(20)")
        cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS ea_response_id VARCHAR(64)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_ea_response "
                    "ON orders(ea_response_id) WHERE ea_response_id IS NOT NULL")
        db.commit()
    except Exception as e:
        logger.error(f"ea _ensure_tables: {e}")
        try:
            db.rollback()
        except Exception:
            pass


def _ea_row(db):
    """The single ea_config row (created empty on first touch)."""
    cur = db.cursor()
    cur.execute("SELECT * FROM ea_config ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if row is None:
        cur.execute("INSERT INTO ea_config (enabled) VALUES (FALSE)")
        db.commit()
        cur.execute("SELECT * FROM ea_config ORDER BY id LIMIT 1")
        row = cur.fetchone()
    if isinstance(row, dict):
        return dict(row)
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))


def _client(db):
    return EASurveyClient(load_config(db))


# ---------------------------------------------------------------------------
# webhook  (CSRF: this app uses JWT-auth APIs, no Flask-WTF CSRF middleware
# is installed, so nothing to exempt — noted per spec §1.4)
# ---------------------------------------------------------------------------

@bp.route('/webhook', methods=['POST'])
def ea_webhook():
    if not channel_enabled():
        return jsonify({'success': False, 'message': 'EA survey channel disabled'}), 503
    db = _db()
    _ensure_tables(db)

    # 1. RAW body first — the signature is computed over these bytes.
    raw = request.get_data(cache=True)
    headers = {k.lower(): v for k, v in request.headers.items()}
    cfg_row = _ea_row(db)
    try:
        verify_webhook_signature(
            (cfg_row.get('signing_secret') or '').strip(),
            headers, raw,
            tolerance_s=TIMESTAMP_TOLERANCE_S,
            mode=(cfg_row.get('signature_mode') or 'svix'),
        )
    except SignatureError as e:
        logger.warning(f"EA webhook rejected: {e}")
        return jsonify({'success': False, 'message': str(e)}), 401

    # 2. Parse the (now-trusted) thin payload.
    try:
        payload = json.loads(raw.decode('utf-8') or '{}')
    except Exception:
        return jsonify({'success': False, 'message': 'unparseable JSON'}), 400
    correlation_id = str(payload.get('correlationId')
                         or payload.get('correlation_id') or '').strip()
    event_type = str(payload.get('eventType') or payload.get('event_type')
                     or payload.get('type') or '').strip()
    if not correlation_id:
        # Signed but malformed — log and 200 so EA doesn't retry-storm.
        logger.warning("EA webhook without correlationId: %s", str(payload)[:200])
        return jsonify({'success': True, 'status': 'ignored'})

    # 3. Dedupe on correlationId.
    cur = db.cursor()
    try:
        cur.execute(
            "INSERT INTO ea_webhook_log (correlation_id, event_type, raw_payload, status) "
            "VALUES (%s, %s, %s, 'received') ON CONFLICT (correlation_id) DO NOTHING",
            (correlation_id, event_type[:100], raw.decode('utf-8')[:10000]))
        inserted = cur.rowcount
        db.commit()
    except Exception as e:
        logger.error(f"EA webhook log insert: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return jsonify({'success': False, 'message': 'log write failed'}), 500
    if not inserted:
        return jsonify({'success': True, 'status': 'duplicate'})

    # 4. Hand off to a worker thread and return inside the 15s budget.
    app_obj = current_app._get_current_object()
    threading.Thread(target=_process_in_thread,
                     args=(app_obj, correlation_id), daemon=True).start()
    _sweep_stale(app_obj)
    return jsonify({'success': True, 'status': 'received'})


def _sweep_stale(app_obj):
    """Reprocess 'received' rows older than SWEEP_STALE_S (thread died,
    dyno restarted mid-fetch, …). Lazy, no cron."""
    def run():
        from utils.database import get_db_connection, close_connection
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute(
                "SELECT correlation_id FROM ea_webhook_log WHERE status = 'received' "
                "AND received_at < %s LIMIT 10",
                (datetime.now() - timedelta(seconds=SWEEP_STALE_S),))
            ids = [r[0] if not isinstance(r, dict) else r['correlation_id']
                   for r in cur.fetchall()]
        except Exception as e:
            logger.warning(f"EA sweep query: {e}")
            ids = []
        finally:
            if conn is not None:
                close_connection(conn)
        for cid in ids:
            _process_in_thread(app_obj, cid)
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------------------
# worker
# ---------------------------------------------------------------------------

def _process_in_thread(app_obj, correlation_id, fixture=None):
    """Full processing for one webhook log row. Own DB connection; every
    outcome lands in ea_webhook_log.status. `fixture` (test-order path)
    substitutes for the GraphQL fetch."""
    from utils.database import get_db_connection, close_connection
    conn = None
    try:
        conn = get_db_connection()
        with app_obj.app_context():
            _process_one(app_obj, conn, correlation_id, fixture=fixture)
    except Exception as e:
        logger.exception(f"EA worker crash for {correlation_id}: {e}")
        try:
            if conn is not None:
                conn.rollback()
                cur = conn.cursor()
                cur.execute(
                    "UPDATE ea_webhook_log SET status='failed', error=%s, "
                    "processed_at=CURRENT_TIMESTAMP WHERE correlation_id=%s "
                    "AND status IN ('received','processing')",
                    (str(e)[:500], correlation_id))
                conn.commit()
        except Exception:
            pass
    finally:
        if conn is not None:
            close_connection(conn)


def _mark(conn, correlation_id, status, error=None):
    cur = conn.cursor()
    cur.execute(
        "UPDATE ea_webhook_log SET status=%s, error=%s, "
        "processed_at=CURRENT_TIMESTAMP WHERE correlation_id=%s",
        (status, (error or '')[:500] or None, correlation_id))
    conn.commit()


def _system_event(conn, message):
    """Failure breadcrumbs for the Support error feed (best effort)."""
    try:
        from services.logging_utils import event as _event
        _event('EA_INTEGRATION', detail=message[:300], component='ea-integration')
    except Exception:
        logger.warning("EA system_event fallback: %s", message[:200])


def _process_one(app_obj, conn, correlation_id, fixture=None, qmap_override=None):
    cur = conn.cursor()
    cur.execute("SELECT raw_payload, event_type, status FROM ea_webhook_log "
                "WHERE correlation_id = %s", (correlation_id,))
    row = cur.fetchone()
    if not row:
        return
    raw_payload, event_type, status = (
        (row.get('raw_payload'), row.get('event_type'), row.get('status'))
        if isinstance(row, dict) else row)
    if status not in ('received',):
        return  # already handled (idempotent re-entry)
    # Claim the row so the sweep and a racing thread don't double-run.
    cur.execute("UPDATE ea_webhook_log SET status='processing' "
                "WHERE correlation_id=%s AND status='received'", (correlation_id,))
    conn.commit()
    if cur.rowcount == 0:
        return

    payload = json.loads(raw_payload or '{}')
    cfg_row = _row_from_conn(conn)
    survey_ids = _survey_ids(cfg_row)
    etype = (event_type or '').lower()

    # Contact events → mirror touch, done.
    if 'contact' in etype and 'survey' not in etype:
        contact_id = str(payload.get('contactId') or payload.get('entityId') or '')
        if contact_id and not fixture:
            db_cfg = load_config_from_conn(conn)
            client = EASurveyClient(db_cfg)
            ok, data = client.fetch_contact(contact_id)
            if ok:
                _upsert_attendee(conn, (data.get('contact') or {}))
        _mark(conn, correlation_id, 'processed')
        return

    # Survey response events (or unknown types carrying a responseId).
    response_id = str(payload.get('surveyResponseId') or payload.get('responseId')
                      or payload.get('entityId') or '').strip()
    if not response_id:
        _mark(conn, correlation_id, 'ignored', f'no response id in {etype or "untyped"}')
        return

    # -- fetch (retry ×3, backoff; EA read-after-write lag per §10.3) --
    if fixture is not None:
        resp = fixture
    else:
        import time as _t
        client = EASurveyClient(load_config_from_conn(conn))
        resp, err = None, 'not attempted'
        for attempt in range(FETCH_RETRIES):
            if attempt:
                _t.sleep(2 ** attempt)  # 2s, 4s
            ok, data = client.fetch_survey_response(response_id)
            if ok and (data.get('surveyResponse') or {}).get('id'):
                resp = data['surveyResponse']
                break
            err = str(data)
        if resp is None:
            _mark(conn, correlation_id, 'failed', f'fetch failed: {err}')
            _system_event(conn, f'EA survey fetch failed for {response_id}: {err}')
            return

    # -- survey scoping --
    resp_survey_id = str(((resp.get('survey') or {}).get('id')) or '')
    if survey_ids and resp_survey_id and resp_survey_id not in survey_ids:
        _mark(conn, correlation_id, 'ignored',
              f'survey {resp_survey_id} not a coffee-order survey')
        return

    # -- idempotency wall 2: one response, one order, ever --
    cur.execute("SELECT order_number FROM orders WHERE ea_response_id = %s",
                (response_id,))
    dup = cur.fetchone()
    if dup:
        _mark(conn, correlation_id, 'duplicate',
              f'order already exists for response {response_id}')
        return

    # -- resolve contact: inline → mirror → direct query (§4.3.2) --
    contact = resp.get('contact') or {}
    contact_id = str(contact.get('id') or resp.get('contactId') or '')
    if not contact.get('mobile') and contact_id:
        cur.execute("SELECT first_name, last_name, mobile_e164, email "
                    "FROM ea_attendees WHERE ea_contact_id = %s", (contact_id,))
        mrow = cur.fetchone()
        if mrow:
            fn, ln, mob, em = (
                (mrow.get('first_name'), mrow.get('last_name'),
                 mrow.get('mobile_e164'), mrow.get('email'))
                if isinstance(mrow, dict) else mrow)
            contact = {'id': contact_id,
                       'firstName': contact.get('firstName') or fn,
                       'lastName': contact.get('lastName') or ln,
                       'mobile': mob, 'email': contact.get('email') or em}
        elif fixture is None:
            client = EASurveyClient(load_config_from_conn(conn))
            ok, data = client.fetch_contact(contact_id)
            if ok and data.get('contact'):
                contact = data['contact']

    name = f"{contact.get('firstName', '')} {contact.get('lastName', '')}".strip() \
        or 'EA Attendee'
    mobile = normalize_phone_e164(contact.get('mobile') or '')

    # -- map answers (§5) --
    answers = {}
    for qr in (resp.get('questionResponses') or []):
        qid = str(((qr.get('question') or {}).get('id')) or qr.get('questionId') or '')
        val = qr.get('value')
        if not val:
            opts = qr.get('selectedOptions') or []
            if opts:
                val = opts[0].get('value') or opts[0].get('text')
        if qid:
            answers[qid] = val
    qmap = qmap_override if qmap_override is not None else _question_map(cfg_row)
    fields, errors = map_answers(qmap, answers)
    if errors:
        _mark(conn, correlation_id, 'failed', '; '.join(errors))
        _system_event(conn, f'EA answer mapping failed for {response_id}: '
                            + '; '.join(errors))
        return

    # -- create the order through the REAL pipeline (§4.3.4) --
    body = {
        'customer_name': name,
        'coffee_type': fields['coffee_type'],
        # SMS-defaults rule: unspecified milk → standard dairy, and the
        # confirmation SMS recaps it (visible, not silent).
        'milk_type': fields.get('milk_type') or 'full cream',
        'size': 'medium',
        'sugar': fields.get('sugar') or 'no sugar',
        'notes': fields.get('notes') or 'Ordered via EventsAir app',
        'phone': mobile,
        'source': 'ea_app',
    }
    from flask_jwt_extended import create_access_token
    service_token = create_access_token(
        identity='ea-survey-channel',
        additional_claims={'role': 'staff', 'source': 'ea_app'})
    tc = app_obj.test_client()
    api_resp = tc.post('/api/orders', json=body,
                       headers={'Authorization': f'Bearer {service_token}'})
    created = api_resp.get_json(silent=True) or {}
    order_number = ((created.get('data') or {}).get('order_number')
                    or created.get('order_number'))
    if api_resp.status_code != 200 or not order_number:
        msg = created.get('message') or f'order create HTTP {api_resp.status_code}'
        _mark(conn, correlation_id, 'failed', msg)
        _system_event(conn, f'EA order create failed for {response_id}: {msg}')
        return

    # Stamp source + response id (idempotency wall) + needs_contact flag.
    extra = {'source': 'ea_app', 'ea_response_id': response_id,
             'ea_contact_id': contact_id}
    if not mobile:
        extra['needs_contact'] = True
    try:
        cur.execute(
            "UPDATE orders SET source='ea_app', ea_response_id=%s, "
            "order_details = order_details || %s::jsonb WHERE order_number=%s",
            (response_id, json.dumps(extra), str(order_number)))
        conn.commit()
    except Exception as e:
        conn.rollback()
        # UNIQUE violation here = a racing duplicate created milliseconds
        # apart; cancel this one so exactly one survives.
        logger.warning(f"EA response stamp failed ({e}); cancelling duplicate")
        tc.post(f'/api/orders/{order_number}/cancel',
                headers={'Authorization': f'Bearer {service_token}'})
        _mark(conn, correlation_id, 'duplicate', 'raced another worker; cancelled')
        return

    # -- confirmation SMS on the existing rail (§4.3.5) --
    if mobile:
        try:
            messaging = app_obj.config.get('messaging_service')
            if messaging:
                first = name.split()[0] if name else 'there'
                sid = _station_for_order(conn, order_number)
                messaging.send_message(
                    mobile,
                    f"Thanks {first}! Your {body['coffee_type'].title()} order "
                    f"#{order_number} is in the queue"
                    + (f" for Station {sid}" if sid else "")
                    + " - we'll text you when it's ready.")
        except Exception as e:
            logger.warning(f"EA confirmation SMS failed (non-fatal): {e}")
    else:
        logger.warning(f"EA order #{order_number}: contact {contact_id} has no "
                       "mobile — flagged needs_contact, no SMS possible")

    _mark(conn, correlation_id, 'processed')
    logger.info(f"EA survey response {response_id} → order #{order_number}")


def _station_for_order(conn, order_number):
    try:
        cur = conn.cursor()
        cur.execute("SELECT station_id FROM orders WHERE order_number=%s",
                    (str(order_number),))
        r = cur.fetchone()
        return (r[0] if not isinstance(r, dict) else r.get('station_id')) if r else None
    except Exception:
        return None


# --- config helpers usable from worker connections -------------------------

def _row_from_conn(conn):
    cur = conn.cursor()
    cur.execute("SELECT * FROM ea_config ORDER BY id LIMIT 1")
    row = cur.fetchone()
    if row is None:
        return {}
    if isinstance(row, dict):
        return dict(row)
    return dict(zip([d[0] for d in cur.description], row))


def load_config_from_conn(conn):
    """services.eventsair.load_config needs a db handle; worker threads
    have their own connection."""
    try:
        return load_config(conn)
    except Exception:
        return {}


def _survey_ids(cfg_row):
    try:
        ids = json.loads(cfg_row.get('ea_survey_ids') or '[]')
        return [str(i) for i in ids if i]
    except Exception:
        return []


def _question_map(cfg_row):
    try:
        return json.loads(cfg_row.get('question_map') or '{}')
    except Exception:
        return {}


# Custom-field names an organiser might plausibly use for the same thing.
# Matched case-insensitively on a substring so "Coffee Preference",
# "coffee order" and "Barista Notes" all land. Configurable via the
# ea_config row when a client uses something unexpected.
_COFFEE_FIELD_HINTS = ('coffee', 'barista', 'beverage', 'drink')

# EventsAir has TWO unrelated places a preference can live, and the UI
# calls both "fields":
#   - customFieldsPaged  — named fields, so we can match on the name
#   - userDefinedField1..4 — four flat String slots on Contact. The label
#     an organiser types ("Coffee Type") is EVENT configuration and does
#     NOT come back with the contact, so there is no name to match on.
# Steve set his up as User-Defined Field 1, which the name-matching path
# would never have found — the sync would have returned everyone with no
# preference and looked like the data was missing.
#
# So for the UDF slots we identify by CONTENT: whichever slot mentions a
# drink we serve is the coffee one. Self-configuring, and it does not care
# which of the four an organiser picked.
_UDF_SLOTS = ('userDefinedField1', 'userDefinedField2',
              'userDefinedField3', 'userDefinedField4')
_DRINK_WORDS = _re.compile(
    r'latte|flat\s*white|cappu?ccino|long\s*black|short\s*black|espresso|'
    r'macchiato|mocha|piccolo|cortado|americano|hot\s*choc|chai|matcha|tea',
    _re.IGNORECASE)


def _extract_coffee_pref(contact, hint=None):
    """Pull the coffee-preference custom field out of a contact, if present.

    Returns (preference_text, all_fields_dict). The text is deliberately
    left RAW: the SMS parser already turns "oat latte 1 sugar medium" into
    a structured order, so re-implementing that here would be a second
    copy of the same logic, free to drift from the first.
    """
    fields = {}
    try:
        items = ((contact.get('customFieldsPaged') or {}).get('items')) or []
        for f in items:
            name = str(f.get('name') or '').strip()
            if name:
                fields[name] = f.get('value')
    except Exception:
        fields = {}
    # The four flat slots are recorded too, so an operator can SEE what is
    # in them even when none looks like a drink.
    for slot in _UDF_SLOTS:
        val = contact.get(slot)
        if val not in (None, ''):
            fields[slot] = val

    def _text(v):
        return (v if isinstance(v, str) else json.dumps(v) or '').strip()

    # 1. An explicit override wins — a field name OR a slot like
    #    'userDefinedField2', for clients who name things unexpectedly.
    if hint:
        for name, value in fields.items():
            if hint.lower() in name.lower():
                t = _text(value)
                if t:
                    return t, fields

    # 2. A NAMED custom field whose name mentions coffee.
    for h in _COFFEE_FIELD_HINTS:
        for name, value in fields.items():
            if name in _UDF_SLOTS:
                continue
            if h in name.lower():
                t = _text(value)
                if t:
                    return t, fields

    # 3. A user-defined slot whose CONTENT mentions a drink we serve.
    for slot in _UDF_SLOTS:
        t = _text(fields.get(slot))
        if t and _DRINK_WORDS.search(t):
            return t, fields
    return None, fields


def _as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _contact_mobile(contact, prefer_local=True):
    """Pick which number to text, and return the other as a fallback.

    EventsAir keeps two: `mobile` (the number they registered with) and
    `inCountryMobile` — EA labels it "Local Mobile Number". They are not
    interchangeable. An overseas delegate registers with their home
    number, flies to Australia, buys a local SIM, and puts it in the local
    field. Texting the home number then reaches a handset in a drawer in
    another country, or costs them international SMS to receive a message
    about a coffee thirty metres away.

    So the LOCAL number wins when present. That is the phone in their
    pocket at the event, which is the only one that matters for "your
    coffee is ready". The other is kept as a fallback rather than
    discarded — if the local SIM is wrong or dead, the registered number
    is the next best thing.

    Returns (chosen, alternate, source).
    """
    ph = contact.get('contactPhoneNumbers') or {}
    local = (ph.get('inCountryMobile') or '').strip()
    home = (ph.get('mobile') or '').strip()
    if prefer_local and local:
        return local, (home or None), 'inCountryMobile'
    if home:
        return home, (local or None), 'mobile'
    return local, None, ('inCountryMobile' if local else None)


def _upsert_attendee(conn, contact, coffee_hint=None):
    if not contact.get('id'):
        return
    pref, fields = _extract_coffee_pref(contact, coffee_hint)
    chosen, alternate, source = _contact_mobile(contact)
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO ea_attendees (ea_contact_id, internal_number,
                                  first_name, last_name,
                                  mobile_e164, mobile_alt_e164, mobile_source,
                                  email, coffee_pref, custom_fields, synced_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (ea_contact_id) DO UPDATE SET
          internal_number=EXCLUDED.internal_number,
          first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
          mobile_e164=EXCLUDED.mobile_e164,
          mobile_alt_e164=EXCLUDED.mobile_alt_e164,
          mobile_source=EXCLUDED.mobile_source,
          email=EXCLUDED.email,
          coffee_pref=EXCLUDED.coffee_pref,
          custom_fields=EXCLUDED.custom_fields,
          synced_at=CURRENT_TIMESTAMP
    """, (str(contact['id']), _as_int(contact.get('internalNumber')),
          contact.get('firstName'), contact.get('lastName'),
          normalize_phone_e164(chosen) or None,
          normalize_phone_e164(alternate or '') or None, source,
          contact.get('primaryEmail'), pref,
          json.dumps(fields) if fields else None))
    conn.commit()


# ---------------------------------------------------------------------------
# ops API (§4.4)
# ---------------------------------------------------------------------------

@bp.route('/status', methods=['GET'])
@jwt_required_with_demo()
def ea_status():
    db = _db()
    _ensure_tables(db)
    row = _ea_row(db)
    client = _client(db)
    cur = db.cursor()
    counts = {}
    try:
        cur.execute(
            "SELECT status, COUNT(*) FROM ea_webhook_log "
            "WHERE received_at::date = CURRENT_DATE GROUP BY status")
        for r in cur.fetchall():
            k, v = (r.get('status'), r.get('count')) if isinstance(r, dict) else r
            counts[k] = v
        cur.execute("SELECT MAX(received_at) FROM ea_webhook_log")
        r = cur.fetchone()
        last_webhook = (r[0] if not isinstance(r, dict) else list(r.values())[0])
        cur.execute("SELECT COUNT(*), MAX(synced_at) FROM ea_attendees")
        r = cur.fetchone()
        mirror_count, mirror_synced = ((r[0], r[1]) if not isinstance(r, dict)
                                       else tuple(r.values()))
    except Exception as e:
        db.rollback()
        last_webhook = mirror_count = mirror_synced = None
        logger.warning(f"ea_status counts: {e}")
    if channel_enabled():
        _sweep_stale(current_app._get_current_object())
    return jsonify({'success': True,
                    'channel_enabled': channel_enabled(),
                    'ea': client.health(),
                    'subscription_id': row.get('webhook_subscription_id'),
                    'signing_secret_set': bool(row.get('signing_secret')),
                    'survey_ids': _survey_ids(row),
                    'question_map_set': bool(_question_map(row)),
                    'writeback_enabled': bool(row.get('writeback_enabled')),
                    'custom_field_created': bool(row.get('custom_field_id')),
                    'last_webhook_at': str(last_webhook) if last_webhook else None,
                    'mirror_count': mirror_count,
                    'mirror_synced_at': str(mirror_synced) if mirror_synced else None,
                    'today': counts})


@bp.route('/config', methods=['PUT'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def ea_put_config():
    """Admin-edit the survey-channel row (survey ids, question map,
    signing secret, signature mode). Secrets never echoed back."""
    db = _db()
    _ensure_tables(db)
    body = request.get_json(silent=True) or {}
    sets, params = [], []
    if 'ea_event_id' in body:
        sets.append("ea_event_id=%s")
        params.append(str(body['ea_event_id'] or ''))
    if 'ea_survey_ids' in body:
        ids = body['ea_survey_ids']
        if not isinstance(ids, list):
            return jsonify({'success': False,
                            'message': 'ea_survey_ids must be a list'}), 400
        sets.append("ea_survey_ids=%s")
        params.append(json.dumps([str(i) for i in ids]))
    if 'question_map' in body:
        if not isinstance(body['question_map'], dict):
            return jsonify({'success': False,
                            'message': 'question_map must be an object'}), 400
        sets.append("question_map=%s")
        params.append(json.dumps(body['question_map']))
    if (body.get('signing_secret') or '').strip():
        sets.append("signing_secret=%s")
        params.append(body['signing_secret'].strip())
    if body.get('signature_mode') in ('svix', 'raw'):
        sets.append("signature_mode=%s")
        params.append(body['signature_mode'])
    if 'writeback_enabled' in body:
        sets.append("writeback_enabled=%s")
        params.append(bool(body['writeback_enabled']))
    if 'webhook_subscription_id' in body:
        sets.append("webhook_subscription_id=%s")
        params.append(str(body['webhook_subscription_id'] or ''))
    if 'enabled' in body:
        sets.append("enabled=%s")
        params.append(bool(body['enabled']))
    if not sets:
        return jsonify({'success': False, 'message': 'nothing to update'}), 400
    row = _ea_row(db)
    cur = db.cursor()
    params.append(row['id'])
    cur.execute(f"UPDATE ea_config SET {', '.join(sets)}, "
                f"updated_at=CURRENT_TIMESTAMP WHERE id=%s", params)
    db.commit()
    return jsonify({'success': True})


@bp.route('/webhook-log', methods=['GET'])
@jwt_required_with_demo()
def ea_webhook_log():
    db = _db()
    _ensure_tables(db)
    cur = db.cursor()
    cur.execute(
        "SELECT correlation_id, event_type, status, error, received_at, "
        "processed_at FROM ea_webhook_log ORDER BY received_at DESC LIMIT 10")
    cols = [d[0] for d in cur.description]
    rows = []
    for r in cur.fetchall():
        d = dict(zip(cols, r)) if not isinstance(r, dict) else dict(r)
        for k in ('received_at', 'processed_at'):
            if d.get(k) is not None:
                d[k] = str(d[k])
        rows.append(d)
    return jsonify({'success': True, 'rows': rows})


@bp.route('/sync-attendees', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def ea_sync_attendees():
    """Manual full mirror refresh (paged). Honest in stub mode."""
    if not channel_enabled():
        return jsonify({'success': False, 'message': 'EA survey channel disabled'}), 503
    db = _db()
    _ensure_tables(db)
    row = _ea_row(db)
    client = _client(db)
    if client.is_stub():
        return jsonify({'success': False,
                        'message': 'stub mode — no EA credentials configured'}), 400
    ea_event_id = row.get('ea_event_id') or client.event_id
    if not ea_event_id:
        return jsonify({'success': False, 'message': 'no ea_event_id configured'}), 400
    total, skip = 0, 0
    while True:
        ok, data = client.fetch_contacts_page(ea_event_id, skip=skip, take=200)
        if not ok:
            return jsonify({'success': False,
                            'message': f'contacts fetch failed at skip={skip}: {data}',
                            'synced': total}), 502
        page = (((data.get('event') or {}).get('contactsPaged') or {}).get('items')) or []
        for contact in page:
            _upsert_attendee(db, contact, row.get('coffee_field_hint'))
            total += 1
        if len(page) < 200:
            break
        skip += 200
    # Counts that decide whether preference-led ordering is viable: an
    # attendee with no mobile cannot be texted, and one with no preference
    # still has to be asked.
    cur = db.cursor()
    cur.execute("SELECT COUNT(*) FROM ea_attendees WHERE mobile_e164 IS NOT NULL")
    with_mobile = (cur.fetchone() or [0])[0]
    cur.execute("SELECT COUNT(*) FROM ea_attendees "
                "WHERE coffee_pref IS NOT NULL AND coffee_pref <> ''")
    with_pref = (cur.fetchone() or [0])[0]
    return jsonify({'success': True, 'synced': total,
                    'with_mobile': with_mobile, 'with_coffee_pref': with_pref})


@bp.route('/test-order', methods=['POST'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def ea_test_order():
    """Inject a fake survey response end-to-end (skips signature + GraphQL)
    for rehearsal without EA access. Default has NO phone → needs_contact
    path → zero SMS risk; pass "phone" explicitly to exercise SMS."""
    if not channel_enabled():
        return jsonify({'success': False, 'message': 'EA survey channel disabled'}), 503
    db = _db()
    _ensure_tables(db)
    body = request.get_json(silent=True) or {}
    import uuid
    response_id = f"test-{uuid.uuid4()}"
    correlation_id = f"test-{uuid.uuid4()}"
    row = _ea_row(db)
    qmap = _question_map(row)
    if not qmap:
        # A built-in map so the rehearsal works before ea setup.
        qmap = {'q-drink': {'field': 'drink'}, 'q-milk': {'field': 'milk'},
                'q-sugar': {'field': 'sugar'}, 'q-notes': {'field': 'notes'}}
        qids = {'drink': 'q-drink', 'milk': 'q-milk',
                'sugar': 'q-sugar', 'notes': 'q-notes'}
    else:
        qids = {spec.get('field'): qid for qid, spec in qmap.items()}
    fixture = {
        'id': response_id,
        'survey': {'id': (_survey_ids(row) or ['test-survey'])[0]},
        'contact': {'id': 'test-contact',
                    'firstName': body.get('first_name', 'Test'),
                    'lastName': body.get('last_name', 'Attendee'),
                    'mobile': body.get('phone', '')},
        'questionResponses': [
            {'questionId': qids.get('drink'), 'value': body.get('drink', 'Flat White')},
            {'questionId': qids.get('milk'), 'value': body.get('milk', 'Full cream')},
            {'questionId': qids.get('sugar'), 'value': str(body.get('sugar', '0'))},
            {'questionId': qids.get('notes'), 'value': body.get('notes', 'EA test order')},
        ],
    }
    cur = db.cursor()
    cur.execute(
        "INSERT INTO ea_webhook_log (correlation_id, event_type, raw_payload, status) "
        "VALUES (%s, 'test.survey.response', %s, 'received')",
        (correlation_id, json.dumps({'surveyResponseId': response_id,
                                     'correlationId': correlation_id})))
    db.commit()
    # Synchronous processing so the caller sees the outcome directly.
    from utils.database import get_db_connection, close_connection
    conn = get_db_connection()
    try:
        with current_app._get_current_object().app_context():
            _process_one(current_app._get_current_object(), conn,
                         correlation_id, fixture=fixture, qmap_override=qmap)
    finally:
        close_connection(conn)
    cur.execute("SELECT status, error FROM ea_webhook_log WHERE correlation_id=%s",
                (correlation_id,))
    r = cur.fetchone()
    status, error = ((r.get('status'), r.get('error')) if isinstance(r, dict) else r) \
        if r else (None, None)
    cur.execute("SELECT order_number FROM orders WHERE ea_response_id=%s",
                (response_id,))
    o = cur.fetchone()
    order_number = (o[0] if not isinstance(o, dict) else o.get('order_number')) if o else None
    return jsonify({'success': status == 'processed',
                    'status': status, 'error': error,
                    'order_number': order_number,
                    'response_id': response_id})


@bp.route('/surveys', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin', 'staff'])
def ea_list_surveys():
    """List the surveys on the configured event, with their TYPE.

    EventsAir distinguishes GENERAL, SESSION and ON_AIR_MEETING_HUB_PROFILE
    surveys (SurveyType), and the session editor's "Session Survey" picker
    only offers SESSION ones — so a survey built as GENERAL is invisible
    there and looks like it failed to save. This endpoint answers "what did
    I actually create, and of which type?" from the API rather than by
    hunting through the EA UI.

    Written against the real schema: surveys hang off event(id), there is
    no top-level surveys query. Tries the paged form first and falls back
    to the unpaged one, because the field's arguments are not visible in a
    type-fields introspection.
    """
    db = _db()
    _ensure_tables(db)
    client = _client(db)
    if client.is_stub():
        return jsonify({'success': False,
                        'message': 'No EA credentials configured yet'}), 400
    event_id = getattr(client, 'event_id', None)
    if not event_id:
        return jsonify({'success': False, 'message': 'No EA event id configured'}), 400

    attempts = [
        ("""query CoffeeCueSurveys($eventId: ID!) {
              event(id: $eventId) {
                id name
                surveysPaged(offset: 0, limit: 100) {
                  items { id name type }
                }
              }
            }""", 'surveysPaged'),
        ("""query CoffeeCueSurveys($eventId: ID!) {
              event(id: $eventId) { id name surveysPaged { items { id name type } } }
            }""", 'surveysPaged (no paging args)'),
    ]
    errors = []
    for query, label in attempts:
        ok, data = client.graphql(query, {'eventId': event_id})
        if not ok:
            errors.append(f'{label}: {data}')
            continue
        ev = (data or {}).get('event') or {}
        items = ((ev.get('surveysPaged') or {}).get('items')) or []
        return jsonify({
            'success': True,
            'event': {'id': ev.get('id'), 'name': ev.get('name')},
            'via': label,
            'count': len(items),
            'surveys': items,
            'note': ('A survey only shows in a session\'s "Session Survey" '
                     'picker when its type is SESSION. Question text is NOT '
                     'readable until at least one response exists — Survey '
                     'exposes responses, not a question list.'),
        })
    return jsonify({'success': False, 'message': ' | '.join(errors)}), 502


@bp.route('/introspect', methods=['GET'])
@jwt_required_with_demo()
@role_required_with_demo(['admin'])
def ea_introspect():
    """One-click schema inspection: what does THIS tenant's schema call
    the entities our TODO_EA queries guess at? Run from the Support EA
    tab on first API access; the report drives the query patch-up."""
    db = _db()
    _ensure_tables(db)
    client = _client(db)
    if client.is_stub():
        return jsonify({'success': False,
                        'message': 'No EA credentials configured yet — set '
                                   'client id/secret/tenant endpoint first'}), 400
    # ?types=Event,Contact drills into named types only — one round trip
    # each, seconds not minutes. The full scan is thorough but slow enough
    # (~83s against the live tenant) that the browser aborts it, and it can
    # only see types reachable from keyword-matched root fields.
    wanted = (request.args.get('types') or '').strip()
    from services.eventsair.introspect import run_introspection, describe_types
    if wanted:
        try:
            return jsonify({'success': True,
                            'report': describe_types(client, wanted.split(','))})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e)}), 502
    ok, report = run_introspection(client)
    if not ok:
        return jsonify({'success': False, 'message': report}), 502
    return jsonify({'success': True, 'report': report})


@bp.route('/hello', methods=['GET'])
def ea_hello():
    """Kiosk pre-identification (research Phase 4.8): the EA event app
    links to the kiosk with ?cid={ContactID}; the kiosk asks who that is.

    Public and privacy-tight: returns FIRST NAME + has_phone only, never
    the number or email. The phone is attached server-side at order time.
    """
    if not channel_enabled():
        return jsonify({'success': False, 'message': 'EA survey channel disabled'}), 503
    cid = (request.args.get('cid') or '').strip()
    if not cid:
        return jsonify({'success': False, 'message': 'cid required'}), 400
    db = _db()
    _ensure_tables(db)
    cur = db.cursor()
    # Accept EITHER identifier. The app's merge field supplies EventsAir's
    # long opaque contact id; a person at the counter supplies the SHORT
    # number printed on their badge ("56"). Both name the same attendee and
    # both must work: ?cid= from the app link, and punch-in at the cart for
    # anyone whose phone is flat or who never opened the app.
    cur.execute("SELECT first_name, mobile_e164 FROM ea_attendees "
                "WHERE ea_contact_id = %s", (cid,))
    row = cur.fetchone()
    if not row and cid.isdigit():
        cur.execute("SELECT first_name, mobile_e164 FROM ea_attendees "
                    "WHERE internal_number = %s", (int(cid),))
        row = cur.fetchone()
    if not row:
        return jsonify({'success': False, 'message': 'unknown contact'}), 404
    first, mobile = ((row.get('first_name'), row.get('mobile_e164'))
                     if isinstance(row, dict) else row)
    if not (first or '').strip():
        return jsonify({'success': False, 'message': 'unknown contact'}), 404
    return jsonify({'success': True, 'first_name': first.strip(),
                    'has_phone': bool(mobile)})


def maybe_writeback_order(app_obj, order_number):
    """Hook for order completion/pickup: if the channel + write-back are
    on and the order is EA-linked, push a summary line onto the
    attendee's custom field in a daemon thread. Zero impact otherwise."""
    if not channel_enabled():
        return
    def run():
        from utils.database import get_db_connection, close_connection
        conn = None
        try:
            conn = get_db_connection()
            cfg_row = _row_from_conn(conn)
            if not cfg_row.get('writeback_enabled'):
                return
            from services.eventsair.writeback import writeback_order
            writeback_order(conn, load_config_from_conn(conn), cfg_row,
                            order_number)
        except Exception as e:
            logger.warning(f"EA writeback hook: {e}")
        finally:
            if conn is not None:
                close_connection(conn)
    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------------------
# setup CLI:  flask ea setup-webhooks | flask ea map-survey  (§8.6)
# ---------------------------------------------------------------------------

@bp.cli.command('setup-webhooks')
def cli_setup_webhooks():
    """Discover event types, create the survey-response subscription, and
    store the subscription id + signing secret in ea_config."""
    import click
    from utils.database import get_db_connection, close_connection
    conn = get_db_connection()
    try:
        _ensure_tables_conn(conn)
        client = EASurveyClient(load_config_from_conn(conn))
        if client.is_stub():
            click.echo('STUB mode — configure EA_CLIENT_ID/EA_CLIENT_SECRET/'
                       'EA_TENANT_ENDPOINT first.')
            return
        ok, data = client.list_webhook_event_types()
        if not ok:
            click.echo(f'webhookEventTypes query failed: {data}')
            return
        types = [t.get('name') for t in (data.get('webhookEventTypes') or [])]
        click.echo('Available webhook event types:')
        for t in types:
            click.echo(f'  {t}')
        survey_types = [t for t in types if t and 'survey' in t.lower()]
        if not survey_types:
            click.echo('No survey-looking event type found — record the real '
                       'name in EVENTSAIR_SURVEY_CHANNEL.md and re-run with it.')
            return
        base = os.environ.get('PUBLIC_BASE_URL',
                              'https://web-production-4cc9c.up.railway.app')
        url = f'{base}/api/ea/webhook'
        click.echo(f'Creating subscription → {url} for {survey_types}')
        row = _row_from_conn(conn)
        ok, data = client.create_webhook_subscription(
            url, 'CoffeeCue survey order channel', survey_types,
            ea_event_id=row.get('ea_event_id'))
        if not ok:
            click.echo(f'createWebhookSubscription failed: {data}')
            return
        sub = data.get('createWebhookSubscription') or {}
        cur = conn.cursor()
        cur.execute("UPDATE ea_config SET webhook_subscription_id=%s, "
                    "signing_secret=COALESCE(%s, signing_secret) WHERE id=%s",
                    (sub.get('id'), sub.get('signingSecret'), row.get('id')))
        conn.commit()
        click.echo(f"Subscription {sub.get('id')} stored"
                   + (' (signing secret captured)' if sub.get('signingSecret')
                      else ' (NO secret in response — set it via PUT /api/ea/config)'))
    finally:
        close_connection(conn)


@bp.cli.command('map-survey')
def cli_map_survey():
    """Print the coffee survey's questions + IDs and write a draft
    question_map into ea_config for admin confirmation."""
    import click
    from utils.database import get_db_connection, close_connection
    conn = get_db_connection()
    try:
        _ensure_tables_conn(conn)
        row = _row_from_conn(conn)
        ids = _survey_ids(row)
        if not ids:
            click.echo('Set ea_survey_ids first (PUT /api/ea/config).')
            return
        client = EASurveyClient(load_config_from_conn(conn))
        if client.is_stub():
            click.echo('STUB mode — configure EA credentials first.')
            return
        FIELD_HINTS = (('drink', 'drink'), ('coffee', 'drink'),
                       ('milk', 'milk'), ('sugar', 'sugar'), ('note', 'notes'))
        draft = {}
        for sid in ids:
            ok, data = client.fetch_survey_structure(sid)
            if not ok:
                click.echo(f'survey {sid} fetch failed: {data}')
                continue
            survey = data.get('survey') or {}
            click.echo(f"Survey {sid}: {survey.get('name')}")
            for q in (survey.get('questions') or []):
                text = (q.get('text') or '').lower()
                field = next((f for hint, f in FIELD_HINTS if hint in text), None)
                opts = [o.get('value') or o.get('text')
                        for o in (q.get('options') or [])]
                click.echo(f"  [{q.get('id')}] {q.get('text')} "
                           f"→ {field or 'UNMAPPED'} options={opts}")
                if field:
                    draft[str(q['id'])] = {'field': field}
        if draft:
            cur = conn.cursor()
            cur.execute("UPDATE ea_config SET question_map=%s WHERE id=%s",
                        (json.dumps(draft), row.get('id')))
            conn.commit()
            click.echo(f'Draft question_map written ({len(draft)} questions) — '
                       'review via GET /api/ea/status, adjust via PUT /api/ea/config.')
    finally:
        close_connection(conn)


def _ensure_tables_conn(conn):
    class _Shim:
        def __init__(self, c):
            self._c = c

        def cursor(self):
            return self._c.cursor()

        def commit(self):
            self._c.commit()

        def rollback(self):
            self._c.rollback()
    _ensure_tables(_Shim(conn))
