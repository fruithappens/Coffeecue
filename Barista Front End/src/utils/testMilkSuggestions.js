// Test script for milk suggestion features
// Run with: node testMilkSuggestions.js

// Since this is a Node.js script that will run outside the browser environment,
// we'll manually include the milk configuration data for testing

// Mock milk configuration
const DEFAULT_MILK_TYPES = [
  { id: 'full_cream', name: 'Full Cream Milk', category: 'standard', properties: { dairyFree: false, lactoseFree: false, vegan: false, lowFat: false } },
  { id: 'skim', name: 'Skim Milk', category: 'standard', properties: { dairyFree: false, lactoseFree: false, vegan: false, lowFat: true } },
  { id: 'reduced_fat', name: 'Reduced Fat Milk', category: 'standard', properties: { dairyFree: false, lactoseFree: false, vegan: false, lowFat: true } },
  { id: 'lactose_free', name: 'Lactose-Free Milk', category: 'standard', properties: { dairyFree: false, lactoseFree: true, vegan: false, lowFat: false } },
  { id: 'soy', name: 'Soy Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'oat', name: 'Oat Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'almond', name: 'Almond Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: true } },
  { id: 'coconut', name: 'Coconut Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'macadamia', name: 'Macadamia Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'rice', name: 'Rice Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'hemp', name: 'Hemp Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: true } },
  { id: 'cashew', name: 'Cashew Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: false } },
  { id: 'pea', name: 'Pea Milk', category: 'alternative', properties: { dairyFree: true, lactoseFree: true, vegan: true, lowFat: true } }
];

// Mock utility functions from milkConfig.js
const getMilkTypeById = (id) => DEFAULT_MILK_TYPES.find(milk => milk.id === id) || null;
const getMilkTypeByName = (name) => DEFAULT_MILK_TYPES.find(milk => milk.name === name) || null;
const getAvailableMilks = (settings) => {
  if (!settings || !settings.availableMilks) return DEFAULT_MILK_TYPES;
  return DEFAULT_MILK_TYPES.filter(milk => settings.availableMilks[milk.id] === true);
};

// Our main utility functions
const getSimilarMilkSuggestions = (requestedMilk, settings, limit = 3) => {
  if (!requestedMilk) return [];
  const availableMilks = getAvailableMilks(settings);
  if (availableMilks.length === 0) return [];
  
  let requestedMilkObj = null;
  requestedMilkObj = getMilkTypeById(requestedMilk);
  
  if (!requestedMilkObj) {
    const normalizedName = requestedMilk.toLowerCase();
    requestedMilkObj = DEFAULT_MILK_TYPES.find(milk => milk.name.toLowerCase() === normalizedName);
    
    if (!requestedMilkObj) {
      requestedMilkObj = DEFAULT_MILK_TYPES.find(
        milk => milk.name.toLowerCase().includes(normalizedName) ||
               normalizedName.includes(milk.name.toLowerCase())
      );
    }
  }
  
  if (requestedMilkObj) {
    const isRequestedDairy = !requestedMilkObj.properties.dairyFree;
    const isRequestedLactoseFree = requestedMilkObj.properties.lactoseFree;
    const isRequestedLowFat = requestedMilkObj.properties.lowFat;
    
    const scoredMilks = availableMilks.map(milk => {
      let score = 0;
      if (milk.category === requestedMilkObj.category) score += 3;
      if (milk.properties.dairyFree === !isRequestedDairy) score += 2;
      if (milk.properties.lactoseFree === isRequestedLactoseFree) score += 1;
      if (milk.properties.lowFat === isRequestedLowFat) score += 1;
      return { milk, score };
    });
    
    return scoredMilks
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.milk);
  }
  
  return availableMilks.slice(0, limit);
};

const formatMilkListForSMS = (milkTypes) => {
  if (!milkTypes || milkTypes.length === 0) return "no milk options available";
  if (milkTypes.length === 1) return `${milkTypes[0].name} or no milk`;
  
  const names = milkTypes.map(milk => milk.name);
  if (names.length === 2) return `${names[0]} or ${names[1]} (or no milk)`;
  
  const lastMilk = names.pop();
  return `${names.join(', ')}, or ${lastMilk} (or no milk)`;
};

// Test settings with some milks disabled
const testSettings = {
  availableMilks: {
    full_cream: true,
    skim: true,
    reduced_fat: true,
    lactose_free: true,
    soy: true,
    oat: false, // Disabled
    almond: true,
    coconut: true,
    macadamia: false, // Disabled
    rice: true,
    hemp: false, // Disabled
    cashew: true,
    pea: true
  }
};

