"""
Schema migrations runner.

Replaces the scattered ALTER TABLE IF NOT EXISTS calls in
coffee_system._init_event_scheduling() with a proper numbered-
migrations system. Each migration is:

  - idempotent (safe to re-run)
  - applied in order, exactly once per database
  - tracked in the `schema_migrations` table

To add a migration:

  1. Append a new entry to the MIGRATIONS list below with the next
     version number.
  2. Provide a docstring (logged on apply).
  3. Provide a function `def upgrade(cursor)` that does the work.
     Cursor is already inside a transaction — raise to roll back.

Run via `apply_pending_migrations(conn)` at app startup. Existing
ALTER TABLE calls in coffee_system.py can stay during the
transition — migrations 1-5 below replicate them so a fresh DB
gets the right schema even without the legacy init path.

This module deliberately avoids dependencies on Flask, SQLAlchemy,
or Alembic. It's plain psycopg2 — minimal surface area.
"""
from __future__ import annotations
import logging
from typing import Callable, NamedTuple

logger = logging.getLogger(__name__)


class Migration(NamedTuple):
    version: int
    name: str
    upgrade: Callable[[object], None]


# ---------------------------------------------------------------------------
# Migration definitions
# ---------------------------------------------------------------------------
# Each migration's upgrade(cur) is a single function that runs inside a
# transaction. It receives a cursor. The runner commits after each
# migration succeeds.
#
# Migrations should be small and obviously correct. If you find yourself
# writing complex logic, prefer a "data migration" script run separately.

def _m001_station_stats_extras(cur):
    """Add columns historically expected on station_stats but missing
    on some installs: capabilities (JSONB), capacity, notes,
    equipment_notes, name, location. These exist as scattered
    ALTER TABLE calls in coffee_system._init_event_scheduling; this
    migration consolidates them."""
    cur.execute("""
        ALTER TABLE station_stats
        ADD COLUMN IF NOT EXISTS capabilities JSONB DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10,
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS equipment_notes TEXT,
        ADD COLUMN IF NOT EXISTS name TEXT,
        ADD COLUMN IF NOT EXISTS location TEXT
    """)


def _m002_customer_preferences_is_vip(cur):
    """customer_preferences was missing is_vip on most installs;
    _handle_vip_code 500'd with 'column does not exist'."""
    cur.execute("""
        ALTER TABLE customer_preferences
        ADD COLUMN IF NOT EXISTS is_vip BOOLEAN DEFAULT FALSE
    """)


def _m003_users_is_active(cur):
    """support_api_routes references users.is_active for the User
    Management panel; was never in the schema."""
    cur.execute("""
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
    """)


def _m004_order_number_seq(cur):
    """Postgres sequence used by both SMS flow and walk-in flow to
    generate short, human-friendly order numbers ('C42' rather than
    'W0544296')."""
    cur.execute("CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1")


def _m005_orders_picked_up_at(cur):
    """`picked_up_at` timestamp written by /api/orders/<id>/pickup.
    Older DBs missing this column take the slow-path UPDATE in the
    pickup endpoint."""
    cur.execute("""
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP
    """)


def _m008_clear_capabilities_json_from_equipment_notes(cur):
    """Clear stale capabilities-shaped JSON from station_stats.equipment_notes.

    An older save path (since fixed) wrote capabilities JSON
    (coffee_types, milk_types, extra_options, capacity, skill_level,
    specializations) into the TEXT `equipment_notes` column instead
    of the proper JSONB `capabilities` column. The Organiser UI maps
    equipment_notes -> "location", so affected stations show a raw
    JSON blob where their location should be.

    The save bug is fixed (station_api_routes.py:454 has the comment),
    but the corrupted rows were never cleaned. This migration is
    idempotent: it only touches rows where equipment_notes starts
    with '{' AND contains one of the capabilities key names, so a
    legitimate hardware note like 'gas-powered, near the bar' is
    preserved untouched.
    """
    cur.execute("""
        UPDATE station_stats
        SET equipment_notes = ''
        WHERE equipment_notes IS NOT NULL
          AND TRIM(equipment_notes) LIKE '{%'
          AND (
            equipment_notes LIKE '%coffee_types%'
            OR equipment_notes LIKE '%milk_types%'
            OR equipment_notes LIKE '%extra_options%'
            OR equipment_notes LIKE '%skill_level%'
            OR equipment_notes LIKE '%specializations%'
          )
    """)


