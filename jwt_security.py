"""
Enhanced JWT security with token blacklisting and session management
"""
import redis
import json
from datetime import datetime, timedelta
from flask import current_app
from flask_jwt_extended import get_jwt, get_jwt_identity
import logging

logger = logging.getLogger(__name__)

class TokenBlacklist:
    """JWT token blacklisting service"""
    
    def __init__(self, redis_url=None):
        """Initialize with Redis or in-memory fallback"""
        self.use_redis = False
        self.memory_blacklist = set()
        
        if redis_url:
            try:
                self.redis_client = redis.from_url(redis_url)
                self.redis_client.ping()  # Test connection
                self.use_redis = True
                logger.info("TokenBlacklist initialized with Redis")
            except Exception as e:
                logger.warning(f"Redis connection failed, using memory store: {e}")
                self.use_redis = False
        else:
            logger.info("TokenBlacklist initialized with memory store")
    
    def blacklist_token(self, jti, expires_at):
        """Add token to blacklist"""
        if self.use_redis:
            # Calculate TTL based on token expiry
            ttl = int((expires_at - datetime.utcnow()).total_seconds())
            if ttl > 0:
                self.redis_client.setex(f"blacklist:{jti}", ttl, "true")
        else:
            self.memory_blacklist.add(jti)
        
        logger.info(f"Token {jti} blacklisted")
    
    def is_blacklisted(self, jti):
        """Check if token is blacklisted"""
        if self.use_redis:
            return self.redis_client.exists(f"blacklist:{jti}")
        else:
            return jti in self.memory_blacklist
    
    def cleanup_expired(self):
        """Clean up expired tokens (for memory store)"""
        if not self.use_redis:
            # This is a simplified cleanup - in production you'd track expiry times
            # For now, clear all after 24 hours (you'd implement proper expiry tracking)
            pass

class SessionManager:
    """Enhanced session management with timeout tracking"""
    
    def __init__(self, redis_url=None, session_timeout_minutes=60):
        """Initialize session manager"""
        self.session_timeout = timedelta(minutes=session_timeout_minutes)
        self.use_redis = False
        self.memory_sessions = {}
        
        if redis_url:
            try:
                self.redis_client = redis.from_url(redis_url)
                self.redis_client.ping()
                self.use_redis = True
                logger.info("SessionManager initialized with Redis")
            except Exception as e:
                logger.warning(f"Redis connection failed for sessions: {e}")
    
    def create_session(self, user_id, jti, additional_data=None):
        """Create a new session"""
        session_data = {
            'user_id': user_id,
            'jti': jti,
            'created_at': datetime.utcnow().isoformat(),
            'last_activity': datetime.utcnow().isoformat(),
            'additional_data': additional_data or {}
        }
        
        if self.use_redis:
            ttl = int(self.session_timeout.total_seconds())
            self.redis_client.setex(
                f"session:{jti}", 
                ttl, 
                json.dumps(session_data)
            )
        else:
            self.memory_sessions[jti] = session_data
        
        logger.info(f"Session created for user {user_id}, token {jti}")
    
    def update_activity(self, jti):
        """Update last activity timestamp"""
        if self.use_redis:
            session_data = self.redis_client.get(f"session:{jti}")
            if session_data:
                data = json.loads(session_data)
                data['last_activity'] = datetime.utcnow().isoformat()
                
                ttl = int(self.session_timeout.total_seconds())
                self.redis_client.setex(
                    f"session:{jti}", 
                    ttl, 
                    json.dumps(data)
                )
        else:
            if jti in self.memory_sessions:
                self.memory_sessions[jti]['last_activity'] = datetime.utcnow().isoformat()
    
    def is_session_valid(self, jti):
        """Check if session is still valid"""
        if self.use_redis:
            return self.redis_client.exists(f"session:{jti}")
        else:
            if jti not in self.memory_sessions:
                return False
            
            session = self.memory_sessions[jti]
            last_activity = datetime.fromisoformat(session['last_activity'])
            return datetime.utcnow() - last_activity < self.session_timeout
    
    def destroy_session(self, jti):
        """Destroy a session"""
        if self.use_redis:
            self.redis_client.delete(f"session:{jti}")
        else:
            self.memory_sessions.pop(jti, None)
        
        logger.info(f"Session destroyed for token {jti}")
    
    def get_user_sessions(self, user_id):
        """Get all active sessions for a user"""
        sessions = []
        
        if self.use_redis:
            # This is simplified - in production you'd maintain a user->sessions mapping
            keys = self.redis_client.keys("session:*")
            for key in keys:
                session_data = self.redis_client.get(key)
                if session_data:
                    data = json.loads(session_data)
                    if data.get('user_id') == user_id:
                        sessions.append(data)
        else:
            for jti, session in self.memory_sessions.items():
                if session.get('user_id') == user_id:
                    sessions.append(session)
        
        return sessions

