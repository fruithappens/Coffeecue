"""Gunicorn settings, read from the environment in PYTHON, not the shell.

WHY A CONFIG FILE AND NOT FLAGS
The first attempt put `--bind 0.0.0.0:${PORT:-5001}` in the start command.
Railway does NOT run startCommand through a shell, so `${PORT}` arrived at
gunicorn as the literal string and every boot died with:

    Error: '${PORT' is not a valid port number.

The container crash-looped and production was down until this landed.
Reading the environment here removes the shell from the picture entirely,
so the same command works under Railway, Docker and a bare terminal alike.
"""
import os

bind = f"0.0.0.0:{os.environ.get('PORT', '5001')}"

# eventlet worker: the app uses Flask-SocketIO with async_mode='eventlet',
# and this worker monkey-patches before loading the app.
worker_class = "eventlet"

# ONE worker on purpose. SocketIO has no Redis message queue configured, so
# with more than one worker an event emitted in one process would never
# reach clients connected to another — broadcasts would silently half-work.
workers = 1

timeout = 120
graceful_timeout = 30
keepalive = 5
accesslog = "-"
