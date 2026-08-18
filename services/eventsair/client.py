"""EventsAir API client.

Wraps the EventsAir GraphQL API (OAuth2 client-credentials) + push
notifications behind a small, mockable interface. Mirrors the SMS
provider abstraction in services/sms/.

⚠️ STUB MODE: until a real EventsAir API key exists (and the GraphQL
schema / push API shape is confirmed), every network method here runs
in stub mode — it logs what it *would* do and returns canned data.
Stub mode is on when:
  - TESTING_MODE=true, OR
  - the EventsAir config has no client_id/client_secret.

When real credentials are configured and TESTING_MODE is off, the
methods make real calls. The call bodies are written but the exact
GraphQL query strings / push endpoint are marked TODO_EA where they
need confirmation against the live schema.

Config is passed in (a dict from settings KV) so this class has no
Flask dependency and is unit-testable in isolation.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# EventsAir GraphQL + OAuth endpoints, confirmed against the developer
# portal (developer.eventsair.com/docs/guides/access-token/ and
# /issue-queries/) once real credentials were available.
#
# Authentication is Microsoft Entra (Azure AD), NOT an EventsAir-hosted
# login: the tenant GUID below is EventsAir's own and is the same for every
# customer. The previous guess, login.eventsair.com, is not a real host —
# it failed DNS resolution, which read as "token FETCH FAILED" in the UI
# and looked like a credential problem rather than a wrong URL.
DEFAULT_TOKEN_URL = ('https://login.microsoftonline.com/'
                     'dff76352-1ded-46e8-96a4-1a83718b2d3a/oauth2/v2.0/token')
DEFAULT_GRAPHQL_URL = 'https://api.eventsair.com/graphql'

# Entra requires a scope naming the API being called; without it the token
# request is rejected. `.default` means "every permission already granted to
# this application", which is what a client-credentials app wants.
DEFAULT_SCOPE = ('https://eventsairprod.onmicrosoft.com/'
                 '85d8f626-4e3d-4357-89c6-327d4e6d3d93/.default')


@dataclass
class Attendee:
    """Normalized attendee identity returned to Coffee Cue."""
    external_id: str
    full_name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    registration_category: Optional[str] = None
    is_vip: bool = False
    raw: dict = field(default_factory=dict)


@dataclass
class EAResult:
    ok: bool
    detail: str
    data: dict = field(default_factory=dict)


class EventsAirClient:
    def __init__(self, config: Optional[dict] = None):
        config = config or {}
        self.client_id = (config.get('client_id') or '').strip()
        self.client_secret = (config.get('client_secret') or '').strip()
        self.event_id = (config.get('event_id') or '').strip()
        self.vip_categories = [
            c.strip().lower() for c in (config.get('vip_categories') or []) if c
        ]
        self.token_url = (config.get('token_url') or os.getenv('EA_TOKEN_URL')
                          or DEFAULT_TOKEN_URL).strip()
        self.graphql_url = (config.get('graphql_url') or DEFAULT_GRAPHQL_URL).strip()
        # Overridable so the sandbox tenant (eventsairtest.com) can be pointed
        # at without a code change.
        self.scope = (config.get('scope') or os.getenv('EA_SCOPE')
                      or DEFAULT_SCOPE).strip()
        self.testing_mode = os.getenv('TESTING_MODE', 'false').lower() == 'true'
        self._token = None
        self._token_expires_at = 0.0

    # ----- mode -----

    def is_stub(self) -> bool:
        """True when we must NOT make real calls (no creds, or testing)."""
        return self.testing_mode or not (self.client_id and self.client_secret)

    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.event_id)

    # ----- auth -----

    def get_token(self) -> Optional[str]:
        """OAuth2 client-credentials → cached bearer token. None in stub."""
        if self.is_stub():
            return 'stub-token'
        # Reuse a still-valid token (60s safety margin).
        now = _now()
        if self._token and now < self._token_expires_at - 60:
            return self._token
        try:
            import requests
            resp = requests.post(
                self.token_url,
                data={
                    'grant_type': 'client_credentials',
                    'client_id': self.client_id,
                    'client_secret': self.client_secret,
                    # Required by Entra — omitting it gets the request
                    # rejected outright.
                    'scope': self.scope,
                },
                timeout=10,
            )
            if resp.status_code // 100 != 2:
                # Entra returns a JSON body naming the actual problem
                # (AADSTS codes). Log enough of it to act on: "unauthorized
                # client", "invalid secret" and "wrong scope" are very
                # different fixes and previously looked identical.
                logger.error("EventsAir token fetch %s from %s: %s",
                             resp.status_code, self.token_url, resp.text[:400])
                return None
            payload = resp.json() or {}
            self._token = payload.get('access_token')
            self._token_expires_at = now + float(payload.get('expires_in', 3600))
            return self._token
        except Exception as e:
            logger.error("EventsAir token fetch failed: %s", e)
            return None

    # ----- queries -----

    def find_attendee(self, *, phone: str = '', email: str = '',
                      external_id: str = '') -> Optional[Attendee]:
        """Look up an attendee by phone / email / EA contact id.

        Used to recognize a customer (skip the name prompt) and to
        auto-flag VIPs from registration category. Returns None if no
        match (or in stub mode with no canned hit).
        """
        if self.is_stub():
            # Stub: pretend we don't know this person unless a test wants
            # to exercise the recognized path (override via subclass/mock).
            logger.info("EventsAir.find_attendee STUB (phone=%s email=%s id=%s)",
                        phone, email, external_id)
            return None
        token = self.get_token()
        if not token:
            return None
        try:
            import requests
            # TODO_EA: replace with the real GraphQL query once the schema
            # is confirmed. Shape below is illustrative.
            query = """
            query FindAttendee($eventId: ID!, $phone: String, $email: String) {
              event(id: $eventId) {
                contacts(filter: {mobile: $phone, email: $email}) {
                  id firstName lastName mobile email
                  registration { category }
                }
              }
            }"""
            resp = requests.post(
                self.graphql_url,
                json={'query': query, 'variables': {
                    'eventId': self.event_id, 'phone': phone or None, 'email': email or None,
                }},
                headers={'Authorization': f'Bearer {token}',
                         'Content-Type': 'application/json'},
                timeout=10,
            )
            if resp.status_code // 100 != 2:
                logger.error("EventsAir find_attendee %s: %s", resp.status_code, resp.text[:200])
                return None
            data = resp.json() or {}
            contacts = (((data.get('data') or {}).get('event') or {}).get('contacts') or [])
            if not contacts:
                return None
            c = contacts[0]
            category = ((c.get('registration') or {}).get('category') or '')
            return Attendee(
                external_id=str(c.get('id') or ''),
                full_name=f"{c.get('firstName','')} {c.get('lastName','')}".strip(),
                phone=c.get('mobile'), email=c.get('email'),
                registration_category=category,
                is_vip=category.lower() in self.vip_categories,
                raw=c,
            )
        except Exception as e:
            logger.error("EventsAir find_attendee failed: %s", e)
            return None

    # ----- outbound push -----

    def push_notification(self, attendee_ref: str, title: str, body: str) -> EAResult:
        """Push a status notification to an attendee's EA app device.

        attendee_ref is the EA contact id (external_id). Never raises —
        the order flow must not break because a push failed.
        """
        if self.is_stub():
            logger.info("EventsAir.push STUB → %s | %s: %s", attendee_ref, title, body[:80])
            return EAResult(ok=True, detail='stub — not actually pushed')
        token = self.get_token()
        if not token:
            return EAResult(ok=False, detail='no EventsAir token')
        try:
            import requests
            # TODO_EA: confirm the real push API. EventsAir advertises
            # push notifications to attendee devices; the 3rd-party
            # trigger mechanism (REST endpoint vs GraphQL mutation vs
            # Smart Connector) needs confirmation. Illustrative below.
            resp = requests.post(
                f'{self.graphql_url.rstrip("/graphql")}/notifications/push',
                json={'eventId': self.event_id, 'contactId': attendee_ref,
                      'title': title, 'body': body},
                headers={'Authorization': f'Bearer {token}',
                         'Content-Type': 'application/json'},
                timeout=10,
            )
            ok = resp.status_code // 100 == 2
            return EAResult(ok=ok, detail=f'HTTP {resp.status_code}',
                            data={'status_code': resp.status_code})
        except Exception as e:
            logger.error("EventsAir push failed: %s", e)
            return EAResult(ok=False, detail=str(e))

    # ----- health -----

    def health(self) -> dict:
        if self.testing_mode:
            return {'name': 'eventsair', 'configured': self.configured(),
                    'detail': 'TESTING_MODE — stub calls', 'stub': True}
        if not self.configured():
            missing = [k for k, v in (
                ('client_id', self.client_id), ('client_secret', self.client_secret),
                ('event_id', self.event_id)) if not v]
            return {'name': 'eventsair', 'configured': False,
                    'detail': f'not configured (missing: {", ".join(missing)})',
                    'stub': True}
        # Configured + live: a token fetch is the cheapest reachability probe.
        token = self.get_token()
        return {'name': 'eventsair', 'configured': True,
                'detail': 'configured; token ok' if token else 'configured; token FETCH FAILED',
                'stub': False, 'token_ok': bool(token)}


def _now() -> float:
    # Indirection so tests can monkeypatch; avoids importing time at call
    # sites and keeps the Date.now-style restriction concerns isolated.
    return time.monotonic()