# Global instances
token_blacklist = TokenBlacklist()
session_manager = SessionManager()

def init_jwt_security(app):
    """Initialize JWT security features"""
    
    # Try to initialize Redis if available
    redis_url = app.config.get('REDIS_URL')
    if redis_url:
        global token_blacklist, session_manager
        token_blacklist = TokenBlacklist(redis_url)
        session_manager = SessionManager(redis_url)
    
    @app.before_request
    def check_token_blacklist():
        """Check if current token is blacklisted"""
        try:
            jwt_data = get_jwt()
            jti = jwt_data.get('jti')
            
            if jti and token_blacklist.is_blacklisted(jti):
                from flask import jsonify
                return jsonify({
                    'success': False,
                    'message': 'Token has been revoked'
                }), 401
            
            # Update session activity
            if jti:
                session_manager.update_activity(jti)
                
                # Check session validity
                if not session_manager.is_session_valid(jti):
                    return jsonify({
                        'success': False,
                        'message': 'Session has expired'
                    }), 401
                    
        except Exception:
            # No JWT token present, continue
            pass
    
    return app

def revoke_token(jti=None):
    """Revoke current or specified token"""
    if jti is None:
        jwt_data = get_jwt()
        jti = jwt_data.get('jti')
        expires_at = datetime.fromtimestamp(jwt_data.get('exp'))
    else:
        # For manual revocation, assume standard expiry
        expires_at = datetime.utcnow() + timedelta(hours=24)
    
    if jti:
        token_blacklist.blacklist_token(jti, expires_at)
        session_manager.destroy_session(jti)
        
        # Log security event
        from security_monitoring import SecurityAuditLogger
        user_id = get_jwt_identity() if get_jwt_identity() else 'unknown'
        SecurityAuditLogger.log_security_event(
            'token_revoked',
            f"Token {jti} revoked for user {user_id}",
            severity='medium'
        )

def revoke_all_user_tokens(user_id):
    """Revoke all tokens for a specific user"""
    sessions = session_manager.get_user_sessions(user_id)
    
    for session in sessions:
        jti = session.get('jti')
        if jti:
            expires_at = datetime.utcnow() + timedelta(hours=24)
            token_blacklist.blacklist_token(jti, expires_at)
            session_manager.destroy_session(jti)
    
    # Log security event
    from security_monitoring import SecurityAuditLogger
    SecurityAuditLogger.log_security_event(
        'all_tokens_revoked',
        f"All tokens revoked for user {user_id}",
        severity='high'
    )
    
    logger.info(f"All tokens revoked for user {user_id}")

def get_active_sessions(user_id):
    """Get active sessions for a user"""
    return session_manager.get_user_sessions(user_id)

class SecureJWTManager:
    """Enhanced JWT management with security features"""
    
    @staticmethod
    def create_tokens(user_id, additional_claims=None):
        """Create access and refresh tokens with session tracking"""
        from flask_jwt_extended import create_access_token, create_refresh_token
        from uuid import uuid4
        
        # Generate unique JTI
        jti = str(uuid4())
        
        claims = {
            'jti': jti,
            'user_id': user_id,
            'created_at': datetime.utcnow().isoformat()
        }
        
        if additional_claims:
            claims.update(additional_claims)
        
        access_token = create_access_token(
            identity=user_id,
            additional_claims=claims
        )
        
        refresh_token = create_refresh_token(
            identity=user_id,
            additional_claims=claims
        )
        
        # Create session
        session_manager.create_session(user_id, jti, additional_claims)
        
        return access_token, refresh_token
    
    @staticmethod
    def logout_user():
        """Secure logout with token revocation"""
        try:
            revoke_token()
            return True
        except Exception as e:
            logger.error(f"Error during logout: {e}")
            return False
    
    @staticmethod
    def logout_all_sessions(user_id):
        """Logout user from all sessions"""
        try:
            revoke_all_user_tokens(user_id)
            return True
        except Exception as e:
            logger.error(f"Error during logout all sessions: {e}")
            return False