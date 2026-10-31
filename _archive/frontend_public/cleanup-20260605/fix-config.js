// Fix ConfigService URL issue by clearing localStorage config
console.log('=== FIXING CONFIG SERVICE URL ISSUE ===');

// Check current localStorage config
const configKey = 'coffee_system_config';
const currentConfig = localStorage.getItem(configKey);

console.log('Current config:', currentConfig);

// Clear any config that might have absolute URLs
if (currentConfig) {
  try {
    const parsed = JSON.parse(currentConfig);
    console.log('Parsed config:', parsed);
    
    // Check if it has the problematic absolute URL
    if (parsed.apiBaseUrl && parsed.apiBaseUrl.includes('localhost:5001')) {
      console.log('Found problematic absolute URL, removing config...');
      localStorage.removeItem(configKey);
      console.log('Config cleared - page will reload to use relative URLs');
    }
  } catch (e) {
    console.log('Invalid config JSON, clearing...');
    localStorage.removeItem(configKey);
  }
}

// Also clear any other potential problematic items
const keysToCheck = [
  'api_base_url',
  'apiBaseUrl', 
  'REACT_APP_API_URL',
  'coffee_api_url'
];

keysToCheck.forEach(key => {
  const value = localStorage.getItem(key);
  if (value && value.includes('localhost:5001')) {
    console.log(`Clearing ${key}: ${value}`);
    localStorage.removeItem(key);
  }
});

console.log('=== CONFIG FIX COMPLETE ===');

// Force reload to use new config
window.location.reload();