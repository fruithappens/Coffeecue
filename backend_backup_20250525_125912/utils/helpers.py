"""
Helper utility functions for Expresso Coffee Ordering System
"""
import re
import random
import string
from datetime import datetime, timedelta
import os
import qrcode
from io import BytesIO
import base64
from functools import wraps
from flask import jsonify, request, g
from flask_jwt_extended import verify_jwt_in_request, get_jwt

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

def role_required(allowed_roles):
    """
    Decorator to restrict endpoints to specific user roles
    
    Args:
        allowed_roles: List of roles that are allowed to access the endpoint
        
    Returns:
        Decorated function
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            # Verify JWT token
            verify_jwt_in_request()
            
            # Get claims from JWT
            claims = get_jwt()
            
            # Get user role from claims
            role = claims.get('role', None)
            
            # If role is not in allowed roles, return 403 Forbidden
            if role not in allowed_roles:
                return jsonify({
                    'success': False,
                    'error': 'Access denied. Insufficient permissions.'
                }), 403
            
            # Otherwise, proceed with the original function
            return fn(*args, **kwargs)
        return wrapper
    return decorator

def generate_order_number():
    """
    Generate a unique order number with AM/PM prefix
    
    Returns:
        String order number
    """
    now = datetime.now()
    prefix = "A" if now.hour < 12 else "P"  # A for AM, P for PM
    
    # Create unique hash based on current timestamp
    random_suffix = hash(str(now.timestamp() + random.random()))
    # Take only the last 2 digits
    random_suffix = str(abs(random_suffix))[-2:]
    
    # Format: Letter + hour + minute + second + random 2 digits
    order_number = f"{prefix}{now.strftime('%H%M%S')}{random_suffix}"
    return order_number

def parse_time_input(time_input, reference_time=None):
    """
    Parse various time input formats
    
    Args:
        time_input: String time input (e.g., "3:30pm", "in 15 minutes")
        reference_time: Reference datetime (defaults to now)
        
    Returns:
        Parsed datetime object or None if parsing fails
    """
    if reference_time is None:
        reference_time = datetime.now()
    
    # Handle "now" case
    if time_input.lower() in ["now", "immediately", "asap"]:
        return reference_time
    
    # Handle "in X minutes/hours" case
    in_match = re.match(r'in\s+(\d+)\s+(minute|hour)s?', time_input.lower())
    if in_match:
        amount = int(in_match.group(1))
        unit = in_match.group(2)
        
        if unit == "minute":
            return reference_time + timedelta(minutes=amount)
        elif unit == "hour":
            return reference_time + timedelta(hours=amount)
    
    # Handle specific time formats
    time_formats = [
        "%I:%M%p",      # 3:30PM
        "%I:%M %p",     # 3:30 PM
        "%I%p",         # 3PM
        "%H:%M",        # 15:30 (24-hour)
    ]
    
    for fmt in time_formats:
        try:
            parsed_time = datetime.strptime(time_input.strip(), fmt).time()
            result = datetime.combine(reference_time.date(), parsed_time)
            
            # If the parsed time is earlier than current time, assume next day
            if result < reference_time:
                result += timedelta(days=1)
                
            return result
        except ValueError:
            continue
    
    # No successful parsing
    return None

def format_time(dt):
    """
    Format a datetime object into a user-friendly time string
    
    Args:
        dt: Datetime object
        
    Returns:
        Formatted time string (e.g., "3:30 PM")
    """
    if dt is None:
        return "Unknown"
    return dt.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")

def generate_random_code(length=6):
    """
    Generate a random alphanumeric code
    
    Args:
        length: Length of code to generate
        
    Returns:
        Random code string
    """
    # Use only uppercase letters and numbers, excluding confusing chars like O, 0, I, 1
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return ''.join(random.choices(chars, k=length))

def sanitize_phone_number(phone):
    """
    Ensure phone number is in consistent format
    
    Args:
        phone: Phone number string
        
    Returns:
        Sanitized phone number
    """
    # Remove any non-digit characters
    digits_only = re.sub(r'\D', '', phone)
    
    # Ensure it starts with + for international format
    if not phone.startswith('+') and len(digits_only) > 0:
        if digits_only.startswith('0'):
            # Australian format: convert 04xx to +614xx
            if len(digits_only) == 10 and digits_only.startswith('04'):
                return '+61' + digits_only[1:]
        return '+' + digits_only
    
    return phone

def generate_qr_code(data, size=10):
    """
    Generate a QR code as a base64 encoded image
    
    Args:
        data: Data to encode in the QR code
        size: Size of the QR code (box size in pixels)
        
    Returns:
        Base64 encoded PNG image
    """
    try:
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_M,  # Fixed: Corrected constant name
            box_size=size,
            border=4,
        )
        qr.add_data(data)
        qr.make(fit=True)
        
        # Create an image
        img = qr.make_image(fill_color="black", back_color="white")
        
        # Save to BytesIO
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        
        # Convert to base64
        img_str = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return f"data:image/png;base64,{img_str}"
    except Exception as e:
        # Log the error and return None if QR code generation fails
        import logging
        logging.getLogger("expresso.utils").error(f"QR code generation failed: {str(e)}")
        return None

def generate_order_qr_code(order_number, url_prefix=""):
    """
    Generate a QR code for an order
    
    Args:
        order_number: Order number
        url_prefix: Optional URL prefix
        
    Returns:
        QR code image as base64 string or None if generation fails
    """
    try:
        # Create a URL or data string
        if url_prefix:
            data = f"{url_prefix}/order/{order_number}"
        else:
            data = f"ORDER:{order_number}"
        
        return generate_qr_code(data)
    except Exception as e:
        # Log the error and return None if QR code generation fails
        import logging
        logging.getLogger("expresso.utils").error(f"Order QR code generation failed: {str(e)}")
        return None