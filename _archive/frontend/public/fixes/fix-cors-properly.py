#!/usr/bin/env python3
"""
CORS Fix Script for Expresso Backend

This script fixes CORS issues in app.py by removing duplicate and conflicting
CORS header settings.
"""

import os
import re
import sys
import shutil
import datetime

# ANSI colors for terminal output
class Colors:
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'

def color_print(color, message):
    """Print a colored message to the terminal."""
    print(f"{color}{message}{Colors.ENDC}")

def create_backup(filepath):
    """Create a backup of the file before modifying it."""
    timestamp = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
    backup_path = f"{filepath}.bak.cors.{timestamp}"
    try:
        shutil.copy2(filepath, backup_path)
        color_print(Colors.GREEN, f"Created backup at {backup_path}")
        return backup_path
    except Exception as e:
        color_print(Colors.RED, f"Error creating backup: {e}")
        return None

def read_file(filepath):
    """Read file content."""
    try:
        with open(filepath, 'r') as f:
            return f.read()
    except Exception as e:
        color_print(Colors.RED, f"Error reading {filepath}: {e}")
        return None

def write_file(filepath, content):
    """Write content to file."""
    try:
        with open(filepath, 'w') as f:
            f.write(content)
        color_print(Colors.GREEN, f"Successfully updated {filepath}")
        return True
    except Exception as e:
        color_print(Colors.RED, f"Error writing to {filepath}: {e}")
        return False

def fix_after_request_handler(content):
    """Fix the after_request handler to remove CORS headers."""
    # Pattern to match the after_request handler
    pattern = re.compile(
        r'(@app\.after_request\s*\n'
        r'def after_request\(response\):(?:\s*\n\s*)[^\n]*?Access-Control-Allow-Origin[^\n]*(?:\s*\n\s*)[^\n]*?Access-Control-Allow[^\n]*(?:\s*\n\s*)[^\n]*?Access-Control-Allow[^\n]*(?:\s*\n\s*)[^\n]*?Access-Control-Allow[^\n]*\s*\n)'
        r'(?:\s*\n\s*# Only log.*?\n\s*if.*?\n\s*.*?\n\s*return response\s*\n)',
        re.DOTALL
    )

    # Replacement with CORS headers removed
    replacement = (
        r'@app.after_request\n'
        r'def after_request(response):\n'
        r'    # CORS headers are handled by Flask-CORS extension\n'
        r'    \n'
        r'    # Only log API requests for non-OPTIONS requests to reduce log noise\n'
        r'    if request.method != \'OPTIONS\':\n'
        r'        logger.info(f"Processing response for: {request.path}")\n'
        r'    return response\n'
    )

    # Apply the replacement
    new_content = pattern.sub(replacement, content)
    
    # Check if a replacement was made
    if new_content != content:
        color_print(Colors.GREEN, "Fixed after_request handler")
    else:
        # Try a simpler pattern if the complex one failed
        simple_pattern = re.compile(
            r'(@app\.after_request\s*\n'
            r'def after_request\(response\):.*?Access-Control-Allow-Origin.*?\n)',
            re.DOTALL
        )
        
        new_content = simple_pattern.sub(
            r'@app.after_request\n'
            r'def after_request(response):\n'
            r'    # CORS headers are handled by Flask-CORS extension\n',
            content
        )
        
        if new_content != content:
            color_print(Colors.YELLOW, "Partially fixed after_request handler with simpler pattern")
        else:
            color_print(Colors.YELLOW, "Could not find after_request handler with expected pattern")
            
    return new_content

