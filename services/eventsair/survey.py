"""EventsAir Survey Order Channel — pure logic (no Flask, no DB).

Everything here is deterministic and unit-testable offline:

  - webhook signature verification (raw-body HMAC + timestamp window)
  - survey answer → CoffeeCue order-field mapping via question_map
  - phone normalisation to E.164 (AU-first, mirrors coffee_system's)

Spec: "CoffeeCue — EventsAir Survey Order Channel (BETA)". The exact
signature scheme EA uses is confirmed at test time; we implement the
two plausible schemes behind one verifier:

  mode "svix" (default) — the standard webhooks convention the spec's
      contract matches (per-subscription signing secret, raw body,
      `webhook-timestamp` header, replay window): secret is
      `whsec_<base64>`; signed content is "<webhook-id>.<timestamp>.<body>";
      HMAC-SHA256; `webhook-signature` holds space-separated
      "v1,<base64sig>" candidates.
  mode "raw" — plain HMAC-SHA256 over the raw body, hex or base64,
      compared against the `webhook-signature` header directly.

Never log the secret. Never create anything from an unverified request.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time
from typing import Optional

# Canonical CoffeeCue values (must match what the SMS parser produces so
# EA orders are indistinguishable downstream).
CANON_DRINKS = {
    'flat white': 'flat white',
    'latte': 'latte',
    'cappuccino': 'cappuccino',
    'long black': 'long black',
    'espresso': 'espresso',
    'hot chocolate': 'hot chocolate',
    'tea': 'tea',
    # common EA-side spellings
    'americano': 'long black',
    'cafe latte': 'latte',
    'caffe latte': 'latte',
    'chai': 'chai latte',
    'chai latte': 'chai latte',
    'hot choc': 'hot chocolate',
}
CANON_MILKS = {
    'full cream': 'full cream',
    'fullcream': 'full cream',
    'whole': 'full cream',
    'regular': 'full cream',
    'skim': 'skim',
    'skinny': 'skim',
    'oat': 'oat',
    'soy': 'soy',
    'almond': 'almond',
    'lactose free': 'lactose free',
    'none': 'no milk',
    'no milk': 'no milk',
    'black': 'no milk',
}

NOTES_MAX = 60


class SignatureError(Exception):
    """Verification failed — reason in str(e). Safe to log (no secrets)."""


def _consttime_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def verify_webhook_signature(secret: str, headers: dict, raw_body: bytes,
                             tolerance_s: int = 300,
                             now: Optional[float] = None,
                             mode: str = 'svix') -> bool:
    """Verify an EA webhook. Raises SignatureError on any failure.

    headers: case-insensitive lookup is the caller's job — pass a dict
    with lowercase keys (Flask: {k.lower(): v for k, v in request.headers}).
    """
    if not secret:
        raise SignatureError('no signing secret configured')
    if not isinstance(raw_body, (bytes, bytearray)):
        raise SignatureError('raw body must be bytes (read before JSON parsing)')

    ts_header = headers.get('webhook-timestamp', '')
    if not ts_header:
        raise SignatureError('missing webhook-timestamp header')
    try:
        ts = float(ts_header)
    except ValueError:
        raise SignatureError('malformed webhook-timestamp header')
    now = time.time() if now is None else now
    if abs(now - ts) > tolerance_s:
        raise SignatureError(
            f'timestamp outside ±{tolerance_s}s replay window')

    sig_header = headers.get('webhook-signature', '')
    if not sig_header:
        raise SignatureError('missing webhook-signature header')

    if mode == 'raw':
        digest = hmac.new(secret.encode(), raw_body, hashlib.sha256)
        candidates = {digest.hexdigest(),
                      base64.b64encode(digest.digest()).decode()}
        provided = sig_header.split(',')[-1].strip()
        if any(_consttime_eq(provided, c) for c in candidates):
            return True
        raise SignatureError('signature mismatch (raw mode)')

    # svix-style (default)
    key = secret
    if key.startswith('whsec_'):
        key = key[len('whsec_'):]
    try:
        key_bytes = base64.b64decode(key)
    except Exception:
        key_bytes = key.encode()
    msg_id = headers.get('webhook-id', '')
    signed_content = f'{msg_id}.{ts_header}.'.encode() + bytes(raw_body)
    expect = base64.b64encode(
        hmac.new(key_bytes, signed_content, hashlib.sha256).digest()).decode()
    for candidate in sig_header.split(' '):
        candidate = candidate.strip()
        if ',' in candidate:
            candidate = candidate.split(',', 1)[1]
        if candidate and _consttime_eq(candidate, expect):
            return True
    raise SignatureError('signature mismatch')


# ---------------------------------------------------------------------------
# answer mapping
# ---------------------------------------------------------------------------

def normalize_phone_e164(phone: str) -> str:
    """AU-first E.164, mirroring coffee_system._normalize_phone."""
    digits = re.sub(r'\D', '', str(phone or ''))
    if not digits:
        return ''
    if digits.startswith('0'):
        return '+61' + digits[1:]
    if digits.startswith('61'):
        return '+' + digits
    return '+' + digits


def _canon_sugar(value: str):
    m = re.search(r'\d+', str(value or ''))
    if not m:
        low = str(value or '').strip().lower()
        if low in ('', 'no', 'none', 'no sugar'):
            return 'no sugar'
        return None
    n = int(m.group())
    if n == 0:
        return 'no sugar'
    return f'{n} sugar' if n == 1 else f'{n} sugars'


def map_answers(question_map: dict, answers: dict):
    """Map EA question answers to CoffeeCue order fields.

    question_map: {ea_question_id: {"field": "drink|milk|sugar|notes",
                                    "options": {ea_value: canon_value}}}
        The per-question "options" dict wins; without it we fall back to
        the built-in canonical tables. Unknown values are ERRORS, never
        guesses — a half-parsed order must not reach a barista.

    answers: {ea_question_id: raw_answer_string}

    Returns (fields, errors). fields has keys coffee_type / milk_type /
    sugar / notes (only the ones present). errors is a list of strings;
    non-empty errors means DO NOT create an order.
    """
    fields, errors = {}, []
    qmap = question_map or {}
    for qid, spec in qmap.items():
        field = (spec or {}).get('field', '')
        raw = answers.get(qid)
        if raw is None or str(raw).strip() == '':
            if field == 'notes':
                continue  # notes are optional
            errors.append(f'missing answer for {field} (question {qid})')
            continue
        raw_s = str(raw).strip()
        options = (spec or {}).get('options') or {}
        # Per-question option map first (exact, then case-insensitive).
        mapped = options.get(raw_s)
        if mapped is None:
            lowered = {str(k).lower(): v for k, v in options.items()}
            mapped = lowered.get(raw_s.lower())

        if field == 'drink':
            value = mapped or CANON_DRINKS.get(raw_s.lower())
            if not value:
                errors.append(f'unknown drink {raw_s!r} (question {qid})')
            else:
                fields['coffee_type'] = value
        elif field == 'milk':
            value = mapped or CANON_MILKS.get(raw_s.lower())
            if not value:
                errors.append(f'unknown milk {raw_s!r} (question {qid})')
            else:
                fields['milk_type'] = value
        elif field == 'sugar':
            value = mapped or _canon_sugar(raw_s)
            if value is None:
                errors.append(f'unparseable sugar {raw_s!r} (question {qid})')
            else:
                fields['sugar'] = value
        elif field == 'notes':
            fields['notes'] = raw_s[:NOTES_MAX]
        else:
            errors.append(f'question {qid} maps to unknown field {field!r}')

    if 'coffee_type' not in fields and not any('drink' in e for e in errors):
        errors.append('question_map has no drink question')
    return fields, errors
