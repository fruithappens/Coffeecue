"""Boot never resets an existing admin, and a server never gets a built-in password.

ensure_admin_user used to delete and recreate the admin on every boot with
DEFAULT_ADMIN_PASSWORD or 'adminpassword', so cupq.app's admin went back to
a password printed in the public repo at every deploy.
"""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import ensure_admin_user as e  # noqa: E402

ENV = {"DATABASE_URL": "postgres://x/y"}


def _boot(exists, env, capsys):
    with patch.dict(os.environ, {**ENV, **env}, clear=True), \
         patch.object(e, "_exists", return_value=exists), \
         patch("create_admin.create_admin", return_value=True) as create:
        e.main()
    return create, capsys.readouterr().out


def test_existing_admin_is_never_touched(capsys):
    create, out = _boot((True, True), {"RAILWAY_ENVIRONMENT": "production",
                                       "DEFAULT_ADMIN_PASSWORD": "whatever"}, capsys)
    create.assert_not_called()
    assert "left as it is" in out


def test_server_without_password_gets_a_random_one(capsys):
    create, out = _boot((False, False), {"RAILWAY_ENVIRONMENT": "production"}, capsys)
    args = create.call_args[0]
    password, force = args[3], create.call_args[1].get("force", args[4] if len(args) > 4 else None)
    assert password not in ("adminpassword", "coffee123")
    assert len(password) >= 12
    assert force is False
    assert "FIRST ADMIN LOGIN" in out


def test_server_with_password_setting_uses_it(capsys):
    create, _ = _boot((False, False), {"RAILWAY_ENVIRONMENT": "production",
                                       "DEFAULT_ADMIN_PASSWORD": "Set-By-Steve-1"}, capsys)
    assert create.call_args[0][3] == "Set-By-Steve-1"


def test_laptop_keeps_the_local_test_login(capsys):
    create, _ = _boot((False, False), {}, capsys)
    assert create.call_args[0][3] == "adminpassword"


def test_email_taken_by_someone_else_creates_nothing(capsys):
    create, out = _boot((False, True), {"RAILWAY_ENVIRONMENT": "production"}, capsys)
    create.assert_not_called()
    assert "belongs to another user" in out
