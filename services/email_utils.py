"""Minimal SMTP email sender.

Used by the post-event summary email feature. Deliberately tiny —
stdlib smtplib only, no Flask-Mail dependency. Gated behind
EMAIL_ENABLED so a deploy without SMTP configured silently no-ops
(returns a structured result, never raises into the request).

Config (env / config.py):
  EMAIL_ENABLED   — 'true' to actually send; anything else = dry-run
  SMTP_SERVER     — host (e.g. smtp.sendgrid.net, smtp.gmail.com)
  SMTP_PORT       — usually 587 (STARTTLS) or 465 (SSL)
  SMTP_USERNAME   — login
  SMTP_PASSWORD   — login / API key
  SMTP_FROM       — From: address (falls back to SMTP_USERNAME)

Or Microsoft 365 through Microsoft Graph (preferred for cupq.com.au,
whose mailboxes are M365, where Microsoft has switched off password SMTP):
  GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET — an app
      registration with the Mail.Send application permission
  GRAPH_SENDER    — the mailbox it sends as, e.g. hello@cupq.com.au
When all four are set, Graph is used and EMAIL_ENABLED is not needed.
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class EmailResult:
    ok: bool
    detail: str
    sent: bool = False  # True only if an SMTP send actually happened


def _cfg(key: str, default: str = '') -> str:
    return (os.getenv(key, default) or '').strip()


def graph_configured() -> bool:
    return all(_cfg(k) for k in ('GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID',
                                  'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER'))


def email_enabled() -> bool:
    return graph_configured() or _cfg('EMAIL_ENABLED', 'false').lower() == 'true'


_graph_token = {'value': None, 'expires': 0.0}


def _graph_access_token() -> str:
    import time
    import requests

    if _graph_token['value'] and time.time() < _graph_token['expires'] - 60:
        return _graph_token['value']
    r = requests.post(
        f"https://login.microsoftonline.com/{_cfg('GRAPH_TENANT_ID')}/oauth2/v2.0/token",
        data={'client_id': _cfg('GRAPH_CLIENT_ID'), 'client_secret': _cfg('GRAPH_CLIENT_SECRET'),
              'scope': 'https://graph.microsoft.com/.default', 'grant_type': 'client_credentials'},
        timeout=15)
    r.raise_for_status()
    body = r.json()
    _graph_token['value'] = body['access_token']
    _graph_token['expires'] = time.time() + int(body.get('expires_in', 3600))
    return _graph_token['value']


def _send_via_graph(to: str, subject: str, html_body: str) -> EmailResult:
    import requests

    try:
        sender = _cfg('GRAPH_SENDER')
        r = requests.post(
            f"https://graph.microsoft.com/v1.0/users/{sender}/sendMail",
            headers={'Authorization': f'Bearer {_graph_access_token()}'},
            json={'message': {'subject': subject,
                              'body': {'contentType': 'HTML', 'content': html_body},
                              'toRecipients': [{'emailAddress': {'address': to}}]},
                  'saveToSentItems': True},
            timeout=15)
        if r.status_code == 202:
            logger.info("Emailed %r via Graph: %r", to, subject)
            return EmailResult(ok=True, sent=True, detail='sent')
        logger.error("Graph send to %r refused: %s %s", to, r.status_code, r.text[:200])
        return EmailResult(ok=False, detail=f'Graph refused: {r.status_code}')
    except Exception as e:
        logger.error("Graph send to %r failed: %s", to, e)
        return EmailResult(ok=False, detail=f'Graph send failed: {e}')


def send_html_email(to: str, subject: str, html_body: str,
                    text_fallback: Optional[str] = None) -> EmailResult:
    """Send an HTML email. Never raises — returns an EmailResult.

    When EMAIL_ENABLED is not 'true', this is a dry-run: it validates
    inputs and returns ok=True, sent=False so callers can surface
    "email is not configured" without treating it as an error.
    """
    to = (to or '').strip()
    if not to or '@' not in to:
        return EmailResult(ok=False, detail='invalid recipient address')

    if graph_configured():
        return _send_via_graph(to, subject, html_body)

    if not email_enabled():
        logger.info("EMAIL_ENABLED off — would email %r: %r", to, subject)
        return EmailResult(
            ok=True, sent=False,
            detail='EMAIL_ENABLED is off — email not sent (dry run). '
                   'Set EMAIL_ENABLED=true and SMTP_* to enable.',
        )

    server = _cfg('SMTP_SERVER')
    port = int(_cfg('SMTP_PORT', '587') or '587')
    username = _cfg('SMTP_USERNAME')
    password = _cfg('SMTP_PASSWORD')
    from_addr = _cfg('SMTP_FROM') or username
    if not server or not from_addr:
        return EmailResult(ok=False,
                           detail='SMTP not configured (SMTP_SERVER / SMTP_FROM missing)')

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = from_addr
    msg['To'] = to
    if text_fallback:
        msg.attach(MIMEText(text_fallback, 'plain'))
    msg.attach(MIMEText(html_body, 'html'))

    try:
        context = ssl.create_default_context()
        if port == 465:
            with smtplib.SMTP_SSL(server, port, context=context, timeout=15) as s:
                if username:
                    s.login(username, password)
                s.sendmail(from_addr, [to], msg.as_string())
        else:
            with smtplib.SMTP(server, port, timeout=15) as s:
                s.ehlo()
                try:
                    s.starttls(context=context)
                    s.ehlo()
                except smtplib.SMTPException:
                    # Server may not support STARTTLS — proceed plaintext
                    # (some internal relays). Login still attempted below.
                    logger.warning("SMTP STARTTLS not available on %s:%s", server, port)
                if username:
                    s.login(username, password)
                s.sendmail(from_addr, [to], msg.as_string())
        logger.info("Emailed %r: %r", to, subject)
        return EmailResult(ok=True, sent=True, detail='sent')
    except Exception as e:
        logger.error("Email send to %r failed: %s", to, e)
        return EmailResult(ok=False, detail=f'SMTP send failed: {e}')
