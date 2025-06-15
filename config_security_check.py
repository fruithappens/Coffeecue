#!/usr/bin/env python3
"""
Security configuration validator
Checks for exposed credentials and security misconfigurations
"""
import os
import sys
from pathlib import Path

def check_env_security():
    """Check environment configuration for security issues"""
    issues = []
    warnings = []
    
    # Check if .env exists
    if Path('.env').exists():
        with open('.env', 'r') as f:
            content = f.read()
            
        # Check for exposed Twilio credentials
        if 'AC02d0fa069d8f0c345d97187e15af3f2a' in content:
            issues.append("🚨 CRITICAL: Real Twilio Account SID found in .env!")
        
        if '2d6f169c20be165735554fe978e92e69' in content:
            issues.append("🚨 CRITICAL: Real Twilio Auth Token found in .env!")
            
        # Check for weak secrets
        if 'your_very_long_and_random_secret_key_here' in content:
            issues.append("⚠️  WARNING: Default SECRET_KEY found - not secure!")
            
        if 'your_very_long_and_random_jwt_secret_key_here' in content:
            issues.append("⚠️  WARNING: Default JWT_SECRET_KEY found - not secure!")
            
        # Check debug settings
        if 'DEBUG=True' in content:
            warnings.append("📋 DEBUG mode is enabled - disable for production")
            
        if 'TESTING_MODE=True' in content:
            warnings.append("📋 TESTING_MODE is enabled - disable for production")
            
        # Check CORS
        if 'CORS_ALLOWED_ORIGINS=' in content and '*' in content:
            issues.append("🚨 CRITICAL: CORS allows all origins (*) - security risk!")
    
    # Check environment variables
    env_vars = {
        'TWILIO_ACCOUNT_SID': os.getenv('TWILIO_ACCOUNT_SID'),
        'TWILIO_AUTH_TOKEN': os.getenv('TWILIO_AUTH_TOKEN'),
        'TWILIO_PHONE_NUMBER': os.getenv('TWILIO_PHONE_NUMBER')
    }
    
    print("🔐 Security Configuration Check")
    print("=" * 50)
    
    # Report issues
    if issues:
        print("\n❌ CRITICAL SECURITY ISSUES FOUND:")
        for issue in issues:
            print(f"  {issue}")
    
    if warnings:
        print("\n⚠️  WARNINGS:")
        for warning in warnings:
            print(f"  {warning}")
    
    # Check environment variables
    print("\n📊 Environment Variable Status:")
    for var, value in env_vars.items():
        if value:
            print(f"  ✅ {var}: Set (value hidden)")
        else:
            print(f"  ❌ {var}: Not set")
    
    if not issues and not warnings:
        print("\n✅ No security issues found!")
    else:
        print("\n🔧 Run 'python3 secure_env_setup.py' to fix these issues")
        
    return len(issues) == 0

if __name__ == "__main__":
    is_secure = check_env_security()
    sys.exit(0 if is_secure else 1)