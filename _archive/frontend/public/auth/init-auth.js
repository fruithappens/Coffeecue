// Initialize authentication token if needed
(function() {
    console.log('Initializing auth token...');
    
    // Check if token exists
    const token = localStorage.getItem('coffee_system_token');
    
    if (!token) {
        console.log('No token found, creating demo token');
        
        // Create a demo token that will last for 24 hours
        const now = Math.floor(Date.now() / 1000);
        const exp = now + (24 * 60 * 60); // 24 hours from now
        
        // Demo token payload
        const payload = {
            sub: 'demo_user',
            name: 'Demo User',
            role: 'barista',
            iat: now,
            exp: exp
        };
        
        // Create base64 encoded parts (using btoa)
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payloadBase64 = btoa(JSON.stringify(payload));
        const signature = 'demo_signature_not_valid_for_real_auth';
        
        // Create the token
        const token = `${header}.${payloadBase64}.${signature}`;
        
        // Save to localStorage
        localStorage.setItem('coffee_system_token', token);
        console.log('Demo token created and saved to localStorage');
    } else {
        try {
            // Parse the token
            const parts = token.split('.');
            if (parts.length !== 3) {
                throw new Error('Invalid token format');
            }
            
            // Decode the payload
            const payload = JSON.parse(atob(parts[1]));
            
            // Check if token is expired
            const exp = payload.exp * 1000; // Convert to milliseconds
            const now = Date.now();
            
            if (exp < now) {
                console.log('Token is expired, creating new demo token');
                
                // Create a new demo token
                const newNow = Math.floor(Date.now() / 1000);
                const newExp = newNow + (24 * 60 * 60); // 24 hours from now
                
                // Demo token payload
                const newPayload = {
                    sub: 'demo_user',
                    name: 'Demo User',
                    role: 'barista',
                    iat: newNow,
                    exp: newExp
                };
                
                // Create base64 encoded parts
                const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
                const payloadBase64 = btoa(JSON.stringify(newPayload));
                const signature = 'demo_signature_not_valid_for_real_auth';
                
                // Create the token
                const newToken = `${header}.${payloadBase64}.${signature}`;
                
                // Save to localStorage
                localStorage.setItem('coffee_system_token', newToken);
                console.log('New demo token created and saved to localStorage');
            } else {
                console.log('Valid token found, expiring in', new Date(exp).toLocaleString());
            }
        } catch (error) {
            console.error('Error processing token:', error);
            
            // Create a new demo token as fallback
            const now = Math.floor(Date.now() / 1000);
            const exp = now + (24 * 60 * 60); // 24 hours from now
            
            // Demo token payload
            const payload = {
                sub: 'demo_user',
                name: 'Demo User',
                role: 'barista',
                iat: now,
                exp: exp
            };
            
            // Create base64 encoded parts
            const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
            const payloadBase64 = btoa(JSON.stringify(payload));
            const signature = 'demo_signature_not_valid_for_real_auth';
            
            // Create the token
            const token = `${header}.${payloadBase64}.${signature}`;
            
            // Save to localStorage
            localStorage.setItem('coffee_system_token', token);
            console.log('Fallback demo token created and saved to localStorage');
        }
    }
})();