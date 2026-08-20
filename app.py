import os
import time
import logging
import eventlet
from flask import Flask, request, jsonify, render_template, redirect, url_for, g, session, current_app
from flask_socketio import SocketIO
from flask_cors import CORS  # Added CORS import
import atexit
from datetime import datetime, timedelta

# Import configuration
import config

# Import services
from services.coffee_system import CoffeeOrderSystem
from services.messaging import MessagingService
from services.nlp import NLPService

# Import JWT authentication
from auth import init_app as init_jwt, jwt, generate_tokens

# Import models
try:
    from models.users import User, AdminUser, Settings
except ImportError:
    # Fallback for older version
    from models.users import AdminUser, Settings
    User = AdminUser

from models.orders import Order, CustomerPreference
from models.stations import Station, StationSchedule
from models.inventory import InventoryItem  # Add inventory model import

# Import utils for database connection
from utils.database import get_db_connection, close_connection

# Import routes
# from routes.admin_routes import bp as admin_bp  # Disabled - causes template errors
from routes.admin_redirect import bp as admin_bp  # Simple redirect to avoid errors
from routes.barista_routes import bp as barista_bp  
from routes.customer_routes import bp as customer_bp
from routes.sms_routes import bp as sms_bp
from routes.inventory_routes import bp as inventory_bp  # Add inventory routes import
from routes.station_api_routes import bp as station_api_bp  # Add station API routes import

# Import display routes if it exists
try:
    from routes.display_routes import bp as display_bp
    has_display_routes = True
except ImportError:
    has_display_routes = False
    
# Import auth routes 
try:
    from routes.auth_routes import bp as auth_bp
    has_auth_routes = True
except ImportError:
    has_auth_routes = False
    
# Import staff routes
try:
    from routes.staff_routes import bp as staff_bp
    has_staff_routes = True
except ImportError:
    has_staff_routes = False

# Import API routes
try:
    from routes.api_routes import bp as api_bp
    has_api_routes = True
except ImportError:
    has_api_routes = False

# Import consolidated API routes (new standardized API)
try:
    from routes.consolidated_api_routes import bp as consolidated_api_bp
    has_consolidated_api = True
except ImportError:
    has_consolidated_api = False

# Import display API routes
try:
    from routes.display_api_routes import bp as display_api_bp
    has_display_api_routes = True
except ImportError:
    has_display_api_routes = False

# Import settings API routes
try:
    from routes.settings_api_routes import bp as settings_api_bp
    has_settings_api_routes = True
except ImportError:
    has_settings_api_routes = False
    
# Import chat API routes
try:
    from routes.chat_api_routes import bp as chat_api_bp
    has_chat_api_routes = True
except ImportError:
    has_chat_api_routes = False

# Import new API routes
try:
    from routes.inventory_api_routes import inventory_api_bp
    has_inventory_api_routes = True
except ImportError:
    has_inventory_api_routes = False

try:
    from routes.schedule_api_routes import schedule_api_bp
    has_schedule_api_routes = True
except ImportError:
    has_schedule_api_routes = False

try:
    from routes.user_api_routes import user_api_bp
    has_user_api_routes = True
except ImportError:
    has_user_api_routes = False
    
# Try simple users API as fallback
try:
    from routes.users_simple_api import bp as users_simple_bp
    has_users_simple_api = True
except ImportError:
    has_users_simple_api = False

try:
    from routes.settings_api_routes import settings_api_bp as new_settings_api_bp
    has_new_settings_api_routes = True
except ImportError:
    has_new_settings_api_routes = False

try:
    from routes.group_order_routes import group_order_bp
    has_group_order_routes = True
except ImportError:
    has_group_order_routes = False
    
try:
    from routes.order_status_api import bp as order_status_bp
    has_order_status_api = True
except ImportError:
    has_order_status_api = False

try:
    from routes.health_api import bp as health_bp
    has_health_api = True
except ImportError:
    has_health_api = False

try:
    # Event-readiness aggregator + send-test-SMS endpoint. Optional
    # import so a missing/broken file doesn't blow up boot — Readiness
    # tab will just 404 until fixed.
    from routes.readiness_api import bp as readiness_bp
    has_readiness_api = True
except ImportError:
    has_readiness_api = False

try:
    from routes.support_api_routes import support_api_bp
    has_support_api = True
except ImportError:
    has_support_api = False

try:
    from routes.event_data_routes import bp as event_data_bp
    has_event_data = True
except ImportError:
    has_event_data = False

try:
    from routes.migration_api_routes import migration_api
    has_migration_api = True
except ImportError:
    has_migration_api = False

try:
    from routes.inventory_database_api import inventory_database_api
    has_inventory_database_api = True
