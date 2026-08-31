"""
Security middleware and enhancements for Flask application
"""
from flask import request, jsonify, current_app
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash
import re
import bleach
from functools import wraps
import logging
import os

logger = logging.getLogger(__name__)

# Initialize rate limiter.
#
# TESTING_MODE disables the default per-client limits so end-to-end
# scripts can place dozens of orders in quick succession without
# hitting any cap.
#
# In production the original "50/hour" default was tuned for a
# brochure-site, not a busy café — an event with 3 stations easily
# does 200+ orders/hour, and the React frontend polls /api/orders
# every 15 seconds on top of that. Steve hit the cap during normal
# testing and saw orders silently vanish (frontend can't create
# them, can't refresh the list, etc.). Bumped to something more
# event-appropriate.
_testing = os.getenv('TESTING_MODE', 'False').lower() == 'true'
# Env override so the operator can dial these without code changes.
_default_hourly = int(os.getenv('RATELIMIT_HOURLY', '5000'))
_default_daily = int(os.getenv('RATELIMIT_DAILY', '50000'))
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[] if _testing else [f"{_default_daily} per day", f"{_default_hourly} per hour"],
    storage_uri="memory://",
    enabled=not _testing,
)

# Public, attendee-facing pages that an event app is expected to EMBED.
# EventsAir's Static Content module hosts an iframe — that is how other
# events run their ePosters app — and it is a much better experience than
# a link: the page lives inside the app, so someone can come back to their
# order without leaving it.
#
# Framing is allowed ONLY for these. Everything else keeps DENY, because
# the clickjacking risk is real for the screens that matter: a framed
# /barista or /support could be overlaid to trick a logged-in operator
# into clicking something. These pages have no session to hijack — they
# are anonymous ordering surfaces — so there is nothing to steal by
# framing them.
EMBEDDABLE_PREFIXES = ('/my', '/order', '/how', '/display', '/sign')


def _is_embeddable(path):
    path = (path or '').rstrip('/') or '/'
    return any(path == p or path.startswith(p + '/') or path.startswith(p + '?')
               for p in EMBEDDABLE_PREFIXES)


