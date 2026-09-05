"""Cellcast SMS provider — Australian-owned, cheapest at scale.

Secondary alternative per SMS_PROVIDERS_AU.md:
- ~3¢/SMS outbound at the 5k tier (less than half Twilio's price)
- Free inbound (shared or dedicated number)
- Pure PAYG, no monthly subscription
- ASX-listed (CCT) — Australian-owned

Trade-offs:
- No official Python SDK — this implementation is hand-rolled
  requests against their REST API.
- Webhook signing not as standardised as Twilio's HMAC — we use a
  shared-secret header gate (same pattern as ClickSend in this codebase).

Env vars:
  CELLCAST_API_KEY        — API token from the Cellcast portal
  CELLCAST_FROM_NUMBER    — your dedicated AU number ('+61…') or
                            registered sender ID
  CELLCAST_WEBHOOK_SECRET — optional shared secret. If set, inbound
                            webhooks must include
                            X-Coffee-Cue-Webhook-Secret: <value>.

Webhook setup (in the Cellcast portal):
  - Add an inbound webhook pointing to
    https://<your-host>/api/sms/cellcast
  - Method: POST, Content-Type: application/json
  - Add custom header X-Coffee-Cue-Webhook-Secret if you set the env var

Cellcast posts inbound as JSON. The exact shape isn't as well
documented as Twilio's; this parser accepts the common fields and
falls through to the raw payload for inspection if something's
missing. See `# CELLCAST_INBOUND_SHAPE` comment.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from .base import SMSProvider, SendResult, InboundMessage, ProviderHealth

logger = logging.getLogger(__name__)


# Cellcast publishes a few base URLs in different docs. The most
# stable one as of 2026-06 is the v3 messaging endpoint.
CELLCAST_API_BASE = 'https://cellcast.com.au/api/v3'


class CellcastProvider(SMSProvider):
    name = 'cellcast'
    webhook_path = '/api/sms/cellcast'

    def __init__(self):
        self.api_key = os.getenv('CELLCAST_API_KEY', '').strip()
        self.from_number = os.getenv('CELLCAST_FROM_NUMBER', '').strip()
        self.webhook_secret = os.getenv('CELLCAST_WEBHOOK_SECRET', '').strip()
        self.testing_mode = os.getenv('TESTING_MODE', 'false').lower() == 'true'

    # ----- outbound -----

    def send(self, to: str, body: str, **opts) -> SendResult:
        if self.testing_mode:
            logger.info("TESTING_MODE — Cellcast.send stubbed | to=%s body=%s",
                        to, body[:80])
            return SendResult(ok=True, provider=self.name,
                              message_id='testing_mode_message_id')
        if not (self.api_key and self.from_number):
            return SendResult(
                ok=False, provider=self.name, message_id=None,
                error='Cellcast not configured (api_key/from missing)',
            )
        try:
            import requests
            payload = {
                'sms_text': body,
                'numbers': [to],
                'from': self.from_number,
                'source': 'coffee-cue',
            }
            r = requests.post(
                f'{CELLCAST_API_BASE}/send-sms',
                json=payload,
                headers={
                    'Content-Type': 'application/json',
                    'APPKEY': self.api_key,
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
            # Cellcast wraps response in {meta, data}; message_id lives
            # in data.messages[0].message_id per the docs.
            msgs = ((data.get('data') or {}).get('messages') or [{}])
            msg_id = msgs[0].get('message_id') if msgs else None
            return SendResult(
                ok=True, provider=self.name, message_id=msg_id, raw=data,
            )
        except Exception as e:
            logger.error("Cellcast send to %s failed: %s", to, e)
            return SendResult(ok=False, provider=self.name, message_id=None,
                              error=str(e))

    # ----- inbound -----

    def verify_inbound(self, request) -> bool:
        if not self.webhook_secret:
            if self.testing_mode:
                logger.info("Cellcast inbound accepted (TESTING_MODE, no secret)")
                return True
            # FAIL CLOSED (see clicksend_provider): an unset secret must not
            # mean "accept anything".
            logger.warning(
                "Cellcast inbound REJECTED: CELLCAST_WEBHOOK_SECRET is not set "
                "(set it and add the X-Coffee-Cue-Webhook-Secret header in Cellcast)"
            )
            return False
        provided = request.headers.get('X-Coffee-Cue-Webhook-Secret', '')
        if provided != self.webhook_secret:
            logger.warning("Cellcast inbound rejected: secret header mismatch")
            return False
        return True

    def parse_inbound(self, request) -> Optional[InboundMessage]:
        # CELLCAST_INBOUND_SHAPE: this is the best-effort decode of
        # the most common keys. Adjust on first real inbound by adding
        # a logger.info("Cellcast raw: %s", data) here, watching the
        # log, and updating the field map.
        try:
            data = request.get_json(silent=True) or {}
            # Some payloads nest under "data" or "message".
            if 'message' in data and isinstance(data['message'], dict):
                data = data['message']
            elif 'data' in data and isinstance(data['data'], dict):
                data = data['data']
            from_ = data.get('from') or data.get('From') or data.get('sender') or ''
            body = (data.get('body') or data.get('Body')
                    or data.get('message') or data.get('text') or '')
            msg_id = data.get('message_id') or data.get('id') or None
            to_ = data.get('to') or data.get('recipient') or self.from_number
            if not from_ or not body:
                logger.warning("Cellcast inbound parse: missing from/body in %r", data)
                return None
            return InboundMessage(
                from_number=from_, body=body, provider=self.name,
                message_id=msg_id, to_number=to_, raw=data,
            )
        except Exception as e:
            logger.error("Cellcast parse_inbound crashed: %s", e)
            return None

    def reply_response(self, body: str) -> tuple[str, int, dict]:
        # No in-band reply mechanism — replies go via send().
        return ('', 204, {})

    # ----- introspection -----

    def health(self) -> ProviderHealth:
        if self.testing_mode:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='TESTING_MODE=true; SMS calls stubbed',
                extras={'from_number': self.from_number},
            )
        if self.api_key and self.from_number:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='configured',
                extras={
                    'from_number': self.from_number,
                    'webhook_secret_set': bool(self.webhook_secret),
                },
            )
        missing = []
        if not self.api_key: missing.append('CELLCAST_API_KEY')
        if not self.from_number: missing.append('CELLCAST_FROM_NUMBER')
        return ProviderHealth(
            name=self.name, configured=False,
            detail=f"missing env vars: {', '.join(missing)}",
            extras={'missing': missing},
        )
