#!/usr/bin/env python
"""
Script to fix database connection issues by updating the DATABASE_URL environment variable
and ensuring the correct user is used.
"""
import os
import subprocess
import re
import getpass

def get_current_user():
    """Get the current system user"""
    return getpass.getuser()

def find_env_file():
    """Find the .env file in the current directory"""
    if os.path.exists('.env'):
        return '.env'
    elif os.path.exists('.flaskenv'):
        return '.flaskenv'
    else:
        return None

def update_database_url(env_file, new_username):
    """Update the DATABASE_URL in the .env file"""
    if not env_file:
        print("No .env file found, creating a new one")
        env_file = '.env'
    
    # Read existing file if it exists
    if os.path.exists(env_file):
        with open(env_file, 'r') as f:
            lines = f.readlines()
    else:
        lines = []
    
    # Look for DATABASE_URL line
    db_url_pattern = re.compile(r'^DATABASE_URL\s*=\s*(.+)$')
    db_url_line_index = None
    
    for i, line in enumerate(lines):
        match = db_url_pattern.match(line)
        if match:
            db_url_line_index = i
            old_url = match.group(1).strip()
            
            # Update URL with new username
            if 'postgres://' in old_url:
                parts = old_url.split('@')
                auth_part = parts[0].replace('postgres://', '')
                
                # Check if there's a username/password
                if ':' in auth_part:
                    _, password = auth_part.split(':', 1)
                    new_auth = f"postgres://{new_username}:{password}"
                else:
                    new_auth = f"postgres://{new_username}"
                
                new_url = new_auth + '@' + parts[1]
            else:
                # If no URL exists, create a default
                new_url = f"postgres://{new_username}:@localhost:5432/expresso"
            
            lines[i] = f"DATABASE_URL={new_url}\n"
            break
    
    # If no DATABASE_URL found, add it
    if db_url_line_index is None:
        lines.append(f"DATABASE_URL=postgres://{new_username}:@localhost:5432/expresso\n")
    
    # Write back to file
    with open(env_file, 'w') as f:
        f.writelines(lines)
    
    return env_file

def print_postgresql_info():
    """Print PostgreSQL configuration information"""
    print("\nChecking PostgreSQL configuration:")
    
    try:
        # Check if psql is available
        subprocess.run(['which', 'psql'], check=True, capture_output=True)
        
        # Get PostgreSQL version
        version_proc = subprocess.run(['psql', '--version'], capture_output=True, text=True)
        if version_proc.returncode == 0:
            print(f"PostgreSQL client: {version_proc.stdout.strip()}")
        
        # Try to connect to PostgreSQL and list databases
        list_db_proc = subprocess.run(
            ['psql', '-l'], 
            capture_output=True, 
            text=True
        )
        
        if list_db_proc.returncode == 0:
            print("Successfully connected to PostgreSQL")
            print("\nAvailable databases:")
            print(list_db_proc.stdout)
        else:
            print("Could not list PostgreSQL databases")
            print(f"Error: {list_db_proc.stderr}")
    except subprocess.CalledProcessError:
        print("PostgreSQL client (psql) not found or not working")
    except Exception as e:
        print(f"Error checking PostgreSQL: {e}")

def main():
    """Main function to fix database connection"""
    print("Expresso Coffee System - Database Connection Fixer")
    print("=" * 50)
    
    # Get current username
    current_user = get_current_user()
    print(f"Current system user: {current_user}")
    
    # Find .env file
    env_file = find_env_file()
    print(f"Found environment file: {env_file or 'None'}")
    
    # Update DATABASE_URL
    updated_file = update_database_url(env_file, current_user)
    print(f"Updated DATABASE_URL in {updated_file} to use username: {current_user}")
    
    # Print PostgreSQL info
    print_postgresql_info()
    
    print("\nYou should now be able to run:")
    print("  python load_test_data.py --force")
    print("  python run_server.py")

if __name__ == "__main__":
    main()