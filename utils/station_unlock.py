"""Turning the ordering iPad into a barista station, behind a code.

Steve: "Behind an unlock code, so a spare device becomes the backup if
the main one dies. Right now a single failure has no fallback."

The thing to be careful about is what this actually is. The ordering
iPad sits unattended on a stand in a public foyer, and this feature
gives that device a path to a barista session -- order names, phone
numbers, the ability to mark drinks collected. So the code is not a
client-side check that hides a button; anyone can read the JavaScript
and find the button. It is verified on the server, which mints the
session, and it is off until somebody deliberately sets a code.

Three things keep a six-digit secret on a public device honest:

  1. The code has to be non-trivial. 111111 and 123456 are the first
     two guesses anyone makes, so they are refused at the point the
     code is SET, where a person can pick another one, rather than
     left to fail later when it matters.
  2. Failures are throttled. Six digits is a million combinations,
     which is nothing to a script and a great deal to a person typing
     on an iPad -- so the defence is making it be a person.
  3. It is stored hashed. A settings blob gets exported, backed up and
     pasted into support threads; the code should not travel with it.
"""

import hmac
import re
from datetime import datetime, timedelta, timezone

# THE CODE HAS TO CARRY THIS ON ITS OWN.
#
# The first design threw in a global failure lock as well, so that an
# attacker rotating their device id could not just keep guessing. It
# worked, and it was worse: five wrong guesses locked out EVERY device
# for fifteen minutes, which handed anyone in the room a way to disable
# the backup barista station on purpose. The fallback exists for the
# moment things have already gone wrong, so a stranger being able to
# switch it off is a bigger problem than slow guessing.
#
# So there is no global lock, and instead the secret is made strong
# enough not to need one. Eight mixed characters is about 2.8e12
# combinations: at ten guesses a second that is thousands of years, and
# it is still one short word a barista can type on an iPad. All-digit
# codes get a longer minimum because ten symbols is a much smaller
# alphabet than thirty-six.
MIN_CODE_LENGTH = 8
MIN_DIGIT_ONLY_LENGTH = 10
MAX_CODE_LENGTH = 32

# Per DEVICE only. This stops someone picking up the iPad and trying the
# obvious codes; it is not what stops a script, because a script can
# change its device id at will. The code length above is what stops the
# script.
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15
ATTEMPT_WINDOW_MINUTES = 15

SETTING_KEY = "station_unlock"
ATTEMPTS_KEY = "station_unlock_attempts"

# Codes people reach for first, and which therefore protect nothing.
_TRIVIAL = {
    "000000",
    "111111",
    "222222",
    "333333",
    "444444",
    "555555",
    "666666",
    "777777",
    "888888",
    "999999",
    "123456",
    "654321",
    "abcdef",
    "password",
    "letmein",
    "coffee",
    "barista",
}


def normalise(code):
    """Trim and collapse the spaces people type into a code field.

    An operator reading a code off a card says it in pairs and often
    types it that way. '123 456' and '123456' should not be different
    secrets -- that failure looks exactly like a wrong code.
    """
    return re.sub(r"\s+", "", str(code or ""))


def validate_new_code(code):
    """Is this acceptable as a NEW code? Returns (ok, message).

    Checked when the code is SET rather than when it is used, because
    that is the only moment a human is present who can choose a better
    one.
    """
    clean = normalise(code)
    if not clean:
        return False, "Enter a code."
    if len(clean) < MIN_CODE_LENGTH:
        return False, f"Use at least {MIN_CODE_LENGTH} characters."
    if clean.isdigit() and len(clean) < MIN_DIGIT_ONLY_LENGTH:
        return False, (
            f"Digits only needs {MIN_DIGIT_ONLY_LENGTH} of them - "
            f"or use {MIN_CODE_LENGTH} with a letter in it."
        )
    if len(clean) > MAX_CODE_LENGTH:
        return False, f"Keep it under {MAX_CODE_LENGTH} characters."
    if clean.lower() in _TRIVIAL:
        return False, "That is one of the first codes anyone would guess. Pick another."
    if len(set(clean)) == 1:
        return False, "All the same character is too easy to guess."
    if clean.isdigit() and _is_run(clean):
        return False, "Straight runs of digits are too easy to guess."
    return True, ""


def _is_run(digits):
    """123456 or 654321, in any length."""
    steps = {int(b) - int(a) for a, b in zip(digits, digits[1:])}
    return steps in ({1}, {-1})


def hash_code(code):
    """Hash a code for storage. Uses the same primitive as passwords."""
    from werkzeug.security import generate_password_hash

    return generate_password_hash(normalise(code))


def verify_code(code, stored_hash):
    """Constant-time-ish check of a submitted code against the stored hash.

    Returns False for anything malformed rather than raising: a broken
    setting must read as "wrong code", never as an unlocked door and
    never as a 500 that tells an attacker they found something.
    """
    clean = normalise(code)
    if not clean or not stored_hash:
        return False
    try:
        from werkzeug.security import check_password_hash

        return bool(check_password_hash(str(stored_hash), clean))
    except Exception:
        return False


def constant_time_equals(a, b):
    """For comparing non-secret tokens without leaking length by timing."""
    return hmac.compare_digest(str(a or ""), str(b or ""))


def _parse(ts):
    try:
        parsed = datetime.fromisoformat(str(ts))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def recent_failures(attempts, now=None):
    """Failure timestamps still inside the throttle window.

    Unparseable entries are DROPPED rather than counted. A corrupted
    attempt log should not be able to lock a real barista out of the
    fallback device during the exact incident the fallback exists for.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=ATTEMPT_WINDOW_MINUTES)
    # Anything that is not a list of entries is not an attempt log. A
    # bare string would iterate character by character and an int would
    # raise outright, and BOTH of those happen inside the unlock
    # endpoint -- at the moment the main device has already failed.
    if not isinstance(attempts, (list, tuple)):
        return []
    out = []
    for entry in attempts:
        when = _parse(entry)
        if when and when >= cutoff:
            out.append(when)
    return sorted(out)


def lockout_remaining(attempts, now=None):
    """Seconds until unlocking may be tried again. 0 means go ahead.

    Locks out only while the failures are still recent, so a device that
    was locked at breakfast is usable again by morning tea without
    anyone clearing anything.
    """
    now = now or datetime.now(timezone.utc)
    recent = recent_failures(attempts, now)
    if len(recent) < MAX_ATTEMPTS:
        return 0
    unlock_at = recent[-1] + timedelta(minutes=LOCKOUT_MINUTES)
    return max(0, int((unlock_at - now).total_seconds()))


def record_failure(attempts, now=None):
    """The attempt log with this failure added and stale entries pruned.

    Pruning here keeps the stored list from growing forever without a
    separate cleanup job.
    """
    now = now or datetime.now(timezone.utc)
    kept = recent_failures(attempts, now)
    kept.append(now)
    return [w.isoformat() for w in kept[-(MAX_ATTEMPTS * 2) :]]


def is_enabled(setting):
    """Is the fallback actually available?

    Requires BOTH the switch and a stored hash. A setting that says
    enabled but holds no code would otherwise be an unlock endpoint that
    accepts anything, which is the worst possible reading of "on".
    """
    if not isinstance(setting, dict):
        return False
    return bool(setting.get("enabled")) and bool(setting.get("code_hash"))
