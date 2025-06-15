"""
Enhanced database security features and connection encryption
"""
import logging
import ssl
import os
from urllib.parse import urlparse, parse_qs
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
import sqlalchemy
from sqlalchemy import create_engine, text
from sqlalchemy.pool import QueuePool
import hashlib
import secrets

logger = logging.getLogger(__name__)

class SecureDatabaseConnection:
    """Enhanced database connection with security features"""
    
    def __init__(self, database_url, ssl_mode='require', connection_timeout=30):
        """
        Initialize secure database connection
        
        Args:
            database_url: Database connection URL
            ssl_mode: SSL mode (disable, allow, prefer, require, verify-ca, verify-full)
            connection_timeout: Connection timeout in seconds
        """
        self.database_url = database_url
        self.ssl_mode = ssl_mode
        self.connection_timeout = connection_timeout
        self.connection_pool = None
        
        # Parse URL for security validation
        self.parsed_url = urlparse(database_url)
        self._validate_connection_security()
    
    def _validate_connection_security(self):
        """Validate database connection security settings"""
        # Check for plaintext credentials in URL
        if self.parsed_url.password:
            logger.warning("Database password found in URL - consider using environment variables")
        
        # Validate SSL mode
        valid_ssl_modes = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']
        if self.ssl_mode not in valid_ssl_modes:
            raise ValueError(f"Invalid SSL mode: {self.ssl_mode}")
        
        # Warn about insecure SSL modes in production
        if self.ssl_mode in ['disable', 'allow'] and not os.getenv('DEBUG', 'False').lower() == 'true':
            logger.warning(f"Insecure SSL mode '{self.ssl_mode}' detected in production")
    
    def create_secure_connection_pool(self, min_connections=1, max_connections=20):
        """Create a secure connection pool with SSL"""
        try:
            # Build connection parameters
            connection_params = {
                'host': self.parsed_url.hostname,
                'port': self.parsed_url.port or 5432,
                'database': self.parsed_url.path.lstrip('/'),
                'user': self.parsed_url.username,
                'password': self.parsed_url.password or '',
                'sslmode': self.ssl_mode,
                'connect_timeout': self.connection_timeout,
                'application_name': 'expresso_coffee_system'
            }
            
            # Add SSL certificate paths if provided
            ssl_cert = os.getenv('DB_SSL_CERT')
            ssl_key = os.getenv('DB_SSL_KEY')
            ssl_ca = os.getenv('DB_SSL_CA')
            
            if ssl_cert:
                connection_params['sslcert'] = ssl_cert
            if ssl_key:
                connection_params['sslkey'] = ssl_key
            if ssl_ca:
                connection_params['sslrootcert'] = ssl_ca
            
            # Create connection pool
            self.connection_pool = pool.ThreadedConnectionPool(
                minconn=min_connections,
                maxconn=max_connections,
                **connection_params
            )
            
            logger.info(f"Secure database connection pool created with SSL mode: {self.ssl_mode}")
            
            # Test connection and log SSL status
            conn = self.get_connection()
            cursor = conn.cursor()
            
            # Check SSL status
            cursor.execute("SELECT ssl_is_used();")
            ssl_used = cursor.fetchone()[0]
            
            if ssl_used:
                cursor.execute("SELECT version();")
                db_version = cursor.fetchone()[0]
                logger.info(f"SSL connection established to: {db_version}")
            else:
                logger.warning("SSL not used for database connection")
            
            self.return_connection(conn)
            
        except Exception as e:
            logger.error(f"Failed to create secure database connection: {e}")
            raise
    
    def get_connection(self):
        """Get a connection from the pool"""
        if not self.connection_pool:
            raise RuntimeError("Connection pool not initialized")
        
        return self.connection_pool.getconn()
    
    def return_connection(self, conn):
        """Return a connection to the pool"""
        if self.connection_pool:
            self.connection_pool.putconn(conn)
    
    def close_all_connections(self):
        """Close all connections in the pool"""
        if self.connection_pool:
            self.connection_pool.closeall()