def _m007_orders_reminder_sent_at(cur):
    """Add reminder_sent_at to orders so the pickup-reminder
    background service knows which completed-but-not-collected orders
    have already had a reminder SMS sent. Without this column we'd
    spam customers every minute the reminder thread wakes up."""
    cur.execute("""
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP
    """)


def _m009_catalog_items(cur):
    """Single source of truth for canonical option lists.

    The system used to invent option names in 4+ places independently:
    DEFAULT_MILK_TYPES in milkConfig.js, inventory_items.name typed
    by the operator, station_stats.capabilities.milk_types from the
    Capabilities editor, the walk-in dialog hardcoded list. Result:
    'Whole Milk' from one place silently failed to match 'full cream'
    from another, the capability check rejected orders, the synonym
    table papered over a real architectural hole.

    catalog_items is the one list. Every UI reads it via
    /api/catalog/<category>. Capabilities editor checks boxes from
    this list. Walk-in dialog dropdown is this list (intersected
    with stocked inventory). 'Custom' is just adding a row with
    is_custom=true.

    Schema notes:
    - item_id is the canonical machine-readable token ('full_cream').
      Used in capabilities, used as the order_details.milk value
      going forward, used as the React key.
    - display_name is what humans see ('Full Cream Milk').
    - short_name is the compact form for tight UI ('full cream').
    - properties is JSONB so milks can carry dairyFree/vegan/etc.
      without schema churn when we add new attributes.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS catalog_items (
            id            SERIAL PRIMARY KEY,
            category      VARCHAR(50)  NOT NULL,
            item_id       VARCHAR(100) NOT NULL,
            display_name  VARCHAR(200) NOT NULL,
            short_name    VARCHAR(100),
            subcategory   VARCHAR(50),
            properties    JSONB DEFAULT '{}'::jsonb,
            sort_order    INTEGER NOT NULL DEFAULT 100,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            is_custom     BOOLEAN NOT NULL DEFAULT FALSE,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, item_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_catalog_category ON catalog_items(category, is_active)")

    # Seed canonical items. ON CONFLICT DO NOTHING so this is safe to
    # re-run and won't clobber an operator who tweaked sort_order or
    # marked something inactive.
    SEED = [
        # category, item_id, display_name, short_name, subcategory, properties, sort_order
        # --- MILKS (dairy + alternative) ---
        ('milk', 'full_cream',   'Full Cream Milk',   'full cream',   'standard',
         {'dairyFree': False, 'lactoseFree': False, 'vegan': False, 'lowFat': False,
          'synonyms': ['whole milk', 'whole', 'regular', 'standard', 'dairy']}, 10),
        ('milk', 'skim',         'Skim Milk',         'skim',         'standard',
         {'dairyFree': False, 'lactoseFree': False, 'vegan': False, 'lowFat': True,
          'synonyms': ['skinny', 'low fat', 'low-fat', 'trim']}, 20),
        ('milk', 'reduced_fat',  'Reduced Fat Milk',  'reduced fat',  'standard',
         {'dairyFree': False, 'lactoseFree': False, 'vegan': False, 'lowFat': True}, 30),
        ('milk', 'lactose_free', 'Lactose-Free Milk', 'lactose free', 'standard',
         {'dairyFree': False, 'lactoseFree': True,  'vegan': False, 'lowFat': False,
          'synonyms': ['lactose-free']}, 40),
        ('milk', 'soy',          'Soy Milk',          'soy',          'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': False,
          'synonyms': ['soya']}, 50),
        ('milk', 'oat',          'Oat Milk',          'oat',          'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': False}, 60),
        ('milk', 'almond',       'Almond Milk',       'almond',       'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': True}, 70),
        ('milk', 'coconut',      'Coconut Milk',      'coconut',      'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': False}, 80),
        ('milk', 'macadamia',    'Macadamia Milk',    'macadamia',    'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': False}, 90),
        ('milk', 'rice',         'Rice Milk',         'rice',         'alternative',
         {'dairyFree': True,  'lactoseFree': True,  'vegan': True,  'lowFat': True}, 100),

        # --- DRINKS (espresso + non-coffee) ---
        ('drink', 'flat_white',  'Flat White',  'flat white',  'espresso', {}, 10),
        ('drink', 'cappuccino',  'Cappuccino',  'cappuccino',  'espresso', {}, 20),
        ('drink', 'latte',       'Latte',       'latte',       'espresso', {}, 30),
        ('drink', 'long_black',  'Long Black',  'long black',  'espresso', {}, 40),
        ('drink', 'espresso',    'Espresso',    'espresso',    'espresso', {}, 50),
        ('drink', 'mocha',       'Mocha',       'mocha',       'espresso', {}, 60),
        ('drink', 'macchiato',   'Macchiato',   'macchiato',   'espresso', {}, 70),
        ('drink', 'americano',   'Americano',   'americano',   'espresso', {}, 80),
        ('drink', 'cortado',     'Cortado',     'cortado',     'espresso', {}, 90),
        ('drink', 'piccolo',     'Piccolo',     'piccolo',     'espresso', {}, 100),
        ('drink', 'hot_chocolate', 'Hot Chocolate', 'hot chocolate', 'other',  {}, 200),
        ('drink', 'chai_latte',    'Chai Latte',    'chai latte',    'other',  {}, 210),
        ('drink', 'matcha_latte',  'Matcha Latte',  'matcha latte',  'other',  {}, 220),
        ('drink', 'golden_latte',  'Golden Latte',  'golden latte',  'other',  {}, 230),
        ('drink', 'hot_tea',                'Hot Tea',               'hot tea',               'tea', {}, 300),
        ('drink', 'english_breakfast_tea',  'English Breakfast Tea', 'english breakfast tea', 'tea', {}, 310),
        ('drink', 'earl_grey_tea',          'Earl Grey Tea',         'earl grey tea',         'tea', {}, 320),
        ('drink', 'peppermint_tea',         'Peppermint Tea',        'peppermint tea',        'tea', {}, 330),
        ('drink', 'green_tea',              'Green Tea',             'green tea',             'tea', {}, 340),
        ('drink', 'chamomile_tea',          'Chamomile Tea',         'chamomile tea',         'tea', {}, 350),
        ('drink', 'lemon_ginger_tea',       'Lemon & Ginger Tea',    'lemon ginger tea',      'tea', {}, 360),
        ('drink', 'rooibos_tea',            'Rooibos Tea',           'rooibos tea',           'tea', {}, 370),

        # --- SIZES ---
        ('size', 'small',  'Small (8oz)',  'small',  None, {'ml': 240}, 10),
        ('size', 'medium', 'Medium (12oz)','medium', None, {'ml': 355}, 20),
        ('size', 'large',  'Large (16oz)', 'large',  None, {'ml': 475}, 30),

        # --- SWEETENERS ---
        ('sweetener', 'white_sugar', 'White Sugar', 'white sugar', None, {}, 10),
        ('sweetener', 'brown_sugar', 'Brown Sugar', 'brown sugar', None, {}, 20),
        ('sweetener', 'raw_sugar',   'Raw Sugar',   'raw sugar',   None, {}, 30),
        ('sweetener', 'stevia',      'Stevia',      'stevia',      'artificial', {}, 40),
        ('sweetener', 'equal',       'Equal',       'equal',       'artificial', {}, 50),
        ('sweetener', 'sweet_n_low', 'Sweet’N Low', 'sweet n low', 'artificial', {}, 60),
        ('sweetener', 'honey',       'Honey',       'honey',       None, {'vegan': False}, 70),
    ]

    import json as _json
    for (cat, iid, dn, sn, sub, props, sort) in SEED:
        cur.execute("""
            INSERT INTO catalog_items
                (category, item_id, display_name, short_name, subcategory, properties, sort_order)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (category, item_id) DO NOTHING
        """, (cat, iid, dn, sn, sub, _json.dumps(props), sort))


def _m006_customer_preferences_shots_and_decaf(cur):
    """Add preferred_strength + preferred_decaf to customer_preferences
    so a regular's "usual" replay actually reflects their full order.
    A customer who always orders a double-shot decaf flat white was
    previously stored as just "flat white" — and the next visit's
    suggestion dropped both the shots and the decaf, forcing them to
    re-specify every time.

    `preferred_strength` is TEXT (not INTEGER) because customers say
    "strong" / "double shot" / "extra strong" interchangeably and we
    want to replay verbatim rather than collapsing them into a number.
    `preferred_decaf` is BOOLEAN — "decaf " prefix stripped on save."""
    cur.execute("""
        ALTER TABLE customer_preferences
        ADD COLUMN IF NOT EXISTS preferred_strength TEXT,
        ADD COLUMN IF NOT EXISTS preferred_decaf BOOLEAN DEFAULT FALSE
    """)


def _m010_customer_questions(cur):
    """The 'BARISTA' SMS escape hatch table.

    Customer texts BARISTA → bot pushes their question here →
    Barista UI surfaces it via WebSocket → first barista to respond
    SMSes the answer back. If 60 seconds pass with no answer, the
    background timeout sweeper marks the row 'timed_out' and the
    bot SMSes the customer a fallback ("all busy, want to continue
    ordering?").

    Status values:
      - pending     : received, no barista has replied yet
      - answered    : barista responded; their reply went out as SMS
      - timed_out   : 60s passed; fallback SMS sent
      - dismissed   : barista marked it as "no action needed"

    `responded_by` records who answered (admin/staff/barista user
    or station_id) for audit + leaderboards.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS customer_questions (
            id            SERIAL PRIMARY KEY,
            phone         VARCHAR(20)  NOT NULL,
            customer_name VARCHAR(100),
            question      TEXT         NOT NULL,
            station_id    INTEGER,
            status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
            response      TEXT,
            responded_by  VARCHAR(100),
            created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
            responded_at  TIMESTAMP,
            timeout_at    TIMESTAMP
        )
    """)
    # Polling indexes — the barista UI polls "pending only" frequently,
    # and the timeout sweeper polls "pending older than 60s" every 10s.
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_customer_questions_status
        ON customer_questions(status, created_at)
    """)


