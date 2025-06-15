#!/bin/bash
# Script to aggressively clean up the public directory

# Create target directories if they don't exist
mkdir -p _archive/frontend/public/auth
mkdir -p _archive/frontend/public/fixes
mkdir -p _archive/frontend/public/tests
mkdir -p _archive/frontend/public/fallback
mkdir -p _archive/frontend/public/direct
mkdir -p _archive/frontend/public/connection
mkdir -p _archive/frontend/public/utils

# Moving auth related files (aggressively)
echo "Archiving authentication related files..."
cd "Barista Front End/public"
find . -type f -name "*auth*" -exec mv {} ../../_archive/frontend/public/auth/ \;
find . -type f -name "*login*" -exec mv {} ../../_archive/frontend/public/auth/ \;
find . -type f -name "*jwt*" -exec mv {} ../../_archive/frontend/public/auth/ \;
find . -type f -name "*token*" -exec mv {} ../../_archive/frontend/public/auth/ \;

# Moving fix/debug related files (aggressively)
echo "Archiving fix-related files..."
find . -type f -name "*fix*" -exec mv {} ../../_archive/frontend/public/fixes/ \;
find . -type f -name "*debug*" -exec mv {} ../../_archive/frontend/public/fixes/ \;
find . -type f -name "*reset*" -exec mv {} ../../_archive/frontend/public/fixes/ \;
find . -type f -name "*solution*" -exec mv {} ../../_archive/frontend/public/fixes/ \;
find . -type f -name "*emergency*" -exec mv {} ../../_archive/frontend/public/fixes/ \;

# Moving test files
echo "Archiving test files..."
find . -type f -name "*test*" -exec mv {} ../../_archive/frontend/public/tests/ \;
find . -type f -name "*api-*" -exec mv {} ../../_archive/frontend/public/tests/ \;
find . -type f -name "*diag*" -exec mv {} ../../_archive/frontend/public/tests/ \;

# Moving fallback/offline mode files
echo "Archiving fallback mode files..."
find . -type f -name "*fallback*" -exec mv {} ../../_archive/frontend/public/fallback/ \;
find . -type f -name "*offline*" -exec mv {} ../../_archive/frontend/public/fallback/ \;

# Moving direct and connection files
echo "Archiving connection related files..."
find . -type f -name "*direct*" -exec mv {} ../../_archive/frontend/public/direct/ \;
find . -type f -name "*connection*" -exec mv {} ../../_archive/frontend/public/connection/ \;

# Count remaining files
echo "Files remaining in public directory:"
find . -type f | wc -l

cd ../../

echo "Public directory cleanup complete."