def fix_other_cors_headers(content):
    """Fix other places where CORS headers are set manually."""
    # Look for direct header settings
    patterns = [
        (
            r"(resp\.headers\['Access-Control-Allow-Origin'\] = '[^']*')\s*\n"
            r"\s*(resp\.headers\['Access-Control-Allow-Methods'\] = '[^']*')\s*\n"
            r"\s*(resp\.headers\['Access-Control-Allow-Headers'\] = '[^']*')",
            
            r"# CORS headers are handled by Flask-CORS extension\n"
            r"    # The following headers are now handled automatically:\n"
            r"    # resp.headers['Access-Control-Allow-Origin'] = '*'\n"
            r"    # resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'\n"
            r"    # resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'"
        ),
        (
            r"(response\.headers\.add\('Access-Control-Allow-Origin', '[^']*'\))",
            r"# CORS headers are handled by Flask-CORS extension\n    # response.headers.add('Access-Control-Allow-Origin', '*')"
        )
    ]
    
    new_content = content
    replacements_made = 0
    
    for pattern, replacement in patterns:
        replaced_content = re.sub(pattern, replacement, new_content)
        if replaced_content != new_content:
            replacements_made += 1
            new_content = replaced_content
    
    if replacements_made > 0:
        color_print(Colors.GREEN, f"Fixed {replacements_made} other occurrences of manual CORS headers")
    else:
        color_print(Colors.YELLOW, "No other occurrences of manual CORS headers found with expected patterns")
    
    return new_content

def restart_server():
    """Attempt to restart the server."""
    color_print(Colors.BLUE, "Attempting to restart the Flask server...")
    
    # Check common server scripts
    if os.path.exists('run_server.py'):
        try:
            # Kill any existing process
            os.system("pkill -f 'python.*run_server.py'")
            # Start a new process
            os.system("nohup python run_server.py > server.log 2>&1 &")
            color_print(Colors.GREEN, "Server restarted using run_server.py")
            return True
        except Exception as e:
            color_print(Colors.RED, f"Error restarting server: {e}")
    
    elif os.path.exists('start.sh'):
        try:
            os.system("./start.sh")
            color_print(Colors.GREEN, "Server restarted using start.sh")
            return True
        except Exception as e:
            color_print(Colors.RED, f"Error restarting server: {e}")
    
    else:
        try:
            # Kill any existing process
            os.system("pkill -f 'python.*app.py'")
            # Start a new process
            os.system("nohup python app.py > server.log 2>&1 &")
            color_print(Colors.GREEN, "Server restarted using app.py directly")
            return True
        except Exception as e:
            color_print(Colors.RED, f"Error restarting server: {e}")
    
    color_print(Colors.YELLOW, "Please restart the server manually")
    return False

def main():
    """Main function to fix CORS issues in app.py."""
    app_py_path = '/Users/stevewf/expresso/app.py'
    
    # Check if the file exists
    if not os.path.exists(app_py_path):
        color_print(Colors.RED, f"Error: {app_py_path} not found")
        return False
    
    # Create a backup
    backup_path = create_backup(app_py_path)
    if not backup_path:
        return False
    
    # Read the file
    content = read_file(app_py_path)
    if not content:
        return False
    
    # Fix CORS issues
    color_print(Colors.BLUE, "Fixing CORS issues in app.py...")
    
    # Fix after_request handler
    modified_content = fix_after_request_handler(content)
    
    # Fix other manual CORS headers
    modified_content = fix_other_cors_headers(modified_content)
    
    # Write the modified content
    if not write_file(app_py_path, modified_content):
        return False
    
    # Restart the server
    restart_server()
    
    color_print(Colors.GREEN, "="*60)
    color_print(Colors.GREEN, "CORS issues have been fixed in app.py")
    color_print(Colors.GREEN, f"A backup was created at {backup_path}")
    color_print(Colors.GREEN, "Please refresh the frontend application to check if the issue is resolved")
    color_print(Colors.GREEN, "="*60)
    
    return True

if __name__ == "__main__":
    color_print(Colors.BOLD + Colors.BLUE, "===== Expresso CORS Fix Tool =====")
    success = main()
    if not success:
        color_print(Colors.RED, "Failed to fix CORS issues")
        sys.exit(1)
    sys.exit(0)