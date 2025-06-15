# models/settings.py

from utils.database import db
from datetime import datetime
import json

class SystemSettings(db.Model):
    """Model for storing system-wide settings"""
    __tablename__ = 'system_settings'
    
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text)
    value_type = db.Column(db.String(20), default='string')  # string, int, float, bool, json
    description = db.Column(db.String(255))
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    
    @classmethod
    def get_value(cls, key, default=None):
        """Get a setting value with automatic type conversion"""
        setting = cls.query.filter_by(key=key).first()
        
        if not setting:
            return default
        
        return cls._convert_value(setting.value, setting.value_type)
    
    @classmethod
    def set_value(cls, key, value, value_type=None, description=None, user_id=None):
        """Set a setting value"""
        setting = cls.query.filter_by(key=key).first()
        
        if setting:
            # Update existing setting
            setting.value = cls._prepare_value(value, value_type or setting.value_type)
            if value_type:
                setting.value_type = value_type
            if description:
                setting.description = description
            setting.updated_by = user_id
        else:
            # Create new setting
            if value_type is None:
                # Determine value type automatically
                if isinstance(value, bool):
                    value_type = 'bool'
                elif isinstance(value, int):
                    value_type = 'int'
                elif isinstance(value, float):
                    value_type = 'float'
                elif isinstance(value, (dict, list)):
                    value_type = 'json'
                else:
                    value_type = 'string'
            
            setting = cls(
                key=key,
                value=cls._prepare_value(value, value_type),
                value_type=value_type,
                description=description,
                updated_by=user_id
            )
            
            db.session.add(setting)
        
        db.session.commit()
        return setting
    
    @staticmethod
    def _prepare_value(value, value_type):
        """Convert value to string for storage based on type"""
        if value is None:
            return None
            
        if value_type == 'json' and not isinstance(value, str):
            return json.dumps(value)
        elif value_type == 'bool' and not isinstance(value, str):
            return str(value).lower()
        else:
            return str(value)
    
    @staticmethod
    def _convert_value(value_str, value_type):
        """Convert stored string value to appropriate Python type"""
        if value_str is None:
            return None
            
        if value_type == 'int':
            return int(value_str)
        elif value_type == 'float':
            return float(value_str)
        elif value_type == 'bool':
            return value_str.lower() in ('true', 'yes', '1', 't', 'y')
        elif value_type == 'json':
            return json.loads(value_str)
        else:  # string
            return value_str
            
    @classmethod
    def get_payment_settings(cls):
        """Get all payment and sponsor related settings"""
        settings = {}
        
        # Get payment enabled setting
        payment_enabled = cls.get_value('payment_enabled', False)
        settings['payment_enabled'] = payment_enabled
        
        # Get sponsor settings
        settings['sponsor_name'] = cls.get_value('sponsor_name', '')
        settings['sponsor_message'] = cls.get_value('sponsor_message', 'Coffee service proudly sponsored by {sponsor}')
        settings['sponsor_display_enabled'] = cls.get_value('sponsor_display_enabled', True)
        
        # Create formatted message for convenience
        if settings['sponsor_name'] and settings['sponsor_message']:
            settings['formatted_message'] = settings['sponsor_message'].replace('{sponsor}', settings['sponsor_name'])
        else:
            settings['formatted_message'] = ''
        
        return settings


class SMSTemplate(db.Model):
    """Model for storing SMS message templates"""
    __tablename__ = 'sms_templates'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), unique=True, nullable=False)
    content = db.Column(db.Text, nullable=False)
    description = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    @classmethod
    def get_template(cls, name):
        """Get a template by name"""
        template = cls.query.filter_by(name=name).first()
        if template:
            return template.content
        return None
    
    @classmethod
    def render_template(cls, name, context):
        """Render a template with context variables"""
        template_content = cls.get_template(name)
        if not template_content:
            return None
            
        # Simple template rendering with format
        try:
            return template_content.format(**context)
        except KeyError as e:
            # Log the error but return original template
            print(f"Error rendering template '{name}': Missing key {e}")
            return template_content


