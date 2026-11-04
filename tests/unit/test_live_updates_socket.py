"""Screens can connect, send and leave on the live-update socket.

Flask 3.1 made ctx.session read-only and Flask-SocketIO 5.3.6 still assigned
to it, so every socket event raised (found on demo, 4 Nov 2026) and screens
were left on their regular checks. This fails if the two drift apart again.
"""
from flask import Flask, session
from flask_socketio import SocketIO, emit


def _app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test"
    sio = SocketIO(app, async_mode="threading")
    seen = {}

    @sio.on("connect")
    def on_connect():
        seen["connect"] = True

    @sio.on("join_station")
    def on_join(data):
        session["station"] = data["station"]
        emit("joined", {"station": session["station"]})

    @sio.on("disconnect")
    def on_disconnect():
        seen["disconnect"] = True

    return app, sio, seen


def test_a_screen_connects_sends_and_leaves():
    app, sio, seen = _app()
    client = sio.test_client(app)
    assert client.is_connected()
    client.emit("join_station", {"station": 1})
    assert client.get_received()[-1]["args"][0] == {"station": 1}
    client.disconnect()
    assert seen == {"connect": True, "disconnect": True}
