"""
Security monitoring and audit logging for Flask application
"""
import logging
import json
from datetime import datetime
from flask import request, g, current_app
from flask_jwt_extended import get_jwt_identity, get_jwt
from functools import wraps
import hashlib
import os

# Configure security audit logger
security_logger = logging.getLogger('security_audit')
security_handler = logging.FileHandler('logs/security_audit.log')
security_formatter = logging.Formatter(
    '%(asctime)s - SECURITY - %(levelname)s - %(message)s'
)
security_handler.setFormatter(security_formatter)
security_logger.addHandler(security_handler)
security_logger.setLevel(logging.INFO)

# Configure API access logger
api_logger = logging.getLogger('api_access')
api_handler = logging.FileHandler('logs/api_access.log')
api_formatter = logging.Formatter(
    '%(asctime)s - API - %(message)s'
)
api_handler.setFormatter(api_formatter)
api_logger.addHandler(api_handler)
api_logger.setLevel(logging.INFO)

# Ensure logs directory exists
os.makedirs('logs', exist_ok=True)

class SecurityAuditLogger:
    """Security event logging and monitoring"""
    
    @staticmethod
    def log_authentication_attempt(username, success, ip_address, user_agent=None):
        """Log authentication attempts"""
        event = {
            'event_type': 'authentication_attempt',
            'username': username,
            'success': success,
            'ip_address': ip_address,
            'user_agent': user_agent or 'Unknown',
            'timestamp': datetime.utcnow().isoformat()
        }
        
        level = logging.INFO if success else logging.WARNING
        security_logger.log(level, f"AUTH_ATTEMPT: {json.dumps(event)}")
        
        # Alert on failed login
        if not success:
            SecurityAuditLogger.log_security_event(
                'failed_login', 
                f"Failed login attempt for {username} from {ip_address}"
            )
    
    @staticmethod
    def log_privilege_escalation(user_id, attempted_action, success=False):
        """Log privilege escalation attempts"""
        event = {
            'event_type': 'privilege_escalation',
            'user_id': user_id,
            'attempted_action': attempted_action,
            'success': success,
            'ip_address': request.remote_addr,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        level = logging.WARNING if not success else logging.ERROR
        security_logger.log(level, f"PRIVILEGE_ESCALATION: {json.dumps(event)}")
    
    @staticmethod
    def log_data_access(user_id, resource, action, sensitive=False):
        """Log access to sensitive data"""
        event = {
            'event_type': 'data_access',
            'user_id': user_id,
            'resource': resource,
            'action': action,
            'sensitive': sensitive,
            'ip_address': request.remote_addr,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        level = logging.WARNING if sensitive else logging.INFO
        security_logger.log(level, f"DATA_ACCESS: {json.dumps(event)}")
    
    @staticmethod
    def log_security_event(event_type, description, severity='medium'):
        """Log general security events"""
        event = {
            'event_type': event_type,
            'description': description,
            'severity': severity,
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        level_map = {
            'low': logging.INFO,
            'medium': logging.WARNING,
            'high': logging.ERROR,
            'critical': logging.CRITICAL
        }
        
        level = level_map.get(severity, logging.WARNING)
        security_logger.log(level, f"SECURITY_EVENT: {json.dumps(event)}")
    
    @staticmethod
    def log_suspicious_activity(activity_type, details):
        """Log suspicious activities"""
        event = {
            'event_type': 'suspicious_activity',
            'activity_type': activity_type,
            'details': details,
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        security_logger.error(f"SUSPICIOUS_ACTIVITY: {json.dumps(event)}")

class APIRequestLogger:
    """API request logging and monitoring"""
    
    @staticmethod
    def log_api_request():
        """Log all API requests"""
        user_id = None
        try:
            user_id = get_jwt_identity()
        except:
            pass
        
        # Create request fingerprint
        request_data = {
            'method': request.method,
            'path': request.path,
            'query_string': request.query_string.decode(),
            'content_length': request.content_length or 0,
            'user_agent': request.headers.get('User-Agent', '')[:200],  # Truncate
        }
        
        fingerprint = hashlib.md5(
            json.dumps(request_data, sort_keys=True).encode()
        ).hexdigest()
        
        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'method': request.method,
            'path': request.path,
            'query_params': dict(request.args),
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent', 'Unknown')[:200],
            'content_length': request.content_length or 0,
            'fingerprint': fingerprint
        }
        
        # Log sensitive endpoints with higher priority
        sensitive_paths = ['/api/auth/', '/api/admin/', '/api/users/', '/sms']
        is_sensitive = any(path in request.path for path in sensitive_paths)
        
        if is_sensitive:
            log_entry['sensitive'] = True
            SecurityAuditLogger.log_data_access(
                user_id, request.path, request.method, sensitive=True
            )
        
        api_logger.info(json.dumps(log_entry))
    
    @staticmethod
    def log_api_response(response):
        """Log API responses with security context"""
        user_id = None
        try:
            user_id = get_jwt_identity()
        except:
            pass
        
        log_entry = {
            'timestamp': datetime.utcnow().isoformat(),
            'status_code': response.status_code,
            'user_id': user_id,
            'ip_address': request.remote_addr,
            'path': request.path,
            'response_size': len(response.get_data()),
        }
        
        # Log error responses for security analysis
        if response.status_code >= 400:
            log_entry['error'] = True
            
            # Log security-relevant errors
            if response.status_code in [401, 403, 429]:
                SecurityAuditLogger.log_security_event(
                    f'http_{response.status_code}',
                    f'{response.status_code} response for {request.path}',
                    severity='medium'
                )
        
        api_logger.info(json.dumps(log_entry))

def security_audit(event_type):
    """Decorator for security-sensitive operations"""
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            user_id = None
            try:
                user_id = get_jwt_identity()
            except:
                pass
            
            # Log the attempt
            SecurityAuditLogger.log_security_event(
                event_type,
                f"User {user_id} attempted {f.__name__}",
                severity='medium'
            )
            
            try:
                result = f(*args, **kwargs)
                
                # Log successful completion
                SecurityAuditLogger.log_security_event(
                    f"{event_type}_success",
                    f"User {user_id} successfully completed {f.__name__}",
                    severity='low'
                )
                
                return result
            except Exception as e:
                # Log failures
                SecurityAuditLogger.log_security_event(
                    f"{event_type}_failure",
                    f"User {user_id} failed {f.__name__}: {str(e)}",
                    severity='high'
                )
                raise
        
        return decorated_function
    return decorator

def init_security_monitoring(app):
    """Initialize security monitoring for Flask app"""
    
    @app.before_request
    def before_request():
        # Log all API requests
        if request.path.startswith('/api/') or request.path.startswith('/sms'):
            APIRequestLogger.log_api_request()
        
        # Detect suspicious patterns
        user_agent = request.headers.get('User-Agent', '').lower()
        suspicious_agents = ['sqlmap', 'nikto', 'nmap', 'masscan', 'nessus']
        
        if any(agent in user_agent for agent in suspicious_agents):
            SecurityAuditLogger.log_suspicious_activity(
                'suspicious_user_agent',
                f"Suspicious User-Agent: {user_agent}"
            )
    
    @app.after_request
    def after_request(response):
        # Log API responses
        if request.path.startswith('/api/') or request.path.startswith('/sms'):
            APIRequestLogger.log_api_response(response)
        
        return response
    
    return app

# Brute force protection tracking
class BruteForceProtection:
    """Track and prevent brute force attacks"""
    
    failed_attempts = {}  # In production, use Redis or database
    
    @classmethod
    def record_failed_attempt(cls, identifier):
        """Record a failed login attempt"""
        now = datetime.utcnow()
        if identifier not in cls.failed_attempts:
            cls.failed_attempts[identifier] = []
        
        cls.failed_attempts[identifier].append(now)
        
        # Clean old attempts (older than 1 hour)
        cutoff = now.replace(hour=now.hour-1) if now.hour > 0 else now.replace(day=now.day-1, hour=23)
        cls.failed_attempts[identifier] = [
            attempt for attempt in cls.failed_attempts[identifier]
            if attempt > cutoff
        ]
        
        # Log if threshold exceeded
        if len(cls.failed_attempts[identifier]) >= 5:
            SecurityAuditLogger.log_security_event(
                'brute_force_detected',
                f"Brute force attack detected from {identifier}",
                severity='high'
            )
    
    @classmethod
    def is_blocked(cls, identifier, threshold=5):
        """Check if identifier should be blocked"""
        if identifier not in cls.failed_attempts:
            return False
        
        return len(cls.failed_attempts[identifier]) >= threshold
    
    @classmethod
    def clear_attempts(cls, identifier):
        """Clear failed attempts for successful login"""
        if identifier in cls.failed_attempts:
            del cls.failed_attempts[identifier]