class OperatingHours(db.Model):
    """Model for storing operating hours for coffee stations"""
    __tablename__ = 'operating_hours'
    
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey('barista_stations.id'))
    day_of_week = db.Column(db.Integer)  # 0=Monday, 6=Sunday
    open_time = db.Column(db.Time, nullable=False)
    close_time = db.Column(db.Time, nullable=False)
    is_closed = db.Column(db.Boolean, default=False)
    
    station = db.relationship('BaristaStation', backref='operating_hours')
    
    @classmethod
    def is_station_open(cls, station_id, check_time=None):
        """Check if a station is open at a specific time"""
        if check_time is None:
            check_time = datetime.now()
            
        day_of_week = check_time.weekday()  # 0=Monday, 6=Sunday
        
        # Get operating hours for this day
        hours = cls.query.filter_by(
            station_id=station_id,
            day_of_week=day_of_week
        ).first()
        
        if not hours or hours.is_closed:
            return False
            
        current_time = check_time.time()
        return hours.open_time <= current_time <= hours.close_time


# Default settings initialization function
def initialize_default_settings():
    """Initialize default system settings"""
    defaults = [
        # General settings
        ('system_name', 'Expresso Coffee Ordering System', 'string', 'Name of the system'),
        ('event_name', 'ANZCA ASM 2025 Cairns', 'string', 'Name of the event'),
        ('display_access_code', '123456', 'string', 'Access code for display screens'),
        
        # SMS settings
        ('sms_enabled', 'true', 'bool', 'Enable/disable SMS functionality'),
        ('sms_reply_enabled', 'true', 'bool', 'Enable/disable SMS reply handling'),
        ('default_wait_time', '15', 'int', 'Default wait time in minutes'),
        
        # Order settings
        ('auto_assign_station', 'true', 'bool', 'Automatically assign orders to stations'),
        ('max_order_per_customer', '5', 'int', 'Maximum active orders per customer'),
        ('allow_walk_in_orders', 'true', 'bool', 'Allow walk-in orders'),
        
        # Loyalty program settings
        ('loyalty_enabled', 'true', 'bool', 'Enable/disable loyalty program'),
        ('points_per_order', '1', 'int', 'Loyalty points earned per order'),
        ('points_for_free_coffee', '10', 'int', 'Points needed for a free coffee'),
        
        # Notification settings
        ('notify_on_new_order', 'true', 'bool', 'Notify baristas on new order'),
        ('notify_on_low_stock', 'true', 'bool', 'Notify on low stock levels'),
        
        # Payment and sponsor settings
        ('payment_enabled', 'false', 'bool', 'Enable/disable payment for coffee orders'),
        ('sponsor_name', 'ANZCA ASM 2025 Cairns', 'string', 'Name of coffee sponsor when payment disabled'),
        ('sponsor_message', 'Coffee service proudly sponsored by {sponsor}', 'string', 'Message template for sponsor acknowledgment'),
        ('sponsor_display_enabled', 'true', 'bool', 'Show sponsor message in confirmations'),
        
        # SMS templates in JSON format for easy admin editing
        ('sms_templates', json.dumps({
            'order_confirmation': 'Thank you for your order! Your {coffee_type} will be ready in approximately {wait_time} minutes. Your order code is {order_code}.',
            'order_ready': 'Your {coffee_type} is now ready for pickup at {station_name}! Your order code is {order_code}.',
            'order_reminder': 'Reminder: Your {coffee_type} has been waiting for {wait_time} minutes. Please collect it from {station_name}.',
        }), 'json', 'SMS message templates')
    ]
    
    for key, value, value_type, description in defaults:
        setting = SystemSettings.query.filter_by(key=key).first()
        if not setting:
            SystemSettings.set_value(key, value, value_type, description)


# Default SMS templates initialization function
def initialize_default_sms_templates():
    """Initialize default SMS templates"""
    defaults = [
        ('order_confirmation', 'Thank you for your order! Your {coffee_type} will be ready in approximately {wait_time} minutes. Your order code is {order_code}.', 'Sent when an order is confirmed'),
        ('order_ready', 'Your {coffee_type} is now ready for pickup at {station_name}! Your order code is {order_code}.', 'Sent when an order is ready for pickup'),
        ('order_reminder', 'Reminder: Your {coffee_type} has been waiting for {wait_time} minutes. Please collect it from {station_name}.', 'Sent as a reminder for uncollected orders'),
        ('help_request', 'Need help? Reply to this message and a staff member will assist you.', 'Help instructions for customers'),
        ('welcome', 'Welcome to Expresso at {event_name}! Text your coffee order to this number. For example: "Large flat white with almond milk".', 'Welcome message for new customers')
    ]
    
    for name, content, description in defaults:
        template = SMSTemplate.query.filter_by(name=name).first()
        if not template:
            template = SMSTemplate(name=name, content=content, description=description)
            db.session.add(template)
    
    db.session.commit()
