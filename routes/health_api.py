"""
Health check API endpoint
"""
from flask import Blueprint, jsonify
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

bp = Blueprint('health_api', __name__, url_prefix='/api')

@bp.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint for API connectivity verification
    """
    try:
        return jsonify({
            'status': 'success',
            'message': 'API is healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'service': 'expresso-api',
            'version': '1.0.0'
        }), 200
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'error',
            'message': 'Health check failed',
            'error': str(e)
        }), 500