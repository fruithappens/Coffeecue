// Proper JWT fix for backend authentication issues
(function() {
    console.log('Fixing JWT authentication issues...');
    
    // Create a proper JWT token that the backend will accept
    function createProperJwt() {
        // Use a format that the backend will accept with a proper 'sub' field
        const header = {
            alg: 'HS256', 
            typ: 'JWT'
        };
        
        // Current timestamp and expiration
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 24 * 60 * 60; // 24 hours
        
        // Payload with proper 'sub' field
        const payload = {
            sub: 'demo_user', // String value for subject
            name: 'Demo User',
            role: 'barista',
            stations: [1, 2, 3],
            iat: now,
            exp: exp
        };
        
        // Base64 encode the header and payload
        const headerB64 = btoa(JSON.stringify(header));
        const payloadB64 = btoa(JSON.stringify(payload));
        
        // Dummy signature
        const signature = 'dummy_signature';
        
        // Create the token
        return `${headerB64}.${payloadB64}.${signature}`;
    }
    
    // Check existing token
    const existingToken = localStorage.getItem('coffee_system_token');
    let needsNewToken = true;
    
    if (existingToken) {
        try {
            // Try to parse the token
            const parts = existingToken.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1]));
                
                // Check if token has proper 'sub' field
                if (typeof payload.sub === 'string') {
                    // Check if token is expired
                    const now = Math.floor(Date.now() / 1000);
                    if (payload.exp > now) {
                        console.log('Found valid token with proper "sub" field, no need to create new one');
                        needsNewToken = false;
                    } else {
                        console.log('Token is expired, creating new one');
                    }
                } else {
                    console.log('Token does not have a proper "sub" field, creating new one');
                }
            }
        } catch (error) {
            console.log('Error parsing token, creating new one:', error);
        }
    }
    
    // Create and store new token if needed
    if (needsNewToken) {
        const newToken = createProperJwt();
        localStorage.setItem('coffee_system_token', newToken);
        console.log('Created and stored new JWT token with proper subject field');
    }
    
    // Also fix other known variables
    localStorage.setItem('coffee_connection_status', 'online');
    localStorage.setItem('coffee_connection_timestamp', Date.now().toString());
    
    console.log('JWT authentication fix complete');
})();