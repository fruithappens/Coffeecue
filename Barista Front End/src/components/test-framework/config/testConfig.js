module.exports = {
  // Application URLs
  baseUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:5001/api',
  
  // Test credentials
  credentials: {
    admin: { username: 'admin', password: 'admin123' },
    barista: { username: 'barista', password: 'barista123' },
    organizer: { username: 'organizer', password: 'organizer123' }
  },
  
  // Database configuration
  database: {
    host: 'localhost',
    port: 5432,
    database: 'coffee_orders',
    user: 'postgres',
    password: 'postgres'
  },
  
  // Test configuration
  testConfig: {
    headless: false, // Set to true for CI/CD
    slowMo: 50, // Slow down by 50ms to see what's happening
    timeout: 30000, // 30 second timeout
    viewport: { width: 1280, height: 800 }
  },
  
  // Monitoring configuration
  monitoring: {
    dashboardPort: 8080,
    websocketPort: 8081,
    updateInterval: 1000 // Update dashboard every second
  },
  
  // Report configuration
  reports: {
    outputDir: './reports',
    formats: ['html', 'json', 'markdown'],
    includeScreenshots: true,
    includeNetworkLogs: true,
    includeDatabaseLogs: true
  }
};