except ImportError:
    has_inventory_database_api = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("expresso.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("expresso")

def create_app():
    """Application factory function"""
    app = Flask(__name__, static_folder='static', static_url_path='/static')
    app.secret_key = config.SECRET_KEY

    # Keep the last few hundred warnings/errors in memory so Support ->
    # Diagnostics can show REAL logs. Railway logs to stdout with no file
    # to read back, which is why that endpoint used to return fabricated
    # "Sample log message" entries — diagnostics that lie cost an hour
    # during a live incident. Installed first so startup problems are
    # captured too.
    try:
        from utils import log_buffer
        log_buffer.install()
    except Exception as log_err:  # never block startup for diagnostics
        logger.warning(f"log buffer not installed: {log_err}")

    # Railway (and any other reverse-proxy host) terminates SSL at the
    # edge and forwards the request to the backend container over HTTP.
    # Without ProxyFix, Flask's url_for() and any 308/redirect responses
    # emit `http://...` URLs based on the request it saw — which is the
    # internal HTTP one, not the customer-facing HTTPS one.
    #
    # Symptom the fresh-eyes audit caught:
    #   GET https://.../barista  → 308 Location: http://.../barista/
    # i.e. an HTTPS request gets bounced to an HTTP URL, triggering
    # mixed-content warnings and (in some browsers) outright blocks.
    #
    # ProxyFix tells Flask to trust X-Forwarded-Proto / X-Forwarded-Host
    # set by the Railway proxy, so generated URLs match the original
    # scheme. x_proto=1 says "trust one hop of X-Forwarded-Proto"
    # (Railway is the only proxy in front of us).
    try:
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(
            app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1,
        )
        logger.info("ProxyFix applied (x_for=1, x_proto=1, x_host=1, x_prefix=1)")
    except Exception as e:
        # ProxyFix is shipped with Werkzeug; missing it would be wild.
        # If it ever fails, log loudly and continue — bad redirects are
        # cosmetic, not blocking, so don't take the app down for this.
        logger.warning(f"Could not apply ProxyFix: {e}")
    
    # JWT configuration - use the JWT_SECRET_KEY from config
    app.config['JWT_SECRET_KEY'] = config.JWT_SECRET_KEY
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(seconds=config.JWT_ACCESS_TOKEN_EXPIRES)
    app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(seconds=config.JWT_REFRESH_TOKEN_EXPIRES)
    # 'query_string' added so authenticated GET links opened via
    # window.open(...?jwt=TOKEN) work — window.open can't set an
    # Authorization header, and no JWT cookie is issued at login, so
    # the printable report links (Support → Dashboard: "Print / save
    # as PDF", "Post-event summary") were silently 401-ing in the
    # browser. The frontend already appends ?jwt=; this makes the
    # backend accept it. Tokens are short-lived access tokens opened
    # by an already-authenticated operator — acceptable URL exposure
    # for a same-tab GET.
    app.config['JWT_TOKEN_LOCATION'] = ['headers', 'cookies', 'query_string']
    app.config['JWT_QUERY_STRING_NAME'] = 'jwt'
    app.config['JWT_COOKIE_SECURE'] = config.JWT_COOKIE_SECURE
    app.config['JWT_COOKIE_CSRF_PROTECT'] = config.JWT_COOKIE_CSRF_PROTECT
    
    logger.info(f"JWT configured with access token expiry: {config.JWT_ACCESS_TOKEN_EXPIRES}s")
    logger.info(f"JWT configured with refresh token expiry: {config.JWT_REFRESH_TOKEN_EXPIRES}s")
    
    # Initialize JWT
    init_jwt(app)
    logger.info("JWT authentication initialized")
    
    # Initialize all security features
    try:
        # Core security middleware
        from security_middleware import init_security
        init_security(app)
        logger.info("Security middleware initialized")
        
        # Security monitoring and audit logging
        from security_monitoring import init_security_monitoring
        init_security_monitoring(app)
        logger.info("Security monitoring initialized")
        
        # Enhanced JWT security with blacklisting
        from jwt_security import init_jwt_security
        init_jwt_security(app)
        logger.info("JWT security features initialized")
        
        # Database security and encryption - temporarily disabled due to bytes encoding issue
        # from database_security import init_database_security
        # init_database_security(app)
        logger.info("Database security temporarily disabled")
        
        # Secure error handling
        from error_security import init_secure_error_handling
        init_secure_error_handling(app)
        logger.info("Secure error handling initialized")
        
        logger.info("🛡️ All enterprise-grade security features activated!")
        
    except ImportError as e:
        logger.warning(f"Some security features not available: {e}")
    except Exception as e:
        logger.error(f"Error initializing security features: {e}")
        # Don't fail startup for security feature errors in development
    
    # Production CORS configuration - restrictive by default
    allowed_origins = config.CORS_ALLOWED_ORIGINS
    if isinstance(allowed_origins, str):
        allowed_origins = [origin.strip() for origin in allowed_origins.split(',')]
    
    # Add Railway domain if running on Railway
    railway_domain = os.getenv('RAILWAY_STATIC_URL', '')
    if railway_domain:
        allowed_origins.append(railway_domain)
        allowed_origins.append(railway_domain.replace('https://', 'http://'))  # Both protocols
    
    # Railway's own public domain, so a browser on the deployed site is
    # always allowed. Deliberately NOT a wildcard: the previous code did
    # `allowed_origins.append('*')` here "for same-origin requests", but
    # same-origin requests never consult CORS at all — the wildcard bought
    # the app's own UI nothing while granting every other site on the
    # internet access. It also silently defeated CORS_ALLOWED_ORIGINS:
    # setting that variable correctly did not help, because '*' was
    # appended back on every Railway boot. The startup smell-check below
    # was therefore warning about a state this code guaranteed.
    # Escape hatch: if tightening this ever breaks a deployment that
    # genuinely serves its frontend from another domain, CORS_ALLOW_ANY_ORIGIN
    # restores the old behaviour without a code change or redeploy-to-fix.
    # Off by default — it is the insecure option, so it has to be asked for.
    if os.getenv('CORS_ALLOW_ANY_ORIGIN', '').lower() == 'true':
        logger.warning("CORS_ALLOW_ANY_ORIGIN=true — every origin is allowed. "
                       "Intended as a temporary unblock, not a setting to leave on.")
        allowed_origins.append('*')

    for var in ('RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_STATIC_URL'):
        domain = (os.getenv(var) or '').strip()
        if not domain:
            continue
        host = domain.replace('https://', '').replace('http://', '').strip('/')
        for scheme in ('https://', 'http://'):
            candidate = f"{scheme}{host}"
            if candidate not in allowed_origins:
                allowed_origins.append(candidate)
    
    CORS(app,
         resources={r"/*": {"origins": allowed_origins}},
         supports_credentials=config.CORS_SUPPORTS_CREDENTIALS)
    logger.info(f"CORS initialized with origins: {allowed_origins}")

    # Startup-time CORS smell check. We can't refuse to boot — Railway's
    # health probe needs us up — but a loud warning lets a reviewer
    # (Steve or me, in the next session) catch a misconfigured deploy
    # before it serves a real customer.
    #
    # The two smells we care about:
    #   1. '*' in origins WITH credentials=True — CORS spec forbids this
    #      combination; Flask-CORS works around it by echoing Origin,
    #      but operationally it means "any site can hit our API with the
    #      user's session cookie." For a coffee app the blast radius
    #      is small, but worth flagging.
    #   2. A production environment with no explicit allowed origins
    #      (only the wildcard, only localhost). Means someone forgot to
    #      set CORS_ALLOWED_ORIGINS in Railway env vars.
    try:
        env_name = (os.getenv('FLASK_ENV') or os.getenv('APP_ENV') or '').lower()
        is_prod = env_name in ('production', 'prod') or bool(os.getenv('RAILWAY_ENVIRONMENT'))
        non_wildcard = [o for o in allowed_origins if o and o != '*']
        only_local = all(
            ('localhost' in o or '127.0.0.1' in o) for o in non_wildcard
        ) if non_wildcard else True

        if '*' in allowed_origins and config.CORS_SUPPORTS_CREDENTIALS:
            logger.warning(
                "CORS: wildcard '*' origin combined with credentials=True. "
                "Spec-forbidden — Flask-CORS papers over it by echoing the "
                "Origin header, but any site can carry the user's session "
                "to /api. Set CORS_ALLOWED_ORIGINS to the explicit frontend "
                "URL(s) for production."
            )
        if is_prod and only_local:
            logger.warning(
                "CORS: production-looking environment but no non-localhost "
                "origins are configured. Set CORS_ALLOWED_ORIGINS in Railway "
                "to your frontend URL (e.g. https://yourapp.up.railway.app)."
            )
    except Exception as cors_warn_err:
        # Defensive: if anything in the smell-check throws, do NOT fail
        # startup. The warning is a nicety, not a critical path.
        logger.debug(f"CORS smell-check skipped: {cors_warn_err}")
    
    # NOTE: no manual CORS headers here. Flask-CORS (configured above)
    # already sets them, and this block used to `add` a second copy of
    # each — responses went out with two Allow-Credentials and two
    # Allow-Methods headers. Duplicated CORS headers are invalid and some
    # browsers reject the response outright, which would break any
    # white-label deployment serving the frontend from its own domain.
    # It also asserted Allow-Credentials: true on EVERY response,
    # regardless of what Flask-CORS had decided.
    @app.after_request
    def after_request(response):
        # Only log CORS headers for non-OPTIONS requests to reduce log noise
        if request.method != 'OPTIONS':
            logger.info(f"Added CORS headers to response for: {request.path}")
        return response
    
    # Handle OPTIONS requests explicitly for CORS preflight
    @app.route('/<path:path>', methods=['OPTIONS'])
    def options_handler(path):
        logger.debug(f"Handling OPTIONS request for path: {path}")
        return '', 200
    
    
    # Initialize SocketIO with permissive CORS settings
    socketio = SocketIO(
        app, 
        cors_allowed_origins="*", 
        async_mode='eventlet',
        logger=True,
        engineio_logger=False  # Reduce socket.io engine logs
    )
    logger.info("SocketIO initialized with permissive CORS settings")
    
    # Initialize core services
    try:
        # Get database connection from PostgreSQL, PATIENTLY.
        #
        # This used to be a single attempt that re-raised on failure, so a
        # database that was briefly unreachable killed the process. Railway
        # restarts it, it fails again, and the result is a crash loop that
        # the edge reports as "Application failed to respond" — total
        # outage from a blip. That is what happened on 2026-08-20: over two
        # hours down, while the application code itself was fine.
        #
        # A database restart, failover or brief network wobble is measured
        # in seconds, so wait through it instead of dying. Still gives up
        # eventually — a genuinely misconfigured DATABASE_URL should fail
        # loudly rather than hang forever — but by then the platform has
        # restarted us and we simply wait again, which is the behaviour
        # wanted anyway.
        db = None
        attempts = int(os.getenv('DB_CONNECT_ATTEMPTS', '12'))
        delay = float(os.getenv('DB_CONNECT_DELAY_S', '5'))
        for attempt in range(1, attempts + 1):
            try:
                logger.info("Connecting to PostgreSQL (attempt %d/%d)",
                            attempt, attempts)
                db = get_db_connection(config.DATABASE_URL)
                if attempt > 1:
                    logger.warning("Database reachable after %d attempts "
                                   "(~%.0fs of waiting)", attempt,
                                   (attempt - 1) * delay)
                break
            except Exception as conn_err:
                if attempt >= attempts:
                    logger.error("Database still unreachable after %d "
                                 "attempts over ~%.0fs: %s",
                                 attempts, attempts * delay, conn_err)
                    raise
                logger.warning("Database not reachable yet (%s) — retrying "
                               "in %.0fs", str(conn_err)[:120], delay)
                time.sleep(delay)
        
        coffee_system = CoffeeOrderSystem(db, vars(config))
        logger.info(f"Database initialized successfully using PostgreSQL")

        # Run any pending schema migrations. Replaces (alongside)
        # the scattered ALTER TABLE IF NOT EXISTS calls in
        # coffee_system._init_event_scheduling. Idempotent — safe
        # to run at every boot. See services/migrations.py.
        try:
            from services.migrations import apply_pending_migrations
            applied = apply_pending_migrations(db)
            if applied:
                logger.info(f"Applied schema migrations: {', '.join(applied)}")
        except Exception as mig_err:
            logger.error(f"Schema migrations failed (non-fatal): {mig_err}")
    except Exception as e:
        logger.error(f"Error initializing database with PostgreSQL: {str(e)}")
        raise # Re-raise to fail fast - PostgreSQL is required
    
    messaging_service = MessagingService(
        account_sid=config.TWILIO_ACCOUNT_SID,
        auth_token=config.TWILIO_AUTH_TOKEN,
        phone_number=config.TWILIO_PHONE_NUMBER,
        testing_mode=config.TESTING_MODE
    )

    # Pickup-reminder background service. Sends one gentle SMS
    # to customers whose orders have been 'completed' for >N min
    # without being marked picked_up. Disabled if
    # PICKUP_REMINDER_MINUTES is 0. See services/pickup_reminder.py.
    #
    # WERKZEUG_RUN_MAIN guard: in dev mode with the Flask reloader
    # on, create_app() runs TWICE (once in the parent watcher, once
    # in the child that actually serves). Starting the reminder
    # thread in both would double-fire SMS reminders. Only start
    # in the child (where WERKZEUG_RUN_MAIN == 'true') or when the
    # reloader isn't involved at all (production / no debug).
    _should_start_bg = (
        os.environ.get('WERKZEUG_RUN_MAIN') == 'true'
        or os.environ.get('FLASK_DEBUG', '').lower() not in ('1', 'true')
    )
    if _should_start_bg:
        try:
            from services.pickup_reminder import PickupReminderService
            pickup_reminder = PickupReminderService(db, messaging_service, vars(config))
            pickup_reminder.start()
        except Exception as reminder_err:
            logger.error(
                f"Failed to start pickup-reminder service (non-fatal): {reminder_err}"
            )
            pickup_reminder = None

        # Customer-question timeout sweeper. Marks pending questions as
        # timed_out after QUESTION_TIMEOUT_SECONDS (default 60) and SMSes
        # the customer the "all busy" fallback. See
        # services/question_timeout.py.
        try:
            from services.question_timeout import QuestionTimeoutService
            question_timeout = QuestionTimeoutService(
                db, messaging_service, vars(config),
            )
            question_timeout.set_app(app)
            question_timeout.start()
        except Exception as qto_err:
            logger.error(
                f"Failed to start question-timeout service (non-fatal): {qto_err}"
            )
            question_timeout = None
    else:
        logger.info("Skipping background services in reloader parent process")
        pickup_reminder = None
        question_timeout = None
    
    # Register route blueprints
    app.register_blueprint(admin_bp)
    # NOTE: barista_bp is the LEGACY server-rendered barista UI (Jinja
    # templates at /barista/, /barista/dashboard, ... guarded by the
    # session-based @barista_required). The React SPA fully replaced it
    # and the frontend never calls any /barista/* server endpoint (all
    # its traffic goes through /api/*). Worse, mounting it SHADOWED the
    # SPA: a request to /barista hit this blueprint's `/` route, so Flask
    # 308-redirected /barista -> /barista/, then @barista_required (which
    # looks for a Flask SESSION we never set — we authenticate with a JWT
    # in localStorage) bounced the user to /login. Net effect: refreshing
    # or deep-linking /barista logged the barista out, while /organiser
    # and /support (no such blueprint) worked. Leaving it unregistered
    # lets /barista fall through to the SPA catch_all like the others.
    # app.register_blueprint(barista_bp)  # disabled: shadowed the SPA /barista route
    app.register_blueprint(customer_bp)
    app.register_blueprint(sms_bp)
    app.register_blueprint(inventory_bp)  # Register inventory routes
    logger.info("Inventory routes registered")
    app.register_blueprint(station_api_bp)  # Register station API routes
    logger.info("Station management API routes registered")
    
    if has_display_routes:
        app.register_blueprint(display_bp)
        logger.info("Display routes registered")
        
    if has_auth_routes:
        app.register_blueprint(auth_bp)
        logger.info("Auth routes registered")
    
    if has_staff_routes:
        app.register_blueprint(staff_bp)
        logger.info("Staff routes registered")
        
    # Register consolidated API routes (new standardized API)
    if has_consolidated_api:
        app.register_blueprint(consolidated_api_bp) 
        logger.info("Consolidated API routes registered (standardized API structure)")
        
    # Register API routes blueprint if available
    if has_api_routes:
        app.register_blueprint(api_bp)
        logger.info("API routes registered")
        
    # Register display API routes if available
    if has_display_api_routes:
        app.register_blueprint(display_api_bp)
        logger.info("Display API routes registered")
        
    # Register settings API routes if available
    if has_settings_api_routes:
        app.register_blueprint(settings_api_bp)
        logger.info("Settings API routes registered")
        
    # Register chat API routes if available
    if has_chat_api_routes:
        app.register_blueprint(chat_api_bp)
        logger.info("Chat API routes registered")
    
    # Register new API routes
    if has_inventory_api_routes:
        app.register_blueprint(inventory_api_bp)
        logger.info("Inventory API routes registered")
        
    if has_schedule_api_routes:
        app.register_blueprint(schedule_api_bp)
        logger.info("Schedule API routes registered")
        
    if has_user_api_routes:
        app.register_blueprint(user_api_bp)
        logger.info("User API routes registered")
    elif has_users_simple_api:
        app.register_blueprint(users_simple_bp)
        logger.info("Simple Users API routes registered")
        
    if has_new_settings_api_routes:
        app.register_blueprint(new_settings_api_bp)
        logger.info("New Settings API routes registered")
        
    if has_group_order_routes:
        app.register_blueprint(group_order_bp)
        logger.info("Group Order API routes registered")
        
    if has_order_status_api:
        app.register_blueprint(order_status_bp)
        logger.info("Order Status API routes registered")
        
    if has_health_api:
        app.register_blueprint(health_bp)
        logger.info("Health API routes registered")

    if has_readiness_api:
        app.register_blueprint(readiness_bp)
        logger.info("Readiness API routes registered")

    # Print subsystem: /api/print/* (JWT'd app API) + /cloudprnt (public
    # printer-polling endpoint for the Star mC-Label3 — printers can't
    # OAuth; job delivery is MAC-gated with capability tokens).
    try:
        from routes.print_routes import bp as print_api_bp, cloudprnt_bp
        app.register_blueprint(print_api_bp)
        app.register_blueprint(cloudprnt_bp)
        logger.info("Print API + CloudPRNT routes registered")
    except Exception as print_err:
        logger.error(f"Print routes failed to register: {print_err}")

    # EventsAir Survey Order Channel (BETA): /api/ea/* + `flask ea` CLI.
    # Gated by EA_SURVEY_CHANNEL_ENABLED (default off) — routes exist but
    # refuse work while the flag is down; zero impact on SMS ordering.
    try:
        from routes.ea_survey_routes import bp as ea_survey_bp
        app.register_blueprint(ea_survey_bp)
        logger.info("EA survey channel routes registered (flag: %s)",
                    os.environ.get('EA_SURVEY_CHANNEL_ENABLED', 'false'))
    except Exception as ea_err:
        logger.error(f"EA survey routes failed to register: {ea_err}")
        
    if has_support_api:
        app.register_blueprint(support_api_bp)
        logger.info("Support API routes registered")

    if has_event_data:
        app.register_blueprint(event_data_bp)
        logger.info("Event Data Lifecycle routes registered")

    if has_migration_api:
        app.register_blueprint(migration_api)
        logger.info("Migration API routes registered")
        
    if has_inventory_database_api:
        app.register_blueprint(inventory_database_api)
        logger.info("Inventory Database API routes registered")
    
    # Register React app routes
    try:
        from routes.react_app_routes import bp as react_app_bp
        app.register_blueprint(react_app_bp)
        logger.info("React app routes registered")
    except ImportError:
        logger.warning("React app routes not available")
    
    # Set up shared context
    app.config.update({
        'coffee_system': coffee_system,
        'messaging_service': messaging_service,
        'config': vars(config),
        'socketio': socketio  # Add socketio to app config
    })
    
    # Initialize WebSocket handlers with fixed authentication
    try:
        from routes.websocket_routes_fixed import init_websocket_handlers
        init_websocket_handlers(socketio)
        logger.info("WebSocket handlers initialized with fixed authentication")
    except ImportError:
        try:
            from routes.websocket_routes import init_websocket_handlers
            init_websocket_handlers(socketio)
            logger.info("WebSocket handlers initialized")
        except ImportError:
            logger.warning("WebSocket routes not found, real-time updates disabled")
    
    # Initialize database and create tables if they don't exist
    with app.app_context():
        db = coffee_system.db
        # Create User tables (includes admin users)
        User.create_tables(db)
        
        # Create inventory tables
        InventoryItem.create_tables(db)
        logger.info("Inventory tables created")
        
        # Create settings table if it doesn't exist
        cursor = db.cursor()
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP,
            updated_by VARCHAR(100)
        )
        ''')
        db.commit()
        logger.info("Settings table created or already exists")
        
        # Check if we need to create a default admin user
        cursor = db.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
        admin_count = cursor.fetchone()[0]
        
        if admin_count == 0:
            # Create default admin user if none exists
            default_username = getattr(config, 'DEFAULT_ADMIN_USERNAME', 'admin')
            default_email = getattr(config, 'DEFAULT_ADMIN_EMAIL', 'admin@example.com')
            default_password = getattr(config, 'DEFAULT_ADMIN_PASSWORD', 'adminpassword')
            
            if default_username and default_email and default_password:
                try:
                    User.create(
                        db, default_username, default_email, default_password, 
                        'admin', 'System Administrator'
                    )
                    logger.info(f"Created default admin user: {default_username}")
                except Exception as e:
                    logger.error(f"Failed to create default admin user: {str(e)}")
                
                # Add a warning if using the default password
                if default_password == 'adminpassword':
                    logger.warning("Using default admin password - please change this immediately!")
    
    # Make context available to templates
    @app.context_processor
    def inject_context():
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get settings from database
        cursor = db.cursor()
        
        # System name (default to 'Coffee Cue')
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('system_name',))
        system_name_result = cursor.fetchone()
        system_name = system_name_result[0] if system_name_result else 'Coffee Cue'
        
        # Event name
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('event_name',))
        event_name_result = cursor.fetchone()
        event_name = event_name_result[0] if event_name_result else config.EVENT_NAME
        
        # Check if JWT is enabled
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('jwt_enabled',))
        jwt_enabled_result = cursor.fetchone()
        jwt_enabled = jwt_enabled_result[0].lower() in ('true', 'yes', '1', 't', 'y') if jwt_enabled_result else True
        
        # Sponsor info if enabled
        cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_display_enabled',))
        sponsor_display_result = cursor.fetchone()
        sponsor_display_enabled = sponsor_display_result[0].lower() in ('true', 'yes', '1', 't', 'y') if sponsor_display_result else False
        
        sponsor_info = None
        if sponsor_display_enabled:
            cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_name',))
            sponsor_name_result = cursor.fetchone()
            sponsor_name = sponsor_name_result[0] if sponsor_name_result else ''
            
            cursor.execute("SELECT value FROM settings WHERE key = %s", ('sponsor_message',))
            sponsor_message_result = cursor.fetchone()
            sponsor_message = sponsor_message_result[0] if sponsor_message_result else 'Coffee service proudly sponsored by {sponsor}'
        
        # Format sponsor message
        if sponsor_display_enabled and sponsor_name and '{sponsor}' in sponsor_message:
            sponsor_message = sponsor_message.replace('{sponsor}', sponsor_name)
            sponsor_info = {
                'name': sponsor_name,
                'message': sponsor_message
            }
        
        # Twilio number
        twilio_number = config.TWILIO_PHONE_NUMBER
        
        # App version
        app_version = config.APP_VERSION
        
        return {
            'system_name': system_name,
            'event_name': event_name,
            'twilio_number': twilio_number,
            'app_version': app_version,
            'sponsor_info': sponsor_info,
            'jwt_enabled': jwt_enabled
        }
    
    # User loader before each request (for backward compatibility)
    @app.before_request
    def load_logged_in_user():
        # This is now handled in the auth module's load_user_from_jwt function
        # Keep it empty for backward compatibility
        pass

    # Defensive DB-state reset before every request.
    #
    # coffee_system.db is a SINGLETON connection shared by every handler.
    # If a previous request errored after running a query and didn't call
    # commit() or rollback(), Postgres leaves the connection in
    # "transaction aborted" state — every subsequent query returns
    # "current transaction is aborted, commands ignored until end of
    # transaction block". One bad request poisons the whole app until
    # the container restarts.
    #
    # This hook rolls back any in-flight transaction at the START of
    # every request. Rollback on a clean connection is a no-op (free);
    # rollback on a poisoned connection unsticks it. Net effect: a single
    # failing handler can no longer take the rest of the app down.
    @app.before_request
    def _ensure_db_not_poisoned():
        try:
            from utils.database import ensure_clean_connection
            cs = app.config.get('coffee_system')
            if cs is not None and getattr(cs, 'db', None) is not None:
                ensure_clean_connection(cs.db)
        except Exception:
            # Never block a request just because the defensive cleanup failed.
            pass
    
    # Authentication API endpoints
    @app.route('/api/auth/login', methods=['POST'])
    def api_auth_login():
        """Direct API endpoint for authentication"""
        try:
            if not request.is_json:
                return jsonify({"error": "Request must be JSON"}), 400
            
            data = request.json
            username = data.get('username')
            password = data.get('password')
            
            if not username or not password:
                return jsonify({
                    'status': 'error',
                    'message': 'Username and password are required'
                }), 400
            
            # Get database connection
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Get user from database (case-insensitive username match — see
            # auth.verify_login; baristas type inconsistent capitalisation).
            cursor.execute('SELECT * FROM users WHERE LOWER(username) = LOWER(%s)', (username,))
            user = cursor.fetchone()
            
            if not user:
                logger.warning(f"Failed login attempt for non-existent user: {username}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid username or password'
                }), 401
            
            # Get password hash
            password_hash = user[3]  # Assuming the 4th column is password_hash
            
            # Check if the format is salt:hash
            if ':' in password_hash:
                # Split salt and hash
                salt, hash_value = password_hash.split(':', 1)
                
                # For debugging
                logger.debug(f"Found user {username}, checking password with salt:hash format")
                
                # This is a simple password verification example
                # In production, you would use a proper password hashing library
                import hashlib
                computed_hash = hashlib.sha256(f"{password}{salt}".encode()).hexdigest()
                password_correct = computed_hash == hash_value
            else:
                # Assume it's a werkzeug hash
                from werkzeug.security import check_password_hash
                logger.debug(f"Found user {username}, checking password with werkzeug format")
                password_correct = check_password_hash(password_hash, password)
            
            if not password_correct:
                logger.warning(f"Failed login attempt for user: {username}")
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid username or password'
                }), 401
            
            # Get user ID, username, email, and role
            user_id = user[0]
            username = user[1]
            email = user[2]
            role = user[4]
            full_name = user[5] if len(user) > 5 else ""
            
            # Update last login
            cursor.execute('''
                UPDATE users 
                SET last_login = %s,
                    failed_login_attempts = 0,
                    account_locked = FALSE,
                    account_locked_until = NULL
                WHERE id = %s
            ''', (datetime.now(), user_id))
            conn.commit()
            
            # Create user data for token generation
            user_data = {
                'id': user_id,
                'username': username,
                'email': email,
                'role': role,
                'full_name': full_name
            }
            
            # Generate tokens
            tokens = generate_tokens(user_data)
            
            logger.info(f"User {username} logged in successfully via API")
            
            # Return success response with tokens and user data
            return jsonify({
                'status': 'success',
                'message': 'Login successful',
                'token': tokens['access_token'],
                'refreshToken': tokens['refresh_token'],
                'expiresIn': tokens['expires_in'],
                'user': user_data
            })
            
        except Exception as e:
            logger.error(f"API login error: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': f'Internal server error: {str(e)}'
            }), 500
        finally:
            if 'cursor' in locals() and cursor:
                cursor.close()
            if 'conn' in locals() and conn:
                close_connection(conn)

    # Refresh endpoint is now handled by auth_routes.py blueprint
    # This avoids duplicate route registration
    
    # Orders API routes with direct database access
    @app.route('/api/orders/pending', methods=['GET'])
    def api_orders_pending():
        """Route that returns pending orders directly from database"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Query database for pending orders
            cursor = db.cursor()
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, phone, order_details, queue_priority
                FROM orders 
                WHERE status = 'pending'
                ORDER BY queue_priority, created_at DESC
            ''')
            
            # Process orders
            pending_orders = []
            for order in cursor.fetchall():
                # Extract order details
                order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
                
                # Parse order details
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Format order for frontend
                pending_orders.append({
                    'id': f'order_{order_id}',  # Keep same format as original
                    'order_number': order_number,
                    'customerName': customer_name,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'status': status,
                    'createdAt': created_at,
                    'waitTime': wait_time,
                    'promisedTime': 15,  # Default to 15 minutes
                    'priority': priority == 1  # Convert 1/0 to True/False
                })
            
            return jsonify(pending_orders)
        
        except Exception as e:
            logging.error(f"Error fetching pending orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_pending_orders
                return get_pending_orders()
            return jsonify([])

    @app.route('/api/orders/in-progress', methods=['GET'])
    def api_orders_in_progress():
        """Route that returns in-progress orders directly from database"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Query database for in-progress orders
            cursor = db.cursor()
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, phone, order_details, queue_priority
                FROM orders 
                WHERE status = 'in-progress'
                ORDER BY created_at
            ''')
            
            # Process orders
            in_progress_orders = []
            for order in cursor.fetchall():
                # Extract order details
                order_id, order_number, status, station_id, created_at, phone, order_details_json, priority = order
                
                # Parse order details
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Calculate wait time
                created_dt = datetime.fromisoformat(created_at) if isinstance(created_at, str) else created_at
                wait_time = int((datetime.now() - created_dt).total_seconds() / 60)
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Check for extra hot
                extra_hot = False
                if 'temp' in order_details and order_details['temp'] == 'extra hot':
                    extra_hot = True
                # Also check the notes field for "extra hot" text
                elif 'notes' in order_details and order_details['notes'] and 'extra hot' in order_details['notes'].lower():
                    extra_hot = True
                
                # Format order for frontend
                in_progress_orders.append({
                    'id': f'order_in_progress_{order_id}',
                    'order_number': order_number,
                    'customerName': customer_name,
                    'phoneNumber': phone,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'sugar': order_details.get('sugar', 'No sugar'),
                    'extraHot': extra_hot,
                    'priority': priority == 1,
                    'createdAt': created_at,
                    'waitTime': wait_time,
                    'promisedTime': 15  # Default to 15 minutes
                })
            
            return jsonify(in_progress_orders)
        
        except Exception as e:
            logging.error(f"Error fetching in-progress orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_in_progress_orders
                return get_in_progress_orders()
            return jsonify([])
    
    @app.route('/api/orders/completed', methods=['GET'])
    def api_orders_completed():
        """Route that returns completed orders directly from database"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Query database for completed orders
            cursor = db.cursor()
            cursor.execute('''
                SELECT id, order_number, status, station_id, 
                       created_at, completed_at, picked_up_at, phone, order_details, queue_priority
                FROM orders 
                WHERE status = 'completed'
                ORDER BY completed_at DESC
                LIMIT 20
            ''')
            
            # Process orders
            completed_orders = []
            for order in cursor.fetchall():
                # Extract order details
                order_id, order_number, status, station_id, created_at, completed_at, picked_up_at, phone, order_details_json, priority = order
                
                # Parse order details
                import json
                if isinstance(order_details_json, str):
                    order_details = json.loads(order_details_json)
                else:
                    order_details = order_details_json
                
                # Get customer name
                cursor.execute("SELECT name FROM customer_preferences WHERE phone = %s", (phone,))
                customer_result = cursor.fetchone()
                customer_name = customer_result[0] if customer_result else order_details.get('name', 'Customer')
                
                # Format order for frontend
                completed_orders.append({
                    'id': f'order_completed_{order_id}',
                    'order_number': order_number,
                    'customerName': customer_name,
                    'phoneNumber': phone,
                    'coffeeType': order_details.get('type', 'Coffee'),
                    'milkType': order_details.get('milk', 'Standard'),
                    'completedAt': completed_at,
                    'pickedUpAt': picked_up_at,
                    'pickedUp': picked_up_at is not None
                })
            
            return jsonify(completed_orders)
        
        except Exception as e:
            logging.error(f"Error fetching completed orders: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_completed_orders
                return get_completed_orders()
            return jsonify([])

    @app.route('/api/chat/messages', methods=['GET'])
    def api_chat_messages():
        """Route that returns chat messages from database if available"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            
            # Check if chat_messages table exists
            cursor = db.cursor()
            cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
            table_exists = cursor.fetchone()[0]
            
            if table_exists:
                # Query database for chat messages
                cursor.execute('''
                    SELECT id, sender, content, is_urgent, created_at
                    FROM chat_messages
                    ORDER BY created_at DESC
                    LIMIT 20
                ''')
                
                messages = []
                for msg in cursor.fetchall():
                    msg_id, sender, content, is_urgent, created_at = msg
                    messages.append({
                        'id': msg_id,
                        'sender': sender,
                        'content': content,
                        'created_at': created_at,
                        'is_urgent': bool(is_urgent)
                    })
                
                return jsonify(messages)
            else:
                # If table doesn't exist, fall back to API routes if available
                if has_api_routes:
                    from routes.api_routes import get_chat_messages
                    return get_chat_messages()
                # Otherwise return sample data
                now = datetime.now()
                return jsonify([
                    {
                        'id': 1,
                        'sender': 'System',
                        'content': 'Welcome to the barista chat',
                        'timestamp': now.isoformat(),
                        'is_urgent': False
                    }
                ])
        
        except Exception as e:
            logging.error(f"Error fetching chat messages: {str(e)}")
            # If there's an error, fall back to API routes if available
            if has_api_routes:
                from routes.api_routes import get_chat_messages
                return get_chat_messages()
            return jsonify([])

    @app.route('/api/test', methods=['GET'])
    def api_test():
        """Simple API test endpoint"""
        return jsonify({"status": "success", "message": "API is working"})
    
    @app.route('/debug/static')
    def debug_static():
        """Debug endpoint to check static files"""
        import os
        static_dir = os.path.join(app.root_path, 'static')
        files = []
        if os.path.exists(static_dir):
            files = os.listdir(static_dir)[:10]  # Show first 10 files
        return jsonify({
            "static_directory": static_dir,
            "files_found": files,
            "index_exists": os.path.exists(os.path.join(static_dir, 'index.html'))
        })
    
    @app.route('/debug/users')
    def debug_users():
        """Debug endpoint to check what users exist"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            cursor = db.cursor()
            
            # Get all users
            cursor.execute('SELECT id, username, email, role FROM users')
            users = []
            for user in cursor.fetchall():
                users.append({
                    'id': user[0],
                    'username': user[1], 
                    'email': user[2],
                    'role': user[3]
                })
            
            return jsonify({
                "users_count": len(users),
                "users": users
            })
        except Exception as e:
            return jsonify({
                "error": str(e)
            })
    
    # Special handling for orders endpoints directly
    @app.route('/orders/pending', methods=['GET'])
    def orders_pending():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/pending')
    
    @app.route('/orders/in-progress', methods=['GET'])
    def orders_in_progress():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/in-progress')
    
    @app.route('/orders/completed', methods=['GET'])
    def orders_completed():
        """Redirect old endpoint to API version"""
        return redirect('/api/orders/completed')
    
    @app.route('/orders/<order_id>/start', methods=['POST'])
    def order_start(order_id):
        """Forward to API version"""
        from routes.api_routes import start_order
        return start_order(order_id)
    
    @app.route('/orders/<order_id>/complete', methods=['POST'])
    def order_complete(order_id):
        """Forward to API version"""
        from routes.api_routes import complete_order
        return complete_order(order_id)
    
    @app.route('/orders/<order_id>/pickup', methods=['POST'])
    def order_pickup(order_id):
        """Forward to API version"""
        from routes.api_routes import pickup_order
        return pickup_order(order_id)
    
    @app.route('/orders/<order_id>/message', methods=['POST'])
    def order_message(order_id):
        """Forward to API version"""
        from routes.api_routes import send_message
        return send_message(order_id)
    
    @app.route('/chat/messages', methods=['GET'])
    def chat_messages():
        """Redirect old endpoint to API version"""
        return redirect('/api/chat/messages')
    
    @app.route('/test', methods=['GET'])
    def test():
        """Redirect old endpoint to API version"""
        return redirect('/api/test')
    
    # Debug endpoint for database info
    @app.route('/api/debug/database-info', methods=['GET'])
    def database_info():
        """Get information about the database and its tables"""
        try:
            # Get coffee system from app context
            coffee_system = current_app.config.get('coffee_system')
            db = coffee_system.db
            cursor = db.cursor()
            
            # Get a list of tables
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';")
            tables = [row[0] for row in cursor.fetchall()]
            
            # Get row counts for each table
            table_counts = {}
            for table in tables:
                try:
                    cursor.execute(f"SELECT COUNT(*) FROM {table}")
                    count = cursor.fetchone()[0]
                    table_counts[table] = count
                except:
                    table_counts[table] = "Error counting rows"
            
            # Get sample data from orders if available
            sample_orders = []
            if 'orders' in tables:
                cursor.execute("SELECT * FROM orders LIMIT 3")
                columns = [column[0] for column in cursor.description]
                for row in cursor.fetchall():
                    sample_orders.append(dict(zip(columns, row)))
            
            return jsonify({
                'database_path': current_app.config.get('config')['DATABASE_URL'],
                'database_type': 'PostgreSQL',
                'tables': tables,
                'row_counts': table_counts,
                'sample_orders': sample_orders
            })
        
        except Exception as e:
            return jsonify({
                'error': str(e),
                'database_path': current_app.config.get('config', {}).get('DATABASE_URL', 'Unknown')
            })
    
    # Test endpoint for JWT
    @app.route('/api/auth-test')
    def auth_test():
        """Test endpoint to check JWT authentication status"""
        try:
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            
            verify_jwt_in_request(optional=True)
            current_user = get_jwt_identity()
            
            if current_user:
                claims = get_jwt()
                return jsonify({
                    'status': 'authenticated',
                    'auth_type': 'jwt',
                    'user': {
                        'id': current_user,
                        'username': claims.get('username'),
                        'role': claims.get('role'),
                        'full_name': claims.get('full_name')
                    }
                })
            elif g.user:
                # Session-based authentication
                return jsonify({
                    'status': 'authenticated',
                    'auth_type': 'session',
                    'user': {
                        'id': g.user.get('id'),
                        'username': g.user.get('username'),
                        'role': g.user.get('role'),
                        'full_name': g.user.get('full_name')
                    }
                })
            else:
                return jsonify({
                    'status': 'unauthenticated',
                    'auth_type': 'none'
                })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            })
    
    # Special catch-all route for SPA frontend to handle API requests
    # COMMENTED OUT: This was intercepting legitimate API routes registered by blueprints
    # The blueprints should handle their own routes
    '''
    @app.route('/api/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'])
    def api_proxy(path):
        """
        Special route handler for all API requests that aren't captured by other routes.
        This route ensures API requests still work even if the path isn't registered elsewhere.
        """
        if request.method == 'OPTIONS':
            # Handle CORS preflight requests
            resp = app.make_default_options_response()
            # CORS headers are handled by Flask-CORS extension
            return resp
        
        # Check if this path matches one of our API endpoints (after removing prefix)
        # Convert both to standard forms for comparison
        normalized_path = path.rstrip('/')
        
        # Special handling for common frontend endpoints
        if normalized_path == 'stations':
            # Make sure authentication is present
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle stations API
                from routes.station_api_routes import get_stations
                return get_stations()
            except Exception as e:
                logger.error(f"Error in stations API: {str(e)}")
            
        # Similar handling for inventory
        if normalized_path == 'inventory':
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle inventory API
                from routes.inventory_routes import get_inventory
                return get_inventory()
            except Exception as e:
                logger.error(f"Error in inventory API: {str(e)}")
        
        # Similar handling for schedule
        if normalized_path == 'schedule/today':
            from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
            try:
                verify_jwt_in_request(optional=True)
                current_user = get_jwt_identity()
                
                if not current_user:
                    # Not authenticated
                    return jsonify({
                        "success": False,
                        "error": "Authentication required"
                    }), 401
                
                # Handle schedule API
                from routes.station_api_routes import get_todays_schedule
                return get_todays_schedule()
            except Exception as e:
                logger.error(f"Error in schedule API: {str(e)}")
        
        logger.warning(f"Unhandled API route: /api/{path}")
        
        # Return a more helpful error for frontend
        resp = jsonify({
            "success": False,
            "error": "API endpoint not implemented",
            "path": path
        })
        
        # Add CORS headers
        # CORS headers are handled by Flask-CORS extension
        
        return resp
    ''', 501
    
    # Root route - serve our working index.html
    @app.route('/')
    def index():
        try:
            # Force serving our updated index.html
            import os
            static_dir = os.path.join(app.root_path, 'static')
            index_path = os.path.join(static_dir, 'index.html')
            
            if os.path.exists(index_path):
                with open(index_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return content, 200, {'Content-Type': 'text/html; charset=utf-8'}
            else:
                return "Index file not found", 404
                
        except Exception as e:
            logger.error(f"Error serving index: {e}")
            return jsonify({
                "error": "Could not serve index page",
                "message": str(e),
                "static_dir": app.static_folder
            }), 500
    
    # Ensure login page is served correctly
    @app.route('/login.html')
    def login_page():
        try:
            import os
            static_dir = os.path.join(app.root_path, 'static')
            login_path = os.path.join(static_dir, 'login.html')
            
            if os.path.exists(login_path):
                with open(login_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return content, 200, {'Content-Type': 'text/html; charset=utf-8'}
            else:
                return "Login page not found", 404
                
        except Exception as e:
            logger.error(f"Error serving login page: {e}")
            return f"Error loading login: {str(e)}", 500
    
    # Handle React build static files - use a different path to avoid Flask conflicts
    @app.route('/assets/<path:filename>')
    def react_static(filename):
        # Serve static files from the React build
        from flask import send_from_directory
        import os
        # Map /assets/css/file.css to /static/static/css/file.css
        static_dir = os.path.join(app.root_path, 'static', 'static')
        logger.info(f"Serving static file: {filename} from {static_dir}")
        try:
            return send_from_directory(static_dir, filename)
        except Exception as e:
            logger.error(f"Error serving static file {filename}: {e}")
            return jsonify({"error": f"Static file not found: {filename}"}), 404
    
    # Also handle requests to /static/js/ for React chunk files
    @app.route('/static/js/<path:filename>')
    def react_js_static(filename):
        # Serve JS files from the React build
        from flask import send_from_directory
        import os
        static_dir = os.path.join(app.root_path, 'static', 'static', 'js')
        logger.info(f"Serving JS file: {filename} from {static_dir}")
        try:
            return send_from_directory(static_dir, filename)
        except Exception as e:
            logger.error(f"Error serving JS file {filename}: {e}")
            return jsonify({"error": f"JS file not found: {filename}"}), 404
    
    # Handle requests to /static/css/ for React CSS files
    @app.route('/static/css/<path:filename>')
    def react_css_static(filename):
        # Serve CSS files from the React build
        from flask import send_from_directory
        import os
        static_dir = os.path.join(app.root_path, 'static', 'static', 'css')
        logger.info(f"Serving CSS file: {filename} from {static_dir}")
        try:
            return send_from_directory(static_dir, filename)
        except Exception as e:
            logger.error(f"Error serving CSS file {filename}: {e}")
            return jsonify({"error": f"CSS file not found: {filename}"}), 404
    
    # Serve favicon, manifest, and logo files from static directory
    @app.route('/favicon.ico')
    def favicon():
        return app.send_static_file('favicon.ico')
    
    @app.route('/manifest.json')
    def manifest():
        return app.send_static_file('manifest.json')
    
    @app.route('/logo192.png')
    def logo192():
        return app.send_static_file('logo192.png')
    
    @app.route('/logo512.png')
    def logo512():
        return app.send_static_file('logo512.png')
    
    # Serve JavaScript helper files from static directory
    @app.route('/coffee-sounds.js')
    def coffee_sounds():
        return app.send_static_file('coffee-sounds.js')
    
    @app.route('/fix-localstorage.js')
    def fix_localstorage():
        return app.send_static_file('fix-localstorage.js')
    
    @app.route('/auto-test.js')
    def auto_test():
        return app.send_static_file('auto-test.js')
    
    @app.route('/display-helper.js')
    def display_helper():
        return app.send_static_file('display-helper.js')
    
    @app.route('/display-scaling.css')
    def display_scaling():
        return app.send_static_file('display-scaling.css')
    
    # Catch-all route - serve React app for client-side routing
    @app.route('/<path:path>')
    def catch_all(path):
        # Skip API routes - those should already be handled by specific routes
        if path.startswith('api/'):
            return jsonify({"error": "API endpoint not found"}), 404
        
        # Skip auth routes that should be handled by Flask
        if path.startswith('auth/'):
            return jsonify({"error": "Auth endpoint not found"}), 404
            
        # For static files, let Flask handle them normally
        if path.startswith('static/'):
            return app.send_static_file(path[7:])  # Remove 'static/' prefix
            
        # For all other routes, serve the React app (SPA routing)
        try:
            return app.send_static_file('index.html')
        except Exception as e:
            logger.warning(f"Could not serve React app for path {path}: {e}")
            return jsonify({
                "message": "React app not built",
                "requested_path": path,
                "build_command": "cd 'Barista Front End' && npm run build"
            }), 404
    
    # Clean up resources when app is shutting down
    @atexit.register
    def cleanup():
        logger.info("Application shutting down, cleaning up resources...")
        coffee_system = app.config.get('coffee_system')
        if coffee_system and hasattr(coffee_system, 'db'):
            close_connection(coffee_system.db)
            logger.info("Database connection closed")
    
    return app, socketio

# Main execution
if __name__ == '__main__':
    app, socketio = create_app()
    # Changed port to 5001 to match React proxy setting
    port = 5001
    debug = getattr(config, 'DEBUG', True)  # Set debug to True for more verbose output
    logger.info(f"Starting Coffee Cue System on port {port}")
    socketio.run(app, debug=debug, host='0.0.0.0', port=port, allow_unsafe_werkzeug=True)