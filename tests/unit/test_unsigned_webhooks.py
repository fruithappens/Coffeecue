"""TESTING_MODE lets webhooks skip their signature check only on a laptop
copy: demo.cupq.app runs TESTING_MODE on the public internet (16 Oct 2026)."""

import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from flask import Flask  # noqa: E402

from auth import unsigned_webhooks_allowed  # noqa: E402

app = Flask(__name__)


def allowed(host, testing="True"):
    with patch.dict(os.environ, {"TESTING_MODE": testing}), \
         app.test_request_context("/sms", headers={"Host": host}):
        return unsigned_webhooks_allowed()


def test_laptop_copy_in_testing_mode_may_skip():
    assert allowed("localhost:5001") and allowed("127.0.0.1:5001")


def test_demo_copy_in_testing_mode_may_not():
    assert not allowed("demo.cupq.app") and not allowed("cupq.app")


def test_never_without_testing_mode():
    assert not allowed("localhost:5001", testing="False")


def test_outside_a_request_fails_closed():
    with patch.dict(os.environ, {"TESTING_MODE": "True"}):
        assert unsigned_webhooks_allowed() is False
