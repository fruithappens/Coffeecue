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
import ipaddress
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
# Limits are off only on a laptop copy. demo.cupq.app runs TESTING_MODE
# (texts stubbed) on the public internet, and TESTING_MODE used to switch
# every limit off there too: login guessing, kiosk PINs and sign-ups had no
# cap (found 1 Nov 2026, audit SEC-005; Steve: turn them on). Railway sets
# RAILWAY_ENVIRONMENT on every server. RATELIMIT_ENABLED=true/false
# overrides either way (false for a load test on demo:
# docs/FAILURE_DRILLS.md).
_on_server = bool(os.getenv('RAILWAY_ENVIRONMENT') or os.getenv('RAILWAY_PUBLIC_DOMAIN'))
_limits_setting = os.getenv('RATELIMIT_ENABLED', '').strip().lower()
if _limits_setting in ('true', '1', 'yes'):
    _limits_on = True
elif _limits_setting in ('false', '0', 'no'):
    _limits_on = False
else:
    _limits_on = _on_server or not _testing
# Env override so the operator can dial these without code changes.
_default_hourly = int(os.getenv('RATELIMIT_HOURLY', '5000'))
_default_daily = int(os.getenv('RATELIMIT_DAILY', '50000'))
# Cloudflare's own addresses (https://www.cloudflare.com/ips, fetched
# 1 Nov 2026). Only a request that arrives FROM one of these can vouch for
# the caller with CF-Connecting-IP.
_CLOUDFLARE_NETS = [ipaddress.ip_network(n) for n in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)]


def _from_cloudflare(addr):
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in _CLOUDFLARE_NETS)


def _client_ip():
    """Rate-limit key: the REAL client, which the caller can't choose.

    request.remote_addr is the address that connected to Railway's edge
    (ProxyFix x_for=1 takes the hop Railway appends; anything the caller
    put in X-Forwarded-For sits before it). Probed 1 Nov 2026 on both
    copies: through Cloudflare AND straight at the *.up.railway.app
    address, it is the caller's own address, and made-up CF-Connecting-IP
    / X-Forwarded-For headers are ignored.

    The old key read CF-Connecting-IP first, from anyone, so a caller
    going straight to the Railway address could name a fresh bucket on
    every request and skip the login, PIN, reset and sign-up limits
    (audit SEC-005). CF-Connecting-IP is now believed only when the
    connection itself came from Cloudflare (as it did in Sept 2026, when
    remote_addr was a rotating Cloudflare edge and no bucket ever filled).
    """
    remote = get_remote_address()
    try:
        if remote and _from_cloudflare(remote):
            cf = (request.headers.get('CF-Connecting-IP') or '').strip()
            if cf:
                return cf
    except Exception:
        pass
    return remote


limiter = Limiter(
    key_func=_client_ip,
    default_limits=[f"{_default_daily} per day", f"{_default_hourly} per hour"] if _limits_on else [],
    storage_uri="memory://",
    enabled=_limits_on,
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


# The live demo (/try) may be framed by the marketing site only, so
# visitors try it without leaving cupq.com.au (Steve, 16 Oct 2026). It holds
# no session, and naming the one site keeps every other site refused.
TRY_FRAME_ANCESTORS = "'self' " + (os.getenv('TRY_FRAME_ORIGINS')
                                   or 'https://cupq.com.au https://www.cupq.com.au')


def _is_try_page(path):
    path = (path or '').rstrip('/')
    return path == '/try' or path.startswith('/try/')


def _is_embeddable(path):
    path = (path or '').rstrip('/') or '/'
    return any(path == p or path.startswith(p + '/') or path.startswith(p + '?')
               for p in EMBEDDABLE_PREFIXES)


def add_security_headers(response):
    """Add comprehensive security headers to all responses"""
    embeddable = _is_embeddable(request.path)
    try_page = _is_try_page(request.path)

    # Prevent clickjacking — except on the anonymous pages an event app
    # is meant to embed, and the demo on cupq.com.au.
    if embeddable or try_page:
        # X-Frame-Options has no "any origin" value; omitting it and
        # letting frame-ancestors govern is the modern, correct way.
        response.headers.pop('X-Frame-Options', None)
    else:
        # SAMEORIGIN, not DENY: the Demo Room (/demo) shows the barista
        # screen in a frame on cupq.app itself. Clickjacking needs a
        # page on ANOTHER site to do the framing, and that stays refused.
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    
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
        # frame-ancestors 'self' and X-Frame-Options: SAMEORIGIN (only
        # cupq.app's own pages may frame them).
        None if embeddable else (f"frame-ancestors {TRY_FRAME_ANCESTORS}" if try_page
                                 else "frame-ancestors 'self'"),
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
        # The badge scan (components/display/BadgeScanner.js) reads the QR on
        # an EventsAir badge through the phone's camera. Our own pages only;
        # nothing embedded from elsewhere may ask for it.
        'camera=(self)',
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

# The public attendee pages a whole venue polls from ONE address.
#
# At a venue everyone on the wifi shares one public IP. A phone following
# its order polls every 8 seconds (450 an hour), so the 5,000/hour default
# cut the room off after about a dozen phones, and the TV board with it:
# "429 Too Many Requests" for the rest of the hour (found by the 1,000-phone
# load test, 13 Oct 2026; reproduced locally). These reads get a cap sized
# for a full room instead of none: 12,000 a minute from one address is
# ~1,600 phones. Everything else keeps the default, and every explicit
# limit (login, device PIN, the demo form) is unchanged.
PUBLIC_POLL_READS = (
    "/api/orders/<order_id>/track",
    "/api/display/orders",
    "/api/display/menu",
    "/api/display/config",
    "/api/display/bg-video",
    "/api/sponsors",
    "/api/notices/active",
    "/api/ea/me",
    "/api/public/status",
    "/api/event-access/public",
    "/api/health",
)
_venue_read_limit = os.getenv('RATELIMIT_VENUE_READS', '12000 per minute')


def size_public_reads_for_venue(app):
    """Give PUBLIC_POLL_READS the venue-sized cap. Call after every
    blueprint is registered. Returns the paths it found, so a renamed
    route shows up as missing in the unit test rather than silently
    falling back to the 5,000/hour default."""
    found = []
    for rule in app.url_map.iter_rules():
        if rule.rule in PUBLIC_POLL_READS and "GET" in (rule.methods or ()):
            view = app.view_functions.get(rule.endpoint)
            if view is not None and not getattr(view, "_cupq_venue_sized", False):
                # The limit is checked INSIDE the wrapper limit() returns,
                # so it has to replace the view. Decorating and discarding
                # the wrapper takes the route off the default limit and
                # checks nothing (seen locally: no cap at all).
                wrapped = limiter.limit(_venue_read_limit, key_func=_client_ip, methods=["GET"])(view)
                wrapped._cupq_venue_sized = True
                app.view_functions[rule.endpoint] = wrapped
                found.append(rule.rule)
    return sorted(set(found))


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