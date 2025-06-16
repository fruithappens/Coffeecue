"""
Settings API Routes
Handles event settings, station settings, and configuration persistence
"""
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import json
import logging

logger = logging.getLogger(__name__)

settings_api_bp = Blueprint('settings_api', __name__, url_prefix='/api/settings')

@settings_api_bp.route('/event', methods=['GET'])
@jwt_required()
def get_event_settings():
    """Get event-wide settings"""
    try:
        # Get or create settings
        settings = Settings.query.filter_by(key='event_settings').first()
        
        if settings:
            settings_data = json.loads(settings.value)
        else:
            # Default settings
            settings_data = {
                'event_name': 'Coffee Event',
                'branding': {
                    'primary_color': '#D97706',
                    'secondary_color': '#92400E',
                    'logo_url': '',
                    'custom_css': ''
                },
                'milk_colors': {
                    'full_cream': '#FFE4B5',
                    'skim': '#E6F3FF',
                    'soy': '#F5DEB3',
                    'almond': '#FAEBD7',
                    'oat': '#F5E6D3',
                    'coconut': '#FFFACD',
                    'lactose_free': '#E0F2FE'
                },
                'display_settings': {
                    'display_mode': 'landscape',
                    'display_timeout': 30,
                    'show_names': True,
                    'show_sponsor': True,
                    'sponsor_message': ''
                },
                'operational': {
                    'default_wait_time': 5,
                    'max_orders_per_barista': 3,
                    'auto_refresh_interval': 30,
                    'enable_walk_in_orders': True,
                    'enable_group_orders': True
                }
            }
        
        return jsonify({
            'status': 'success',
            'data': settings_data
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting event settings: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get settings'}), 500

@settings_api_bp.route('/event', methods=['POST'])
@jwt_required()
def update_event_settings():
    """Update event-wide settings"""
    try:
        # Check permissions
        current_user_id = get_jwt_identity()
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Get or create settings
        settings = Settings.query.filter_by(key='event_settings').first()
        
        if settings:
            # Merge with existing settings
            existing_data = json.loads(settings.value)
            
            # Deep merge the settings
            for key, value in data.items():
                if isinstance(value, dict) and key in existing_data and isinstance(existing_data[key], dict):
                    existing_data[key].update(value)
                else:
                    existing_data[key] = value
            
            settings.value = json.dumps(existing_data)
            settings.updated_at = datetime.utcnow()
        else:
            settings = Settings(
                key='event_settings',
                value=json.dumps(data)
            )
            db.session.add(settings)
        
        db.session.commit()
        
        # Emit WebSocket event for real-time updates
        from app import socketio
        socketio.emit('settings_updated', {
            'type': 'event_settings',
            'updated_by': current_user_id,
            'timestamp': datetime.utcnow().isoformat()
        }, room='settings_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'Settings updated successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating event settings: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update settings'}), 500

@settings_api_bp.route('/branding', methods=['GET'])
@jwt_required()
def get_branding_settings():
    """Get branding settings specifically"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({
                'success': False,
                'status': 'error',
                'message': 'Coffee system not available'
            }), 500
        
        db = coffee_system.db
        cursor = db.cursor()
        
        # Get branding settings from database
        cursor.execute("SELECT value FROM settings WHERE key = 'event_branding'")
        result = cursor.fetchone()
        
        if result:
            branding_data = json.loads(result[0])
        else:
            # Default branding settings
            branding_data = {
                'primary_color': '#D97706',
                'secondary_color': '#92400E', 
                'logo_url': '',
                'custom_css': '',
                'event_name': 'ANZCA ASM 2025 Cairns',
                'organization_name': 'Coffee Cue'
            }
        
        return jsonify({
            'success': True,
            'status': 'success',
            'settings': branding_data
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting branding settings: {e}")
        return jsonify({
            'success': False,
            'status': 'error', 
            'message': 'Failed to get branding settings'
        }), 500

@settings_api_bp.route('/branding', methods=['POST', 'PUT'])
@jwt_required()
def update_branding_settings():
    """Update branding settings specifically"""
    try:
        current_user_id = get_jwt_identity()
        
        data = request.get_json()
        if not data:
            return jsonify({
                'success': False,
                'status': 'error', 
                'message': 'No data provided'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system:
            return jsonify({
                'success': False,
                'status': 'error',
                'message': 'Coffee system not available'
            }), 500
        
        db = coffee_system.db
        cursor = db.cursor()
        
        # Check if branding settings exist
        cursor.execute("SELECT value FROM settings WHERE key = 'event_branding'")
        result = cursor.fetchone()
        
        if result:
            # Merge with existing settings
            existing_data = json.loads(result[0])
            existing_data.update(data)
            
            # Update existing record
            cursor.execute("""
                UPDATE settings 
                SET value = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
                WHERE key = 'event_branding'
            """, (json.dumps(existing_data), current_user_id))
        else:
            # Create new branding settings
            cursor.execute("""
                INSERT INTO settings (key, value, description, updated_by)
                VALUES ('event_branding', %s, 'Event branding and visual settings', %s)
            """, (json.dumps(data), current_user_id))
        
        db.commit()
        
        return jsonify({
            'success': True,
            'status': 'success',
            'message': 'Branding settings updated successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating branding settings: {e}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'status': 'error', 
            'message': 'Failed to update branding settings'
        }), 500

@settings_api_bp.route('/station/<int:station_id>', methods=['GET'])
@jwt_required()
def get_station_settings(station_id):
    """Get settings for a specific station"""
    try:
        # Check if station exists
        station = Station.query.get(station_id)
        if not station:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        # Get station-specific settings
        settings = Settings.query.filter_by(key=f'station_{station_id}_settings').first()
        
        if settings:
            settings_data = json.loads(settings.value)
        else:
            # Default station settings
            settings_data = {
                'station_name': station.name,
                'barista_name': '',
                'capabilities': {
                    'coffee_types': ['espresso', 'cappuccino', 'latte', 'flat_white'],
                    'milk_types': ['full_cream', 'skim', 'soy', 'almond', 'oat'],
                    'sizes': ['small', 'regular', 'large']
                },
                'preferences': {
                    'default_coffee': 'flat_white',
                    'default_milk': 'full_cream',
                    'default_size': 'regular'
                },
                'display': {
                    'theme': 'default',
                    'show_queue_position': True,
                    'show_wait_time': True
                }
            }
        
        return jsonify({
            'status': 'success',
            'data': {
                'station_id': station_id,
                'settings': settings_data
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting station settings: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get station settings'}), 500

@settings_api_bp.route('/station/<int:station_id>', methods=['POST'])
@jwt_required()
def update_station_settings(station_id):
    """Update settings for a specific station"""
    try:
        # Check if station exists
        station = Station.query.get(station_id)
        if not station:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Get or create settings
        settings_key = f'station_{station_id}_settings'
        settings = Settings.query.filter_by(key=settings_key).first()
        
        if settings:
            # Merge with existing settings
            existing_data = json.loads(settings.value)
            
            # Deep merge
            for key, value in data.items():
                if isinstance(value, dict) and key in existing_data and isinstance(existing_data[key], dict):
                    existing_data[key].update(value)
                else:
                    existing_data[key] = value
            
            settings.value = json.dumps(existing_data)
            settings.updated_at = datetime.utcnow()
        else:
            settings = Settings(
                key=settings_key,
                value=json.dumps(data)
            )
            db.session.add(settings)
        
        # Update station name if provided
        if 'station_name' in data:
            station.name = data['station_name']
        
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('station_settings_updated', {
            'station_id': station_id,
            'timestamp': datetime.utcnow().isoformat()
        }, room=f'station_{station_id}')
        
        return jsonify({
            'status': 'success',
            'message': 'Station settings updated successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating station settings: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update station settings'}), 500

@settings_api_bp.route('/milk-colors', methods=['GET'])
@jwt_required()
def get_milk_colors():
    """Get milk color settings"""
    try:
        # Get event settings
        settings = Settings.query.filter_by(key='event_settings').first()
        
        if settings:
            settings_data = json.loads(settings.value)
            milk_colors = settings_data.get('milk_colors', {})
        else:
            # Default milk colors
            milk_colors = {
                'full_cream': '#FFE4B5',
                'skim': '#E6F3FF',
                'soy': '#F5DEB3',
                'almond': '#FAEBD7',
                'oat': '#F5E6D3',
                'coconut': '#FFFACD',
                'lactose_free': '#E0F2FE'
            }
        
        return jsonify({
            'status': 'success',
            'data': milk_colors
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting milk colors: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get milk colors'}), 500

@settings_api_bp.route('/milk-colors', methods=['POST'])
@jwt_required()
def update_milk_colors():
    """Update milk color settings"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'No data provided'}), 400
        
        # Get event settings
        settings = Settings.query.filter_by(key='event_settings').first()
        
        if settings:
            settings_data = json.loads(settings.value)
            settings_data['milk_colors'] = data
            settings.value = json.dumps(settings_data)
            settings.updated_at = datetime.utcnow()
        else:
            settings_data = {
                'milk_colors': data
            }
            settings = Settings(
                key='event_settings',
                value=json.dumps(settings_data)
            )
            db.session.add(settings)
        
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('milk_colors_updated', {
            'colors': data,
            'timestamp': datetime.utcnow().isoformat()
        }, room='all_stations')
        
        return jsonify({
            'status': 'success',
            'message': 'Milk colors updated successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating milk colors: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update milk colors'}), 500

@settings_api_bp.route('/wait-time', methods=['PUT', 'POST'])
@jwt_required()
def update_wait_time():
    """Update the estimated wait time for all stations"""
    try:
        data = request.json
        wait_time = data.get('waitTime')
        
        if wait_time is None:
            logger.error("No wait time provided")
            return jsonify({"status": "error", "message": "No wait time provided"}), 400
        
        # Ensure wait time is a number
        try:
            wait_time = int(wait_time)
        except (ValueError, TypeError):
            logger.error(f"Invalid wait time format: {wait_time}")
            return jsonify({"status": "error", "message": "Wait time must be a number"}), 400
        
        # Get the current database connection
        from utils.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        try:
            # Update all active stations with new wait time
            cursor.execute('''
                UPDATE station_stats 
                SET wait_time = %s, last_updated = %s
                WHERE status = 'active'
            ''', (wait_time, datetime.now()))
            
            # Also update the default wait time in settings
            cursor.execute('''
                INSERT INTO settings (key, value, updated_at) 
                VALUES ('defaultWaitTime', %s, %s)
                ON CONFLICT (key) 
                DO UPDATE SET value = %s, updated_at = %s
            ''', (str(wait_time), datetime.now(), str(wait_time), datetime.now()))
            
            conn.commit()
            
            logger.info(f"Updated wait time to {wait_time} minutes for all active stations")
            return jsonify({
                "status": "success", 
                "success": True,
                "message": f"Wait time updated to {wait_time} minutes"
            }), 200
        
        except Exception as db_error:
            conn.rollback()
            logger.error(f"Database error updating wait time: {str(db_error)}")
            return jsonify({
                "status": "error",
                "success": False,
                "message": f"Database error: {str(db_error)}"
            }), 500
        finally:
            cursor.close()
            if conn:
                conn.close()
    
    except Exception as e:
        logger.error(f"Error updating wait time: {str(e)}")
        return jsonify({
            "status": "error",
            "success": False,
            "message": f"Error processing request: {str(e)}"
        }), 500