"""One password rule for every place a password is set (audit SEC-025).

Before this only the emailed reset asked for 8 characters; People, Quick
Setup and the support tools took anything, even one letter.
"""

MIN_PASSWORD = 8


def password_problem(password):
    """The message to show, or None if the password is acceptable."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        return f"Use at least {MIN_PASSWORD} characters for the password."
    return None
