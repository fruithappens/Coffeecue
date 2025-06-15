"""
File upload security validation and protection
"""
import os
import magic
import hashlib
from PIL import Image
from flask import current_app
from werkzeug.utils import secure_filename
import logging
import tempfile
import subprocess

logger = logging.getLogger(__name__)

class FileSecurityValidator:
    """Comprehensive file upload security validation"""
    
    # Allowed file types and their magic numbers
    ALLOWED_TYPES = {
        'image': {
            'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
            'mime_types': ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'],
            'magic_numbers': [
                b'\xff\xd8\xff',  # JPEG
                b'\x89PNG\r\n\x1a\n',  # PNG
                b'GIF8',  # GIF
                b'BM',  # BMP
                b'RIFF'  # WEBP (partial)
            ]
        },
        'document': {
            'extensions': ['.pdf', '.txt', '.csv'],
            'mime_types': ['application/pdf', 'text/plain', 'text/csv'],
            'magic_numbers': [
                b'%PDF',  # PDF
                b'\x50\x4b\x03\x04'  # ZIP-based (for future office docs)
            ]
        }
    }
    
    # Dangerous file types to always reject
    DANGEROUS_EXTENSIONS = [
        '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js', '.jar',
        '.sh', '.php', '.asp', '.aspx', '.jsp', '.py', '.rb', '.pl', '.cgi'
    ]
    
    MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB default
    
    @classmethod
    def validate_file(cls, file, allowed_category='image', max_size=None):
        """
        Comprehensive file validation
        Returns: (is_valid, error_message, safe_filename)
        """
        if not file or not file.filename:
            return False, "No file provided", None
        
        max_size = max_size or cls.MAX_FILE_SIZE
        
        # 1. Check file size
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning
        
        if file_size > max_size:
            return False, f"File too large. Maximum size: {max_size // (1024*1024)}MB", None
        
        if file_size == 0:
            return False, "Empty file not allowed", None
        
        # 2. Secure filename
        original_filename = file.filename
        safe_filename = secure_filename(original_filename)
        
        if not safe_filename:
            return False, "Invalid filename", None
        
        # 3. Check for dangerous extensions
        file_ext = os.path.splitext(safe_filename)[1].lower()
        if file_ext in cls.DANGEROUS_EXTENSIONS:
            return False, f"File type {file_ext} is not allowed", None
        
        # 4. Validate against allowed category
        if allowed_category not in cls.ALLOWED_TYPES:
            return False, f"Invalid file category: {allowed_category}", None
        
        allowed_config = cls.ALLOWED_TYPES[allowed_category]
        
        if file_ext not in allowed_config['extensions']:
            return False, f"File extension {file_ext} not allowed for {allowed_category}", None
        
        # 5. Read file content for magic number validation
        file_content = file.read(1024)  # Read first 1KB
        file.seek(0)  # Reset
        
        # 6. Validate magic numbers
        valid_magic = False
        for magic_number in allowed_config['magic_numbers']:
            if file_content.startswith(magic_number):
                valid_magic = True
                break
        
        if not valid_magic:
            return False, f"File content doesn't match expected format for {file_ext}", None
        
        # 7. MIME type validation using python-magic
        try:
            mime_type = magic.from_buffer(file_content, mime=True)
            if mime_type not in allowed_config['mime_types']:
                return False, f"MIME type {mime_type} not allowed", None
        except Exception as e:
            logger.warning(f"Could not determine MIME type: {e}")
            # Continue without MIME validation if magic fails
        
        # 8. Additional image-specific validation
        if allowed_category == 'image':
            try:
                file.seek(0)
                with Image.open(file) as img:
                    # Check for reasonable image dimensions
                    width, height = img.size
                    if width > 10000 or height > 10000:
                        return False, "Image dimensions too large", None
                    
                    # Check for valid image format
                    if img.format.lower() not in ['jpeg', 'png', 'gif', 'bmp', 'webp']:
                        return False, f"Unsupported image format: {img.format}", None
                
                file.seek(0)
            except Exception as e:
                return False, f"Invalid image file: {str(e)}", None
        
        # 9. Scan for embedded malware signatures (basic)
        if cls._contains_malware_signatures(file_content):
            return False, "File contains suspicious content", None
        
        return True, None, safe_filename
    
    @classmethod
    def _contains_malware_signatures(cls, content):
        """Basic malware signature detection"""
        # Common malware/script signatures
        suspicious_patterns = [
            b'<script',
            b'javascript:',
            b'eval(',
            b'exec(',
            b'system(',
            b'shell_exec',
            b'<?php',
            b'<%@',
            b'ActiveXObject',
            b'WScript.Shell'
        ]
        
        content_lower = content.lower()
        for pattern in suspicious_patterns:
            if pattern in content_lower:
                return True
        
        return False
    
    @classmethod
    def sanitize_upload_path(cls, filename, upload_dir):
        """Create a safe upload path"""
        # Generate unique filename to prevent conflicts
        name, ext = os.path.splitext(filename)
        timestamp = str(int(time.time()))
        random_suffix = hashlib.md5(os.urandom(16)).hexdigest()[:8]
        
        safe_filename = f"{name}_{timestamp}_{random_suffix}{ext}"
        safe_path = os.path.join(upload_dir, safe_filename)
        
        # Ensure we don't escape the upload directory
        if not os.path.abspath(safe_path).startswith(os.path.abspath(upload_dir)):
            raise ValueError("Invalid upload path")
        
        return safe_path
    
    @classmethod
    def scan_file_with_clamav(cls, file_path):
        """Scan file with ClamAV if available"""
        try:
            result = subprocess.run(
                ['clamscan', '--no-summary', file_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode == 0:
                return True, "File is clean"
            elif result.returncode == 1:
                return False, "Virus detected"
            else:
                return None, "Scan failed"
                
        except (subprocess.TimeoutExpired, FileNotFoundError):
            # ClamAV not available or timeout
            return None, "ClamAV not available"
        except Exception as e:
            return None, f"Scan error: {str(e)}"

class SecureFileHandler:
    """Secure file handling utilities"""
    
    def __init__(self, upload_dir, allowed_category='image'):
        self.upload_dir = upload_dir
        self.allowed_category = allowed_category
        
        # Create upload directory if it doesn't exist
        os.makedirs(upload_dir, exist_ok=True)
        
        # Set secure permissions
        os.chmod(upload_dir, 0o755)
    
    def save_file(self, file, max_size=None):
        """
        Securely save uploaded file
        Returns: (success, message, file_path)
        """
        # Validate file
        is_valid, error_msg, safe_filename = FileSecurityValidator.validate_file(
            file, self.allowed_category, max_size
        )
        
        if not is_valid:
            logger.warning(f"File validation failed: {error_msg}")
            return False, error_msg, None
        
        try:
            # Create secure file path
            file_path = FileSecurityValidator.sanitize_upload_path(
                safe_filename, self.upload_dir
            )
            
            # Save file
            file.save(file_path)
            
            # Set secure file permissions
            os.chmod(file_path, 0o644)
            
            # Optional: Scan with antivirus
            scan_result, scan_message = FileSecurityValidator.scan_file_with_clamav(file_path)
            if scan_result is False:  # Virus detected
                os.remove(file_path)
                return False, f"File failed security scan: {scan_message}", None
            
            logger.info(f"File saved securely: {file_path}")
            return True, "File saved successfully", file_path
            
        except Exception as e:
            logger.error(f"Error saving file: {str(e)}")
            return False, f"Error saving file: {str(e)}", None
    
    def delete_file(self, file_path):
        """Securely delete file"""
        try:
            # Verify file is within upload directory
            if not os.path.abspath(file_path).startswith(os.path.abspath(self.upload_dir)):
                raise ValueError("File not in allowed directory")
            
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"File deleted: {file_path}")
                return True
            
        except Exception as e:
            logger.error(f"Error deleting file: {str(e)}")
            return False
    
    def get_file_info(self, file_path):
        """Get secure file information"""
        try:
            if not os.path.exists(file_path):
                return None
            
            stat = os.stat(file_path)
            return {
                'size': stat.st_size,
                'created': stat.st_ctime,
                'modified': stat.st_mtime,
                'permissions': oct(stat.st_mode)[-3:]
            }
            
        except Exception as e:
            logger.error(f"Error getting file info: {str(e)}")
            return None

# Flask integration
def create_secure_upload_handler(upload_dir, allowed_category='image'):
    """Factory function for creating secure upload handlers"""
    return SecureFileHandler(upload_dir, allowed_category)

# Example usage decorator
def secure_file_upload(allowed_category='image', max_size=None):
    """Decorator for secure file upload endpoints"""
    def decorator(f):
        def decorated_function(*args, **kwargs):
            from flask import request, jsonify
            
            if 'file' not in request.files:
                return jsonify({
                    'success': False,
                    'message': 'No file provided'
                }), 400
            
            file = request.files['file']
            
            # Validate file
            is_valid, error_msg, safe_filename = FileSecurityValidator.validate_file(
                file, allowed_category, max_size
            )
            
            if not is_valid:
                return jsonify({
                    'success': False,
                    'message': error_msg
                }), 400
            
            # Add validated file info to request context
            request.validated_file = {
                'file': file,
                'safe_filename': safe_filename,
                'category': allowed_category
            }
            
            return f(*args, **kwargs)
        
        return decorated_function
    return decorator

import time