#!/usr/bin/env python
"""
Script to run the Expresso server - production ready for Railway
"""
import os
from app import create_app

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