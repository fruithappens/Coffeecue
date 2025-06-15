#!/bin/bash

# Stop all running servers
echo "Stopping all running servers..."
pkill -f "run_server.py"
sleep 2

# Create CORS fix
cat > /Users/stevewf/expresso/fix_app_cors.py << 'EOL'
#!/usr/bin/env python3
import re
import time

def fix_cors():
    # Path to app.py file
    app_py_path = '/Users/stevewf/expresso/app.py'
    
    # Read the content of app.py
    with open(app_py_path, 'r') as file:
        content = file.read()

    # Make a backup
    with open(f"{app_py_path}.bak.cors.{int(time.time())}", 'w') as file:
        file.write(content)
    
    # Add or update CORS configuration
    cors_pattern = r"CORS\(app,.*?\)"
    cors_replacement = "CORS(app, resources={r\"/*\": {\"origins\": [\"http://localhost:3001\", \"http://localhost:3000\", \"http://localhost:3002\"], \"supports_credentials\": True}})"
    
    if re.search(cors_pattern, content):
        # Update existing CORS config
        content = re.sub(cors_pattern, cors_replacement, content)
    else:
        # Add CORS config after app initialization if not already there
        app_init_pattern = r"app = Flask\(__name__\)(.*?)app\.secret_key"
        content = re.sub(app_init_pattern, f"app = Flask(__name__)\\1\n# Initialize CORS\n{cors_replacement}\n\napp.secret_key", content)
    
    # Write back the modified content
    with open(app_py_path, 'w') as file:
        file.write(content)
    
    print(f"CORS configuration updated in {app_py_path}")

if __name__ == "__main__":
    fix_cors()
EOL

# Make the script executable
chmod +x /Users/stevewf/expresso/fix_app_cors.py

# Run the CORS fix
echo "Applying CORS fix..."
python3 /Users/stevewf/expresso/fix_app_cors.py

# Start the server
echo "Starting the server..."
cd /Users/stevewf/expresso
python3 run_server.py