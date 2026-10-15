#!/bin/bash
# Complete JWT Authentication Implementation Script for Expresso Coffee System

# Text colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Expresso Coffee System - JWT Authentication Setup${NC}"
echo "==================================================="
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Creating Python virtual environment...${NC}"
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to create virtual environment.${NC}"
        exit 1
    fi
fi

# Activate virtual environment
echo -e "${YELLOW}Activating virtual environment...${NC}"
source venv/bin/activate

# Install required packages
echo -e "${YELLOW}Installing required packages...${NC}"
pip install flask-jwt-extended==4.5.3 PyJWT==2.7.0
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install packages.${NC}"
    exit 1
fi

# Update requirements.txt
echo -e "${YELLOW}Updating requirements.txt...${NC}"
if grep -q "flask-jwt-extended" requirements.txt; then
    echo "flask-jwt-extended already in requirements.txt"
else
    echo "flask-jwt-extended==4.5.3" >> requirements.txt
fi

if grep -q "PyJWT" requirements.txt; then
    echo "PyJWT already in requirements.txt"
else
    echo "PyJWT==2.7.0" >> requirements.txt
fi

# Create directories if they don't exist
echo -e "${YELLOW}Creating necessary directories...${NC}"
mkdir -p static/js

# Create auth.py file
echo -e "${YELLOW}Creating auth.py...${NC}"
cat > auth.py << 'EOF'
# auth.py
"""JWT Authentication services for the Coffee Ordering System"""

from flask import jsonify, request, current_app, g, session
from flask_jwt_extended import (
    JWTManager, create_access_token, create_refresh_token,
    get_jwt_identity, verify_jwt_in_request, get_jwt
)
from functools import wraps
import sqlite3
import datetime
import logging

logger = logging.getLogger("expresso.auth")

jwt = JWTManager()

# Use the same role constants as in models/users.py
ROLE_ADMIN = 'admin'      # Highest access level
ROLE_STAFF = 'staff'      # Middle access level (event organizers) 
ROLE_BARISTA = 'barista'  # Basic access level
ROLE_SUPPORT = 'support'  # System monitoring
ROLE_DISPLAY = 'display'  # Read-only order status

def get_db_connection():
    """Get database connection"""
    conn = sqlite3.connect(current_app.config.get('config', {}).get('DB_PATH', 'coffee_orders.db'))
    conn.row_factory = sqlite3.Row
    return conn

def init_app(app):
    """Initialize JWT with app"""
    jwt.init_app(app)
    
    # Register error handlers and callbacks
    @jwt.user_identity_loader
    def user_identity_lookup(user):
        return user["id"]
    
    @jwt.user_lookup_loader
    def user_lookup_callback(_jwt_header, jwt_data):
        identity = jwt_data["sub"]
        db_path = current_app.config.get('config', {}).get('DB_PATH', 'coffee_orders.db')
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, username, email, role, full_name FROM users WHERE id = ?", 
            (identity,)
        )
        user = cursor.fetchone()
        conn.close()
        
        if user:
            return {
                'id': user['id'],
                'username': user['username'],
                'email': user['email'],
                'role': user['role'],
                'full_name': user['full_name']
            }
        return None
    
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return jsonify({
            'status': 'error',
            'message': 'Token has expired',
            'code': 'token_expired'
        }), 401
    
    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return jsonify({
            'status': 'error',
            'message': 'Invalid token',
            'code': 'invalid_token'
        }), 401
    
    @jwt.unauthorized_loader
    def unauthorized_callback(error):
        return jsonify({
            'status': 'error',
            'message': 'Missing token',
            'code': 'missing_token'
        }), 401
    
    # Before request handler to load user from JWT
    @app.before_request
    def load_user_from_jwt():
        # Skip for login, logout, and static routes
        if request.path.startswith('/static') or request.path in ['/auth/login', '/auth/logout', '/login', '/logout']:
            return
        
        # Skip for OPTIONS requests (CORS)
        if request.method == 'OPTIONS':
            return
            
        # Skip for public routes - add any public paths here
        public_paths = ['/display/', '/sms', '/api/test', '/test']
        if any(request.path.startswith(path) for path in public_paths):
            return
        
        try:
            # First try to get user from JWT
            verify_jwt_in_request(optional=True)
            current_user = get_jwt_identity()
            
            if current_user:
                # Get user data from JWT claims
                jwt_data = get_jwt()
                g.user = {
                    'id': current_user,
                    'username': jwt_data.get('username'),
                    'email': jwt_data.get('email'),
                    'role': jwt_data.get('role'),
                    'full_name': jwt_data.get('full_name')
                }
                
                # For backward compatibility, also set these session values
                session['user_id'] = current_user
                if g.user['role'] == ROLE_ADMIN:
                    session['admin_id'] = current_user
                    session['admin_role'] = ROLE_ADMIN
                    session['admin_username'] = jwt_data.get('username')
            elif session.get('user_id'):
                # For backward compatibility, if no JWT but session exists
                user_id = session.get('user_id')
                # Use the existing load_logged_in_user function's logic
                conn = get_db_connection()
                cursor = conn.cursor()
                cursor.execute(
                    "SELECT id, username, email, role, full_name FROM users WHERE id = ?", 
                    (user_id,)
                )
                user = cursor.fetchone()
                conn.close()
                
                if user:
                    g.user = {
                        'id': user['id'],
                        'username': user['username'],
                        'email': user['email'],
                        'role': user['role'],
                        'full_name': user['full_name']
                    }
                else:
                    g.user = None
                    session.clear()
            else:
                g.user = None
        except Exception as e:
            logger.error(f"Error loading user from JWT: {str(e)}")
            g.user = None

