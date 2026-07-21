"""
React App Routes - Serve the built React application
"""
from flask import Blueprint, send_from_directory, render_template_string, redirect
import os

# Create blueprint
bp = Blueprint('react_app', __name__)


# ----------------------------------------------------------------------
# Short, memorable screen links (Steve: "a rebrandly for easy to
# remember links"). Meant to be typed by hand into a TV browser:
#   /tv1     → station 1 board, no ordering button (wall TV)
#   /kiosk2  → station 2 board with the tap-to-order kiosk
#   /pickup1 → clean collection-only screen for station 1
# Bare forms (/tv, /kiosk, /pickup) show all stations. These are plain
# redirects — the display itself stays a public, no-login page.
# ----------------------------------------------------------------------
@bp.route('/tv')
def short_tv_all():
    return redirect('/display?kiosk=0')


@bp.route('/tv<int:n>')
def short_tv(n):
    return redirect(f'/display?station={n}&kiosk=0')


@bp.route('/kiosk')
def short_kiosk_all():
    return redirect('/display')


@bp.route('/kiosk<int:n>')
def short_kiosk(n):
    return redirect(f'/display?station={n}')


@bp.route('/pickup')
def short_pickup_all():
    return redirect('/display?mode=pickup')


@bp.route('/pickup<int:n>')
def short_pickup(n):
    return redirect(f'/display?station={n}&mode=pickup')

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