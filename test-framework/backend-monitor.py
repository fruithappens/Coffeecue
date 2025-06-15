# Inject into Flask app.py to monitor all database queries and API calls
import functools
import json
import time
import websocket
from flask import g, request

class BackendMonitor:
    def __init__(self, app):
        self.app = app
        self.ws = None
        try:
            self.ws = websocket.WebSocket()
            self.ws.connect("ws://localhost:8081")
        except:
            print("Warning: Test monitor WebSocket not connected")
        
        self.inject_monitoring()
    
    def inject_monitoring(self):
        # Monitor all database queries
        @self.app.before_request
        def before_request():
            g.start_time = time.time()
            g.queries = []
        
        @self.app.after_request
        def after_request(response):
            if hasattr(g, 'queries') and g.queries:
                for query in g.queries:
                    self.log_event({
                        'type': 'db_query',
                        'query': str(query),
                        'duration': time.time() - g.start_time,
                        'endpoint': request.endpoint,
                        'method': request.method,
                        'timestamp': time.time()
                    })
            return response
        
        # Monkey patch psycopg2 to capture queries
        try:
            import psycopg2
            from psycopg2 import extensions
            
            original_execute = extensions.cursor.execute
            
            def monitored_execute(self, query, vars=None):
                if hasattr(g, 'queries'):
                    g.queries.append({
                        'query': query,
                        'params': vars,
                        'timestamp': time.time()
                    })
                return original_execute(self, query, vars)
            
            extensions.cursor.execute = monitored_execute
        except Exception as e:
            print(f"Could not patch psycopg2: {e}")
    
    def log_event(self, event):
        # Send to WebSocket
        if self.ws:
            try:
                self.ws.send(json.dumps(event))
            except:
                pass
        
        # Also log to file
        with open('test-results/backend-monitor.log', 'a') as f:
            f.write(json.dumps(event) + '\n')