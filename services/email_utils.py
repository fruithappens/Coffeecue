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


def email_enabled() -> bool:
    return _cfg('EMAIL_ENABLED', 'false').lower() == 'true'


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
