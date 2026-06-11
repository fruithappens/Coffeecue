"""Twilio SMS provider.

Wraps the existing Twilio integration so callers using the new
SMSProvider interface get the same behaviour the codebase has had
since day one. This is the lowest-risk provider — it's been in
production, sig validation is battle-tested, and the SDK is solid.

Env vars:
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PHONE_NUMBER
  TESTING_MODE  (if 'true', send() logs and returns ok without hitting Twilio)
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from .base import SMSProvider, SendResult, InboundMessage, ProviderHealth

logger = logging.getLogger(__name__)


class TwilioProvider(SMSProvider):
    name = 'twilio'
    webhook_path = '/api/sms'  # legacy path — pre-dates the provider abstraction

    def __init__(self):
        self.account_sid = os.getenv('TWILIO_ACCOUNT_SID', '').strip()
        self.auth_token = os.getenv('TWILIO_AUTH_TOKEN', '').strip()
        self.phone_number = os.getenv('TWILIO_PHONE_NUMBER', '').strip()
        self.testing_mode = os.getenv('TESTING_MODE', 'false').lower() == 'true'
        self._client = None

    def _get_client(self):
        """Lazy-import + lazy-init so the import doesn't break if the
        twilio package is uninstalled (a Cellcast-only deploy
        shouldn't need it)."""
        if self._client is not None:
            return self._client
        if self.testing_mode:
            return None
        if not (self.account_sid and self.auth_token):
            return None
        try:
            from twilio.rest import Client
            self._client = Client(self.account_sid, self.auth_token)
            return self._client
        except Exception as e:
            logger.error("Twilio client init failed: %s", e)
            return None

    # ----- outbound -----

    def send(self, to: str, body: str, **opts) -> SendResult:
        if self.testing_mode:
            logger.info("TESTING_MODE — Twilio.send stubbed | to=%s body=%s", to, body[:80])
            return SendResult(ok=True, provider=self.name,
                              message_id='testing_mode_message_sid')
        client = self._get_client()
        if client is None or not self.phone_number:
            return SendResult(ok=False, provider=self.name, message_id=None,
                              error='Twilio not configured (sid/token/phone missing)')
        try:
            msg = client.messages.create(body=body, from_=self.phone_number, to=to)
            return SendResult(ok=True, provider=self.name, message_id=msg.sid,
                              raw={'status': getattr(msg, 'status', None)})
        except Exception as e:
            logger.error("Twilio send to %s failed: %s", to, e)
            return SendResult(ok=False, provider=self.name, message_id=None,
                              error=str(e))

    # ----- inbound -----

    def verify_inbound(self, request) -> bool:
        # In TESTING_MODE with a missing/test auth token, the existing
        # route handler accepts unsigned webhooks (it warns about it).
        # Preserve that behaviour here — production deploys MUST set a
        # real TWILIO_AUTH_TOKEN.
        token = self.auth_token
        if not token or token == 'test_token':
            if self.testing_mode:
                logger.warning("Twilio sig validation skipped (TESTING_MODE + no auth token)")
                return True
            logger.warning("Twilio inbound rejected: TWILIO_AUTH_TOKEN unset and TESTING_MODE off")
            return False
        try:
            from twilio.request_validator import RequestValidator
            validator = RequestValidator(token)
            url = request.url
            # Railway rewrites the URL; the existing route handler in
            # sms_routes.py compensates by trying http→https. Keep that
            # logic outside this method for now — the route still owns
            # URL normalisation. Callers should pass an already-corrected
            # request, OR fall back to the legacy /api/sms route which
            # has the URL-rewrite logic.
            params = request.form.to_dict()
            signature = request.headers.get('X-Twilio-Signature', '')
            return validator.validate(url, params, signature)
        except Exception as e:
            logger.error("Twilio sig validation crashed: %s", e)
            return False

    def parse_inbound(self, request) -> Optional[InboundMessage]:
        try:
            form = request.form
            from_ = form.get('From', '')
            body = form.get('Body', '')
            sid = form.get('MessageSid', '')
            to_ = form.get('To', '') or self.phone_number
            if not from_ or body is None:
                return None
            return InboundMessage(
                from_number=from_,
                body=body,
                provider=self.name,
                message_id=sid or None,
                to_number=to_,
                raw=dict(form),
            )
        except Exception as e:
            logger.error("Twilio parse_inbound crashed: %s", e)
            return None

    def reply_response(self, body: str) -> tuple[str, int, dict]:
        """Twilio expects TwiML on the webhook response — that's how
        you reply to an inbound SMS in-band without a separate send()."""
        from twilio.twiml.messaging_response import MessagingResponse
        resp = MessagingResponse()
        if body:
            resp.message(body)
        return (str(resp), 200, {'Content-Type': 'text/xml'})

    # ----- introspection -----

    def health(self) -> ProviderHealth:
        if self.testing_mode:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='TESTING_MODE=true; SMS calls stubbed',
                extras={'phone_number': self.phone_number},
            )
        if self.account_sid and self.auth_token and self.phone_number:
            return ProviderHealth(
                name=self.name, configured=True,
                detail='configured',
                extras={'phone_number': self.phone_number},
            )
        missing = []
        if not self.account_sid: missing.append('TWILIO_ACCOUNT_SID')
        if not self.auth_token: missing.append('TWILIO_AUTH_TOKEN')
        if not self.phone_number: missing.append('TWILIO_PHONE_NUMBER')
        return ProviderHealth(
            name=self.name, configured=False,
            detail=f"missing env vars: {', '.join(missing)}",
            extras={'missing': missing},
        )
