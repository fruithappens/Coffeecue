"""Admin SMS alerts — text a nominated number when something goes wrong.

Steve's ask: "a SMS number for admin who could get a text if issues, and
levels of errors so not spammed all day — but [for] error or critical."

Design:
- Config lives in settings KV under 'admin_alerts':
    {enabled, phone, min_severity, cooldown_minutes}
  min_severity is 'error' (error + critical) or 'critical' (critical only).
- send_admin_alert(code, severity, message) is called by
  services.logging_utils.event() whenever an event's severity is at or
  above the configured threshold.
- Rate limited PER CODE: at most one alert per code per cooldown window
  (default 15 min). So a single recurring fault texts you once, not all
  day. The cooldown is in-memory (per process) — adequate for the
  single-instance deploy; a recurring fault across a restart re-alerts
  once, which is acceptable.
- Sends via the SMS provider abstraction (services.sms), so it respects
  SMS_PROVIDER and is stubbed in TESTING_MODE.

Never raises into the caller — alerting must not become the new fault.
"""
from __future__ import annotations

import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

CONFIG_KEY = 'admin_alerts'

# severity ranking — higher is worse
_SEVERITY_RANK = {'info': 0, 'warning': 1, 'error': 2, 'critical': 3}

# In-memory per-code last-sent timestamps (monotonic seconds).
_last_sent: dict[str, float] = {}


def _coffee_system():
    try:
        from flask import current_app
        return current_app.config.get('coffee_system')
    except Exception:
        return None


def load_config(db=None) -> dict:
    """Read admin-alert config from settings KV. Env overrides for the
    phone + enable so a deploy can pin them without the DB."""
    import os
    cfg = {'enabled': False, 'phone': '', 'min_severity': 'critical',
           'cooldown_minutes': 15}
    try:
        if db is None:
            cs = _coffee_system()
            db = cs.db if cs else None
        if db is not None:
            from routes.consolidated_api_routes import _kv_get
            stored = _kv_get(db, CONFIG_KEY, default={}) or {}
            if isinstance(stored, dict):
                cfg.update(stored)
    except Exception as e:
        logger.debug("admin_alerts load_config: %s", e)
    # Env overrides
    if os.getenv('ADMIN_ALERT_PHONE'):
        cfg['phone'] = os.getenv('ADMIN_ALERT_PHONE')
    if os.getenv('ADMIN_ALERT_ENABLED'):
        cfg['enabled'] = os.getenv('ADMIN_ALERT_ENABLED', '').lower() == 'true'
    return cfg


def _within_cooldown(code: str, cooldown_minutes: int) -> bool:
    last = _last_sent.get(code)
    if last is None:
        return False
    return (time.monotonic() - last) < (cooldown_minutes * 60)


def send_admin_alert(code: str, severity: str, message: str,
                     db=None) -> Optional[bool]:
    """Send an admin SMS for `code` if config + severity + cooldown allow.

    Returns True if sent, False if suppressed (config off / below
    threshold / in cooldown / not configured), None on error. Never raises.
    """
    try:
        cfg = load_config(db)
        if not cfg.get('enabled') or not (cfg.get('phone') or '').strip():
            return False
        threshold = _SEVERITY_RANK.get((cfg.get('min_severity') or 'critical').lower(), 3)
        sev_rank = _SEVERITY_RANK.get((severity or 'info').lower(), 0)
        if sev_rank < threshold:
            return False
        cooldown = int(cfg.get('cooldown_minutes') or 15)
        if _within_cooldown(code, cooldown):
            logger.info("admin alert for %s suppressed (cooldown %dm)", code, cooldown)
            return False

        body = f"[Coffee Cue {severity.upper()}] {code}: {message}"[:300]
        from services.sms import get_outbound_provider
        result = get_outbound_provider().send(cfg['phone'].strip(), body)
        _last_sent[code] = time.monotonic()
        if result.ok:
            logger.info("admin alert sent for %s to %s", code, cfg['phone'])
            return True
        logger.warning("admin alert send failed for %s: %s", code, result.error)
        return None
    except Exception as e:  # noqa: BLE001
        logger.warning("send_admin_alert crashed (non-fatal): %s", e)
        return None