def generate_tokens(user_data):
    """Generate JWT access and refresh tokens
    
    Args:
        user_data: Dictionary with user information
        
    Returns:
        Dictionary with access and refresh tokens
    """
    # Set token expiration times
    access_expires = datetime.timedelta(hours=1)
    refresh_expires = datetime.timedelta(days=30)
    
    # Create additional claims for the token
    additional_claims = {
        'username': user_data['username'],
        'email': user_data['email'],
        'role': user_data['role'],
        'full_name': user_data.get('full_name', '')
    }
    
    # Generate tokens
    access_token = create_access_token(
        identity=user_data['id'],  # Just use the ID as identity
        additional_claims=additional_claims,
        expires_delta=access_expires
    )
    
    refresh_token = create_refresh_token(
        identity=user_data['id'],  # Just use the ID as identity
        additional_claims=additional_claims,
        expires_delta=refresh_expires
    )
    
    return {
        'access_token': access_token,
        'refresh_token': refresh_token,
        'expires_in': int(access_expires.total_seconds())
    }

# Role-based access control decorators
def admin_required(f):
    """Decorator to ensure only admins can access a route"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
            claims = get_jwt()
            if claims.get('role') != ROLE_ADMIN:
                return jsonify({"error": "Admin access required"}), 403
            return f(*args, **kwargs)
        except Exception as e:
            # Fall back to session-based auth for backward compatibility
            if hasattr(g, 'user') and g.user and g.user.get('role') == ROLE_ADMIN:
                return f(*args, **kwargs)
            
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"error": "Admin access required"}), 403
                
            from flask import flash, redirect, url_for
            flash("You need administrator privileges to access this page", "error")
            return redirect(url_for('auth.login'))
    return wrapper

def role_required(roles):
    """Decorator to ensure user has one of the specified roles"""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
                claims = get_jwt()
                if claims.get('role') not in roles:
                    return jsonify({"error": "Insufficient permissions"}), 403
                return f(*args, **kwargs)
            except Exception as e:
                # Fall back to session-based auth for backward compatibility
                if hasattr(g, 'user') and g.user and g.user.get('role') in roles:
                    return f(*args, **kwargs)
                
                if request.is_json or request.path.startswith('/api/'):
                    return jsonify({"error": "Insufficient permissions"}), 403
                    
                from flask import flash, redirect, url_for
                flash("You don't have permission to access this page", "error")
                return redirect(url_for('auth.login'))
        return wrapper
    return decorator

def barista_required(f):
    """Decorator for barista, staff, or admin access"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
            claims = get_jwt()
            if claims.get('role') not in [ROLE_ADMIN, ROLE_STAFF, ROLE_BARISTA]:
                return jsonify({"error": "Barista access required"}), 403
            return f(*args, **kwargs)
        except Exception as e:
            # Fall back to session-based auth for backward compatibility
            if hasattr(g, 'user') and g.user and g.user.get('role') in [ROLE_ADMIN, ROLE_STAFF, ROLE_BARISTA]:
                return f(*args, **kwargs)
            
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"error": "Barista access required"}), 403
                
            from flask import flash, redirect, url_for
            flash("You need barista privileges to access this page", "error")
            return redirect(url_for('auth.login'))
    return wrapper