// Test case 1: Request an unavailable milk (oat)
console.log("TEST CASE 1: Request unavailable milk (oat)");
const oatSuggestions = getSimilarMilkSuggestions('oat', testSettings);
console.log("Similar alternatives to oat milk:", oatSuggestions.map(m => m.name));
console.log("Formatted for SMS:", formatMilkListForSMS(oatSuggestions));
console.log();

// Test case 2: Request a lactose-free milk when it's unavailable
console.log("TEST CASE 2: Request hemp milk (unavailable, but has specific properties)");
const hempSuggestions = getSimilarMilkSuggestions('hemp', testSettings);
console.log("Similar alternatives to hemp milk:", hempSuggestions.map(m => m.name));
console.log("Formatted for SMS:", formatMilkListForSMS(hempSuggestions));
console.log();

// Test case 3: Request a standard milk when some are disabled
console.log("TEST CASE 3: Request standard milk by ID");
const standardSuggestions = getSimilarMilkSuggestions('full_cream', testSettings);
console.log("Similar alternatives to full cream milk:", standardSuggestions.map(m => m.name));
console.log("Formatted for SMS:", formatMilkListForSMS(standardSuggestions));
console.log();

// Test case 4: Test partial name matching
console.log("TEST CASE 4: Partial name matching");
const partialSuggestions = getSimilarMilkSuggestions('coconut', testSettings);
console.log("Similar alternatives to coconut milk:", partialSuggestions.map(m => m.name));
console.log("Formatted for SMS:", formatMilkListForSMS(partialSuggestions));
console.log();

// Test QR code functionality by importing from qrCodeUtils
// Mock QR code functionality for test
const generateOrderQRCode = (order, options = {}) => {
  if (!order || !order.id) return null;
  
  const config = {
    size: options.size || 150,
    baseUrl: options.baseUrl || 'https://order.expresso.cafe',
    errorCorrection: options.errorCorrection || 'L',
    margin: options.margin || 1,
    color: options.color || '000000',
  };
  
  const trackingParams = new URLSearchParams();
  trackingParams.append('order', order.orderNumber || order.id);
  trackingParams.append('station', order.stationId || '1');
  
  if (order.waitTime) trackingParams.append('eta', order.waitTime);
  if (order.customerName) trackingParams.append('name', order.customerName);
  
  const orderTrackingUrl = `${config.baseUrl}/track?${trackingParams.toString()}`;
  return `https://chart.googleapis.com/chart?cht=qr&chs=${config.size}x${config.size}&chl=${encodeURIComponent(orderTrackingUrl)}&chld=${config.errorCorrection}|${config.margin}&chco=${config.color}`;
};

const generateOrderTrackingLink = (order, baseUrl = 'https://order.expresso.cafe') => {
  if (!order || !order.id) return null;
  
  const trackingParams = new URLSearchParams();
  trackingParams.append('order', order.orderNumber || order.id);
  trackingParams.append('station', order.stationId || '1');
  
  if (order.waitTime) trackingParams.append('eta', order.waitTime);
  
  return `${baseUrl}/track?${trackingParams.toString()}`;
};

const createOrderTrackingSMS = (order, messageTemplate = "Your {coffeeType} is ready for pickup at Station {stationId}! Track your order: {trackingLink}") => {
  if (!order) return { smsText: '', qrCodeUrl: '' };
  
  const trackingLink = generateOrderTrackingLink(order);
  const qrCodeUrl = generateOrderQRCode(order);
  
  let smsText = messageTemplate
    .replace('{coffeeType}', order.coffeeType || 'coffee')
    .replace('{stationId}', order.stationId || '1')
    .replace('{orderNumber}', order.orderNumber || order.id)
    .replace('{trackingLink}', trackingLink);
    
  if (qrCodeUrl) {
    smsText += ' Scan the QR code on the tracking page for easy pickup!';
  }
  
  return {
    smsText,
    qrCodeUrl,
    trackingLink
  };
};

// Test order object
const testOrder = {
  id: 'order_12345',
  orderNumber: '42',
  coffeeType: 'Flat White',
  milkType: 'Almond Milk',
  milkTypeId: 'almond',
  stationId: '3',
  stationName: 'Station #3',
  waitTime: 5,
  customerName: 'Alex'
};

console.log("\nTEST CASE 5: QR Code Generation");
const qrCodeUrl = generateOrderQRCode(testOrder);
console.log("QR Code URL:", qrCodeUrl);

console.log("\nTEST CASE 6: SMS with Tracking Link");
const trackingSMS = createOrderTrackingSMS(testOrder);
console.log("SMS Text:", trackingSMS.smsText);

console.log("\nAll tests completed!");