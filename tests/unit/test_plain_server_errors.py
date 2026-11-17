"""A 500 answers with a plain sentence, not the exception text (SEC-026)."""
from unittest.mock import patch

from flask import Flask, jsonify

from services import server_errors


def _client():
    app = Flask(__name__)
    server_errors.install(app)

    @app.route("/api/boom")
    def boom():
        return jsonify(success=False, message='relation "orders" does not exist', error_code="X"), 500

    @app.route("/api/kiosk")
    def kiosk():
        return jsonify(success=False, message="Could not place your order. Please see a barista."), 500

    @app.route("/api/down")
    def down():
        return jsonify(success=False, message="Texts are down for a minute."), 503

    @app.route("/api/bad")
    def bad():
        return jsonify(success=False, message="Type a phone number."), 400

    return app.test_client()


def test_a_500_hides_the_exception_but_keeps_other_fields():
    with patch.object(server_errors, "record"):
        body = _client().get("/api/boom").get_json()
    assert body["message"] == server_errors.PLAIN
    assert body["error_code"] == "X" and body["success"] is False


def test_deliberate_messages_are_left_alone():
    with patch.object(server_errors, "record"):
        c = _client()
        assert c.get("/api/kiosk").get_json()["message"] == "Could not place your order. Please see a barista."
        assert c.get("/api/down").get_json()["message"] == "Texts are down for a minute."
        assert c.get("/api/bad").get_json()["message"] == "Type a phone number."


def test_the_detail_is_still_recorded():
    seen = []
    with patch.object(server_errors, "record", lambda *a, **k: seen.append(a)):
        _client().get("/api/boom")
    import time
    time.sleep(0.2)
    assert seen and 'relation "orders"' in seen[0][3]
