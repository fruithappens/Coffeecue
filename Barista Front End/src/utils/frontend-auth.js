/**
 * Authentication utilities for the Expresso Coffee Ordering System
 * Fully compatible with JWT authentication and session fallback
 */

const AuthClient = {
    // Track whether we're using JWT authentication
    _useJwt: true,
    
    /**
     * Initialize the auth client
     */
    init: async function() {
        try {
            // Check if JWT is enabled in the server settings
            const response = await fetch('/api/auth-test');
            const data = await response.json();
            
            // Use JWT if the server supports it
            this._useJwt = data.auth_type === 'jwt' || (data.status === 'unauthenticated' && !document.cookie.includes('session'));
            
            console.log(`Auth system initialized with ${this._useJwt ? 'JWT' : 'session'} authentication`);
            
            // Set up interval to refresh token if using JWT
            if (this._useJwt) {
                const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes
                setInterval(async () => {
                    try {
                        const isLoggedIn = await this.isLoggedIn();
                        if (isLoggedIn) {
                            await this.refreshToken();
                            console.log('Token refreshed');
                        }
                    } catch (error) {
                        console.error('Auto refresh error:', error);
                    }
                }, REFRESH_INTERVAL);
            }
        } catch (error) {
            console.warn('Error initializing auth client, falling back to session auth:', error);
            this._useJwt = false;
        }
    },
    
    /**
     * Login user and store JWT token or session
     * @param {string} username - Username or email
     * @param {string} password - User password
     * @returns {Promise} Promise with user data or error
     */
    login: async function(username, password) {
        try {
            if (this._useJwt) {
                // Use JSON API for JWT auth
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, password }),
                    credentials: 'include' // Include cookies
                });
                
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.message || 'Login failed');
                }
                
                // Store token in localStorage for API requests
                if (data.access_token) {
                    localStorage.setItem('access_token', data.access_token);
                }
                
                // Store user info
                if (data.user) {
                    localStorage.setItem('user', JSON.stringify(data.user));
                }
                
                return data;
            } else {
                // Use form-based login for session auth
                const formData = new FormData();
                formData.append('username_or_email', username);
                formData.append('password', password);
                
                // Get CSRF token if available
                const csrfTokenElement = document.querySelector('meta[name="csrf-token"]');
                if (csrfTokenElement) {
                    formData.append('csrf_token', csrfTokenElement.getAttribute('content'));
                }
                
                const response = await fetch('/api/auth/login', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include',
                    redirect: 'manual' // Don't follow redirects
                });
                
                // Session authentication works via redirect, so if we get a redirect status, consider it successful
                if (response.status === 200 || response.status === 302) {
                    // For redirect responses (302), we should manually navigate to the location
                    if (response.status === 302) {
                        const redirectUrl = response.headers.get('Location');
                        window.location.href = redirectUrl || '/';
                    }
                    
                    // Try to get user info from the server
                    try {
                        const userResponse = await fetch('/api/auth/me', {
                            credentials: 'include'
                        });
                        
                        if (userResponse.ok) {
                            const userData = await userResponse.json();
                            localStorage.setItem('user', JSON.stringify(userData));
                            return { success: true, user: userData };
                        }
                    } catch (e) {
                        console.warn('Could not fetch user info after login:', e);
                    }
                    
                    return { success: true };
                }
                
                // Handle HTML response with error message
                const html = await response.text();
                const errorMatch = html.match(/<div class="alert alert-error">(.*?)<\/div>/);
                const errorMessage = errorMatch ? errorMatch[1].trim() : 'Login failed';
                
                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    },
    
    /**
     * Logout user and clear stored tokens/cookies
     * @returns {Promise} Promise resolving on successful logout
     */
    logout: async function() {
        try {
            // Call the logout endpoint to clear cookies
            await fetch('/api/auth/logout', {
                method: 'GET',
                credentials: 'include',
                headers: this._useJwt ? this.getAuthHeader() : {}
            });
            
            // Clear localStorage
            localStorage.removeItem('access_token');
            localStorage.removeItem('user');
            localStorage.removeItem('station_id');
            
            // Redirect to login page - use React Router path
            window.location.href = '/login';
            
            return true;
        } catch (error) {
            console.error('Logout error:', error);
            
            // Clear localStorage even if the request fails
            localStorage.removeItem('access_token');
            localStorage.removeItem('user');
            localStorage.removeItem('station_id');
            
            throw error;
        }
    },
    
    /**
     * Refresh access token (JWT only)
     * @returns {Promise} Promise with new token or error
     */
    refreshToken: async function() {
        if (!this._useJwt) {
            return null; // No need to refresh for session auth
        }
        
        try {
            const response = await fetch('/api/auth/refresh', {
                method: 'POST',
                credentials: 'include', // Include cookies for refresh token
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || 'Token refresh failed');
            }
            
            const data = await response.json();
            
            // Store new token
            if (data.access_token) {
                localStorage.setItem('access_token', data.access_token);
            }
            
            return data;
        } catch (error) {
            console.error('Token refresh error:', error);
            
            // If refresh fails, log out the user
            await this.logout();
            
            throw error;
        }
    },
    
    /**
     * Get currently logged in user
     * @returns {Promise} Promise with user data or null
     */
    getCurrentUser: async function() {
        try {
            // First check localStorage (JWT mode)
            const userStr = localStorage.getItem('user');
            if (userStr) {
                return JSON.parse(userStr);
            }
            
            // If not in localStorage, get from server
            const response = await fetch('/api/auth/me', {
                method: 'GET',
                credentials: 'include',
                headers: this._useJwt ? this.getAuthHeader() : {}
            });
            
            if (!response.ok) {
                return null;
            }
            
            const user = await response.json();
            localStorage.setItem('user', JSON.stringify(user));
            
            return user;
        } catch (error) {
            console.error('Get current user error:', error);
            return null;
        }
    },
    
    /**
     * Check if user is logged in
     * @returns {Promise<boolean>} Promise resolving to boolean
     */
    isLoggedIn: async function() {
        const user = await this.getCurrentUser();
        return !!user;
    },
    
    /**
     * Check if user has specific role
     * @param {string|array} roles - Role or array of roles to check
     * @returns {Promise<boolean>} Promise resolving to boolean
     */
    hasRole: async function(roles) {
        const user = await this.getCurrentUser();
        
        if (!user) {
            return false;
        }
        
        if (Array.isArray(roles)) {
            return roles.includes(user.role);
        }
        
        return user.role === roles;
    },
    
    /**
     * Set station ID for barista user
     * @param {number} stationId - Station ID
     * @returns {Promise} Promise resolving when station is set
     */
    setStation: async function(stationId) {
        try {
            const response = await fetch(`/api/auth/set-station/${stationId}`, {
                method: 'GET',
                credentials: 'include',
                headers: this._useJwt ? this.getAuthHeader() : {}
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || 'Setting station failed');
            }
            
            // Update token for JWT mode
            if (this._useJwt && data.access_token) {
                localStorage.setItem('access_token', data.access_token);
            }
            
            // Store station ID for both auth modes
            localStorage.setItem('station_id', stationId.toString());
            
            return data;
        } catch (error) {
            console.error('Set station error:', error);
            throw error;
        }
    },
    
    /**
     * Get auth header with JWT token
     * @returns {Object} Headers object with Authorization header
     */
    getAuthHeader: function() {
        if (!this._useJwt) {
            return {}; // No auth header for session auth
        }
        
        const token = localStorage.getItem('access_token');
        
        if (!token) {
            return {};
        }
        
        return {
            'Authorization': `Bearer ${token}`
        };
    },
    
    /**
     * Make authenticated API request
     * @param {string} url - API endpoint URL
     * @param {Object} options - Fetch options
     * @returns {Promise} Promise with response data
     */
    apiRequest: async function(url, options = {}) {
        try {
            // Refresh token if needed before making request
            if (this._useJwt) {
                await this.refreshTokenIfNeeded();
            }
            
            // Make sure URL starts with /api and normalize to avoid double slashes
            let apiUrl;
            
            if (url.startsWith('/api')) {
                // If URL already starts with /api, use it but ensure no double slashes
                apiUrl = url.replace(/\/+/g, '/');
            } else {
                // Otherwise, add /api prefix
                const urlPath = url.startsWith('/') ? url : `/${url}`;
                apiUrl = `/api${urlPath}`;
            }
            
            // Final normalization to ensure proper URL format
            apiUrl = apiUrl.replace(/\/+/g, '/');
            
            let headers = {
                ...options.headers,
                'Content-Type': 'application/json'
            };
            
            // Add auth headers for JWT mode
            if (this._useJwt) {
                headers = {
                    ...headers,
                    ...this.getAuthHeader()
                };
            }
            
            // Log the normalized URL
            console.log(`Making API request to normalized URL: ${apiUrl}`);
            
            // Make request
            let response = await fetch(apiUrl, {
                ...options,
                headers,
                credentials: 'include' // Include cookies for both auth types
            });
            
            // If token expired (JWT mode only), try to refresh and retry
            if (this._useJwt && response.status === 401) {
                try {
                    console.log('Received 401 unauthorized, attempting token refresh');
                    await this.refreshToken();
                    
                    // Retry request with new token
                    headers = {
                        ...headers,
                        ...this.getAuthHeader()
                    };
                    
                    response = await fetch(apiUrl, {
                        ...options,
                        headers,
                        credentials: 'include'
                    });
                } catch (refreshError) {
                    // If refresh fails, throw original error
                    console.error('Token refresh failed after 401:', refreshError);
                    throw new Error('Session expired. Please log in again.');
                }
            }
            
            // For JSON responses
            if (response.headers.get('content-type')?.includes('application/json')) {
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.message || data.error || 'API request failed');
                }
                
                return data;
            }
            
            // For non-JSON responses
            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }
            
            return await response.text();
        } catch (error) {
            console.error('API request error:', error);
            throw error;
        }
    },
    
    /**
     * Check if auth token is expired
     * @returns {boolean} True if token is expired or absent
     */
    isTokenExpired: function() {
        if (!this._useJwt) {
            return false; // No token to expire for session auth
        }
        
        const token = localStorage.getItem('access_token');
        if (!token) {
            return true;
        }
        
        try {
            // JWT tokens are base64 encoded with three parts separated by dots
            const payload = token.split('.')[1];
            const decodedPayload = JSON.parse(atob(payload));
            
            // Check if token has expired
            const currentTime = Math.floor(Date.now() / 1000);
            return decodedPayload.exp < currentTime;
        } catch (error) {
            console.error('Error checking token expiration:', error);
            return true; // Assume expired if we can't decode it
        }
    },
    
    /**
     * Check if auth token is expiring soon (within 5 minutes)
     * @returns {boolean} True if token is expiring soon
     */
    isTokenExpiringSoon: function() {
        if (!this._useJwt) {
            return false; // No token to expire for session auth
        }
        
        const token = localStorage.getItem('access_token');
        if (!token) {
            return true; // Consider no token as "expiring soon"
        }
        
        try {
            // JWT tokens are base64 encoded with three parts separated by dots
            const payload = token.split('.')[1];
            const decodedPayload = JSON.parse(atob(payload));
            
            // Check if token expires in less than 5 minutes
            const currentTime = Math.floor(Date.now() / 1000);
            const fiveMinutesInSeconds = 5 * 60;
            return (decodedPayload.exp - currentTime) < fiveMinutesInSeconds;
        } catch (error) {
            console.error('Error checking token expiration:', error);
            return true; // Assume expiring soon if we can't decode it
        }
    },
    
    /**
     * Refresh token if needed before making API requests
     * @returns {Promise<boolean>} True if token is valid or was refreshed successfully
     */
    refreshTokenIfNeeded: async function() {
        const token = localStorage.getItem('access_token');
        const tokenExpiry = localStorage.getItem('tokenExpiry');
        
        if (!token) return false;
        
        // Check if token expires in less than 5 minutes
        const isExpiringSoon = this.isTokenExpiringSoon();
        
        if (isExpiringSoon) {
            console.log('Token is expiring soon, attempting to refresh');
            
            try {
                // Call refresh token endpoint
                const response = await fetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') }),
                    credentials: 'include'
                });
                
                if (!response.ok) {
                    throw new Error('Token refresh failed');
                }
                
                const data = await response.json();
                
                if (data.token || data.access_token) {
                    const newToken = data.token || data.access_token;
                    
                    // Save new token
                    localStorage.setItem('access_token', newToken);
                    
                    // Save token expiry time if provided
                    if (data.expiresIn) {
                        localStorage.setItem('tokenExpiry', Date.now() + (data.expiresIn * 1000));
                    }
                    
                    console.log('Token refreshed successfully via refreshTokenIfNeeded');
                    return true;
                }
                
                return false;
            } catch (error) {
                console.error('Token refresh error in refreshTokenIfNeeded:', error);
                return false;
            }
        }
        
        // Token is still valid
        return true;
    }
};

// Initialize auth when script loads
document.addEventListener('DOMContentLoaded', () => {
    AuthClient.init().catch(error => {
        console.error('Error initializing authentication client:', error);
    });
});