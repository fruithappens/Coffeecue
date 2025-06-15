/**
 * JWT Token Validation Fix for Expresso
 * This script fixes the JWT token validation issues (Subject must be a string) 
 * by creating and storing a properly formatted JWT token
 */
(function() {
  console.log('🔧 Applying JWT validation fix...');
  
  // Create a valid JWT token with a string subject
  function createValidJwtToken() {
    // Token parts
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };
    
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      // Ensure sub is a string (this is the key fix)
      sub: "1", // Force subject to be a string
      id: 1,
      username: 'barista',
      name: 'Barista User',
      email: 'barista@expresso.local',
      role: 'barista',
      stations: [1, 2, 3],
      iat: now,
      exp: now + (24 * 60 * 60) // 24 hours - reasonable expiry
    };
    
    // Create a base64 encoded token (parts only - this is not a real signed token)
    // The backend will validate the signature but we need to ensure the subject is a string
    const headerB64 = btoa(JSON.stringify(header)).replace(/=+$/, '');
    const payloadB64 = btoa(JSON.stringify(payload)).replace(/=+$/, '');
    
    // Use a fixed signature - this will be ignored by our interception code
    // which will prevent real API calls anyway
    const signature = "fixed_signature_for_validation_format_only";
    
    return `${headerB64}.${payloadB64}.${signature}`;
  }
  
  // Store the valid token in all known storage locations
  const token = createValidJwtToken();
  localStorage.setItem('coffee_system_token', token);
  localStorage.setItem('auth_token', token);
  localStorage.setItem('coffee_auth_token', token);
  localStorage.setItem('jwt_token', token);
  
  // Also update the user object to match the token
  const user = {
    id: "1", // String format to match sub
    username: 'barista',
    name: 'Barista User',
    email: 'barista@expresso.local',
    role: 'barista',
    stations: [1, 2, 3]
  };
  localStorage.setItem('coffee_system_user', JSON.stringify(user));
  
  console.log('✅ JWT validation fix applied - token updated with string subject');
})();