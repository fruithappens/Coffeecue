"""Authenticator codes match the RFC 6238 test vectors and reject the rest."""
import base64

from services import totp

# RFC 6238 appendix B, SHA-1, secret "12345678901234567890"
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()


def test_rfc_6238_vectors():
    # The RFC lists 8-digit codes; ours are the last 6 of each.
    for t, expected8 in [
        (59, "94287082"),
        (1111111109, "07081804"),
        (1111111111, "14050471"),
        (1234567890, "89005924"),
        (2000000000, "69279037"),
    ]:
        assert totp.code_at(RFC_SECRET, t) == expected8[-6:]


def test_verify_accepts_now_and_a_step_either_side_only():
    s = totp.new_secret()
    t = 1_700_000_000
    assert totp.verify(s, totp.code_at(s, t), at=t)
    assert totp.verify(s, totp.code_at(s, t - 30), at=t)
    assert totp.verify(s, totp.code_at(s, t + 30), at=t)
    assert not totp.verify(s, totp.code_at(s, t - 90), at=t)


def test_rubbish_is_refused():
    s = totp.new_secret()
    for bad in ("", None, "12345", "1234567", "abcdef"):
        assert not totp.verify(s, bad)
    assert not totp.verify("", "123456")


def test_spaces_in_a_typed_code_are_fine():
    s = totp.new_secret()
    t = 1_700_000_000
    c = totp.code_at(s, t)
    assert totp.verify(s, f"{c[:3]} {c[3:]}", at=t)


def test_qr_contents():
    uri = totp.otpauth_uri("ABC", "steve")
    assert uri.startswith("otpauth://totp/CupQ%3Asteve?secret=ABC&issuer=CupQ")
