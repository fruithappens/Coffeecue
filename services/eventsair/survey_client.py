"""EventsAir GraphQL client for the Survey Order Channel.

Extends the Phase-0 EventsAirClient (token manager, stub discipline)
with the queries/mutations the survey channel needs:

  - fetch_survey_response(response_id)   webhook thin payload → full data
  - fetch_contact(contact_id)            name + mobile resolution
  - fetch_contacts_page(...)             attendee mirror sync
  - list_webhook_event_types()           discover the real survey event
                                         type name at test time (§10.1)
  - create/disable_webhook_subscription  one-time setup CLI, never at
                                         request time

⚠ TODO_EA: query strings follow the entity names confirmed on
developer.eventsair.com (surveysPaged, SurveyResponse, QuestionResponse,
contactsPaged, webhookEventTypes, createWebhookSubscription) but the
exact field selections need confirmation against the live schema on
first sandbox access — each is marked. Every method returns plain dicts
and NEVER raises: (ok, data|error) tuples, because a broken EA call
must degrade to "app channel silent", nothing else.

Tenant endpoint: the survey channel uses EA_TENANT_ENDPOINT (the
per-customer GraphQL URL) when set, falling back to the Phase-0
graphql_url config.
"""
from __future__ import annotations

import logging
import os

from .client import EventsAirClient

logger = logging.getLogger(__name__)


