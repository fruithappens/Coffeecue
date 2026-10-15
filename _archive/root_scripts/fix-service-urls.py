#!/usr/bin/env python3
"""
Fix service URLs to use proxy instead of direct backend URLs
"""

import os
import re

services_dir = "/Users/stevewf/expresso/Barista Front End/src/services"

files_to_fix = [
    "ApiService.js",
    "ChatService.js", 
    "MessageService.js",
    "ScheduleService.js",
    "SettingsService.js",
    "StationsService.js"
]

for filename in files_to_fix:
    filepath = os.path.join(services_dir, filename)
    if os.path.exists(filepath):
        print(f"Fixing {filename}...")
        
        with open(filepath, 'r') as f:
            content = f.read()
        
        # Replace direct backend URLs with proxy URLs
        content = re.sub(r'http://localhost:5001/api', '/api', content)
        content = re.sub(r"'http://localhost:5001/api'", "'/api'", content)
        content = re.sub(r'"http://localhost:5001/api"', '"/api"', content)
        
        # Also fix any baseUrl assignments
        content = re.sub(r'this\.baseUrl\s*=\s*["\']http://localhost:5001/api["\']', "this.baseUrl = '/api'", content)
        
        with open(filepath, 'w') as f:
            f.write(content)
        
        print(f"✅ Fixed {filename}")
    else:
        print(f"❌ File not found: {filename}")

print("All service URL fixes complete!")