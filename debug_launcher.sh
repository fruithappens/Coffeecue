#!/bin/bash

# Debug version of Coffee Cue Launcher
echo "🔍 Coffee Cue Launcher Debug Mode"
echo "=================================="

# Check directory
EXPRESSO_PATH="/Users/stevewf/expresso"
echo "📁 Checking directory: $EXPRESSO_PATH"
if [ ! -d "$EXPRESSO_PATH" ]; then
    echo "❌ Directory not found!"
    exit 1
else
    echo "✅ Directory exists"
fi

cd "$EXPRESSO_PATH"

# Check PostgreSQL
echo "🗄️  Checking PostgreSQL..."
if pgrep -x postgres > /dev/null; then
    echo "✅ PostgreSQL is running"
else
    echo "⚠️  PostgreSQL not running - would start it"
fi

# Check database
echo "🏗️  Checking expresso database..."
if psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw expresso; then
    echo "✅ Database exists"
else
    echo "⚠️  Database doesn't exist - would create it"
fi

# Check migration status
echo "🔄 Checking migration system..."
if psql -d expresso -c "SELECT 1 FROM information_schema.tables WHERE table_name = 'event_inventory'" 2>/dev/null | grep -q "1"; then
    echo "✅ Migration system is set up"
    MIGRATION_NEEDED=false
else
    echo "⚠️  Migration system needs initialization"
    MIGRATION_NEEDED=true
fi

# Check startup scripts
echo "📜 Checking startup scripts..."
if [ -f "start_expresso_enhanced.sh" ]; then
    echo "✅ Enhanced startup script found"
else
    echo "⚠️  Enhanced startup script missing"
fi

if [ -f "start_expresso.sh" ]; then
    echo "✅ Standard startup script found"
else
    echo "❌ Standard startup script missing"
fi

# Simulate what the launcher would do
echo ""
echo "🎯 Launcher would do:"
if [ "$MIGRATION_NEEDED" = true ]; then
    echo "1. Show migration dialog (Initialize, Standard, Cancel)"
    echo "2. If Initialize: Start migration system"
    echo "3. If Standard: Run enhanced startup"
else
    echo "1. Show startup dialog (Quick Start, Enhanced Setup, Cancel)"
    echo "2. Launch selected option in Terminal"
fi

echo ""
echo "🚀 To test manually, try:"
echo "   ./start_expresso.sh"
echo "   or"
echo "   ./start_expresso_enhanced.sh"