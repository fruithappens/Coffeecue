#!/usr/bin/env python
"""
Script to run the Expresso server - production ready for Railway
"""
import os
import sys
from app import create_app

# Ensure admin user exists before starting server
try:
    from ensure_admin_user import main as ensure_admin
    ensure_admin()
except Exception as e:
    print(f"Warning: Could not ensure admin user: {e}")

if __name__ == '__main__':
    app, socketio = create_app()
    
    # Get port from environment (Railway sets this)
    port = int(os.environ.get('PORT', 5001))
    host = '0.0.0.0'
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    print(f"🚀 Starting Expresso server on {host}:{port}")
    print(f"🛡️ Security features: ACTIVE")
    print(f"🌐 Environment: {'Development' if debug else 'Production'}")
    
    # Check if socketio is a dummy object (WebSocket disabled)
    if hasattr(socketio, 'run') and socketio.__class__.__name__ == 'DummySocketIO':
        app.run(debug=debug, host=host, port=port)
    else:
        socketio.run(app, debug=debug, host=host, port=port, allow_unsafe_werkzeug=True)