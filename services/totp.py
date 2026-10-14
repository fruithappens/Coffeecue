"""Authenticator-app codes (TOTP, RFC 6238) for admin logins (roadmap X7-3).

Standard 6-digit, 30-second codes, the kind Google Authenticator, Microsoft
Authenticator, 1Password and Apple Passwords all produce. Standard library
only: it is about thirty lines, and a login dependency is one more thing to
keep patched.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6


def new_secret():
    """A fresh 160-bit secret, base32 (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret):
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def code_at(secret, at=None):
    counter = int((time.time() if at is None else at) // STEP)
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**DIGITS)).zfill(DIGITS)


def verify(secret, code, at=None, window=1):
    """True if `code` matches now, or one step either side (phone clocks
    drift, and people type slowly)."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if not secret or len(code) != DIGITS:
        return False
    now = time.time() if at is None else at
    return any(
        hmac.compare_digest(code_at(secret, now + i * STEP), code)
        for i in range(-window, window + 1)
    )


def otpauth_uri(secret, username, issuer="CupQ"):
    """What the QR code holds: the app reads the secret, account and issuer."""
    label = quote(f"{issuer}:{username}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&digits={DIGITS}&period={STEP}"
