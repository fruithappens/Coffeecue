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
  companyName: 'Coffee Cue',
  systemName: 'Coffee Cue System',
  shortName: 'Coffee Cue',
  tagline: 'Skip the Queue, Get Your Cue',
  
  // UI Text
  landingTitle: 'Coffee Cue Ordering System',
  landingSubtitle: 'Select your role to continue',
  adminPanelTitle: 'Coffee Cue Admin',
  baristaPanelTitle: 'Coffee Cue Barista',
  footerText: '© 2025 Expresso Coffee System | ANZCA ASM 2025 Cairns',
  
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

// Function to update branding configuration
export const updateBranding = (newBranding) => {
  const updated = { ...brandingConfig, ...newBranding };
  localStorage.setItem('coffee_system_branding', JSON.stringify(updated));
  // Reload to apply changes
  window.location.reload();
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