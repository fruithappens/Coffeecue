"""Admin SMS alerts — text a nominated number (and whoever is on call,
services/on_call.py) when something goes wrong.

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
    cfg = {'enabled': False, 'phone': '', 'email': '', 'min_severity': 'critical',
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
    if os.getenv('ADMIN_ALERT_EMAIL'):
        cfg['email'] = os.getenv('ADMIN_ALERT_EMAIL')
    return cfg


def _mask(phone: str) -> str:
    return (phone[:4] + "…" + phone[-3:]) if len(phone) > 7 else "…"


def recipients(cfg: dict, db=None) -> tuple[list, list]:
    """(phones, emails): whoever is on call now (People > On call), then the
    admin alert number and email. Each address once."""
    phones, emails = [], []
    try:
        if db is None:
            cs = _coffee_system()
            db = cs.db if cs else None
        if db is not None:
            from services.on_call import on_call_now
            for s in on_call_now(db):
                phones.append(s.get('phone') or '')
                emails.append(s.get('email') or '')
    except Exception as e:  # noqa: BLE001
        logger.debug("on-call recipients unavailable: %s", e)
    phones.append((cfg.get('phone') or '').strip())
    emails.append((cfg.get('email') or '').strip())

    def once(xs, key):
        seen, out = set(), []
        for x in xs:
            k = key(x)
            if x and k not in seen:
                seen.add(k)
                out.append(x)
        return out

    return (once(phones, lambda p: p.replace(' ', '')[-9:]),
            once(emails, lambda e: e.lower()))


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
        if not cfg.get('enabled'):
            return False
        phones, emails = recipients(cfg, db)
        if not (phones or emails):
            return False
        threshold = _SEVERITY_RANK.get((cfg.get('min_severity') or 'critical').lower(), 3)
        sev_rank = _SEVERITY_RANK.get((severity or 'info').lower(), 0)
        if sev_rank < threshold:
            return False
        cooldown = int(cfg.get('cooldown_minutes') or 15)
        if _within_cooldown(code, cooldown):
            logger.info("admin alert for %s suppressed (cooldown %dm)", code, cooldown)
            return False
        # Mark BEFORE sending so a slow or failing channel can't spam on retry.
        _last_sent[code] = time.monotonic()

        body = f"[CupQ {severity.upper()}] {code}: {message}"[:300]
        sent_any = False

        # SMS channel: whoever is on call, and the admin alert number.
        for phone in phones:
            try:
                from services.sms import get_outbound_provider
                result = get_outbound_provider().send(phone, body)
                if result.ok:
                    sent_any = True
                    logger.info("admin alert SMS sent for %s to %s", code, _mask(phone))
                else:
                    logger.warning("admin alert SMS failed for %s: %s", code, result.error)
            except Exception as e:  # noqa: BLE001
                logger.warning("admin alert SMS crashed for %s: %s", code, e)

        # EMAIL channel — the one that survives an SMS/Twilio outage, which is
        # exactly what an SMS_OUTBOUND_DOWN alert is about. Best-effort; no-ops
        # cleanly if email isn't configured.
        for email in emails:
            try:
                from services.email_utils import send_html_email
                send_html_email(
                    email,
                    f"[CupQ {severity.upper()}] {code}",
                    f"<p><b>{code}</b> &mdash; {severity.upper()}</p>"
                    f"<p>{message}</p>"
                    "<p style='color:#888;font-size:12px'>Automated alert from "
                    "CupQ. Who gets these: Runner &rarr; Live &rarr; Readiness "
                    "(admin alerts) and People &rarr; On call.</p>",
                )
                sent_any = True
                logger.info("admin alert email dispatched for %s", code)
            except Exception as e:  # noqa: BLE001
                logger.warning("admin alert email crashed for %s: %s", code, e)

        return sent_any or None
    except Exception as e:  # noqa: BLE001
        logger.warning("send_admin_alert crashed (non-fatal): %s", e)
        return None
