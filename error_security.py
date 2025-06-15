"""
Error message sanitization and secure error handling
Prevents information disclosure through error messages
"""
import logging
import traceback
import re
import os
from flask import jsonify, request, current_app
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)

class SecureErrorHandler:
    """Secure error handling with sanitized error messages"""
    
    # Sensitive information patterns to remove from error messages
    SENSITIVE_PATTERNS = [
        # Database connection strings
        r'postgresql://[^@]+:[^@]+@[^/]+/\w+',
        r'mysql://[^@]+:[^@]+@[^/]+/\w+',
        r'sqlite:///[^\s]+',
        
        # File paths
        r'/[a-zA-Z0-9_\-/.]+\.(py|js|php|rb|java|cpp|c|h)',
        r'[A-Z]:\\[a-zA-Z0-9_\-\\/.]+',
        
        # API keys and tokens
        r'[Aa]pi[_-]?[Kk]ey["\']?\s*[:=]\s*["\']?[a-zA-Z0-9]{20,}',
        r'[Tt]oken["\']?\s*[:=]\s*["\']?[a-zA-Z0-9]{20,}',
        r'[Ss]ecret["\']?\s*[:=]\s*["\']?[a-zA-Z0-9]{20,}',
        
        # JWT tokens
        r'eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+',
        
        # Internal server details
        r'Python/\d+\.\d+\.\d+',
        r'Flask/\d+\.\d+\.\d+',
        r'Werkzeug/\d+\.\d+\.\d+',
        
        # SQL errors with table/column names
        r'table "[^"]+" does not exist',
        r'column "[^"]+" does not exist',
        r'relation "[^"]+" does not exist',
        
        # Internal IP addresses
        r'\b(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)\d{1,3}\.\d{1,3}\b',
        r'\b127\.0\.0\.1\b',
        r'\blocalhost\b',
        
        # Email addresses
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        
        # Phone numbers
        r'\+?[1-9]\d{1,14}',
        
        # Stack trace paths
        r'File "[^"]+", line \d+',
    ]
    
    # Generic error messages for different categories
    GENERIC_MESSAGES = {
        'database': 'A database error occurred. Please try again later.',
        'authentication': 'Authentication failed. Please check your credentials.',
        'authorization': 'You are not authorized to perform this action.',
        'validation': 'Invalid input provided. Please check your data.',
        'file_upload': 'File upload failed. Please check the file and try again.',
        'network': 'Network error occurred. Please try again later.',
        'server': 'An internal server error occurred. Please try again later.',
        'rate_limit': 'Too many requests. Please try again later.',
        'not_found': 'The requested resource was not found.',
        'method_not_allowed': 'Method not allowed.',
        'timeout': 'Request timeout. Please try again.',
        'default': 'An error occurred while processing your request.'
    }
    
    @classmethod
    def sanitize_error_message(cls, error_message, error_type='default'):
        """
        Sanitize error message by removing sensitive information
        
        Args:
            error_message: Original error message
            error_type: Type of error for generic message selection
        
        Returns:
            Sanitized error message
        """
        if not error_message:
            return cls.GENERIC_MESSAGES.get(error_type, cls.GENERIC_MESSAGES['default'])
        
        # In production, always use generic messages
        if not current_app.debug:
            return cls.GENERIC_MESSAGES.get(error_type, cls.GENERIC_MESSAGES['default'])
        
        # In development, sanitize but keep some detail
        sanitized = str(error_message)
        
        for pattern in cls.SENSITIVE_PATTERNS:
            sanitized = re.sub(pattern, '[REDACTED]', sanitized, flags=re.IGNORECASE)
        
        # Remove common sensitive keywords
        sensitive_keywords = [
            'password', 'secret', 'token', 'key', 'credentials',
            'auth', 'login', 'session', 'cookie'
        ]
        
        for keyword in sensitive_keywords:
            # Replace sensitive values after keywords
            pattern = rf'{keyword}["\']?\s*[:=]\s*["\']?[^\s\'"]+["\']?'
            sanitized = re.sub(pattern, f'{keyword}=[REDACTED]', sanitized, flags=re.IGNORECASE)
        
        return sanitized
    
    @classmethod
    def create_error_response(cls, error, status_code=500, error_type='server'):
        """
        Create a secure error response
        
        Args:
            error: Exception or error message
            status_code: HTTP status code
            error_type: Type of error for message selection
        
        Returns:
            Flask JSON response
        """
        # Log the full error details for debugging (server-side only)
        if isinstance(error, Exception):
            logger.error(f"Error occurred: {str(error)}", exc_info=True)
            error_message = str(error)
        else:
            error_message = str(error)
            logger.error(f"Error: {error_message}")
        
        # Create sanitized user-facing message
        sanitized_message = cls.sanitize_error_message(error_message, error_type)
        
        # Create response
        response_data = {
            'success': False,
            'status': 'error',
            'message': sanitized_message
        }
        
        # Add error code for client handling
        response_data['error_code'] = f"ERR_{error_type.upper()}_{status_code}"
        
        # In development, add more debug info
        if current_app.debug:
            response_data['debug'] = {
                'original_message': error_message[:200],  # Truncated
                'error_type': error_type
            }
        
        # Log security event for certain errors
        if status_code in [401, 403, 429]:
            from security_monitoring import SecurityAuditLogger
            SecurityAuditLogger.log_security_event(
                f'http_error_{status_code}',
                f'{status_code} error: {sanitized_message}',
                severity='medium'
            )
        
        return jsonify(response_data), status_code

