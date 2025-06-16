#!/usr/bin/env python3
"""
Script to update CORS configuration for Railway deployment
"""

import os

def update_cors_for_railway():
    """Update CORS settings to include Railway domain"""
    
    # Get Railway domain from environment
    railway_domain = os.getenv('RAILWAY_STATIC_URL', '').replace('https://', '')
    
    if not railway_domain:
        print("WARNING: RAILWAY_STATIC_URL not set, CORS might not work properly")
        return
    
    # Read current .env file
    env_path = '.env'
    with open(env_path, 'r') as f:
        lines = f.readlines()
    
    # Update CORS_ALLOWED_ORIGINS
    updated = False
    for i, line in enumerate(lines):
        if line.startswith('CORS_ALLOWED_ORIGINS='):
            current_origins = line.strip().split('=', 1)[1]
            railway_origin = f"https://{railway_domain}"
            
            if railway_origin not in current_origins:
                # Add Railway domain to allowed origins
                new_origins = f"{current_origins},{railway_origin}"
                lines[i] = f"CORS_ALLOWED_ORIGINS={new_origins}\n"
                updated = True
                print(f"Added {railway_origin} to CORS_ALLOWED_ORIGINS")
            break
    
    if updated:
        with open(env_path, 'w') as f:
            f.writelines(lines)
        print("✅ CORS configuration updated for Railway")
    else:
        print("ℹ️  CORS already configured for Railway")

if __name__ == "__main__":
    update_cors_for_railway()