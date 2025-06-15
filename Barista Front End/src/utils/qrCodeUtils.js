/**
 * QR Code utility functions for Expresso
 * Used for generating order tracking QR codes for SMS messages
 */

/**
 * Generate a QR code URL for an order
 * This uses the Google Charts API to generate a QR code
 * 
 * @param {Object} order - Order object
 * @param {Object} options - Optional configuration
 * @returns {string} URL to the QR code image
 */
export const generateOrderQRCode = (order, options = {}) => {
  if (!order || !order.id) {
    return null;
  }
  
  // Default options
  const config = {
    size: options.size || 150,
    baseUrl: options.baseUrl || 'https://order.expresso.cafe',
    errorCorrection: options.errorCorrection || 'L', // L, M, Q, H
    margin: options.margin || 1,
    color: options.color || '000000', // Black
  };
  
  // Create tracking URL with all order details
  const trackingParams = new URLSearchParams();
  trackingParams.append('order', order.orderNumber || order.id);
  trackingParams.append('station', order.stationId || '1');
  
  if (order.waitTime) {
    trackingParams.append('eta', order.waitTime);
  }
  
  if (order.customerName) {
    trackingParams.append('name', order.customerName);
  }
  
  // Build order tracking URL
  const orderTrackingUrl = `${config.baseUrl}/track?${trackingParams.toString()}`;
  
  // Generate QR code using Google Charts API
  return `https://chart.googleapis.com/chart?cht=qr&chs=${config.size}x${config.size}&chl=${encodeURIComponent(orderTrackingUrl)}&chld=${config.errorCorrection}|${config.margin}&chco=${config.color}`;
};

/**
 * Generate a tracking link for SMS messages
 * 
 * @param {Object} order - Order object
 * @param {string} baseUrl - Base URL for tracking
 * @returns {string} Tracking URL for the order
 */
export const generateOrderTrackingLink = (order, baseUrl = 'https://order.expresso.cafe') => {
  if (!order || !order.id) {
    return null;
  }
  
  // Create tracking URL with essential order details
  const trackingParams = new URLSearchParams();
  trackingParams.append('order', order.orderNumber || order.id);
  trackingParams.append('station', order.stationId || '1');
  
  if (order.waitTime) {
    trackingParams.append('eta', order.waitTime);
  }
  
  // Build order tracking URL
  return `${baseUrl}/track?${trackingParams.toString()}`;
};

/**
 * Create enhanced SMS message with useful information and tips
 * 
 * @param {Object} order - Order object
 * @param {string} messageTemplate - Message template with placeholders
 * @param {Object} options - Additional options for SMS enhancement
 * @returns {Object} Object with smsText and other properties
 */
export const createOrderTrackingSMS = (order, messageTemplate = "Your {coffeeType} is ready for pickup at Station {stationId}!", options = {}) => {
  if (!order) {
    return { smsText: '', qrCodeUrl: '' };
  }
  
  // Get branding/sponsor information from localStorage
  let sponsorText = '';
  let tipText = '';
  
  try {
    const branding = JSON.parse(localStorage.getItem('coffee_system_branding') || '{}');
    const eventBranding = JSON.parse(localStorage.getItem('coffee_event_branding') || '{}');
    
    // Add sponsor information if available
    if (eventBranding.sponsor || branding.sponsor) {
      sponsorText = ` Thanks to our sponsor ${eventBranding.sponsor || branding.sponsor}!`;
    }
    
    // Add useful tips
    const tips = [
      'TIP: SMS "Same" to reorder your usual coffee next time!',
      'TIP: Peak hours are 8-10am. Order early to skip the wait!',
      'TIP: Save this number for quick reorders!',
      'TIP: Tell your colleagues about our SMS ordering system!'
    ];
    
    // Select a random tip or use provided tip
    if (options.includeTip !== false) {
      tipText = ' ' + (options.customTip || tips[Math.floor(Math.random() * tips.length)]);
    }
  } catch (error) {
    console.error('Error loading branding for SMS:', error);
  }
  
  // Get station location/directions if available
  let locationInfo = '';
  try {
    const stationSettings = JSON.parse(localStorage.getItem(`coffee_station_settings_${order.stationId}`) || '{}');
    if (stationSettings.location && stationSettings.location.trim()) {
      locationInfo = ` Location: ${stationSettings.location}.`;
    }
  } catch (error) {
    console.error('Error loading station location:', error);
  }
  
  let smsText = messageTemplate
    .replace('{coffeeType}', order.coffeeType || 'coffee')
    .replace('{stationId}', order.stationId || '1')
    .replace('{stationName}', order.stationName || `Station ${order.stationId || '1'}`)
    .replace('{orderNumber}', order.orderNumber || order.id);
    
  // Add location information
  smsText += locationInfo;
  
  // Add tip text
  smsText += tipText;
  
  // Add sponsor text
  smsText += sponsorText;
  
  return {
    smsText,
    locationInfo,
    tipText,
    sponsorText
  };
};