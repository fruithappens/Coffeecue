#!/usr/bin/env python3
"""
Quick script to verify build status and identify issues
"""
import os
import json
from datetime import datetime

print("🔍 EXPRESSO BUILD STATUS VERIFICATION")
print("=" * 50)

# Check if we're in the right directory
if not os.path.exists("Barista Front End"):
    print("❌ Error: Not in expresso directory")
    exit(1)

# Check last build time
static_main_js = None
for root, dirs, files in os.walk("static"):
    for file in files:
        if file.startswith("main.") and file.endswith(".js"):
            static_main_js = os.path.join(root, file)
            break

if static_main_js:
    build_time = datetime.fromtimestamp(os.path.getmtime(static_main_js))
    print(f"📦 Production build last updated: {build_time}")
    print(f"   ({(datetime.now() - build_time).days} days ago)")
else:
    print("❌ No production build found in /static")

# Check source file modification
menu_mgmt = "Barista Front End/src/components/MenuManagement.js"
if os.path.exists(menu_mgmt):
    src_time = datetime.fromtimestamp(os.path.getmtime(menu_mgmt))
    print(f"\n📝 MenuManagement.js last modified: {src_time}")
    
    if static_main_js and src_time > build_time:
        print("\n⚠️  SOURCE FILES NEWER THAN BUILD!")
        print("   Your changes aren't in the production build!")
        print("\n🔧 To fix, run:")
        print('   cd "Barista Front End" && npm run build')
else:
    print("❌ MenuManagement.js not found")

# Check which files are being served
print("\n📋 Current Setup:")
print(f"   Backend URL: http://localhost:5001 (serves from /static)")
print(f"   Dev URL: http://localhost:3000 (live reload)")

print("\n💡 RECOMMENDATION:")
if static_main_js and os.path.exists(menu_mgmt) and src_time > build_time:
    print("   You need to rebuild! Run:")
    print('   cd "Barista Front End" && npm run build')
else:
    print("   Try using development mode:")
    print('   cd "Barista Front End" && npm start')
    print("   Then go to http://localhost:3000")

print("\n" + "=" * 50)