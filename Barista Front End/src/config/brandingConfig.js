/**
 * Centralized Branding Configuration
 * Allows white-labeling and customization of the application
 */

// Check localStorage for custom branding, otherwise use defaults
const getStoredBranding = () => {
  try {
    const stored = localStorage.getItem('coffee_system_branding');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Error loading branding config:', error);
    return null;
  }
};

// Default branding configuration
const defaultBranding = {
  // Company/Product Names
  companyName: 'CupQ',
  systemName: 'CupQ',
  shortName: 'CupQ',
  tagline: 'Skip the Queue, Get Your Cue',
  
  // UI Text
  landingTitle: 'CupQ',
  landingSubtitle: 'Select your role to continue',
  adminPanelTitle: 'CupQ Admin',
  baristaPanelTitle: 'CupQ Barista',
  footerText: '© 2026 CupQ',
  
  // Colors (can be extended)
  primaryColor: '#D97706', // Amber-600
  primaryColorHover: '#B45309', // Amber-700
  accentColor: '#92400E', // Amber-800
  
  // Logo/Images (URLs or paths)
  logo: '/logo.png',
  favicon: '/favicon.ico',
  
  // Feature flags for white-labeling
  showPoweredBy: true,
  poweredByText: 'Powered by Coffee Cue',
  
  // Contact/Support
  supportEmail: 'support@coffeecue.com',
  supportPhone: '+1-800-COFFEE',
  
  // Custom CSS (optional)
  customCSS: ''
};

// Merge stored branding with defaults
const storedBranding = getStoredBranding();
const brandingConfig = storedBranding ? { ...defaultBranding, ...storedBranding } : defaultBranding;

// Function to update branding configuration.
//
// `reload` defaults to true for backwards compatibility, but callers that
// are ALSO saving to the server must pass { reload: false } and reload
// themselves once the request has finished. Reloading mid-save tears down
// the page and aborts the in-flight fetch: small payloads sometimes made
// it out in time, large ones (a logo plus two backgrounds) arrived at the
// server truncated and were rejected as unparseable JSON. That is the bug
// where branding "saved successfully" and was gone when you came back —
// localStorage had been written and the reload read it straight back, so
// the screen looked right while the server never received anything.
export const updateBranding = (newBranding, { reload = true } = {}) => {
  const updated = { ...brandingConfig, ...newBranding };
  localStorage.setItem('coffee_system_branding', JSON.stringify(updated));
  if (reload) window.location.reload();
  return updated;
};

// Function to reset to default branding
export const resetBranding = () => {
  localStorage.removeItem('coffee_system_branding');
  window.location.reload();
};

// Function to get specific branding value
export const getBrandingValue = (key) => {
  return brandingConfig[key] || defaultBranding[key];
};

// Export the configuration
export default brandingConfig;