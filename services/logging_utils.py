"""Structured logging with stable event codes.

Today every `logger.error("Something broke: %s", e)` is a unique string;
greppability across hundreds of files is poor and a future log
collector (Datadog/Logflare) can't alert on rate-of-event because
there's no stable identifier.

`event(code, **fields)` emits a line that always starts with
`event=<CODE>` followed by space-separated `key=value` pairs. Stable
codes are SCREAMING_SNAKE_CASE — pick them from CODES below or add a
new one with a docstring explaining when it fires.

Usage:
    from services.logging_utils import event
    event('SMS_PARSE_FAIL', phone=phone, body=body[:50], reason=str(e))

The output is plain text (key=value), not JSON. That makes it cheap
to grep/awk in the Railway log tail (`grep 'event=SMS_PARSE_FAIL' …`)
while still being parseable by structured collectors that look for
`key=value` pairs (Datadog's "logfmt" parser, Grafana Loki's `logfmt`
stage, etc.).
"""
from __future__ import annotations
import logging

logger = logging.getLogger(__name__)


# Stable event codes. Add new ones at the bottom; never rename or
# remove — downstream alerts reference these exact strings.
CODES = {
    # SMS pipeline
    'SMS_PARSE_FAIL':       'Inbound SMS could not be parsed as an order.',
    'SMS_SEND_FAIL':        'Outbound Twilio send returned non-2xx or raised.',
    'SMS_WEBHOOK_SIG_FAIL': 'Twilio webhook signature validation failed.',
    # Order lifecycle
    'ORDER_CREATE_FAIL':    'Could not insert a new order row.',
    'ORDER_ASSIGN_FAIL':    'No station could accept an order (no capability match).',
    'STOCK_DECREMENT_FAIL': 'Stock decrement on completion crashed; stock now inconsistent.',
    # Auth
    'AUTH_TOKEN_REJECT':    'JWT failed verification (sig / expiry / format).',
    'AUTH_ROLE_DENY':       'Authenticated user lacked the required role.',
    # Setup / config
    'QUICK_SETUP_FAIL':     'Quick Setup apply failed mid-flight; partial state on disk.',
    'MIGRATION_FAIL':       'Schema migration failed (logged in runner already; here for grep).',
    # Misc operational
    'BACKUP_FAIL':          'Daily pg_dump failed.',
    'CATALOG_SYNC_FAIL':    'Could not read or write the catalog_items table.',
}


def _fmt_value(v):
    """Quote a value for logfmt output. Strings with spaces or
    quotes get wrapped in quotes; everything else is rendered
    str()-style."""
    if v is None:
        return ''
    s = str(v)
    if any(c in s for c in (' ', '"', '=')):
        # Escape embedded quotes and wrap.
        s = s.replace('\\', '\\\\').replace('"', '\\"')
        return f'"{s}"'
    return s


def event(code: str, level: int = logging.WARNING, severity: str = None, **fields) -> None:
    """Emit a structured event log line.

    code: a stable SCREAMING_SNAKE_CASE token from CODES (or new). Logged
          as `event=CODE` at the start of the line.
    level: log level (logging.WARNING by default — most events worth
           tracking are not full-on ERRORs).
    severity: 'info'|'warning'|'error'|'critical'. When 'error' or
          'critical' (and admin alerts are configured at/below that
          threshold), an admin SMS is dispatched — rate-limited per code.
          Defaults from the log level if not given.
    fields: arbitrary kwargs serialised as `key=value` pairs.

    Unknown codes are still emitted; they just log a debug-level warning
    so we can spot drift. We never raise — logging should never become
    an error itself.
    """
    try:
        if code not in CODES:
            logger.debug("logging_utils.event: unknown code %r — add to CODES", code)
        parts = [f"event={code}"]
        for k, v in fields.items():
            parts.append(f"{k}={_fmt_value(v)}")
        line = ' '.join(parts)
        logger.log(level, line)

        # Derive severity from the log level if the caller didn't pass one.
        sev = severity
        if sev is None:
            sev = ('critical' if level >= logging.CRITICAL
                   else 'error' if level >= logging.ERROR
                   else 'warning' if level >= logging.WARNING
                   else 'info')
        # Dispatch an admin SMS for error/critical events (rate-limited,
        # config-gated inside send_admin_alert). Best-effort.
        if sev in ('error', 'critical'):
            try:
                from services.admin_alerts import send_admin_alert
                send_admin_alert(code, sev, line)
            except Exception:
                pass
    except Exception as e:  # noqa: BLE001
        # Last-ditch fallback — never let the logger itself crash a request.
        try:
            logger.error("logging_utils.event crashed: %s", e)
        except Exception:
            pass
