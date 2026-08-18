"""EventsAir schema introspection — turns first API contact into a report.

Every GraphQL query in survey_client.py carries a TODO_EA marker because
it was written from documented entity names without sandbox access. This
module closes that loop with ONE click: run a standard GraphQL
introspection against the tenant, filter the schema down to the parts we
care about (contacts, surveys, webhooks, custom fields, communications),
and return a compact report of what the schema ACTUALLY calls things.

Steve pastes credentials into the Support EA tab, hits "Inspect schema",
and sends back the report — the TODO_EA queries then get patched to the
real names ("a few tweaks rather than a big build").
"""
from __future__ import annotations

KEYWORDS = ('contact', 'survey', 'webhook', 'customfield', 'custom_field',
            'communication', 'queue', 'event')

# One standard introspection query: root fields with arg names + types,
# depth-limited so the response stays small.
INTROSPECTION_QUERY = """
query CoffeeCueIntrospect {
  __schema {
    queryType { fields { name args { name type { name kind ofType { name } } } type { name kind ofType { name } } } }
    mutationType { fields { name args { name type { name kind ofType { name } } } type { name kind ofType { name } } } }
  }
}
"""

TYPE_FIELDS_QUERY = """
query TypeFields($name: String!) {
  __type(name: $name) {
    name
    fields { name type { name kind ofType { name } } }
  }
}
"""

# Types worth drilling into when they exist — the shapes our worker
# parses. Checked case-insensitively against the schema's own names.
INTERESTING_TYPES = ('SurveyResponse', 'QuestionResponse', 'Contact',
                     'WebhookSubscription', 'WebhookEventType',
                     'Survey', 'SurveyQuestion')


def _type_name(t):
    if not isinstance(t, dict):
        return ''
    return t.get('name') or (t.get('ofType') or {}).get('name') or t.get('kind') or ''


def _condense_fields(fields):
    out = []
    for f in fields or []:
        args = ', '.join(f"{a.get('name')}: {_type_name(a.get('type'))}"
                         for a in (f.get('args') or []))
        out.append({'name': f.get('name'),
                    'args': args,
                    'returns': _type_name(f.get('type'))})
    return out


def _relevant(name: str) -> bool:
    low = (name or '').lower()
    return any(k in low for k in KEYWORDS)


def describe_types(client, names):
    """Drill into SPECIFIC named types and return their fields.

    The full scan only follows types reachable from keyword-matched root
    fields, so entities named in ways we did not anticipate are invisible
    to it — the real schema turned out to expose attendees under `event`
    rather than a top-level contacts query, and `Event` never appeared in
    the report. It also takes ~83 seconds, long enough that the browser
    aborts it. Naming types directly answers a specific question in one
    round trip each.
    """
    out, missing = {}, []
    for tname in [n.strip() for n in names if n and n.strip()]:
        tok, tdata = client.graphql(TYPE_FIELDS_QUERY, {'name': tname})
        tinfo = (tdata or {}).get('__type') if tok else None
        if tinfo and tinfo.get('fields'):
            out[tname] = [{'name': f.get('name'),
                           'type': _type_name(f.get('type'))}
                          for f in tinfo['fields']]
        else:
            missing.append(tname)
    return {'types': out, 'not_found': missing}


def run_introspection(client):
    """Full flow: introspect roots, filter to relevant fields, drill into
    interesting types. Returns (ok, report_dict_or_error). Never raises."""
    ok, data = client.graphql(INTROSPECTION_QUERY)
    if not ok:
        return False, f'introspection query failed: {data}'
    schema = (data or {}).get('__schema') or {}
    queries = _condense_fields((schema.get('queryType') or {}).get('fields'))
    mutations = _condense_fields((schema.get('mutationType') or {}).get('fields'))

    report = {
        'queries': [f for f in queries if _relevant(f['name'])],
        'mutations': [f for f in mutations if _relevant(f['name'])],
        'query_count_total': len(queries),
        'mutation_count_total': len(mutations),
        'types': {},
    }

    # Collect the return-type names we saw, then drill into the
    # interesting ones that actually exist in this schema.
    seen_types = {f['returns'] for f in report['queries'] + report['mutations']}
    targets = set()
    for want in INTERESTING_TYPES:
        for t in seen_types:
            if t and want.lower() in t.lower():
                targets.add(t)
        targets.add(want)  # try the documented name even if not seen
    for tname in sorted(targets):
        tok, tdata = client.graphql(TYPE_FIELDS_QUERY, {'name': tname})
        if not tok:
            continue
        tinfo = (tdata or {}).get('__type')
        if tinfo and tinfo.get('fields'):
            report['types'][tname] = [
                {'name': f.get('name'), 'type': _type_name(f.get('type'))}
                for f in tinfo['fields']]

    # The headline answers for our open questions, pre-digested.
    findings = []
    qnames = {f['name'].lower(): f['name'] for f in report['queries']}
    mnames = {f['name'].lower(): f['name'] for f in report['mutations']}
    for want, where, label in (
            ('surveyresponse', qnames, 'survey response fetch'),
            ('contactspaged', qnames, 'paged contacts'),
            ('webhookeventtypes', qnames, 'webhook event type discovery'),
            ('createwebhooksubscription', mnames, 'webhook subscription create'),
            ('queueeventtextmessagecommunication', mnames, 'EA-billed SMS')):
        hit = next((v for k, v in where.items() if want in k), None)
        findings.append(f"{label}: {hit or 'NOT FOUND (check report)'}")
    push_hits = [v for k, v in mnames.items()
                 if 'push' in k or 'alert' in k or 'notification' in k]
    findings.append('app push mutation (research gap #1): '
                    + (', '.join(push_hits) if push_hits else 'none visible'))
    report['findings'] = findings
    return True, report