def staff_required(f):
    """Decorator for staff or admin access"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
            claims = get_jwt()
            if claims.get('role') not in [ROLE_ADMIN, ROLE_STAFF]:
                return jsonify({"error": "Staff access required"}), 403
            return f(*args, **kwargs)
        except Exception as e:
            # Fall back to session-based auth for backward compatibility
            if hasattr(g, 'user') and g.user and g.user.get('role') in [ROLE_ADMIN, ROLE_STAFF]:
                return f(*args, **kwargs)
            
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"error": "Staff access required"}), 403
                
            from flask import flash, redirect, url_for
            flash("You need staff privileges to access this page", "error")
            return redirect(url_for('auth.login'))
    return wrapper

def station_auth(station_id):
    """Check if user is authorized for a specific station"""
    try:
        verify_jwt_in_request()
        claims = get_jwt()
        
        # Admins and staff can access all stations
        if claims.get('role') in [ROLE_ADMIN, ROLE_STAFF]:
            return True
            
        # Baristas can only access their assigned station
        if claims.get('role') == ROLE_BARISTA and claims.get('station_id') == station_id:
            return True
            
        return False
    except Exception as e:
        # Fall back to session-based auth for backward compatibility
        if hasattr(g, 'user') and g.user:
            if g.user.get('role') in [ROLE_ADMIN, ROLE_STAFF]:
                return True
                
            # Check if barista is assigned to this station
            if g.user.get('role') == ROLE_BARISTA:
                # Get station assignment from database or session
                if session.get('station_id') == str(station_id):
                    return True
        
        return False
EOF

# Create JavaScript client for frontend
echo -e "${YELLOW}Creating auth-client.js...${NC}"
cat > static/js/auth-client.js << 'EOF'
/**
 * Authentication utilities for handling both JWT tokens and session auth
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
                const response = await fetch('/auth/login', {
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
                
                const response = await fetch('/auth/login', {
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
                        const userResponse = await fetch('/auth/me', {
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
            await fetch('/auth/logout', {
                method: 'GET',
                credentials: 'include'
            });
            
            // Clear localStorage
            localStorage.removeItem('access_token');
            localStorage.removeItem('user');
            
            // Redirect to login page
            window.location.href = '/auth/login';
            
            return true;
        } catch (error) {
            console.error('Logout error:', error);
            
            // Clear localStorage even if the request fails
            localStorage.removeItem('access_token');
            localStorage.removeItem('user');
            
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
            const response = await fetch('/auth/refresh', {
                method: 'POST',
                credentials: 'include' // Include cookies for refresh token
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
            const response = await fetch('/auth/me', {
                method: 'GET',
                credentials: 'include'
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
            const response = await fetch(`/auth/set-station/${stationId}`, {
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
            
            // Make request
            let response = await fetch(url, {
                ...options,
                headers,
                credentials: 'include' // Include cookies for both auth types
            });
            
            // If token expired (JWT mode only), try to refresh and retry
            if (this._useJwt && response.status === 401) {
                try {
                    await this.refreshToken();
                    
                    // Retry request with new token
                    headers.Authorization = `Bearer ${localStorage.getItem('access_token')}`;
                    
                    response = await fetch(url, {
                        ...options,
                        headers,
                        credentials: 'include'
                    });
                } catch (refreshError) {
                    // If refresh fails, throw original error
                    throw new Error('Session expired. Please log in again.');
                }
            }
            
            // For JSON responses
            if (response.headers.get('content-type')?.includes('application/json')) {
                const data = await response.json();
                
                if (!response.ok) {
                    throw new Error(data.message || 'API request failed');
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
    }
};

// Initialize auth when script loads
document.addEventListener('DOMContentLoaded', () => {
    AuthClient.init();
});
EOF

# Update database with JWT settings
echo -e "${YELLOW}Updating database settings...${NC}"
DB_PATH=$(grep "DB_PATH" config.py | grep -o "'.*'" | sed "s/'//g")
if [ -z "$DB_PATH" ]; then
    DB_PATH="coffee_orders.db"
fi

if [ -f "$DB_PATH" ]; then
    # Execute SQL to update settings
    sqlite3 "$DB_PATH" <<EOF
INSERT OR REPLACE INTO settings (key, value, description, updated_at)
VALUES ('jwt_enabled', 'true', 'Use JWT for authentication', datetime('now'));
EOF

    if [ $? -ne 0 ]; then
        echo -e "${RED}Failed to update database settings.${NC}"
    else
        echo -e "${GREEN}Database settings updated successfully.${NC}"
    fi
else
    echo -e "${YELLOW}Database file not found. Settings will be updated when the application first runs.${NC}"
fi

# Create a simple login script to include auth-client.js
echo -e "${YELLOW}Updating login template with JWT client...${NC}"
mkdir -p templates/auth

# Check if login template exists
if [ ! -f "templates/auth/login.html" ]; then
    # Create a basic login template
    cat > templates/auth/login.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - {{ system_name }}</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='css/styles.css') }}">
    <!-- Include CSRF token if available -->
    {% if csrf_token %}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    {% endif %}
    <!-- Include Auth Client -->
    <script src="{{ url_for('static', filename='js/auth-client.js') }}"></script>
</head>
<body>
    <div class="login-container">
        <div class="login-box">
            <h1>{{ system_name }}</h1>
            <h2>{{ event_name }}</h2>
            
            {% with messages = get_flashed_messages(with_categories=true) %}
                {% if messages %}
                    {% for category, message in messages %}
                        <div class="alert alert-{{ category }}">{{ message }}</div>
                    {% endfor %}
                {% endif %}
            {% endwith %}
            
            <form id="login-form" method="post" action="{{ url_for('auth.login') }}">
                <!-- CSRF token if using form-based auth -->
                {% if csrf_token %}
                <input type="hidden" name="csrf_token" value="{{ csrf_token() }}">
                {% endif %}
                
                <div class="form-group">
                    <label for="username_or_email">Username or Email</label>
                    <input type="text" id="username_or_email" name="username_or_email" required autofocus>
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" name="password" required>
                </div>
                
                <div class="form-group">
                    <button type="submit" class="btn btn-primary">Login</button>
                </div>
                
                <div class="form-links">
                    <a href="{{ url_for('auth.forgot_password') }}">Forgot password?</a>
                </div>
            </form>
            
            <div id="login-error" class="alert alert-error" style="display: none;"></div>
            
            {% if sponsor_info and sponsor_info.message %}
            <div class="sponsor-info">
                {{ sponsor_info.message }}
            </div>
            {% endif %}
        </div>
    </div>
    
    <script>
        // Add JWT-based login for frontend apps
        document.addEventListener('DOMContentLoaded', function() {
            // Check if the AuthClient is available (JWT mode)
            if (window.AuthClient && AuthClient._useJwt) {
                const form = document.getElementById('login-form');
                const errorDiv = document.getElementById('login-error');
                
                form.addEventListener('submit', async function(e) {
                    e.preventDefault();
                    
                    const username = document.getElementById('username_or_email').value;
                    const password = document.getElementById('password').value;
                    
                    try {
                        errorDiv.style.display = 'none';
                        const result = await AuthClient.login(username, password);
                        
                        // Redirect to appropriate page based on role
                        if (result.user && result.user.role) {
                            if (result.user.role === 'admin') {
                                window.location.href = '{{ url_for("admin.dashboard") }}';
                            } else if (result.user.role === 'staff') {
                                window.location.href = '{{ url_for("admin.dashboard") }}';
                            } else if (result.user.role === 'barista') {
                                window.location.href = '{{ url_for("barista.barista_view") }}';
                            } else {
                                window.location.href = '/';
                            }
                        } else {
                            window.location.href = '/';
                        }
                    } catch (error) {
                        errorDiv.textContent = error.message || 'Login failed';
                        errorDiv.style.display = 'block';
                    }
                });
            }
        });
    </script>
</body>
</html>
EOF
    echo "Created new login template"
else
    # Update existing login template to include auth-client.js if it's not already included
    if ! grep -q "auth-client.js" templates/auth/login.html; then
        # Find the closing head tag and insert the script before it
        sed -i 's/<\/head>/    <script src="{{ url_for('"'"'static'"'"', filename='"'"'js\/auth-client.js'"'"') }}"><\/script>\n<\/head>/' templates/auth/login.html
        echo "Updated existing login template with auth-client.js"
    else
        echo "Login template already includes auth-client.js"
    fi
fi

# Create a test script
echo -e "${YELLOW}Creating JWT test script...${NC}"
cat > test_jwt.py << 'EOF'
#!/usr/bin/env python
"""Test JWT functionality of the Expresso Coffee System"""

import os
import jwt
import datetime
import sys
import sqlite3
import logging

def test_jwt_library():
    """Test basic JWT library functionality"""
    try:
        # Create a simple JWT token
        secret_key = "test_secret_key"
        
        # Create payload
        payload = {
            "sub": 1,
            "username": "admin",
            "role": "admin",
            "exp": datetime.datetime.utcnow() + datetime.timedelta(minutes=5)
        }
        
        # Create token
        token = jwt.encode(payload, secret_key, algorithm="HS256")
        
        # Decode token
        decoded = jwt.decode(token, secret_key, algorithms=["HS256"])
        
        print("JWT library functioning correctly!")
        print(f"Token: {token}")
        print(f"Decoded: {decoded}")
        
        return True
    except Exception as e:
        print(f"JWT library test failed: {e}")
        return False

def test_flask_jwt_extended():
    """Test Flask-JWT-Extended integration"""
    try:
        from flask import Flask
        from flask_jwt_extended import JWTManager, create_access_token
        
        # Create minimal Flask app
        app = Flask(__name__)
        app.config["JWT_SECRET_KEY"] = "test_secret_key"
        jwt_manager = JWTManager(app)
        
        # Test token creation in app context
        with app.app_context():
            # Create token with additional claims
            token = create_access_token(
                identity={"id": 1, "username": "admin"},
                additional_claims={
                    "username": "admin",
                    "role": "admin"
                }
            )
            
            print(f"Flask-JWT-Extended token: {token}")
        
        return True
    except Exception as e:
        print(f"Flask-JWT-Extended test failed: {e}")
        return False

def test_database():
    """Test database settings for JWT"""
    try:
        # Try to locate database file
        db_paths = [
            "coffee_orders.db",
            os.getenv("DB_PATH", "")
        ]
        
        for db_path in db_paths:
            if os.path.exists(db_path):
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                
                # Check if settings table exists
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
                if cursor.fetchone():
                    # Check if jwt_enabled setting exists
                    cursor.execute("SELECT value FROM settings WHERE key = 'jwt_enabled'")
                    result = cursor.fetchone()
                    
                    if result:
                        jwt_enabled = result[0]
                        print(f"JWT setting in database: jwt_enabled = {jwt_enabled}")
                    else:
                        print("JWT setting not found in database")
                        # Add it
                        try:
                            cursor.execute(
                                "INSERT INTO settings (key, value, description, updated_at) VALUES (?, ?, ?, ?)",
                                ("jwt_enabled", "true", "Use JWT for authentication", datetime.datetime.now().isoformat())
                            )
                            conn.commit()
                            print("Added jwt_enabled setting to database")
                        except Exception as e:
                            print(f"Failed to add JWT setting: {e}")
                else:
                    print("Settings table not found in database")
                
                conn.close()
                return True
        
        print("Database file not found")
        return False
    except Exception as e:
        print(f"Database test failed: {e}")
        return False

if __name__ == "__main__":
    # Set up basic logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    print("JWT Functionality Test for Expresso Coffee System")
    print("================================================")
    
    # Test JWT library
    print("\nTesting JWT library...")
    jwt_lib_result = test_jwt_library()
    
    # Test Flask-JWT-Extended
    print("\nTesting Flask-JWT-Extended...")
    flask_jwt_result = test_flask_jwt_extended()
    
    # Test database
    print("\nTesting database settings...")
    db_result = test_database()
    
    # Overall result
    print("\nTest Results:")
    print(f"JWT Library: {'✅ Pass' if jwt_lib_result else '❌ Fail'}")
    print(f"Flask-JWT-Extended: {'✅ Pass' if flask_jwt_result else '❌ Fail'}")
    print(f"Database: {'✅ Pass' if db_result else '❌ Fail'}")
    
    # Final status
    all_passed = jwt_lib_result and flask_jwt_result and db_result
    print(f"\nOverall: {'✅ All tests passed!' if all_passed else '❌ Some tests failed'}")
    
    sys.exit(0 if all_passed else 1)
EOF

chmod +x test_jwt.py

echo -e "${GREEN}JWT Authentication setup completed successfully!${NC}"
echo ""
echo "To test JWT functionality, run:"
echo "  python test_jwt.py"
echo ""
echo "To fully migrate to JWT, remember to:"
echo "1. Include auth-client.js in your frontend templates"
echo "2. Update your JavaScript to use the AuthClient for API requests"
echo "3. Test login and all protected routes"
echo ""
echo -e "${YELLOW}Remember to restart your Flask application for changes to take effect.${NC}"
