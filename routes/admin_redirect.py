"""
Simple admin redirect to prevent template errors
"""
from flask import Blueprint, redirect

# Create a blueprint
bp = Blueprint('admin_redirect', __name__, url_prefix='/admin')

# Redirect all admin routes to the main app
@bp.route('/')
@bp.route('/<path:path>')
def redirect_to_app(path=None):
    """Redirect all admin routes to the main React app"""
    return redirect('/')