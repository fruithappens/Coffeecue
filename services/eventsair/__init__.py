"""EventsAir integration factory + config access.

Config lives in the settings KV under 'eventsair_config' (same pattern
as branding_settings / printer_config — no migration, no per-event
secret bleed). Env vars override individual fields so a deploy can keep
the Client Secret out of the DB if it prefers.

See EVENTSAIR_INTEGRATION.md at the repo root for the full design.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from .client import EventsAirClient, Attendee, EAResult

logger = logging.getLogger(__name__)

CONFIG_KEY = 'eventsair_config'

# Fields that are secret — never returned by the config GET endpoint.
SECRET_FIELDS = {'client_secret', 'webhook_secret'}


def load_config(db) -> dict:
    """Read the EventsAir config from settings KV, with env overrides.

    Env wins over DB for each field so an operator can pin secrets in
    the environment (Railway vars) instead of the database.
    """
    cfg = {}
    try:
        # Local import to avoid a circular import at module load.
        from routes.consolidated_api_routes import _kv_get
        cfg = _kv_get(db, CONFIG_KEY, default={}) or {}
    except Exception as e:
        logger.warning("EventsAir load_config: KV read failed: %s", e)
        cfg = {}

    # Env overrides.
    env_map = {
        'enabled': os.getenv('EVENTSAIR_ENABLED'),
        'client_id': os.getenv('EVENTSAIR_CLIENT_ID'),
        'client_secret': os.getenv('EVENTSAIR_CLIENT_SECRET'),
        'event_id': os.getenv('EVENTSAIR_EVENT_ID'),
        'webhook_secret': os.getenv('EVENTSAIR_WEBHOOK_SECRET'),
    }
    for k, v in env_map.items():
        if v is not None and v != '':
            cfg[k] = v.lower() == 'true' if k == 'enabled' else v
    return cfg


def save_config(db, updates: dict) -> dict:
    """Merge updates into the stored config and persist. Blank secret
    fields in `updates` are ignored (so a config PUT that doesn't resend
    the secret won't wipe it)."""
    from routes.consolidated_api_routes import _kv_get, _kv_put
    cfg = _kv_get(db, CONFIG_KEY, default={}) or {}
    for k, v in (updates or {}).items():
        if k in SECRET_FIELDS and not (v or '').strip():
            continue  # don't overwrite a stored secret with blank
        cfg[k] = v
    _kv_put(db, CONFIG_KEY, cfg)
    return cfg


def public_config(cfg: dict) -> dict:
    """Config safe to return to the UI — secrets redacted to a boolean
    'is set' flag."""
    out = {k: v for k, v in (cfg or {}).items() if k not in SECRET_FIELDS}
    for s in SECRET_FIELDS:
        out[f'{s}_set'] = bool((cfg or {}).get(s))
    return out


def get_client(db) -> EventsAirClient:
    """Build an EventsAirClient from the current config."""
    return EventsAirClient(load_config(db))


def is_enabled(db) -> bool:
    return bool(load_config(db).get('enabled'))


__all__ = [
    'EventsAirClient', 'Attendee', 'EAResult',
    'CONFIG_KEY', 'load_config', 'save_config', 'public_config',
    'get_client', 'is_enabled',
]
