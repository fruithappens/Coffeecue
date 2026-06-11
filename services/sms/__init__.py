"""SMS provider factory.

Resolves which provider to use for OUTBOUND sends, and exposes the
list of ALL configured providers (so every one can receive INBOUND
webhooks simultaneously — a customer texting the Twilio number lands
at /api/sms; texting the ClickSend number lands at /api/sms/clicksend;
both feed the same NLP).

Why outbound and inbound are decoupled
--------------------------------------
The outbound primary is what we use when WE send (order confirmations,
"ready for pickup", etc.). It's picked by the SMS_PROVIDER env var —
one provider, one outgoing number per deploy.

Inbound is per-provider: each provider has its OWN webhook path, so
all three can listen at once. Steve can keep the Twilio number live
for existing customers AND advertise a new ClickSend number for new
events. If Twilio's outbound goes down mid-event, flip SMS_PROVIDER
to clicksend and the new sends go out via ClickSend — but the old
Twilio number keeps receiving inbound texts the whole time. No DNS
flip, no number port, no customer disruption.

Usage
-----
  from services.sms import get_outbound_provider, all_providers

  result = get_outbound_provider().send('+614...', 'order ready')
  for p in all_providers():
      health = p.health()
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from .base import SMSProvider, SendResult, InboundMessage, ProviderHealth
from .twilio_provider import TwilioProvider
from .clicksend_provider import ClickSendProvider
from .cellcast_provider import CellcastProvider

logger = logging.getLogger(__name__)

# Provider registry. Add new providers here.
PROVIDERS: dict[str, type[SMSProvider]] = {
    'twilio':    TwilioProvider,
    'clicksend': ClickSendProvider,
    'cellcast':  CellcastProvider,
}

# Instances are cached at module level — re-creating a provider per
# request would re-read env vars (cheap but pointless) and re-init
# the Twilio HTTP client (not free).
_instances: dict[str, SMSProvider] = {}


def _get_instance(name: str) -> SMSProvider:
    inst = _instances.get(name)
    if inst is None:
        cls = PROVIDERS.get(name)
        if cls is None:
            raise ValueError(
                f"Unknown SMS provider {name!r}. "
                f"Known: {', '.join(PROVIDERS)}"
            )
        inst = cls()
        _instances[name] = inst
    return inst


def get_outbound_provider() -> SMSProvider:
    """Return the configured outbound primary.

    Picked by SMS_PROVIDER env var (default: twilio). Falls back to
    Twilio with a warning if the env var names an unknown provider —
    we'd rather degrade than crash mid-request.
    """
    name = (os.getenv('SMS_PROVIDER') or 'twilio').lower().strip()
    try:
        return _get_instance(name)
    except ValueError as e:
        logger.error("SMS_PROVIDER misconfigured: %s — falling back to twilio", e)
        return _get_instance('twilio')


def get_provider(name: str) -> Optional[SMSProvider]:
    """Get a specific provider by name, or None if unknown.

    Used by the inbound webhook routes — each route fetches its
    provider explicitly.
    """
    try:
        return _get_instance(name)
    except ValueError:
        return None


def all_providers() -> list[SMSProvider]:
    """All registered providers, instantiated. Used by health checks.

    Note: this instantiates EVERY provider regardless of whether it's
    configured. That's intentional — health() reports unconfigured
    providers as such, which is what we want on the readiness page
    ("ClickSend is not configured" is a useful status, not an error).
    """
    return [_get_instance(name) for name in PROVIDERS]


def reset_cache():
    """Drop the cached instances. Useful for tests that monkey-patch
    env vars between cases."""
    _instances.clear()


__all__ = [
    'SMSProvider', 'SendResult', 'InboundMessage', 'ProviderHealth',
    'PROVIDERS', 'get_outbound_provider', 'get_provider',
    'all_providers', 'reset_cache',
]
