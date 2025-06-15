#!/bin/bash

# Simple test launcher to verify Terminal windows work
echo "🧪 Testing Coffee Cue Launcher..."

# Test opening a Terminal window
osascript -e 'tell application "Terminal"
    do script "cd '"/Users/stevewf/expresso"' && echo \"✅ Coffee Cue Launcher Test - Terminal window working!\" && echo \"🚀 This would normally start the Coffee Cue system\" && echo \"Press CTRL+C to close\""
    set custom title of front window to "Coffee Cue - Test Window"
    activate
end tell'

echo "✅ Test completed - Terminal window should have opened"