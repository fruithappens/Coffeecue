"""
Settings API routes for configuration management
Provides endpoints for accessing and updating system settings
"""

import logging
from flask import Blueprint, jsonify, request, current_app
from datetime import datetime
from models.users import Settings
from flask_jwt_extended import get_jwt_identity
from auth import jwt_required_with_demo

# Create blueprint
bp = Blueprint('settings_api', __name__, url_prefix='/api/settings')

# Set up logging
logger = logging.getLogger("expresso.routes.settings_api")

@bp.route('/', methods=['GET'])
def get_settings():
    """Get all settings"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get all settings
        settings = Settings.get_all(db)
        
        # For security, remove any sensitive settings
        sensitive_keys = ['stripe_api_key', 'stripe_webhook_secret', 'smtp_password']
        for key in sensitive_keys:
            if key in settings:
                settings[key]['value'] = '*****'
        
        return jsonify({
            "success": True,
            "settings": settings
        })
    
    except Exception as e:
        logger.error(f"Error getting settings: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/<key>', methods=['GET'])
def get_setting(key):
    """Get a specific setting"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get setting
        value = Settings.get(db, key)
        
        # Check if setting exists
        if value is None:
            return jsonify({
                "success": False,
                "message": f"Setting '{key}' not found"
            }), 404
        
        # For security, mask sensitive settings
        sensitive_keys = ['stripe_api_key', 'stripe_webhook_secret', 'smtp_password']
        if key.lower() in sensitive_keys:
            value = '*****'
        
        return jsonify({
            "success": True,
            "key": key,
            "value": value
        })
    
    except Exception as e:
        logger.error(f"Error getting setting {key}: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/<key>', methods=['PUT'])
@jwt_required_with_demo()
def update_setting(key):
    """Update a setting (requires authentication)"""
    try:
        # Get user identity from JWT
        current_user = get_jwt_identity()
        
        # Get data from request
        data = request.json
        value = data.get('value')
        description = data.get('description')
        
        if value is None:
            return jsonify({
                "success": False,
                "message": "Value is required"
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update setting
        success = Settings.set(db, key, value, description, current_user)
        
        if success:
            return jsonify({
                "success": True,
                "message": f"Setting '{key}' updated successfully"
            })
        else:
            return jsonify({
                "success": False,
                "message": f"Failed to update setting '{key}'"
            }), 500
    
    except Exception as e:
        logger.error(f"Error updating setting {key}: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/milk-colors', methods=['GET'])
def get_milk_colors():
    """Get milk color coding settings"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get milk colors from settings or use defaults
        milk_colors_json = Settings.get(db, 'milk_colors', None)
        
        # Default milk colors if not set
        if not milk_colors_json:
            milk_colors = {
                # Standard Milks
                "Full Cream Milk": "#FFFFFF",  # White/Cream
                "Skim Milk": "#ADD8E6",  # Light Blue
                "Reduced Fat Milk": "#D3D3D3",  # Light Gray
                "Lactose-Free Milk": "#FAFAFA",  # White with special border (handled in UI)
                
                # Alternative Milks
                "Soy Milk": "#FFFACD",  # Yellow
                "Oat Milk": "#FFCCCB",  # Light Red
                "Almond Milk": "#EADDCA",  # Light Blue-Brown
                "Coconut Milk": "#D0F0C0",  # Light Green
                "Macadamia Milk": "#D2B48C",  # Soft Brown
                "Rice Milk": "#E6E6FA"   # Light Purple
            }
        else:
            # Parse from JSON
            try:
                import json
                milk_colors = json.loads(milk_colors_json)
            except:
                # Fallback to default if parsing fails
                milk_colors = {}
        
        return jsonify({
            "success": True,
            "milk_colors": milk_colors
        })
    
    except Exception as e:
        logger.error(f"Error getting milk colors: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/milk-colors', methods=['PUT'])
@jwt_required_with_demo()
def update_milk_colors():
    """Update milk color coding settings"""
    try:
        # Get user identity from JWT
        current_user = get_jwt_identity()
        
        # Get data from request
        data = request.json
        
        if not isinstance(data, dict):
            return jsonify({
                "success": False,
                "message": "Invalid data format. Expected a dictionary of milk types and colors."
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Validate color format (simple hex validation)
        for milk_type, color in data.items():
            if not isinstance(color, str) or not color.startswith('#') or len(color) not in [4, 7]:
                return jsonify({
                    "success": False,
                    "message": f"Invalid color format for {milk_type}: {color}. Expected hex color like #FFF or #FFFFFF"
                }), 400
        
        # Convert to JSON for storage
        import json
        milk_colors_json = json.dumps(data)
        
        # Save to settings
        success = Settings.set(db, 'milk_colors', milk_colors_json, 
                             "Color coding for milk types", current_user)
        
        if success:
            return jsonify({
                "success": True,
                "message": "Milk colors updated successfully"
            })
        else:
            return jsonify({
                "success": False,
                "message": "Failed to update milk colors"
            }), 500
    
    except Exception as e:
        logger.error(f"Error updating milk colors: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/display', methods=['GET'])
def get_display_settings():
    """Get display-specific settings (convenience endpoint)"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get display-related settings
        settings = {}
        
        # System and event names
        settings['system_name'] = Settings.get(db, 'system_name', 'Coffee Cue')
        settings['event_name'] = Settings.get(db, 'event_name', 
                                             current_app.config.get('config', {}).get('EVENT_NAME', 'Coffee Event'))
        
        # Sponsor settings
        settings['sponsor_display_enabled'] = Settings.get(db, 'sponsor_display_enabled', 'false')
        settings['sponsor_name'] = Settings.get(db, 'sponsor_name', '')
        settings['sponsor_message'] = Settings.get(db, 'sponsor_message', 'Coffee service proudly sponsored by {sponsor}')
        
        # SMS messaging settings
        settings['sms_welcome_message'] = Settings.get(db, 'sms_welcome_message', 'Welcome to {event_name}! I\'ll take your coffee order. What\'s your first name?')
        
        # SMS settings
        settings['sms_number'] = current_app.config.get('config', {}).get('TWILIO_PHONE_NUMBER', '')
        settings['sms_enabled'] = current_app.config.get('config', {}).get('TWILIO_ACCOUNT_SID', '') != ''
        
        # Get milk colors
        milk_colors_json = Settings.get(db, 'milk_colors', None)
        if milk_colors_json:
            try:
                import json
                settings['milk_colors'] = json.loads(milk_colors_json)
            except:
                # If parsing fails, don't include
                pass
        
        return jsonify({
            "success": True,
            "settings": settings
        })
    
    except Exception as e:
        logger.error(f"Error getting display settings: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/display', methods=['PUT'])
@jwt_required_with_demo()
def update_display_settings():
    """Update display-specific settings (requires authentication)"""
    try:
        # Get user identity from JWT
        current_user = get_jwt_identity()
        
        # Get data from request
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update settings
        results = {}
        
        # System and event names
        if 'system_name' in data:
            results['system_name'] = Settings.set(db, 'system_name', data['system_name'], 
                                                "System name displayed on screens", current_user)
        
        if 'event_name' in data:
            results['event_name'] = Settings.set(db, 'event_name', data['event_name'], 
                                               "Event name displayed on screens", current_user)
        
        # Sponsor settings
        if 'sponsor_display_enabled' in data:
            results['sponsor_display_enabled'] = Settings.set(db, 'sponsor_display_enabled', 
                                                           str(data['sponsor_display_enabled']).lower(), 
                                                           "Whether to display sponsor information", current_user)
        
        if 'sponsor_name' in data:
            results['sponsor_name'] = Settings.set(db, 'sponsor_name', data['sponsor_name'], 
                                                 "Name of the sponsor", current_user)
        
        if 'sponsor_message' in data:
            results['sponsor_message'] = Settings.set(db, 'sponsor_message', data['sponsor_message'], 
                                                    "Message template for sponsor (use {sponsor} for name)", current_user)
                                                    
        # SMS messaging settings
        if 'sms_welcome_message' in data:
            results['sms_welcome_message'] = Settings.set(db, 'sms_welcome_message', data['sms_welcome_message'],
                                                      "Welcome message template for SMS orders (use {event_name} for event name)", current_user)
        
        return jsonify({
            "success": True,
            "results": results
        })
    
    except Exception as e:
        logger.error(f"Error updating display settings: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

# Add specific operation settings endpoints
@bp.route('/autoAssignStation', methods=['GET', 'POST'])
@jwt_required_with_demo()
def auto_assign_station():
    """Handle auto-assign station setting"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        if request.method == 'GET':
            value = Settings.get(db, 'autoAssignStation', 'true')
            return jsonify({
                "success": True,
                "value": value == 'true'
            })
        else:  # POST
            data = request.json
            value = str(data.get('value', True)).lower()
            current_user = get_jwt_identity()
            
            success = Settings.set(db, 'autoAssignStation', value, 
                                 "Automatically assign orders to available stations", current_user)
            
            return jsonify({
                "success": success,
                "message": "Auto-assign station setting updated"
            })
    
    except Exception as e:
        logger.error(f"Error handling autoAssignStation: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/enableQueueJumping', methods=['GET', 'POST'])
@jwt_required_with_demo()
def enable_queue_jumping():
    """Handle queue jumping setting"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        if request.method == 'GET':
            value = Settings.get(db, 'enableQueueJumping', 'true')
            return jsonify({
                "success": True,
                "value": value == 'true'
            })
        else:  # POST
            data = request.json
            value = str(data.get('value', True)).lower()
            current_user = get_jwt_identity()
            
            success = Settings.set(db, 'enableQueueJumping', value, 
                                 "Allow VIP and priority orders to jump the queue", current_user)
            
            return jsonify({
                "success": success,
                "message": "Queue jumping setting updated"
            })
    
    except Exception as e:
        logger.error(f"Error handling enableQueueJumping: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/enableStationSwitching', methods=['GET', 'POST'])
@jwt_required_with_demo()
def enable_station_switching():
    """Handle station switching setting"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        if request.method == 'GET':
            value = Settings.get(db, 'enableStationSwitching', 'true')
            return jsonify({
                "success": True,
                "value": value == 'true'
            })
        else:  # POST
            data = request.json
            value = str(data.get('value', True)).lower()
            current_user = get_jwt_identity()
            
            success = Settings.set(db, 'enableStationSwitching', value, 
                                 "Allow customers to switch between stations", current_user)
            
            return jsonify({
                "success": success,
                "message": "Station switching setting updated"
            })
    
    except Exception as e:
        logger.error(f"Error handling enableStationSwitching: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })

@bp.route('/branding', methods=['GET', 'PUT'])
@jwt_required_with_demo()
def branding_settings():
    """Handle branding settings"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        if request.method == 'GET':
            # Get all branding-related settings
            branding = {
                'systemName': Settings.get(db, 'systemName', 'Coffee Cue'),
                'companyName': Settings.get(db, 'companyName', 'Coffee Cue'),
                'shortName': Settings.get(db, 'shortName', 'Coffee Cue'),
                'landingTitle': Settings.get(db, 'landingTitle', 'Coffee Cue Ordering System'),
                'landingSubtitle': Settings.get(db, 'landingSubtitle', 'Select your role to continue'),
                'adminPanelTitle': Settings.get(db, 'adminPanelTitle', 'Coffee Cue Admin'),
                'baristaPanelTitle': Settings.get(db, 'baristaPanelTitle', 'Coffee Cue Barista'),
                'tagline': Settings.get(db, 'tagline', 'Skip the Queue, Get Your Cue'),
                'primaryColor': Settings.get(db, 'primaryColor', '#D97706'),
                'secondaryColor': Settings.get(db, 'secondaryColor', '#B45309'),
                'textColor': Settings.get(db, 'textColor', '#92400E'),
                'backgroundColor': Settings.get(db, 'backgroundColor', '#f9fafb'),
                'customBranding': Settings.get(db, 'customBranding', 'true') == 'true',
                'clientName': Settings.get(db, 'clientName', ''),
                'clientLogo': Settings.get(db, 'clientLogo', ''),
                'footerText': Settings.get(db, 'footerText', '© 2025 Expresso Coffee System | ANZCA ASM 2025 Cairns')
            }
            
            return jsonify({
                "success": True,
                "settings": branding
            })
            
        else:  # PUT
            data = request.json
            settings = data.get('settings', {})
            current_user = get_jwt_identity()
            
            # Update each branding setting
            results = {}
            for key, value in settings.items():
                # Convert boolean values to string for storage
                if isinstance(value, bool):
                    value = str(value).lower()
                    
                results[key] = Settings.set(db, key, str(value), 
                                          f"Branding setting: {key}", current_user)
            
            return jsonify({
                "success": True,
                "message": "Branding settings updated successfully",
                "results": results
            })
    
    except Exception as e:
        logger.error(f"Error handling branding settings: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e)
        })