def _m011_client_errors(cur):
    """Capture React Error Boundary crashes from real-world browser
    sessions.

    Why: the UserManagement edit-pencil crash made it to production
    because there was no way for a frontend crash to phone home — the
    Error Boundary saved the user from a white screen, but neither
    Steve nor I knew it had fired until he screenshotted the page.
    With this table, every catch posts here automatically: the next
    crash surfaces in the Support tab (or a log query) immediately.

    Stack and component_stack are stored verbatim so I can locate the
    file/line without a screenshot. Captured cap is 5000 chars each
    so a runaway stack doesn't fill the row to the moon.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS client_errors (
            id              SERIAL PRIMARY KEY,
            occurred_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
            component       VARCHAR(100),
            message         TEXT,
            stack           TEXT,
            component_stack TEXT,
            url             TEXT,
            user_id         VARCHAR(100),
            user_agent      TEXT,
            retry_count     INTEGER      DEFAULT 0
        )
    """)
    # Most recent first — what we want when answering "what just broke?"
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_client_errors_occurred
        ON client_errors(occurred_at DESC)
    """)


def _m012_event_templates(cur):
    """Saved Quick Setup presets that can be re-applied to a new event.

    Steve's framing: "every new event is 30 clicks." Quick Setup got
    that down to 5 clicks, a saved template gets it to 1. Template
    payload is the Quick Setup preset JSON — same shape the
    /api/quick-setup endpoint accepts — so applying a template just
    means POSTing the payload back to quick-setup.

    Templates store: milks, sizes, drinks, teas, pricing mode, walkin
    defaults, SMS policy, event_name (optional). They do NOT store:
    stations (per-venue), accounts (per-event), inventory levels
    (per-event). Those are deliberately per-event so a template can
    be applied across venues without surprises.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS event_templates (
            id          SERIAL PRIMARY KEY,
            name        VARCHAR(120) UNIQUE NOT NULL,
            description TEXT,
            payload     JSONB NOT NULL,
            saved_by    VARCHAR(100),
            saved_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_event_templates_name
        ON event_templates(name)
    """)


# Master list. Append new migrations at the bottom — DO NOT renumber
# existing ones, and DO NOT change `version`. The runner trusts the
# version number to determine which migrations to skip.
MIGRATIONS: list[Migration] = [
    Migration(1, 'station_stats_extras',       _m001_station_stats_extras),
    Migration(2, 'customer_preferences_is_vip', _m002_customer_preferences_is_vip),
    Migration(3, 'users_is_active',            _m003_users_is_active),
    Migration(4, 'order_number_seq',           _m004_order_number_seq),
    Migration(5, 'orders_picked_up_at',        _m005_orders_picked_up_at),
    Migration(6, 'customer_preferences_strength_and_decaf',
              _m006_customer_preferences_shots_and_decaf),
    Migration(7, 'orders_reminder_sent_at',    _m007_orders_reminder_sent_at),
    Migration(9, 'catalog_items',              _m009_catalog_items),
    Migration(8, 'clear_capabilities_json_from_equipment_notes',
              _m008_clear_capabilities_json_from_equipment_notes),
    Migration(10, 'customer_questions',        _m010_customer_questions),
    Migration(11, 'client_errors',             _m011_client_errors),
    Migration(12, 'event_templates',           _m012_event_templates),
]


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def _ensure_migrations_table(cur):
    """Create the bookkeeping table on first run."""
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version  INTEGER PRIMARY KEY,
            name     TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)


def _applied_versions(cur) -> set[int]:
    cur.execute("SELECT version FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def apply_pending_migrations(conn) -> list[str]:
    """Apply any migrations whose version is greater than what's
    already recorded. Returns a list of human-readable strings for
    each migration applied. Safe to call at every boot.

    Raises only on truly fatal errors — individual migration failures
    are logged and the runner moves on (best-effort, like the existing
    ALTER TABLE IF NOT EXISTS pattern).
    """
    applied: list[str] = []
    try:
        cur = conn.cursor()
        _ensure_migrations_table(cur)
        conn.commit()
        already = _applied_versions(cur)
        for m in MIGRATIONS:
            if m.version in already:
                continue
            try:
                logger.info(f"[migrations] applying #{m.version} {m.name}")
                m.upgrade(cur)
                cur.execute(
                    "INSERT INTO schema_migrations (version, name) VALUES (%s, %s) "
                    "ON CONFLICT (version) DO NOTHING",
                    (m.version, m.name),
                )
                conn.commit()
                applied.append(f"#{m.version} {m.name}")
            except Exception as e:
                logger.error(f"[migrations] #{m.version} {m.name} FAILED: {e}")
                try:
                    conn.rollback()
                except Exception:
                    pass
        if applied:
            logger.info(f"[migrations] applied: {', '.join(applied)}")
        else:
            logger.info("[migrations] no pending migrations")
    except Exception as e:
        logger.exception(f"[migrations] runner failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    return applied