class DatabaseErrorHandler:
    """Specialized handler for database errors"""
    
    @staticmethod
    def handle_database_error(error):
        """Handle database-specific errors securely"""
        error_str = str(error).lower()
        
        # Categorize database errors
        if 'connection' in error_str or 'connect' in error_str:
            error_type = 'database'
            status_code = 503
        elif 'authentication' in error_str or 'password' in error_str:
            error_type = 'authentication'
            status_code = 401
        elif 'permission' in error_str or 'access' in error_str:
            error_type = 'authorization'
            status_code = 403
        elif 'duplicate' in error_str or 'unique' in error_str:
            error_type = 'validation'
            status_code = 409
        elif 'not found' in error_str or 'does not exist' in error_str:
            error_type = 'not_found'
            status_code = 404
        else:
            error_type = 'database'
            status_code = 500
        
        return SecureErrorHandler.create_error_response(error, status_code, error_type)

def init_secure_error_handling(app):
    """Initialize secure error handling for Flask app"""
    
    @app.errorhandler(400)
    def bad_request(error):
        return SecureErrorHandler.create_error_response(
            error, 400, 'validation'
        )
    
    @app.errorhandler(401)
    def unauthorized(error):
        return SecureErrorHandler.create_error_response(
            error, 401, 'authentication'
        )
    
    @app.errorhandler(403)
    def forbidden(error):
        return SecureErrorHandler.create_error_response(
            error, 403, 'authorization'
        )
    
    @app.errorhandler(404)
    def not_found(error):
        return SecureErrorHandler.create_error_response(
            error, 404, 'not_found'
        )
    
    @app.errorhandler(405)
    def method_not_allowed(error):
        return SecureErrorHandler.create_error_response(
            error, 405, 'method_not_allowed'
        )
    
    @app.errorhandler(429)
    def rate_limit_exceeded(error):
        return SecureErrorHandler.create_error_response(
            error, 429, 'rate_limit'
        )
    
    @app.errorhandler(500)
    def internal_server_error(error):
        return SecureErrorHandler.create_error_response(
            error, 500, 'server'
        )
    
    @app.errorhandler(503)
    def service_unavailable(error):
        return SecureErrorHandler.create_error_response(
            error, 503, 'server'
        )
    
    # Handle database errors specifically
    @app.errorhandler(Exception)
    def handle_exception(error):
        # Check if it's a database error
        error_str = str(error).lower()
        if any(db_keyword in error_str for db_keyword in ['psycopg2', 'sqlite', 'database', 'sql']):
            return DatabaseErrorHandler.handle_database_error(error)
        
        # Handle HTTP exceptions normally
        if isinstance(error, HTTPException):
            return error
        
        # Generic error handling
        return SecureErrorHandler.create_error_response(error, 500, 'server')
    
    logger.info("Secure error handling initialized")

# Decorator for secure API endpoints
def secure_endpoint(error_type='server'):
    """Decorator to add secure error handling to endpoints"""
    def decorator(f):
        def decorated_function(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except Exception as e:
                return SecureErrorHandler.create_error_response(e, 500, error_type)
        
        decorated_function.__name__ = f.__name__
        return decorated_function
    return decorator

# Context manager for secure error handling
class SecureErrorContext:
    """Context manager for secure error handling in code blocks"""
    
    def __init__(self, error_type='server', reraise=False):
        self.error_type = error_type
        self.reraise = reraise
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is not None:
            # Log error securely
            SecureErrorHandler.create_error_response(exc_value, 500, self.error_type)
            
            if self.reraise:
                return False  # Re-raise the exception
            
            return True  # Suppress the exception

# Utility functions
def log_security_error(error, context=None):
    """Log security-related errors with proper sanitization"""
    sanitized_error = SecureErrorHandler.sanitize_error_message(str(error))
    
    log_entry = {
        'error': sanitized_error,
        'context': context,
        'ip_address': request.remote_addr if request else None,
        'user_agent': request.headers.get('User-Agent') if request else None
    }
    
    logger.error(f"Security error: {log_entry}")

def mask_sensitive_data(data, keys_to_mask=None):
    """Mask sensitive data in dictionaries for logging"""
    if keys_to_mask is None:
        keys_to_mask = [
            'password', 'token', 'secret', 'key', 'auth', 'credentials',
            'api_key', 'access_token', 'refresh_token', 'jwt'
        ]
    
    if isinstance(data, dict):
        masked_data = {}
        for key, value in data.items():
            if any(sensitive_key in key.lower() for sensitive_key in keys_to_mask):
                masked_data[key] = '[MASKED]'
            elif isinstance(value, (dict, list)):
                masked_data[key] = mask_sensitive_data(value, keys_to_mask)
            else:
                masked_data[key] = value
        return masked_data
    
    elif isinstance(data, list):
        return [mask_sensitive_data(item, keys_to_mask) for item in data]
    
    return data