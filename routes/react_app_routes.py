"""
React App Routes - Serve the built React application
"""
from flask import Blueprint, send_from_directory, render_template_string
import os

# Create blueprint
bp = Blueprint('react_app', __name__)

@bp.route('/app')
@bp.route('/app/')
def react_app():
    """Serve the React app main page"""
    return send_from_directory('/Users/stevewf/expresso/static', 'index.html')

@bp.route('/app/<path:filename>')
def react_app_static(filename):
    """Serve React app static files"""
    return send_from_directory('/Users/stevewf/expresso/static', filename)

@bp.route('/react')
@bp.route('/react/')
def react_redirect():
    """Alternative route to access React app"""
    return send_from_directory('/Users/stevewf/expresso/static', 'index.html')

@bp.route('/barista-react')
@bp.route('/barista-react/')
def barista_react():
    """React barista interface"""
    return send_from_directory('/Users/stevewf/expresso/static', 'index.html')