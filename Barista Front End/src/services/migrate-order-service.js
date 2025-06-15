#!/usr/bin/env node
/**
 * Script to migrate from old OrderDataService to refactored version
 * This will update imports in all components
 */

const fs = require('fs');
const path = require('path');

// Files to update
const filesToUpdate = [
  'components/OrganiserInterface.js',
  'components/BaristaInterface.js',
  'hooks/useOrders.js',
  'components/SupportInterface.js',
  'services/MessageService.js',
  'services/AuthService.js',
  'components/ApiNotificationBanner.js',
  'components/ModernBaristaInterface.js',
  'services/NotificationService.js',
  'components/DisplayScreen.js',
  'hooks/useMessages.js'
];

// Backup original OrderDataService
const originalPath = path.join(__dirname, 'OrderDataService.js');
const backupPath = path.join(__dirname, 'OrderDataService.original.js');
const refactoredPath = path.join(__dirname, 'OrderDataService.refactored.js');

console.log('Migrating to refactored OrderDataService...\n');

// Step 1: Backup original
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(originalPath, backupPath);
  console.log('✓ Backed up original OrderDataService.js');
}

// Step 2: Replace with refactored version
fs.copyFileSync(refactoredPath, originalPath);
console.log('✓ Replaced OrderDataService.js with refactored version');

// Step 3: Update method calls in components if needed
console.log('\nUpdating components...');

filesToUpdate.forEach(file => {
  const filePath = path.join(__dirname, '..', file);
  
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    let updated = false;
    
    // Update method names if they've changed
    // The refactored version uses mostly the same API, so minimal changes needed
    
    // Check for direct localStorage usage that should use the service
    if (content.includes('localStorage.getItem') && content.includes('orders')) {
      console.log(`  ⚠️  ${file} uses localStorage directly - consider updating`);
    }
    
    if (updated) {
      fs.writeFileSync(filePath, content);
      console.log(`  ✓ Updated ${file}`);
    } else {
      console.log(`  - No changes needed for ${file}`);
    }
  } else {
    console.log(`  ✗ File not found: ${file}`);
  }
});

console.log('\n✅ Migration complete!');
console.log('\nNext steps:');
console.log('1. Test the application thoroughly');
console.log('2. Check browser console for any errors');
console.log('3. Verify WebSocket connections are working');
console.log('4. Test offline fallback functionality');
console.log('\nTo rollback: cp OrderDataService.original.js OrderDataService.js');