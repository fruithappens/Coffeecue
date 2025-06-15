/**
 * Migration utilities to help transition from legacy implementations to new ones
 */

import config from '../config/config';

/**
 * Migrate legacy localStorage keys to new standardized keys
 * @returns {Object} - Migration statistics
 */
export const migrateLocalStorage = () => {
  const stats = {
    migrated: 0,
    skipped: 0,
    errors: 0
  };
  
  try {
    // Auth token migration
    migrateKey('coffee_auth_token', config.auth.tokenKey, stats);
    migrateKey('jwt_token', config.auth.tokenKey, stats);
    
    // Fallback mode migration
    migrateKey('use_fallback_data', config.fallback.modeKey, stats);
    migrateKey('fallback_data_available', config.fallback.dataKey, stats);
    
    // Auto-refresh settings migration
    migrateKey('coffee_auto_refresh_enabled', config.refresh.enabledKey, stats);
    migrateKey('coffee_auto_refresh_interval', config.refresh.intervalKey, stats);
    
    // Clean up legacy keys
    const legacyPrefixes = [
      'auth_error_',
      'anti_flicker_',
      'api_',
      'jwt_error_',
      'session_'
    ];
    
    // Find all keys that need cleanup
    Object.keys(localStorage).forEach(key => {
      if (legacyPrefixes.some(prefix => key.startsWith(prefix))) {
        try {
          // Keep important data like auth_error_count but standardize others
          if (key === 'auth_error_count') {
            // Keep this key for backward compatibility
            stats.skipped++;
          } else if (key === 'auth_error_refresh_needed') {
            // Keep this key for backward compatibility
            stats.skipped++;
          } else {
            // Remove other legacy keys
            localStorage.removeItem(key);
            stats.migrated++;
          }
        } catch (e) {
          console.error(`Error cleaning up key ${key}:`, e);
          stats.errors++;
        }
      }
    });
    
    console.log('LocalStorage migration completed:', stats);
    return stats;
  } catch (e) {
    console.error('Error during localStorage migration:', e);
    stats.errors++;
    return stats;
  }
};

/**
 * Migrate a specific localStorage key to a new key
 * @param {string} oldKey - Legacy key
 * @param {string} newKey - New standardized key
 * @param {Object} stats - Migration statistics to update
 */
const migrateKey = (oldKey, newKey, stats) => {
  try {
    // Get value from old key
    const value = localStorage.getItem(oldKey);
    
    // If old key has a value and new key doesn't exist yet, migrate it
    if (value !== null && localStorage.getItem(newKey) === null) {
      localStorage.setItem(newKey, value);
      stats.migrated++;
      
      console.log(`Migrated ${oldKey} → ${newKey}`);
    } else {
      stats.skipped++;
    }
  } catch (e) {
    console.error(`Error migrating ${oldKey} to ${newKey}:`, e);
    stats.errors++;
  }
};

/**
 * Check if we need to perform migration
 * @returns {boolean} - True if migration needed
 */
export const needsMigration = () => {
  // Check for specific legacy keys that indicate need for migration
  const legacyKeys = [
    'coffee_auth_token',
    'jwt_token',
    'use_fallback_data'
  ];
  
  return legacyKeys.some(key => localStorage.getItem(key) !== null);
};

/**
 * Initialize application with migration if needed
 */
export const initializeWithMigration = () => {
  // Check if migration is needed
  if (needsMigration()) {
    console.log('Migration needed, performing localStorage migration...');
    migrateLocalStorage();
  } else {
    console.log('No migration needed');
  }
  
  // Initialize configuration
  initializeConfiguration();
};

/**
 * Initialize application configuration
 */
const initializeConfiguration = () => {
  // Set default interval if not already set
  if (localStorage.getItem(config.refresh.intervalKey) === null) {
    localStorage.setItem(
      config.refresh.intervalKey, 
      config.refresh.defaultInterval.toString()
    );
  }
  
  // Enforce minimum refresh interval
  const currentInterval = parseInt(localStorage.getItem(config.refresh.intervalKey) || '0');
  if (currentInterval < config.refresh.minInterval) {
    localStorage.setItem(
      config.refresh.intervalKey, 
      config.refresh.minInterval.toString()
    );
  }
};

export default {
  migrateLocalStorage,
  needsMigration,
  initializeWithMigration
};