"""ClickSend SMS provider — Australian-owned, PAYG, free inbound.

Primary alternative to Twilio per SMS_PROVIDERS_AU.md research:
- Free inbound (Twilio charges per inbound)
- AUD-denominated billing (no FX wobble for per-event client invoices)
- Pure PAYG, no monthly subscription
- Official Python SDK (`clicksend-client` on PyPI)

Env vars:
  CLICKSEND_USERNAME       — your ClickSend account username
  CLICKSEND_API_KEY        — generated in the ClickSend portal
  CLICKSEND_FROM_NUMBER    — dedicated AU number ('+61…') or a registered
                             alphanumeric sender ID
  CLICKSEND_WEBHOOK_SECRET — optional shared secret. If set, every
                             inbound webhook must include
                             X-Coffee-Cue-Webhook-Secret: <value> in
                             headers. ClickSend's "Custom Headers" on
                             the inbound URL is where you'd set this.

Webhook setup (one-time, in the ClickSend portal):
  - Add an "Inbound SMS Rule" pointing to
    https://<your-host>/api/sms/clicksend
  - Method: POST
  - Content-Type: application/json
  - (Optional) custom headers: X-Coffee-Cue-Webhook-Secret: <your secret>

ClickSend posts inbound as JSON: {"from": "+614…", "body": "…",
"message_id": "…", "to": "…"} (shape inferred from ClickSend docs +
community examples; verify on first inbound and adjust if needed —
search for `# CLICKSEND_INBOUND_SHAPE` comment in this file).

Implementation notes
--------------------
This provider uses plain HTTPS to the ClickSend REST API rather than
the official SDK, on purpose: one less dependency, smaller install
size, and the SDK's surface for our use case (one POST) isn't worth
the import weight. If a future use case needs MMS / voice / number
provisioning, switch to the SDK.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Optional

from .base import SMSProvider, SendResult, InboundMessage, ProviderHealth

logger = logging.getLogger(__name__)


CLICKSEND_API_BASE = 'https://rest.clicksend.com/v3'


class ClickSendProvider(SMSProvider):
    name = 'clicksend'
    webhook_path = '/api/sms/clicksend'

    def __init__(self):
        self.username = os.getenv('CLICKSEND_USERNAME', '').strip()
        self.api_key = os.getenv('CLICKSEND_API_KEY', '').strip()
        self.from_number = os.getenv('CLICKSEND_FROM_NUMBER', '').strip()
        self.webhook_secret = os.getenv('CLICKSEND_WEBHOOK_SECRET', '').strip()
        self.testing_mode = os.getenv('TESTING_MODE', 'false').lower() == 'true'

    def _auth_header(self) -> dict:
        token = base64.b64encode(
            f"{self.username}:{self.api_key}".encode()
        ).decode()
        return {'Authorization': f'Basic {token}'}

    # ----- outbound -----

    def send(self, to: str, body: str, **opts) -> SendResult:
        if self.testing_mode:
            logger.info("TESTING_MODE — ClickSend.send stubbed | to=%s body=%s",
                        to, body[:80])
            return SendResult(ok=True, provider=self.name,
                              message_id='testing_mode_message_id')
        if not (self.username and self.api_key and self.from_number):
            return SendResult(
                ok=False, provider=self.name, message_id=None,
                error='ClickSend not configured (username/api_key/from missing)',
            )
        try:
            import requests
            payload = {
                'messages': [{
                    'source': 'coffee-cue',
                    'from': self.from_number,
                    'to': to,
                    'body': body,
                }],
            }
            r = requests.post(
                f'{CLICKSEND_API_BASE}/sms/send',
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    **self._auth_header(),
                },
                timeout=10,
            )
            if r.status_code // 100 != 2:
                return SendResult(
                    ok=False, provider=self.name, message_id=None,
                    error=f'HTTP {r.status_code}: {r.text[:200]}',
                    raw={'status_code': r.status_code},
                )
            data = r.json() or {}
            # ClickSend wraps the result: data.data.messages[0].message_id
            messages = (((data.get('data') or {}).get('messages')) or [{}])
            msg_id = messages[0].get('message_id') if messages else None
            return SendResult(
                ok=True, provider=self.name, message_id=msg_id,
                raw=data,
            )
        except Exception as e:
            logger.error("ClickSend send to %s failed: %s", to, e)
            return SendResult(ok=False, provider=self.name, message_id=None,
                              error=str(e))

    # ----- inbound -----

    def verify_inbound(self, request) -> bool:
        # ClickSend doesn't ship a built-in HMAC signing scheme for
        # inbound webhooks (their portal lets you add custom headers
        # to outbound POSTs to your URL). Recommendation: set
        # CLICKSEND_WEBHOOK_SECRET and configure ClickSend to add the
        # matching X-Coffee-Cue-Webhook-Secret header.
        if not self.webhook_secret:
            # No secret configured — accept (operator chose not to gate).
            if self.testing_mode:
                logger.info("ClickSend inbound accepted (TESTING_MODE, no secret)")
                return True
            logger.warning(
                "ClickSend inbound accepted without secret — set "
                "CLICKSEND_WEBHOOK_SECRET in production for auth"
            )
            return True
        provided = request.headers.get('X-Coffee-Cue-Webhook-Secret', '')
        if provided != self.webhook_secret:
            logger.warning("ClickSend inbound rejected: secret header mismatch")
            return False
        return True

    def parse_inbound(self, request) -> Optional[InboundMessage]:
        # CLICKSEND_INBOUND_SHAPE: verify on first real inbound. Common
        # shape per docs: {"from": "+614…", "body": "…", "message_id": "…",
        # "to": "…"}. Some configurations send {"sms": {...}}; we try
        # both.
        try:
            data = request.get_json(silent=True) or {}
            # Some integrations nest under "sms" — flatten if so.
            if 'sms' in data and isinstance(data['sms'], dict):
                data = data['sms']
            from_ = data.get('from') or data.get('From') or ''
            body = data.get('body') or data.get('message') or data.get('Body') or ''
            msg_id = data.get('message_id') or data.get('MessageSid') or None
            to_ = data.get('to') or data.get('To') or self.from_number
            if not from_ or not body:
                logger.warning("ClickSend inbound parse: missing from/body in %r", data)
                return None
            return InboundMessage(
                from_number=from_,
                body=body,
                provider=self.name,
                message_id=msg_id,
                to_number=to_,
                raw=data,
            )
        except Exception as e:
            logger.error("ClickSend parse_inbound crashed: %s", e)
            return None

    def reply_response(self, body: str) -> tuple[str, int, dict]:
        # ClickSend has no in-band reply mechanism — the inbound webhook
        # just acknowledges receipt. Replies go via send(). Returning
        # 204 No Content keeps ClickSend's logs clean.
        return ('', 204, {})

    # ----- introspection -----

    def health(self) -> ProviderHealth:
        if self.testing_mode:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='TESTING_MODE=true; SMS calls stubbed',
                extras={'from_number': self.from_number},
            )
        if self.username and self.api_key and self.from_number:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='configured',
                extras={
                    'from_number': self.from_number,
                    'webhook_secret_set': bool(self.webhook_secret),
                },
            )
        missing = []
        if not self.username: missing.append('CLICKSEND_USERNAME')
        if not self.api_key: missing.append('CLICKSEND_API_KEY')
        if not self.from_number: missing.append('CLICKSEND_FROM_NUMBER')
        return ProviderHealth(
            name=self.name, configured=False,
            detail=f"missing env vars: {', '.join(missing)}",
            extras={'missing': missing},
        )
