"""
React App Routes - Serve the built React application
"""
from flask import Blueprint, redirect

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


# Legacy aliases for the React app, which is now served from '/' by the main
# app (Flask static_folder + the React-Router catch-all). These four used to
# send_from_directory a developer's absolute laptop path ('/Users/.../static')
# that does not exist in the container, so they 404'd in production. Kept as
# redirects so an old bookmark still lands on the app.
@bp.route('/app')
@bp.route('/app/')
@bp.route('/app/<path:filename>')
@bp.route('/react')
@bp.route('/react/')
@bp.route('/barista-react')
@bp.route('/barista-react/')
def legacy_react_alias(filename=None):
    return redirect('/')
