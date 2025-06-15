
from flask import Blueprint, request, jsonify
import logging
from database_migration_system import DatabaseMigrationSystem

# Create migration API blueprint
migration_api = Blueprint('migration_api', __name__)
logger = logging.getLogger(__name__)

@migration_api.route('/api/migration/export-localStorage', methods=['POST'])
def export_localstorage():
    """API endpoint to receive localStorage data from frontend"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No data provided'}), 400
            
        # Initialize migration system
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        # Process the localStorage data
        result = migration_system.import_localstorage_data(data)
        migration_system.disconnect()
        
        if result:
            return jsonify({'success': True, 'message': 'Data migrated successfully'})
        else:
            return jsonify({'success': False, 'error': 'Migration failed'}), 500
            
    except Exception as e:
        logger.error(f"Error in localStorage export: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@migration_api.route('/api/migration/get-inventory', methods=['GET'])
def get_inventory_data():
    """Get inventory data from database"""
    try:
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        inventory_data = migration_system.get_inventory_data()
        migration_system.disconnect()
        
        return jsonify({'success': True, 'data': inventory_data})
        
    except Exception as e:
        logger.error(f"Error getting inventory data: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@migration_api.route('/api/migration/backup-status', methods=['GET'])
def get_backup_status():
    """Get backup system status"""
    try:
        migration_system = DatabaseMigrationSystem()
        if not migration_system.connect():
            return jsonify({'success': False, 'error': 'Database connection failed'}), 500
            
        status = migration_system.get_backup_status()
        migration_system.disconnect()
        
        return jsonify({'success': True, 'data': status})
        
    except Exception as e:
        logger.error(f"Error getting backup status: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
