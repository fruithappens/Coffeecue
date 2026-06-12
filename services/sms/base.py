"""SMS provider interface — common shape every provider implements.

Why this exists
---------------
Twilio is our default but isn't the only viable SMS path. Australian
clients prefer Australian invoicing (ClickSend, Cellcast); we need a
disaster-recovery path if Twilio goes down mid-event; future per-event
billing might pick the cheapest provider per booking. All of that
requires a one-function-call provider swap, not a hand-modified
codebase.

A provider implements `send()` and `verify_inbound()`, normalises the
provider-specific webhook payload into an `InboundMessage` via
`parse_inbound()`, and reports its own configuration health to the
readiness page.

Adding a new provider
---------------------
1. Drop a new module under `services/sms/` that subclasses `SMSProvider`.
2. Register it in `services/sms/__init__.py:PROVIDERS`.
3. Add credential env vars (e.g. `MY_PROVIDER_API_KEY`).
4. Configure the provider's webhook to POST to `/api/sms/<provider_name>`.

The same NLP / order-creation pipeline runs regardless of which
provider received the message.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SendResult:
    """Normalised outcome of a single outbound send.

    All providers return a different shape; this dataclass is the one
    callers see. Failure is signalled by `ok=False`, not exceptions —
    SMS sends are best-effort and the rest of the request flow must
    not die because Twilio's API was slow.
    """
    ok: bool
    provider: str               # 'twilio' | 'clicksend' | 'cellcast' | …
    message_id: Optional[str]   # provider's message identifier (Twilio SID, ClickSend message_id, etc.)
    error: Optional[str] = None
    # Free-form provider response payload. Useful for debugging.
    raw: dict = field(default_factory=dict)


@dataclass
class InboundMessage:
    """Normalised inbound SMS, regardless of which provider received it.

    Every webhook handler in `routes/sms_routes.py` (and any future
    provider-specific route) calls `provider.parse_inbound(request)`
    to get this shape. Downstream code only sees InboundMessage; it
    never knows whether the message came from Twilio or ClickSend.
    """
    from_number: str
    body: str
    provider: str
    message_id: Optional[str]
    # Some providers report the recipient (our number) on inbound — useful
    # when multiple numbers are wired to the same backend.
    to_number: Optional[str] = None
    # Raw form/JSON the provider sent, kept for audit + debugging.
    raw: dict = field(default_factory=dict)


@dataclass
class ProviderHealth:
    """Used by health_api / readiness_api to display per-provider status."""
    name: str
    configured: bool
    detail: str
    extras: dict = field(default_factory=dict)


class SMSProvider(abc.ABC):
    """Base class for SMS providers.

    Subclasses MUST implement send(), verify_inbound(), parse_inbound(),
    and health(). Default implementations exist where they're trivial
    (e.g. response wrapper — most providers expect a 200 with no body
    on the webhook).
    """

    # Stable lowercase identifier — used in env vars + webhook URLs.
    name: str = 'base'

    # Webhook path this provider listens on. Defaults to /api/sms/<name>;
    # Twilio gets the legacy /api/sms for back-compat.
    webhook_path: str = ''

    # ----- outbound -----

    @abc.abstractmethod
    def send(self, to: str, body: str, **opts) -> SendResult:
        """Send an outbound SMS. Must NEVER raise — return a SendResult
        with ok=False instead. Sender code must keep running even if
        the provider is down."""

    # ----- inbound -----

    @abc.abstractmethod
    def verify_inbound(self, request) -> bool:
        """Verify that an inbound webhook actually came from this
        provider. Twilio: HMAC of URL + sorted params. ClickSend: shared
        secret in headers. Cellcast: source-IP allow-list or basic auth.

        Must return True/False; never raise.

        In TESTING_MODE-style scenarios where a real signature can't be
        produced (load tests, local Twilio CLI replay), providers may
        opt-in to skipping verification — see each subclass.
        """

    @abc.abstractmethod
    def parse_inbound(self, request) -> Optional[InboundMessage]:
        """Extract the From/Body/Sid (or equivalent) from the provider's
        webhook payload. Returns None if the payload couldn't be parsed
        — the route handler should 200 anyway (provider will not retry
        on 4xx for most providers, but logging it is useful).
        """

    def reply_response(self, body: str) -> tuple[str, int, dict]:
        """Build the HTTP response the provider expects for an inbound
        webhook. Most providers want a plain 200 with no body (replies
        go via the outbound API). Twilio wants TwiML.

        Returns (body, status, headers) so the route handler can return
        a normal Flask tuple.
        """
        return ('', 204, {})

    # ----- introspection -----

    @abc.abstractmethod
    def health(self) -> ProviderHealth:
        """Report whether this provider is configured + reachable.
        Surfaced in /api/health/full and /api/readiness so the operator
        sees green/amber/red per provider."""
