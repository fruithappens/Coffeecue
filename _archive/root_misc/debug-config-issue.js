// Debug script to check localStorage configuration
console.log('=== DEBUGGING CONFIG ISSUE ===');

// Check what's in localStorage
console.log('LocalStorage items:');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key.includes('config') || key.includes('api') || key.includes('url')) {
    console.log(`${key}: ${localStorage.getItem(key)}`);
  }
}

// Check specific items
const items = [
  'coffee_system_config',
  'REACT_APP_API_URL',
  'api_base_url',
  'apiBaseUrl'
];

items.forEach(item => {
  const value = localStorage.getItem(item);
  if (value) {
    console.log(`${item}: ${value}`);
  }
});

// Check environment variable
console.log('process.env.REACT_APP_API_URL:', process.env.REACT_APP_API_URL);

// Clear problematic config
console.log('Clearing potentially problematic config...');
localStorage.removeItem('coffee_system_config');

console.log('=== END DEBUG ===');