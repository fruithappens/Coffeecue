#!/usr/bin/env python
"""
Script to run the Expresso server with debug mode enabled
"""
from app import create_app

if __name__ == '__main__':
    app, socketio = create_app()
    print("Starting Expresso server on http://localhost:5001")
    print("Press CTRL+C to stop the server")
    socketio.run(app, debug=True, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)