class EASurveyClient(EventsAirClient):
    def __init__(self, config=None):
        super().__init__(config or {})
        tenant = (os.getenv('EA_TENANT_ENDPOINT')
                  or (config or {}).get('tenant_endpoint') or '').strip()
        if tenant:
            self.graphql_url = tenant
        # Spec §1 env names take precedence when present.
        cid = (os.getenv('EA_CLIENT_ID') or '').strip()
        csec = (os.getenv('EA_CLIENT_SECRET') or '').strip()
        if cid:
            self.client_id = cid
        if csec:
            self.client_secret = csec

    # ------------------------------------------------------------------
    def graphql(self, query: str, variables: dict = None):
        """POST one GraphQL operation. Returns (ok, data-or-error)."""
        if self.is_stub():
            logger.info("EASurveyClient STUB graphql: %s", query.strip().split('\n')[0][:80])
            return False, 'stub mode — no EA credentials (or TESTING_MODE)'
        token = self.get_token()
        if not token:
            return False, 'EA token fetch failed'
        try:
            import requests
            resp = requests.post(
                self.graphql_url,
                json={'query': query, 'variables': variables or {}},
                headers={'Authorization': f'Bearer {token}',
                         'Content-Type': 'application/json'},
                timeout=15,
            )
            if resp.status_code // 100 != 2:
                return False, f'HTTP {resp.status_code}: {resp.text[:200]}'
            body = resp.json() or {}
            if body.get('errors'):
                return False, str(body['errors'])[:300]
            return True, body.get('data') or {}
        except Exception as e:  # noqa: BLE001
            return False, f'EA request failed: {e}'

    # ------------------------------------------------------------------
    def fetch_survey_response(self, response_id: str):
        """Full survey response + per-question answers + contact.

        TODO_EA: confirm root field name and whether the contact comes
        inline (spec §10.4). Selection is deliberately broad so either
        answer works.
        """
        query = """
        query SurveyResponse($id: ID!) {
          surveyResponse(id: $id) {
            id
            survey { id name }
            contact { id firstName lastName mobile email }
            contactId
            submittedAt
            questionResponses {
              question { id text }
              questionId
              value
              selectedOptions { id value text }
            }
          }
        }"""
        return self.graphql(query, {'id': response_id})

    def fetch_contact(self, contact_id: str):
        """TODO_EA: confirm root field + mobile field name."""
        query = """
        query Contact($id: ID!) {
          contact(id: $id) {
            id firstName lastName mobile email
          }
        }"""
        return self.graphql(query, {'id': contact_id})

    def fetch_contacts_page(self, ea_event_id: str, skip: int = 0,
                            take: int = 200, modified_since: str = None):
        """One page of the attendee mirror sync.

        Rewritten against the REAL schema (introspected 2026-08-18). The
        original was guesswork and could not have worked: it asked for
        `contactsPaged(skip:, take:, modifiedSince:)` returning
        `totalCount` and flat `mobile` / `email` fields. EventsAir actually
        uses offset/limit paging, puts the number under
        `contactPhoneNumbers.mobile`, and calls the address `primaryEmail`.
        There is no totalCount on ContactPage — it has items + pageInfo.

        Also pulls each contact's CUSTOM FIELDS, which is how a coffee
        preference reaches us: an organiser can put "oat latte, 1 sugar,
        medium" on the attendee record, and ordering becomes a
        confirmation rather than a conversation.
        """
        query = """
        query Contacts($eventId: ID!, $offset: NonNegativeInt, $limit: PaginationLimit) {
          event(id: $eventId) {
            contactsPaged(offset: $offset, limit: $limit) {
              items {
                id internalNumber firstName lastName primaryEmail externalIdentifier
                biography
                contactPhoneNumbers { mobile inCountryMobile }
                userDefinedField1 userDefinedField2
                userDefinedField3 userDefinedField4
                customFieldsPaged(offset: 0, limit: 50) {
                  items { name value uniqueCode }
                }
              }
            }
          }
        }"""
        ok, data = self.graphql(query, {'eventId': ea_event_id,
                                        'offset': skip, 'limit': take})
        if ok:
            return ok, data
        # Custom fields are the most likely thing a tenant restricts, and
        # losing the whole sync over them would be worse than losing the
        # preference. Retry without them before giving up.
        slim = """
        query Contacts($eventId: ID!, $offset: NonNegativeInt, $limit: PaginationLimit) {
          event(id: $eventId) {
            contactsPaged(offset: $offset, limit: $limit) {
              items {
                id internalNumber firstName lastName primaryEmail externalIdentifier
                contactPhoneNumbers { mobile inCountryMobile }
                userDefinedField1 userDefinedField2
                userDefinedField3 userDefinedField4
              }
            }
          }
        }"""
        return self.graphql(slim, {'eventId': ea_event_id,
                                   'offset': skip, 'limit': take})


    # ------------------------------------------------------------------
    def list_webhook_event_types(self):
        """Discover available webhook event type names (§10.1 — record
        the survey one in EVENTSAIR_SURVEY_CHANNEL.md once seen)."""
        query = """
        query { webhookEventTypes { name description } }"""
        return self.graphql(query)

    def create_webhook_subscription(self, url: str, description: str,
                                    event_type_names: list,
                                    ea_event_id: str = None):
        """TODO_EA: confirm mutation arg shape + returned secret field.
        The signing secret is expected in the mutation result — it is
        shown ONCE; the CLI stores it into ea_config immediately."""
        mutation = """
        mutation CreateSub($input: CreateWebhookSubscriptionInput!) {
          createWebhookSubscription(input: $input) {
            id signingSecret
          }
        }"""
        variables = {'input': {
            'url': url,
            'description': description,
            'webhookEventTypeNames': event_type_names,
        }}
        if ea_event_id:
            variables['input']['filters'] = {'eventId': ea_event_id}
        return self.graphql(mutation, variables)

    def set_webhook_subscription_enabled(self, subscription_id: str,
                                         enabled: bool):
        """TODO_EA: confirm mutation names (enable/disable pair vs flag)."""
        name = 'enableWebhookSubscription' if enabled else 'disableWebhookSubscription'
        mutation = f"""
        mutation Toggle($id: ID!) {{ {name}(id: $id) {{ id }} }}"""
        return self.graphql(mutation, {'id': subscription_id})

    def fetch_survey_structure(self, survey_id: str):
        """Questions + option lists for `flask ea map-survey` (§5).
        TODO_EA: confirm survey root field + option nesting."""
        query = """
        query Survey($id: ID!) {
          survey(id: $id) {
            id name
            questions { id text type options { id value text } }
          }
        }"""
        return self.graphql(query, {'id': survey_id})
