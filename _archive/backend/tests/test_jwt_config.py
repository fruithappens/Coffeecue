# test_jwt_config.py
from flask import Flask
from auth import init_app, generate_tokens
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'testing_secret_key'
app.config['JWT_SECRET_KEY'] = 'testing_jwt_secret_key'

# Initialize JWT
init_app(app)

# Test token generation
with app.app_context():
    user_data = {
        'id': 1,
        'username': 'testuser',
        'email': 'test@example.com',
        'role': 'admin'
    }
    
    tokens = generate_tokens(user_data)
    
    print("Generated tokens:")
    print(f"Access Token: {tokens['access_token'][:20]}...")
    print(f"Refresh Token: {tokens['refresh_token'][:20]}...")
    print(f"Expires in: {tokens['expires_in']} seconds")
    
    # Verify the Flask-JWT-Extended is properly setup
    jwt_manager = app.extensions.get('flask-jwt-extended', None)
    if jwt_manager:
        print("\nJWT Manager is properly initialized")
    else:
        print("\nWARNING: JWT Manager is not initialized!")