class DatabaseSecurityManager:
    """Database security management and monitoring"""
    
    def __init__(self, db_connection):
        self.db_connection = db_connection
    
    def create_security_tables(self):
        """Create security-related database tables"""
        conn = self.db_connection.get_connection()
        cursor = conn.cursor()
        
        try:
            # Create security audit log table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS security_audit_log (
                    id SERIAL PRIMARY KEY,
                    event_type VARCHAR(50) NOT NULL,
                    user_id INTEGER,
                    ip_address INET,
                    user_agent TEXT,
                    event_data JSONB,
                    severity VARCHAR(20) DEFAULT 'medium',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # Create failed login attempts table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS failed_login_attempts (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(100) NOT NULL,
                    ip_address INET NOT NULL,
                    attempt_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    user_agent TEXT
                );
            """)
            
            # Create session blacklist table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS token_blacklist (
                    id SERIAL PRIMARY KEY,
                    jti VARCHAR(100) UNIQUE NOT NULL,
                    user_id INTEGER,
                    blacklisted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL
                );
            """)
            
            # Create active sessions table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS active_sessions (
                    id SERIAL PRIMARY KEY,
                    jti VARCHAR(100) UNIQUE NOT NULL,
                    user_id INTEGER NOT NULL,
                    ip_address INET,
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL
                );
            """)
            
            # Create indexes for performance
            security_indexes = [
                "CREATE INDEX IF NOT EXISTS idx_security_audit_event_type ON security_audit_log(event_type);",
                "CREATE INDEX IF NOT EXISTS idx_security_audit_user_id ON security_audit_log(user_id);",
                "CREATE INDEX IF NOT EXISTS idx_security_audit_created_at ON security_audit_log(created_at);",
                "CREATE INDEX IF NOT EXISTS idx_failed_login_username ON failed_login_attempts(username);",
                "CREATE INDEX IF NOT EXISTS idx_failed_login_ip ON failed_login_attempts(ip_address);",
                "CREATE INDEX IF NOT EXISTS idx_failed_login_time ON failed_login_attempts(attempt_time);",
                "CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(jti);",
                "CREATE INDEX IF NOT EXISTS idx_active_sessions_jti ON active_sessions(jti);",
                "CREATE INDEX IF NOT EXISTS idx_active_sessions_user_id ON active_sessions(user_id);"
            ]
            
            for index_sql in security_indexes:
                cursor.execute(index_sql)
            
            conn.commit()
            logger.info("Security database tables created successfully")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error creating security tables: {e}")
            raise
        finally:
            self.db_connection.return_connection(conn)
    
    def log_security_event(self, event_type, user_id=None, ip_address=None, 
                          user_agent=None, event_data=None, severity='medium'):
        """Log security event to database"""
        conn = self.db_connection.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO security_audit_log 
                (event_type, user_id, ip_address, user_agent, event_data, severity)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (event_type, user_id, ip_address, user_agent, event_data, severity))
            
            conn.commit()
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error logging security event: {e}")
        finally:
            self.db_connection.return_connection(conn)
    
    def record_failed_login(self, username, ip_address, user_agent=None):
        """Record failed login attempt"""
        conn = self.db_connection.get_connection()
        cursor = conn.cursor()
        
        try:
            cursor.execute("""
                INSERT INTO failed_login_attempts (username, ip_address, user_agent)
                VALUES (%s, %s, %s)
            """, (username, ip_address, user_agent))
            
            conn.commit()
            
            # Check for brute force attack
            cursor.execute("""
                SELECT COUNT(*) FROM failed_login_attempts 
                WHERE ip_address = %s AND attempt_time > NOW() - INTERVAL '1 hour'
            """, (ip_address,))
            
            recent_attempts = cursor.fetchone()[0]
            
            if recent_attempts >= 5:
                self.log_security_event(
                    'brute_force_attack',
                    ip_address=ip_address,
                    event_data={'attempts': recent_attempts, 'username': username},
                    severity='high'
                )
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error recording failed login: {e}")
        finally:
            self.db_connection.return_connection(conn)
    
    def cleanup_expired_tokens(self):
        """Clean up expired tokens and sessions"""
        conn = self.db_connection.get_connection()
        cursor = conn.cursor()
        
        try:
            # Clean up expired blacklisted tokens
            cursor.execute("""
                DELETE FROM token_blacklist WHERE expires_at < NOW()
            """)
            
            # Clean up expired sessions
            cursor.execute("""
                DELETE FROM active_sessions WHERE expires_at < NOW()
            """)
            
            # Clean up old failed login attempts (older than 24 hours)
            cursor.execute("""
                DELETE FROM failed_login_attempts 
                WHERE attempt_time < NOW() - INTERVAL '24 hours'
            """)
            
            # Clean up old security audit logs (older than 90 days)
            cursor.execute("""
                DELETE FROM security_audit_log 
                WHERE created_at < NOW() - INTERVAL '90 days'
            """)
            
            conn.commit()
            logger.info("Expired security data cleaned up")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error cleaning up expired data: {e}")
        finally:
            self.db_connection.return_connection(conn)

class SQLInjectionPrevention:
    """SQL injection prevention utilities"""
    
    @staticmethod
    def validate_query_parameters(params):
        """Validate query parameters for SQL injection attempts"""
        dangerous_patterns = [
            r'(\s|^)(union|select|insert|update|delete|drop|create|alter|exec|execute|script)\s',
            r'(\s|^)(or|and)\s+\w+\s*=\s*\w+',
            r'[\'";].*?(\s|$)',
            r'--.*$',
            r'/\*.*?\*/',
            r'xp_\w+',
            r'sp_\w+'
        ]
        
        import re
        
        for key, value in params.items():
            value_str = str(value).lower()
            for pattern in dangerous_patterns:
                if re.search(pattern, value_str, re.IGNORECASE):
                    logger.warning(f"Potential SQL injection detected in parameter {key}: {value}")
                    return False, f"Invalid parameter: {key}"
        
        return True, None
    
    @staticmethod
    def escape_like_wildcards(value):
        """Escape wildcards in LIKE queries"""
        if isinstance(value, str):
            return value.replace('%', '\\%').replace('_', '\\_')
        return value

def create_secure_database_connection(database_url, ssl_mode='require'):
    """Factory function to create secure database connection"""
    
    # Validate SSL mode based on environment
    if os.getenv('FLASK_ENV') == 'production' and ssl_mode in ['disable', 'allow']:
        logger.warning("Upgrading SSL mode to 'require' for production")
        ssl_mode = 'require'
    
    secure_db = SecureDatabaseConnection(database_url, ssl_mode)
    secure_db.create_secure_connection_pool()
    
    # Initialize security manager
    security_manager = DatabaseSecurityManager(secure_db)
    security_manager.create_security_tables()
    
    return secure_db, security_manager

def init_database_security(app):
    """Initialize database security features for Flask app"""
    
    database_url = app.config.get('DATABASE_URL')
    ssl_mode = app.config.get('DB_SSL_MODE', 'require')
    
    try:
        secure_db, security_manager = create_secure_database_connection(
            database_url, ssl_mode
        )
        
        # Store in app context
        app.config['SECURE_DB'] = secure_db
        app.config['SECURITY_MANAGER'] = security_manager
        
        # Schedule cleanup task
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler = BackgroundScheduler()
        scheduler.add_job(
            security_manager.cleanup_expired_tokens,
            'interval',
            hours=6,
            id='cleanup_expired_security_data'
        )
        scheduler.start()
        
        logger.info("Database security initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to initialize database security: {e}")
        raise