def add_security_headers(response):
    """Add comprehensive security headers to all responses"""
    embeddable = _is_embeddable(request.path)

    # Prevent clickjacking — except on the anonymous pages an event app
    # is meant to embed.
    if embeddable:
        # X-Frame-Options has no "any origin" value; omitting it and
        # letting frame-ancestors govern is the modern, correct way.
        response.headers.pop('X-Frame-Options', None)
    else:
        response.headers['X-Frame-Options'] = 'DENY'
    
    # Prevent MIME type sniffing
    response.headers['X-Content-Type-Options'] = 'nosniff'
    
    # Enable XSS protection
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # Enhanced Content Security Policy
    csp_directives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' ws: wss:",
        # Display background videos are stored as data: URLs (uploaded clips)
        # or pasted https: URLs, so media-src must allow both — mirrors img-src.
        "media-src 'self' data: https: blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        # Attendee pages: NO frame-ancestors directive at all.
        #
        # 'frame-ancestors *' was not enough. Per CSP, the * wildcard
        # matches network schemes only — it explicitly does NOT match
        # file:, data: or blob:. The EventsAir attendee app is a Cordova
        # app whose own document is loaded from file:// on iOS, so its
        # frames were refused while the very same page embedded fine from
        # https:// in a desktop browser. That is exactly what we saw: it
        # worked in Chrome against wwevents.attendee.eventsair.com and was
        # blank in the native app, every time.
        #
        # The ePosters app that works in that same app ships no CSP at
        # all, which is why it was never affected.
        #
        # Omitting the directive is deliberate rather than lazy: naming
        # schemes (file: capacitor: ionic:) would have to guess at every
        # wrapper a client's app might use, and guessing wrong looks
        # identical to being blocked. These pages hold no session and no
        # personal data — the staff screens, which do, keep
        # frame-ancestors 'none' and X-Frame-Options: DENY.
        None if embeddable else "frame-ancestors 'none'",
        "upgrade-insecure-requests"
    ]
    response.headers['Content-Security-Policy'] = "; ".join(
        d for d in csp_directives if d)
    
    # Report-Only CSP for monitoring (optional)
    # response.headers['Content-Security-Policy-Report-Only'] = "; ".join(csp_directives)
    
    # Strict Transport Security (for HTTPS)
    if request.is_secure:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
    
    # Referrer Policy
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    
    # Enhanced Permissions Policy
    permissions_policy = [
        'geolocation=()',
        'microphone=()',
        'camera=()',
        'accelerometer=()',
        'autoplay=()',
        'encrypted-media=()',
        'fullscreen=(self)',
        'gyroscope=()',
        'magnetometer=()',
        'payment=()',
        'usb=()'
    ]
    response.headers['Permissions-Policy'] = ', '.join(permissions_policy)
    
    # Cross-Origin policies
    response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    response.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
    
    # Cache control for sensitive pages
    if request.path.startswith('/admin') or request.path.startswith('/api/auth'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    
    return response

def validate_input(data, field_type='text'):
    """Validate and sanitize input data"""
    if data is None:
        return None
        
    # Convert to string for processing
    data = str(data)
    
    # Remove any potential SQL injection attempts
    sql_keywords = ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'UNION', 'SELECT', '--', '/*', '*/', 'xp_', 'sp_']
    for keyword in sql_keywords:
        if keyword.lower() in data.lower():
            logger.warning(f"Potential SQL injection attempt detected: {data}")
            return None
    
    # Field-specific validation
    if field_type == 'email':
        # Basic email validation
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        if not re.match(email_pattern, data):
            return None
            
    elif field_type == 'phone':
        # Phone number validation (international format)
        phone_pattern = r'^\+?[1-9]\d{1,14}$'
        cleaned_phone = re.sub(r'[\s\-\(\)]', '', data)
        if not re.match(phone_pattern, cleaned_phone):
            return None
        data = cleaned_phone
        
    elif field_type == 'username':
        # Username validation (alphanumeric and underscore only)
        username_pattern = r'^[a-zA-Z0-9_]{3,30}$'
        if not re.match(username_pattern, data):
            return None
            
    elif field_type == 'text':
        # General text sanitization
        data = bleach.clean(data, tags=[], strip=True)
        
    elif field_type == 'integer':
        # Integer validation
        try:
            return int(data)
        except ValueError:
            return None
            
    return data

def validate_password_strength(password):
    """Validate password meets security requirements"""
    if len(password) < 12:
        return False, "Password must be at least 12 characters long"
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
        
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
        
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
        
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special character"
        
    # Check for common weak passwords
    weak_passwords = ['password123', 'admin123', 'coffee123', '12345678', 'qwerty123']
    if password.lower() in weak_passwords:
        return False, "This password is too common. Please choose a stronger password"
        
    return True, "Password is strong"

def require_https(f):
    """Decorator to require HTTPS in production"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not request.is_secure and not current_app.debug:
            return jsonify({
                'success': False,
                'message': 'HTTPS required'
            }), 403
        return f(*args, **kwargs)
    return decorated_function

def sanitize_filename(filename):
    """Sanitize uploaded filenames"""
    # Remove any path components
    filename = filename.replace('/', '').replace('\\', '')
    
    # Remove special characters
    filename = re.sub(r'[^a-zA-Z0-9._-]', '', filename)
    
    # Limit length
    name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
    if len(name) > 50:
        name = name[:50]
    
    return f"{name}.{ext}" if ext else name

# Rate limiting decorators for specific endpoints
auth_limiter = limiter.limit("5 per minute")
api_limiter = limiter.limit("100 per minute")
sms_limiter = limiter.limit("10 per minute")

def init_security(app):
    """Initialize security features for the Flask app"""
    # Initialize rate limiter
    limiter.init_app(app)
    
    # Add security headers to all responses
    app.after_request(add_security_headers)
    
    # Configure secure session cookies
    app.config.update(
        SESSION_COOKIE_SECURE=True,  # Only send cookies over HTTPS
        SESSION_COOKIE_HTTPONLY=True,  # Prevent JavaScript access
        SESSION_COOKIE_SAMESITE='Lax',  # CSRF protection
        PERMANENT_SESSION_LIFETIME=3600  # 1 hour session timeout
    )
    
    return app