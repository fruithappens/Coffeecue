"""EA Survey Channel — pre-credentials unit tests (spec §9).

Covers the pure logic with no Flask/DB/EA dependency:
  - signature: valid passes, tampered body fails, stale timestamp fails
  - answer mapping: happy path, malformed answers → errors (never a
    half-parsed order), notes truncation, sugar/milk/drink canon
  - phone normalisation

Run:  venv/bin/python tests/unit/test_ea_survey.py   (or pytest)
"""
import base64
import hashlib
import hmac
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from services.eventsair.survey import (SignatureError, map_answers,  # noqa: E402
                                       normalize_phone_e164,
                                       verify_webhook_signature)

PASS = FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn()
        PASS += 1
        print(f"PASS {name}")
    except AssertionError as e:
        FAIL += 1
        print(f"FAIL {name}: {e}")


def _svix_headers(secret_b64_key: bytes, body: bytes, ts=None, msg_id='msg_1'):
    ts = str(int(time.time()) if ts is None else ts)
    sig = base64.b64encode(hmac.new(
        secret_b64_key, f'{msg_id}.{ts}.'.encode() + body,
        hashlib.sha256).digest()).decode()
    return {'webhook-id': msg_id, 'webhook-timestamp': ts,
            'webhook-signature': f'v1,{sig}'}


def test_signature_valid():
    key = os.urandom(24)
    secret = 'whsec_' + base64.b64encode(key).decode()
    body = b'{"correlationId":"abc","surveyResponseId":"r1"}'
    assert verify_webhook_signature(secret, _svix_headers(key, body), body)


def test_signature_tampered_body():
    key = os.urandom(24)
    secret = 'whsec_' + base64.b64encode(key).decode()
    body = b'{"correlationId":"abc"}'
    headers = _svix_headers(key, body)
    try:
        verify_webhook_signature(secret, headers, b'{"correlationId":"EVIL"}')
        raise AssertionError('tampered body accepted')
    except SignatureError:
        pass


def test_signature_stale_timestamp():
    key = os.urandom(24)
    secret = 'whsec_' + base64.b64encode(key).decode()
    body = b'{}'
    headers = _svix_headers(key, body, ts=int(time.time()) - 3600)
    try:
        verify_webhook_signature(secret, headers, body, tolerance_s=300)
        raise AssertionError('hour-old timestamp accepted')
    except SignatureError as e:
        assert 'replay window' in str(e), f'wrong error: {e}'


def test_signature_missing_headers():
    for headers in ({}, {'webhook-timestamp': str(int(time.time()))}):
        try:
            verify_webhook_signature('whsec_' + base64.b64encode(b'x' * 24).decode(),
                                     headers, b'{}')
            raise AssertionError('missing headers accepted')
        except SignatureError:
            pass


def test_signature_no_secret():
    try:
        verify_webhook_signature('', {'webhook-timestamp': '1'}, b'{}')
        raise AssertionError('empty secret accepted')
    except SignatureError:
        pass


def test_signature_raw_mode():
    secret = 'plain-shared-secret'
    body = b'{"x":1}'
    hexsig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    headers = {'webhook-timestamp': str(int(time.time())),
               'webhook-signature': hexsig}
    assert verify_webhook_signature(secret, headers, body, mode='raw')
    headers['webhook-signature'] = 'deadbeef'
    try:
        verify_webhook_signature(secret, headers, body, mode='raw')
        raise AssertionError('bad raw signature accepted')
    except SignatureError:
        pass


QMAP = {
    'q1': {'field': 'drink'},
    'q2': {'field': 'milk'},
    'q3': {'field': 'sugar'},
    'q4': {'field': 'notes'},
}


def test_map_happy_path():
    fields, errors = map_answers(QMAP, {
        'q1': 'Flat White', 'q2': 'Oat', 'q3': '2', 'q4': 'extra hot pls'})
    assert not errors, errors
    assert fields == {'coffee_type': 'flat white', 'milk_type': 'oat',
                      'sugar': '2 sugars', 'notes': 'extra hot pls'}, fields


def test_map_option_table_wins():
    qmap = {'q1': {'field': 'drink',
                   'options': {'House Blend': 'long black'}}}
    fields, errors = map_answers(qmap, {'q1': 'House Blend'})
    assert not errors and fields['coffee_type'] == 'long black', (fields, errors)


def test_map_unknown_drink_is_error_not_guess():
    fields, errors = map_answers(QMAP, {
        'q1': 'Pumpkin Spice Ristretto', 'q2': 'Oat', 'q3': '1'})
    assert errors, 'unknown drink silently accepted'
    assert 'coffee_type' not in fields


def test_map_missing_required_answer():
    _fields, errors = map_answers(QMAP, {'q2': 'Skim', 'q3': '0'})
    assert any('drink' in e for e in errors), errors


def test_map_none_milk_and_zero_sugar():
    fields, errors = map_answers(QMAP, {'q1': 'Long Black', 'q2': 'None',
                                        'q3': '0'})
    assert not errors, errors
    assert fields['milk_type'] == 'no milk' and fields['sugar'] == 'no sugar', fields


def test_map_notes_truncated_to_60():
    fields, errors = map_answers(QMAP, {'q1': 'Latte', 'q2': 'Skim',
                                        'q3': '1', 'q4': 'x' * 200})
    assert not errors and len(fields['notes']) == 60, (errors, len(fields.get('notes', '')))


def test_map_notes_optional():
    _fields, errors = map_answers(QMAP, {'q1': 'Latte', 'q2': 'Skim', 'q3': '1'})
    assert not errors, errors


def test_map_empty_map_is_error():
    _fields, errors = map_answers({}, {'q1': 'Latte'})
    assert errors, 'empty question_map produced no error'


def test_phone_e164():
    assert normalize_phone_e164('0412 693 279') == '+61412693279'
    assert normalize_phone_e164('+61412693279') == '+61412693279'
    assert normalize_phone_e164('61412693279') == '+61412693279'
    assert normalize_phone_e164('') == ''
    assert normalize_phone_e164(None) == ''


if __name__ == '__main__':
    for name, fn in sorted(list(globals().items())):
        if name.startswith('test_') and callable(fn):
            check(name, fn)
    print(f"\n{PASS} pass / {FAIL} fail")
    sys.exit(1 if FAIL else 0)
