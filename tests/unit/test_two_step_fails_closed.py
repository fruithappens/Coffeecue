"""A database problem during the two-step check refuses the login (SEC-016).

It used to let the password alone through, so someone with only the password
could get past two-step during a pool exhaustion or a database blip.
"""
from unittest.mock import patch

from routes.two_step_routes import login_check


class _Missing(Exception):
    pgcode = "42703"  # undefined_column


def _boom(exc):
    def connect():
        raise exc
    return connect


def test_a_database_blip_refuses_the_login():
    with patch("utils.database.get_db_connection", _boom(RuntimeError("pool exhausted"))):
        assert login_check(7, None)


def test_a_copy_without_the_columns_yet_still_lets_the_password_through():
    with patch("utils.database.get_db_connection", _boom(_Missing("column totp_secret does not exist"))):
        assert login_check(7, None) is None
